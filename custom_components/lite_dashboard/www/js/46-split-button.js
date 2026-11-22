/* Lite Dashboard - custom:split-button-card (Hudint/split-button-card, v0.6.0).
 *
 * Plain-DOM port of the card: same defaults, colors, layout math, dividers,
 * switch style, mini toggle, animations, templates and per-button visibility.
 * Option reference: https://github.com/Hudint/split-button-card */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;

  /* Domains the native button card toggles on tap (frontend DOMAINS_TOGGLE). */
  var DOMAINS_TOGGLE = { fan: 1, input_boolean: 1, light: 1, switch: 1, group: 1, automation: 1, humidifier: 1, valve: 1 };
  var TEMPLATE_KEYS = ['name', 'icon', 'icon_on', 'icon_off', 'color', 'entity_picture', 'state_display'];
  var ANIMATIONS = { bounce: 1, pulse: 1, shake: 1, blink: 1 };
  var SWITCH_ANIMATIONS = { left: 1, bottom: 1, tap: 1, fade: 1 };
  var TOGGLE_ICONS = {
    light: ['mdi:lightbulb-on', 'mdi:lightbulb-off'],
    fan: ['mdi:fan', 'mdi:fan-off'],
    siren: ['mdi:volume-high', 'mdi:volume-off'],
    default: ['mdi:power', 'mdi:power-off'],
  };
  var CARD_BORDER_WIDTH = 'var(--ha-card-border-width, 1px)';
  var CARD_BORDER_COLOR = 'var(--ha-card-border-color, var(--divider-color, #e0e0e0))';

  /* ------------------------------------------------- state colors (port of state-color.ts) */

  var STATE_COLORED_DOMAIN = {};
  ('alarm_control_panel alert automation binary_sensor calendar camera climate cover device_tracker fan group ' +
    'humidifier input_boolean lawn_mower light lock media_player person plant remote schedule script siren sun ' +
    'switch timer update vacuum valve water_heater weather')
    .split(' ')
    .forEach(function (d) { STATE_COLORED_DOMAIN[d] = 1; });
  var TIMESTAMP_STATE_DOMAINS = { button: 1, event: 1, input_button: 1, scene: 1 };
  var THEME_COLORS = {};
  ('primary accent red pink purple deep-purple indigo blue light-blue cyan teal green light-green lime yellow amber ' +
    'orange deep-orange brown light-grey grey dark-grey blue-grey black white primary-text secondary-text disabled')
    .split(' ')
    .forEach(function (c) { THEME_COLORS[c] = 1; });
  var CLIMATE_HVAC_ACTION_TO_MODE = { cooling: 'cool', defrosting: 'heat', drying: 'dry', fan: 'fan_only', heating: 'heat', idle: 'off', off: 'off', preheating: 'heat' };

  function domainOf(id) {
    return id.split('.')[0];
  }

  function slugify(v) {
    var s = String(v).toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function cssColor(color) {
    return THEME_COLORS[color] ? 'var(--' + color + '-color)' : color;
  }

  function stateActive(st, state) {
    var d = domainOf(st.entity_id);
    var s = state === undefined ? st.state : state;
    if (TIMESTAMP_STATE_DOMAINS[d]) return s !== 'unavailable';
    if (s === 'unavailable' || s === 'unknown') return false;
    if (s === 'off' && d !== 'alert') return false;
    switch (d) {
      case 'alarm_control_panel': return s !== 'disarmed';
      case 'alert': return s !== 'idle';
      case 'cover':
      case 'valve': return s !== 'closed';
      case 'device_tracker':
      case 'person': return s !== 'not_home';
      case 'lawn_mower': return ['docked', 'paused', 'idle'].indexOf(s) === -1;
      case 'lock': return s !== 'locked';
      case 'media_player': return s !== 'standby';
      case 'vacuum': return ['idle', 'docked', 'paused'].indexOf(s) === -1;
      case 'plant': return s === 'problem';
      case 'group': return ['on', 'home', 'open', 'locked', 'problem'].indexOf(s) !== -1;
      case 'timer': return s === 'active';
      case 'camera': return s === 'streaming' || s === 'recording';
    }
    return true;
  }

  function stateColorCss(st, state) {
    var s = state === undefined ? st.state : state;
    if (s === 'unavailable') return 'var(--state-unavailable-color)';
    var d = domainOf(st.entity_id);
    if (d === 'group') {
      var ids = st.attributes.entity_id || [];
      var inner = {};
      ids.forEach(function (i) { inner[domainOf(i)] = 1; });
      var list = Object.keys(inner);
      if (list.length === 1 && STATE_COLORED_DOMAIN[list[0]]) d = list[0];
    }
    if (!STATE_COLORED_DOMAIN[d]) return undefined;
    var key = slugify(s);
    var activeKey = stateActive(st, state) ? 'active' : 'inactive';
    var dc = st.attributes.device_class;
    var props = (dc ? ['--state-' + d + '-' + dc + '-' + key + '-color'] : []).concat([
      '--state-' + d + '-' + key + '-color',
      '--state-' + d + '-' + activeKey + '-color',
      '--state-' + activeKey + '-color',
    ]);
    var out = '';
    for (var i = props.length - 1; i >= 0; i--) out = out ? 'var(' + props[i] + ', ' + out + ')' : 'var(' + props[i] + ')';
    return out;
  }

  /* Icon color, mirroring hui-button-card's _computeColor. */
  function computeStateColor(st, color) {
    if (color) return !st || stateActive(st) ? cssColor(color) : undefined;
    if (!st) return undefined;
    if (st.attributes.rgb_color) return 'rgb(' + st.attributes.rgb_color.join(',') + ')';
    var action = st.attributes.hvac_action;
    if (action) return CLIMATE_HVAC_ACTION_TO_MODE[action] ? stateColorCss(st, CLIMATE_HVAC_ACTION_TO_MODE[action]) : undefined;
    return stateColorCss(st);
  }

  function brightnessFilter(st) {
    var b = st.attributes.brightness;
    if (b && domainOf(st.entity_id) !== 'plant') return 'brightness(' + (b + 245) / 5 + '%)';
    return '';
  }

  /* ------------------------------------------------------------ layout math */

  /* Rows the grid needs for these button configs, following CSS grid auto-placement (no "dense"). */
  function countRows(shown, columns) {
    var occupied = [];
    function free(row, col, span, rowSpan) {
      for (var r = row; r < row + rowSpan; r++) {
        for (var c = col; c < col + span; c++) if (occupied[r] && occupied[r][c]) return false;
      }
      return true;
    }
    var row = 0;
    var col = 0;
    var rows = 0;
    shown.forEach(function (s) {
      var span = Math.min(s.span || 1, columns);
      var rowSpan = s.row_span || 1;
      while (col + span > columns || !free(row, col, span, rowSpan)) {
        col++;
        if (col + span > columns) {
          col = 0;
          row++;
        }
      }
      for (var r = row; r < row + rowSpan; r++) {
        occupied[r] = occupied[r] || [];
        for (var c = col; c < col + span; c++) occupied[r][c] = true;
      }
      rows = Math.max(rows, row + rowSpan);
      col += span;
    });
    return Math.max(rows, 1);
  }

  /* --------------------------------------------------------------- segment */

  /* onAction(action, element) gets every action first; it returns true when it
   * handled it (open a menu, go back), otherwise the action runs normally. */
  function buildSegment(b, ctx, onAction) {
    var hass = ctx.hass;
    var id = b.entity;
    var item = h('div', 'ld-sbc-item');
    var seg = h('div', 'ld-sbc-seg');
    item.appendChild(seg);
    item.appendChild(h('div', 'ld-sbc-divider ld-sbc-right'));
    item.appendChild(h('div', 'ld-sbc-divider ld-sbc-bottom'));

    var bg = h('div', 'ld-sbc-bg');
    var fill = h('div', 'ld-sbc-fill');
    var iconBox = h('div', 'ld-sbc-icon');
    var svg = LD.icon(null);
    var img = h('img', 'ld-sbc-picture');
    img.alt = '';
    var name = h('span', 'ld-sbc-name');
    var state = h('span', 'ld-sbc-state');
    var toggle = h('div', 'ld-sbc-toggle');
    var thumbIcon = LD.icon(null);
    toggle.appendChild(h('div', 'ld-sbc-track'));
    var thumb = h('div', 'ld-sbc-thumb');
    thumb.appendChild(thumbIcon);
    toggle.appendChild(thumb);

    if (b.state_background && !b.switch_style) seg.appendChild(bg);
    if (b.switch_style) seg.appendChild(fill);
    if (b.show_icon) seg.appendChild(iconBox);
    if (b.show_name) seg.appendChild(name);
    if (b.show_state) seg.appendChild(state);
    if (b.show_toggle && id) seg.appendChild(toggle);

    var cls = ['ld-sbc-seg'];
    if (b.animation && ANIMATIONS[b.animation]) cls.push('ld-sbc-anim-' + b.animation);
    if (b.switch_style) cls.push('ld-sbc-switch', 'ld-sbc-switch-' + (SWITCH_ANIMATIONS[b.switch_animation] ? b.switch_animation : 'left'));
    seg.className = cls.join(' ');

    /* transitions only after the first paint, so already-on buttons don't animate on load */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { seg.classList.add('ld-sbc-ready'); });
    });
    seg.addEventListener('pointerdown', function (ev) {
      var r = seg.getBoundingClientRect();
      seg.style.setProperty('--sbc-tap-x', ev.clientX - r.left + 'px');
      seg.style.setProperty('--sbc-tap-y', ev.clientY - r.top + 'px');
    });
    function handler(key) {
      var act = b[key];
      if (!act || act.action === 'none') return null;
      return function () {
        if (onAction && onAction(act, item)) return;
        LD.runAction(ctx, act, id);
        if (onAction) onAction({ action: '__sbc_done' }, item);
      };
    }
    var handlers = { tap: handler('tap_action'), hold: handler('hold_action'), doubleTap: handler('double_tap_action') };
    LD.bindGestures(seg, handlers);
    if (handlers.tap || handlers.hold || handlers.doubleTap) seg.classList.add('ld-clickable');
    else seg.classList.add('ld-sbc-static');

    var lastFill = null;
    var shownIcon = null;

    function update() {
      var st = id ? hass.state(id) : undefined;
      var c = {};
      TEMPLATE_KEYS.forEach(function (k) {
        var v = b[k];
        c[k] = LD.isTemplate(v) ? LD.tpl(ctx, v, st) : v;
        if (c[k] === null) c[k] = undefined;
      });

      var color = c.color === 'state' ? undefined : c.color;
      var noColor = color === 'none' || (!color && b.state_color === false);
      var active = !st || stateActive(st);
      var iconColor = noColor ? undefined : computeStateColor(st, color);

      var fillColor;
      if (b.switch_style && color !== 'none') {
        fillColor = active ? computeStateColor(st, color) : undefined;
        if (fillColor) lastFill = fillColor;
      }
      var filled = !!fillColor;
      var bgColor = !b.switch_style && b.state_background && color !== 'none' && active ? computeStateColor(st, color) : undefined;
      var picture = c.entity_picture || (b.show_entity_picture && st ? st.attributes.entity_picture : undefined);

      LD.setClass(seg, 'ld-sbc-filled', filled);
      LD.setStyle(seg, '--state-color', filled ? 'var(--sbc-switch-text-color, #fff)' : iconColor);
      LD.setStyle(seg, '--sbc-background-color', bgColor);
      LD.setStyle(seg, '--sbc-background-opacity', b.background_opacity !== undefined ? String(b.background_opacity) : '');
      LD.setStyle(seg, '--sbc-fill-color', fillColor || lastFill);
      LD.setStyle(seg, '--sbc-switch-text-color', b.switch_text_color ? cssColor(b.switch_text_color) : '');
      bg.style.display = bgColor ? '' : 'none';

      if (b.show_icon) {
        var icon = (st && (active ? c.icon_on : c.icon_off)) || c.icon || (st ? hass.entityIcon(st) : '');
        var mode = picture ? 'img' : 'svg';
        if (shownIcon !== mode) {
          LD.clear(iconBox);
          iconBox.appendChild(mode === 'img' ? img : svg);
          iconBox.classList.toggle('ld-sbc-has-picture', mode === 'img');
          shownIcon = mode;
        }
        var target = mode === 'img' ? img : iconBox;
        LD.setStyle(target, 'height', b.icon_height);
        if (mode === 'img') {
          if (img.getAttribute('src') !== picture) img.setAttribute('src', picture);
        } else LD.setIcon(svg, icon);
        LD.setStyle(iconBox, 'filter', st && iconColor && !picture && !filled ? brightnessFilter(st) : '');
      }
      if (b.show_name) LD.setText(name, LD.cardName(ctx, c.name, st, id));
      if (b.show_state) {
        var text = c.state_display !== undefined ? String(c.state_display) : st ? hass.formatState(st) : undefined;
        state.style.display = text === undefined ? 'none' : '';
        LD.setText(state, text);
      }
      if (b.show_toggle && st) {
        var icons = TOGGLE_ICONS[domainOf(id)] || TOGGLE_ICONS.default;
        var tIcon = b.toggle_icon_on || b.toggle_icon_off ? (active ? b.toggle_icon_on : b.toggle_icon_off) : active ? icons[0] : icons[1];
        LD.setIcon(thumbIcon, tIcon || '');
        LD.setClass(toggle, 'ld-sbc-on', active);
        LD.setStyle(toggle, '--sbc-toggle-on-color', b.toggle_color ? cssColor(b.toggle_color) : computeStateColor(st));
      }
    }

    return { b: b, item: item, update: update };
  }

  /* ------------------------------------------------------------------ card */

  var MENU_ACTION = '__sbc_menu';
  var BACK_ACTION = '__sbc_back';
  var DONE_ACTION = '__sbc_done';
  var MENU_BACKS = { left: 1, right: 1, top: 1, bottom: 1, top_left: 1, top_right: 1, bottom_left: 1, bottom_right: 1, start: 1, end: 1, none: 1 };
  var DEFAULT_MENU_TIMEOUT = 15;

  function backMode(config) {
    if (config.menu_back === false) return 'none';
    if (config.menu_back === true || !config.menu_back || !MENU_BACKS[config.menu_back]) return 'left';
    return config.menu_back;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* Card-level options are defaults for every button, menus included. The
   * gesture that opens a menu replaces that gesture's action. */
  function normalizeButtons(buttons, config) {
    return (buttons || []).map(function (raw) {
      raw = raw || {};
      var b = {
        show_icon: LD.def(config.show_icon, true),
        show_name: LD.def(config.show_name, true),
        show_state: LD.def(config.show_state, false),
        icon_height: config.icon_height,
        color: config.color,
        state_color: config.state_color,
        state_background: LD.def(config.state_background, false),
        background_opacity: config.background_opacity,
        show_entity_picture: LD.def(config.show_entity_picture, false),
        show_toggle: LD.def(config.show_toggle, false),
        toggle_color: config.toggle_color,
        toggle_icon_on: config.toggle_icon_on,
        toggle_icon_off: config.toggle_icon_off,
        animation: config.animation,
        state_display: config.state_display,
        switch_style: LD.def(config.switch_style, false),
        switch_animation: config.switch_animation,
        switch_text_color: config.switch_text_color,
        tap_action: raw.entity ? { action: DOMAINS_TOGGLE[domainOf(raw.entity)] ? 'toggle' : 'more-info' } : { action: 'none' },
        hold_action: { action: 'more-info' },
        double_tap_action: { action: 'none' },
      };
      Object.keys(raw).forEach(function (k) { b[k] = raw[k]; });
      if (raw.buttons && raw.buttons.length) {
        b.buttons = normalizeButtons(raw.buttons, config);
        b[(raw.menu_open || 'tap') + '_action'] = { action: MENU_ACTION };
      } else delete b.buttons;
      return b;
    });
  }

  function allSegments(list) {
    var out = [];
    list.forEach(function (b) {
      out.push(b);
      if (b.buttons) out = out.concat(allSegments(b.buttons));
    });
    return out;
  }

  function animate(el, frames, timing) {
    if (!el.animate || reducedMotion()) return;
    try {
      el.animate(frames, timing);
    } catch (e) {
      /* old WebView without some keyframe property: skip the animation */
    }
  }

  /* Escape goes one menu level back; one global listener, cards of old renders drop out */
  var escHandlers = [];
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    escHandlers = escHandlers.filter(function (fn) { return fn(); });
  });

  LD.cardTypes['custom:split-button-card'] = function (config, ctx) {
    var divider = config.divider || 'border';
    var gap = config.gap || '8px';
    var el = h('div', 'ld-card ld-sbc ld-sbc-divider-' + divider);
    var body = h('div', 'ld-sbc-body');
    var grid = h('div', 'ld-sbc-grid');
    body.appendChild(grid);
    el.appendChild(body);

    if (divider === 'border' || divider === 'line') {
      el.style.setProperty('--sbc-divider-display', 'block');
      el.style.setProperty('--sbc-divider-width', config.divider_width || (divider === 'border' ? CARD_BORDER_WIDTH : '1px'));
      el.style.setProperty('--sbc-divider-color', config.divider_color || (divider === 'border' ? CARD_BORDER_COLOR : 'var(--divider-color, #e0e0e0)'));
      el.style.setProperty('--sbc-divider-inset', divider === 'line' ? '20%' : '0px');
    } else if (divider === 'gap') {
      el.style.setProperty('--sbc-gap', gap);
      el.style.setProperty('--sbc-segment-border', (config.divider_width || CARD_BORDER_WIDTH) + ' solid ' + (config.divider_color || CARD_BORDER_COLOR));
      el.style.setProperty('--sbc-segment-radius', 'max(0px, calc(var(--ha-card-border-radius, 12px) - ' + gap + '))');
    }
    if (config.menu_back_size) el.style.setProperty('--sbc-back-size', config.menu_back_size);
    if (config.menu_back_color) el.style.setProperty('--sbc-back-color', cssColor(config.menu_back_color));

    var segments = normalizeButtons(config.buttons, config);
    var mode = backMode(config);
    /* back button as a regular button (menu_back: start / end) */
    var backSegment = null;
    if (mode === 'start' || mode === 'end') {
      backSegment = normalizeButtons([{}], config)[0];
      backSegment.icon = config.menu_back_icon || 'mdi:arrow-left';
      backSegment.name = config.menu_back_name || LD.t('back');
      backSegment.color = config.menu_back_color;
      backSegment.show_state = false;
      backSegment.show_toggle = false;
      backSegment.switch_style = false;
      backSegment.state_background = false;
      backSegment.animation = undefined;
      backSegment.span = 1;
      backSegment.row_span = 1;
      backSegment.tap_action = { action: BACK_ACTION };
      backSegment.__back = true;
    }

    var path = []; /* indices of the opened menu buttons, one per level (this browser only) */
    var menuTimer = null;
    var built = null; /* {key, items: [{b, item, update}]} of the rendered level */
    var lastRows = null;
    var lastHidden = null;

    function levelOf(p) {
      var list = segments;
      for (var i = 0; i < p.length; i++) {
        var next = list[p[i]] && list[p[i]].buttons;
        if (!next || !next.length) return null;
        list = next;
      }
      return list;
    }
    function menuParent() {
      var list = segments;
      var parent = null;
      path.forEach(function (i) {
        parent = list[i];
        list = (parent && parent.buttons) || [];
      });
      return parent;
    }
    function visibleIn(list) {
      return list.filter(function (b) {
        return !b.visibility || !b.visibility.length || LD.checkConditions(ctx, b.visibility, b.entity);
      });
    }
    function withBack(items) {
      if (!backSegment) return items;
      return mode === 'start' ? [backSegment].concat(items) : items.concat([backSegment]);
    }
    function gridItems(shown) {
      return path.length ? withBack(shown) : shown;
    }
    function columnsFor(items) {
      var configured = path.length ? (menuParent() || {}).menu_columns : config.columns;
      return configured || Math.max(items.length, 1);
    }
    /* Unless the card resizes with its menus, it keeps the size of its largest level. */
    function rowsFor(items, columns) {
      var rows = countRows(items, columns);
      if (config.menu_resize) return rows;
      allSegments(segments).forEach(function (m) {
        if (!m.buttons || !m.buttons.length) return;
        var segs = withBack(m.buttons);
        rows = Math.max(rows, countRows(segs, m.menu_columns || segs.length));
      });
      return rows;
    }

    function restartMenuTimer() {
      clearTimeout(menuTimer);
      var timeout = config.menu_timeout !== undefined ? config.menu_timeout : DEFAULT_MENU_TIMEOUT;
      if (!timeout || !path.length) return;
      menuTimer = setTimeout(function () { navigate([]); }, timeout * 1000);
    }

    function navigate(newPath, animateFn) {
      clearTimeout(menuTimer);
      if (newPath.join('/') === path.join('/')) return;
      path = newPath;
      restartMenuTimer();
      render();
      if (animateFn) animateFn();
      else animate(body, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }

    function back() {
      navigate(path.slice(0, -1));
    }

    function openMenu(b, origin) {
      var level = levelOf(path) || segments;
      var index = level.indexOf(b);
      if (index < 0) return;
      var before = body.getBoundingClientRect();
      var from = origin.getBoundingClientRect();
      navigate(path.concat([index]), function () {
        /* the menu splits out of the tapped button */
        var now = body.getBoundingClientRect();
        var sx = now.width / before.width;
        var sy = now.height / before.height;
        var inset = [(from.top - before.top) * sy, (before.right - from.right) * sx, (before.bottom - from.bottom) * sy, (from.left - before.left) * sx]
          .map(function (v) { return Math.max(0, v) + 'px'; })
          .join(' ');
        var timing = { duration: 340, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
        animate(body, [{ clipPath: 'inset(' + inset + ')' }, { clipPath: 'inset(0px 0px 0px 0px)' }], timing);
        var ox = (from.left + from.width / 2 - before.left) * sx + now.left;
        var oy = (from.top + from.height / 2 - before.top) * sy + now.top;
        var parts = body.querySelectorAll('.ld-sbc-item, .ld-sbc-back');
        for (var i = 0; i < parts.length; i++) {
          var r = parts[i].getBoundingClientRect();
          var dx = (ox - (r.left + r.width / 2)) * 0.6;
          var dy = (oy - (r.top + r.height / 2)) * 0.6;
          animate(parts[i], [{ transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(0.85)', opacity: 0 }, { transform: 'none', opacity: 1 }], timing);
        }
      });
    }

    /* every button action passes here first */
    function onAction(action, origin) {
      if (action.action === MENU_ACTION) {
        var found = built && built.items.filter(function (x) { return x.item === origin; })[0];
        if (found) openMenu(found.b, origin);
        return true;
      }
      if (action.action === BACK_ACTION) {
        back();
        return true;
      }
      if (action.action === DONE_ACTION) {
        /* a menu button ran its action: return to the start shortly after */
        if (!path.length) return true;
        var parent = menuParent();
        var close = parent && parent.menu_close_on_action !== undefined ? parent.menu_close_on_action : LD.def(config.menu_close_on_action, true);
        if (close) {
          clearTimeout(menuTimer);
          menuTimer = setTimeout(function () { navigate([]); }, 350);
        }
        return true;
      }
      return false;
    }

    /* back strip or corner button, outside the grid */
    var backEl = h('div', 'ld-sbc-back');
    var backIcon = LD.icon(null);
    backEl.appendChild(backIcon);
    LD.bindGestures(backEl, { tap: back });
    backEl.classList.add('ld-clickable');

    el.addEventListener('pointerdown', function () { if (path.length) restartMenuTimer(); }, true);
    escHandlers.push(function () {
      if (!el.isConnected) return false;
      if (path.length) back();
      return true;
    });

    function render() {
      var level = levelOf(path);
      if (!level) {
        path = [];
        level = segments;
      }
      var shown = visibleIn(level);
      var items = gridItems(shown);
      var columns = columnsFor(items);
      var key = path.join('/') + '|' + items.map(function (b) { return b.__back ? 'back' : level.indexOf(b); }).join(',') + '|' + columns;
      if (!built || built.key !== key) {
        /* new elements per level, so no state or transition carries over */
        var reuse = built && built.path === path.join('/') ? built.items : [];
        var nextItems = items.map(function (b) {
          var old = reuse.filter(function (x) { return x.b === b; })[0];
          return old || buildSegment(b, ctx, onAction);
        });
        LD.clear(grid);
        nextItems.forEach(function (x) {
          x.item.style.gridColumn = 'span ' + Math.min(x.b.span || 1, columns);
          x.item.style.gridRow = 'span ' + (x.b.row_span || 1);
          grid.appendChild(x.item);
        });
        grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
        built = { key: key, path: path.join('/'), items: nextItems };

        var m = path.length ? mode : 'none';
        body.className = 'ld-sbc-body ld-sbc-has-back-' + m;
        if (backEl.parentNode) backEl.parentNode.removeChild(backEl);
        if (m !== 'none' && m !== 'start' && m !== 'end') {
          var corner = m.indexOf('_') !== -1;
          backEl.className = 'ld-sbc-back ld-clickable ld-sbc-back-' + m + (corner ? ' ld-sbc-corner' : ' ld-sbc-strip');
          LD.setIcon(backIcon, config.menu_back_icon || (corner ? 'mdi:arrow-left' : 'mdi:chevron-left'));
          if (m === 'left' || m === 'top') body.insertBefore(backEl, grid);
          else body.appendChild(backEl);
        }

        /* same footprint as a native button (6 x 2) per row of segments */
        var rows = rowsFor(items, columns);
        if (rows !== lastRows) {
          lastRows = rows;
          card.grid = { columns: 6, rows: rows * 2, min_columns: 2, min_rows: rows };
          if (card.relayout) card.relayout();
        }
      }
      var hidden = shown.length === 0 && !path.length;
      if (hidden !== lastHidden) {
        lastHidden = hidden;
        el.style.display = hidden ? 'none' : '';
        if (card.onVisibility) card.onVisibility(!hidden);
      }
      built.items.forEach(function (x) { x.update(); });
    }

    var all = allSegments(segments);
    var deps = [];
    var usesTime = false;
    var usesScreen = false;
    all.forEach(function (b) {
      if (b.entity) deps.push(b.entity);
      if (b.visibility) {
        deps = deps.concat(LD.conditionEntities(b.visibility));
        if (LD.conditionsUseTime(b.visibility)) usesTime = true;
        if (LD.conditionsUseScreen(b.visibility)) usesScreen = true;
      }
      ['tap_action', 'hold_action', 'double_tap_action'].forEach(function (k) {
        if (b[k] && b[k].entity) deps.push(b[k].entity);
      });
    });

    var card = {
      el: el,
      deps: deps,
      watchScreen: usesScreen,
      watchTime: usesTime,
      grid: { columns: 6, rows: 2, min_columns: 2, min_rows: 1 },
      update: render,
    };
    return card;
  };
})();
