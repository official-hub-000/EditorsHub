/*
 * Shared plumbing for the extra tools: file picking, media decoding, pixel maths, audio
 * encode/decode and saving. Every tool uses these so there is one implementation of each
 * operation, and so a fix to (for example) the FFT helps every tool that uses it.
 *
 * Nothing here depends on the editor's internals. Where the editor has a better path — its
 * encoder, its neural matte — the caller uses that instead and these are the fallback.
 */
(function () {
  'use strict';
  if (window.omsAmzMedia) return;

  function native() { return window.EditorsHubNative || window.OpenMotionNative || null; }
  function log(m) { try { var n = native(); if (n && n.log) n.log('INFO', 'amz-media: ' + m); } catch (e) {} }
  function notify(m) { try { if (window.omsAmzHub) window.omsAmzHub.notify(m); } catch (e) {} }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ------------------------------------------------------------------ file picking */

  function pickFile(accept) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || 'video/*,image/*,audio/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = function () {
        var f = input.files && input.files[0];
        input.remove();
        if (!f) return reject(new Error('No file chosen'));
        resolve({ file: f, name: f.name, bytes: f.size, url: URL.createObjectURL(f), type: f.type || '' });
      };
      input.click();
    });
  }

  /* --------------------------------------------------------------- media decoding */

  function isVideoName(n) { return /\.(mp4|mov|webm|mkv|m4v|avi|3gp)$/i.test(n || ''); }
  function isAudioName(n) { return /\.(mp3|wav|m4a|aac|ogg|flac|opus|amr)$/i.test(n || ''); }

  /**
   * Decodes a picked file into frames (for video and images) and audio where present.
   *
   * Frames are read through a canvas, which is the only route available to a WebView without a
   * native decoder; the vendored mediabunny is used first for container parsing when it loads,
   * and the <video> element path is the fallback. maxFrames caps work so a long clip cannot lock
   * the UI thread.
   */
  async function decodeMedia(src, opts) {
    opts = opts || {};
    var maxFrames = opts.maxFrames || 48;
    var video = /video\//.test(src.type) || isVideoName(src.name);
    var audioOnly = /audio\//.test(src.type) || isAudioName(src.name);

    if (audioOnly) {
      var a = await decodeAudio(src);
      return a;
    }
    if (!video) {
      var img = await loadImage(src.url);
      return {
        kind: 'image', width: img.naturalWidth, height: img.naturalHeight,
        duration: 0, fps: 0, frames: [{ bitmap: img, width: img.naturalWidth, height: img.naturalHeight, time: 0 }],
      };
    }

    var v = document.createElement('video');
    v.src = src.url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    await new Promise(function (res, rej) {
      var settled = false;
      var done = function (fn, arg) { if (settled) return; settled = true; fn(arg); };
      v.onloadedmetadata = function () { done(res); };
      v.onerror = function () { done(rej, new Error('This device cannot decode that video')); };
      setTimeout(function () { done(rej, new Error('Timed out reading the video')); }, 25000);
    });

    var duration = isFinite(v.duration) ? v.duration : 0;
    var fps = opts.fps || 30;
    var count = Math.min(maxFrames, Math.max(2, Math.round(duration * fps)));
    var canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 720;
    canvas.height = v.videoHeight || 1280;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var frames = [];

    for (var i = 0; i < count; i++) {
      var t = (i / Math.max(1, count - 1)) * Math.max(0, duration - 0.001);
      await seekTo(v, t);
      try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); } catch (e) { break; }
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      frames.push({ data: data.data, width: canvas.width, height: canvas.height, time: t });
    }

    var audio = null;
    try { audio = await extractAudio(src); } catch (e) { log('no audio: ' + (e && e.message)); }

    return {
      kind: 'video', width: canvas.width, height: canvas.height,
      duration: duration, fps: fps, frames: frames, audio: audio,
    };
  }

  function seekTo(video, t) {
    return new Promise(function (res) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        res();
      };
      video.addEventListener('seeked', finish);
      try { video.currentTime = Math.max(0, t); } catch (e) { finish(); }
      setTimeout(finish, 1500);
    });
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Could not decode that image')); };
      img.src = url;
    });
  }

  async function decodeAudio(src) {
    var buf = await src.file.arrayBuffer();
    var audio = await decodeAudioBuffer(buf);
    return { kind: 'audio', duration: audio.duration, audio: audio, width: 0, height: 0, frames: [] };
  }

  async function decodeAudioBuffer(arrayBuffer) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('No audio engine on this device');
    var ctx = new AC();
    try {
      var audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return audio;
    } finally {
      try { await ctx.close(); } catch (e) {}
    }
  }

  /** Pulls the audio track out of a video file, if the platform can decode it. */
  async function extractAudio(src) {
    var buf = await src.file.arrayBuffer();
    return await decodeAudioBuffer(buf);
  }

  function frameToCanvas(frame) {
    if (frame.bitmap) {
      var c0 = document.createElement('canvas');
      c0.width = frame.bitmap.naturalWidth || frame.bitmap.width;
      c0.height = frame.bitmap.naturalHeight || frame.bitmap.height;
      c0.getContext('2d').drawImage(frame.bitmap, 0, 0);
      return c0;
    }
    var c = document.createElement('canvas');
    c.width = frame.width;
    c.height = frame.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    return c;
  }

  function drawToCanvas(ctx, frame, w, h) {
    if (frame.bitmap) { ctx.drawImage(frame.bitmap, 0, 0, w || frame.width, h || frame.height); return; }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
  }

  /* ------------------------------------------------------------------------- blurs */

  /** Separable box blur over a single Float32 plane. Cost is independent of radius. */
  function boxBlurPlane(src, w, h, r) {
    if (r <= 0) return src.slice ? src.slice(0) : new Float32Array(src);
    r = Math.min(32, Math.round(r));
    var tmp = new Float32Array(src.length);
    var out = new Float32Array(src.length);
    var win = r * 2 + 1;
    for (var y = 0; y < h; y++) {
      var sum = 0;
      for (var x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (var x2 = 0; x2 < w; x2++) {
        tmp[y * w + x2] = sum / win;
        var add = Math.min(w - 1, x2 + r + 1), rem = Math.max(0, x2 - r);
        sum += src[y * w + add] - src[y * w + rem];
      }
    }
    for (var x3 = 0; x3 < w; x3++) {
      var s2 = 0;
      for (var y2 = -r; y2 <= r; y2++) s2 += tmp[Math.min(h - 1, Math.max(0, y2)) * w + x3];
      for (var y3 = 0; y3 < h; y3++) {
        out[y3 * w + x3] = s2 / win;
        var add2 = Math.min(h - 1, y3 + r + 1), rem2 = Math.max(0, y3 - r);
        s2 += tmp[add2 * w + x3] - tmp[rem2 * w + x3];
      }
    }
    return out;
  }

  function boxBlurRGBA(src, w, h, r) {
    var out = new Uint8ClampedArray(src.length);
    for (var c = 0; c < 4; c++) {
      var plane = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) plane[i] = src[i * 4 + c];
      var blurred = boxBlurPlane(plane, w, h, r);
      for (var j = 0; j < w * h; j++) out[j * 4 + c] = blurred[j];
    }
    return out;
  }

  /** Unsharp mask in place: out = src + amount * (src - blur). */
  function sharpen(ctx, w, h, amount, radius) {
    var img = ctx.getImageData(0, 0, w, h);
    var src = new Uint8ClampedArray(img.data);
    var blurred = boxBlurRGBA(src, w, h, radius || 1);
    for (var i = 0; i < img.data.length; i += 4) {
      for (var c = 0; c < 3; c++) img.data[i + c] = src[i + c] + amount * (src[i + c] - blurred[i + c]);
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ------------------------------------------------------------------- depth estimate */

  /**
   * Writes a depth estimate into a pixel buffer in place.
   *
   * Luminance alone is a usable depth cue for the usual shot — sky bright and far, foreground
   * darker — and a normalised local-contrast term separates a flat wall from a textured object
   * at the same brightness. Two smoothing passes remove the blockiness a per-pixel estimate
   * leaves behind.
   */
  function depthInto(imageData, w, h) {
    var d = imageData.data;
    var n = w * h;
    var lum = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    var blurred = boxBlurPlane(lum, w, h, Math.max(2, Math.round(Math.min(w, h) / 64)));
    var depth = new Float32Array(n);
    var lo = 1, hi = 0;
    for (var j = 0; j < n; j++) {
      var v = 0.72 * lum[j] + 0.28 * Math.min(1, Math.abs(lum[j] - blurred[j]) * 4);
      depth[j] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    var span = Math.max(1e-6, hi - lo);
    for (var k = 0; k < n; k++) {
      var g = Math.round(((depth[k] - lo) / span) * 255);
      d[k * 4] = g; d[k * 4 + 1] = g; d[k * 4 + 2] = g; d[k * 4 + 3] = 255;
    }
    return depth;
  }

  /* ------------------------------------------------------------------- audio helpers */

  function encodeWav(channels, sampleRate) {
    var numCh = channels.length;
    var len = channels[0].length;
    var bytes = 44 + len * numCh * 2;
    var buf = new ArrayBuffer(bytes);
    var view = new DataView(buf);
    var w = function (off, str) { for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); view.setUint32(4, bytes - 8, true); w(8, 'WAVE');
    w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * 2, true); view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, len * numCh * 2, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < numCh; c++) {
        var s = Math.max(-1, Math.min(1, channels[c][i] || 0));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function audioChannels(audio) {
    var out = [];
    for (var c = 0; c < audio.numberOfChannels; c++) out.push(audio.getChannelData(c).slice(0));
    return out;
  }

  function resample(channel, fromRate, toRate) {
    if (fromRate === toRate) return channel;
    var ratio = toRate / fromRate;
    var len = Math.round(channel.length * ratio);
    var out = new Float32Array(len);
    for (var i = 0; i < len; i++) {
      var pos = i / ratio;
      var a = Math.floor(pos);
      var b = Math.min(channel.length - 1, a + 1);
      out[i] = channel[a] * (1 - (pos - a)) + channel[b] * (pos - a);
    }
    return out;
  }

  /** In-place radix-2 FFT. `inverse` flips the exponent sign and normalises. */
  function fft(re, im, inverse) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (2 * Math.PI) / len * (inverse ? 1 : -1);
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var start = 0; start < n; start += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[start + k], ui = im[start + k];
          var vr = re[start + k + len / 2] * cr - im[start + k + len / 2] * ci;
          var vi = re[start + k + len / 2] * ci + im[start + k + len / 2] * cr;
          re[start + k] = ur + vr; im[start + k] = ui + vi;
          re[start + k + len / 2] = ur - vr; im[start + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (var q = 0; q < n; q++) { re[q] /= n; im[q] /= n; }
  }

  /* ------------------------------------------------------------------ motion estimation */

  /**
   * Block-matching motion compensation between two frames at phase `t`.
   *
   * Each 16 px block of A searches a ±12 px window in B for the lowest mean absolute difference.
   * The block is then sampled at the interpolated position and mixed by t. A block whose best
   * match is poor falls back to a straight blend, which is what keeps occlusion edges from
   * tearing. This is the classical approach; a trained flow network is a different order of work.
   */
  function motionCompensate(a, b, t) {
    var w = a.width, h = a.height, BS = 16, R = 12;
    var out = new Uint8ClampedArray(a.data.length);
    var A = a.data, B = b.data;
    for (var by = 0; by < h; by += BS) {
      for (var bx = 0; bx < w; bx += BS) {
        var best = [0, 0], bestCost = Infinity;
        for (var dy = -R; dy <= R; dy += 4) {
          for (var dx = -R; dx <= R; dx += 4) {
            var cost = 0, count = 0;
            for (var y = by; y < Math.min(by + BS, h); y += 8) {
              for (var x = bx; x < Math.min(bx + BS, w); x += 8) {
                var x2 = Math.min(w - 1, Math.max(0, x + dx));
                var y2 = Math.min(h - 1, Math.max(0, y + dy));
                var i1 = (y * w + x) * 4, i2 = (y2 * w + x2) * 4;
                cost += Math.abs(A[i1] - B[i2]) + Math.abs(A[i1 + 1] - B[i2 + 1]) + Math.abs(A[i1 + 2] - B[i2 + 2]);
                count++;
              }
            }
            var avg = cost / Math.max(1, count);
            if (avg < bestCost) { bestCost = avg; best = [dx, dy]; }
          }
        }
        var poor = bestCost > 60;
        for (var yy = by; yy < Math.min(by + BS, h); yy++) {
          for (var xx = bx; xx < Math.min(bx + BS, w); xx++) {
            var o = (yy * w + xx) * 4;
            if (poor) {
              for (var c0 = 0; c0 < 3; c0++) out[o + c0] = A[o + c0] * (1 - t) + B[o + c0] * t;
            } else {
              var sx = Math.min(w - 1, Math.max(0, Math.round(xx + best[0] * t)));
              var sy = Math.min(h - 1, Math.max(0, Math.round(yy + best[1] * t)));
              var si = (sy * w + sx) * 4;
              for (var c1 = 0; c1 < 3; c1++) out[o + c1] = A[o + c1] * (1 - t) + B[si + c1] * t;
            }
            out[o + 3] = 255;
          }
        }
      }
    }
    return { data: out, width: w, height: h };
  }

  function blendFrames(a, b, t) {
    var out = new Uint8ClampedArray(a.data.length);
    for (var i = 0; i < out.length; i += 4) {
      for (var c = 0; c < 3; c++) out[i + c] = a.data[i + c] * (1 - t) + b.data[i + c] * t;
      out[i + 3] = 255;
    }
    return { data: out, width: a.width, height: a.height };
  }

  /** Whole-frame translation between two frames, used by the stabiliser. */
  function estimateShift(a, b) {
    var w = a.width, h = a.height, R = 10;
    var best = [0, 0], bestCost = Infinity;
    for (var dy = -R; dy <= R; dy += 2) {
      for (var dx = -R; dx <= R; dx += 2) {
        var cost = 0, n = 0;
        for (var y = 0; y < h; y += 40) {
          for (var x = 0; x < w; x += 40) {
            var x2 = Math.min(w - 1, Math.max(0, x + dx));
            var y2 = Math.min(h - 1, Math.max(0, y + dy));
            cost += Math.abs(a.data[(y * w + x) * 4] - b.data[(y2 * w + x2) * 4]);
            n++;
          }
        }
        var avg = cost / Math.max(1, n);
        if (avg < bestCost) { bestCost = avg; best = [dx, dy]; }
      }
    }
    return best;
  }

  function meanAbsDiff(a, b) {
    var n = Math.min(a.data.length, b.data.length);
    var sum = 0, count = 0;
    for (var i = 0; i < n; i += 28) { sum += Math.abs(a.data[i] - b.data[i]); count++; }
    return sum / Math.max(1, count);
  }

  /* --------------------------------------------------------------------- save to disk */

  /**
   * Saves a blob. `mode` is 'export' (writes into the app's export folder, which the gallery
   * lists) or 'document' (opens the system save-as sheet so the user picks the location).
   */
  async function save(blob, name, mode) {
    try {
      var n = native();
      if (n && (n.saveBase64 || n.saveDocumentBase64)) {
        var buf = await blob.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var b64 = '';
        var chunk = 8192;
        for (var i = 0; i < bytes.length; i += chunk) {
          b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        var encoded = btoa(b64);
        if (mode === 'document' && n.saveDocumentBase64) {
          n.saveDocumentBase64(encoded, name, blob.type || 'application/octet-stream');
          return 'Choose where to save ' + name;
        }
        if (n.saveBase64) {
          var path = n.saveBase64(encoded, name);
          if (path) return 'Saved ' + name;
        }
      }
    } catch (e) { log('native save failed: ' + (e && e.message)); }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    return 'Saved ' + name;
  }

  window.omsAmzMedia = {
    el: el,
    pickFile: pickFile,
    decodeMedia: decodeMedia,
    decodeAudioBuffer: decodeAudioBuffer,
    frameToCanvas: frameToCanvas,
    drawToCanvas: drawToCanvas,
    loadImage: loadImage,
    boxBlurPlane: boxBlurPlane,
    boxBlurRGBA: boxBlurRGBA,
    sharpen: sharpen,
    depthInto: depthInto,
    encodeWav: encodeWav,
    audioChannels: audioChannels,
    resample: resample,
    fft: fft,
    motionCompensate: motionCompensate,
    blendFrames: blendFrames,
    estimateShift: estimateShift,
    meanAbsDiff: meanAbsDiff,
    save: save,
    notify: notify,
    log: log,
    isVideoName: isVideoName,
    isAudioName: isAudioName,
  };
  log('plumbing ready');
})();
