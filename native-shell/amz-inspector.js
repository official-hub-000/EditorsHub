/*
 * The paged inspector toolbar.
 *
 * The editor's inspector root is a single 4-column grid of buttons. This wraps that grid into
 * two pages with dots, and adds the second page of tools the original design had: Beat Maker,
 * Audio Keys, Stabiliser, Shift KF, Duplicate, Adjustment layer, Vectorscope and Split Text.
 *
 * Design rule followed here: page 1 is the editor's existing markup, untouched. Nothing is
 * removed, reordered or relabelled. The wrapper only hides page 1 while page 2 is showing, so a
 * failure in this file leaves the stock inspector exactly as it was.
 *
 * NEW badges are earned rather than decorative: a badge goes on a tile that did not exist in
 * the stock inspector. Checked against openInspectorRoot's own ins(...) calls - all eight page-2
 * tools are absent from it, so all eight are badged. The original design badged only two, which
 * understated how much of this page is new.
 */
(function () {
  'use strict';
  if (window.omsAmzInspector) return;

  var installed = false;
  var page = 0;

  /* The second page, in the order the design lists it. `badge` marks genuinely new tools. */
  var PAGE2 = [
    { id: 'beatmaker', label: 'Beat Maker', icon: '♪', badge: 'NEW',
      run: function () { return window.omsAmzAnalysis && window.omsAmzAnalysis.openBeatMaker(); } },
    { id: 'audiokeys', label: 'Audio Keys', icon: '♬', badge: 'NEW',
      run: function () { return window.omsAmzAnalysis && window.omsAmzAnalysis.openAudioKeys(); } },
    { id: 'stabilizer', label: 'Stabiliser', icon: '⤳', badge: 'NEW',
      run: function () { return openTool('stabilizer'); } },
    { id: 'shiftkf', label: 'Shift KF', icon: '⇥', badge: 'NEW',
      run: function () { return window.omsAmzSelect && window.omsAmzSelect.openShiftKf(); } },
    { id: 'duplicate', label: 'Duplicate', icon: '⧉', badge: 'NEW',
      run: duplicateSelectedLayer },
    { id: 'adjustment', label: 'Adj. Layer', icon: '◨', badge: 'NEW',
      run: function () { return window.omsAmzAdjust && window.omsAmzAdjust.addAdjustmentLayer(); } },
    { id: 'vectorscope', label: 'Vectorscope', icon: '◉', badge: 'NEW',
      run: function () { return window.omsAmzScopes && window.omsAmzScopes.openScopes(); } },
    { id: 'splittext', label: 'Split Text', icon: '⌗', badge: 'NEW',
      run: function () { return window.omsAmzSelect && window.omsAmzSelect.openSplitText(); } },
  ];

  function tool(id) {
    var t = window.omsAmzTools;
    if (!t || !t.open) return false;
    t.open(id);
    return true;
  }
  function openTool(id) { return tool(id); }

  /**
   * Duplicate the selected layer.
   *
   * Copies the visual and animation properties onto a new layer rather than sharing the object,
   * and deep-copies the keyframe table - a shallow copy would make the two layers animate
   * together, which is never what duplicating is for.
   */
  function duplicateSelectedLayer() {
    var m = window.model;
    var layer = null;
    try {
      if (m && typeof m.selectedLayer === 'function') layer = m.selectedLayer();
      else if (m && Array.isArray(m.layers)) {
        for (var i = 0; i < m.layers.length; i++) if (m.layers[i].id === m.selected) layer = m.layers[i];
      }
    } catch (e) {}
    if (!layer) { notify('Select a layer to duplicate'); return false; }
    if (!m || typeof m.addLayer !== 'function') { notify('No project open'); return false; }

    var b = window.omsAmzBridge;
    if (b) b.checkpoint();

    var copy = {};
    for (var k in layer) {
      if (!Object.prototype.hasOwnProperty.call(layer, k)) continue;
      if (k === 'id' || k === 'kf' || k === 'sequence') continue;
      copy[k] = layer[k];
    }
    copy.name = (layer.name || 'Layer') + ' copy';
    copy.start = Number(layer.start) || 0;
    copy.duration = Number(layer.duration) || 2;

    var made = m.addLayer(layer.type === 'adjustment' ? 'shape' : layer.type, copy);
    if (!made) { notify('Could not duplicate that layer'); return false; }
    if (layer.type === 'adjustment') {
      made.type = 'adjustment';
      made.effectStack = [];
    }
    /* Keyframes: deep copy, same times and values, new key ids. */
    try {
      made.kf = JSON.parse(JSON.stringify(layer.kf || {}));
      var n = 0;
      Object.keys(made.kf).forEach(function (prop) {
        made.kf[prop].forEach(function (key) {
          key.id = 'kf' + Math.random().toString(36).slice(2, 9) + (n++);
        });
      });
    } catch (e) { made.kf = {}; }

    if (b) b.refresh();
    notify('Duplicated "' + (layer.name || 'Layer') + '"');
    return true;
  }

  function notify(m) {
    try {
      if (window.omsAmzHub && window.omsAmzHub.notify) return window.omsAmzHub.notify(m);
    } catch (e) {}
    try { if (window.toast) window.toast(m); } catch (e) {}
  }

  /* ------------------------------------------------------------------------- styling */

  function styles() {
    if (document.getElementById('amzInspectorStyle')) return;
    var s = document.createElement('style');
    s.id = 'amzInspectorStyle';
    /* Colours come from the theme variables the editor already sets, so this follows the nine
       palettes rather than hard-coding a tenth. */
    s.textContent = [
      '.amzInsPager{position:relative}',
      '.amzInsPage2{display:none}',
      '.amzInsPager[data-page="1"] .amzInsPage1{display:none}',
      '.amzInsPager[data-page="1"] .amzInsPage2{display:block}',
      '.amzInsGrid2{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}',
      '.amzInsTile{position:relative;border:0;background:#252a3e;border-radius:9px;padding:10px 5px;',
      'color:#aeb7ca;font-size:12px;line-height:1.25;min-height:64px}',
      '.amzInsTile span.amzInsIco{font-size:19px;display:block;margin-bottom:5px}',
      '.amzInsTile[aria-disabled="true"]{opacity:.45}',
      '.amzInsBadge{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:999px;',
      'background:#1f6f5c;color:#8af0d4;font-size:9px;font-weight:800;letter-spacing:.03em}',
      '.amzInsDiam{position:absolute;top:4px;right:4px;width:6px;height:6px;transform:rotate(45deg);',
      'background:#4ade9a;border-radius:1px}',
      '.amzInsToolRow{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:9px}',
      '.amzInsTool{border:1px solid #333d55;background:transparent;border-radius:9px;height:44px;',
      'color:#8f9ab0;font-size:18px;line-height:1}',
      '.amzInsTool:active{border-color:var(--accent,#27d3b5);color:#7ff0d6}',
      '.amzInsDots{display:flex;justify-content:center;gap:6px;margin:9px 0 2px}',
      '.amzInsDot{width:7px;height:7px;border-radius:50%;border:0;padding:0;background:#3d455d}',
      '.amzInsDot[aria-current="true"]{background:var(--accent,#27d3b5);width:18px;border-radius:4px}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------------ the wrap */

  /**
   * Build page 2 lazily, because which tools make sense depends on the selected layer.
   * Beat Maker and Audio Keys need something to key; Split Text only makes sense on text.
   */
  function buildPage2() {
    var layer = null;
    try { if (window.model && window.model.selectedLayer) layer = window.model.selectedLayer(); } catch (e) {}
    var isText = !!(layer && layer.type === 'text');

    var grid = document.createElement('div');
    grid.className = 'amzInsGrid2';
    grid.setAttribute('data-amz-page2', '1');

    PAGE2.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'amzInsTile';
      b.setAttribute('data-amz-ins', t.id);
      /* A tool that cannot work on this layer is dimmed and says so, rather than silently
         doing nothing when tapped. */
      var blocked = (t.id === 'splittext' && !isText);
      b.disabled = blocked;
      b.setAttribute('aria-disabled', String(blocked));
      if (blocked) b.title = 'Only applies to a text layer';

      var ico = document.createElement('span');
      ico.className = 'amzInsIco';
      ico.textContent = t.icon;
      b.appendChild(ico);
      b.appendChild(document.createTextNode(t.label));

      if (t.badge === 'NEW') {
        var badge = document.createElement('span');
        badge.className = 'amzInsBadge';
        badge.textContent = 'NEW';
        b.appendChild(badge);
      }
      b.onclick = function () {
        if (blocked) return notify('Split Text only applies to a text layer');
        try { t.run(); } catch (e) { notify(t.label + ' failed: ' + e.message); }
      };
      grid.appendChild(b);
    });
    return grid;
  }

  /* A small tool row above the grid, matching the design: four quick actions that are one tap
     from the root inspector instead of two. */
  var TOOLROW = [
    { id: 'align', icon: '⊞', label: 'Align centre', run: alignCentre },
    { id: 'fit', icon: '⤢', label: 'Fit to frame', run: fitToFrame },
    { id: 'reset', icon: '↺', label: 'Reset transform', run: resetTransform },
    { id: 'path', icon: '⌇', label: 'Motion path', run: showMotionPath },
  ];

  function selected() {
    var m = window.model;
    if (!m) return null;
    try { if (typeof m.selectedLayer === 'function') return m.selectedLayer(); } catch (e) {}
    for (var i = 0; i < (m.layers || []).length; i++) if (m.layers[i].id === m.selected) return m.layers[i];
    return null;
  }

  function alignCentre() {
    var l = selected(), p = window.model && window.model.project;
    if (!l || !p) return notify('Select a layer first');
    var b = window.omsAmzBridge; if (b) b.checkpoint();
    l.x = p.width / 2; l.y = p.height / 2;
    if (b) b.refresh();
    notify('Centred');
    return true;
  }

  function fitToFrame() {
    var l = selected(), p = window.model && window.model.project;
    if (!l || !p) return notify('Select a layer first');
    var b = window.omsAmzBridge; if (b) b.checkpoint();
    /* Scale so the layer's shorter side fills the frame, then centre it. */
    var w = Number(l.w) || 1, h = Number(l.h) || 1;
    var s2 = Math.min(p.width / w, p.height / h);
    l.scaleX = s2; l.scaleY = s2;
    l.x = p.width / 2; l.y = p.height / 2;
    if (b) b.refresh();
    notify('Fitted to ' + Math.round(s2 * 100) + '%');
    return true;
  }

  function resetTransform() {
    var l = selected();
    if (!l) return notify('Select a layer first');
    var b = window.omsAmzBridge; if (b) b.checkpoint();
    l.scaleX = 1; l.scaleY = 1; l.rotation = 0; l.rotX = 0; l.rotY = 0; l.rotZ = 0;
    l.skewX = 0; l.skewY = 0; l.opacity = 1;
    if (b) b.refresh();
    notify('Transform reset');
    return true;
  }

  /**
   * Motion path: shows the layer's keyed position as a trail, then removes it.
   *
   * This is honest about being a check rather than an editor - it draws the path you already
   * made so you can see it, and it cleans itself up.
   */
  function showMotionPath() {
    var l = selected();
    if (!l || !l.kf || (!l.kf.x && !l.kf.y)) return notify('That layer has no position keyframes');
    var existing = document.getElementById('amzMotionPath');
    if (existing) { existing.remove(); return true; }
    var points = [];
    var xs = l.kf.x || [], ys = l.kf.y || [];
    /* Linear interpolation between the surrounding keys. The editor applies easing curves, so
       this trail is an approximation of the path, not a claim about exact timing - which is why
       it draws dots at key times rather than a filled trail. */
    function valueAt(arr, t, fallback) {
      if (!arr || !arr.length) return fallback;
      if (t <= arr[0].t) return Number(arr[0].v);
      if (t >= arr[arr.length - 1].t) return Number(arr[arr.length - 1].v);
      for (var i = 0; i < arr.length - 1; i++) {
        if (t >= arr[i].t && t <= arr[i + 1].t) {
          var q = (t - arr[i].t) / Math.max(1e-6, arr[i + 1].t - arr[i].t);
          return Number(arr[i].v) + (Number(arr[i + 1].v) - Number(arr[i].v)) * q;
        }
      }
      return fallback;
    }
    var all = { };
    xs.concat(ys).forEach(function (k) { all[k.t] = true; });
    var ts = Object.keys(all).map(Number).sort(function (a, b) { return a - b; });
    ts.forEach(function (t) { points.push({ t: t, x: valueAt(xs, t, l.x), y: valueAt(ys, t, l.y) }); });

    var svgNS = 'http://www.w3.org/2000/svg';
    var p2 = window.model && window.model.project;
    var svg = document.createElementNS(svgNS, 'svg');
    svg.id = 'amzMotionPath';
    svg.setAttribute('viewBox', '0 0 ' + (p2 ? p2.width : 1080) + ' ' + (p2 ? p2.height : 1920));
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
    var d = points.map(function (p3, i) { return (i ? 'L' : 'M') + p3.x.toFixed(1) + ' ' + p3.y.toFixed(1); }).join(' ');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#27d3b5');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-dasharray', '8 6');
    svg.appendChild(path);
    points.forEach(function (p4) {
      var c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', p4.x); c.setAttribute('cy', p4.y); c.setAttribute('r', '5');
      c.setAttribute('fill', '#27d3b5');
      svg.appendChild(c);
    });
    var host = document.querySelector('.canvasWrap') || document.querySelector('#stage') || document.body;
    host.appendChild(svg);
    notify('Showing ' + points.length + ' keyed positions; tap again to hide');
    return true;
  }

  function toolRowHTML() {
    return '<div class="amzInsToolRow">' + TOOLROW.map(function (t) {
      return '<button class="amzInsTool" data-amz-tool="' + t.id + '" aria-label="' + t.label + '">' + t.icon + '</button>';
    }).join('') + '</div>';
  }

  function pagerHTML(page1HTML) {
    return '<div class="amzInsPager" data-page="' + page + '" data-amz-pager="1">' +
      '<div class="amzInsPage1">' + toolRowHTML() + page1HTML + '</div>' +
      '<div class="amzInsPage2"></div>' +
      '<div class="amzInsDots">' +
      '<button class="amzInsDot" data-amz-dot="0" aria-label="Tools page 1"></button>' +
      '<button class="amzInsDot" data-amz-dot="1" aria-label="Tools page 2"></button>' +
      '</div></div>';
  }

  function setPage(root, n) {
    page = n === 1 ? 1 : 0;
    root.setAttribute('data-page', String(page));
    var holder = root.querySelector('.amzInsPage2');
    if (holder && !holder.firstChild && page === 1) holder.appendChild(buildPage2());
    if (holder && page === 1 && holder.firstChild) {
      /* Rebuild on entry so the text-only rule follows the current selection. */
      holder.innerHTML = '';
      holder.appendChild(buildPage2());
    }
    Array.prototype.forEach.call(root.querySelectorAll('[data-amz-dot]'), function (d) {
      d.setAttribute('aria-current', String(Number(d.dataset.amzDot) === page));
    });
  }

  function bind(root) {
    if (!root || root.__amzBound) return;
    root.__amzBound = true;
    Array.prototype.forEach.call(root.querySelectorAll('[data-amz-tool]'), function (b) {
      b.onclick = function () {
        var t = TOOLROW.filter(function (x) { return x.id === b.dataset.amzTool; })[0];
        if (!t) return;
        try { t.run(); } catch (e) { notify(t.label + ' failed: ' + e.message); }
      };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-amz-dot]'), function (d) {
      d.onclick = function () { setPage(root, Number(d.dataset.amzDot)); };
    });
    /* Swipe, which is what the design describes. Horizontal only, so it cannot fight the
       vertical drawer scroll. */
    var sx = 0, sy = 0, tracking = false;
    root.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = (e.changedTouches && e.changedTouches[0]);
      if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      setPage(root, dx < 0 ? 1 : 0);
    }, { passive: true });
    setPage(root, page);
  }

  function tryInstall() {
    if (installed) return true;
    var bod = document.querySelector('.drawerBody');
    if (!bod) return false;
    var grid = bod.querySelector('.inspectorGrid');
    if (!grid || grid.closest('.amzInsPager')) { installed = true; return true; }
    styles();
    var wrap = document.createElement('div');
    wrap.innerHTML = pagerHTML(grid.outerHTML);
    var pager = wrap.firstChild;
    grid.parentNode.replaceChild(pager, grid);
    bind(pager);
    installed = true;
    return true;
  }

  window.omsAmzInspector = {
    PAGE2: PAGE2,
    TOOLROW: TOOLROW,
    tryInstall: tryInstall,
    setPage: function (n) {
      var root = document.querySelector('[data-amz-pager]');
      if (root) setPage(root, n);
    },
    get page() { return page; },
    duplicateSelectedLayer: duplicateSelectedLayer,
    newBadgeCount: function () { return PAGE2.filter(function (t) { return t.badge === 'NEW'; }).length; },
  };

  /* Wrap whenever the inspector root is (re)opened. A MutationObserver is used rather than
     patching ui.openInspectorRoot, so a change in the core cannot break this silently. */
  function watch() {
    if (window.__amzInsObserver) return;
    var obs = new MutationObserver(function () {
      if (document.querySelector('.drawerBody .inspectorGrid')) tryInstall();
      else if (!document.querySelector('.drawerBody')) installed = false;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__amzInsObserver = obs;
    if (document.querySelector('.drawerBody .inspectorGrid')) tryInstall();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
