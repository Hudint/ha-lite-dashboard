/* Lite Dashboard - gestures, actions, visibility conditions, dialogs. */
(function () {
  'use strict';
  var LD = window.LD;

  var HOLD_MS = 500;
  var DOUBLE_TAP_MS = 250;
  var MOVE_TOLERANCE = 12;

  function hasAction(a) {
    return !!a && a.action !== 'none';
  }

  /* Bind tap / hold / double tap on an element.
   * handlers: {tap: fn, hold: fn|null, doubleTap: fn|null}
   * Tap fires on pointerup right away unless a double tap handler exists. */
  LD.bindGestures = function (el, handlers) {
    var startX = 0;
    var startY = 0;
    var holdTimer = null;
    var held = false;
    var active = false;
    var lastTap = 0;
    var tapTimer = null;

    function clearHold() {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest('[data-ld-stop]') && ev.target.closest('[data-ld-stop]') !== el) return;
      active = true;
      held = false;
      startX = ev.clientX;
      startY = ev.clientY;
      el.classList.add('ld-pressed');
      if (handlers.hold) {
        holdTimer = setTimeout(function () {
          held = true;
          el.classList.remove('ld-pressed');
          handlers.hold();
        }, HOLD_MS);
      }
    });
    el.addEventListener('pointermove', function (ev) {
      if (!active) return;
      if (Math.abs(ev.clientX - startX) > MOVE_TOLERANCE || Math.abs(ev.clientY - startY) > MOVE_TOLERANCE) {
        active = false;
        clearHold();
        el.classList.remove('ld-pressed');
      }
    });
    function cancel() {
      active = false;
      clearHold();
      el.classList.remove('ld-pressed');
    }
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointerup', function (ev) {
      if (!active) return;
      active = false;
      clearHold();
      el.classList.remove('ld-pressed');
      if (held) return;
      ev.preventDefault();
      if (handlers.doubleTap) {
        var now = Date.now();
        if (tapTimer && now - lastTap < DOUBLE_TAP_MS) {
          clearTimeout(tapTimer);
          tapTimer = null;
          handlers.doubleTap();
          return;
        }
        lastTap = now;
        tapTimer = setTimeout(function () {
          tapTimer = null;
          if (handlers.tap) handlers.tap();
        }, DOUBLE_TAP_MS);
        return;
      }
      if (handlers.tap) handlers.tap();
    });
    el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  };

  /* Bind the standard lovelace action config of a card to an element.
   * defaults: {tap_action, hold_action, double_tap_action} used when the config has none. */
  LD.bindActions = function (el, ctx, config, entityId, defaults) {
    defaults = defaults || {};
    function pick(key) {
      return config[key] || defaults[key] || null;
    }
    var tap = pick('tap_action');
    var hold = pick('hold_action');
    var dbl = pick('double_tap_action');
    var interactive = hasAction(tap) || hasAction(hold) || hasAction(dbl);
    if (interactive) el.classList.add('ld-clickable');
    LD.bindGestures(el, {
      tap: hasAction(tap) ? function () { LD.runAction(ctx, tap, entityId); } : null,
      hold: hasAction(hold) ? function () { LD.runAction(ctx, hold, entityId); } : null,
      doubleTap: hasAction(dbl) ? function () { LD.runAction(ctx, dbl, entityId); } : null,
    });
    return interactive;
  };

  LD.runAction = function (ctx, action, entityId) {
    if (!action || action.action === 'none') return;
    var conf = action.confirmation;
    if (conf) {
      var exempt = conf.exemptions && conf.exemptions.some(function (e) { return ctx.hass.user && e.user === ctx.hass.user.id; });
      if (!exempt) {
        var text = typeof conf === 'object' && conf.text ? conf.text : LD.t('confirm_action');
        LD.dialogs.confirm(text).then(function (ok) {
          if (ok) execute(ctx, action, entityId);
        });
        return;
      }
    }
    execute(ctx, action, entityId);
  };

  function execute(ctx, action, entityId) {
    var hass = ctx.hass;
    var target = action.entity || entityId;
    switch (action.action) {
      case 'toggle':
        if (target) hass.toggle(target);
        break;
      case 'more-info':
        if (target) LD.moreInfo.open(ctx, target);
        break;
      case 'perform-action':
      case 'call-service': {
        var svc = action.perform_action || action.service;
        if (!svc) return;
        var parts = svc.split('.');
        var data = Object.assign({}, action.service_data || {}, action.data || {});
        hass.callService(parts[0], parts[1], data, action.target).catch(function () {});
        break;
      }
      case 'navigate':
        if (action.navigation_path) LD.navigate(action.navigation_path, action.navigation_replace);
        break;
      case 'url':
        if (action.url_path) window.open(action.url_path, '_blank');
        break;
      default:
        /* assist, fire-dom-event (browser_mod) etc. are not available here */
        console.info('[lite-dashboard] action not supported:', action.action);
    }
  }

  /* -------------------------------------------------------- conditions
   * Same semantics as the HA frontend's checkConditionsMet(). */

  /* Like split-button-card (and harmless elsewhere): accept "entity_id" as well as
   * "entity", and fall back to the entity of the element the condition belongs to. */
  function condEntity(cond, fallback) {
    return cond.entity || cond.entity_id || fallback;
  }

  function stateOf(ctx, cond, fallback) {
    var id = condEntity(cond, fallback);
    var st = id ? ctx.hass.state(id) : undefined;
    if (!st) return undefined;
    return cond.attribute ? st.attributes[cond.attribute] : st.state;
  }

  function refValue(ctx, v) {
    if (typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v)) {
      var st = ctx.hass.state(v);
      return st ? st.state : v;
    }
    return v;
  }

  function checkOne(ctx, c, fallback) {
    var type = c.condition;
    if (!type) {
      /* legacy conditional-card format: {entity, state, state_not} */
      if (c.state !== undefined || c.state_not !== undefined) type = 'state';
      else return true;
    }
    switch (type) {
      case 'state': {
        var s = stateOf(ctx, c, fallback);
        if (c.state !== undefined) {
          return LD.asArray(c.state).map(function (v) { return String(refValue(ctx, v)); }).indexOf(String(s)) !== -1;
        }
        if (c.state_not !== undefined) {
          return LD.asArray(c.state_not).map(function (v) { return String(refValue(ctx, v)); }).indexOf(String(s)) === -1;
        }
        return true;
      }
      case 'numeric_state': {
        var n = Number(stateOf(ctx, c, fallback));
        if (isNaN(n)) return false;
        var above = Number(refValue(ctx, c.above));
        var below = Number(refValue(ctx, c.below));
        return (c.above === undefined || isNaN(above) || above < n) && (c.below === undefined || isNaN(below) || below > n);
      }
      case 'screen':
        return !!c.media_query && window.matchMedia(c.media_query).matches;
      case 'user':
        return !!(c.users && ctx.hass.user && c.users.indexOf(ctx.hass.user.id) !== -1);
      case 'location':
        return true;
      case 'and':
        return !c.conditions || LD.checkConditions(ctx, c.conditions, fallback);
      case 'or':
        return !c.conditions || c.conditions.some(function (x) { return checkOne(ctx, x, fallback); });
      case 'not':
        return !c.conditions || !LD.checkConditions(ctx, c.conditions, fallback);
    }
    return true;
  }

  LD.checkConditions = function (ctx, conditions, fallbackEntity) {
    return LD.asArray(conditions).every(function (c) { return checkOne(ctx, c, fallbackEntity); });
  };

  LD.conditionEntities = function (conditions, out) {
    out = out || [];
    LD.asArray(conditions).forEach(function (c) {
      if (c.entity) out.push(c.entity);
      if (c.entity_id) out.push(c.entity_id);
      ['above', 'below'].forEach(function (k) {
        if (typeof c[k] === 'string' && c[k].indexOf('.') > 0) out.push(c[k]);
      });
      if (c.conditions) LD.conditionEntities(c.conditions, out);
    });
    return out;
  };
  LD.conditionsUseScreen = function (conditions) {
    return LD.asArray(conditions).some(function (c) {
      return c.condition === 'screen' || (c.conditions && LD.conditionsUseScreen(c.conditions));
    });
  };

  /* ------------------------------------------------------------- dialogs */

  LD.dialogs = {};

  LD.dialogs.open = function (content, opts) {
    opts = opts || {};
    var backdrop = LD.h('div', 'ld-backdrop');
    var dialog = LD.h('div', 'ld-dialog' + (opts.cls ? ' ' + opts.cls : ''));
    dialog.appendChild(content);
    backdrop.appendChild(dialog);
    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (opts.onClose) opts.onClose();
    }
    backdrop.addEventListener('pointerdown', function (ev) {
      if (ev.target === backdrop) backdrop.__downOnBackdrop = true;
    });
    backdrop.addEventListener('pointerup', function (ev) {
      if (ev.target === backdrop && backdrop.__downOnBackdrop) close();
      backdrop.__downOnBackdrop = false;
    });
    document.body.appendChild(backdrop);
    return { close: close, el: dialog };
  };

  LD.dialogs.confirm = function (text) {
    return new Promise(function (resolve) {
      var box = LD.h('div', 'ld-confirm');
      box.appendChild(LD.h('div', 'ld-confirm-text', text));
      var row = LD.h('div', 'ld-dialog-buttons');
      var cancel = LD.h('button', 'ld-btn', LD.t('cancel'));
      var ok = LD.h('button', 'ld-btn ld-btn-primary', LD.t('ok'));
      row.appendChild(cancel);
      row.appendChild(ok);
      box.appendChild(row);
      var result = false;
      var d = LD.dialogs.open(box, { onClose: function () { resolve(result); } });
      cancel.addEventListener('click', function () { d.close(); });
      ok.addEventListener('click', function () { result = true; d.close(); });
    });
  };

  /* Numeric keypad so the panel's on-screen keyboard is never needed. */
  LD.dialogs.pin = function (title, check) {
    return new Promise(function (resolve) {
      var box = LD.h('div', 'ld-pin');
      box.appendChild(LD.h('div', 'ld-pin-title', title || LD.t('enter_pin')));
      var display = LD.h('div', 'ld-pin-display');
      box.appendChild(display);
      var pad = LD.h('div', 'ld-pin-pad');
      var value = '';
      var result = false;
      var d;
      function render() {
        LD.setText(display, value.replace(/./g, '●'));
      }
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].forEach(function (k) {
        var b = LD.h('button', 'ld-pin-key', k);
        b.addEventListener('click', function () {
          if (k === 'C') value = '';
          else if (k === '⌫') value = value.slice(0, -1);
          else {
            value += k;
            var r = check(value);
            if (r === true) {
              result = true;
              d.close();
              return;
            }
          }
          display.classList.remove('ld-pin-wrong');
          render();
        });
        pad.appendChild(b);
      });
      box.appendChild(pad);
      var row = LD.h('div', 'ld-dialog-buttons');
      var cancel = LD.h('button', 'ld-btn', LD.t('cancel'));
      var ok = LD.h('button', 'ld-btn ld-btn-primary', LD.t('ok'));
      row.appendChild(cancel);
      row.appendChild(ok);
      box.appendChild(row);
      d = LD.dialogs.open(box, { cls: 'ld-dialog-narrow', onClose: function () { resolve(result); } });
      cancel.addEventListener('click', function () { d.close(); });
      ok.addEventListener('click', function () {
        if (check(value) === true) {
          result = true;
          d.close();
        } else {
          value = '';
          render();
          display.classList.add('ld-pin-wrong');
          LD.setText(display, LD.t('wrong_pin'));
        }
      });
    });
  };
})();
