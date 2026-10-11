/* Lite Dashboard - bootstrap: connect, load the dashboard, render, keep it live. */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;
  var boot = LD.boot;
  var params = new URLSearchParams(location.search);

  var appEl = document.getElementById('app');
  var statusEl = null;

  function showStatus(text) {
    if (!statusEl) {
      statusEl = h('div', 'ld-status');
      document.body.appendChild(statusEl);
    }
    LD.setText(statusEl, text || '');
    statusEl.classList.toggle('show', !!text);
  }

  function showError(text) {
    LD.clear(appEl);
    var box = h('div', 'ld-error');
    box.appendChild(LD.icon('mdi:alert-circle-outline'));
    box.appendChild(h('div', null, text));
    appEl.appendChild(box);
  }

  /* Entity domains of HA core. Used to tell entity ids ("light.kitchen") apart from
   * other dotted words in configs and JS templates ("entity.state", "image.png"). */
  var ENTITY_DOMAINS = {};
  ('ai_task air_quality alarm_control_panel alert assist_satellite automation binary_sensor button calendar camera ' +
    'climate conversation counter cover date datetime device_tracker event fan group humidifier image ' +
    'image_processing input_boolean input_button input_datetime input_number input_select input_text lawn_mower ' +
    'light lock media_player notify number person plant proximity remote scene schedule script select sensor ' +
    'siren stt sun switch text time timer todo tts update vacuum valve wake_word water_heater weather zone')
    .split(' ')
    .forEach(function (d) { ENTITY_DOMAINS[d] = 1; });

  function extractEntityIds(obj) {
    var found = {};
    var re = /\b([a-z_]+)\.([a-z0-9_]+)\b/g;
    var text = JSON.stringify(obj);
    var m;
    while ((m = re.exec(text))) {
      if (ENTITY_DOMAINS[m[1]]) found[m[0]] = 1;
    }
    if (text.indexOf('weather-forecast') !== -1) found['sun.sun'] = 1; /* day/night weather icons */
    return Object.keys(found);
  }
  LD.extractEntityIds = extractEntityIds;

  /* ------------------------------------------------------------- context
   * One context per rendered view; dropped (with all its subscriptions)
   * when the view or the dashboard config changes. */
  function createContext(hass, conn) {
    var watchers = {}; /* entity_id -> [fn] */
    var screenFns = [];
    var subs = [];
    var cards = [];
    var dead = false;

    function addWatcher(id, fn) {
      (watchers[id] = watchers[id] || []).push(fn);
    }

    var ctx = {
      hass: hass,
      watch: function (card) {
        var deps = card.deps.filter(Boolean);
        if (card.watchAllTemplates || JSON.stringify(card.config).indexOf('[[[') !== -1) deps = deps.concat(extractEntityIds(card.config));
        deps.forEach(function (id) { addWatcher(id, card.update); });
        if (card.watchScreen) screenFns.push(card.update);
        cards.push(card);
      },
      watchIds: function (ids, fn, screen) {
        ids.forEach(function (id) { addWatcher(id, fn); });
        if (screen) screenFns.push(fn);
        return function () {
          ids.forEach(function (id) {
            var list = watchers[id];
            if (list) watchers[id] = list.filter(function (f) { return f !== fn; });
          });
          screenFns = screenFns.filter(function (f) { return f !== fn; });
        };
      },
      subscribe: function (msg, cb) {
        var unsub = conn.subscribe(msg, function (ev) { if (!dead) cb(ev); });
        subs.push(unsub);
        return unsub;
      },
      refreshAll: function () {
        cards.forEach(function (c) {
          try { c.update(); } catch (e) { console.error('[lite-dashboard] update failed', c.config, e); }
        });
      },
      onStates: function (ids) {
        var fns = [];
        ids.forEach(function (id) {
          (watchers[id] || []).forEach(function (fn) { if (fns.indexOf(fn) === -1) fns.push(fn); });
        });
        fns.forEach(function (fn) { LD.schedule(fn); });
      },
      onScreen: function () {
        screenFns.forEach(function (fn) { LD.schedule(fn); });
      },
      destroy: function () {
        dead = true;
        subs.forEach(function (u) { u(); });
        subs = [];
        watchers = {};
        screenFns = [];
        cards = [];
      },
    };
    return ctx;
  }

  /* ----------------------------------------------------------------- app */

  var state = {
    conn: null,
    hass: null,
    store: null,
    lovelace: null,
    themes: null,
    ctx: null,
    viewIndex: 0,
    columns: null,
    entityIds: [],
    unsubEntities: null,
  };

  function visibleViews() {
    var views = (state.lovelace && state.lovelace.views) || [];
    var uid = state.hass.user && state.hass.user.id;
    return views
      .map(function (v, i) { return { view: v, index: i }; })
      .filter(function (x) {
        var vis = x.view.visible;
        if (vis === false) return false;
        if (Array.isArray(vis)) return vis.some(function (u) { return u.user === uid; });
        return true;
      });
  }

  function viewFromLocation() {
    var rest = location.pathname.slice((boot.basePath || '').length).replace(/^\/+|\/+$/g, '');
    var key = params.get('view') || rest;
    var views = (state.lovelace && state.lovelace.views) || [];
    if (key) {
      for (var i = 0; i < views.length; i++) if (views[i].path === key) return i;
      if (/^\d+$/.test(key) && views[Number(key)]) return Number(key);
    }
    var vis = visibleViews();
    return vis.length ? vis[0].index : 0;
  }

  LD.navigate = function (path, replace) {
    var dash = '/' + (boot.urlPath || 'lovelace') + '/';
    var target = null;
    if (path.indexOf(dash) === 0) target = path.slice(dash.length);
    else if (path.charAt(0) !== '/') target = path;
    if (target === null) {
      location.href = path;
      return;
    }
    var url = boot.basePath + '/' + target.replace(/^\/+/, '');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    state.viewIndex = viewFromLocation();
    render();
  };
  window.addEventListener('popstate', function () {
    state.viewIndex = viewFromLocation();
    render();
  });

  function renderTabs(container) {
    var vis = visibleViews().filter(function (x) { return !x.view.subview; });
    if (vis.length < 2 || params.has('kiosk') || params.has('hide_tabs')) return;
    var bar = h('div', 'ld-tabs');
    vis.forEach(function (x) {
      var t = h('button', 'ld-tab' + (x.index === state.viewIndex ? ' on' : ''));
      if (x.view.icon) t.appendChild(LD.icon(x.view.icon));
      if (x.view.title && !x.view.icon) t.appendChild(h('span', null, x.view.title));
      t.addEventListener('click', function () { LD.navigate(x.view.path || String(x.index)); });
      bar.appendChild(t);
    });
    container.appendChild(bar);
  }

  function render() {
    if (state.ctx) state.ctx.destroy();
    var ctx = (state.ctx = createContext(state.hass, state.conn));
    var view = (state.lovelace.views || [])[state.viewIndex];
    state.width = window.innerWidth;
    LD.applyTheme(state.themes, (view && view.theme) || null);
    var frag = document.createDocumentFragment();
    renderTabs(frag);
    if (!view) {
      frag.appendChild(h('div', 'ld-error', 'No views'));
    } else {
      var built = LD.buildView(view, ctx, window.innerWidth);
      state.columns = built.columns || null;
      frag.appendChild(built.el);
    }
    ctx.refreshAll();
    LD.clear(appEl);
    appEl.appendChild(frag);
    document.title = (view && view.title ? view.title + ' – ' : '') + (state.lovelace.title || boot.title || 'Home Assistant');
  }

  function subscribeEntities(ids) {
    if (state.unsubEntities) state.unsubEntities();
    state.entityIds = ids;
    var first = true;
    return new Promise(function (resolve) {
      state.unsubEntities = state.conn.subscribe({ type: 'subscribe_entities', entity_ids: ids }, function (ev) {
        state.store.apply(ev);
        if (first) {
          first = false;
          resolve();
        }
      });
    });
  }

  function loadLovelace() {
    var msg = { type: 'lovelace/config', force: false };
    if (boot.urlPath) msg.url_path = boot.urlPath;
    return state.conn.call(msg).then(function (cfg) {
      if (cfg && cfg.strategy) throw new Error('This dashboard is auto-generated (strategy). Take control of it in Home Assistant to use the Lite view.');
      state.lovelace = cfg || { views: [] };
      return extractEntityIds(state.lovelace);
    });
  }

  function reloadDashboard() {
    return loadLovelace().then(function (ids) {
      var same = ids.length === state.entityIds.length && ids.every(function (id) { return state.entityIds.indexOf(id) !== -1; });
      var ready = same ? Promise.resolve() : state.hass.load(ids).then(function () { return subscribeEntities(ids); });
      return ready.then(function () {
        state.viewIndex = viewFromLocation();
        render();
      });
    }).catch(function (e) {
      showError(String((e && e.message) || e));
    });
  }

  function start() {
    showStatus(LD.t('connecting'));
    LD.getAuth()
      .then(function (auth) {
        var conn = (state.conn = new LD.Connection(auth));
        conn.on('disconnected', function () { showStatus(LD.t('reconnecting')); });
        conn.on('ready', function () { showStatus(''); });
        return conn.connect();
      })
      .then(function () {
        state.store = new LD.Store();
        state.hass = new LD.Hass(state.conn, state.store);
        state.store.onChange(function (ids) { if (state.ctx) state.ctx.onStates(ids); });
        return Promise.all([loadLovelace(), state.conn.call({ type: 'frontend/get_themes' }).catch(function () { return null; })]);
      })
      .then(function (r) {
        state.themes = r[1];
        var ids = r[0];
        return state.hass.load(ids).then(function () { return subscribeEntities(ids); });
      })
      .then(function () {
        state.viewIndex = viewFromLocation();
        render();
        showStatus('');
        state.conn.subscribe({ type: 'subscribe_events', event_type: 'lovelace_updated' }, function (ev) {
          var p = ev && ev.data && ev.data.url_path;
          if ((p || null) === (boot.urlPath || null)) reloadDashboard();
        });
        state.conn.subscribe({ type: 'subscribe_events', event_type: 'themes_updated' }, function () {
          state.conn.call({ type: 'frontend/get_themes' }).then(function (t) {
            state.themes = t;
            render();
          });
        });
      })
      .catch(function (e) {
        console.error('[lite-dashboard]', e);
        showStatus('');
        showError(String((e && (e.message || e.code)) || e));
      });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!state.ctx || !state.lovelace) return;
      var view = (state.lovelace.views || [])[state.viewIndex];
      /* column count / masonry distribution depend on the width: rebuild (rare on a wall panel) */
      if (view && window.innerWidth !== state.width) {
        state.width = window.innerWidth;
        render();
        return;
      }
      state.ctx.onScreen();
    }, 250);
  });

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { if (state.lovelace) render(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.conn) state.conn.reconnectNow();
  });

  /* touch devices: no text selection, no callout, no double-tap zoom */
  document.documentElement.classList.add('ld-root');
  if (boot.title) document.title = boot.title;
  start();
})();
