/*
 * Vectorscope and waveform: real measurements of a frame, drawn as scopes.
 *
 * A vectorscope is not decoration. It plots chroma in polar space so you can see at a glance
 * whether skin tones sit on the I-line and whether the cast is warm or cool. The waveform below
 * plots luma per column. Both read pixels from the editor's own canvas at the current time, so
 * what they show is the frame you are actually looking at.
 *
 * This file only measures and draws. It does not change the picture.
 */
(function () {
  'use strict';
  if (window.omsAmzScopes) return;

  function hub() { return window.omsAmzHub; }
  function notify(m) {
    try { if (hub() && hub().notify) return hub().notify(m); } catch (e) {}
    try { if (window.toast) window.toast(m); } catch (e) {}
  }

  /** The editor's preview canvas, whatever it is currently called. */
  function previewCanvas() {
    var candidates = ['#preview canvas', '#canvas', 'canvas.preview', '#previewCanvas', 'canvas'];
    for (var i = 0; i < candidates.length; i++) {
      var c = document.querySelector(candidates[i]);
      if (c && c.width && c.height) return c;
    }
    return null;
  }

  /**
   * Read the preview at reduced size.
   *
   * Scopes do not need full resolution - a 240 px wide sample has the same colour distribution as
   * a 4K frame and is fast enough to run while scrubbing.
   */
  function sample(width) {
    var src = previewCanvas();
    if (!src) return null;
    var w = Math.min(width || 240, src.width);
    var h = Math.max(1, Math.round((src.height / src.width) * w));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    try { ctx.drawImage(src, 0, 0, w, h); } catch (e) { return null; }
    try { return { data: ctx.getImageData(0, 0, w, h), w: w, h: h }; } catch (e) { return null; }
  }

  /* RGB -> the Y'CbCr pair a vectorscope plots. BT.601 coefficients, which is what the
     editor's own colour maths uses; mixing standards would make the graticule wrong. */
  function toCbCr(r, g, b) {
    var y = 0.299 * r + 0.587 * g + 0.114 * b;
    return {
      y: y,
      cb: -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
      cr: 0.5 * r - 0.418688 * g - 0.081312 * b + 128,
    };
  }

  /**
   * Measure an ImageData into a chroma histogram. Pure: no canvas, no drawing.
   *
   * Kept separate from the drawing so the numbers can be checked against known colours
   * without a raster surface, which is exactly what a headless test cannot provide.
   */
  function measure(imageData) {
    if (!imageData || !imageData.data) return { empty: true, count: 0 };
    var d = imageData.data;
    var hist = new Uint32Array(128 * 128);
    var count = 0, satSum = 0, ySum = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var c = toCbCr(r, g, b);
      var bx = Math.max(0, Math.min(127, Math.round(((c.cb - 128) / 128) * 63 + 64)));
      var by = Math.max(0, Math.min(127, Math.round(((-(c.cr - 128)) / 128) * 63 + 64)));
      hist[by * 128 + bx]++;
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      ySum += c.y;
      count++;
    }
    if (!count) return { empty: true, count: 0 };
    var peak = 0;
    for (var p = 0; p < hist.length; p++) if (hist[p] > peak) peak = hist[p];
    return {
      empty: false, count: count, hist: hist, peak: peak,
      saturation: satSum / count, luma: ySum / count,
    };
  }

  /** Luma-per-column histogram for the waveform. Pure, same reason as measure(). */
  function waveformHist(imageData, cols, rows) {
    if (!imageData || !imageData.data) return null;
    var d = imageData.data;
    var w = imageData.width, h = imageData.height;
    var hist = new Uint32Array(cols * rows);
    for (var py = 0; py < h; py++) {
      for (var px = 0; px < w; px++) {
        var off = (py * w + px) * 4;
        if (d[off + 3] < 8) continue;
        var yv = toCbCr(d[off], d[off + 1], d[off + 2]).y;
        var cx = Math.min(cols - 1, Math.floor((px / w) * cols));
        var cy = Math.min(rows - 1, Math.max(0, Math.floor((1 - yv / 255) * (rows - 1))));
        hist[cy * cols + cx]++;
      }
    }
    var peak = 0;
    for (var i = 0; i < hist.length; i++) if (hist[i] > peak) peak = hist[i];
    return { hist: hist, peak: peak, cols: cols, rows: rows };
  }

  /**
   * Draw a vectorscope into a canvas.
   *
   * Every sample is accumulated into a 2D histogram first, then drawn with brightness by density.
   * Plotting raw pixels one on top of another hides the structure - the whole point of a scope is
   * to see where the mass is.
   */
  function drawVectorscope(canvas, options) {
    var opts = options || {};
    var s = sample(opts.sample || 240);
    var ctx = canvas.getContext && canvas.getContext('2d');
    /* A canvas with no 2D context (a headless run, or a GPU-less WebView) is a real case:
       report it rather than throwing on the first clearRect. */
    if (!ctx) return { count: 0, empty: true, noContext: true };
    var size = Math.min(canvas.width, canvas.height);
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var radius = size / 2 - 8;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* Graticule: the six primaries and secondaries on the colour circle, plus the I-line. */
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    var targets = [
      { name: 'R', r: 255, g: 0, b: 0 },
      { name: 'Yl', r: 255, g: 255, b: 0 },
      { name: 'G', r: 0, g: 255, b: 0 },
      { name: 'Cy', r: 0, g: 255, b: 255 },
      { name: 'B', r: 0, g: 0, b: 255 },
      { name: 'Mg', r: 255, g: 0, b: 255 },
    ];
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    targets.forEach(function (t) {
      var c = toCbCr(t.r, t.g, t.b);
      var x = cx + ((c.cb - 128) / 128) * radius;
      var y = cy - ((c.cr - 128) / 128) * radius;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(t.name, x + (x > cx ? 9 : -9), y);
    });

    if (!s) return { count: 0, empty: true };

    var m = measure(s.data);
    if (m.empty) return { count: 0, empty: true };
    var hist = m.hist, peak = m.peak, count = m.count;

    if (typeof ctx.createImageData !== 'function' || typeof ctx.putImageData !== 'function') {
      return { count: count, empty: false, noImageData: true, saturation: 0, luma: 0 };
    }
    var img = ctx.createImageData(canvas.width, canvas.height);
    var out = img.data;
    for (var hy = 0; hy < 128; hy++) {
      for (var hx = 0; hx < 128; hx++) {
        var v = hist[hy * 128 + hx];
        if (!v) continue;
        /* sqrt keeps sparse but meaningful outliers visible against a dense centre. */
        var a = Math.min(1, Math.sqrt(v / peak) * 1.5);
        var px = Math.round(cx + ((hx - 64) / 64) * radius);
        var py = Math.round(cy + ((hy - 64) / 64) * radius);
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var ix = px + ox, iy = py + oy;
            if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) continue;
            var off = (iy * canvas.width + ix) * 4;
            var add = a * (ox === 0 && oy === 0 ? 1 : 0.42);
            out[off] = Math.min(255, out[off] + 80 * add);
            out[off + 1] = Math.min(255, out[off + 1] + 230 * add);
            out[off + 2] = Math.min(255, out[off + 2] + 120 * add);
            out[off + 3] = Math.min(255, out[off + 3] + 255 * add);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    return { count: count, empty: false, saturation: m.saturation, luma: m.luma };
  }

  /** Waveform: luma per column, drawn as a density plot. */
  function drawWaveform(canvas) {
    var s = sample(240);
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { empty: true, noContext: true };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (var g = 1; g < 4; g++) {
      var y = Math.round((canvas.height / 4) * g);
      ctx.fillRect(0, y, canvas.width, 1);
    }
    if (!s) return { empty: true };
    var cols = canvas.width;
    var rows = canvas.height;
    var wm = waveformHist(s.data, cols, rows);
    if (!wm) return { empty: true };
    var hist = wm.hist, peak = wm.peak;
    if (typeof ctx.createImageData !== 'function') return { empty: false, noImageData: true };
    var img = ctx.createImageData(cols, rows);
    var out = img.data;
    for (var i2 = 0; i2 < hist.length; i2++) {
      if (!hist[i2]) continue;
      var a = Math.min(1, Math.sqrt(hist[i2] / peak) * 1.6);
      out[i2 * 4] = 235; out[i2 * 4 + 1] = 240; out[i2 * 4 + 2] = 245;
      out[i2 * 4 + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    return { empty: false };
  }

  /* ======================================================================== the panel */

  function openScopes() {
    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    sheet({
      title: 'Vectorscope',
      subtitle: 'Chroma and luma of the current frame',
      build: function (body) {
        var note = document.createElement('p');
        note.className = 'amzNote';
        note.textContent = 'Measured from the preview at the playhead. The graticule marks the six primary and secondary colours; the green trace is where your pixels actually land. Skin tones want to sit near the upper-left, slightly toward red.';
        body.appendChild(note);

        var vec = document.createElement('canvas');
        vec.width = 260; vec.height = 260;
        vec.style.cssText = 'width:100%;max-width:260px;display:block;margin:0 auto;background:#0d0f12;border-radius:10px';
        body.appendChild(vec);

        var readout = document.createElement('p');
        readout.className = 'amzNote';
        body.appendChild(readout);

        var wfLabel = document.createElement('div');
        wfLabel.className = 'amzGroup';
        wfLabel.textContent = 'Luma waveform';
        body.appendChild(wfLabel);

        var wf = document.createElement('canvas');
        wf.width = 260; wf.height = 110;
        wf.style.cssText = 'width:100%;max-width:260px;display:block;margin:0 auto;background:#0d0f12;border-radius:10px';
        body.appendChild(wf);

        function refresh() {
          var res = drawVectorscope(vec);
          drawWaveform(wf);
          if (res.empty) {
            readout.textContent = 'No preview frame to measure. Open a project and put the playhead on some content.';
          } else {
            readout.textContent =
              Math.round(res.count / 1000) + 'k samples · mean saturation ' +
              Math.round(res.saturation * 100) + '% · mean luma ' + Math.round(res.luma);
          }
        }
        refresh();
        /* Follow the playhead while the sheet is open, and stop when it goes away. */
        var timer = setInterval(refresh, 500);
        var observer = new MutationObserver(function () {
          if (!document.body.contains(vec)) { clearInterval(timer); observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  window.omsAmzScopes = {
    toCbCr: toCbCr,
    measure: measure,
    waveformHist: waveformHist,
    sample: sample,
    drawVectorscope: drawVectorscope,
    drawWaveform: drawWaveform,
    openScopes: openScopes,
  };
})();
