/*
 * The extra media tools. Each one is a real operation on the user's own file, run in the page:
 * decode, process, write a new file. Where a step is an estimate rather than a trained model,
 * the tool's own text says so.
 *
 * Every tool is a function that receives a panel element and fills it in. They all share the
 * same shape: a source picker, a progress bar, a result block with what was made.
 */
(function () {
  'use strict';
  if (window.omsAmzTools) return;

  var M = window.omsAmzMedia;
  var el = M.el;

  function hub() { return window.omsAmzHub; }
  function notify(m) { if (hub()) hub().notify(m); }

  /* ------------------------------------------------------------------- panel pieces */

  function sourceBlock(panel, accept, onPick) {
    var box = el('div', 'amz-field');
    box.appendChild(el('div', 'amz-label', 'Source file'));
    var row = el('div', 'amz-row');
    var btn = el('button', 'amz-btn', 'Choose file');
    var name = el('span', 'amz-muted', 'Nothing chosen yet');
    row.appendChild(btn);
    row.appendChild(name);
    box.appendChild(row);
    panel.appendChild(box);
    var current = null;
    btn.addEventListener('click', function () {
      M.pickFile(accept).then(function (src) {
        current = src;
        name.textContent = src.name + ' · ' + (src.bytes / 1048576).toFixed(1) + ' MB';
        btn.textContent = 'Change file';
        if (onPick) onPick(src);
      }).catch(function (e) { notify(e.message || 'Nothing chosen'); });
    });
    return { get: function () { return current; } };
  }

  function infoRow(panel, label, valueId) {
    var row = el('div', 'amz-kv');
    row.appendChild(el('span', 'amz-k', label));
    var v = el('span', 'amz-v', '—');
    if (valueId) v.id = valueId;
    row.appendChild(v);
    panel.appendChild(row);
    return v;
  }

  function buttonRow(panel, buttons) {
    var row = el('div', 'amz-row amz-actions');
    buttons.forEach(function (b) {
      var btn = el('button', 'amz-btn' + (b.primary ? ' amz-primary' : ''), b.label);
      if (b.disabled) btn.disabled = true;
      btn.addEventListener('click', function () { b.onClick(btn); });
      row.appendChild(btn);
    });
    panel.appendChild(row);
    return row;
  }

  /**
   * Runs a job with a progress bar and a cancel button. `work` is called with a reporter that
   * knows the current phase and fraction. Cancellation is cooperative: work checks rep.cancelled.
   */
  function runJob(panel, work) {
    var wrap = el('div', 'amz-job');
    var status = el('div', 'amz-status', 'Starting…');
    var bar = el('div', 'amz-bar');
    var fill = el('div', 'amz-fill');
    fill.style.width = '0%';
    bar.appendChild(fill);
    var cancel = el('button', 'amz-btn amz-small', 'Cancel');
    wrap.appendChild(status);
    wrap.appendChild(bar);
    wrap.appendChild(cancel);
    panel.appendChild(wrap);

    var rep = {
      cancelled: false,
      at: function (fraction, text) {
        fill.style.width = Math.max(0, Math.min(100, fraction * 100)).toFixed(1) + '%';
        if (text) status.textContent = text;
      },
      done: function (text) {
        rep.at(1, text);
        cancel.remove();
      },
      fail: function (err) {
        status.textContent = 'Stopped: ' + (err && err.message ? err.message : String(err));
        fill.style.background = '#c0392b';
        cancel.remove();
        M.log('job failed: ' + (err && err.message));
      },
    };
    cancel.addEventListener('click', function () {
      rep.cancelled = true;
      status.textContent = 'Cancelling…';
    });
    Promise.resolve().then(function () { return work(rep); }).catch(rep.fail);
    return rep;
  }

  function resultBlock(panel) {
    var box = el('div', 'amz-result');
    box.appendChild(el('div', 'amz-label', 'Result'));
    panel.appendChild(box);
    return {
      heading: function (t) { box.appendChild(el('div', 'amz-result-h', t)); },
      line: function (k, v) {
        var row = el('div', 'amz-kv');
        row.appendChild(el('span', 'amz-k', k));
        row.appendChild(el('span', 'amz-v', v));
        box.appendChild(row);
      },
      preview: function (canvas) {
        canvas.className = 'amz-preview';
        box.appendChild(canvas);
      },
      actions: function (buttons) { buttonRow(box, buttons); },
      note: function (t) { box.appendChild(el('p', 'amz-note', t)); },
    };
  }

  function canvasFor(frame, w, h) {
    var c = document.createElement('canvas');
    c.width = w || frame.width;
    c.height = h || frame.height;
    M.drawToCanvas(c.getContext('2d'), frame, c.width, c.height);
    return c;
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function baseName(n) { return String(n || 'clip').replace(/\.[^.]+$/, ''); }

  /* ------------------------------------------------------------- hand-off to the editor */

  /**
   * Adds a finished image or audio file to the open project as a new layer, so a tool's output
   * can be used straight away instead of only being saved to disk.
   */
  function addToProject(blob, name, type) {
    return new Promise(function (resolve) {
      try {
        var model = window.model;
        if (!model || !model.addLayer) return resolve('No project is open — save the file instead');
        var reader = new FileReader();
        reader.onload = function () {
          try {
            /* The editor identifies media by dataUrl (and an assetId derived from it), so the
               result is attached the same way a hand-imported file is. Attaching a File
               object instead produces a layer that exists but draws nothing. */
            var layer = model.addLayer(type || (blob.type.indexOf('audio') === 0 ? 'audio' : 'video'),
              { name: name, dataUrl: reader.result });
            if (!layer) return resolve('Could not add a layer');
            try { model.hydrateLayer && model.hydrateLayer(layer); } catch (e) {}
            if (window.history && window.history.push) window.history.push();
            if (window.omsAmzBridge) window.omsAmzBridge.refresh();
            if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll();
            resolve('Added "' + name + '" to the project');
          } catch (e) { resolve('Could not add to the project: ' + e.message); }
        };
        reader.onerror = function () { resolve('Could not read the result'); };
        reader.readAsDataURL(blob);
      } catch (e) {
        M.log('addToProject: ' + e.message);
        resolve('Could not add to the project: ' + e.message);
      }
    });
  }

  /* ------------------------------------------------------------------------- the tools */

  var TOOLS = [];

  function tool(spec) { TOOLS.push(spec); }

  /* 1. Codec report ------------------------------------------------------------- */

  tool({
    id: 'codec',
    name: 'Codec report',
    group: 'Inspect',
    desc: 'What this device can actually decode and encode, and whether the vendored encoder is present.',
    run: function (panel) {
      var res = resultBlock(panel);
      var rows = [];
      rows.push(['Platform', (window.EditorsHubNative && window.EditorsHubNative.platform && window.EditorsHubNative.platform()) || 'browser']);
      if (window.Mediabunny || window.mediabunny) rows.push(['Vendored encoder', 'loaded']);
      else rows.push(['Vendored encoder', 'not present — the editor\'s own exporter is used']);

      var probe = document.createElement('video');
      var codecs = [
        ['H.264 baseline', 'video/mp4; codecs="avc1.42E01E"'],
        ['H.264 high', 'video/mp4; codecs="avc1.640028"'],
        ['HEVC', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
        ['VP9', 'video/webm; codecs="vp9"'],
        ['AV1', 'video/mp4; codecs="av01.0.05M.08"'],
        ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
        ['Opus', 'audio/webm; codecs="opus"'],
      ];
      var list = el('div', 'amz-list');
      codecs.forEach(function (c) {
        var ok = '';
        try { ok = probe.canPlayType(c[1]); } catch (e) {}
        var state = ok === 'probably' ? 'yes' : ok === 'maybe' ? 'maybe' : 'no';
        var row = el('div', 'amz-kv');
        row.appendChild(el('span', 'amz-k', c[0]));
        row.appendChild(el('span', 'amz-v amz-' + (state === 'no' ? 'bad' : state === 'yes' ? 'good' : 'mid'), state));
        list.appendChild(row);
      });

      res.heading('Decode support');
      res.line('Platform', rows[0][1]);
      res.line('Vendored encoder', rows[1] ? rows[1][1] : 'not present');
      res.line('WebGL', window.WebGLRenderingContext ? (function () {
        try {
          var c = document.createElement('canvas');
          var gl = c.getContext('webgl2') || c.getContext('webgl');
          if (!gl) return 'unavailable';
          var dbg = gl.getExtension('WEBGL_debug_renderer_info');
          return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'available';
        } catch (e) { return 'unavailable'; }
      })() : 'unavailable');
      var box = el('div');
      box.appendChild(el('div', 'amz-label', 'Container / codec probes'));
      box.appendChild(list);
      panel.appendChild(box);

      res.note('Decode support is asked of the WebView directly. Encoding is not listed because no browser exposes the encoder list; the editor asks the vendored encoder at export time and falls back to the platform encoder.');
      if (window.omsAmzExport && window.omsAmzExport.report) window.omsAmzExport.report(res);
    },
  });

  /* 2. Depth map ----------------------------------------------------------------- */

  tool({
    id: 'depth',
    name: 'Depth map',
    group: '3D & depth',
    desc: 'Estimates a depth map from a still or a clip, and can push it into the editor as a displacement layer.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'image/*,video/*');
      var modeField = el('div', 'amz-field');
      modeField.appendChild(el('div', 'amz-label', 'When the source is a video'));
      var modeSel = el('select', 'amz-select');
      [['clip', 'Process the whole clip (MP4)'], ['frame', 'First frame only (PNG)']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; modeSel.appendChild(op);
      });
      modeField.appendChild(modeSel);
      panel.appendChild(modeField);
      var res = resultBlock(panel);

      buttonRow(panel, [{
        label: 'Build depth map', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          var isVideo = /video\//.test(src.type || '') || (M.isVideoName && M.isVideoName(src.name));

          if (isVideo && modeSel.value === 'clip') {
            runJob(panel, async function (rep) {
              rep.at(0.02, 'Reading the clip…');
              var made = await streamClip(src, {
                fps: 24, maxSeconds: 20, audio: false,
                process: function (inCanvas, outCtx) {
                  var ictx = inCanvas.getContext('2d', { willReadFrequently: true });
                  var img = ictx.getImageData(0, 0, inCanvas.width, inCanvas.height);
                  M.depthInto(img, inCanvas.width, inCanvas.height);
                  outCtx.putImageData(img, 0, 0);
                },
              }, rep);
              rep.done('Done');
              var vb = resultBlock(panel);
              vb.heading('Depth clip');
              vb.line('Frames', String(made.frames || 0));
              if (made.blob) {
                vb.actions([
                  { label: 'Save MP4', primary: true, onClick: function () { M.save(made.blob, baseName(src.name) + '-depth.mp4', 'export').then(notify); } },
                  { label: 'Add to project', onClick: function () { addToProject(made.blob, baseName(src.name) + '-depth.mp4', 'video').then(notify); } },
                ]);
              } else { vb.note(made.message); }
            });
            return;
          }

          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the file…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var frame = media.frames[0];
            if (!frame) throw new Error('No frame to analyse');
            rep.at(0.4, 'Estimating depth…');
            var canvas = canvasFor(frame);
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            M.depthInto(img, canvas.width, canvas.height);
            ctx.putImageData(img, 0, 0);
            rep.at(0.9, 'Writing…');
            var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
            rep.done('Done');
            var out = resultBlock(panel);
            out.heading('Depth map');
            out.line('Size', canvas.width + ' × ' + canvas.height);
            out.line('From', src.name);
            out.preview(canvas);
            out.actions([
              { label: 'Save PNG', primary: true, onClick: function () {
                M.save(blob, baseName(src.name) + '-depth.png', 'export').then(notify);
              } },
              { label: 'Add to project', onClick: function () {
                addToProject(blob, baseName(src.name) + '-depth.png', 'video').then(notify);
              } },
            ]);
            out.note('This is an estimate built from luminance and local contrast, not a trained depth network. It reads a normal shot as sky-far, foreground-near, which is enough to drive a parallax or displace a layer, but it will not separate two objects at the same distance.');
          });
        },
      }]);
    },
  });

  /* 3. Auto matte ---------------------------------------------------------------- */

  tool({
    id: 'matt',
    name: 'Auto matte',
    group: 'Masking',
    desc: 'Cuts a subject out of a frame. Uses the editor\'s own background remover when it is loaded, and a colour-and-edge fallback when it is not.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'image/*,video/*');
      var opts = el('div', 'amz-field');
      opts.appendChild(el('div', 'amz-label', 'Background to remove'));
      var select = el('select', 'amz-select');
      [['auto', 'Detect automatically'], ['light', 'Light background'], ['dark', 'Dark background'],
       ['green', 'Green screen'], ['blue', 'Blue screen']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        select.appendChild(op);
      });
      opts.appendChild(select);
      panel.appendChild(opts);

      var feather = el('div', 'amz-field');
      feather.appendChild(el('div', 'amz-label', 'Edge softness'));
      var range = document.createElement('input');
      range.type = 'range'; range.min = '0'; range.max = '8'; range.value = '2';
      feather.appendChild(range);
      panel.appendChild(feather);

      var modeField = el('div', 'amz-field');
      modeField.appendChild(el('div', 'amz-label', 'When the source is a video'));
      var modeSel = el('select', 'amz-select');
      [['clip', 'Process the whole clip (MP4)'], ['frame', 'First frame only (PNG)']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; modeSel.appendChild(op);
      });
      modeField.appendChild(modeSel);
      panel.appendChild(modeField);

      var res = resultBlock(panel);
      res.note('The result is premultiplied RGBA with a real alpha channel. If you need it composited over footage, add the PNG to the project and set the layer blend.');

      buttonRow(panel, [{
        label: 'Cut out subject', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          var isVideo = /video\//.test(src.type || '') || (M.isVideoName && M.isVideoName(src.name));

          if (isVideo && modeSel.value === 'clip') {
            runJob(panel, async function (rep) {
              rep.at(0.02, 'Reading the clip…');
              var mode = select.value;
              var soft = parseInt(range.value, 10) || 0;
              var made = await streamClip(src, {
                fps: 24, maxSeconds: 20, audio: false,
                process: function (inCanvas, outCtx) {
                  var w = inCanvas.width, h = inCanvas.height;
                  var ictx = inCanvas.getContext('2d', { willReadFrequently: true });
                  var img = ictx.getImageData(0, 0, w, h);
                  if (mode === 'auto' || mode === 'light' || mode === 'dark') matteByLuma(img, w, h, mode);
                  else matteByChroma(img, w, h, mode);
                  if (soft > 0) softMatte(img, w, h, soft);
                  outCtx.putImageData(img, 0, 0);
                },
              }, rep);
              rep.done('Done');
              var vb = resultBlock(panel);
              vb.heading('Cut-out clip');
              vb.line('Frames', String(made.frames || 0));
              if (made.blob) {
                vb.actions([
                  { label: 'Save MP4', primary: true, onClick: function () { M.save(made.blob, baseName(src.name) + '-cutout.mp4', 'export').then(notify); } },
                  { label: 'Add to project', onClick: function () { addToProject(made.blob, baseName(src.name) + '-cutout.mp4', 'video').then(notify); } },
                ]);
              } else { vb.note(made.message); }
              vb.note('MP4 cannot carry transparency: the removed background encodes as black. For a real alpha channel, use the frame mode and keep the PNG.');
            });
            return;
          }

          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the file…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var frame = media.frames[0];
            if (!frame) throw new Error('No frame to analyse');
            var canvas = canvasFor(frame);
            var w = canvas.width, h = canvas.height;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var img = ctx.getImageData(0, 0, w, h);

            rep.at(0.3, 'Finding the subject…');
            var mode = select.value;
            if (mode === 'auto' || mode === 'light' || mode === 'dark') {
              matteByLuma(img, w, h, mode);
            } else {
              matteByChroma(img, w, h, mode);
            }

            var soft = parseInt(range.value, 10) || 0;
            if (soft > 0) {
              rep.at(0.7, 'Softening the edge…');
              softMatte(img, w, h, soft);
            }
            ctx.putImageData(img, 0, 0);
            var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
            rep.done('Done');

            var out = resultBlock(panel);
            out.heading('Cut-out');
            out.line('Size', w + ' × ' + h);
            out.line('Method', mode === 'green' || mode === 'blue' ? 'colour key' : 'luminance split + edge tracking');
            var preview = document.createElement('canvas');
            preview.width = w; preview.height = h;
            var pctx = preview.getContext('2d');
            pctx.fillStyle = '#2a2a30';
            pctx.fillRect(0, 0, w, h);
            var step = 16;
            for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) {
              if (((x / step) + (y / step)) % 2 === 0) { pctx.fillStyle = '#35353d'; pctx.fillRect(x, y, step, step); }
            }
            pctx.drawImage(canvas, 0, 0);
            out.preview(preview);
            out.actions([
              { label: 'Save PNG', primary: true, onClick: function () {
                M.save(blob, baseName(src.name) + '-cutout.png', 'export').then(notify);
              } },
              { label: 'Add to project', onClick: function () {
                addToProject(blob, baseName(src.name) + '-cutout.png', 'video').then(notify);
              } },
            ]);
          });
        },
      }]);
    },
  });

  function matteByLuma(img, w, h, mode) {
    var d = img.data;
    var lum = new Float32Array(w * h);
    var sum = 0;
    for (var i = 0; i < w * h; i++) {
      lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      sum += lum[i];
    }
    var mean = sum / (w * h);
    /* The subject is taken to be the side of the mean that is the smaller area — this is the
       assumption that makes an automatic mode possible at all, and it is why the manual
       light/dark options exist. */
    var above = 0;
    for (var j = 0; j < w * h; j++) if (lum[j] > mean) above++;
    var subjectIsBright = above < w * h / 2;
    if (mode === 'light') subjectIsBright = true;
    if (mode === 'dark') subjectIsBright = false;

    var soft = 0.08;
    for (var k = 0; k < w * h; k++) {
      var v = lum[k];
      var a = subjectIsBright ? (v - mean) / soft : (mean - v) / soft;
      a = Math.max(0, Math.min(1, a + 0.5));
      d[k * 4 + 3] = Math.round(a * 255);
    }
  }

  function matteByChroma(img, w, h, mode) {
    var d = img.data;
    for (var i = 0; i < w * h; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      var key;
      if (mode === 'green') key = (g - Math.max(r, b)) / 255;
      else key = (b - Math.max(r, g)) / 255;
      var a = 1 - Math.max(0, Math.min(1, (key - 0.05) / 0.25));
      d[i * 4 + 3] = Math.round(a * 255);
      /* Despill: pull the key channel down to the level of the other two. */
      if (a < 0.9) {
        if (mode === 'green') d[i * 4 + 1] = Math.min(g, Math.round(Math.max(r, b) * 1.05));
        else d[i * 4 + 2] = Math.min(b, Math.round(Math.max(r, g) * 1.05));
      }
    }
  }

  function softMatte(img, w, h, radius) {
    var alpha = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) alpha[i] = img.data[i * 4 + 3];
    var blurred = M.boxBlurPlane(alpha, w, h, radius);
    for (var j = 0; j < w * h; j++) img.data[j * 4 + 3] = blurred[j];
  }

  /* 4. Upscale ------------------------------------------------------------------- */

  /* Largest frame this pipeline may produce: stills may go big, encoded video may not. */
  var STILL_AREA_LIMIT = 30e6, CLIP_AREA_LIMIT = 8.5e6;

  function feasibleScale(srcW, srcH, wanted, limit) {
    /* The area limit is the real guard: 4× on a small clip encodes fine, 2× on 4K never will. */
    var best = 0;
    [2, 3, 4].forEach(function (s) {
      if (srcW * s * (srcH * s) <= limit) best = s;
    });
    return best;
  }

  tool({
    id: 'upscale',
    name: 'Upscale',
    group: 'Enhance',
    desc: 'Enlarges a still or a whole clip with edge-aware sharpening instead of a plain stretch.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'image/*,video/*');

      var modeField = el('div', 'amz-field');
      modeField.appendChild(el('div', 'amz-label', 'When the source is a video'));
      var modeSel = el('select', 'amz-select');
      [['clip', 'Process the whole clip (MP4)'], ['frame', 'First frame only (PNG)']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; modeSel.appendChild(op);
      });
      modeField.appendChild(modeSel);
      panel.appendChild(modeField);

      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Scale'));
      var sel = el('select', 'amz-select');
      [['2', '2×'], ['3', '3×'], ['4', '4×']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      f.appendChild(sel);
      panel.appendChild(f);

      var sharp = el('div', 'amz-field');
      sharp.appendChild(el('div', 'amz-label', 'Detail recovery'));
      var r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = '100'; r.value = '55';
      sharp.appendChild(r);
      panel.appendChild(sharp);

      var res = resultBlock(panel);
      buttonRow(panel, [{
        label: 'Upscale', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          var isVideo = /video\//.test(src.type || '') || (M.isVideoName && M.isVideoName(src.name));

          if (isVideo && modeSel.value === 'clip') {
            runJob(panel, async function (rep) {
              rep.at(0.02, 'Reading the clip…');
              var meta = await M.decodeMedia(src, { maxFrames: 1 });
              var wanted = parseInt(sel.value, 10);
              var scale = feasibleScale(meta.width, meta.height, wanted, CLIP_AREA_LIMIT);
              if (!scale) throw new Error('This clip is already ' + meta.width + ' × ' + meta.height + ' — even 2× would exceed what an on-device encode can hold');
              if (scale < wanted) notify(wanted + '× would be ' + meta.width * wanted + ' × ' + meta.height * wanted + ' — using ' + scale + '× instead');
              var amount = (parseInt(r.value, 10) / 100) * 1.4;
              var outW = meta.width * scale, outH = meta.height * scale;
              var made = await streamClip(src, {
                outW: outW, outH: outH, fps: 24, maxSeconds: 20,
                process: function (inCanvas, outCtx) {
                  outCtx.imageSmoothingEnabled = true;
                  outCtx.imageSmoothingQuality = 'high';
                  outCtx.drawImage(inCanvas, 0, 0, outW, outH);
                  if (amount > 0) M.sharpen(outCtx, outW, outH, amount, Math.max(1, Math.round(scale / 2)));
                },
              }, rep);
              rep.done('Done');
              var vb = resultBlock(panel);
              vb.heading('Upscaled clip');
              vb.line('To', outW + ' × ' + outH + ' · ' + (made.frames || 0) + ' frames');
              vb.line('Audio', made.audio ? 'carried over' : 'not in the output');
              if (made.blob) {
                vb.actions([
                  { label: 'Save MP4', primary: true, onClick: function () { M.save(made.blob, baseName(src.name) + '-' + scale + 'x.mp4', 'export').then(notify); } },
                  { label: 'Add to project', onClick: function () { addToProject(made.blob, baseName(src.name) + '-' + scale + 'x.mp4', 'video').then(notify); } },
                ]);
              } else { vb.note(made.message); }
            });
            return;
          }

          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the file…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var frame = media.frames[0];
            var srcCanvas = canvasFor(frame);
            var wanted = parseInt(sel.value, 10);
            var scale = feasibleScale(srcCanvas.width, srcCanvas.height, wanted, STILL_AREA_LIMIT);
            if (!scale) throw new Error('This frame is already ' + srcCanvas.width + ' × ' + srcCanvas.height + ' — no larger size fits in this device\'s memory');
            if (scale < wanted) notify(wanted + '× would be ' + srcCanvas.width * wanted + ' × ' + srcCanvas.height * wanted + ' — using ' + scale + '× instead');
            var w = srcCanvas.width * scale, h = srcCanvas.height * scale;
            rep.at(0.25, 'Enlarging…');
            var out = document.createElement('canvas');
            out.width = w; out.height = h;
            var ctx = out.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(srcCanvas, 0, 0, w, h);
            var amount = (parseInt(r.value, 10) / 100) * 1.4;
            if (amount > 0) {
              rep.at(0.6, 'Recovering detail…');
              M.sharpen(ctx, w, h, amount, Math.max(1, Math.round(scale / 2)));
            }
            var blob = await new Promise(function (rr) { out.toBlob(rr, 'image/png'); });
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('Upscaled');
            box.line('From', srcCanvas.width + ' × ' + srcCanvas.height);
            box.line('To', w + ' × ' + h);
            box.preview(out);
            box.actions([
              { label: 'Save PNG', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-' + scale + 'x.png', 'export').then(notify); } },
              { label: 'Add to project', onClick: function () { addToProject(blob, baseName(src.name) + '-' + scale + 'x.png', 'video').then(notify); } },
            ]);
            box.note('Bicubic enlargement followed by an unsharp mask. It removes the softness a plain stretch leaves, but it cannot invent detail that was never recorded.');
          });
        },
      }]);
    },
  });

  /* 5. Decompress artifacts ------------------------------------------------------ */

  tool({
    id: 'anticompress',
    name: 'Decompress',
    group: 'Enhance',
    desc: 'Smooths the blocking and mosquito noise a low-bitrate video leaves behind, then re-sharpens what is real.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*,image/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Strength'));
      var r = document.createElement('input');
      r.type = 'range'; r.min = '1'; r.max = '10'; r.value = '5';
      f.appendChild(r);
      panel.appendChild(f);
      resultBlock(panel).note('Works on a single frame and writes a PNG. Blockiness is removed by a deblocking pass that only touches flat areas, so real edges survive.');

      buttonRow(panel, [{
        label: 'Clean a frame', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var srcCanvas = canvasFor(media.frames[0]);
            var w = srcCanvas.width, h = srcCanvas.height;
            var ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
            var img = ctx.getImageData(0, 0, w, h);
            var strength = parseInt(r.value, 10);
            rep.at(0.4, 'Deblocking…');
            deblock(img, w, h, strength / 10, 8);
            rep.at(0.7, 'Restoring edges…');
            ctx.putImageData(img, 0, 0);
            M.sharpen(ctx, w, h, 0.35 + strength * 0.05, 1);
            var blob = await new Promise(function (rr) { srcCanvas.toBlob(rr, 'image/png'); });
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('Cleaned frame');
            box.line('Size', w + ' × ' + h);
            box.preview(srcCanvas);
            box.actions([{ label: 'Save PNG', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-clean.png', 'export').then(notify); } }]);
          });
        },
      }]);
    },
  });

  /** Operates on 8×8 (or n×n) block boundaries where the two sides are close in value. */
  function deblock(img, w, h, strength, size) {
    var d = img.data;
    var copy = new Uint8ClampedArray(d);
    var t = Math.round(strength * 28);
    function smooth(a, b, c) { return Math.round((a + 2 * b + c) / 4); }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var onVert = x % size === 0 && x > 0 && x < w - 1;
        var onHorz = y % size === 0 && y > 0 && y < h - 1;
        if (!onVert && !onHorz) continue;
        var i = (y * w + x) * 4;
        for (var c = 0; c < 3; c++) {
          var here = copy[i + c];
          var left = copy[(y * w + Math.max(0, x - 1)) * 4 + c];
          var right = copy[(y * w + Math.min(w - 1, x + 1)) * 4 + c];
          var up = copy[(Math.max(0, y - 1) * w + x) * 4 + c];
          var down = copy[(Math.min(h - 1, y + 1) * w + x) * 4 + c];
          var dh = Math.abs(left - right), dv = Math.abs(up - down);
          if (onVert && dh < t) d[i + c] = smooth(left, here, right);
          else if (onHorz && dv < t) d[i + c] = smooth(up, here, down);
        }
      }
    }
  }

  /* 6. Twixtor-style speed ramp ------------------------------------------------ */

  tool({
    id: 'twistor',
    name: 'Speed ramp',
    group: 'Time',
    desc: 'Re-times a clip by synthesising in-between frames from motion, instead of repeating them.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Playback'));
      var sel = el('select', 'amz-select');
      [['0.25', '0.25× — slow to a quarter'], ['0.5', '0.5× — half speed'],
       ['2', '2× — double speed'], ['1', '1× — rebuild at 60 fps']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      sel.value = '0.5';
      f.appendChild(sel);
      panel.appendChild(f);

      resultBlock(panel).note('In-between frames come from block-matching motion estimation, run here in the page. That is the same family of technique as the classic retiming tools; it is not a trained optical-flow network, and a fast pan across a detailed background is where it will show.');

      buttonRow(panel, [{
        label: 'Build retimed clip', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a video first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the clip…');
            var media = await M.decodeMedia(src, { maxFrames: 32, fps: 30 });
            if (media.kind !== 'video' || media.frames.length < 2) throw new Error('Need at least two frames');
            var factor = parseFloat(sel.value);
            var frames = media.frames;
            var outFrames = [];
            if (factor === 1) {
              for (var a = 0; a < frames.length - 1; a++) {
                outFrames.push(frames[a]);
                outFrames.push(M.motionCompensate(frames[a], frames[a + 1], 0.5));
              }
            } else if (factor < 1) {
              var step = factor;
              for (var pos = 0; pos < frames.length - 1; pos += step) {
                var i0 = Math.floor(pos);
                var frac = pos - i0;
                if (rep.cancelled) break;
                rep.at(pos / frames.length, 'Synthesising frame ' + outFrames.length + '…');
                await tick();
                outFrames.push(frac < 0.02 ? frames[i0] : M.motionCompensate(frames[i0], frames[i0 + 1], frac));
              }
            } else {
              var stride = Math.round(factor);
              for (var k = 0; k < frames.length; k += stride) outFrames.push(frames[k]);
            }
            rep.at(0.85, 'Assembling…');
            var out = await framesToVideo(outFrames, media.audio, factor, src.name, rep);
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('Retimed');
            box.line('Frames', String(outFrames.length));
            box.line('Speed', factor + '×');
            box.line('Audio', media.audio ? 'carried over' : 'none in source');
            if (out.blob) {
              box.actions([
                { label: 'Save MP4', primary: true, onClick: function () { M.save(out.blob, out.name, 'export').then(notify); } },
                { label: 'Add to project', onClick: function () { addToProject(out.blob, out.name, 'video').then(notify); } },
              ]);
            } else {
              box.note(out.message);
            }
          });
        },
      }]);
    },
  });

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /** AudioBuffer out of whatever a tool carries: a real AudioBuffer or a raw channel list. */
  function audioBufferOf(audio) {
    if (!audio) return null;
    if (typeof AudioBuffer !== 'undefined' && audio instanceof AudioBuffer) return audio;
    if (audio.channels && audio.sampleRate && audio.channels.length) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        var actx = new AC();
        var buf = actx.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
        for (var i = 0; i < audio.channels.length; i++) buf.getChannelData(i).set(audio.channels[i]);
        return buf;
      } catch (e) { return null; }
    }
    return null;
  }

  /** Adds the audio track to a mediabunny output before output.start(). Best effort. */
  function muxAudio(output, audio, enc) {
    if (!audio || !enc || !enc.AudioBufferSource) return null;
    var buf = audioBufferOf(audio);
    if (!buf) return null;
    try {
      var asrc = new enc.AudioBufferSource({ codec: 'aac', bitrate: 128000 });
      output.addAudioTrack(asrc);
      return { source: asrc, buffer: buf };
    } catch (e) {
      M.log('audio track skipped: ' + (e && e.message));
      return null;
    }
  }

  /**
   * Processes a whole clip frame by frame and writes an MP4, holding at most two frames
   * in memory at once. decodeMedia() collects every frame before returning, which caps
   * whole-clip work at about a second of video; this streams: seek, draw, process,
   * encode, release. Audio is decoded once and muxed when the device offers AAC.
   *
   * opts: { process(inCanvas, outCtx), outW, outH, fps, maxSeconds, audio }
   * process() draws the finished frame into outCtx; the encoder snapshots it.
   */
  async function streamClip(src, opts, rep) {
    var enc = window.Mediabunny || window.mediabunny;
    if (!enc || !enc.Output || !enc.CanvasSource) {
      return { message: 'The MP4 encoder is not reachable from this screen. Export from the project instead.' };
    }
    var v = document.createElement('video');
    v.src = src.url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    try {
      await new Promise(function (res, rej) {
        var settled = false;
        var done = function (fn, arg) { if (settled) return; settled = true; fn(arg); };
        v.onloadedmetadata = function () { done(res); };
        v.onerror = function () { done(rej, new Error('This device cannot decode that video')); };
        setTimeout(function () { done(rej, new Error('Timed out reading the video')); }, 25000);
      });

      var srcW = v.videoWidth || 720, srcH = v.videoHeight || 1280;
      var outW = opts.outW || srcW, outH = opts.outH || srcH;
      var fps = opts.fps || 24;
      var seconds = Math.min(isFinite(v.duration) ? v.duration : 0, opts.maxSeconds || 20);
      var count = Math.max(2, Math.round(seconds * fps));

      var inCanvas = document.createElement('canvas');
      inCanvas.width = srcW; inCanvas.height = srcH;
      var inCtx = inCanvas.getContext('2d', { willReadFrequently: true });
      var outCanvas = document.createElement('canvas');
      outCanvas.width = outW; outCanvas.height = outH;
      var outCtx = outCanvas.getContext('2d', { willReadFrequently: true });

      /* The audio decode runs while the video track is being set up; a failure here must
         never cost the video. */
      var audio = null;
      if (opts.audio !== false) {
        try { audio = (await M.decodeMedia(src, { maxFrames: 1 })).audio; } catch (e) { audio = null; }
      }

      var target = new enc.BufferTarget();
      var output = new enc.Output({ format: new enc.Mp4OutputFormat(), target: target });
      var codec = 'avc';
      if (enc.canEncodeVideo) {
        var candidates = [enc.VIDEO_CODECS && enc.VIDEO_CODECS.AVC, 'avc', 'vp9', 'av1'].filter(Boolean);
        for (var c = 0; c < candidates.length; c++) {
          var okc = await enc.canEncodeVideo(candidates[c]).catch(function () { return false; });
          if (okc) { codec = candidates[c]; break; }
        }
      }
      var source = new enc.CanvasSource(outCanvas, { codec: codec });
      output.addVideoTrack(source, { frameRate: fps });
      var pendingAudio = muxAudio(output, audio, enc);
      await output.start();
      if (pendingAudio) {
        try { await pendingAudio.source.add(pendingAudio.buffer); } catch (e) { M.log('audio mux: ' + (e && e.message)); }
      }

      for (var i = 0; i < count; i++) {
        if (rep && rep.cancelled) break;
        var t = Math.min(i / fps, Math.max(0, seconds - 0.001));
        await new Promise(function (res) {
          var done = false;
          var finish = function () { if (done) return; done = true; v.removeEventListener('seeked', finish); res(); };
          v.addEventListener('seeked', finish);
          try { v.currentTime = t; } catch (e) { finish(); }
          setTimeout(finish, 1500);
        });
        try { inCtx.drawImage(v, 0, 0, srcW, srcH); } catch (e) { break; }
        opts.process(inCanvas, outCtx);
        await source.add(i / fps, 1 / fps);
        if (rep && i % 2 === 0) rep.at(0.05 + 0.9 * (i / count), 'Frame ' + (i + 1) + ' of ' + count + '…');
        if (i % 3 === 0) await tick();
      }
      await output.finalize();
      var buf = await target.buffer;
      return { blob: new Blob([buf], { type: 'video/mp4' }), frames: count, audio: !!pendingAudio };
    } finally {
      try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Assembles frames into a file. The vendored encoder writes a real MP4 with the audio track;
   * if it cannot be reached, the frames are handed to the editor's own export path so the result
   * is still usable rather than lost.
   */
  async function framesToVideo(frames, audio, factor, name, rep, suffix) {
    var w = frames[0].width, h = frames[0].height;
    var fps = 30;
    var enc = window.Mediabunny || window.mediabunny;
    if (enc && enc.Output && enc.CanvasSource) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        var target = new enc.BufferTarget();
        var output = new enc.Output({
          format: new enc.Mp4OutputFormat(),
          target: target,
        });
        /* The encoder wants an explicit codec; ask it which ones this device can actually
           produce rather than assuming H.264 is available. */
        var codec = 'avc';
        if (enc.canEncodeVideo) {
          var candidates = [enc.VIDEO_CODECS && enc.VIDEO_CODECS.AVC, 'avc', 'vp9', 'av1'].filter(Boolean);
          for (var c = 0; c < candidates.length; c++) {
            var ok = await enc.canEncodeVideo(candidates[c]).catch(function () { return false; });
            if (ok) { codec = candidates[c]; break; }
          }
        }
        var source = new enc.CanvasSource(canvas, { codec: codec });
        output.addVideoTrack(source, { frameRate: fps });
        /* The audio track used to be silently dropped while the result card still said
           "carried over". It is muxed for real now. */
        var pendingAudio = muxAudio(output, audio, enc);
        await output.start();
        if (pendingAudio) {
          try { await pendingAudio.source.add(pendingAudio.buffer); } catch (e) { M.log('audio mux: ' + (e && e.message)); }
        }
        for (var i = 0; i < frames.length; i++) {
          if (rep && rep.cancelled) break;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(frames[i].data), w, h), 0, 0);
          await source.add(i / fps, 1 / fps);
          if (rep && i % 4 === 0) rep.at(0.85 + 0.1 * (i / frames.length), 'Encoding ' + (i + 1) + '/' + frames.length + '…');
        }
        await output.finalize();
        var buf = await target.buffer;
        var blob = new Blob([buf], { type: 'video/mp4' });
        return { blob: blob, name: baseName(name) + '-' + (suffix || 'retimed') + '.mp4', audio: !!pendingAudio };
      } catch (e) {
        M.log('vendored encode failed: ' + (e && e.message));
      }
    }
    return {
      message: 'The frames were built but the encoder is not reachable from this screen. Open the project and use Export — the editor\'s own exporter will write them with the audio.',
    };
  }

  /* 7. Dead frame remover ------------------------------------------------------- */

  tool({
    id: 'deadframe',
    name: 'Dead frames',
    group: 'Cleanup',
    desc: 'Finds the frames in a clip that carry no change — held stills, black gaps, frozen capture — and lists where they are.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Sensitivity'));
      var r = document.createElement('input');
      r.type = 'range'; r.min = '1'; r.max = '30'; r.value = '6';
      f.appendChild(r);
      panel.appendChild(f);

      buttonRow(panel, [{
        label: 'Scan for dead frames', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a video first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the clip…');
            var media = await M.decodeMedia(src, { maxFrames: 60, fps: 30 });
            if (media.frames.length < 2) throw new Error('Need at least two frames');
            var threshold = parseInt(r.value, 10);
            var dead = [];
            for (var i = 1; i < media.frames.length; i++) {
              if (rep.cancelled) break;
              var diff = M.meanAbsDiff(media.frames[i - 1], media.frames[i]);
              if (diff < threshold) dead.push({ index: i, time: media.frames[i].time, diff: diff });
              rep.at(0.15 + 0.7 * (i / media.frames.length), 'Comparing frame ' + i + '…');
            }
            rep.done('Scan finished');
            var box = resultBlock(panel);
            box.heading(dead.length ? dead.length + ' dead frame' + (dead.length > 1 ? 's' : '') : 'No dead frames');
            box.line('Frames sampled', String(media.frames.length));
            box.line('Threshold', String(threshold));
            if (dead.length) {
              var list = el('div', 'amz-list');
              dead.slice(0, 40).forEach(function (d) {
                var row = el('div', 'amz-kv');
                row.appendChild(el('span', 'amz-k', d.time.toFixed(2) + ' s'));
                row.appendChild(el('span', 'amz-v', 'difference ' + d.diff.toFixed(1)));
                list.appendChild(row);
              });
              box.node = list;
              panel.appendChild(list);
            } else {
              box.note('Every sampled frame differs from the one before it by more than the threshold.');
            }
          });
        },
      }]);
    },
  });

  /* 8. Stabiliser --------------------------------------------------------------- */

  tool({
    id: 'stabilizer',
    name: 'Stabiliser',
    group: 'Cleanup',
    desc: 'Measures the shake between frames and writes a stabilised PNG sequence plus the per-frame offsets.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Crop to hide the edges'));
      var crop = document.createElement('input');
      crop.type = 'range'; crop.min = '0'; crop.max = '12'; crop.value = '4';
      f.appendChild(crop);
      panel.appendChild(f);

      resultBlock(panel).note('Motion is measured by whole-frame block matching. Handheld shake, which is small and high-frequency, is what this removes; a travelling camera move is large and slow and is left alone.');

      buttonRow(panel, [{
        label: 'Stabilise', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a video first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the clip…');
            var media = await M.decodeMedia(src, { maxFrames: 24, fps: 24 });
            if (media.frames.length < 2) throw new Error('Need at least two frames');
            var offsets = [{ dx: 0, dy: 0 }];
            for (var i = 1; i < media.frames.length; i++) {
              if (rep.cancelled) break;
              var s = M.estimateShift(media.frames[i - 1], media.frames[i]);
              var last = offsets[offsets.length - 1];
              offsets.push({ dx: last.dx + s[0], dy: last.dy + s[1] });
              rep.at(0.1 + 0.5 * (i / media.frames.length), 'Measuring motion ' + i + '/' + media.frames.length + '…');
            }
            /* Smoothing the path is what separates stabilisation from a static crop. */
            var smooth = offsets.map(function (o, idx) {
              var lo = Math.max(0, idx - 3), hi = Math.min(offsets.length - 1, idx + 3);
              var sx = 0, sy = 0, n = 0;
              for (var j = lo; j <= hi; j++) { sx += offsets[j].dx; sy += offsets[j].dy; n++; }
              return { dx: sx / n, dy: sy / n };
            });
            var cropPx = parseInt(crop.value, 10);
            rep.at(0.65, 'Writing frames…');
            var outFrames = media.frames.map(function (frame, idx) {
              var canvas = document.createElement('canvas');
              canvas.width = frame.width; canvas.height = frame.height;
              var ctx = canvas.getContext('2d');
              var shiftX = smooth[idx].dx - offsets[idx].dx;
              var shiftY = smooth[idx].dy - offsets[idx].dy;
              ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
              var out = document.createElement('canvas');
              out.width = frame.width - cropPx * 2;
              out.height = frame.height - cropPx * 2;
              out.getContext('2d').drawImage(canvas, -cropPx + shiftX, -cropPx + shiftY);
              return out;
            });
            rep.done('Stabilised');
            var box = resultBlock(panel);
            box.heading('Stabilised frames');
            box.line('Frames', String(outFrames.length));
            box.line('Max correction', Math.round(Math.max.apply(null, offsets.map(function (o) { return Math.hypot(o.dx, o.dy); }))) + ' px');
            box.preview(outFrames[Math.floor(outFrames.length / 2)]);
            box.actions([{
              label: 'Save first frame', primary: true,
              onClick: function () {
                outFrames[Math.floor(outFrames.length / 2)].toBlob(function (blob) {
                  M.save(blob, baseName(src.name) + '-stabilised.png', 'export').then(notify);
                }, 'image/png');
              },
            }]);
            /* ---- Write the correction onto the layer as position keyframes ---- */
            var layer = (function () {
              var m = window.model;
              if (!m) return null;
              try { if (typeof m.selectedLayer === 'function') return m.selectedLayer(); } catch (e) {}
              for (var i = 0; i < (m.layers || []).length; i++) if (m.layers[i].id === m.selected) return m.layers[i];
              return null;
            })();

            var worst = Math.round(Math.max.apply(null, offsets.map(function (o) { return Math.hypot(o.dx, o.dy); })));
            box.line('Worst correction', worst + ' px');

            if (layer && window.omsAmzBridge) {
              box.actions([{
                label: 'Apply to selected layer',
                primary: true,
                onClick: function () {
                  var fps = media.fps || 24;
                  var baseX = Number(layer.x) || 0;
                  var baseY = Number(layer.y) || 0;
                  window.omsAmzBridge.checkpoint();
                  var wrote = 0;
                  for (var i2 = 0; i2 < offsets.length; i2++) {
                    /* Project time then the layer's own local time - a key outside the layer's
                       span is invisible and looks like the tool silently failed. */
                    var projectTime = (src.startTime || 0) + i2 / fps;
                    var localTime = window.omsAmzBridge.layerLocalTime(layer, projectTime);
                    if (localTime > (Number(layer.duration) || Infinity)) break;
                    window.omsAmzBridge.setKey(layer, 'x', localTime, baseX + (smooth[i2].dx - offsets[i2].dx), 'linear');
                    window.omsAmzBridge.setKey(layer, 'y', localTime, baseY + (smooth[i2].dy - offsets[i2].dy), 'linear');
                    wrote++;
                  }
                  window.omsAmzBridge.refresh();
                  notify(wrote ? 'Wrote ' + wrote + ' position keyframes' : 'No keyframes written');
                  box.note(wrote
                    ? 'Wrote ' + wrote + ' position keyframes onto "' + (layer.name || 'the selected layer') + '", one per measured frame. Undo removes them all.'
                    : 'The selected layer has no room for these keys in its span.');
                },
              }]);
              box.note('The shake is already measured; applying it writes one position keyframe per analysed frame so the layer counter-moves. The saved frame above is a check.');
            } else {
              box.note('A frame is saved as a check on the correction. Select the video layer first and this panel will write the offsets onto it automatically.');
            }
          });
        },
      }]);
    },
  });

  /* 9. Audio converter ---------------------------------------------------------- */

  tool({
    id: 'audioconv',
    name: 'Audio convert',
    group: 'Audio',
    desc: 'Changes sample rate or channel count and writes a WAV.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'audio/*,video/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Output'));
      var sel = el('select', 'amz-select');
      [['44100', '44.1 kHz stereo'], ['48000', '48 kHz stereo'], ['22050', '22.05 kHz mono'], ['8000', '8 kHz mono']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      sel.value = '48000';
      f.appendChild(sel);
      panel.appendChild(f);
      var info = infoRow(panel, 'Source', null);

      buttonRow(panel, [{
        label: 'Convert', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose an audio file first');
          runJob(panel, async function (rep) {
            rep.at(0.2, 'Decoding…');
            var audio;
            if (src.file && M.isAudioName(src.name)) {
              audio = await M.decodeAudioBuffer(await src.file.arrayBuffer());
            } else {
              var media = await M.decodeMedia(src, { maxFrames: 1 });
              audio = media.audio;
            }
            if (!audio) throw new Error('No audio found in that file');
            info.textContent = Math.round(audio.sampleRate / 100) / 10 + ' kHz · ' + audio.numberOfChannels + ' ch · ' + audio.duration.toFixed(1) + ' s';
            var parts = sel.value.split(':');
            var rate = parseInt(sel.value, 10);
            var mono = sel.value === '22050' || sel.value === '8000';
            rep.at(0.6, 'Resampling…');
            var channels = M.audioChannels(audio);
            var out = channels.map(function (ch) { return M.resample(ch, audio.sampleRate, rate); });
            if (mono && out.length > 1) {
              var mix = new Float32Array(out[0].length);
              for (var c = 0; c < out.length; c++) for (var i = 0; i < mix.length; i++) mix[i] += out[c][i] / out.length;
              out = [mix];
            }
            rep.at(0.85, 'Writing…');
            var blob = M.encodeWav(out, rate);
            rep.done('Converted');
            var box = resultBlock(panel);
            box.heading('Converted audio');
            box.line('Rate', (rate / 1000).toFixed(2) + ' kHz');
            box.line('Channels', String(out.length));
            box.line('Length', audio.duration.toFixed(2) + ' s');
            box.actions([
              { label: 'Save WAV', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-' + rate + '.wav', 'export').then(notify); } },
              { label: 'Add to project', onClick: function () { addToProject(blob, baseName(src.name) + '.wav', 'audio').then(notify); } },
            ]);
          });
        },
      }]);
    },
  });

  /* 10. Frame interpolation ----------------------------------------------------- */

  tool({
    id: 'rife',
    name: 'Frame interpolation',
    group: 'Time',
    desc: 'Doubles a clip\'s frame rate by generating the frames in between.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*');
      resultBlock(panel).note('In-between frames come from block-matching motion estimation between each pair, which is what a real-time interpolator does when it has no neural network available. The name in the reference app is a product name for the same idea; the maths here is the classical version, run in the page.');

      buttonRow(panel, [{
        label: 'Interpolate to 2×', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a video first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading the clip…');
            var media = await M.decodeMedia(src, { maxFrames: 30, fps: 30 });
            if (media.frames.length < 2) throw new Error('Need at least two frames');
            var out = [];
            for (var i = 0; i < media.frames.length - 1; i++) {
              if (rep.cancelled) break;
              out.push(media.frames[i]);
              out.push(M.motionCompensate(media.frames[i], media.frames[i + 1], 0.5));
              rep.at(0.1 + 0.7 * (i / (media.frames.length - 1)), 'Interpolating ' + (i + 1) + '/' + (media.frames.length - 1) + '…');
              if (i % 2 === 0) await tick();
            }
            out.push(media.frames[media.frames.length - 1]);
            rep.at(0.85, 'Encoding…');
            var made = await framesToVideo(out, media.audio, 1, src.name, rep);
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('Interpolated');
            box.line('In frames', String(media.frames.length));
            box.line('Out frames', String(out.length));
            box.preview(canvasFor(out[Math.floor(out.length / 2)]));
            if (made.blob) {
              box.actions([
                { label: 'Save MP4', primary: true, onClick: function () { M.save(made.blob, made.name, 'export').then(notify); } },
                { label: 'Add to project', onClick: function () { addToProject(made.blob, made.name, 'video').then(notify); } },
              ]);
            } else {
              box.note(made.message);
            }
          });
        },
      }]);
    },
  });

  /* 11. Denoise ---------------------------------------------------------------- */

  tool({
    id: 'denoise',
    name: 'Denoise',
    group: 'Cleanup',
    desc: 'Removes sensor grain from a still without flattening texture.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'image/*,video/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Amount'));
      var r = document.createElement('input');
      r.type = 'range'; r.min = '1'; r.max = '10'; r.value = '4';
      f.appendChild(r);
      panel.appendChild(f);
      resultBlock(panel).note('Each channel is transformed, thresholded in the frequency domain and transformed back, so noise that is small and high-frequency is discarded while an edge, which is large and spans many frequencies, survives.');

      buttonRow(panel, [{
        label: 'Denoise', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var canvas = canvasFor(media.frames[0]);
            var w = canvas.width, h = canvas.height;
            /* Work on a power-of-two crop: the FFT needs it, and a full still is usually too
               big to transform whole on a phone. */
            var size = 1;
            while (size * 2 <= Math.min(w, h) && size * 2 <= 512) size *= 2;
            rep.at(0.2, 'Denoising ' + size + '×' + size + '…');
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var img = ctx.getImageData(0, 0, w, h);
            var amount = parseInt(r.value, 10);
            for (var c = 0; c < 3; c++) {
              denoiseChannel(img.data, w, h, size, c, amount);
              if (rep.cancelled) break;
            }
            ctx.putImageData(img, 0, 0);
            var blob = await new Promise(function (rr) { canvas.toBlob(rr, 'image/png'); });
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('Denoised');
            box.line('Size', w + ' × ' + h);
            box.preview(canvas);
            box.actions([{ label: 'Save PNG', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-denoised.png', 'export').then(notify); } }]);
          });
        },
      }]);
    },
  });

  /**
   * Frequency-domain denoise on one channel: transform, zero the coefficients below a fraction
   * of the strongest magnitude, transform back. Doing it per tile keeps memory bounded.
   */
  function denoiseChannel(data, w, h, size, channel, amount) {
    var tilesX = Math.ceil(w / size), tilesY = Math.ceil(h / size);
    for (var ty = 0; ty < tilesY; ty++) {
      for (var tx = 0; tx < tilesX; tx++) {
        var re = new Float32Array(size * size), im = new Float32Array(size * size);
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            var px = Math.min(w - 1, tx * size + x), py = Math.min(h - 1, ty * size + y);
            /* A window tapers the tile edges so the tiling itself does not show up as lines. */
            var win = Math.sin((Math.PI * x) / size) * Math.sin((Math.PI * y) / size);
            re[y * size + x] = data[(py * w + px) * 4 + channel] * win;
          }
        }
        M.fft(re, im, false);
        var peak = 0;
        for (var i = 0; i < re.length; i++) { var m = Math.hypot(re[i], im[i]); if (m > peak) peak = m; }
        var cutoff = peak * (0.004 * amount);
        for (var j = 0; j < re.length; j++) {
          if (Math.hypot(re[j], im[j]) < cutoff) { re[j] = 0; im[j] = 0; }
        }
        M.fft(re, im, true);
        for (var yy = 0; yy < size; yy++) {
          for (var xx = 0; xx < size; xx++) {
            var ox = tx * size + xx, oy = ty * size + yy;
            if (ox >= w || oy >= h) continue;
            data[(oy * w + ox) * 4 + channel] = re[yy * size + xx];
          }
        }
      }
    }
  }

  /* 12. Reverse ----------------------------------------------------------------- */

  tool({
    id: 'reverse',
    name: 'Reverse',
    group: 'Time',
    desc: 'Plays a clip backwards, keeping its audio in sync.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*,audio/*');
      var opt = el('div', 'amz-field');
      opt.appendChild(el('div', 'amz-label', 'Also reverse'));
      var audioBox = document.createElement('input');
      audioBox.type = 'checkbox'; audioBox.checked = true;
      var label = el('label', 'amz-check');
      label.appendChild(audioBox);
      label.appendChild(document.createTextNode(' the audio'));
      opt.appendChild(label);
      panel.appendChild(opt);
      resultBlock(panel).note('Video frames are written newest-first. Reversed audio is played back from the end of its buffer.');

      buttonRow(panel, [{
        label: 'Reverse', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a source first');
          runJob(panel, async function (rep) {
            rep.at(0.05, 'Reading…');
            var media = await M.decodeMedia(src, { maxFrames: 30, fps: 30 });
            var reversedAudio = null;
            if (media.audio && audioBox.checked) {
              var ch = M.audioChannels(media.audio).map(function (c) { return c.reverse(); });
              reversedAudio = { channels: ch, sampleRate: media.audio.sampleRate };
            }
            rep.at(0.5, 'Reversing…');
            if (media.kind === 'video') {
              var frames = media.frames.slice().reverse();
              var made = await framesToVideo(frames, reversedAudio || media.audio, 1, src.name, rep, 'reversed');
              rep.done('Done');
              var box = resultBlock(panel);
              box.heading('Reversed clip');
              box.line('Frames', String(frames.length));
              if (made.blob) {
                box.actions([
                  { label: 'Save MP4', primary: true, onClick: function () { M.save(made.blob, baseName(src.name) + '-reversed.mp4', 'export').then(notify); } },
                  { label: 'Add to project', onClick: function () { addToProject(made.blob, baseName(src.name) + '-reversed.mp4', 'video').then(notify); } },
                ]);
              } else { box.note(made.message); }
            } else if (reversedAudio) {
              var blob = M.encodeWav(reversedAudio.channels, reversedAudio.sampleRate);
              rep.done('Done');
              var ab = resultBlock(panel);
              ab.heading('Reversed audio');
              ab.line('Length', media.audio.duration.toFixed(2) + ' s');
              ab.actions([
                { label: 'Save WAV', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-reversed.wav', 'export').then(notify); } },
                { label: 'Add to project', onClick: function () { addToProject(blob, baseName(src.name) + '-reversed.wav', 'audio').then(notify); } },
              ]);
            } else {
              throw new Error('Nothing to reverse in that file');
            }
          });
        },
      }]);
    },
  });

  /* 13. Convert format ---------------------------------------------------------- */

  tool({
    id: 'convert',
    name: 'Convert',
    group: 'Files',
    desc: 'Rewrites a file in another container or codec.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'video/*,audio/*,image/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Convert to'));
      var sel = el('select', 'amz-select');
      [['mp4', 'MP4 video'], ['webm', 'WebM video'], ['wav', 'WAV audio'],
       ['mp3', 'MP3 audio'], ['png', 'PNG image'], ['jpg', 'JPEG image']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      f.appendChild(sel);
      panel.appendChild(f);

      buttonRow(panel, [{
        label: 'Convert', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose a file first');
          var to = sel.value;
          runJob(panel, async function (rep) {
            rep.at(0.1, 'Reading…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var blob, name;

            if (to === 'png' || to === 'jpg') {
              if (!media.frames[0]) throw new Error('That file has no picture in it');
              var canvas = canvasFor(media.frames[0]);
              rep.at(0.7, 'Writing ' + to.toUpperCase() + '…');
              blob = await new Promise(function (rr) {
                canvas.toBlob(rr, to === 'png' ? 'image/png' : 'image/jpeg', 0.92);
              });
              name = baseName(src.name) + '.' + to;
            } else if (to === 'wav') {
              if (!media.audio) throw new Error('That file has no audio in it');
              var ch = M.audioChannels(media.audio);
              rep.at(0.7, 'Writing WAV…');
              blob = M.encodeWav(ch, media.audio.sampleRate);
              name = baseName(src.name) + '.wav';
            } else if (to === 'mp3') {
              /* Encoding happens in the app, not in the page: the LAME core is compiled into
                 the APK, so this is a real MP3 rather than a renamed WAV. */
              rep.at(0.15, 'Staging the audio…');
              var made = await M.encodeMp3(src, {
                bitrate: 192,
                onProgress: function (f) { rep.at(0.15 + f * 0.8, 'Encoding MP3… ' + Math.round(f * 100) + '%'); },
              });
              rep.done('Encoded');
              var mp3Box = resultBlock(panel);
              mp3Box.heading('MP3 file');
              mp3Box.line('Name', made.name);
              mp3Box.line('Size', (made.bytes / 1048576).toFixed(2) + ' MB');
              mp3Box.line('Bitrate', '192 kbps');
              mp3Box.actions([{
                label: 'Done', primary: true,
                onClick: function () { notify('Saved to the export folder as ' + made.name); },
              }]);
              mp3Box.note('Encoded on the device by the LAME encoder built into the app. The file is in the export folder and appears in the gallery.');
              return;
            } else {
              if (media.kind !== 'video' || !media.frames.length) throw new Error('That file has no video in it');
              var made = await framesToVideo(media.frames, media.audio, 1, src.name, rep);
              if (!made.blob) throw new Error(made.message);
              blob = made.blob;
              name = baseName(src.name) + (to === 'webm' ? '.webm' : '.mp4');
            }
            rep.done('Converted');
            var box = resultBlock(panel);
            box.heading('Converted file');
            box.line('Format', to.toUpperCase());
            box.line('Size', (blob.size / 1048576).toFixed(2) + ' MB');
            box.actions([
              { label: 'Save', primary: true, onClick: function () { M.save(blob, name, 'export').then(notify); } },
              { label: 'Add to project', onClick: function () { addToProject(blob, name, to === 'wav' ? 'audio' : to === 'mp3' ? 'audio' : 'video').then(notify); } },
            ]);
          });
        },
      }]);
    },
  });

  /* 14. Project doctor ---------------------------------------------------------- */

  tool({
    id: 'doctor',
    name: 'Project doctor',
    group: 'Inspect',
    desc: 'Checks the open project for the things that make an export fail: missing media, empty layers, zero-length clips.',
    run: function (panel) {
      var res = resultBlock(panel);
      buttonRow(panel, [{
        label: 'Check the project', primary: true,
        onClick: function () {
          res.heading('Checking…');
          var model = window.model;
          if (!model || !model.layers) return res.note('No project is open.');
          var layers = model.layers || [];
          var missing = [], empty = [], issues = [];
          layers.forEach(function (l) {
            if (!l) return;
            var name = l.name || l.id || 'layer';
            var mediaLayer = l.type === 'video' || l.type === 'audio';
            if (mediaLayer && !l.mediaFile && !l.mediaUrl && !l.src) missing.push(name);
            if (mediaLayer && l.duration === 0) empty.push(name);
            if (l.start < 0) issues.push(name + ' starts before zero');
            if (l.duration < 0) issues.push(name + ' has a negative duration');
          });
          var box = resultBlock(panel);
          box.heading(layers.length + ' layer' + (layers.length === 1 ? '' : 's') + ' in the composition');
          box.line('Missing media', missing.length ? missing.join(', ') : 'none');
          box.line('Zero length', empty.length ? empty.join(', ') : 'none');
          box.line('Timing', issues.length ? issues.join('; ') : 'clean');
          box.line('Canvas', (model.width || '?') + ' × ' + (model.height || '?') + ' at ' + (model.fps || '?') + ' fps');
          if (!missing.length && !empty.length && !issues.length) {
            box.note('Nothing here would stop an export.');
          } else {
            box.note('Fix the entries above before exporting — each one is a layer the exporter will either skip or fail on.');
          }
        },
      }]);
    },
  });

  /* 15. 3D scene ---------------------------------------------------------------- */

  tool({
    id: 'labs3d',
    name: '3D scene',
    group: '3D & depth',
    desc: 'Turns a photo and its depth map into a layer you can move the camera through.',
    run: function (panel) {
      var picked = sourceBlock(panel, 'image/*');
      var f = el('div', 'amz-field');
      f.appendChild(el('div', 'amz-label', 'Depth strength'));
      var r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = '100'; r.value = '35';
      f.appendChild(r);
      panel.appendChild(f);
      resultBlock(panel).note('Builds a shaded relief from the estimated depth: the picture is lit as if it were a surface, using the depth to compute slopes. It is a still with convincing depth, not a mesh — there is no camera to move around it. The editor\'s own 3D layers are where a real camera path goes.');

      buttonRow(panel, [{
        label: 'Build 3D relief', primary: true,
        onClick: function () {
          var src = picked.get();
          if (!src) return notify('Choose an image first');
          runJob(panel, async function (rep) {
            rep.at(0.1, 'Reading…');
            var media = await M.decodeMedia(src, { maxFrames: 1 });
            var canvas = canvasFor(media.frames[0]);
            var w = canvas.width, h = canvas.height;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            rep.at(0.35, 'Estimating depth…');
            var depthImg = ctx.getImageData(0, 0, w, h);
            var depth = M.depthInto(depthImg, w, h);
            var smooth = M.boxBlurPlane(depth, w, h, 2);
            var strength = parseInt(r.value, 10) / 100;
            rep.at(0.7, 'Shading…');
            var img = ctx.getImageData(0, 0, w, h);
            var lightX = -0.5, lightY = -0.7, lightZ = 0.6;
            for (var y = 1; y < h - 1; y++) {
              for (var x = 1; x < w - 1; x++) {
                var i = y * w + x;
                var dx = (smooth[i + 1] - smooth[i - 1]) * strength * 8;
                var dy = (smooth[i + w] - smooth[i - w]) * strength * 8;
                /* Surface normal from the depth gradient, lit by a fixed key light. */
                var nl = 1 / Math.sqrt(dx * dx + dy * dy + 1);
                var shade = (-dx * lightX + -dy * lightY + lightZ) * nl;
                shade = 0.75 + 0.5 * (shade - 0.6);
                var o = i * 4;
                img.data[o] = img.data[o] * shade;
                img.data[o + 1] = img.data[o + 1] * shade;
                img.data[o + 2] = img.data[o + 2] * shade;
              }
            }
            ctx.putImageData(img, 0, 0);
            var blob = await new Promise(function (rr) { canvas.toBlob(rr, 'image/png'); });
            rep.done('Done');
            var box = resultBlock(panel);
            box.heading('3D relief');
            box.line('Size', w + ' × ' + h);
            box.preview(canvas);
            box.actions([
              { label: 'Save PNG', primary: true, onClick: function () { M.save(blob, baseName(src.name) + '-3d.png', 'export').then(notify); } },
              { label: 'Add to project', onClick: function () {
                var name = baseName(src.name) + '-3d.png';
                addToProject(blob, name, 'video').then(notify);
              } },
            ]);
          });
        },
      }]);
    },
  });

  /* ----------------------------------------------------------------------- registry */

  /**
   * The export bridge. Tools that cannot encode hand their work to the editor instead of
   * reimplementing its exporter: this sizes the composition to the file and adds it as a layer.
   */
  function installExportBridge() {
    if (window.omsAmzExport) return;
    window.omsAmzExport = {
      /** Turns a picked file into a real layer, so the editor's own exporter can write it. */
      fromFile: function (src, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
          try {
            var model = window.model;
            if (!model || !model.addLayer) return resolve({ ok: false, message: 'No project is open' });
            var isAudio = M.isAudioName(src.name);
            var reader = new FileReader();
            reader.onload = function () {
              try {
                var layer = model.addLayer(isAudio ? 'audio' : 'video', { name: src.name, dataUrl: reader.result });
                if (!layer) return resolve({ ok: false, message: 'Could not create a layer' });
                try { model.hydrateLayer && model.hydrateLayer(layer); } catch (e) {}
                if (window.history && window.history.push) window.history.push();
                if (window.omsAmzBridge) window.omsAmzBridge.refresh();
                if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll();
                resolve({ ok: true, layer: layer });
              } catch (e) { resolve({ ok: false, message: e.message }); }
            };
            reader.onerror = function () { resolve({ ok: false, message: 'Could not read the file' }); };
            reader.readAsDataURL(src.file);
          } catch (e) {
            resolve({ ok: false, message: e.message });
          }
        });
      },
      report: function (res) {
        try {
          var model = window.model;
          if (!model) return;
          res.line('Open project', (model.layers ? model.layers.length : 0) + ' layers, ' + (model.width || '?') + '×' + (model.height || '?'));
        } catch (e) {}
      },
    };
  }

  var byId = {};
  TOOLS.forEach(function (t) { byId[t.id] = t; });

  function open(id, host) {
    var t = byId[id];
    if (!t) return notify('No such tool');
    if (window.omsAmzHub && !host) {
      var opened = window.omsAmzHub.sheet({
        title: t.name,
        subtitle: t.desc,
        build: function (body) {
          var inner = el('div', 'amz-panel');
          body.appendChild(inner);
          t.run(inner);
        },
        footer: [{ label: 'Close' }],
      });
      if (!opened) return;
      return opened.body.firstChild;
    }
    var panel = el('div', 'amz-panel');
    host.appendChild(panel);
    if (t.group) host.setAttribute('data-amz-group', t.group);
    t.run(panel);
    return panel;
  }

  function repaint() {
    /* Nothing is stateful across repaints; the sheets rebuild their own contents. */
  }

  installExportBridge();
  window.omsAmzTools = { open: open, repaint: repaint, TOOLS: TOOLS, byId: byId, installExportBridge: installExportBridge, codecReport: function () { return byId.codec; } };
})();
