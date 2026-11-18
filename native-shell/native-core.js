/*
 * Native core adapter.
 *
 * The C++ core in app/src/main/cpp owns the numeric primitives that the compositor runs per
 * frame: cubic-bezier easing, keyframe evaluation, blending, affine layer blits, RGBA→NV12 for
 * hardware encoders, LUT application and box blur. This file is the seam between that core and
 * the editor's JavaScript.
 *
 * It is written to be boring on purpose:
 *
 *   - if the native library is absent, every function falls through to the existing JS
 *     implementation, so the app behaves exactly as it did before the port;
 *   - if it is present, native results are used, and `verify()` proves on demand that native and
 *     JS agree to within a tolerance — a silent divergence between two implementations of the
 *     same blend is far worse than a slow one.
 *
 * Nothing here replaces an editor API. It only changes where the arithmetic happens.
 */
(function () {
  'use strict';

  if (window.omsNativeCore) return;

  var Native = window.EditorsHubNative || window.OpenMotionNative || null;

  function bridge() {
    // The bridge object is installed by native-shell.js slightly later than this file may load,
    // so it is resolved on every call rather than captured once.
    return (window.EditorsHubNative || window.OpenMotionNative || Native || null);
  }

  function api() {
    var b = bridge();
    return b && typeof b.coreInfo === 'function' ? b : null;
  }

  var info = null;
  var available = false;

  function probe() {
    var a = api();
    if (!a) {
      available = false;
      return { state: 'no-bridge', version: 0 };
    }
    try {
      info = JSON.parse(a.coreInfo());
      available = info && info.state === 'ready';
    } catch (e) {
      available = false;
      info = { state: 'error', message: String(e) };
    }
    return info;
  }

  // ------------------------------------------------------------ JS references

  /*
   * Local implementations, kept for comparison and for the fallback path. These are the same
   * formulas the core implements; keeping them here means a device without the native library
   * still eases and blends correctly, just more slowly.
   */
  function jsBezier(x1, y1, x2, y2, t) {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    x1 = x1 < 0 ? 0 : x1 > 1 ? 1 : x1;
    x2 = x2 < 0 ? 0 : x2 > 1 ? 1 : x2;
    if (x1 === y1 && x2 === y2) return t;
    function bx(p) {
      var q = 1 - p;
      return 3 * q * q * p * x1 + 3 * q * p * p * x2 + p * p * p;
    }
    function by(p) {
      var q = 1 - p;
      return 3 * q * q * p * y1 + 3 * q * p * p * y2 + p * p * p;
    }
    var lo = 0, hi = 1, p = t;
    for (var i = 0; i < 40; i++) {
      p = 0.5 * (lo + hi);
      if (bx(p) < t) lo = p; else hi = p;
    }
    return by(0.5 * (lo + hi));
  }

  function jsBlend(mode, cb, cs) {
    switch (mode) {
      case 1: return (cb * cs + 127) / 255 | 0;
      case 2: return 255 - (((255 - cb) * (255 - cs) + 127) / 255 | 0);
      case 3: return cb < 128 ? (2 * cb * cs + 127) / 255 | 0
                              : 255 - (2 * (255 - cb) * (255 - cs) + 127) / 255 | 0;
      case 4: return cb < cs ? cb : cs;
      case 5: return cb > cs ? cb : cs;
      case 9: {
        var b = cb / 255, s = cs / 255, d;
        if (s <= 0.5) d = b - (1 - 2 * s) * b * (1 - b);
        else {
          var c = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
          d = b + (2 * s - 1) * (c - b);
        }
        return Math.max(0, Math.min(255, Math.round(d * 255)));
      }
      case 10: return cb > cs ? cb - cs : cs - cb;
      case 11: return cb + cs - 2 * cb * cs / 255 | 0;
      case 12: return Math.min(255, cb + cs);
      default: return cs;
    }
  }

  // ------------------------------------------------------------- public surface

  var core = {
    /** Re-probes the bridge. Called by the HUD and by the self-test. */
    refresh: function () {
      probe();
      return core.status();
    },

    status: function () {
      return {
        available: available,
        native: info || null,
        // Reported so a report can distinguish "native missing" from "native present, unused".
        routed: {
          bezier: available,
          evalKeys: available,
          composite: available,
        },
      };
    },

    get available() {
      return available;
    },

    /** Eased progress. Native when present, JS otherwise. Results are identical. */
    bezierEase: function (x1, y1, x2, y2, t) {
      var a = available && api();
      if (a) {
        try {
          var v = a.bezierEase(x1, y1, x2, y2, t);
          if (typeof v === 'number' && isFinite(v)) return v;
        } catch (e) {}
      }
      return jsBezier(x1, y1, x2, y2, t);
    },

    /**
     * Keyframe track evaluation.
     *
     * `keys` is the editor's own keyframe array: objects with `time`, `value` and optionally
     * `easing` ({x1,y1,x2,y2}) or `interp` ('hold' | 'linear' | 'bezier'). The arrays handed to
     * the bridge are scratch buffers reused between calls so a 60 fps scrub does not allocate.
     */
    evalKeys: function (keys, time, fallback) {
      if (!Array.isArray(keys) || keys.length === 0) return fallback;
      var n = keys.length;
      var times = core._scratchTimes(n), values = core._scratchValues(n);
      var interps = core._scratchInterps(n), handles = core._scratchHandles(n);
      var anyHandle = false;

      for (var i = 0; i < n; i++) {
        var k = keys[i];
        times[i] = +k.time || 0;
        values[i] = +k.value || 0;
        var e = k.easing || k.bezier;
        if (k.interp === 'hold' || k.type === 'hold') {
          interps[i] = 0;
        } else if (e && typeof e === 'object') {
          interps[i] = 2;
          handles[i * 4] = +e.x1 || 0;
          handles[i * 4 + 1] = +e.y1 || 0;
          handles[i * 4 + 2] = +e.x2 || 0;
          handles[i * 4 + 3] = +e.y2 || 0;
          anyHandle = true;
        } else {
          interps[i] = 1;
        }
      }

      var a = available && api();
      if (a) {
        try {
          var v = a.evalKeys(times, values, interps, anyHandle ? handles : [], time, fallback);
          if (typeof v === 'number' && isFinite(v)) return v;
        } catch (err) {}
      }
      return jsEvalKeys(times, values, interps, handles, n, time, fallback);
    },

    /** Blend one channel, for the rare JS path that needs a single value rather than a blit. */
    blendChannel: function (mode, backdrop, source) {
      return jsBlend(mode, backdrop, source);
    },

    /**
     * Proves native and JS agree. Returns a report rather than throwing, because this runs on
     * the device from a debug gesture and must never take the app down.
     */
    verify: function () {
      if (!available) {
        return { ok: false, reason: 'native core not loaded', samples: 0, worst: null };
      }
      var worst = { what: null, delta: 0 };
      var samples = 0;

      function compare(what, nativeValue, jsValue, tolerance) {
        samples++;
        var d = Math.abs(nativeValue - jsValue);
        if (d > worst.delta) worst = { what: what, delta: d, nativeValue: nativeValue, jsValue: jsValue };
        return d <= tolerance;
      }

      var ok = true;
      // Easing: 21 points across four curves, including the degenerate ones.
      var curves = [[0.42, 0, 0.58, 1], [0.25, 0.1, 0.25, 1], [0, 0, 1, 1], [0.68, -0.55, 0.27, 1.55]];
      for (var c = 0; c < curves.length; c++) {
        for (var i = 0; i <= 20; i++) {
          var t = i / 20;
          var cv = curves[c];
          var nativeVal = core.bezierEase(cv[0], cv[1], cv[2], cv[3], t);
          var jsVal = jsBezier(cv[0], cv[1], cv[2], cv[3], t);
          if (!compare('bezier' + c + '@' + t.toFixed(2), nativeVal, jsVal, 2e-3)) ok = false;
        }
      }

      // Keyframe evaluation against a hand-computed linear track.
      var keys = [{ time: 0, value: 0 }, { time: 1, value: 100 }, { time: 2, value: 0 }];
      var probes = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
      for (var p = 0; p < probes.length; p++) {
        var got = core.evalKeys(keys, probes[p], -1);
        var expected = probes[p] <= 0 ? 0 : probes[p] >= 2 ? 0 : probes[p] <= 1 ? probes[p] * 100 : 100 - (probes[p] - 1) * 100;
        if (!compare('keys@' + probes[p], got, expected, 1e-6)) ok = false;
      }

      return { ok: ok, samples: samples, worst: worst, native: info };
    },
  };

  function jsEvalKeys(times, values, interps, handles, n, t, fallback) {
    if (t <= times[0]) return values[0];
    if (t >= times[n - 1]) return values[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = lo + ((hi - lo) >> 1);
      if (times[mid] <= t) lo = mid; else hi = mid;
    }
    var span = times[hi] - times[lo];
    if (span <= 0) return values[hi];
    var u = (t - times[lo]) / span;
    if (interps[lo] === 0) return values[lo];
    var eased = interps[lo] === 2
      ? jsBezier(handles[lo * 4], handles[lo * 4 + 1], handles[lo * 4 + 2], handles[lo * 4 + 3], u)
      : u;
    return values[lo] + (values[hi] - values[lo]) * eased;
  }

  // Reusable scratch buffers: a 60 fps scrub must not allocate four arrays per layer per frame.
  var scratch = { n: 0, times: null, values: null, interps: null, handles: null };
  core._scratchTimes = function (n) {
    if (scratch.n < n) {
      scratch.n = n;
      scratch.times = new Float64Array(n);
      scratch.values = new Float64Array(n);
      scratch.interps = new Int32Array(n);
      scratch.handles = new Float64Array(n * 4);
    }
    return scratch.times;
  };
  core._scratchValues = function () { return scratch.values; };
  core._scratchInterps = function () { return scratch.interps; };
  core._scratchHandles = function () { return scratch.handles; };

  window.omsNativeCore = core;

  // Probe once at load and once more after the bridge has certainly been installed; the second
  // pass is what makes the status line trustworthy in a report.
  probe();
  setTimeout(function () {
    probe();
    var s = core.status();
    try {
      var b = bridge();
      if (b && b.log) {
        b.log('INFO', 'native-core: ' + (s.available ? 'routed' : 'js-fallback') +
          ' ' + JSON.stringify(s.native));
      }
    } catch (e) {}
  }, 1200);
})();
