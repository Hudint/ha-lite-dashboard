/* Lite Dashboard - entity helpers: names, icons, state formatting, services. */
(function () {
  'use strict';
  var LD = window.LD;

  var OFF_STATES = { unavailable: 1, unknown: 1, off: 1 };

  LD.domain = function (id) {
    return id ? id.split('.')[0] : '';
  };

  /* Mirrors stateActive() from the HA frontend. */
  LD.stateActive = function (st, state) {
    if (!st) return false;
    var s = state === undefined ? st.state : state;
    var d = LD.domain(st.entity_id);
    if (s === 'unavailable' || s === 'unknown') return false;
    if (s === 'off' && d !== 'alert') return false;
    switch (d) {
      case 'alarm_control_panel': return s !== 'disarmed';
      case 'alert': return s !== 'idle';
      case 'cover': return s !== 'closed';
      case 'valve': return s !== 'closed';
      case 'device_tracker':
      case 'person': return s !== 'not_home';
      case 'lawn_mower': return s === 'mowing' || s === 'error';
      case 'lock': return s !== 'locked';
      case 'media_player': return s !== 'standby';
      case 'vacuum': return s !== 'idle' && s !== 'docked' && s !== 'paused';
      case 'plant': return s === 'problem';
      case 'group': return ['on', 'home', 'open', 'locked', 'problem'].indexOf(s) !== -1;
      case 'timer': return s === 'active';
      case 'camera': return s === 'streaming';
    }
    return true;
  };

  LD.isUnavailable = function (st) {
    return !st || st.state === 'unavailable';
  };

  var TOGGLE_DOMAINS = {
    automation: 1, climate: 1, cover: 1, fan: 1, group: 1, humidifier: 1, input_boolean: 1, light: 1,
    lock: 1, media_player: 1, remote: 1, script: 1, siren: 1, switch: 1, valve: 1, water_heater: 1,
  };
  LD.canToggle = function (id) {
    return !!TOGGLE_DOMAINS[LD.domain(id)];
  };

  function Hass(conn, store) {
    this.conn = conn;
    this.store = store;
    this.config = {};
    this.user = null;
    this.translations = {};
    this.icons = {}; /* entity_component icons from frontend/get_icons */
    this.entityIcons = {}; /* platform -> entity icons by translation key */
    this.registry = {}; /* entity_id -> display entry */
  }

  Hass.prototype.state = function (id) {
    return this.store.get(id);
  };

  /* Object shaped like hass.states for templates. */
  Hass.prototype.statesProxy = function () {
    return this.store.states;
  };

  Hass.prototype.load = function (entityIds) {
    var self = this;
    var c = this.conn;
    var domains = {};
    entityIds.forEach(function (id) { domains[LD.domain(id)] = 1; });
    return Promise.all([
      c.call({ type: 'get_config' }),
      c.call({ type: 'auth/current_user' }),
      c.call({ type: 'frontend/get_user_data', key: 'language' }).catch(function () { return null; }),
      c.call({ type: 'frontend/get_icons', category: 'entity_component' }).catch(function () { return { resources: {} }; }),
      c.call({ type: 'config/entity_registry/list_for_display' }).catch(function () { return { entities: [] }; }),
    ]).then(function (r) {
      self.config = r[0];
      self.user = r[1];
      var userLang = r[2] && r[2].value && r[2].value.language;
      /* same order as the HA frontend: profile setting, then browser language */
      LD.lang = new URLSearchParams(location.search).get('lang') || userLang || LD.storage.get('selectedLanguage', null) ||
        navigator.language || self.config.language || 'en';
      /* HA translation files use base codes except for a few regional variants */
      var variants = ['en-GB', 'pt-BR', 'zh-Hans', 'zh-Hant', 'sr-Latn', 'es-419', 'fr-CA'];
      if (variants.indexOf(LD.lang) === -1) LD.lang = LD.lang.split('-')[0];
      self.icons = r[3].resources || {};
      var platforms = {};
      (r[4].entities || []).forEach(function (e) {
        if (entityIds.indexOf(e.ei) === -1) return;
        self.registry[e.ei] = e;
        if (e.pl) platforms[e.pl] = 1;
      });
      var integrations = Object.keys(domains).concat(Object.keys(platforms));
      return Promise.all([
        c.call({ type: 'frontend/get_translations', language: LD.lang, category: 'entity_component', integration: Object.keys(domains) }).catch(function () { return { resources: {} }; }),
        c.call({ type: 'frontend/get_translations', language: LD.lang, category: 'entity', integration: integrations }).catch(function () { return { resources: {} }; }),
        Object.keys(platforms).length
          ? c.call({ type: 'frontend/get_icons', category: 'entity', integration: Object.keys(platforms) }).catch(function () { return { resources: {} }; })
          : Promise.resolve({ resources: {} }),
      ]);
    }).then(function (r) {
      self.translations = Object.assign({}, r[0].resources, r[1].resources);
      self.entityIcons = r[2].resources || {};
    });
  };

  Hass.prototype.tr = function (key) {
    return this.translations[key];
  };

  Hass.prototype.entityName = function (st, fallbackId) {
    if (!st) return fallbackId || '';
    if (st.attributes.friendly_name) return st.attributes.friendly_name;
    return st.entity_id.split('.')[1].replace(/_/g, ' ');
  };

  Hass.prototype.formatState = function (st, state) {
    if (!st) return LD.t('unavailable');
    var s = state === undefined ? st.state : state;
    if (s === 'unavailable') return LD.t('unavailable');
    if (s === 'unknown') return LD.t('unknown');
    var d = LD.domain(st.entity_id);
    var a = st.attributes;
    var reg = this.registry[st.entity_id];

    if ((d === 'sensor' || d === 'number' || d === 'input_number') && s !== '' && isFinite(Number(s))) {
      var precision = reg && reg.dp !== undefined ? reg.dp : undefined;
      var num = LD.formatNumber(s, precision);
      var unit = a.unit_of_measurement;
      if (!unit) return num;
      return unit === '%' ? num + ' %' : num + ' ' + unit;
    }
    if (d === 'sensor' && a.device_class === 'timestamp') return LD.relativeTime(s);

    if (reg && reg.tk && reg.pl) {
      var tk = this.tr('component.' + reg.pl + '.entity.' + d + '.' + reg.tk + '.state.' + s);
      if (tk) return tk;
    }
    var dc = a.device_class || '_';
    return (
      this.tr('component.' + d + '.entity_component.' + dc + '.state.' + s) ||
      this.tr('component.' + d + '.entity_component._.state.' + s) ||
      s
    );
  };

  Hass.prototype.formatAttr = function (st, attr, value) {
    if (!st) return '';
    var v = value === undefined ? st.attributes[attr] : value;
    if (v === undefined || v === null) return '';
    var d = LD.domain(st.entity_id);
    if (typeof v === 'number') {
      var unit = '';
      if (attr === 'current_temperature' || attr === 'temperature' || attr === 'target_temp_low' || attr === 'target_temp_high')
        unit = ' ' + ((this.config.unit_system && this.config.unit_system.temperature) || '°C');
      else if (attr === 'current_humidity' || attr === 'humidity') unit = ' %';
      else if (attr === 'brightness') return Math.round((v / 255) * 100) + ' %';
      return LD.formatNumber(v) + unit;
    }
    var tr = this.tr('component.' + d + '.entity_component._.state_attributes.' + attr + '.state.' + v);
    return tr || String(v);
  };

  Hass.prototype.attrName = function (st, attr) {
    var d = LD.domain(st.entity_id);
    return this.tr('component.' + d + '.entity_component._.state_attributes.' + attr + '.name') || attr.replace(/_/g, ' ');
  };

  /* Icon resolution order matches HA: entity icon attribute, registry icon,
   * translation-key icon of the integration, then the domain/device_class default. */
  Hass.prototype.entityIcon = function (st, state) {
    if (!st) return 'mdi:help-circle-outline';
    var s = state === undefined ? st.state : state;
    if (st.attributes.icon) return st.attributes.icon;
    var reg = this.registry[st.entity_id];
    if (reg && reg.ic) return reg.ic;
    var d = LD.domain(st.entity_id);
    if (reg && reg.tk && reg.pl) {
      var ti = LD.get(this.entityIcons, reg.pl + '.' + d + '.' + reg.tk);
      if (ti) {
        var si = ti.state && ti.state[s];
        if (si) return si;
        if (ti['default']) return ti['default'];
      }
    }
    var comp = this.icons[d];
    if (comp) {
      var dc = st.attributes.device_class;
      var entry = (dc && comp[dc]) || comp._;
      if (entry) {
        if (entry.state && entry.state[s]) return entry.state[s];
        if (entry.range && isFinite(Number(s))) {
          var keys = Object.keys(entry.range).map(Number).sort(function (x, y) { return x - y; });
          var pick = null;
          keys.forEach(function (k) { if (Number(s) >= k) pick = k; });
          if (pick !== null) return entry.range[String(pick)];
        }
        if (entry['default']) return entry['default'];
      }
    }
    if (d === 'weather') return 'mdi:weather-' + s;
    var fallback = {
      zone: 'mdi:map-marker-radius', person: 'mdi:account', sun: 'mdi:white-balance-sunny',
      scene: 'mdi:palette', script: 'mdi:script-text', automation: 'mdi:robot',
    };
    return fallback[d] || 'mdi:bookmark';
  };

  /* ------------------------------------------------------------- services */

  Hass.prototype.callService = function (domain, service, data, target) {
    var msg = { type: 'call_service', domain: domain, service: service, service_data: data || {} };
    if (target && Object.keys(target).length) msg.target = target;
    return this.conn.call(msg).catch(function (err) {
      console.error('[lite-dashboard] service call failed', domain + '.' + service, err);
      LD.toast((err && err.message) || 'Error');
      throw err;
    });
  };

  Hass.prototype.toggle = function (id) {
    var st = this.state(id);
    var d = LD.domain(id);
    var on = LD.stateActive(st);
    var service;
    var expected;
    if (d === 'lock') {
      service = on ? 'lock' : 'unlock';
      expected = on ? 'locked' : 'unlocked';
    } else if (d === 'cover') {
      service = 'toggle';
      expected = on ? 'closed' : 'open';
    } else if (d === 'scene') {
      return this.callService('scene', 'turn_on', { entity_id: id });
    } else if (d === 'button' || d === 'input_button') {
      return this.callService(d, 'press', { entity_id: id });
    } else if (d === 'group') {
      return this.callService('homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: id });
    } else {
      service = on ? 'turn_off' : 'turn_on';
      if (st && (st.state === 'on' || st.state === 'off')) expected = on ? 'off' : 'on';
    }
    if (expected && st && d !== 'script') this.store.setOptimistic(id, expected);
    return this.callService(d, service, { entity_id: id }).catch(function () {});
  };

  LD.Hass = Hass;

  /* --------------------------------------------------------------- icons
   * Icons are fetched in one batched request from the integration and
   * cached in localStorage, so after the first load no icon requests happen. */

  var ICON_CACHE_KEY = 'liteDashboardIcons';
  var iconCache = LD.storage.get(ICON_CACHE_KEY, {});
  var iconWaiting = {}; /* name -> [svg elements] */
  var iconTimer = null;
  var saveTimer = null;

  function flushIcons() {
    iconTimer = null;
    var names = Object.keys(iconWaiting).filter(function (n) { return !iconWaiting[n].requested; });
    if (!names.length) return;
    names.forEach(function (n) { iconWaiting[n].requested = true; });
    fetch((LD.boot.iconsUrl || '/api/lite_dashboard/icons') + '?names=' + encodeURIComponent(names.join(',')))
      .then(function (r) { return r.json(); })
      .then(function (map) {
        Object.keys(map).forEach(function (name) {
          iconCache[name] = map[name] || '';
          var els = iconWaiting[name] || [];
          delete iconWaiting[name];
          els.forEach(function (svg) {
            if (svg.__icon === name) setPath(svg, iconCache[name]);
          });
        });
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { LD.storage.set(ICON_CACHE_KEY, iconCache); }, 2000);
      })
      .catch(function () {
        names.forEach(function (n) { if (iconWaiting[n]) iconWaiting[n].requested = false; });
      });
  }

  function setPath(svg, d) {
    var path = svg.firstChild;
    if (path.getAttribute('d') !== d) path.setAttribute('d', d || '');
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  LD.icon = function (name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ld-icon' + (cls ? ' ' + cls : ''));
    svg.appendChild(document.createElementNS(SVG_NS, 'path'));
    if (name) LD.setIcon(svg, name);
    return svg;
  };
  LD.setIcon = function (svg, name) {
    if (name && name.indexOf('hass:') === 0) name = 'mdi:' + name.slice(5);
    if (svg.__icon === name) return;
    svg.__icon = name;
    if (!name) return setPath(svg, '');
    if (iconCache[name] !== undefined) return setPath(svg, iconCache[name]);
    (iconWaiting[name] = iconWaiting[name] || []).push(svg);
    if (!iconTimer) iconTimer = setTimeout(flushIcons, 0);
  };

  /* small notification at the bottom */
  var toastEl = null;
  var toastTimer = null;
  LD.toast = function (text) {
    if (!toastEl) {
      toastEl = LD.h('div', 'ld-toast');
      document.body.appendChild(toastEl);
    }
    LD.setText(toastEl, text);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  };
})();
