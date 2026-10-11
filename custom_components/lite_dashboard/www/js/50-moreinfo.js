/* Lite Dashboard - compact more-info dialog. */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;

  LD.moreInfo = {};

  function bigToggle(ctx, id) {
    var wrap = h('div', 'ld-mi-toggle');
    var sw = h('div', 'ld-switch ld-switch-big');
    sw.appendChild(h('div', 'ld-switch-bg'));
    var knob = h('div', 'ld-switch-knob');
    var icon = LD.icon(null);
    knob.appendChild(icon);
    sw.appendChild(knob);
    wrap.appendChild(sw);
    LD.bindGestures(sw, { tap: function () { ctx.hass.toggle(id); } });
    return {
      el: wrap,
      update: function (st) {
        var on = !!st && st.state === 'on';
        LD.setClass(sw, 'on', on);
        LD.setIcon(icon, LD.domain(id) === 'light' ? (on ? 'mdi:lightbulb' : 'mdi:lightbulb-off') : on ? 'mdi:power' : 'mdi:power-off');
        LD.setStyle(sw, '--ld-feature-color', LD.stateColor(st));
      },
    };
  }

  function slider(label, min, max, step, onChange) {
    var wrap = h('div', 'ld-mi-slider');
    var head = h('div', 'ld-mi-slider-head');
    var name = h('span', null, label);
    var val = h('span', 'ld-mi-slider-val');
    head.appendChild(name);
    head.appendChild(val);
    var input = h('input', 'ld-range ld-range-big');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    wrap.appendChild(head);
    wrap.appendChild(input);
    var fmt = function (v) { return String(v); };
    input.addEventListener('input', function () {
      LD.setText(val, fmt(Number(input.value)));
      LD.setStyle(input, '--ld-range-pct', ((input.value - min) / (max - min)) * 100 + '%');
    });
    input.addEventListener('change', function () { onChange(Number(input.value)); });
    return {
      el: wrap,
      input: input,
      setFormat: function (f) { fmt = f; },
      set: function (v, color) {
        if (document.activeElement === input) return;
        if (String(v) !== input.value) input.value = String(v);
        LD.setText(val, fmt(v));
        LD.setStyle(input, '--ld-range-pct', ((v - min) / (max - min)) * 100 + '%');
        if (color) LD.setStyle(input, '--ld-feature-color', color);
      },
    };
  }

  function buttonRow(items, onTap) {
    var row = h('div', 'ld-mi-buttons');
    var map = {};
    items.forEach(function (it) {
      var b = h('button', 'ld-mi-btn');
      if (it.icon) b.appendChild(LD.icon(it.icon));
      if (it.label) b.appendChild(h('span', null, it.label));
      LD.bindGestures(b, { tap: function () { onTap(it.value); } });
      row.appendChild(b);
      map[it.value] = b;
    });
    return {
      el: row,
      select: function (value) {
        Object.keys(map).forEach(function (k) { LD.setClass(map[k], 'on', k === String(value)); });
      },
    };
  }

  var COLOR_PRESETS = [[255, 147, 41], [255, 197, 143], [255, 255, 255], [255, 0, 0], [255, 128, 0], [255, 230, 0], [0, 200, 0], [0, 180, 255], [0, 60, 255], [160, 0, 255], [255, 0, 160]];

  function lightBody(ctx, id, body) {
    var hass = ctx.hass;
    var toggle = bigToggle(ctx, id);
    body.appendChild(toggle.el);
    var st0 = hass.state(id);
    var modes = (st0 && st0.attributes.supported_color_modes) || [];
    var dimmable = modes.some(function (m) { return m !== 'onoff'; });
    var hasCt = modes.indexOf('color_temp') !== -1;
    var hasColor = modes.some(function (m) { return ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].indexOf(m) !== -1; });
    var bri = null;
    var ct = null;
    if (dimmable) {
      bri = slider(LD.t('brightness'), 1, 100, 1, function (v) { hass.callService('light', 'turn_on', { entity_id: id, brightness_pct: v }); });
      bri.setFormat(function (v) { return v + ' %'; });
      body.appendChild(bri.el);
    }
    if (hasCt) {
      var a = st0.attributes;
      var minK = a.min_color_temp_kelvin || 2000;
      var maxK = a.max_color_temp_kelvin || 6500;
      ct = slider(LD.t('color_temp'), minK, maxK, 50, function (v) { hass.callService('light', 'turn_on', { entity_id: id, color_temp_kelvin: v }); });
      ct.setFormat(function (v) { return v + ' K'; });
      ct.input.classList.add('ld-range-ct');
      body.appendChild(ct.el);
    }
    if (hasColor) {
      var row = h('div', 'ld-mi-colors');
      COLOR_PRESETS.forEach(function (rgb) {
        var sw = h('button', 'ld-mi-color');
        sw.style.background = 'rgb(' + rgb.join(',') + ')';
        LD.bindGestures(sw, { tap: function () { hass.callService('light', 'turn_on', { entity_id: id, rgb_color: rgb }); } });
        row.appendChild(sw);
      });
      body.appendChild(row);
    }
    return function (st) {
      toggle.update(st);
      var on = st && st.state === 'on';
      if (bri) bri.set(on && st.attributes.brightness ? Math.max(1, Math.round((st.attributes.brightness / 255) * 100)) : 0, LD.stateColor(st));
      if (ct && on && st.attributes.color_temp_kelvin) ct.set(st.attributes.color_temp_kelvin);
    };
  }

  function climateBody(ctx, id, body) {
    var hass = ctx.hass;
    var unit = (hass.config.unit_system && hass.config.unit_system.temperature) || '°C';
    var top = h('div', 'ld-mi-climate');
    var cur = h('div', 'ld-mi-climate-cur');
    var curLabel = h('div', 'ld-mi-label', LD.t('current'));
    var curVal = h('div', 'ld-mi-climate-val');
    cur.appendChild(curLabel);
    cur.appendChild(curVal);
    var tgt = h('div', 'ld-mi-climate-tgt');
    var minus = h('button', 'ld-step ld-step-big');
    minus.appendChild(LD.icon('mdi:minus'));
    var tgtBox = h('div', 'ld-mi-climate-tgtbox');
    var tgtLabel = h('div', 'ld-mi-label', LD.t('target'));
    var tgtVal = h('div', 'ld-mi-climate-val ld-mi-target');
    tgtBox.appendChild(tgtLabel);
    tgtBox.appendChild(tgtVal);
    var plus = h('button', 'ld-step ld-step-big');
    plus.appendChild(LD.icon('mdi:plus'));
    tgt.appendChild(minus);
    tgt.appendChild(tgtBox);
    tgt.appendChild(plus);
    top.appendChild(cur);
    top.appendChild(tgt);
    body.appendChild(top);
    var action = h('div', 'ld-mi-sub');
    body.appendChild(action);

    var pending = null;
    var timer = null;
    function step(dir) {
      var st = hass.state(id);
      if (!st) return;
      var a = st.attributes;
      var s = a.target_temp_step || 0.5;
      var base = pending !== null ? pending : Number(a.temperature);
      if (!isFinite(base)) return;
      pending = Math.max(a.min_temp, Math.min(a.max_temp, Math.round((base + dir * s) / s) * s));
      pending = Number(pending.toFixed(2));
      render(st);
      clearTimeout(timer);
      timer = setTimeout(function () {
        var t = pending;
        hass.callService('climate', 'set_temperature', { entity_id: id, temperature: t }).then(
          function () { setTimeout(function () { pending = null; render(hass.state(id)); }, 1500); },
          function () { pending = null; render(hass.state(id)); }
        );
      }, 700);
    }
    LD.bindGestures(minus, { tap: function () { step(-1); } });
    LD.bindGestures(plus, { tap: function () { step(1); } });

    var st0 = hass.state(id);
    var modesRow = null;
    var presetRow = null;
    if (st0 && st0.attributes.hvac_modes && st0.attributes.hvac_modes.length > 1) {
      body.appendChild(h('div', 'ld-mi-label', LD.t('mode')));
      modesRow = buttonRow(
        st0.attributes.hvac_modes.map(function (m) {
          return { value: m, label: hass.formatState(st0, m), icon: { off: 'mdi:power', heat: 'mdi:fire', cool: 'mdi:snowflake', heat_cool: 'mdi:sun-snowflake-variant', auto: 'mdi:thermostat-auto', dry: 'mdi:water-percent', fan_only: 'mdi:fan' }[m] };
        }),
        function (m) { hass.callService('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: m }); }
      );
      body.appendChild(modesRow.el);
    }
    if (st0 && st0.attributes.preset_modes && st0.attributes.preset_modes.length) {
      body.appendChild(h('div', 'ld-mi-label', LD.t('preset')));
      presetRow = buttonRow(
        st0.attributes.preset_modes.map(function (m) { return { value: m, label: hass.formatAttr(st0, 'preset_mode', m) }; }),
        function (m) { hass.callService('climate', 'set_preset_mode', { entity_id: id, preset_mode: m }); }
      );
      body.appendChild(presetRow.el);
    }

    function render(st) {
      if (!st) return;
      var a = st.attributes;
      LD.setText(curVal, a.current_temperature !== undefined ? LD.formatNumber(a.current_temperature, 1) + ' ' + unit : '–');
      var t = pending !== null ? pending : a.temperature;
      LD.setText(tgtVal, t !== undefined && t !== null ? LD.formatNumber(t, (a.target_temp_step || 0.5) < 1 ? 1 : 0) + ' ' + unit : '–');
      LD.setStyle(tgtVal, 'color', st.state !== 'off' ? LD.stateColor(st) : '');
      var parts = [hass.formatState(st)];
      if (a.hvac_action) parts.push(hass.formatAttr(st, 'hvac_action'));
      if (a.current_humidity !== undefined) parts.push(LD.t('humidity') + ' ' + a.current_humidity + ' %');
      LD.setText(action, parts.join(' · '));
      if (modesRow) modesRow.select(st.state);
      if (presetRow) presetRow.select(a.preset_mode);
    }
    return render;
  }

  function coverBody(ctx, id, body) {
    var hass = ctx.hass;
    var row = buttonRow(
      [{ value: 'open_cover', icon: 'mdi:arrow-up', label: LD.t('open') }, { value: 'stop_cover', icon: 'mdi:stop', label: LD.t('stop') }, { value: 'close_cover', icon: 'mdi:arrow-down', label: LD.t('close') }],
      function (svc) { hass.callService('cover', svc, { entity_id: id }); }
    );
    body.appendChild(row.el);
    var st0 = hass.state(id);
    var pos = null;
    if (st0 && st0.attributes.current_position !== undefined) {
      pos = slider(LD.t('position'), 0, 100, 1, function (v) { hass.callService('cover', 'set_cover_position', { entity_id: id, position: v }); });
      pos.setFormat(function (v) { return v + ' %'; });
      body.appendChild(pos.el);
    }
    return function (st) {
      if (pos && st) pos.set(st.attributes.current_position || 0, LD.stateColor(st));
    };
  }

  function weatherBody(ctx, id, body) {
    var card = LD.cardTypes['weather-forecast']({ entity: id, forecast_type: 'daily', tap_action: { action: 'none' } }, ctx);
    card.el.classList.add('ld-mi-weather');
    body.appendChild(card.el);
    return function () { card.update(); };
  }

  function genericBody(ctx, id, body) {
    var hass = ctx.hass;
    var d = LD.domain(id);
    var big = h('div', 'ld-mi-state');
    body.appendChild(big);
    var extra = null;
    if (d === 'script' || d === 'scene' || d === 'button' || d === 'input_button') {
      extra = h('button', 'ld-btn ld-btn-primary ld-mi-run', d === 'button' || d === 'input_button' ? LD.t('press') : LD.t('run'));
      LD.bindGestures(extra, {
        tap: function () {
          if (d === 'script') hass.callService('script', 'turn_on', { entity_id: id });
          else hass.toggle(id);
        },
      });
      body.appendChild(extra);
    } else if (d === 'lock') {
      var lockRow = buttonRow([{ value: 'lock', icon: 'mdi:lock', label: LD.t('lock') }, { value: 'unlock', icon: 'mdi:lock-open-variant', label: LD.t('unlock') }], function (svc) {
        hass.callService('lock', svc, { entity_id: id });
      });
      body.appendChild(lockRow.el);
    } else if (LD.canToggle(id)) {
      var toggle = bigToggle(ctx, id);
      body.insertBefore(toggle.el, big);
      extra = toggle;
    }
    var changed = h('div', 'ld-mi-sub');
    body.appendChild(changed);
    var attrs = h('div', 'ld-mi-attrs');
    body.appendChild(attrs);
    var SKIP = { friendly_name: 1, icon: 1, entity_picture: 1, unit_of_measurement: 1, supported_features: 1, device_class: 1, state_class: 1, attribution: 1, editable: 1, id: 1, entity_id: 1, restored: 1 };
    return function (st) {
      if (!st) return;
      LD.setText(big, hass.formatState(st));
      LD.setText(changed, LD.t('last_changed') + ': ' + LD.relativeTime(st.last_changed));
      if (extra && extra.update) extra.update(st);
      var keys = Object.keys(st.attributes).filter(function (k) { return !SKIP[k] && typeof st.attributes[k] !== 'object'; });
      var sig = keys.map(function (k) { return k + '=' + st.attributes[k]; }).join('|');
      if (attrs.__sig === sig) return;
      attrs.__sig = sig;
      LD.clear(attrs);
      keys.slice(0, 20).forEach(function (k) {
        var r = h('div', 'ld-mi-attr');
        r.appendChild(h('span', null, hass.attrName(st, k)));
        r.appendChild(h('span', null, hass.formatAttr(st, k)));
        attrs.appendChild(r);
      });
    };
  }

  LD.moreInfo.open = function (ctx, id) {
    var hass = ctx.hass;
    var st = hass.state(id);
    var box = h('div', 'ld-mi');
    var head = h('div', 'ld-mi-head');
    var icon = LD.iconBox('ld-mi-icon');
    var title = h('div', 'ld-mi-title');
    var close = h('button', 'ld-mi-close');
    close.appendChild(LD.icon('mdi:close'));
    head.appendChild(icon);
    head.appendChild(title);
    head.appendChild(close);
    box.appendChild(head);
    var body = h('div', 'ld-mi-body');
    box.appendChild(body);

    var d = LD.domain(id);
    var render;
    if (d === 'light') render = lightBody(ctx, id, body);
    else if (d === 'climate') render = climateBody(ctx, id, body);
    else if (d === 'cover') render = coverBody(ctx, id, body);
    else if (d === 'weather') render = weatherBody(ctx, id, body);
    else render = genericBody(ctx, id, body);

    var stop = null;
    var dlg = LD.dialogs.open(box, {
      cls: 'ld-dialog-mi',
      onClose: function () {
        if (stop) stop();
      },
    });
    close.addEventListener('click', function () { dlg.close(); });

    function update() {
      var s = hass.state(id);
      LD.setText(title, hass.entityName(s, id));
      LD.setIconBox(icon, hass.entityIcon(s));
      LD.setStyle(icon, 'color', LD.stateActive(s) ? LD.stateColor(s) : '');
      render(s);
    }
    stop = ctx.watchIds([id], update);
    update();
    void st;
  };
})();
