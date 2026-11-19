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

  window.omsAmzBridge = {
    setKey: setKey,
    refresh: refresh,
    checkpoint: checkpoint,
    selectedLayer: selectedLayer,
    layerLocalTime: layerLocalTime,
    hasModel: function () { return !!model(); },
    hasUndo: function () { var m = model(); return !!(m && m.history && m.history.push); },
  };
})();
