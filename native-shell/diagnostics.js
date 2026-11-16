/*
 * EditorsHub on-device diagnostics.
 *
 * Three rounds of "nothing works and it's laggy" have been answered with fixes that
 * could not be verified on the affected device. This module exists to stop guessing: it
 * measures what the page is actually doing and reports it in plain language the user can
 * copy in one tap.
 *
 * What it measures, and why each one matters:
 *
 *   · Frame timing. A long-task / frame-gap sample separates "the device is struggling"
 *     from "the taps are not reaching anything". If frames are ~16 ms and taps still do
 *     nothing, the problem is hit-testing; if frames are 200 ms, it is saturation.
 *   · WebGL. The editor's renderer is WebGL2. A driver that advertises but fails leaves a
 *     black viewport and a lot of work happening for no visible output.
 *   · Element hit-test at the centre and at every unresponsive control, using
 *     `elementsFromPoint`. A control covered by an invisible overlay looks perfectly
 *     healthy to `element.click()` but can never be tapped by a finger.
 *   · Event delivery. A tap that fires no click tells us the tap is being swallowed
 *     before it reaches the app.
 *
 * Everything is read-only. Nothing is uploaded; the report is text on the clipboard.
 */
(function () {
  'use strict';

  var MAX_FRAME_SAMPLES = 90;

  /**
   * Samples up to MAX_FRAME_SAMPLES frame gaps.
   *
   * Bounded by wall-clock as well as by count: a frame callback that never arrives (a
   * backgrounded page, or a view whose compositor has stalled) would otherwise leave the
   * caller waiting forever, and a report that never appears is indistinguishable from a
   * frozen app.
   */
  function frames(callback) {
    var gaps = [];
    var last = 0;
    var count = 0;
    var finished = false;
    var started = Date.now();

    function done() {
      if (finished) return;
      finished = true;
      callback(gaps);
    }
    function step(now) {
      if (finished) return;
      if (last) gaps.push(now - last);
      last = now;
      if (++count < MAX_FRAME_SAMPLES && Date.now() - started < 2000) {
        requestAnimationFrame(step);
      } else {
        done();
      }
    }
    requestAnimationFrame(step);
    // Hard stop: whichever comes first, the report is produced.
    setTimeout(done, 2500);
  }

  function stats(gaps) {
    if (!gaps.length) return { median: 0, worst: 0, fps: 0, jank: 0 };
    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var worst = sorted[sorted.length - 1];
    var total = gaps.reduce(function (a, b) { return a + b; }, 0);
    var jank = gaps.filter(function (g) { return g > 34; }).length / gaps.length;
    return {
      median: Math.round(median),
      worst: Math.round(worst),
      fps: total > 0 ? Math.round(1000 / (total / gaps.length)) : 0,
      jank: Math.round(jank * 100),
    };
  }

  function webglReport() {
    var report = { supported: false, version: '', renderer: '', error: '' };
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        report.error = 'no context';
        return report;
      }
      report.supported = true;
      report.version = String(gl.getParameter(gl.VERSION) || '');
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      report.renderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
        : 'unavailable';
      // Force a real GPU submission; an advertised-but-broken driver shows up here.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      report.error = String(gl.getError());
    } catch (e) {
      report.error = String(e && e.message);
    }
    return report;
  }

  /** What a finger would actually hit at the centre of `el`, or at the viewport centre. */
  function hitTest(el) {
    var x;
    var y;
    if (el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else {
      x = window.innerWidth / 2;
      y = window.innerHeight / 2;
    }
    var stack = [];
    try {
      stack = document.elementsFromPoint(x, y) || [];
    } catch (e) {
      return { x: x, y: y, top: '(unsupported)', blocked: false };
    }
    var top = stack[0];
    var blocked = !!(el && top && top !== el && !el.contains(top) && !top.contains(el));
    return {
      x: Math.round(x),
      y: Math.round(y),
      top: top ? describe(top) : '(nothing)',
      blocked: blocked,
      covering: blocked ? stack.slice(0, 3).map(describe) : [],
    };
  }

  function describe(el) {
    if (!el) return '?';
    var name = el.tagName ? el.tagName.toLowerCase() : '?';
    if (el.id) name += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      name += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return name;
  }

  /**
   * Controls that a finger cannot reach: laid out, on screen, but covered by something
   * else, or with pointer-events turned off, or with zero size.
   */
  function unreachable() {
    var out = [];
    var all = document.querySelectorAll(
      'button,[role="button"],.mNavTab,.mHomeHero button,.insBtn,.amMenuRow'
    );
    for (var i = 0; i < all.length && out.length < 25; i++) {
      var el = all[i];
      var style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (style.pointerEvents === 'none') {
        out.push(describe(el) + ': pointer-events:none');
        continue;
      }
      var hit = hitTest(el);
      if (hit.blocked) out.push(describe(el) + ' covered by ' + hit.covering.join(' > '));
    }
    return out;
  }

  function eventDelivery() {
    return new Promise(function (resolve) {
      var probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:auto;z-index:2147483647';
      document.body.appendChild(probe);
      var seen = { touchstart: false, touchend: false, click: false };
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        probe.remove();
        resolve(seen);
      }
      ['touchstart', 'touchend', 'pointerdown', 'click'].forEach(function (type) {
        probe.addEventListener(type, function () { seen[type] = true; }, { once: true });
      });
      // A synthetic tap is enough to prove the listener chain is live; a real finger
      // cannot be simulated, but a swallowed handler would block even this.
      try {
        probe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        probe.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } catch (e) { /* older WebView */ }
      setTimeout(finish, 60);
    });
  }

  function deviceDetails() {
    var nav = navigator;
    return {
      viewport: window.innerWidth + 'x' + window.innerHeight,
      dpr: window.devicePixelRatio,
      ua: String(nav.userAgent || '').slice(0, 120),
      memory: nav.deviceMemory || '(unknown)',
      cores: nav.hardwareConcurrency || '(unknown)',
      language: nav.language,
      online: nav.onLine,
    };
  }

  function collect() {
    return new Promise(function (resolve) {
      var native = window.EditorsHubNative || window.OpenMotionNative;
      var info = {};
      try {
        if (native && native.deviceInfo) info = JSON.parse(native.deviceInfo());
      } catch (e) { /* web preview */ }

      frames(function (gaps) {
        var timing = stats(gaps);
        eventDelivery().then(function (delivery) {
          resolve({
            at: new Date().toISOString(),
            build: (window.__omsShellVersion || '') + '',
            device: info,
            runtime: deviceDetails(),
            webgl: webglReport(),
            frame: timing,
            framesSampled: gaps.length > 0,
            hit: hitTest(null),
            unreachable: unreachable(),
            delivery: delivery,
            ui: {
              splash: !!document.getElementById('appSplashScreen'),
              home: !!(document.getElementById('home') && !document.getElementById('home').classList.contains('hidden')),
              editor: !!(document.getElementById('editor') && !document.getElementById('editor').classList.contains('hidden')),
              notice: (function () {
                var n = document.getElementById('experimentalNotice');
                return !!(n && n.getAttribute('aria-hidden') !== 'true');
              })(),
            },
          });
        });
      });
    });
  }

  /** Plain-language report: the first line is the conclusion, the rest is evidence. */
  function format(report) {
    var lines = [];
    var t = report.frame;
    var verdict;
    if (!report.framesSampled) {
      verdict = 'Frame timing could not be measured (the page never drew a frame).';
    } else if (t.fps && t.fps < 24) {
      verdict = 'The device is saturated: frames take ' + t.median + 'ms (about ' + t.fps + ' fps).';
    } else if (report.unreachable.length) {
      verdict = 'Controls are covered by other elements, so taps cannot reach them.';
    } else if (!report.webgl.supported || report.webgl.error !== '0' && report.webgl.error !== 'NO_ERROR') {
      verdict = 'The GPU renderer is failing, which leaves the preview black.';
    } else {
      verdict = 'No fault detected in this report.';
    }
    lines.push('VERDICT: ' + verdict);
    lines.push('');
    lines.push(report.framesSampled
      ? 'Frames: ' + t.median + 'ms typical, ' + t.worst + 'ms worst, ~' + t.fps +
        ' fps, ' + t.jank + '% of frames were late'
      : 'Frames: not sampled (no frame callbacks arrived within 2s)');
    lines.push('WebGL: ' + (report.webgl.supported ? report.webgl.version : 'UNSUPPORTED') +
      ' | ' + report.webgl.renderer + ' | error=' + report.webgl.error);
    lines.push('Tap reaches: ' + report.hit.top + ' at ' + report.hit.x + ',' + report.hit.y);
    lines.push('Event chain: ' + Object.keys(report.delivery)
      .map(function (k) { return k + '=' + (report.delivery[k] ? 'yes' : 'no'); }).join(' '));
    lines.push('Unreachable controls: ' + (report.unreachable.length || 'none'));
    report.unreachable.forEach(function (u) { lines.push('  - ' + u); });
    lines.push('Viewport: ' + report.runtime.viewport + ' @' + report.runtime.dpr + 'x');
    lines.push('Device: ' + [report.device.manufacturer, report.device.model, report.device.android]
      .filter(Boolean).join(' ') + ' | sdk ' + (report.device.sdk || '?') +
      ' | ' + (report.device.cores || '?') + ' cores | heap ' + (report.device.heapMb || '?') + 'MB');
    lines.push('State: ' + JSON.stringify(report.ui));
    lines.push('At: ' + report.at);
    return lines.join('\n');
  }

  /** Opens the diagnostic sheet. Reached from Settings and from the error card. */
  function open() {
    if (typeof window.__omsDialog !== 'function') return;
    // The dialog resolves with the pressed value; it does not expose the element, so the
    // progress sheet is torn down explicitly once the sample finishes.
    window.__omsDialog({
      title: 'Measuring…',
      message: 'Sampling frames. This takes about two seconds.',
      acceptLabel: 'Close',
      cancelable: false,
    });
    collect().then(function (report) {
      var text = format(report);
      try {
        var native = window.EditorsHubNative || window.OpenMotionNative;
        if (native && native.saveDiagnostics) native.saveDiagnostics(text);
        if (native && native.log) native.log('INFO', 'diagnostics saved');
      } catch (e) { /* ignore */ }
      dismissAllSheets();
      window.omsInfo('Diagnostics', text).then(function () {
        copy(text);
      });
    });
  }

  /** Closes every open sheet, so the report replaces the progress sheet. */
  function dismissAllSheets() {
    var sheets = document.querySelectorAll('#omsDialogScrim');
    for (var i = 0; i < sheets.length; i++) sheets[i].remove();
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        if (window.toast) window.toast('Diagnostics copied');
      }
    } catch (e) { /* clipboard may be unavailable; the text is on screen anyway */ }
  }

  window.omsDiagnostics = { open: open, collect: collect, format: format };
})();
