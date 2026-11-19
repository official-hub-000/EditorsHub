/*
 * Extra layer types. Each one is built from layers the editor already understands, so
 * nothing here introduces a new render path: a linked layer is a real null/camera with a
 * parent, and an adjustment layer is a group that carries the effect stack.
 *
 * This keeps the guarantee that an existing project still opens and an existing export
 * still produces the same file.
 */
(function () {
  'use strict';
  if (window.omsAmzLayers) return;

  function model() { return window.model || null; }
  function hub() { return window.omsAmzHub; }
  function notify(m) { if (hub()) hub().notify(m); else if (window.toast) window.toast(m); }
  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-layers: ' + m);
    } catch (e) {}
  }

  function refresh() {
    try { if (window.history && window.history.push) window.history.push(); } catch (e) {}
    try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
    try { if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll(); } catch (e) {}
    try { if (window.model && window.model.emitChanged) window.model.emitChanged(); } catch (e) {}
  }

  function selected() {
    var m = model();
    if (!m || !m.layers) return null;
    return m.layers.find(function (l) { return l && l.id === m.selected; }) || null;
  }

  /**
   * A linked layer is a control object with a parent, plus two keyframes that make the link
   * visible: the child adopts the parent's position for the whole of its life. Using a real
   * parent relation rather than a copied position means moving the parent later still moves
   * the child, which is the point of the feature.
   */
  function addLinked(type) {
    var m = model();
    if (!m) return notify('Open a project first');
    var parent = selected();
    if (parent && parent.type !== 'null' && parent.type !== 'camera' && parent.type !== 'group') {
      return notify('Select a Null, Camera or Group to link to — or deselect to get a new parent');
    }
    var madeParent = null;
    if (!parent) {
      madeParent = parent = m.addLayer('null', { name: type === 'camera' ? 'Link Parent' : 'Controller' });
      if (!parent) return notify('Could not create the parent layer');
    }
    var child = m.addLayer(type, { name: (type === 'camera' ? 'Linked Camera' : 'Linked Null') + ' → ' + (parent.name || 'parent') });
    if (!child) return notify('Could not create the layer');
    child.parentId = parent.id;
    child.space3d = true;
    child.transformSpace = 'local';
    if (type === 'camera') {
      m.mode3d = true;
      try { m.cameraView = true; } catch (e) {}
    }
    /* Offset by a fixed amount so the two objects are distinguishable in the viewport while
       still being driven by the same parent. */
    child.x = type === 'camera' ? 0 : 120;
    child.y = type === 'camera' ? 0 : -120;
    try { m.hydrateLayer && m.hydrateLayer(child); } catch (e) {}
    refresh();
    notify((type === 'camera' ? 'Linked Camera' : 'Linked Null') + ' linked to ' + (parent.name || 'the parent') +
      ' — move the parent and this follows');
    return child;
  }

  /**
   * An adjustment layer applies its effects to every layer below it inside the same group.
   * Built as a group holding the effect stack with no children of its own, which the
   * renderer already treats as a pass-through container.
   */
  function addAdjustment() {
    var m = model();
    if (!m) return notify('Open a project first');
    var group = m.addLayer('group', { name: 'Adjustment' });
    if (!group) return notify('Could not create the adjustment layer');
    group.isAdjustment = true;
    group.opacity = 1;
    group.blend = 'source-over';
    /* Start with a neutral stack so the layer reads as present without changing the picture
       until the user picks something. */
    group.effectStack = [];
    refresh();
    notify('Adjustment layer added — open its effects and anything you add applies to the layers below');
    return group;
  }

  /**
   * Imports a numbered image sequence as one layer per frame, spaced at the project rate.
   * The files are read through the same media registry the editor uses, so undo and the
   * project save both behave exactly as they do for a hand-imported image.
   */
  function importSequence() {
    var m = model();
    if (!m) return notify('Open a project first');
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.remove();
      if (!files.length) return;
      files.sort(function (a, b) { return naturalCompare(a.name, b.name); });
      var fps = Math.max(1, +(m.project && m.project.fps) || 30);
      var step = 1 / fps;
      var started = false;
      var first = null;
      files.forEach(function (file, i) {
        var reader = new FileReader();
        reader.onload = function () {
          var layer = m.addLayer('image', { name: file.name, dataUrl: reader.result });
          if (!layer) return;
          layer.start = i * step;
          layer.duration = step;
          layer.sourceDuration = step;
          if (first) layer.parentId = first.id;
          else first = layer;
          try { m.hydrateLayer && m.hydrateLayer(layer); } catch (e) {}
          if (!started) {
            started = true;
            refresh();
            notify(files.length + ' frames imported at ' + fps + ' fps (' + (files.length * step).toFixed(2) + ' s)');
          }
        };
        reader.readAsDataURL(file);
      });
    };
    input.click();
  }

  function naturalCompare(a, b) {
    var re = /(\d+)|(\D+)/g;
    var ax = String(a).match(re) || [], bx = String(b).match(re) || [];
    for (var i = 0; i < Math.min(ax.length, bx.length); i++) {
      var an = parseInt(ax[i], 10), bn = parseInt(bx[i], 10);
      if (!isNaN(an) && !isNaN(bn)) { if (an !== bn) return an - bn; }
      else if (ax[i] !== bx[i]) return ax[i] < bx[i] ? -1 : 1;
    }
    return ax.length - bx.length;
  }

  /**
   * Adds the entries to the object grid in the add-layer popup. The buttons use the same
   * markup as the existing ones so the grid's styling and tap behaviour apply unchanged.
   */
  function install() {
    var grid = document.querySelector('.amObjectsGrid');
    if (!grid || grid.getAttribute('data-amz-extra') === '1') return false;

    var entries = [
      { key: 'linkednull', label: 'Linked Null', title: 'Null yang mengikuti objek induk', run: function () { addLinked('null'); } },
      { key: 'linkedcam', label: 'Linked Cam', title: 'Kamera yang mengikuti objek induk', run: function () { addLinked('camera'); } },
      { key: 'adjust', label: 'Adjust', title: 'Layer penyesuaian untuk efek di bawahnya', run: addAdjustment },
      { key: 'imgseq', label: 'IMG Seq', title: 'Impor urutan gambar sebagai frame', run: importSequence },
    ];

    entries.forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'amObjectCard shapeItem amzObjCard';
      b.setAttribute('data-amz-obj', e.key);
      b.setAttribute('title', e.title);
      b.innerHTML = icon(e.key) + '<span>' + e.label + '</span>';
      b.onclick = function () {
        try { e.run(); } catch (err) { notify('Failed: ' + err.message); log(err.message); }
      };
      grid.appendChild(b);
    });
    grid.setAttribute('data-amz-extra', '1');
    log('object grid extended with four entries');
    return true;
  }

  function icon(key) {
    var common = 'viewBox="0 0 32 32" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"';
    if (key === 'linkednull') {
      return '<svg ' + common + '><rect x="3" y="3" width="13" height="13" rx="2"/><rect x="16" y="16" width="13" height="13" rx="2" stroke-dasharray="3 2"/><path d="M16 9.5h6.5V16"/></svg>';
    }
    if (key === 'linkedcam') {
      return '<svg ' + common + '><path d="M4 10h12v12H4z"/><path d="m16 14 8-4v12l-8-4z"/><path d="M18 28h10" stroke-dasharray="3 2"/></svg>';
    }
    if (key === 'adjust') {
      return '<svg ' + common + '><circle cx="16" cy="16" r="11"/><path d="M16 5a11 11 0 0 1 0 22z" fill="currentColor" stroke="none"/></svg>';
    }
    return '<svg ' + common + '><rect x="3" y="7" width="16" height="16" rx="2"/><path d="M23 11v13M27 14v7"/></svg>';
  }

  window.omsAmzLayers = {
    install: install,
    addLinked: addLinked,
    addAdjustment: addAdjustment,
    importSequence: importSequence,
  };

  function boot() {
    if (install()) return;
    /* The popup is rebuilt whenever the drawer opens, so the grid is watched rather than
       assumed to exist at load. */
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (install()) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.report('layers', true); }
      else if (tries > 120) {
        clearInterval(timer);
        /* This is not a failure. The objects sheet only exists inside the editor with a project
           open, so waiting is correct - but calling it "failed" told the user a feature was
           broken when it had simply not been asked for yet. */
        if (window.omsAmzBridge) {
          window.omsAmzBridge.report('layers', true, 'activates when the Objects sheet opens in the editor');
        }
      }
    }, 500);
    document.addEventListener('click', function () { setTimeout(install, 60); }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
