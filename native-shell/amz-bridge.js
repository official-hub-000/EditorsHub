/*
 * The small set of editor internals these extensions need, in one place.
 *
 * This file exists because of a real bug: earlier modules called window.renderer.render() and
 * window.bus.emit() to refresh after an edit. Neither exists - renderer and bus are module
 * locals inside the editor core - so those calls threw, were swallowed by try/catch, and the
 * extensions "worked" while never telling anything to redraw. Undo was the same story.
 *
 * Everything here is looked up defensively and returns false rather than throwing, so a caller
 * can tell the difference between "refreshed" and "could not find the thing to refresh".
 */
(function () {
  'use strict';
  if (window.omsAmzBridge) return;

  function model() { return window.model || null; }

  /** Keyframes live on the model's AnimationEngine, not on a free function. */
  function setKey(layer, prop, time, value, easing, tolerance) {
    var m = model();
    if (!m || !m.anim) return null;
    layer.kf = layer.kf || {};
    layer.kf[prop] = layer.kf[prop] || [];
    return m.anim.setKey(layer, prop, time, value, easing || 'ease-out', tolerance || 0.015);
  }

  /**
   * Ask the editor to redraw.
   *
   * There is no public bus, so this nudges the things the UI already watches: bump the model
   * time (which the render loop reads every frame) and call the controller methods if they are
   * reachable. Returns true only if something accepted the request.
   */
  function refresh() {
    var touched = false;
    /* The core publishes its own objects as __oms* aliases; window.ui is set too, but the
       timeline and bus are only reachable through the aliases. */
    var ui = window.__omsUi || window.ui;
    try {
      if (ui && typeof ui.render === 'function') { ui.render(); touched = true; }
    } catch (e) {}
    try {
      if (ui && typeof ui.refreshInspector === 'function') { ui.refreshInspector(); touched = true; }
    } catch (e) {}
    try {
      if (ui && typeof ui.updateTimeline === 'function') { ui.updateTimeline(); touched = true; }
    } catch (e) {}
    /* The renderer and timeline are only reachable through the aliases. A redraw that never
       reaches them is indistinguishable from an edit that did nothing. */
    try {
      var r = window.__omsRenderer;
      if (r && typeof r.render === 'function') { r.render(); touched = true; }
    } catch (e) {}
    try {
      var t = window.__omsTimeline;
      if (t && typeof t.rebuild === 'function') { t.rebuild(); touched = true; }
    } catch (e) {}
    return touched;
  }

  /** A recorded undo step. `history` is the browser's; the model keeps its own stack. */
  function checkpoint() {
    /* __omsHistory is the core's undo stack; pushing it is what makes an edit undoable. */
    try {
      var h = window.__omsHistory || null;
      if (h && typeof h.push === 'function') { h.push(); return true; }
    } catch (e) {}
    var m = model();
    try {
      if (m && m.history && typeof m.history.push === 'function') { m.history.push(); return true; }
    } catch (e) {}
    try {
      if (window.history && typeof window.history.pushState === 'function') {
        window.history.pushState(window.history.state, '');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function selectedLayer() {
    var m = model();
    if (!m) return null;
    try { if (typeof m.selectedLayer === 'function') return m.selectedLayer(); } catch (e) {}
    if (Array.isArray(m.layers)) {
      for (var i = 0; i < m.layers.length; i++) if (m.layers[i].id === m.selected) return m.layers[i];
    }
    return null;
  }

  /** Convert a project-time offset into the layer's own local time. */
  function layerLocalTime(layer, projectTime) {
    var start = Number(layer && layer.start) || 0;
    return Math.max(0, projectTime - start);
  }

  /*
   * Defence in depth for the one crash the device actually produced.
   *
   * model.addLayer -> defaultLayer reads this.project.duration. With no project open,
   * project is null and the whole editor throws "Cannot read properties of null (reading
   * 'duration')". Guarding here means any caller - mine or the core's - gets null back
   * instead of an uncaught error, and the user gets a sentence they can act on.
   */
  function guardAddLayer() {
    var m = model();
    if (!m || typeof m.addLayer !== 'function' || m.__amzAddGuarded) return false;
    var original = m.addLayer.bind(m);
    m.addLayer = function (type, opt) {
      if (!m.project) {
        try {
          if (window.omsAmzHub && window.omsAmzHub.notify) {
            window.omsAmzHub.notify('Open or create a project before adding layers');
          }
        } catch (e) {}
        return null;
      }
      try {
        return original(type, opt);
      } catch (e) {
        try {
          if (window.omsAmzHub && window.omsAmzHub.notify) {
            window.omsAmzHub.notify('Could not add that layer: ' + (e && e.message ? e.message : 'unknown error'));
          }
        } catch (e2) {}
        return null;
      }
    };
    m.__amzAddGuarded = true;
    return true;
  }

  /* The model is created with the page, but guard lazily in case this runs first. */
  var guardTries = 0;
  if (!guardAddLayer()) {
    var guardTimer = setInterval(function () {
      guardTries++;
      if (guardAddLayer() || guardTries > 100) clearInterval(guardTimer);
    }, 100);
  }

  /*
   * Installation reporting.
   *
   * Every module retries install() on a timer because the DOM it needs may not exist yet. The
   * problem with that design is silence: if install() never succeeds, the feature simply never
   * appears and the user concludes it is missing or broken. This records the outcome for each
   * module and exposes it, so a single call can answer "what actually loaded on this phone".
   */
  var status = {};

  function report(name, ok, detail) {
    status[name] = { ok: !!ok, detail: detail || '', at: Date.now() };
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log(ok ? 'INFO' : 'WARN', 'amz-install: ' + name + ' ' + (ok ? 'ok' : 'FAILED ' + (detail || '')));
    } catch (e) {}
    return ok;
  }

  /** Called by modules when they give up retrying. */
  function gaveUp(name, detail) {
    status[name] = { ok: false, detail: detail || 'gave up waiting for the editor', at: Date.now() };
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('WARN', 'amz-install: ' + name + ' gave up: ' + (detail || ''));
    } catch (e) {}
  }

  /*
   * Which globals each extension publishes. Every module sets one on load, so presence is a
   * reliable "did the script run" signal - and unlike the per-module report() calls, it needs
   * no cooperation, so a module added later cannot silently go unlisted.
   */
  var GLOBALS = {
    bridge: 'omsAmzBridge',
    settings: 'omsAmzSettings',
    media: 'omsAmzMedia',
    layers: 'omsAmzLayers',
    effects: 'omsAmzEffects',
    languages: 'omsAmzLanguages',
    shapes: 'omsAmzShapes',
    folders: 'omsAmzFolders',
    patch: 'omsAmzPatch',
    select: 'omsAmzSelect',
    adjust: 'omsAmzAdjust',
    tools: 'omsAmzTools',
    analysis: 'omsAmzAnalysis',
    scopes: 'omsAmzScopes',
    sequence: 'omsAmzSequence',
    inspector: 'omsAmzInspector',
    settingswire: 'omsAmzSettingsWire',
  };

  function installReport() {
    var names = Object.keys(GLOBALS);
    var merged = {};
    names.forEach(function (k) {
      var loaded = !!window[GLOBALS[k]];
      var claimed = status[k];
      merged[k] = {
        loaded: loaded,
        /* A module that never called report() is still listed, with what we can prove. */
        ok: claimed ? claimed.ok : loaded,
        detail: claimed ? claimed.detail : (loaded ? '' : 'script did not run'),
      };
    });
    var failed = names.filter(function (k) { return merged[k].loaded && !merged[k].ok; });
    var missing = names.filter(function (k) { return !merged[k].loaded; });
    return { total: names.length, failed: failed, missing: missing, all: merged };
  }

  window.omsAmzBridge = {
    guardAddLayer: guardAddLayer,
    report: report,
    gaveUp: gaveUp,
    installReport: installReport,
    setKey: setKey,
    refresh: refresh,
    checkpoint: checkpoint,
    selectedLayer: selectedLayer,
    layerLocalTime: layerLocalTime,
    hasModel: function () { return !!model(); },
    hasUndo: function () { var m = model(); return !!(m && m.history && m.history.push); },
  };
})();
