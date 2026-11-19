/*
 * The toggles from the mod's Patcher Menu that EditorsHub had no equivalent for.
 *
 * Sixteen of that menu's twenty-eight switches already exist as real settings. This adds the
 * ones that change behaviour the editor owns, and deliberately skips the ones that describe a
 * different app: "Sign In Screen Fix" repairs a sign-in screen this editor does not have, and
 * "iOS Styles" / "Override Save Path" are already covered by existing settings.
 *
 * Nothing here is a switch that stores a value and does nothing with it. Each one is wired to
 * the place it belongs, and where there is no honest place - a save path override on Android,
 * whose storage is app-private - the toggle is not offered at all.
 */
(function () {
  'use strict';
  if (window.omsAmzPatch) return;

  var settings = function () { return window.omsAmzSettings; };

  function notify(message) {
    try {
      if (window.omsAmzHub && window.omsAmzHub.notify) return window.omsAmzHub.notify(message);
      if (window.toast) return window.toast(message);
    } catch (e) {}
  }

  /* --------------------------------------------------------------------- auto rename */

  /**
   * Names a text layer's clone after the original rather than leaving two identical names.
   *
   * The editor already appends a suffix when duplicating; this applies the chosen naming style
   * on top, and only ever touches text layers, so media keeps its filename.
   */
  function renameClone(layer, original) {
    var s = settings();
    if (!s || !layer) return layer;
    var mode = s.get('autoRenameText') || 'off';
    if (mode === 'off') return layer;
    if (mode === 'dup' && !original) return layer;
    if (!layer.type || layer.type !== 'text') return layer;
    var base = String((original && original.name) || layer.name || 'Text').replace(/\s*[·•]\s*(Salinan|Copy)\s*$/i, '');
    var n = 2;
    var taken = {};
    try {
      (window.model.layers || []).forEach(function (l) { taken[l.name] = true; });
    } catch (e) {}
    var name = base + ' ' + n;
    while (taken[name] && n < 999) { n++; name = base + ' ' + n; }
    /* Past the cap two layers could still share a name, so fall back to something unique. */
    if (taken[name]) name = base + ' ' + Date.now().toString(36);
    layer.name = name;
    return layer;
  }

  /** Hooks the clone path once the layer-action clipboard exists. */
  function hookAutoRename() {
    var ui = window.ui;
    var clip = ui && ui.layerActionClipboard;
    if (!clip || clip.__amzRenamed) return false;
    var originalInsert = clip.insert;
    if (typeof originalInsert !== 'function') return false;
    clip.insert = function (layer, opts) {
      var source = null;
      try {
        source = opts && opts.nearLayerId ? window.model.layers.find(function (l) { return l.id === opts.nearLayerId; }) : null;
      } catch (e) {}
      var result = originalInsert.call(this, layer, opts);
      try { renameClone(result, source); } catch (e) {}
      return result;
    };
    clip.__amzRenamed = true;
    return true;
  }

  /* ------------------------------------------------------------- select all / show hide */

  function selectAllLayers() {
    var m = window.model;
    if (!m || !Array.isArray(m.layers) || !m.layers.length) return notify('No layers to select');
    /*
     * The previous version wrote model.selection, which the editor does not read, and emitted on
     * window.bus, which does not exist. Nothing changed on screen, so the tap looked dead.
     *
     * The editor's real multi-select is a Set on the UI controller plus a mode flag. Highlighting
     * the whole stack is what "select all" should look like, so it goes through that.
     */
    var ui = window.__omsUi || window.ui;
    var changed = false;
    try {
      if (ui && ui.layerMultiSelectedIds && typeof ui.layerMultiSelectedIds.add === 'function') {
        ui.layerMultiSelectedIds.clear();
        m.layers.forEach(function (l) { ui.layerMultiSelectedIds.add(l.id); });
        ui.layerMultiSelectMode = true;
        ui.layerMultiFocusId = m.selected || m.layers[0].id;
        changed = true;
        if (typeof ui.refreshSelectionRows === 'function') ui.refreshSelectionRows();
      }
    } catch (e) {}
    if (window.omsAmzBridge) window.omsAmzBridge.refresh();
    notify(m.layers.length + ' layers selected' + (changed ? '' : ' (highlight only)'));
  }

  function toggleAllLayers() {
    var m = window.model;
    if (!m || !Array.isArray(m.layers) || !m.layers.length) return notify('No layers');
    var anyVisible = m.layers.some(function (l) { return !l.hidden; });
    m.layers.forEach(function (l) { l.hidden = anyVisible; });
    if (window.omsAmzBridge) window.omsAmzBridge.refresh();
    notify(anyVisible ? 'All layers hidden' : 'All layers shown');
  }

  /* ------------------------------------------------------------------------ link buttons */

  /**
   * Links the selected layer to a camera or null layer by making it a child.
   *
   * The model already resolves parent transforms, so linking is setting parentId; the layer
   * then follows the controller without a per-frame special case.
   */
  function linkSelectedTo(type) {
    var m = window.model;
    var layer = m && typeof m.selectedLayer === 'function' ? m.selectedLayer() : null;
    if (!layer) return notify('Select a layer first');
    if (layer.type === type) return notify('That is already a ' + type + ' layer');
    var target = (m.layers || []).filter(function (l) { return l.type === type && l.id !== layer.id; })[0];
    if (!target) return notify('Add a ' + (type === 'camera' ? 'camera' : 'null') + ' layer first');
    if (window.omsAmzBridge) window.omsAmzBridge.checkpoint();
    layer.parentId = target.id;
    /* The editor stores hierarchy as parentId, so this is the real link - but nothing redrew
       afterwards, which is why the tap appeared to do nothing. */
    if (window.omsAmzBridge) window.omsAmzBridge.refresh();
    notify('Linked to ' + (target.name || type));
  }

  /* ----------------------------------------------------------------- patch style paste */

  /**
   * Pastes only the style of a copied layer, not its position or keyframes.
   *
   * This is the mod's "Paste Style Category First": when on, a style paste also carries the
   * effect categories the source layer had, so an effect stack lands on the right rows.
   */
  function hookStylePaste() {
    var ui = window.ui;
    var clip = ui && ui.layerActionClipboard;
    if (!clip || clip.__amzStylePaste || typeof clip.pasteStyle !== 'function') return false;
    var original = clip.pasteStyle;
    clip.pasteStyle = function (target) {
      var s = settings();
      var first = s ? s.get('pasteStyleCategoryFirst') : false;
      if (first && this.payload && this.payload.style) {
        /* Reorder the incoming stack so effects keep their category grouping. */
        var stack = this.payload.style.effectStack;
        if (Array.isArray(stack) && stack.length > 1) {
          this.payload.style = Object.assign({}, this.payload.style, {
            effectStack: stack.slice().sort(function (a, b) {
              return String(a.specId || '').localeCompare(String(b.specId || ''));
            }),
          });
        }
      }
      return original.call(this, target);
    };
    clip.__amzStylePaste = true;
    return true;
  }

  /* ------------------------------------------------------------------------- clear cache */

  function clearExportCache() {
    var freed = 0;
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /export|cache|render/i.test(k) && !/amz:settings/.test(k)) keys.push(k);
      }
      keys.forEach(function (k) { freed += String(localStorage.getItem(k) || '').length; localStorage.removeItem(k); });
    } catch (e) {}
    notify(freed ? 'Cleared ' + Math.max(1, Math.round(freed / 1024)) + ' KB of export cache' : 'Export cache is already empty');
  }

  function cacheSizeLabel() {
    var bytes = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /export|cache|render/i.test(k) && !/amz:settings/.test(k)) bytes += String(localStorage.getItem(k) || '').length;
      }
    } catch (e) {}
    return bytes ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : 'empty';
  }

  /* ---------------------------------------------------------------- the extra settings */

  var EXTRA = [
    { id: 'autoRenameText', group: 'Editor', type: 'choice', label: 'Auto Rename Text Layer',
      options: [['off', 'Off'], ['dup', 'Only Duplicate'], ['all', 'All Text']], default: 'off',
      help: 'Numbers text layer copies so two layers are never called the same thing. Media layers keep their filenames.' },
    { id: 'pasteStyleCategoryFirst', group: 'Editor', type: 'bool', label: 'Paste Style Category First', default: false,
      help: 'When pasting a style, effects land grouped by category instead of in the order they were copied.' },
  ];

  var registered = false;

  function register() {
    if (registered) return true;
    var s = settings();
    if (!s || typeof s.register !== 'function') return false;
    s.register(EXTRA);
    registered = true;
    return true;
  }

  /* ------------------------------------------------------------------------ entry point */

  function openPatchMenu() {
    var s = settings();
    var hub = window.omsAmzHub;
    if (!s || !hub) return notify('Settings are not ready');
    /* The settings sheet is the patcher menu; this opens it with the search field focused. */
    hub.openSettings();
    setTimeout(function () {
      var input = document.querySelector('#amzSettingsSearch') || document.querySelector('.amzSearch');
      if (input) { try { input.focus(); } catch (e) {} }
    }, 60);
  }

  /* Register immediately as well as on the retry loop: the settings module may already be
     loaded, and a toggle that only appears after a timer tick is a toggle that may never
     appear at all. */
  register();
  hookAutoRename();
  hookStylePaste();

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    register();
    hookAutoRename();
    hookStylePaste();
    if ((registered && hookAutoRename() && hookStylePaste()) || tries > 80) clearInterval(timer);
  }, 500);

  window.omsAmzPatch = {
    EXTRA: EXTRA,
    register: register,
    openPatchMenu: openPatchMenu,
    selectAllLayers: selectAllLayers,
    toggleAllLayers: toggleAllLayers,
    linkSelectedTo: linkSelectedTo,
    clearExportCache: clearExportCache,
    cacheSizeLabel: cacheSizeLabel,
    renameClone: renameClone,
    get registered() { return registered; },
  };
})();
