/* Lite Dashboard - views: sections (same grid math as HA), masonry, panel, sidebar. */
(function () {
  'use strict';
  var LD = window.LD;
  var h = LD.h;

  function cssPx(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  /* Place a card in a sections grid slot with HA's sizing rules. */
  function mountGridCard(container, card, ctx, gridColumns) {
    var slot = h('div', 'ld-slot');
    var size = LD.cardGrid(card);
    if (size.columns === 'full') slot.classList.add('ld-full');
    else slot.style.gridColumn = 'span ' + Math.min(typeof size.columns === 'number' ? size.columns : 12, gridColumns);
    if (typeof size.rows === 'number') {
      var rowH = cssPx('--ha-section-grid-row-height', 56);
      var gap = cssPx('--ha-section-grid-row-gap', 8);
      slot.classList.add('ld-fit-rows');
      slot.style.gridRow = 'span ' + size.rows;
      slot.style.height = size.rows * (rowH + gap) - gap + 'px';
      if (size.rows < 5) card.el.classList.add('ld-rows-small');
    }
    slot.appendChild(card.el);
    container.appendChild(slot);

    var vis = card.config.visibility;
    var condShown = true;
    var cardShown = true;
    function apply() {
      slot.style.display = condShown && cardShown ? '' : 'none';
    }
    if (vis) {
      var check = function () {
        condShown = LD.checkConditions(ctx, vis);
        apply();
      };
      ctx.watchIds(LD.conditionEntities(vis), check, LD.conditionsUseScreen(vis));
      check();
    }
    card.onVisibility = function (shown) {
      cardShown = shown;
      apply();
    };
    return slot;
  }

  function buildSection(section, ctx, maxSpan) {
    var span = Math.min(section.column_span || 1, maxSpan);
    var el = h('div', 'ld-section');
    el.style.gridColumn = 'span ' + span;
    if (section.row_span) el.style.gridRow = 'span ' + section.row_span;
    var grid = h('div', 'ld-section-grid');
    grid.style.gridTemplateColumns = 'repeat(' + 12 * span + ', minmax(0, 1fr))';
    el.appendChild(grid);
    var cards = section.cards || [];
    if (section.title) cards = [{ type: 'heading', heading: section.title }].concat(cards);
    cards.forEach(function (cfg) {
      mountGridCard(grid, LD.createCard(cfg, ctx), ctx, 12 * span);
    });
    if (section.visibility) {
      var apply = function () { el.style.display = LD.checkConditions(ctx, section.visibility) ? '' : 'none'; };
      ctx.watchIds(LD.conditionEntities(section.visibility), apply, LD.conditionsUseScreen(section.visibility));
      apply();
    }
    return el;
  }

  function buildBadges(view, ctx) {
    var badges = view.badges || [];
    if (!badges.length) return null;
    return LD.createCard({ type: 'heading', heading: '', heading_style: 'subtitle', badges: badges }, ctx).el;
  }

  /* Column count exactly like hui-sections-view: floor((w - pad + gap) / (min + gap)). */
  function sectionsColumnCount(width, maxColumns) {
    var min = cssPx('--ha-view-sections-column-min-width', 320);
    var gap = width <= 600 ? cssPx('--ha-view-sections-narrow-column-gap', 8) : cssPx('--ha-view-sections-column-gap', 32);
    var count = Math.floor((width - 2 * gap + gap) / (min + gap));
    return Math.max(1, Math.min(count, maxColumns || 4));
  }

  LD.buildView = function (view, ctx, width) {
    var type = view.type || (view.panel ? 'panel' : 'masonry');
    var root = h('div', 'ld-view ld-view-' + type);
    if (view.background) root.style.background = typeof view.background === 'string' ? view.background : '';

    if (type === 'sections') {
      var cols = sectionsColumnCount(width, view.max_columns);
      root.style.setProperty('--ld-column-count', cols);
      var badges = buildBadges(view, ctx);
      if (badges) root.appendChild(h('div', 'ld-view-badges')).appendChild(badges);
      if (view.header && view.header.card) root.appendChild(LD.createCard(view.header.card, ctx).el);
      var wrap = h('div', 'ld-sections' + (view.dense_section_placement ? ' ld-dense' : ''));
      wrap.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      (view.sections || []).forEach(function (s) { wrap.appendChild(buildSection(s, ctx, cols)); });
      root.appendChild(wrap);
      (view.cards || []).forEach(function (c) { root.appendChild(LD.createCard(c, ctx).el); });
      return { el: root, columns: cols };
    }

    if (type === 'panel') {
      var first = (view.cards || [])[0];
      if (first) root.appendChild(LD.createCard(first, ctx).el);
      return { el: root };
    }

    if (type === 'sidebar') {
      var main = h('div', 'ld-sidebar-main');
      var side = h('div', 'ld-sidebar-side');
      (view.cards || []).forEach(function (c) {
        var card = LD.createCard(c, ctx);
        (c.view_layout && c.view_layout.position === 'sidebar' ? side : main).appendChild(card.el);
      });
      root.appendChild(main);
      root.appendChild(side);
      return { el: root };
    }

    /* masonry: distribute by estimated size into the shortest column */
    var b = buildBadges(view, ctx);
    if (b) root.appendChild(h('div', 'ld-view-badges')).appendChild(b);
    /* hui-masonry-view: one column per matched breakpoint (300/600/900/1200 px) */
    var count = Math.max(1, [300, 600, 900, 1200].filter(function (w) { return width >= w; }).length);
    var columnsEl = h('div', 'ld-masonry');
    columnsEl.style.gridTemplateColumns = 'repeat(' + count + ', minmax(0, 1fr))';
    var columns = [];
    var heights = [];
    for (var i = 0; i < count; i++) {
      columns.push(columnsEl.appendChild(h('div', 'ld-masonry-col')));
      heights.push(0);
    }
    (view.cards || []).forEach(function (c) {
      var card = LD.createCard(c, ctx);
      var idx = heights.indexOf(Math.min.apply(null, heights));
      var wrap = LD.mountChild(columns[idx], card, ctx);
      void wrap;
      heights[idx] += estimateSize(c);
    });
    root.appendChild(columnsEl);
    return { el: root };
  };

  function estimateSize(c) {
    switch (c.type) {
      case 'entities': return 1 + (c.entities || []).length;
      case 'tile': return 1 + (c.features || []).length;
      case 'thermostat': return 7;
      case 'weather-forecast': return 4;
      case 'glance': return 3;
      case 'vertical-stack': return (c.cards || []).reduce(function (s, x) { return s + estimateSize(x); }, 0);
      default: return 3;
    }
  }

  /* ---------------------------------------------------------------- theme */

  LD.applyTheme = function (themes, name) {
    var root = document.documentElement;
    (LD._themeKeys || []).forEach(function (k) { root.style.removeProperty('--' + k); });
    LD._themeKeys = [];
    var all = (themes && themes.themes) || {};
    var themeName = name && all[name] ? name : themes && themes.default_theme;
    var theme = themeName && all[themeName];
    var dark = false;
    if (theme) {
      var vars = Object.assign({}, theme);
      if (theme.modes) {
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var mode = theme.modes.dark && (prefersDark || !theme.modes.light) ? 'dark' : 'light';
        dark = mode === 'dark';
        delete vars.modes;
        Object.assign(vars, theme.modes[mode] || {});
      }
      Object.keys(vars).forEach(function (k) {
        if (typeof vars[k] !== 'string' && typeof vars[k] !== 'number') return;
        if (k.indexOf('card-mod') === 0) return;
        root.style.setProperty('--' + k, String(vars[k]));
        LD._themeKeys.push(k);
      });
      if (!theme.modes) {
        var bg = vars['primary-background-color'];
        dark = bg ? isDarkColor(bg) : false;
      }
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      dark = true;
    }
    root.classList.toggle('ld-dark', dark);
  };

  function isDarkColor(c) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(c).trim());
    if (!m) return false;
    var n = parseInt(m[1], 16);
    var l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return l < 128;
  }
})();
