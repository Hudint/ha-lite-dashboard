/* Lite Dashboard - re-implementations of popular custom cards.
 * Only behaviour is reproduced; the original card JS is never loaded. */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;

  /* --------------------------------------------------------- actions-card
   * Wraps a card and replaces its interactions with its own actions. */
  LD.cardTypes['custom:actions-card'] = function (config, ctx) {
    var inner = LD.createCard(config.card || { type: 'unsupported' }, ctx);
    var el = h('div', 'ld-container ld-actions-card');
    el.appendChild(inner.el);
    var overlay = h('div', 'ld-actions-overlay');
    el.appendChild(overlay);
    var entity = config.entity || (config.card && config.card.entity);
    LD.bindActions(overlay, ctx, config, entity, {});
    return {
      el: el,
      deps: [],
      grid: inner.grid,
      naturalRows: inner.naturalRows,
      update: function () {},
    };
  };

  /* ------------------------------------------------------ restriction-card */
  function compare(op, a, b) {
    switch (op || '==') {
      case '==': return String(a) === String(b);
      case '!=': return String(a) !== String(b);
      case '<': return Number(a) < Number(b);
      case '<=': return Number(a) <= Number(b);
      case '>': return Number(a) > Number(b);
      case '>=': return Number(a) >= Number(b);
      case 'regex': try { return new RegExp(b).test(String(a)); } catch (e) { return false; }
    }
    return false;
  }

  LD.cardTypes['custom:restriction-card'] = function (config, ctx) {
    var hass = ctx.hass;
    var inner = LD.createCard(config.card || { type: 'unsupported' }, ctx);
    var restrictions = config.restrictions || {};
    var el = h('div', 'ld-container ld-restriction' + (config.row ? ' ld-restriction-row' : ''));
    el.appendChild(inner.el);
    var overlay = h('div', 'ld-restriction-overlay');
    var lockBox = h('div', 'ld-restriction-sub');
    var lock = LD.icon(config.locked_icon || 'mdi:lock-outline', 'ld-restriction-lock');
    lockBox.appendChild(lock);
    overlay.appendChild(lockBox);
    el.appendChild(overlay);
    if (config.css_variables) {
      Object.keys(config.css_variables).forEach(function (k) { el.style.setProperty(k, config.css_variables[k]); });
    }
    var duration = (config.duration !== undefined ? config.duration : 5) * 1000;
    var unlockedUntil = 0;
    var relockTimer = null;
    var deps = [];

    function userExempt(list) {
      return (list || []).some(function (e) { return hass.user && e.user === hass.user.id; });
    }
    function conditionMet(cond) {
      if (!cond) return true;
      var st = hass.state(cond.entity);
      var v = st ? (cond.attribute ? st.attributes[cond.attribute] : st.state) : undefined;
      return compare(cond.operator, v, cond.value);
    }
    ['confirm', 'pin', 'block', 'hide'].forEach(function (k) {
      var r = restrictions[k];
      if (r && r.condition && r.condition.entity) deps.push(r.condition.entity);
    });
    if (config.condition && config.condition.entity) deps.push(config.condition.entity);

    function active(kind) {
      var r = restrictions[kind];
      if (!r) return false;
      if (userExempt(r.exemptions)) return false;
      return conditionMet(r.condition);
    }

    /* Like the original: the lock overlay is always there (unless the user is exempt
     * or the card-level condition fails). Tapping it unlocks for `duration` seconds,
     * asking for PIN/confirmation only when that restriction's condition matches. */
    function render() {
      var hidden = active('hide');
      el.style.display = hidden ? 'none' : '';
      var exempt = userExempt(config.exemptions) || (config.condition && !conditionMet(config.condition));
      var locked = !exempt && Date.now() >= unlockedUntil;
      overlay.style.display = locked ? '' : 'none';
      LD.setClass(overlay, 'ld-blocked', active('block'));
      LD.setClass(el, 'ld-locked', locked);
    }

    function unlock() {
      unlockedUntil = Date.now() + duration;
      render();
      clearTimeout(relockTimer);
      relockTimer = setTimeout(render, duration + 50);
    }

    var gesture = config.action || 'tap';
    var handlers = {};
    handlers[gesture === 'double_tap' ? 'doubleTap' : gesture] = function () {
      if (active('block')) {
        LD.toast((restrictions.block && restrictions.block.text) || LD.t('blocked'));
        return;
      }
      if (active('pin')) {
        var codes = LD.asArray(restrictions.pin.code).map(String);
        LD.dialogs.pin(restrictions.pin.text, function (v) { return codes.indexOf(v) !== -1; }).then(function (ok) {
          if (!ok) return;
          if (active('confirm')) LD.dialogs.confirm(restrictions.confirm.text || LD.t('confirm_action')).then(function (c) { if (c) unlock(); });
          else unlock();
        });
        return;
      }
      if (active('confirm')) {
        LD.dialogs.confirm(restrictions.confirm.text || LD.t('confirm_action')).then(function (ok) { if (ok) unlock(); });
        return;
      }
      unlock();
    };
    LD.bindGestures(overlay, handlers);

    return {
      el: el,
      deps: deps,
      grid: inner.grid,
      naturalRows: inner.naturalRows,
      update: render,
    };
  };

  /* -------------------------------------------------------- bignumber-card
   * Supports the original and the "continued" fork options. */
  LD.cardTypes['custom:bignumber-card'] = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var el = h('div', 'ld-card ld-bignumber');
    var bar = h('div', 'ld-bignumber-bar');
    el.appendChild(bar);
    var title = h('div', 'ld-bignumber-title', config.title || '');
    var value = h('div', 'ld-bignumber-value');
    var num = h('span');
    var unit = h('span', 'ld-bignumber-unit');
    value.appendChild(num);
    value.appendChild(unit);
    value.style.fontSize = config.scale || '50px';
    if (config.title) el.appendChild(title);
    el.appendChild(value);
    LD.bindActions(el, ctx, config, id, { tap_action: { action: 'more-info' } });
    return {
      el: el,
      deps: [id],
      grid: { columns: 12, rows: 'auto' },
      update: function () {
        var st = hass.state(id);
        var raw = st ? (config.attribute ? st.attributes[config.attribute] : st.state) : undefined;
        var n = Number(raw);
        var none = raw === undefined || raw === null || raw === 'unavailable' || raw === 'unknown' || raw === '';
        var text = none ? config.noneString || '-' : isFinite(n) && config.round !== undefined ? LD.formatNumber(n, config.round) : isFinite(n) ? LD.formatNumber(n) : String(raw);
        LD.setText(num, text);
        LD.setText(unit, config.hideunit || none || !st ? '' : st.attributes.unit_of_measurement || '');
        var color = config.text_color || config.color || '';
        var bg = config.fill_color || config.bnStyle || '';
        if (config.severity && isFinite(n)) {
          for (var i = 0; i < config.severity.length; i++) {
            if (n <= Number(config.severity[i].value)) {
              var s = config.severity[i];
              if (s.style) bg = s.style;
              if (s.text_color || s.color) color = s.text_color || s.color;
              break;
            }
          }
        }
        LD.setStyle(value, 'color', color);
        if (config.min !== undefined && config.max !== undefined && isFinite(n)) {
          var pct = Math.max(0, Math.min(100, ((n - config.min) / (config.max - config.min)) * 100));
          LD.setStyle(bar, 'background', bg);
          if (config.from === 'bottom') {
            LD.setStyle(bar, 'height', pct + '%');
            LD.setStyle(bar, 'width', '100%');
          } else {
            LD.setStyle(bar, 'width', pct + '%');
            LD.setStyle(bar, 'height', '100%');
          }
        } else LD.setStyle(bar, 'width', '0');
      },
    };
  };

  /* ------------------------------------------------------- split-button-card
   * Equal segments in one card; each segment behaves like a button. */
  LD.cardTypes['custom:split-button-card'] = function (config, ctx) {
    var hass = ctx.hass;
    var el = h('div', 'ld-card ld-split');
    var defaults = {};
    ['show_name', 'show_icon', 'show_state', 'state_background', 'background_opacity', 'icon_height', 'state_display', 'color', 'state_color'].forEach(function (k) {
      if (config[k] !== undefined) defaults[k] = config[k];
    });
    var segs = (config.buttons || []).map(function (raw) {
      var b = Object.assign({}, defaults, raw);
      var seg = h('div', 'ld-split-seg');
      var bg = h('div', 'ld-split-bg');
      var iconBox = LD.iconBox('ld-split-icon');
      if (b.icon_height) {
        iconBox.style.height = b.icon_height;
        iconBox.classList.add('ld-has-height');
      }
      var name = h('div', 'ld-split-name');
      var state = h('div', 'ld-split-state');
      seg.appendChild(bg);
      if (b.show_icon !== false) seg.appendChild(iconBox);
      if (b.show_name !== false) seg.appendChild(name);
      if (b.show_state) seg.appendChild(state);
      el.appendChild(seg);
      var id = b.entity;
      LD.bindActions(seg, ctx, b, id, {
        tap_action: { action: id && LD.canToggle(id) ? 'toggle' : 'more-info' },
        hold_action: { action: 'more-info' },
      });
      return { b: b, el: seg, bg: bg, icon: iconBox, name: name, state: state, id: id };
    });
    var deps = [];
    segs.forEach(function (s) {
      if (s.id) deps.push(s.id);
      if (s.b.visibility) deps = deps.concat(LD.conditionEntities(s.b.visibility));
    });
    var card = {
      el: el,
      deps: deps,
      grid: { columns: 6, rows: 2, min_columns: 2, min_rows: 1 },
      update: function () {
        var shown = 0;
        segs.forEach(function (s) {
          var visible = !s.b.visibility || LD.checkConditions(ctx, s.b.visibility, s.id);
          s.el.style.display = visible ? '' : 'none';
          if (!visible) return;
          shown++;
          var st = s.id ? hass.state(s.id) : null;
          var vars = { variables: s.b.variables };
          LD.setText(s.name, LD.tpl(ctx, s.b.name, st, vars.variables) || (st ? hass.entityName(st) : ''));
          if (s.b.show_state) {
            var disp = s.b.state_display !== undefined && s.b.state_display !== null ? LD.tpl(ctx, s.b.state_display, st, s.b.variables) : st ? hass.formatState(st) : '';
            LD.setText(s.state, disp);
          }
          var picture = LD.tpl(ctx, s.b.entity_picture, st) || (s.b.show_entity_picture && st ? st.attributes.entity_picture : null);
          LD.setIconBox(s.icon, LD.tpl(ctx, s.b.icon, st) || (st ? hass.entityIcon(st) : 'mdi:gesture-tap-button'), picture);
          var color = s.b.color === 'state' || !s.b.color ? (st && s.b.state_color !== false ? LD.stateColor(st) : null) : LD.color(LD.tpl(ctx, s.b.color, st));
          var active = !st || LD.stateActive(st);
          LD.setStyle(s.icon, 'color', color && active && !picture ? color : '');
          if (s.b.state_background && color && active) {
            LD.setStyle(s.bg, 'background', color);
            LD.setStyle(s.bg, 'opacity', s.b.background_opacity !== undefined ? s.b.background_opacity : 0.2);
          } else LD.setStyle(s.bg, 'opacity', '0');
        });
        el.style.display = shown ? '' : 'none';
        if (card.onVisibility) card.onVisibility(shown > 0);
        el.style.gridTemplateColumns = 'repeat(' + (config.columns || Math.max(shown, 1)) + ', minmax(0, 1fr))';
      },
    };
    return card;
  };

  /* ------------------------------------------------------------ button-card
   * Core options of custom:button-card (RomRider). Templates are supported in
   * name/label/state_display/icon/color/entity_picture; styles are applied inline. */
  function applyStyles(el, list, ctx, st, variables) {
    if (!list) return;
    LD.asArray(list).forEach(function (item) {
      Object.keys(item).forEach(function (k) {
        var v = LD.tpl(ctx, item[k], st, variables);
        if (v !== undefined && v !== null) el.style.setProperty(k, String(v));
      });
    });
  }

  function matchState(cfgStates, st) {
    if (!cfgStates || !st) return null;
    for (var i = 0; i < cfgStates.length; i++) {
      var s = cfgStates[i];
      var op = s.operator || '==';
      if (op === 'default') return s;
      if (op === 'template') continue;
      if (compare(op, st.state, s.value)) return s;
    }
    for (var j = 0; j < cfgStates.length; j++) if (cfgStates[j].operator === 'default') return cfgStates[j];
    return null;
  }

  LD.cardTypes['custom:button-card'] = function (config, ctx) {
    var hass = ctx.hass;
    var id = config.entity;
    var el = h('div', 'ld-card ld-bcard');
    var iconBox = LD.iconBox('ld-bcard-icon');
    var name = h('div', 'ld-bcard-name');
    var state = h('div', 'ld-bcard-state');
    var label = h('div', 'ld-bcard-label');
    if (config.show_icon !== false) el.appendChild(iconBox);
    if (config.show_name !== false) el.appendChild(name);
    if (config.show_state) el.appendChild(state);
    if (config.show_label) el.appendChild(label);
    var customs = {};
    Object.keys(config.custom_fields || {}).forEach(function (k) {
      var f = h('div', 'ld-bcard-field');
      customs[k] = f;
      el.appendChild(f);
    });
    LD.bindActions(el, ctx, config, id, {
      tap_action: { action: id && LD.canToggle(id) ? 'toggle' : 'more-info' },
      hold_action: { action: 'none' },
    });
    var deps = id ? [id] : [];
    deps = deps.concat(config.triggers_update && config.triggers_update !== 'all' ? LD.asArray(config.triggers_update) : []);
    return {
      el: el,
      deps: deps,
      watchAllTemplates: !!JSON.stringify(config).match(/\[\[\[/),
      grid: { columns: 6, rows: 'auto' },
      update: function () {
        var st = id ? hass.state(id) : null;
        var v = config.variables;
        var over = matchState(config.state, st) || {};
        var nameTxt = LD.tpl(ctx, over.name !== undefined ? over.name : config.name, st, v);
        LD.setText(name, nameTxt !== undefined && nameTxt !== null ? nameTxt : st ? hass.entityName(st) : '');
        if (config.show_state) {
          var sd = config.state_display !== undefined ? LD.tpl(ctx, config.state_display, st, v) : st ? hass.formatState(st) + (config.units ? ' ' + config.units : '') : '';
          LD.setText(state, sd);
        }
        if (config.show_label) LD.setText(label, LD.tpl(ctx, over.label !== undefined ? over.label : config.label, st, v) || '');
        var icon = LD.tpl(ctx, over.icon || config.icon, st, v) || (st ? hass.entityIcon(st) : '');
        var pic = config.show_entity_picture ? LD.tpl(ctx, over.entity_picture || config.entity_picture, st, v) || (st && st.attributes.entity_picture) : null;
        LD.setIconBox(iconBox, icon, pic);
        var color = LD.tpl(ctx, over.color || config.color, st, v);
        var active = st ? LD.stateActive(st) : true;
        var resolved = color === 'auto' || !color ? (active && st ? LD.stateColor(st) : '') : LD.color(color);
        var colorType = config.color_type || 'icon';
        LD.setStyle(iconBox, 'color', colorType === 'icon' && active ? resolved : '');
        LD.setStyle(el, 'background', colorType === 'card' || colorType === 'blank-card' ? resolved : '');
        Object.keys(customs).forEach(function (k) {
          var f = config.custom_fields[k];
          var val = typeof f === 'object' && f !== null && !LD.isTemplate(f) ? '' : LD.tpl(ctx, f, st, v);
          if (typeof val === 'string' && /<[a-z]/i.test(val)) {
            if (customs[k].__html !== val) {
              customs[k].__html = val;
              customs[k].innerHTML = val;
            }
          } else LD.setText(customs[k], val);
        });
        var styles = config.styles || {};
        var ostyles = over.styles || {};
        el.removeAttribute('style');
        applyStyles(el, styles.card, ctx, st, v);
        applyStyles(el, ostyles.card, ctx, st, v);
        applyStyles(name, styles.name, ctx, st, v);
        applyStyles(state, styles.state, ctx, st, v);
        applyStyles(label, styles.label, ctx, st, v);
        applyStyles(iconBox, styles.icon, ctx, st, v);
        if (config.size) iconBox.style.width = config.size;
        unavailableClass(el, id ? st : true);
      },
    };
  };

  function unavailableClass(el, st) {
    LD.setClass(el, 'ld-unavailable', !st || st.state === 'unavailable');
  }

  /* ------------------------------------------------------------ mushroom
   * Mushroom entity-style cards map onto the tile card. */
  ['entity', 'light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media-player', 'person', 'vacuum', 'alarm-control-panel', 'humidifier', 'number', 'select'].forEach(function (k) {
    LD.cardTypes['custom:mushroom-' + k + '-card'] = function (config, ctx) {
      var features = [];
      if (k === 'light' && config.show_brightness_control) features.push({ type: 'light-brightness' });
      if (k === 'cover' && config.show_buttons_control) features.push({ type: 'cover-open-close' });
      if (k === 'climate' && config.show_temperature_control) features.push({ type: 'target-temperature' });
      var tile = LD.cardTypes.tile({
        entity: config.entity,
        name: config.name,
        icon: config.icon,
        color: config.icon_color,
        vertical: config.layout === 'vertical',
        hide_state: config.primary_info === 'none' && config.secondary_info === 'none',
        tap_action: config.tap_action || { action: k === 'entity' ? 'more-info' : 'toggle' },
        hold_action: config.hold_action,
        double_tap_action: config.double_tap_action,
        icon_tap_action: config.tap_action,
        features: features,
      }, ctx);
      return tile;
    };
  });

  LD.cardTypes['custom:mushroom-title-card'] = function (config, ctx) {
    var el = h('div', 'ld-card ld-heading ld-heading-title');
    var t = h('div', 'ld-mushroom-title');
    var s = h('div', 'ld-mushroom-subtitle');
    el.appendChild(t);
    el.appendChild(s);
    function sub(field, target) {
      var src = config[field] || '';
      if (/\{\{|\{%/.test(src)) {
        ctx.subscribe({ type: 'render_template', template: src, strict: false, report_errors: false }, function (ev) {
          if (ev && ev.result !== undefined) LD.setText(target, ev.result);
        });
      } else LD.setText(target, src);
    }
    sub('title', t);
    sub('subtitle', s);
    return { el: el, deps: [], grid: { columns: 'full', rows: 'auto' }, update: function () {} };
  };

  LD.cardTypes['custom:mushroom-template-card'] = function (config, ctx) {
    var hass = ctx.hass;
    var el = h('div', 'ld-card ld-tile');
    var main = h('div', 'ld-tile-main');
    var iconBox = LD.iconBox('ld-tile-icon');
    var info = h('div', 'ld-tile-info');
    var primary = h('div', 'ld-tile-name');
    var secondary = h('div', 'ld-tile-state');
    info.appendChild(primary);
    info.appendChild(secondary);
    main.appendChild(iconBox);
    main.appendChild(info);
    el.appendChild(main);
    var color = null;
    function sub(field, cb) {
      var src = config[field];
      if (src === undefined || src === null) return cb('');
      if (/\{\{|\{%/.test(String(src))) {
        ctx.subscribe({ type: 'render_template', template: String(src), strict: false, report_errors: false, variables: { entity: config.entity } }, function (ev) {
          if (ev && ev.result !== undefined) cb(String(ev.result));
        });
      } else cb(String(src));
    }
    sub('primary', function (v) { LD.setText(primary, v); });
    sub('secondary', function (v) { LD.setText(secondary, v); });
    sub('icon', function (v) { LD.setIconBox(iconBox, v || 'mdi:bookmark'); });
    sub('icon_color', function (v) {
      color = v ? LD.color(v) : null;
      LD.setClass(el, 'ld-active', !!color);
      LD.setStyle(el, '--ld-color', color || '');
    });
    LD.bindActions(el, ctx, config, config.entity, { tap_action: { action: config.entity ? 'more-info' : 'none' } });
    void hass;
    return { el: el, deps: [], grid: { columns: 6, rows: 1, min_columns: 6, min_rows: 1 }, naturalRows: 1, update: function () {} };
  };

  LD.cardTypes['custom:mushroom-chips-card'] = function (config, ctx) {
    return LD.cardTypes.heading({
      heading: '',
      heading_style: 'subtitle',
      badges: (config.chips || []).filter(function (c) { return c.entity; }).map(function (c) {
        return { entity: c.entity, icon: c.icon, color: c.icon_color, tap_action: c.tap_action };
      }),
    }, ctx);
  };

  LD.cardTypes['custom:stack-in-card'] = function (config, ctx) {
    var mode = config.mode === 'horizontal' ? 'horizontal-stack' : 'vertical-stack';
    return LD.cardTypes[mode](config, ctx);
  };
  LD.cardTypes['custom:vertical-stack-in-card'] = LD.cardTypes['vertical-stack'];
  LD.cardTypes['custom:layout-card'] = function (config, ctx) {
    return LD.cardTypes.grid({ cards: config.cards, columns: (config.layout && config.layout.columns) || undefined }, ctx);
  };
})();
