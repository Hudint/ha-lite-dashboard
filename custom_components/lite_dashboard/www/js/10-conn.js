/* Lite Dashboard - authentication, websocket connection and entity store. */
(function () {
  'use strict';
  var LD = window.LD;

  var TOKEN_KEY = 'liteDashboardTokens';
  var HA_TOKEN_KEY = 'hassTokens';

  /* ------------------------------------------------------------------ auth
   * Sources, in order:
   *  1. Same-origin parent frame running the HA frontend (lite page used as a
   *     "Webpage" dashboard / iframe) -> reuse its auth.
   *  2. HA Companion app (Android/iOS) external auth bridge.
   *  3. Tokens from a previous login on this page, or from the HA frontend.
   *  4. Regular HA login redirect (OAuth2 authorization code flow). */

  function parentAuth() {
    try {
      if (window.parent && window.parent !== window && window.parent.hassConnection) {
        return window.parent.hassConnection.then(function (c) {
          return {
            kind: 'parent',
            token: function (force) {
              if (force || c.auth.expired) return c.auth.refreshAccessToken().then(function () { return c.auth.accessToken; });
              return Promise.resolve(c.auth.accessToken);
            },
          };
        });
      }
    } catch (e) {
      /* cross-origin parent */
    }
    return null;
  }

  function externalAuth() {
    var android = window.externalApp && window.externalApp.getExternalAuth;
    var ios = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.getExternalAuth;
    if (!android && !ios) return null;
    var cached = null;
    var expires = 0;
    function fetchToken(force) {
      return new Promise(function (resolve, reject) {
        var cb = '__ldExternalAuth' + Math.round(Math.random() * 1e9);
        window[cb] = function (success, data) {
          delete window[cb];
          if (!success) return reject(new Error('external auth failed'));
          cached = data.access_token;
          expires = Date.now() + (data.expires_in || 1800) * 1000;
          resolve(cached);
        };
        var payload = { callback: cb, force: !!force };
        if (android) window.externalApp.getExternalAuth(JSON.stringify(payload));
        else window.webkit.messageHandlers.getExternalAuth.postMessage(payload);
      });
    }
    return Promise.resolve({
      kind: 'external',
      token: function (force) {
        if (!force && cached && Date.now() < expires - 60000) return Promise.resolve(cached);
        return fetchToken(force);
      },
    });
  }

  function postForm(url, data) {
    var body = Object.keys(data)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]); })
      .join('&');
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('token request failed: ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function clientId() {
    return location.origin + '/';
  }
  function redirectUri() {
    return location.origin + location.pathname + '?auth_callback=1';
  }

  function redirectToLogin() {
    var state = btoa(JSON.stringify({ hassUrl: location.origin, clientId: clientId(), path: location.pathname + location.hash }));
    location.href =
      '/auth/authorize?response_type=code&client_id=' + encodeURIComponent(clientId()) +
      '&redirect_uri=' + encodeURIComponent(redirectUri()) +
      '&state=' + encodeURIComponent(state);
    return new Promise(function () {}); /* never resolves: page navigates away */
  }

  function storedAuth() {
    var params = new URLSearchParams(location.search);
    var start;
    if (params.get('auth_callback') && params.get('code')) {
      var code = params.get('code');
      var path = location.pathname;
      try {
        path = JSON.parse(atob(params.get('state'))).path || path;
      } catch (e) { /* ignore */ }
      history.replaceState(null, '', path);
      start = postForm('/auth/token', { grant_type: 'authorization_code', code: code, client_id: clientId() }).then(function (t) {
        t.clientId = clientId();
        t.hassUrl = location.origin;
        t.expires = Date.now() + t.expires_in * 1000;
        LD.storage.set(TOKEN_KEY, t);
        return { key: TOKEN_KEY, tokens: t };
      });
    } else {
      var own = LD.storage.get(TOKEN_KEY, null);
      var shared = LD.storage.get(HA_TOKEN_KEY, null);
      if (own && own.refresh_token) start = Promise.resolve({ key: TOKEN_KEY, tokens: own });
      else if (shared && shared.refresh_token && (!shared.hassUrl || shared.hassUrl === location.origin))
        start = Promise.resolve({ key: HA_TOKEN_KEY, tokens: shared });
      else return null;
    }
    return start.then(function (holder) {
      function refresh() {
        var t = holder.tokens;
        return postForm('/auth/token', {
          grant_type: 'refresh_token',
          refresh_token: t.refresh_token,
          client_id: t.clientId || clientId(),
        }).then(
          function (n) {
            t.access_token = n.access_token;
            t.expires_in = n.expires_in;
            t.expires = Date.now() + n.expires_in * 1000;
            LD.storage.set(holder.key, t);
            return t.access_token;
          },
          function (err) {
            if (err.status === 400 || err.status === 403) {
              if (holder.key === TOKEN_KEY) LD.storage.set(TOKEN_KEY, undefined);
              return redirectToLogin();
            }
            throw err;
          }
        );
      }
      return {
        kind: 'tokens',
        token: function (force) {
          var t = holder.tokens;
          if (!force && t.access_token && Date.now() < (t.expires || 0) - 60000) return Promise.resolve(t.access_token);
          return refresh();
        },
      };
    });
  }

  LD.getAuth = function () {
    return parentAuth() || externalAuth() || storedAuth() || redirectToLogin();
  };

  /* ------------------------------------------------------------ connection */

  function Connection(auth) {
    this.auth = auth;
    this.ws = null;
    this.nextId = 1;
    this.pending = {};
    this.subs = {}; /* key -> {msg, cb, id} */
    this.subKey = 1;
    this.listeners = { ready: [], disconnected: [] };
    this.backoff = 1000;
    this.closedByUs = false;
  }

  Connection.prototype.on = function (ev, fn) {
    this.listeners[ev].push(fn);
  };
  Connection.prototype.emit = function (ev, arg) {
    this.listeners[ev].forEach(function (fn) { fn(arg); });
  };

  Connection.prototype.connect = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var triedRefresh = false;
      function open(force) {
        self.auth.token(force).then(function (token) {
          var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
          var ws = new WebSocket(proto + location.host + '/api/websocket');
          self.ws = ws;
          ws.onmessage = function (ev) {
            var msg = JSON.parse(ev.data);
            if (msg.type === 'auth_required') {
              ws.send(JSON.stringify({ type: 'auth', access_token: token }));
            } else if (msg.type === 'auth_invalid') {
              ws.onclose = null;
              ws.close();
              if (!triedRefresh) {
                triedRefresh = true;
                open(true);
              } else reject(new Error('auth_invalid'));
            } else if (msg.type === 'auth_ok') {
              self.haVersion = msg.ha_version;
              self.backoff = 1000;
              self._onOpen();
              resolve(self);
            } else {
              self._handle(msg);
            }
          };
          ws.onclose = function () {
            self._onClose();
          };
          ws.onerror = function () {
            /* onclose follows */
          };
        }, function (err) {
          self._scheduleReconnect();
          reject(err);
        });
      }
      open(false);
    });
  };

  Connection.prototype._onOpen = function () {
    var self = this;
    /* re-establish subscriptions after a reconnect */
    Object.keys(this.subs).forEach(function (key) {
      var sub = self.subs[key];
      sub.id = self._send(Object.assign({}, sub.msg));
      self.pending[sub.id] = { sub: sub };
    });
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(function () {
      var timeout = setTimeout(function () {
        if (self.ws) self.ws.close();
      }, 10000);
      self.call({ type: 'ping' }).then(function () { clearTimeout(timeout); }, function () {});
    }, 30000);
    this.emit('ready');
  };

  Connection.prototype._onClose = function () {
    clearInterval(this.pingTimer);
    var self = this;
    Object.keys(this.pending).forEach(function (id) {
      var p = self.pending[id];
      if (p.reject) p.reject(new Error('connection lost'));
    });
    this.pending = {};
    this.ws = null;
    if (this.closedByUs) return;
    this.emit('disconnected');
    this._scheduleReconnect();
  };

  Connection.prototype._scheduleReconnect = function () {
    var self = this;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(function () {
      self.connect().catch(function () {});
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  };

  Connection.prototype.reconnectNow = function () {
    if (this.ws && this.ws.readyState <= 1) return;
    this.backoff = 1000;
    clearTimeout(this.reconnectTimer);
    this.connect().catch(function () {});
  };

  Connection.prototype._send = function (msg) {
    msg.id = this.nextId++;
    this.ws.send(JSON.stringify(msg));
    return msg.id;
  };

  Connection.prototype._handle = function (msg) {
    var p = this.pending[msg.id];
    if (!p) return;
    if (p.sub) {
      if (msg.type === 'event') p.sub.cb(msg.event);
      else if (msg.type === 'result' && !msg.success) console.warn('[lite-dashboard] subscription failed', p.sub.msg, msg.error);
      return;
    }
    if (msg.type === 'result' || msg.type === 'pong') {
      delete this.pending[msg.id];
      if (msg.type === 'pong' || msg.success) p.resolve(msg.result);
      else p.reject(msg.error);
    }
  };

  Connection.prototype.call = function (msg) {
    var self = this;
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('not connected'));
    return new Promise(function (resolve, reject) {
      var id = self._send(Object.assign({}, msg));
      self.pending[id] = { resolve: resolve, reject: reject };
    });
  };

  /* Returns an unsubscribe function. Survives reconnects. */
  Connection.prototype.subscribe = function (msg, cb) {
    var key = this.subKey++;
    var sub = { msg: msg, cb: cb, id: null };
    this.subs[key] = sub;
    if (this.ws && this.ws.readyState === 1) {
      sub.id = this._send(Object.assign({}, msg));
      this.pending[sub.id] = { sub: sub };
    }
    var self = this;
    return function () {
      delete self.subs[key];
      if (sub.id !== null) {
        delete self.pending[sub.id];
        if (self.ws && self.ws.readyState === 1) {
          self.call({ type: 'unsubscribe_events', subscription: sub.id }).catch(function () {});
        }
      }
    };
  };

  LD.Connection = Connection;

  /* ----------------------------------------------------------- entity store
   * Uses subscribe_entities (compressed diffs) restricted to the entities the
   * dashboard actually references. */

  function Store() {
    this.states = {};
    this.overrides = {}; /* optimistic states: entity_id -> {state, until} */
    this.listeners = [];
  }

  function expand(id, c) {
    var st = {
      entity_id: id,
      state: c.s,
      attributes: c.a || {},
      context: typeof c.c === 'string' ? { id: c.c } : c.c,
      last_changed: new Date(c.lc * 1000).toISOString(),
      last_updated: new Date((c.lu || c.lc) * 1000).toISOString(),
    };
    return st;
  }

  Store.prototype.apply = function (ev) {
    var changed = [];
    var self = this;
    if (ev.a) {
      Object.keys(ev.a).forEach(function (id) {
        self.states[id] = expand(id, ev.a[id]);
        changed.push(id);
      });
    }
    if (ev.r) {
      ev.r.forEach(function (id) {
        delete self.states[id];
        changed.push(id);
      });
    }
    if (ev.c) {
      Object.keys(ev.c).forEach(function (id) {
        var old = self.states[id];
        if (!old) return;
        var diff = ev.c[id];
        var st = Object.assign({}, old);
        if (diff['+']) {
          var add = diff['+'];
          if (add.s !== undefined) st.state = add.s;
          if (add.c !== undefined) st.context = typeof add.c === 'string' ? { id: add.c } : add.c;
          if (add.lc) {
            st.last_changed = new Date(add.lc * 1000).toISOString();
            st.last_updated = st.last_changed;
          } else if (add.lu) st.last_updated = new Date(add.lu * 1000).toISOString();
          if (add.a) st.attributes = Object.assign({}, st.attributes, add.a);
        }
        if (diff['-'] && diff['-'].a) {
          st.attributes = Object.assign({}, st.attributes);
          diff['-'].a.forEach(function (k) { delete st.attributes[k]; });
        }
        self.states[id] = st;
        changed.push(id);
      });
    }
    changed.forEach(function (id) {
      if (self.overrides[id]) delete self.overrides[id];
    });
    this.notify(changed);
  };

  /* Show the expected state immediately after a tap; the real state replaces it. */
  Store.prototype.setOptimistic = function (id, state) {
    var self = this;
    this.overrides[id] = state;
    this.notify([id]);
    setTimeout(function () {
      if (self.overrides[id] === state) {
        delete self.overrides[id];
        self.notify([id]);
      }
    }, 5000);
  };

  Store.prototype.get = function (id) {
    var st = this.states[id];
    if (!st) return undefined;
    var o = this.overrides[id];
    if (o === undefined) return st;
    return Object.assign({}, st, { state: o, optimistic: true });
  };

  Store.prototype.onChange = function (fn) {
    this.listeners.push(fn);
  };
  Store.prototype.notify = function (ids) {
    if (!ids.length) return;
    this.listeners.forEach(function (fn) { fn(ids); });
  };

  LD.Store = Store;
})();
