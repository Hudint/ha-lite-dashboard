/* Lite Dashboard - base helpers.
 * Written in ES2017 without optional chaining / nullish coalescing so that
 * old Android WebViews (wall panels) can run it without a build step. */
(function () {
  'use strict';
  var LD = (window.LD = window.LD || {});

  LD.boot = window.LITE_DASHBOARD || {};

  /* ---------- DOM ---------- */
  LD.h = function (tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  };
  LD.setText = function (el, text) {
    text = text === undefined || text === null ? '' : String(text);
    if (el.textContent !== text) el.textContent = text;
  };
  LD.setClass = function (el, cls, on) {
    if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
  };
  /* Remember what we wrote: reading styles back returns normalized values
   * (#hex -> rgb()), which would make every update look like a change. */
  LD.setStyle = function (el, prop, value) {
    value = value === undefined || value === null ? '' : String(value);
    var cache = el.__ldStyle || (el.__ldStyle = {});
    if (cache[prop] === value) return;
    cache[prop] = value;
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
  };
  LD.clear = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  };

  /* One requestAnimationFrame for all pending DOM work. */
  var queue = [];
  var queued = false;
  LD.schedule = function (fn) {
    queue.push(fn);
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      var jobs = queue;
      queue = [];
      queued = false;
      for (var i = 0; i < jobs.length; i++) {
        try {
          jobs[i]();
        } catch (e) {
          console.error('[lite-dashboard]', e);
        }
      }
    });
  };

  LD.get = function (obj, path, fallback) {
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (obj === null || obj === undefined) return fallback;
      obj = obj[parts[i]];
    }
    return obj === undefined || obj === null ? fallback : obj;
  };
  LD.def = function (value, fallback) {
    return value === undefined || value === null ? fallback : value;
  };
  LD.asArray = function (v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  };

  LD.storage = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        if (value === undefined) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage full or blocked: ignore */
      }
    },
  };

  /* ---------- colors (same names and fallbacks as the HA frontend) ---------- */
  var NAMED = {
    primary: 'var(--primary-color)',
    accent: 'var(--accent-color)',
    red: '#f44336',
    pink: '#e91e63',
    purple: '#926bc7',
    'deep-purple': '#6e41ab',
    indigo: '#3f51b5',
    blue: '#2196f3',
    'light-blue': '#03a9f4',
    cyan: '#00bcd4',
    teal: '#009688',
    green: '#4caf50',
    'light-green': '#8bc34a',
    lime: '#cddc39',
    yellow: '#ffeb3b',
    amber: '#ffc107',
    orange: '#ff9800',
    'deep-orange': '#ff6f22',
    brown: '#795548',
    'light-grey': '#bdbdbd',
    grey: '#9e9e9e',
    'dark-grey': '#606060',
    'blue-grey': '#607d8b',
    black: '#000000',
    white: '#ffffff',
    disabled: '#bdbdbd',
  };
  LD.color = function (name) {
    if (!name || name === 'state' || name === 'none') return null;
    if (name.charAt(0) === '#' || name.indexOf('(') !== -1) return name;
    if (NAMED[name]) {
      if (name === 'primary' || name === 'accent') return NAMED[name];
      return 'var(--' + name + '-color, ' + NAMED[name] + ')';
    }
    return name;
  };

  /* Default "active" color per domain/state, like HA's --state-*-color vars. */
  LD.stateColor = function (st) {
    if (!st) return null;
    var domain = st.entity_id.split('.')[0];
    var s = st.state;
    if (domain === 'climate') {
      var mode = {
        heat: 'deep-orange',
        cool: 'blue',
        heat_cool: 'amber',
        auto: 'green',
        dry: 'orange',
        fan_only: 'cyan',
      }[s];
      return mode ? LD.color(mode) : null;
    }
    if (domain === 'light' || domain === 'switch' || domain === 'input_boolean' || domain === 'fan')
      return 'var(--state-' + domain + '-active-color, var(--state-active-color, ' + NAMED.amber + '))';
    if (domain === 'lock') return s === 'unlocked' ? LD.color('red') : LD.color('green');
    if (domain === 'cover' || domain === 'valve') return LD.color('purple');
    if (domain === 'person' || domain === 'device_tracker') return LD.color('blue');
    if (domain === 'alarm_control_panel') return LD.color('red');
    if (domain === 'sun') return s === 'above_horizon' ? LD.color('amber') : LD.color('indigo');
    return 'var(--state-active-color, ' + NAMED.amber + ')';
  };

  /* ---------- tiny i18n for UI chrome (entity states come from HA) ---------- */
  var STRINGS = {
    en: {
      unavailable: 'Unavailable',
      unknown: 'Unknown',
      on: 'On',
      off: 'Off',
      connecting: 'Connecting…',
      reconnecting: 'Connection lost, reconnecting…',
      cancel: 'Cancel',
      ok: 'OK',
      confirm_action: 'Are you sure?',
      enter_pin: 'Enter PIN',
      wrong_pin: 'Wrong PIN',
      blocked: 'This card is blocked.',
      unsupported: 'Card type not supported in Lite view',
      brightness: 'Brightness',
      color_temp: 'Color temperature',
      color: 'Color',
      target: 'Target',
      current: 'Current',
      mode: 'Mode',
      preset: 'Preset',
      humidity: 'Humidity',
      last_changed: 'Last changed',
      run: 'Run',
      open: 'Open',
      close: 'Close',
      stop: 'Stop',
      position: 'Position',
      lock: 'Lock',
      unlock: 'Unlock',
      press: 'Press',
      attributes: 'Attributes',
      now: 'now',
      ago: 'ago',
      in: 'in',
      sec: 's',
      min: 'min',
      hour: 'h',
      day: 'd',
      login_failed: 'Login failed',
      no_forecast: 'No forecast',
    },
    de: {
      unavailable: 'Nicht verfügbar',
      unknown: 'Unbekannt',
      on: 'An',
      off: 'Aus',
      connecting: 'Verbinde…',
      reconnecting: 'Verbindung verloren, verbinde neu…',
      cancel: 'Abbrechen',
      ok: 'OK',
      confirm_action: 'Bist du sicher?',
      enter_pin: 'PIN eingeben',
      wrong_pin: 'Falsche PIN',
      blocked: 'Diese Karte ist gesperrt.',
      unsupported: 'Kartentyp in der Lite-Ansicht nicht unterstützt',
      brightness: 'Helligkeit',
      color_temp: 'Farbtemperatur',
      color: 'Farbe',
      target: 'Soll',
      current: 'Ist',
      mode: 'Modus',
      preset: 'Voreinstellung',
      humidity: 'Luftfeuchtigkeit',
      last_changed: 'Zuletzt geändert',
      run: 'Ausführen',
      open: 'Öffnen',
      close: 'Schließen',
      stop: 'Stopp',
      position: 'Position',
      lock: 'Verriegeln',
      unlock: 'Entriegeln',
      press: 'Drücken',
      attributes: 'Attribute',
      now: 'jetzt',
      ago: 'vor',
      in: 'in',
      sec: 's',
      min: 'Min.',
      hour: 'Std.',
      day: 'T.',
      login_failed: 'Anmeldung fehlgeschlagen',
      no_forecast: 'Keine Vorhersage',
    },
  };
  LD.lang = 'en';
  LD.t = function (key) {
    var base = LD.lang.split('-')[0];
    var table = STRINGS[base] || STRINGS.en;
    return table[key] || STRINGS.en[key] || key;
  };

  /* ---------- number / time formatting ---------- */
  var nfCache = {};
  LD.formatNumber = function (value, decimals) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    var key = LD.lang + '|' + decimals;
    var nf = nfCache[key];
    if (!nf) {
      var opts = {};
      if (decimals !== undefined && decimals !== null) {
        opts.minimumFractionDigits = decimals;
        opts.maximumFractionDigits = decimals;
      } else {
        opts.maximumFractionDigits = 10;
      }
      try {
        nf = new Intl.NumberFormat(LD.lang, opts);
      } catch (e) {
        nf = { format: function (x) { return String(x); } };
      }
      nfCache[key] = nf;
    }
    return nf.format(n);
  };

  LD.relativeTime = function (iso) {
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var diff = Math.round((t - Date.now()) / 1000);
    var abs = Math.abs(diff);
    var value;
    var unit;
    if (abs < 45) return LD.t('now');
    if (abs < 3600) {
      value = Math.round(abs / 60);
      unit = 'minute';
    } else if (abs < 86400) {
      value = Math.round(abs / 3600);
      unit = 'hour';
    } else {
      value = Math.round(abs / 86400);
      unit = 'day';
    }
    try {
      return new Intl.RelativeTimeFormat(LD.lang, { numeric: 'auto' }).format(diff < 0 ? -value : value, unit);
    } catch (e) {
      var short = { minute: 'min', hour: 'hour', day: 'day' }[unit];
      return diff < 0 ? LD.t('ago') + ' ' + value + ' ' + LD.t(short) : LD.t('in') + ' ' + value + ' ' + LD.t(short);
    }
  };

  LD.formatTime = function (iso, opts) {
    var d = new Date(iso);
    try {
      return d.toLocaleTimeString(LD.lang, opts || { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toTimeString().slice(0, 5);
    }
  };
  LD.formatWeekday = function (iso) {
    var d = new Date(iso);
    try {
      return d.toLocaleDateString(LD.lang, { weekday: 'short' });
    } catch (e) {
      return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.getDay()];
    }
  };

  /* ---------- JS templates "[[[ ... ]]]" (button-card style) ---------- */
  var tplCache = {};
  LD.isTemplate = function (v) {
    return typeof v === 'string' && /^\s*\[\[\[[\s\S]*\]\]\]\s*$/.test(v);
  };
  LD.evalTemplate = function (v, vars) {
    if (!LD.isTemplate(v)) return v;
    var body = v.trim().slice(3, -3);
    var fn = tplCache[body];
    if (!fn) {
      try {
        fn = tplCache[body] = new Function('states', 'entity', 'user', 'hass', 'variables', 'html', "'use strict';" + body);
      } catch (e) {
        console.warn('[lite-dashboard] template syntax error', e);
        return '';
      }
    }
    try {
      var html = function (strings) {
        var out = strings[0];
        for (var i = 1; i < arguments.length; i++) out += arguments[i] + strings[i];
        return out;
      };
      return fn(vars.states, vars.entity, vars.user, vars.hass, vars.variables || {}, html);
    } catch (e) {
      console.warn('[lite-dashboard] template error', e);
      return '';
    }
  };

  /* card_mod: only pick up plain "ha-card { --x: y; ... }" declarations and apply them
   * inline. Anything more complex is ignored (that is where card-mod gets expensive). */
  LD.cardModVars = function (config) {
    var cm = config && config.card_mod;
    if (!cm) return null;
    var style = cm.style;
    if (style && typeof style === 'object') style = style['.'] || '';
    if (typeof style !== 'string') return null;
    var m = /(?:^|\})\s*ha-card\s*\{([^}]*)\}/.exec(style);
    if (!m) return null;
    var out = {};
    m[1].split(';').forEach(function (decl) {
      var idx = decl.indexOf(':');
      if (idx < 0) return;
      var prop = decl.slice(0, idx).trim();
      var val = decl.slice(idx + 1).replace(/!important/, '').trim();
      if (prop.indexOf('--') === 0 && val) out[prop] = val;
    });
    return out;
  };
})();
