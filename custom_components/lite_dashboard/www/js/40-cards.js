/* Lite Dashboard - built-in lovelace cards rendered with plain DOM.
 *
 * A card is a plain object: {el, deps, update(), grid}
 *  - el:     root element
 *  - deps:   entity ids whose changes call update()
 *  - update: re-reads states and patches only what changed
 *  - grid:   default sizing in the sections grid (same values as the HA cards) */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;

  LD.cardTypes = {};

  LD.createCard = function (config, ctx) {
    if (!config || typeof config !== 'object') config = { type: 'unsupported' };
    var type = config.type || 'entities';
    var factory = LD.cardTypes[type];
    if (!factory && type.indexOf('custom:') === 0) factory = LD.cardTypes['custom:fallback'];
    if (!factory) factory = LD.cardTypes.unsupported;
    var card;
    try {
      card = factory(config, ctx);
    } catch (e) {
      console.error('[lite-dashboard] card failed', config, e);
      card = LD.cardTypes.unsupported(config, ctx, String(e && e.message));
    }
    card.config = config;
    card.type = type;
    card.deps = card.deps || [];
    var vars = LD.cardModVars(config);
    if (vars) Object.keys(vars).forEach(function (k) { card.el.style.setProperty(k, vars[k]); });
    ctx.watch(card);
    return card;
  };

  /* Resolve sizing like computeCardGridSize() in the HA frontend. */
  LD.cardGrid = function (card) {
    var base = card.grid || { columns: 12, rows: 'auto' };
    var cfg = card.config.grid_options;
    var legacy = card.config.layout_options;
    var opts = Object.assign({}, base);
    if (legacy) {
      if (legacy.grid_columns !== undefined) opts.columns = legacy.grid_columns === 'full' ? 'full' : legacy.grid_columns * 3;
      if (legacy.grid_rows !== undefined) opts.rows = legacy.grid_rows;
    }
    if (cfg) {
      if (cfg.columns !== undefined) opts.columns = cfg.columns;
      if (cfg.rows !== undefined) opts.rows = cfg.rows;
    }
    function clamp(v, min, max) {
      if (typeof v !== 'number') return v;
      if (min !== undefined && v < min) v = min;
      if (max !== undefined && v > max) v = max;
      return v;
    }
    return {
      columns: clamp(opts.columns, base.min_columns, base.max_columns),
      rows: clamp(opts.rows, base.min_rows, base.max_rows),
    };
  };

  function templateVars(ctx, st) {
    var hass = ctx.hass;
    return {
      states: hass.store.states,
      entity: st,
      user: hass.user ? { id: hass.user.id, name: hass.user.name, is_admin: hass.user.is_admin } : {},
      hass: {
        states: hass.store.states,
        user: hass.user,
        language: LD.lang,
        config: hass.config,
        formatEntityState: function (s) { return hass.formatState(s); },
        localize: function (k) { return k; },
      },
    };
  }
  LD.templateVars = templateVars;
  /* Card "name": plain string, JS template, or (newer HA) an object/list
   * describing entity/device/area parts; objects fall back to the entity name. */
  LD.cardName = function (ctx, name, st, fallbackId) {
    var v = LD.tpl(ctx, name, st);
    if (v === undefined || v === null || v === '' || typeof v === 'object') return ctx.hass.entityName(st, fallbackId);
    return String(v);
  };

  LD.tpl = function (ctx, value, st, variables) {
    if (!LD.isTemplate(value)) return value;
    var v = templateVars(ctx, st);
    v.variables = variables;
    return LD.evalTemplate(value, v);
  };

  /* ------------------------------------------------------------ helpers */

  function cardShell(cls) {
    return h('div', 'ld-card' + (cls ? ' ' + cls : ''));
  }

  LD.iconBox = function (cls) {
    var box = h('div', 'ld-icon-box' + (cls ? ' ' + cls : ''));
    var svg = LD.icon(null);
    box.appendChild(svg);
    box.__svg = svg;
    return box;
  };

  /* Set an icon box to an mdi icon or an image. */
  LD.setIconBox = function (box, icon, image) {
    if (image) {
      if (!box.__img) {
        box.__img = h('img', 'ld-icon-img');
        box.__img.alt = '';
        box.appendChild(box.__img);
      }
      if (box.__img.getAttribute('src') !== image) box.__img.setAttribute('src', image);
      box.__img.style.display = '';
      box.__svg.style.display = 'none';
    } else {
      if (box.__img) box.__img.style.display = 'none';
      box.__svg.style.display = '';
      LD.setIcon(box.__svg, icon);
    }
  };

  /* Color for an entity given a card "color" option (default: by state). */
  LD.activeColor = function (st, color) {
    if (color && color !== 'state') return LD.color(color);
    return LD.stateColor(st);
  };

  function stateContent(ctx, st, content) {
    var hass = ctx.hass;
    var items = LD.asArray(content);
    if (!items.length) {
      var d = LD.domain(st.entity_id);
      items = ['state'];
      if (d === 'light' && st.state === 'on' && st.attributes.brightness) items.push('brightness');
      if (d === 'climate' && st.attributes.current_temperature !== undefined) items.push('current_temperature');
      if ((d === 'cover' || d === 'valve') && st.attributes.current_position !== undefined && st.state === 'open') items.push('current_position');
    }
    return items
      .map(function (item) {
        if (item === 'state') return hass.formatState(st);
        if (item === 'last_changed' || item === 'last-changed') return LD.relativeTime(st.last_changed);
        if (item === 'last_updated' || item === 'last-updated') return LD.relativeTime(st.last_updated);
        if (item === 'current_position') return st.attributes.current_position + ' %';
        return hass.formatAttr(st, item);
      })
      .filter(function (s) { return s !== ''; })
      .join(' · ');
  }
  LD.stateContent = stateContent;

  function unavailableClass(el, st) {
    LD.setClass(el, 'ld-unavailable', !st || st.state === 'unavailable');
  }

  /* ---------------------------------------------------------- features */

  var TOGGLE_ICONS = {
    light: ['mdi:lightbulb', 'mdi:lightbulb-off'],
    fan: ['mdi:fan', 'mdi:fan-off'],
  };

  function buildFeature(fc, ctx, entityId, colorFn) {
    var hass = ctx.hass;
    var type = fc.type;
    var el = h('div', 'ld-feature ld-feature-' + type);
    el.setAttribute('data-ld-stop', '');
    var update = function () {};

    if (type === 'toggle') {
      var sw = h('div', 'ld-switch');
      var bg = h('div', 'ld-switch-bg');
      var knob = h('div', 'ld-switch-knob');
      var icon = LD.icon(null);
      knob.appendChild(icon);
      sw.appendChild(bg);
      sw.appendChild(knob);
      el.appendChild(sw);
      LD.bindGestures(el, { tap: function () { hass.toggle(entityId); } });
      update = function () {
        var st = hass.state(entityId);
        var on = !!st && st.state === 'on';
        var icons = TOGGLE_ICONS[LD.domain(entityId)] || ['mdi:power', 'mdi:checkbox-blank-circle-outline'];
        LD.setClass(sw, 'on', on);
        LD.setIcon(icon, on ? icons[0] : icons[1]);
        LD.setStyle(sw, '--ld-feature-color', colorFn());
        unavailableClass(el, st);
      };
    } else if (type === 'target-temperature') {
      var minus = h('button', 'ld-step');
      minus.appendChild(LD.icon('mdi:minus'));
      var value = h('div', 'ld-step-value');
      var plus = h('button', 'ld-step');
      plus.appendChild(LD.icon('mdi:plus'));
      el.appendChild(minus);
      el.appendChild(value);
      el.appendChild(plus);
      var pending = null;
      var timer = null;
      var step = function (dir) {
        var st = hass.state(entityId);
        if (!st) return;
        var a = st.attributes;
        var stepSize = a.target_temp_step || (hass.config.unit_system && hass.config.unit_system.temperature === '°F' ? 1 : 0.5);
        var cur = pending !== null ? pending : Number(a.temperature);
        if (!isFinite(cur)) return;
        var next = Math.round((cur + dir * stepSize) / stepSize) * stepSize;
        next = Math.max(a.min_temp !== undefined ? a.min_temp : -Infinity, Math.min(a.max_temp !== undefined ? a.max_temp : Infinity, next));
        pending = Number(next.toFixed(2));
        update();
        clearTimeout(timer);
        timer = setTimeout(function () {
          var t = pending;
          hass.callService(LD.domain(entityId) === 'water_heater' ? 'water_heater' : 'climate', 'set_temperature', { entity_id: entityId, temperature: t })
            .then(function () { setTimeout(function () { pending = null; update(); }, 1500); }, function () { pending = null; update(); });
        }, 800);
      };
      LD.bindGestures(minus, { tap: function () { step(-1); } });
      LD.bindGestures(plus, { tap: function () { step(1); } });
      update = function () {
        var st = hass.state(entityId);
        var t = pending !== null ? pending : st && st.attributes.temperature;
        var stepSize = (st && st.attributes.target_temp_step) || 0.5;
        LD.setText(value, t === undefined || t === null ? '–' : LD.formatNumber(t, stepSize < 1 ? 1 : 0) + ' ' + ((hass.config.unit_system && hass.config.unit_system.temperature) || '°C'));
        unavailableClass(el, st);
      };
    } else if (type === 'light-brightness' || type === 'cover-position' || type === 'fan-speed' || type === 'media-player-volume-slider') {
      var range = h('input', 'ld-range');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      el.appendChild(range);
      range.addEventListener('change', function () {
        var v = Number(range.value);
        if (type === 'light-brightness') hass.callService('light', 'turn_on', { entity_id: entityId, brightness_pct: Math.max(v, 1) });
        else if (type === 'cover-position') hass.callService('cover', 'set_cover_position', { entity_id: entityId, position: v });
        else if (type === 'fan-speed') hass.callService('fan', 'set_percentage', { entity_id: entityId, percentage: v });
        else hass.callService('media_player', 'volume_set', { entity_id: entityId, volume_level: v / 100 });
      });
      update = function () {
        var st = hass.state(entityId);
        if (!st || document.activeElement === range) return;
        var a = st.attributes;
        var v = 0;
        if (type === 'light-brightness') v = st.state === 'on' ? Math.round(((a.brightness || 0) / 255) * 100) : 0;
        else if (type === 'cover-position') v = a.current_position || 0;
        else if (type === 'fan-speed') v = a.percentage || 0;
        else v = Math.round((a.volume_level || 0) * 100);
        if (String(v) !== range.value) range.value = String(v);
        LD.setStyle(range, '--ld-feature-color', colorFn());
        LD.setStyle(range, '--ld-range-pct', v + '%');
        unavailableClass(el, st);
      };
    } else if (type === 'cover-open-close' || type === 'cover-open' || type === 'cover-close') {
      [['open_cover', 'mdi:arrow-up'], ['stop_cover', 'mdi:stop'], ['close_cover', 'mdi:arrow-down']].forEach(function (b) {
        if (type === 'cover-open' && b[0] === 'close_cover') return;
        if (type === 'cover-close' && b[0] === 'open_cover') return;
        var btn = h('button', 'ld-feature-btn');
        btn.appendChild(LD.icon(b[1]));
        LD.bindGestures(btn, { tap: function () { hass.callService('cover', b[0], { entity_id: entityId }); } });
        el.appendChild(btn);
      });
    } else if (type === 'climate-hvac-modes' || type === 'climate-preset-modes') {
      var isHvac = type === 'climate-hvac-modes';
      var buttons = {};
      update = function () {
        var st = hass.state(entityId);
        if (!st) return;
        var modes = fc.hvac_modes || fc.preset_modes || (isHvac ? st.attributes.hvac_modes : st.attributes.preset_modes) || [];
        if (!el.__built) {
          el.__built = true;
          modes.forEach(function (m) {
            var b = h('button', 'ld-feature-btn', isHvac ? null : hass.formatAttr(st, 'preset_mode', m));
            if (isHvac) b.appendChild(LD.icon({ off: 'mdi:power', heat: 'mdi:fire', cool: 'mdi:snowflake', heat_cool: 'mdi:sun-snowflake-variant', auto: 'mdi:thermostat-auto', dry: 'mdi:water-percent', fan_only: 'mdi:fan' }[m] || 'mdi:thermostat'));
            LD.bindGestures(b, {
              tap: function () {
                if (isHvac) hass.callService('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: m });
                else hass.callService('climate', 'set_preset_mode', { entity_id: entityId, preset_mode: m });
              },
            });
            buttons[m] = b;
            el.appendChild(b);
          });
        }
        var current = isHvac ? st.state : st.attributes.preset_mode;
        Object.keys(buttons).forEach(function (m) { LD.setClass(buttons[m], 'on', m === current); });
        LD.setStyle(el, '--ld-feature-color', colorFn());
      };
    } else {
      el.classList.add('ld-feature-unsupported');
    }
    return { el: el, update: update };
  }

  /* --------------------------------------------------------------- tile */

  LD.cardTypes.tile = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var features = (config.features || []).filter(function (f) { return f && f.type; });
    var position = config.features_position || 'bottom';
    var vertical = !!config.vertical;
    var el = cardShell('ld-tile' + (vertical ? ' ld-vertical' : '') + (position === 'inline' ? ' ld-features-inline' : ''));
    var main = h('div', 'ld-tile-main');
    var iconBox = LD.iconBox('ld-tile-icon');
    iconBox.setAttribute('data-ld-stop', '');
    var info = h('div', 'ld-tile-info');
    var name = h('div', 'ld-tile-name');
    var state = h('div', 'ld-tile-state');
    info.appendChild(name);
    info.appendChild(state);
    main.appendChild(iconBox);
    main.appendChild(info);
    el.appendChild(main);

    var color = function () {
      return LD.activeColor(hass.state(id), config.color);
    };
    var feats = features.map(function (f) { return buildFeature(f, ctx, id, color); });
    if (feats.length) {
      var fbox = h('div', 'ld-features');
      feats.forEach(function (f) { fbox.appendChild(f.el); });
      el.appendChild(fbox);
    }

    LD.bindActions(el, ctx, config, id, {
      tap_action: { action: 'more-info' },
    });
    var iconTap = config.icon_tap_action || { action: LD.canToggle(id) ? 'toggle' : 'more-info' };
    LD.bindGestures(iconBox, {
      tap: iconTap.action !== 'none' ? function () { LD.runAction(ctx, iconTap, id); } : null,
      hold: config.icon_hold_action ? function () { LD.runAction(ctx, config.icon_hold_action, id); } : null,
      doubleTap: config.icon_double_tap_action ? function () { LD.runAction(ctx, config.icon_double_tap_action, id); } : null,
    });

    var featureRows = position === 'inline' ? 0 : features.length;
    var rows = 1 + featureRows + (vertical ? 1 : 0);
    return {
      el: el,
      deps: [id],
      grid: { columns: 6, rows: rows, min_columns: position === 'inline' && features.length ? 12 : vertical ? 3 : 6, min_rows: rows },
      naturalRows: rows,
      update: function () {
        var st = hass.state(id);
        var active = LD.stateActive(st);
        LD.setText(name, LD.cardName(ctx, config.name, st, id));
        LD.setText(state, config.hide_state ? '' : st ? stateContent(ctx, st, config.state_content) : LD.t('unavailable'));
        var picture = config.show_entity_picture && st && (st.attributes.entity_picture_local || st.attributes.entity_picture);
        LD.setIconBox(iconBox, config.icon || hass.entityIcon(st), picture);
        LD.setClass(el, 'ld-active', active);
        LD.setStyle(el, '--ld-color', active ? color() : '');
        unavailableClass(el, st);
        feats.forEach(function (f) { f.update(); });
      },
    };
  };

  /* ------------------------------------------------------------ heading */

  LD.cardTypes.heading = function (config, ctx) {
    var hass = ctx.hass;
    var el = cardShell('ld-heading ld-heading-' + (config.heading_style || 'title'));
    var title = h('div', 'ld-heading-title');
    if (config.icon) title.appendChild(LD.icon(config.icon));
    title.appendChild(h('span', null, config.heading || ''));
    el.appendChild(title);
    LD.bindActions(title, ctx, config, null, {});
    var deps = [];
    var badges = [];
    var items = config.badges || config.entities || [];
    if (items.length) {
      var box = h('div', 'ld-heading-badges');
      items.forEach(function (b) {
        if (typeof b === 'string') b = { entity: b };
        var bel = h('div', 'ld-heading-badge');
        var ic = LD.icon(null);
        var tx = h('span');
        bel.appendChild(ic);
        bel.appendChild(tx);
        box.appendChild(bel);
        LD.bindActions(bel, ctx, b, b.entity, { tap_action: { action: 'none' } });
        deps.push(b.entity);
        if (b.visibility) deps = deps.concat(LD.conditionEntities(b.visibility));
        badges.push({ cfg: b, el: bel, icon: ic, text: tx });
      });
      el.appendChild(box);
    }
    return {
      el: el,
      deps: deps,
      grid: { columns: 'full', rows: 'auto' },
      update: function () {
        badges.forEach(function (b) {
          var st = hass.state(b.cfg.entity);
          var visible = !b.cfg.visibility || LD.checkConditions(ctx, b.cfg.visibility);
          b.el.style.display = visible ? '' : 'none';
          if (b.cfg.show_icon !== false) LD.setIcon(b.icon, b.cfg.icon || hass.entityIcon(st));
          var color = b.cfg.color ? LD.activeColor(st, b.cfg.color) : null;
          LD.setStyle(b.icon, 'color', LD.stateActive(st) && color ? color : '');
          LD.setText(b.text, b.cfg.show_state === false ? '' : st ? stateContent(ctx, st, b.cfg.state_content) : '');
        });
      },
    };
  };

  /* ------------------------------------------------------------- button */

  LD.cardTypes.button = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var showName = config.show_name !== false;
    var showIcon = config.show_icon !== false;
    var showState = !!config.show_state;
    var el = cardShell('ld-button-card');
    var iconBox = LD.iconBox('ld-button-icon');
    if (config.icon_height) iconBox.style.height = config.icon_height;
    var name = h('div', 'ld-button-name');
    var state = h('div', 'ld-button-state');
    if (showIcon) el.appendChild(iconBox);
    if (showName) el.appendChild(name);
    if (showState) el.appendChild(state);
    LD.bindActions(el, ctx, config, id, {
      tap_action: { action: id && LD.canToggle(id) ? 'toggle' : 'more-info' },
      hold_action: { action: 'more-info' },
    });
    return {
      el: el,
      deps: id ? [id] : [],
      grid: showIcon && (showName || showState) ? { rows: 2, columns: 6, min_columns: 2, min_rows: 2 } : { rows: 1, columns: 3, min_columns: 2, min_rows: 1 },
      update: function () {
        var st = id ? hass.state(id) : null;
        LD.setText(name, id ? LD.cardName(ctx, config.name, st, id) : LD.tpl(ctx, config.name, st) || '');
        if (showState) LD.setText(state, st ? hass.formatState(st) : '');
        LD.setIconBox(iconBox, config.icon || (st ? hass.entityIcon(st) : 'mdi:gesture-tap-button'), config.show_entity_picture && st && st.attributes.entity_picture);
        var stateColor = config.state_color !== undefined ? config.state_color : !!st && LD.canToggle(id);
        var active = st && LD.stateActive(st);
        LD.setStyle(iconBox, 'color', stateColor && active ? LD.activeColor(st, config.color) : '');
        unavailableClass(el, id ? st : true);
      },
    };
  };

  /* ------------------------------------------------------------- entity */

  LD.cardTypes.entity = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var el = cardShell('ld-entity-card');
    var top = h('div', 'ld-entity-top');
    var name = h('div', 'ld-entity-name');
    var icon = LD.icon(null);
    top.appendChild(name);
    top.appendChild(icon);
    var value = h('div', 'ld-entity-value');
    el.appendChild(top);
    el.appendChild(value);
    LD.bindActions(el, ctx, config, id, { tap_action: { action: 'more-info' } });
    return {
      el: el,
      deps: [id],
      grid: { columns: 6, rows: 2, min_columns: 6, min_rows: 2 },
      update: function () {
        var st = hass.state(id);
        LD.setText(name, LD.cardName(ctx, config.name, st, id));
        LD.setIcon(icon, config.icon || hass.entityIcon(st));
        var text = config.attribute ? hass.formatAttr(st, config.attribute) + (config.unit ? ' ' + config.unit : '') : hass.formatState(st);
        LD.setText(value, text);
        LD.setStyle(icon, 'color', config.state_color && LD.stateActive(st) ? LD.activeColor(st, config.color) : '');
      },
    };
  };
  LD.cardTypes.sensor = LD.cardTypes.entity;
  LD.cardTypes.gauge = LD.cardTypes.entity;
  LD.cardTypes.statistic = LD.cardTypes.entity;

  /* ----------------------------------------------------------- entities */

  function entityRow(rowCfg, ctx, parentCfg) {
    var hass = ctx.hass;
    if (typeof rowCfg === 'string') rowCfg = { entity: rowCfg };
    var type = rowCfg.type;
    if (type === 'divider') return { el: h('div', 'ld-row-divider'), deps: [], update: function () {} };
    if (type === 'section') {
      var sec = h('div', 'ld-row-section', rowCfg.label || '');
      return { el: sec, deps: [], update: function () {} };
    }
    if (type === 'weblink') {
      var a = h('a', 'ld-row');
      a.href = rowCfg.url;
      a.target = rowCfg.new_tab ? '_blank' : '';
      a.appendChild(LD.icon(rowCfg.icon || 'mdi:link'));
      a.appendChild(h('div', 'ld-row-name', rowCfg.name || rowCfg.url));
      return { el: a, deps: [], update: function () {} };
    }
    var id = rowCfg.entity;
    var row = h('div', 'ld-row');
    var icon = LD.iconBox('ld-row-icon');
    var text = h('div', 'ld-row-text');
    var name = h('div', 'ld-row-name');
    var secondary = h('div', 'ld-row-secondary');
    text.appendChild(name);
    text.appendChild(secondary);
    var right = h('div', 'ld-row-right');
    row.appendChild(icon);
    row.appendChild(text);
    row.appendChild(right);
    var d = LD.domain(id);
    var toggle = null;
    var button = null;
    var showToggle = !type && LD.canToggle(id) && d !== 'climate' && d !== 'cover' && d !== 'lock' && d !== 'script' && d !== 'media_player';
    if (showToggle) {
      toggle = h('div', 'ld-mini-switch');
      toggle.setAttribute('data-ld-stop', '');
      right.appendChild(toggle);
      LD.bindGestures(toggle, { tap: function () { hass.toggle(id); } });
    } else if (d === 'script' || d === 'scene' || d === 'button' || d === 'input_button' || type === 'button') {
      button = h('button', 'ld-row-btn', rowCfg.action_name || (d === 'script' || d === 'scene' ? LD.t('run') : LD.t('press')));
      button.setAttribute('data-ld-stop', '');
      right.appendChild(button);
      LD.bindGestures(button, {
        tap: function () {
          if (rowCfg.tap_action) LD.runAction(ctx, rowCfg.tap_action, id);
          else if (d === 'script') hass.callService('script', 'turn_on', { entity_id: id });
          else hass.toggle(id);
        },
      });
    }
    var valueEl = h('div', 'ld-row-value');
    if (!toggle && !button) right.appendChild(valueEl);
    LD.bindActions(row, ctx, rowCfg, id, { tap_action: { action: 'more-info' } });
    var stateColor = rowCfg.state_color !== undefined ? rowCfg.state_color : parentCfg.state_color !== undefined ? parentCfg.state_color : true;
    return {
      el: row,
      deps: [id],
      update: function () {
        var st = hass.state(id);
        LD.setText(name, LD.cardName(ctx, rowCfg.name, st, id));
        LD.setIconBox(icon, rowCfg.icon || hass.entityIcon(st), rowCfg.image || (st && rowCfg.show_entity_picture !== false && d !== 'light' && st.attributes.entity_picture));
        var active = LD.stateActive(st);
        LD.setStyle(icon, 'color', stateColor && active && LD.canToggle(id) ? LD.activeColor(st, rowCfg.color) : '');
        if (toggle) LD.setClass(toggle, 'on', !!st && st.state === 'on');
        var sec = '';
        if (rowCfg.secondary_info === 'last-changed') sec = st ? LD.relativeTime(st.last_changed) : '';
        else if (rowCfg.secondary_info === 'last-updated') sec = st ? LD.relativeTime(st.last_updated) : '';
        else if (rowCfg.secondary_info === 'entity-id') sec = id;
        else if (rowCfg.secondary_info === 'brightness' && st && st.attributes.brightness) sec = Math.round(st.attributes.brightness / 2.55) + ' %';
        LD.setText(secondary, sec);
        if (type === 'attribute') LD.setText(valueEl, (rowCfg.prefix || '') + hass.formatAttr(st, rowCfg.attribute) + (rowCfg.suffix || ''));
        else if (d === 'climate' && st) LD.setText(valueEl, hass.formatState(st) + (st.attributes.temperature !== undefined ? ' · ' + hass.formatAttr(st, 'temperature') : ''));
        else LD.setText(valueEl, hass.formatState(st));
        unavailableClass(row, st);
      },
    };
  }
  LD.entityRow = entityRow;

  LD.cardTypes.entities = function (config, ctx) {
    var el = cardShell('ld-entities');
    if (config.title) {
      var head = h('div', 'ld-card-header');
      if (config.icon) head.appendChild(LD.icon(config.icon));
      head.appendChild(h('span', null, config.title));
      el.appendChild(head);
    }
    var rows = (config.entities || []).map(function (r) { return entityRow(r, ctx, config); });
    var deps = [];
    rows.forEach(function (r) {
      el.appendChild(r.el);
      deps = deps.concat(r.deps);
    });
    return {
      el: el,
      deps: deps,
      grid: { columns: 12, rows: 'auto', min_columns: 3 },
      update: function () { rows.forEach(function (r) { r.update(); }); },
    };
  };

  /* -------------------------------------------------------------- glance */

  LD.cardTypes.glance = function (config, ctx) {
    var hass = ctx.hass;
    var el = cardShell('ld-glance');
    if (config.title) el.appendChild(h('div', 'ld-card-header', config.title));
    var items = (config.entities || []).map(function (e) { return typeof e === 'string' ? { entity: e } : e; });
    var grid = h('div', 'ld-glance-grid');
    grid.style.gridTemplateColumns = 'repeat(' + (config.columns || Math.min(items.length, 5) || 1) + ', minmax(0, 1fr))';
    el.appendChild(grid);
    var cells = items.map(function (it) {
      var cell = h('div', 'ld-glance-item');
      var name = h('div', 'ld-glance-name');
      var icon = LD.iconBox('ld-glance-icon');
      var state = h('div', 'ld-glance-state');
      if (config.show_name !== false && it.show_name !== false) cell.appendChild(name);
      if (config.show_icon !== false && it.show_icon !== false) cell.appendChild(icon);
      if (config.show_state !== false && it.show_state !== false) cell.appendChild(state);
      grid.appendChild(cell);
      LD.bindActions(cell, ctx, it, it.entity, { tap_action: { action: 'more-info' } });
      return { it: it, name: name, icon: icon, state: state };
    });
    return {
      el: el,
      deps: items.map(function (i) { return i.entity; }),
      grid: { columns: 12, rows: 'auto' },
      update: function () {
        cells.forEach(function (c) {
          var st = hass.state(c.it.entity);
          LD.setText(c.name, LD.cardName(ctx, c.it.name, st, c.it.entity));
          LD.setIconBox(c.icon, c.it.icon || hass.entityIcon(st), c.it.image);
          LD.setStyle(c.icon, 'color', config.state_color && LD.stateActive(st) ? LD.activeColor(st, c.it.color) : '');
          LD.setText(c.state, c.it.attribute ? hass.formatAttr(st, c.it.attribute) : hass.formatState(st));
        });
      },
    };
  };

  /* --------------------------------------------- grid / stacks / conditional */

  function childCards(config, ctx) {
    return (config.cards || []).map(function (c) { return LD.createCard(c, ctx); });
  }

  /* Wrap a child card so card-level "visibility" works inside containers too. */
  LD.mountChild = function (parent, card, ctx, extraCls) {
    var wrap = h('div', 'ld-child' + (extraCls ? ' ' + extraCls : ''));
    wrap.appendChild(card.el);
    parent.appendChild(wrap);
    var vis = card.config.visibility;
    if (vis) {
      var apply = function () { wrap.style.display = LD.checkConditions(ctx, vis) ? '' : 'none'; };
      ctx.watchIds(LD.conditionEntities(vis), apply, LD.conditionsUseScreen(vis));
      apply();
    }
    if (card.naturalRows) wrap.style.setProperty('--ld-rows', card.naturalRows);
    return wrap;
  };

  LD.cardTypes.grid = function (config, ctx) {
    var cards = childCards(config, ctx);
    var el = h('div', 'ld-container ld-grid-card' + (config.square ? ' ld-square' : ''));
    if (config.title) el.appendChild(h('div', 'ld-stack-title', config.title));
    var grid = h('div', 'ld-grid-card-grid');
    var cols = config.columns || Math.min(cards.length, 3) || 1;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    el.appendChild(grid);
    cards.forEach(function (c) { LD.mountChild(grid, c, ctx); });
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  LD.cardTypes['vertical-stack'] = function (config, ctx) {
    var cards = childCards(config, ctx);
    var el = h('div', 'ld-container ld-vstack');
    if (config.title) el.appendChild(h('div', 'ld-stack-title', config.title));
    cards.forEach(function (c) { LD.mountChild(el, c, ctx); });
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  LD.cardTypes['horizontal-stack'] = function (config, ctx) {
    var cards = childCards(config, ctx);
    var el = h('div', 'ld-container ld-hstack');
    if (config.title) el.appendChild(h('div', 'ld-stack-title', config.title));
    var row = h('div', 'ld-hstack-row');
    el.appendChild(row);
    cards.forEach(function (c) { LD.mountChild(row, c, ctx); });
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  LD.cardTypes.conditional = function (config, ctx) {
    var inner = LD.createCard(config.card, ctx);
    var el = h('div', 'ld-container ld-conditional');
    el.appendChild(inner.el);
    var conds = config.conditions || [];
    var card = {
      el: el,
      deps: LD.conditionEntities(conds),
      grid: inner.grid,
      naturalRows: inner.naturalRows,
      update: function () {
        var show = LD.checkConditions(ctx, conds);
        el.style.display = show ? '' : 'none';
        if (card.onVisibility) card.onVisibility(show);
      },
      watchScreen: LD.conditionsUseScreen(conds),
    };
    return card;
  };

  /* ------------------------------------------------------------ markdown */

  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
        if (/^\s*javascript:/i.test(u)) return t;
        return '<a href="' + u + '" target="_blank" rel="noreferrer">' + t + '</a>';
      });
  }

  /* Small, safe markdown subset (input is escaped first). */
  LD.markdown = function (src) {
    var esc = String(src).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    /* allow <ha-icon icon="mdi:x"></ha-icon> */
    esc = esc.replace(/&lt;ha-icon icon=(?:"|&quot;)([a-z0-9:-]+)(?:"|&quot;)\s*\/?&gt;(?:&lt;\/ha-icon&gt;)?/g, '<span class="ld-md-icon" data-icon="$1"></span>');
    esc = esc.replace(/&lt;br\s*\/?&gt;/g, '<br>');
    var lines = esc.split('\n');
    var out = [];
    var list = null;
    lines.forEach(function (line) {
      var m;
      if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
        if (list) { out.push('</' + list + '>'); list = null; }
        out.push('<h' + m[1].length + '>' + inlineMd(m[2]) + '</h' + m[1].length + '>');
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        if (list !== 'ul') { if (list) out.push('</' + list + '>'); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inlineMd(m[1]) + '</li>');
      } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
        if (list !== 'ol') { if (list) out.push('</' + list + '>'); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inlineMd(m[1]) + '</li>');
      } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        out.push('<hr>');
      } else {
        if (list) { out.push('</' + list + '>'); list = null; }
        out.push(line.trim() ? inlineMd(line) + '<br>' : '<br>');
      }
    });
    if (list) out.push('</' + list + '>');
    return out.join('').replace(/(<br>)+$/, '');
  };

  LD.renderMarkdownInto = function (el, src) {
    var html = LD.markdown(src);
    if (el.__md === html) return;
    el.__md = html;
    el.innerHTML = html;
    var icons = el.querySelectorAll('.ld-md-icon');
    for (var i = 0; i < icons.length; i++) icons[i].appendChild(LD.icon(icons[i].getAttribute('data-icon')));
  };

  LD.cardTypes.markdown = function (config, ctx) {
    var el = cardShell('ld-markdown' + (config.text_only ? ' ld-text-only' : ''));
    if (config.title) el.appendChild(h('div', 'ld-card-header', config.title));
    var body = h('div', 'ld-markdown-body');
    el.appendChild(body);
    var content = config.content || '';
    if (/\{\{|\{%/.test(content)) {
      ctx.subscribe(
        { type: 'render_template', template: content, strict: false, report_errors: false, variables: { config: config, user: ctx.hass.user ? ctx.hass.user.name : '' } },
        function (ev) {
          if (ev && ev.result !== undefined) LD.renderMarkdownInto(body, String(ev.result));
        }
      );
    } else {
      LD.renderMarkdownInto(body, content);
    }
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  /* ------------------------------------------------------------- picture */

  LD.cardTypes.picture = function (config, ctx) {
    var el = cardShell('ld-picture');
    var img = h('img');
    img.alt = config.alt_text || '';
    img.src = typeof config.image === 'object' && config.image ? config.image.media_content_id : config.image;
    el.appendChild(img);
    LD.bindActions(el, ctx, config, config.entity, { tap_action: { action: 'none' } });
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  LD.cardTypes['picture-entity'] = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var el = cardShell('ld-picture ld-picture-entity');
    var img = h('img');
    el.appendChild(img);
    var bar = h('div', 'ld-picture-bar');
    var name = h('span');
    var state = h('span');
    bar.appendChild(name);
    bar.appendChild(state);
    if (config.show_name !== false || config.show_state !== false) el.appendChild(bar);
    LD.bindActions(el, ctx, config, id, { tap_action: { action: 'more-info' } });
    return {
      el: el,
      deps: [id],
      grid: { columns: 12, rows: 'auto' },
      update: function () {
        var st = hass.state(id);
        var src = config.image || (st && (st.attributes.entity_picture_local || st.attributes.entity_picture)) || '';
        if (config.state_image && st && config.state_image[st.state]) src = config.state_image[st.state];
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        LD.setText(name, config.show_name === false ? '' : LD.cardName(ctx, config.name, st, id));
        LD.setText(state, config.show_state === false ? '' : hass.formatState(st));
      },
    };
  };

  LD.cardTypes['picture-glance'] = function (config, ctx) {
    var hass = ctx.hass;
    var el = cardShell('ld-picture ld-picture-entity');
    var img = h('img');
    el.appendChild(img);
    var bar = h('div', 'ld-picture-bar');
    var title = h('span', null, config.title || '');
    var icons = h('span', 'ld-picture-icons');
    bar.appendChild(title);
    bar.appendChild(icons);
    el.appendChild(bar);
    var items = (config.entities || []).map(function (e) { return typeof e === 'string' ? { entity: e } : e; });
    var els = items.map(function (it) {
      var ic = LD.icon(null);
      var b = h('span', 'ld-picture-icon');
      b.appendChild(ic);
      icons.appendChild(b);
      LD.bindActions(b, ctx, it, it.entity, { tap_action: { action: LD.canToggle(it.entity) ? 'toggle' : 'more-info' } });
      return { it: it, icon: ic };
    });
    LD.bindActions(img, ctx, config, config.entity, { tap_action: { action: config.entity ? 'more-info' : 'none' } });
    return {
      el: el,
      deps: items.map(function (i) { return i.entity; }).concat(config.entity ? [config.entity] : []),
      grid: { columns: 12, rows: 'auto' },
      update: function () {
        var main = config.entity ? hass.state(config.entity) : null;
        var src = config.image || (main && main.attributes.entity_picture) || '';
        if (config.state_image && main && config.state_image[main.state]) src = config.state_image[main.state];
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        els.forEach(function (e) {
          var st = hass.state(e.it.entity);
          LD.setIcon(e.icon, e.it.icon || hass.entityIcon(st));
          LD.setStyle(e.icon, 'color', LD.stateActive(st) && LD.canToggle(e.it.entity) ? LD.activeColor(st) : '');
        });
      },
    };
  };

  LD.cardTypes.iframe = function (config) {
    var el = cardShell('ld-iframe');
    if (config.title) el.appendChild(h('div', 'ld-card-header', config.title));
    var frame = h('iframe');
    frame.src = config.url;
    frame.style.height = config.aspect_ratio ? '' : '400px';
    el.appendChild(frame);
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  /* ---------------------------------------------------------- thermostat
   * Same look as the HA ring, but a static SVG instead of an interactive
   * slider component: changes go through +/- or the more-info dialog. */

  var RING_START = 135;
  var RING_SWEEP = 270;

  function polar(cx, cy, r, deg) {
    var rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    if (a1 - a0 < 0.01) return '';
    var p0 = polar(cx, cy, r, a0);
    var p1 = polar(cx, cy, r, a1);
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) + 'A' + r + ',' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2);
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  var MODE_ICON = { heat: 'mdi:fire', cool: 'mdi:snowflake', heat_cool: 'mdi:sun-snowflake-variant', auto: 'mdi:thermostat-auto', dry: 'mdi:water-percent', fan_only: 'mdi:fan', off: 'mdi:power' };
  var ACTION_COLOR = { heating: 'heat', preheating: 'heat', cooling: 'cool', drying: 'dry', fan: 'fan_only' };

  LD.cardTypes.thermostat = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var el = cardShell('ld-thermostat');
    var title = h('div', 'ld-thermo-title');
    el.appendChild(title);
    var body = h('div', 'ld-thermo-body');
    var svg = svgEl('svg', { viewBox: '0 0 320 320', class: 'ld-thermo-ring' });
    var track = svgEl('path', { class: 'ld-ring-track', d: arcPath(160, 160, 145, RING_START, RING_START + RING_SWEEP) });
    var activeBg = svgEl('path', { class: 'ld-ring-active-bg' });
    var active = svgEl('path', { class: 'ld-ring-active' });
    var curDot = svgEl('circle', { class: 'ld-ring-current', r: '6' });
    var handle = svgEl('circle', { class: 'ld-ring-handle', r: '11' });
    svg.appendChild(track);
    svg.appendChild(activeBg);
    svg.appendChild(active);
    svg.appendChild(curDot);
    svg.appendChild(handle);
    body.appendChild(svg);
    var center = h('div', 'ld-thermo-center');
    var label = h('div', 'ld-thermo-label');
    var big = h('div', 'ld-thermo-big');
    var bigInt = h('span', 'ld-thermo-int');
    var bigSide = h('span', 'ld-thermo-side');
    var bigUnit = h('span', 'ld-thermo-unit');
    var bigDec = h('span', 'ld-thermo-dec');
    bigSide.appendChild(bigUnit);
    bigSide.appendChild(bigDec);
    big.appendChild(bigInt);
    big.appendChild(bigSide);
    var sub = h('div', 'ld-thermo-sub');
    var subIcon = LD.icon(null);
    var subText = h('span');
    sub.appendChild(subIcon);
    sub.appendChild(subText);
    center.appendChild(label);
    center.appendChild(big);
    center.appendChild(sub);
    body.appendChild(center);
    el.appendChild(body);

    var stepper = buildFeature({ type: 'target-temperature' }, ctx, id, function () { return null; });
    stepper.el.classList.add('ld-thermo-stepper');
    el.appendChild(stepper.el);

    LD.bindActions(title, ctx, { tap_action: { action: 'more-info' } }, id);
    var features = (config.features || []).map(function (f) { return buildFeature(f, ctx, id, function () { return LD.stateColor(hass.state(id)); }); });
    features.forEach(function (f) { el.appendChild(f.el); });
    var featureRows = features.length ? Math.ceil((2 * features.length) / 3) : 0;
    var unit = (hass.config.unit_system && hass.config.unit_system.temperature) || '°C';

    return {
      el: el,
      deps: [id],
      grid: { columns: 12, rows: 5 + featureRows, min_columns: 6, min_rows: 2 + featureRows },
      update: function () {
        var st = hass.state(id);
        if (!st) {
          LD.setText(title, id);
          return;
        }
        var a = st.attributes;
        LD.setText(title, LD.cardName(ctx, config.name, st, id));
        var min = a.min_temp !== undefined ? a.min_temp : 7;
        var max = a.max_temp !== undefined ? a.max_temp : 35;
        var target = a.temperature;
        var current = a.current_temperature;
        var mode = st.state;
        var actionMode = a.hvac_action ? ACTION_COLOR[a.hvac_action] : null;
        var modeColor = mode !== 'off' && LD.stateColor(st) ? LD.stateColor(st) : null;
        var angle = function (v) { return RING_START + RING_SWEEP * Math.max(0, Math.min(1, (v - min) / (max - min))); };

        var arc = '';
        if (target !== undefined && target !== null && mode !== 'off') {
          arc = mode === 'cool' ? arcPath(160, 160, 145, angle(target), RING_START + RING_SWEEP) : arcPath(160, 160, 145, RING_START, angle(target));
        }
        if (active.getAttribute('d') !== arc) {
          active.setAttribute('d', arc);
          activeBg.setAttribute('d', arc);
        }
        LD.setStyle(svg, '--ld-ring-color', modeColor || 'var(--disabled-color, #bdbdbd)');
        if (target !== undefined && target !== null) {
          var p = polar(160, 160, 145, angle(target));
          handle.setAttribute('cx', p[0].toFixed(2));
          handle.setAttribute('cy', p[1].toFixed(2));
          handle.style.display = '';
        } else handle.style.display = 'none';
        if (current !== undefined && current !== null) {
          var pc = polar(160, 160, 145, angle(current));
          curDot.setAttribute('cx', pc[0].toFixed(2));
          curDot.setAttribute('cy', pc[1].toFixed(2));
          curDot.style.display = '';
        } else curDot.style.display = 'none';

        var labelText = a.hvac_action ? hass.formatAttr(st, 'hvac_action') : hass.formatState(st);
        LD.setText(label, labelText);
        LD.setStyle(label, 'color', actionMode ? LD.stateColor({ entity_id: id, state: actionMode }) : '');

        var primaryCurrent = config.show_current_as_primary;
        var primary = primaryCurrent ? current : target;
        var secondary = primaryCurrent ? target : current;
        var step = a.target_temp_step || 0.5;
        var decimals = primaryCurrent ? 1 : step < 1 ? 1 : 0;
        if (primary === undefined || primary === null) {
          LD.setText(bigInt, '–');
          LD.setText(bigDec, '');
        } else {
          var txt = LD.formatNumber(primary, decimals);
          var m = /^(-?\d+)(\D)(\d+)$/.exec(txt);
          LD.setText(bigInt, m ? m[1] : txt);
          LD.setText(bigDec, m ? m[2] + m[3] : '');
          if (m && /^0+$/.test(m[3]) && primaryCurrent) LD.setText(bigDec, '');
        }
        LD.setText(bigUnit, unit);
        LD.setIcon(subIcon, primaryCurrent ? MODE_ICON[mode] || 'mdi:thermostat' : 'mdi:thermometer');
        LD.setText(subText, secondary === undefined || secondary === null ? '' : LD.formatNumber(secondary, 1) + ' ' + unit);
        LD.setStyle(sub, 'color', primaryCurrent && actionMode ? LD.stateColor({ entity_id: id, state: actionMode }) : '');
        stepper.update();
        features.forEach(function (f) { f.update(); });
        unavailableClass(el, st);
      },
    };
  };

  /* ------------------------------------------------------ weather-forecast */

  var WEATHER_COLORS = {
    sunny: 'amber', 'clear-night': 'indigo', partlycloudy: 'amber', cloudy: 'grey', fog: 'grey', rainy: 'light-blue',
    pouring: 'blue', snowy: 'white', 'snowy-rainy': 'light-blue', hail: 'light-blue', lightning: 'amber',
    'lightning-rainy': 'amber', windy: 'grey', 'windy-variant': 'grey', exceptional: 'red',
  };
  LD.weatherIcon = function (cond, night) {
    if (cond === 'partlycloudy') return night ? 'mdi:weather-night-partly-cloudy' : 'mdi:weather-partly-cloudy';
    if (cond === 'clear-night' || (cond === 'sunny' && night)) return 'mdi:weather-night';
    if (cond === 'exceptional') return 'mdi:alert-circle-outline';
    return 'mdi:weather-' + (cond || 'cloudy');
  };
  LD.weatherColor = function (cond) {
    return LD.color(WEATHER_COLORS[cond] || 'grey');
  };

  LD.cardTypes['weather-forecast'] = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var showCurrent = config.show_current !== false;
    var showForecast = config.show_forecast !== false;
    var type = config.forecast_type || 'daily';
    var el = cardShell('ld-weather');
    var cur = h('div', 'ld-weather-current');
    var icon = LD.icon(null, 'ld-weather-icon');
    var left = h('div', 'ld-weather-left');
    var cond = h('div', 'ld-weather-cond');
    var nameEl = h('div', 'ld-weather-name');
    left.appendChild(cond);
    left.appendChild(nameEl);
    var right = h('div', 'ld-weather-right');
    var temp = h('div', 'ld-weather-temp');
    var range = h('div', 'ld-weather-range');
    right.appendChild(temp);
    right.appendChild(range);
    cur.appendChild(icon);
    cur.appendChild(left);
    cur.appendChild(right);
    if (showCurrent) el.appendChild(cur);
    var fc = h('div', 'ld-weather-forecast');
    if (showForecast) el.appendChild(fc);
    var forecast = null;
    var renderedKey = '';

    if (showForecast) {
      ctx.subscribe({ type: 'weather/subscribe_forecast', forecast_type: type, entity_id: id }, function (ev) {
        forecast = (ev && ev.forecast) || [];
        renderForecast();
      });
    }

    function renderForecast() {
      if (!forecast) return;
      var st = hass.state(id);
      var unit = (st && st.attributes.temperature_unit) || '°';
      var items = forecast.slice(0, 12);
      var key = JSON.stringify(items);
      if (key === renderedKey) return;
      renderedKey = key;
      LD.clear(fc);
      if (!items.length) {
        fc.appendChild(h('div', 'ld-weather-none', LD.t('no_forecast')));
        return;
      }
      items.forEach(function (f) {
        var col = h('div', 'ld-weather-col');
        var hourly = type === 'hourly';
        col.appendChild(h('div', 'ld-weather-when', hourly ? LD.formatTime(f.datetime, { hour: 'numeric' }) : LD.formatWeekday(f.datetime)));
        var hour = new Date(f.datetime).getHours();
        var ic = LD.icon(LD.weatherIcon(f.condition, hourly && (hour < 6 || hour >= 21)), 'ld-weather-col-icon');
        ic.style.color = LD.weatherColor(f.condition);
        col.appendChild(ic);
        col.appendChild(h('div', 'ld-weather-hi', f.temperature !== undefined && f.temperature !== null ? LD.formatNumber(f.temperature) + '°' : ''));
        if (f.templow !== undefined && f.templow !== null) col.appendChild(h('div', 'ld-weather-lo', LD.formatNumber(f.templow) + '°'));
        fc.appendChild(col);
      });
      void unit;
      updateRange();
    }

    function updateRange() {
      var st = hass.state(id);
      if (!st || !forecast || !forecast.length) return LD.setText(range, '');
      var u = st.attributes.temperature_unit || '';
      var f0 = forecast[0];
      var hi;
      var lo;
      if (f0.templow !== undefined && f0.templow !== null) {
        hi = f0.temperature;
        lo = f0.templow;
      } else {
        var day = forecast.slice(0, 24).map(function (f) { return f.temperature; }).filter(function (v) { return typeof v === 'number'; });
        if (!day.length) return LD.setText(range, '');
        hi = Math.max.apply(null, day);
        lo = Math.min.apply(null, day);
      }
      LD.setText(range, LD.formatNumber(hi, 1) + ' ' + u + ' / ' + LD.formatNumber(lo, 1) + ' ' + u);
    }

    LD.bindActions(el, ctx, config, id, { tap_action: { action: 'more-info' } });
    var rows = 1 + (showCurrent ? 1 : 0) + (showForecast ? 1 + (type === 'daily' ? 1 : 0) : 0);
    return {
      el: el,
      deps: [id],
      grid: { columns: 12, rows: rows, min_columns: showCurrent && showForecast ? 5 : 4, min_rows: rows - (type === 'daily' ? 1 : 0) },
      update: function () {
        var st = hass.state(id);
        if (!st) return;
        LD.setIcon(icon, LD.weatherIcon(st.state));
        LD.setStyle(icon, 'color', LD.weatherColor(st.state));
        LD.setText(cond, hass.formatState(st));
        LD.setText(nameEl, LD.cardName(ctx, config.name, st, id));
        var a = st.attributes;
        LD.setText(temp, a.temperature !== undefined ? LD.formatNumber(a.temperature) + ' ' + (a.temperature_unit || '') : '');
        updateRange();
      },
    };
  };

  /* ---------------------------------------------------------- unsupported */

  LD.cardTypes.unsupported = function (config, ctx, reason) {
    var el = cardShell('ld-unsupported');
    el.appendChild(LD.icon('mdi:card-off-outline'));
    var text = h('div');
    text.appendChild(h('div', 'ld-unsupported-title', LD.t('unsupported')));
    text.appendChild(h('div', 'ld-unsupported-type', (config && config.type) + (reason ? ' – ' + reason : '')));
    el.appendChild(text);
    if (config && config.entity) LD.bindActions(el, ctx, {}, config.entity, { tap_action: { action: 'more-info' } });
    return { el: el, deps: [], grid: { columns: 12, rows: 'auto' }, update: function () {} };
  };

  /* Unknown custom card: if it targets one entity, show it as a tile so it stays usable. */
  LD.cardTypes['custom:fallback'] = function (config, ctx) {
    if (config.entity && typeof config.entity === 'string') {
      var tile = LD.cardTypes.tile({ entity: config.entity, name: typeof config.name === 'string' && !LD.isTemplate(config.name) ? config.name : undefined, icon: typeof config.icon === 'string' && !LD.isTemplate(config.icon) ? config.icon : undefined, tap_action: config.tap_action, hold_action: config.hold_action, double_tap_action: config.double_tap_action }, ctx);
      tile.grid = { columns: 12, rows: 'auto' };
      return tile;
    }
    if (config.card && typeof config.card === 'object') return LD.cardTypes['vertical-stack']({ cards: [config.card] }, ctx);
    if (Array.isArray(config.cards)) return LD.cardTypes['vertical-stack']({ cards: config.cards }, ctx);
    return LD.cardTypes.unsupported(config, ctx);
  };
})();
