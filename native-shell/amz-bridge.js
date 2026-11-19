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
    var ui = window.ui;
    try {
      if (ui && typeof ui.render === 'function') { ui.render(); touched = true; }
    } catch (e) {}
    try {
      if (ui && typeof ui.refreshInspector === 'function') { ui.refreshInspector(); touched = true; }
    } catch (e) {}
    try {
      if (ui && typeof ui.updateTimeline === 'function') { ui.updateTimeline(); touched = true; }
    } catch (e) {}
    return touched;
  }

  /** A recorded undo step. `history` is the browser's; the model keeps its own stack. */
  function checkpoint() {
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

  function installReport() {
    var names = Object.keys(status);
    var failed = names.filter(function (k) { return !status[k].ok; });
    return { total: names.length, failed: failed, all: status };
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
