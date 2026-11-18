/*
 * EditorsHub — frame instrumentation and an honest fps readout.
 *
 * WHY THIS FILE EXISTS BEFORE ANY RENDERER WORK
 *
 * The editor's compositor is Canvas2D. Moving it to the GPU is a large change, and doing it
 * without knowing which operations actually cost the frames is how the previous attempt produced
 * a fast app with none of the features. So the first step is measurement: this file wraps the
 * renderer's frame path, records where the time goes, and puts the number on screen.
 *
 * It changes nothing about how a frame is drawn. It only observes.
 */
(function () {
  'use strict';

  if (window.__omsPerfHud) return;
  window.__omsPerfHud = true;

  var Native = window.EditorsHubNative || window.OpenMotionNative;

  var state = {
    frames: 0,
    // A rolling window of the last 120 frame costs. Enough for a moving average that reacts to a
    // change within two seconds at 60 fps, short enough that a stall is still visible.
    samples: [],
    worst: 0,
    slowFrames: 0,
    totalFrames: 0,
    hud: null,
    visible: false,
    hudFrames: 0,
    hudLast: 0,
  };

  function log() {
    try {
      if (Native && Native.log) Native.log('PERF', Array.prototype.join.call(arguments, ' '));
    } catch (e) {}
  }

  /** Records one frame's cost in milliseconds. */
  function record(ms) {
    state.frames++;
    state.totalFrames++;
    state.samples.push(ms);
    if (state.samples.length > 120) state.samples.shift();
    if (ms > state.worst) state.worst = ms;
    // A frame over 33 ms is below 30 fps for that frame, which is what the eye notices.
    if (ms > 33) state.slowFrames++;
    if (state.visible) updateHud();
  }

  function stats() {
    var s = state.samples;
    if (!s.length) return { avg: 0, p95: 0, fps: 0, worst: 0, slow: 0, frames: 0 };
    var sum = 0;
    for (var i = 0; i < s.length; i++) sum += s[i];
    var sorted = s.slice().sort(function (a, b) { return a - b; });
    var p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    var avg = sum / s.length;
    return {
      avg: avg,
      p95: p95,
      fps: avg > 0 ? 1000 / avg : 0,
      worst: state.worst,
      slow: state.slowFrames,
      frames: state.totalFrames,
    };
  }

  /**
   * Wraps a method on an object's prototype so each call is timed.
   *
   * The renderer is a class in the page's own script, so patching its prototype is stable across
   * the editor's own updates in a way that reaching into its closures would not be.
   */
  function patchRenderer() {
    var R = window.Renderer;
    if (!R || !R.prototype || R.prototype.__omsTimed) return false;
    var original = R.prototype.render;
    if (typeof original !== 'function') return false;

    R.prototype.render = function () {
      var t0 = performance.now();
      try {
        return original.apply(this, arguments);
      } finally {
        record(performance.now() - t0);
      }
    };
    R.prototype.__omsTimed = true;
    log('renderer timed');
    return true;
  }

  // The editor defines Renderer in its main inline script, so it may not exist yet.
  var tries = 0;
  var timer = setInterval(function () {
    if (patchRenderer() || ++tries > 100) clearInterval(timer);
  }, 50);

  // ---- the readout -------------------------------------------------------

  function buildHud() {
    var el = document.createElement('div');
    el.id = 'omsPerfHud';
    // Deliberately small and out of the way: it sits over the preview's top-right corner and is
    // pointer-transparent so it can never eat a gesture.
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
      'pointer-events:none', 'font:600 10px/1.4 ui-monospace,monospace',
      'color:#3AD9C6', 'background:rgba(11,13,16,.82)', 'border:1px solid rgba(58,217,198,.35)',
      'border-radius:8px', 'padding:5px 8px', 'white-space:pre', 'letter-spacing:.02em',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function updateHud() {
    if (!state.hud) state.hud = buildHud();
    var s = stats();
    state.hud.textContent =
      Math.round(s.fps) + ' fps  ' + s.avg.toFixed(1) + ' ms\n' +
      'p95 ' + s.p95.toFixed(1) + ' ms  worst ' + Math.round(s.worst) + '\n' +
      'slow ' + s.slow + '/' + s.frames;
  }

  window.omsPerf = {
    stats: stats,
    record: record,
    reset: function () {
      state.samples = [];
      state.worst = 0;
      state.slowFrames = 0;
      state.totalFrames = 0;
    },
    show: function (on) {
      state.visible = on !== false;
      if (state.visible) {
        updateHud();
      } else if (state.hud) {
        state.hud.remove();
        state.hud = null;
      }
      return state.visible;
    },
    toggle: function () {
      return window.omsPerf.show(!state.visible);
    },
    /** A one-line summary suitable for a toast or a log. */
    summary: function () {
      var s = stats();
      return Math.round(s.fps) + ' fps, ' + s.avg.toFixed(1) + ' ms avg, ' +
        s.p95.toFixed(1) + ' ms p95, ' + s.slow + ' slow of ' + s.frames;
    },
  };

  /**
   * Entry points.
   *
   *  - window.omsPerf.toggle() from the console or the native bridge
   *  - a long press on any element with [data-oms-perf] (used by the diagnostics sheet)
   *  - triple-tap on the app version label, which exists in the editor's settings sheet
   *
   * The readout stays off until asked for: it is an instrument, not chrome.
   */
  function bindTriggers() {
    var tapTimes = [];
    document.addEventListener(
      'pointerdown',
      function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('[data-oms-perf]')) {
          window.omsPerf.toggle();
          return;
        }
        // Triple tap within 600 ms anywhere on the top-left header toggles the readout.
        var now = performance.now();
        tapTimes.push(now);
        tapTimes = tapTimes.filter(function (t) { return now - t < 600; });
        if (tapTimes.length >= 3) {
          tapTimes = [];
          window.omsPerf.toggle();
          try {
            if (Native && Native.toast) {
              Native.toast(window.omsPerf.show() ? 'fps counter on' : 'fps counter off');
            }
          } catch (e) {}
        }
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTriggers);
  } else {
    bindTriggers();
  }

  log('perf hud ready');
})();
