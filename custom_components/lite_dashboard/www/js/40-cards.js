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
    /* Same layers as ha-control-circular-slider: background track, "clear" arc to hide
     * the track, half-transparent value arc, fully colored arc from current to target
     * while it is still working towards it, current marker, target handle. */
    var svg = svgEl('svg', { viewBox: '0 0 320 320', class: 'ld-thermo-ring' });
    var track = svgEl('path', { class: 'ld-ring-track', d: arcPath(160, 160, 145, RING_START, RING_START + RING_SWEEP) });
    var arcClear = svgEl('path', { class: 'ld-ring-clear' });
    var arcColored = svgEl('path', { class: 'ld-ring-colored' });
    var arcActive = svgEl('path', { class: 'ld-ring-active' });
    var curDot = svgEl('circle', { class: 'ld-ring-current', r: '4' });
    var handleBorder = svgEl('circle', { class: 'ld-ring-handle-border', r: '12' });
    var handle = svgEl('circle', { class: 'ld-ring-handle', r: '9' });
    [track, arcClear, arcColored, arcActive, curDot, handleBorder, handle].forEach(function (e) { svg.appendChild(e); });
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
        var modeColor = mode !== 'off' ? LD.stateColor(st) : null;
        var angle = function (v) { return RING_START + RING_SWEEP * Math.max(0, Math.min(1, (v - min) / (max - min))); };

        var on = mode !== 'off' && target !== undefined && target !== null;
        var setD = function (el, d) { if (el.getAttribute('d') !== d) el.setAttribute('d', d); };
        var valueArc = '';
        var activeArc = '';
        if (on) {
          var cooling = mode === 'cool';
          valueArc = cooling ? arcPath(160, 160, 145, angle(target), RING_START + RING_SWEEP) : arcPath(160, 160, 145, RING_START, angle(target));
          if (current !== undefined && current !== null) {
            if (!cooling && current < target) activeArc = arcPath(160, 160, 145, angle(current), angle(target));
            if (cooling && current > target) activeArc = arcPath(160, 160, 145, angle(target), angle(current));
          }
        }
        setD(arcClear, valueArc);
        setD(arcColored, valueArc);
        setD(arcActive, activeArc);
        LD.setStyle(svg, '--ld-ring-color', on && modeColor ? modeColor : 'var(--state-inactive-color)');
        if (target !== undefined && target !== null) {
          var p = polar(160, 160, 145, angle(target));
          [handle, handleBorder].forEach(function (c) {
            c.setAttribute('cx', p[0].toFixed(2));
            c.setAttribute('cy', p[1].toFixed(2));
            c.style.display = '';
          });
        } else {
          handle.style.display = 'none';
          handleBorder.style.display = 'none';
        }
        if (current !== undefined && current !== null) {
          var pc = polar(160, 160, 145, angle(current));
          curDot.setAttribute('cx', pc[0].toFixed(2));
          curDot.setAttribute('cy', pc[1].toFixed(2));
          curDot.style.display = '';
        } else curDot.style.display = 'none';
        /* glow behind the numbers while heating/cooling (hvac_action), like HA */
        LD.setStyle(body, '--ld-action-color', actionMode && on ? LD.stateColor({ entity_id: id, state: actionMode }) : '');
        LD.setClass(body, 'ld-glow', !!(actionMode && on));

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
        LD.setIcon(subIcon, primaryCurrent ? 'mdi:thermostat' : 'mdi:thermometer');
        LD.setText(subText, secondary === undefined || secondary === null ? '' : LD.formatNumber(secondary, 1) + ' ' + unit);
        LD.setStyle(sub, 'color', primaryCurrent && actionMode ? LD.stateColor({ entity_id: id, state: actionMode }) : '');
        stepper.update();
        features.forEach(function (f) { f.update(); });
        unavailableClass(el, st);
      },
    };
  };

  /* ------------------------------------------------------ weather-forecast */

  /* Weather icons ported from the HA frontend (Apache-2.0), so they look identical. */
  var WX_CLOUDY = { partlycloudy: 1, cloudy: 1, fog: 1, windy: 1, 'windy-variant': 1, hail: 1, rainy: 1, snowy: 1, 'snowy-rainy': 1, pouring: 1, lightning: 1, 'lightning-rainy': 1 };
  var WX_RAINY = { hail: 1, rainy: 1, pouring: 1, 'lightning-rainy': 1 };
  var WX_WINDY = { windy: 1, 'windy-variant': 1 };
  var WX_SNOWY = { snowy: 1, 'snowy-rainy': 1 };
  var WX_LIGHTNING = { lightning: 1, 'lightning-rainy': 1 };
  var WX = {
    sun: 'm 14.39303,8.4033507 c 0,3.3114723 -2.684145,5.9956173 -5.9956169,5.9956173 -3.3114716,0 -5.9956168,-2.684145 -5.9956168,-5.9956173 0,-3.311471 2.6841452,-5.995617 5.9956168,-5.995617 3.3114719,0 5.9956169,2.684146 5.9956169,5.995617',
    moon: 'm 13.502891,11.382935 c -1.011285,1.859223 -2.976664,3.121381 -5.2405751,3.121381 -3.289929,0 -5.953329,-2.663833 -5.953329,-5.9537625 0,-2.263911 1.261724,-4.228856 3.120948,-5.240575 -0.452782,0.842738 -0.712753,1.806363 -0.712753,2.832381 0,3.289928 2.663833,5.9533275 5.9533291,5.9533275 1.026017,0 1.989641,-0.259969 2.83238,-0.712752',
    smallSun: 'm14.981 4.2112c0 1.9244-1.56 3.4844-3.484 3.4844-1.9244 0-3.4844-1.56-3.4844-3.4844s1.56-3.484 3.4844-3.484c1.924 0 3.484 1.5596 3.484 3.484',
    cloudBack: 'm3.8863 5.035c-0.54892 0.16898-1.04 0.46637-1.4372 0.8636-0.63077 0.63041-1.0206 1.4933-1.0206 2.455 0 1.9251 1.5589 3.4682 3.4837 3.4682h6.9688c1.9251 0 3.484-1.5981 3.484-3.5232 0-1.9251-1.5589-3.5232-3.484-3.5232h-1.0834c-0.25294-1.6916-1.6986-2.9083-3.4463-2.9083-1.7995 0-3.2805 1.4153-3.465 3.1679',
    cloudFront: 'm4.1996 7.6995c-0.33902 0.10407-0.64276 0.28787-0.88794 0.5334-0.39017 0.38982-0.63147 0.92322-0.63147 1.5176 0 1.1896 0.96414 2.1431 2.1537 2.1431h4.3071c1.1896 0 2.153-0.98742 2.153-2.1777 0-1.1896-0.96344-2.1777-2.153-2.1777h-0.66992c-0.15593-1.0449-1.0499-1.7974-2.1297-1.7974-1.112 0-2.0274 0.87524-2.1417 1.9586',
    rain: [
      'm5.2852 14.734c-0.22401 0.24765-0.57115 0.2988-0.77505 0.11395-0.20391-0.1845-0.18732-0.53481 0.036689-0.78281 0.14817-0.16298 0.59126-0.32914 0.87559-0.42369 0.12453-0.04092 0.22684 0.05186 0.19791 0.17956-0.065617 0.2921-0.18732 0.74965-0.33514 0.91299',
      'm11.257 14.163c-0.22437 0.24765-0.57115 0.2988-0.77505 0.11395-0.2039-0.1845-0.18768-0.53481 0.03669-0.78281 0.14817-0.16298 0.59126-0.32914 0.8756-0.42369 0.12453-0.04092 0.22684 0.05186 0.19791 0.17956-0.06562 0.2921-0.18732 0.74965-0.33514 0.91299',
      'm8.432 15.878c-0.15452 0.17039-0.3937 0.20567-0.53446 0.07867-0.14041-0.12735-0.12876-0.36865 0.025753-0.53975 0.10195-0.11218 0.40711-0.22684 0.60325-0.29175 0.085725-0.02858 0.15628 0.03563 0.13652 0.12382-0.045508 0.20108-0.12912 0.51647-0.23107 0.629',
      'm7.9991 14.118c-0.19226 0.21237-0.49001 0.25612-0.66499 0.09737-0.17462-0.15804-0.16051-0.45861 0.03175-0.67098 0.12665-0.14005 0.50729-0.28293 0.75071-0.36336 0.10689-0.03563 0.19473 0.0441 0.17004 0.15346-0.056092 0.25082-0.16051 0.64347-0.28751 0.78352',
    ],
    pouring: [
      'm10.648 16.448c-0.19226 0.21449-0.49001 0.25894-0.66499 0.09878-0.17498-0.16016-0.16087-0.4639 0.03175-0.67874 0.12665-0.14146 0.50694-0.2854 0.75071-0.36724 0.10689-0.03563 0.19473 0.0448 0.17004 0.15558-0.05645 0.25365-0.16051 0.65017-0.28751 0.79163',
      'm5.9383 16.658c-0.22437 0.25012-0.5715 0.30162-0.77505 0.11501-0.20391-0.18627-0.18768-0.54046 0.036689-0.79093 0.14817-0.1651 0.59126-0.33267 0.87559-0.42827 0.12418-0.04127 0.22648 0.05221 0.19791 0.18168-0.065617 0.29528-0.18732 0.75741-0.33514 0.92251',
    ],
    wind: [
      'm 13.59616,15.30968 c 0,0 -0.09137,-0.0071 -0.250472,-0.0187 -0.158045,-0.01235 -0.381353,-0.02893 -0.64382,-0.05715 -0.262466,-0.02716 -0.564444,-0.06385 -0.877358,-0.124531 -0.156986,-0.03034 -0.315383,-0.06844 -0.473781,-0.111478 -0.157691,-0.04551 -0.313266,-0.09842 -0.463902,-0.161219 l -0.267406,-0.0949 c -0.09984,-0.02646 -0.205669,-0.04904 -0.305153,-0.06738 -0.193322,-0.02716 -0.3838218,-0.03316 -0.5640912,-0.02011 -0.3626556,0.02611 -0.6847417,0.119239 -0.94615,0.226483 -0.2617611,0.108656 -0.4642556,0.230364 -0.600075,0.324203 -0.1358195,0.09419 -0.2049639,0.160514 -0.2049639,0.160514 0,0 0.089958,-0.01623 0.24765,-0.04445 0.1559278,-0.02575 0.3764139,-0.06174 0.6367639,-0.08714 0.2596444,-0.02646 0.5591527,-0.0441 0.8678333,-0.02328 0.076905,0.0035 0.1538111,0.01658 0.2321278,0.02293 0.077611,0.01058 0.1534581,0.02893 0.2314221,0.04022 0.07267,0.01834 0.1397,0.03986 0.213078,0.05644 l 0.238125,0.08925 c 0.09207,0.03281 0.183444,0.07055 0.275872,0.09878 0.09243,0.0261 0.185208,0.05327 0.277636,0.07161 0.184856,0.0388 0.367947,0.06174 0.543983,0.0702 0.353131,0.01905 0.678745,-0.01341 0.951442,-0.06456 0.27305,-0.05292 0.494595,-0.123119 0.646642,-0.181681 0.152047,-0.05785 0.234597,-0.104069 0.234597,-0.104069',
      'm 4.7519154,13.905801 c 0,0 0.091369,-0.0032 0.2511778,-0.0092 0.1580444,-0.0064 0.3820583,-0.01446 0.6455833,-0.03281 0.2631722,-0.01729 0.5662083,-0.04269 0.8812389,-0.09137 0.1576916,-0.02434 0.3175,-0.05609 0.4776611,-0.09384 0.1591027,-0.03951 0.3167944,-0.08643 0.4699,-0.14358 l 0.2702277,-0.08467 c 0.1008945,-0.02222 0.2074334,-0.04127 0.3072695,-0.05574 0.1943805,-0.01976 0.3848805,-0.0187 0.5651499,0.0014 0.3608917,0.03951 0.67945,0.144639 0.936625,0.261761 0.2575278,0.118534 0.4554364,0.247297 0.5873754,0.346781 0.132291,0.09913 0.198966,0.168275 0.198966,0.168275 0,0 -0.08925,-0.01976 -0.245886,-0.05397 C 9.9423347,14.087088 9.7232597,14.042988 9.4639681,14.00736 9.2057347,13.97173 8.9072848,13.94245 8.5978986,13.95162 c -0.077258,7.06e-4 -0.1541638,0.01058 -0.2328333,0.01411 -0.077964,0.0078 -0.1545166,0.02328 -0.2331861,0.03175 -0.073025,0.01588 -0.1404055,0.03422 -0.2141361,0.04798 l -0.2420055,0.08008 c -0.093486,0.02963 -0.1859139,0.06421 -0.2794,0.0889 C 7.3028516,14.23666 7.2093653,14.2603 7.116232,14.27512 6.9303181,14.30722 6.7465209,14.3231 6.5697792,14.32486 6.2166487,14.33046 5.8924459,14.28605 5.6218654,14.224318 5.3505793,14.161565 5.1318571,14.082895 4.9822793,14.01869 4.8327015,13.95519 4.7519154,13.905801 4.7519154,13.905801',
    ],
    snow: [
      'm 8.4319893,15.348341 c 0,0.257881 -0.209197,0.467079 -0.467078,0.467079 -0.258586,0 -0.46743,-0.209198 -0.46743,-0.467079 0,-0.258233 0.208844,-0.467431 0.46743,-0.467431 0.257881,0 0.467078,0.209198 0.467078,0.467431',
      'm 11.263878,14.358553 c 0,0.364067 -0.295275,0.659694 -0.659695,0.659694 -0.364419,0 -0.6596937,-0.295627 -0.6596937,-0.659694 0,-0.364419 0.2952747,-0.659694 0.6596937,-0.659694 0.36442,0 0.659695,0.295275 0.659695,0.659694',
      'm 5.3252173,13.69847 c 0,0.364419 -0.295275,0.660047 -0.659695,0.660047 -0.364067,0 -0.659694,-0.295628 -0.659694,-0.660047 0,-0.364067 0.295627,-0.659694 0.659694,-0.659694 0.36442,0 0.659695,0.295627 0.659695,0.659694',
    ],
    lightning: 'm 9.9252695,10.935875 -1.6483986,2.341014 1.1170184,0.05929 -1.2169864,2.02141 3.0450261,-2.616159 H 9.8864918 L 10.97937,11.294651 10.700323,10.79794 h -0.508706 l -0.2663475,0.137936',
  };

  /* Returns an <svg> element for a weather condition (night: moon instead of sun). */
  LD.weatherSvg = function (cond, night, cls) {
    var svg = svgEl('svg', { viewBox: '0 0 17 17', class: 'ld-wx' + (cls ? ' ' + cls : '') });
    var add = function (klass, d) { svg.appendChild(svgEl('path', { class: 'ld-wx-' + klass, d: d })); };
    var known = cond === 'sunny' || cond === 'clear-night' || WX_CLOUDY[cond];
    if (!known) {
      var fallback = LD.icon(cond === 'exceptional' ? 'mdi:alert-circle-outline' : 'mdi:weather-cloudy', cls);
      return fallback;
    }
    if (cond === 'sunny') add('sun', WX.sun);
    if (cond === 'clear-night') add('moon', WX.moon);
    if (cond === 'partlycloudy') add(night ? 'moon' : 'sun', WX.smallSun);
    if (WX_CLOUDY[cond]) {
      add('cloud-back', WX.cloudBack);
      add('cloud-front', WX.cloudFront);
    }
    if (WX_RAINY[cond]) WX.rain.forEach(function (d) { add('rain', d); });
    if (cond === 'pouring') WX.pouring.forEach(function (d) { add('rain', d); });
    if (WX_WINDY[cond]) WX.wind.forEach(function (d) { add('cloud-back', d); });
    if (WX_SNOWY[cond]) WX.snow.forEach(function (d) { add('snow', d); });
    if (WX_LIGHTNING[cond]) add('sun', WX.lightning);
    return svg;
  };

  LD.cardTypes['weather-forecast'] = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var showCurrent = config.show_current !== false;
    var showForecast = config.show_forecast !== false;
    var type = config.forecast_type || 'daily';
    var el = cardShell('ld-weather');
    var cur = h('div', 'ld-weather-current');
    var iconBox = h('div', 'ld-weather-iconbox');
    var iconCond = null;
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
    cur.appendChild(iconBox);
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
        col.appendChild(h('div', 'ld-weather-when', hourly ? LD.formatTime(f.datetime) : LD.formatWeekday(f.datetime)));
        col.appendChild(LD.weatherSvg(f.condition, f.is_daytime === false, 'ld-weather-col-icon'));
        col.appendChild(h('div', 'ld-weather-hi', f.temperature !== undefined && f.temperature !== null ? LD.formatNumber(f.temperature) + '°' : ''));
        if (f.templow !== undefined && f.templow !== null) col.appendChild(h('div', 'ld-weather-lo', LD.formatNumber(f.templow) + '°'));
        fc.appendChild(col);
      });
      void unit;
      updateRange();
    }

    /* Same as HA: highest temperature / lowest templow (or temperature) of the
     * forecast entries that fall on today's date. */
    function updateRange() {
      var st = hass.state(id);
      if (!st || !forecast || !forecast.length) return LD.setText(range, '');
      var u = st.attributes.temperature_unit || '';
      var today = new Date().getDate();
      var hi;
      var lo;
      for (var i = 0; i < forecast.length; i++) {
        var f = forecast[i];
        if (new Date(f.datetime).getDate() !== today) break;
        if (hi === undefined || f.temperature > hi) hi = f.temperature;
        if (f.templow !== undefined && f.templow !== null && (lo === undefined || f.templow < lo)) lo = f.templow;
        if (!f.templow && (lo === undefined || f.temperature < lo)) lo = f.temperature;
      }
      var parts = [];
      if (hi !== undefined) parts.push(LD.formatNumber(hi) + ' ' + u);
      if (lo !== undefined) parts.push(LD.formatNumber(lo) + ' ' + u);
      LD.setText(range, parts.join(' / '));
    }

    LD.bindActions(el, ctx, config, id, { tap_action: { action: 'more-info' } });
    var rows = 1 + (showCurrent ? 1 : 0) + (showForecast ? 1 + (type === 'daily' ? 1 : 0) : 0);
    return {
      el: el,
      deps: [id, 'sun.sun'],
      grid: { columns: 12, rows: rows, min_columns: showCurrent && showForecast ? 5 : 4, min_rows: rows - (type === 'daily' ? 1 : 0) },
      update: function () {
        var st = hass.state(id);
        if (!st) return;
        if (iconCond !== st.state) {
          iconCond = st.state;
          LD.clear(iconBox);
          var sun = hass.state('sun.sun');
          iconBox.appendChild(LD.weatherSvg(st.state, !!sun && sun.state === 'below_horizon', 'ld-weather-icon'));
        }
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
