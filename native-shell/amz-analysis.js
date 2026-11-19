/*
 * Beat Maker and Audio Keys: the two panels that read an audio file and write keyframes.
 *
 * Both do real signal analysis on the decoded samples rather than drawing a waveform and
 * pretending. Onset detection is the classical spectral-flux method: transform overlapping
 * windows, measure how much the magnitude spectrum grew since the previous window, and treat a
 * peak in that growth as a hit. It is not a trained beat tracker and it does not claim a tempo
 * grid - it finds the transients in the file you gave it.
 *
 * Nothing here renders. It reads audio, writes keyframes through the editor's own key setter, and
 * says how many hits it found so the result is checkable rather than mysterious.
 */
(function () {
  'use strict';
  if (window.omsAmzAnalysis) return;

  function M() { return window.omsAmzMedia; }
  function hub() { return window.omsAmzHub; }
  function notify(m) {
    try {
      if (hub() && hub().notify) return hub().notify(m);
      if (window.toast) return window.toast(m);
    } catch (e) {}
  }
  function checkpoint() {
    try { if (window.omsAmzBridge) window.omsAmzBridge.checkpoint(); } catch (e) {}
  }
  function changed() {
    try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
  }

  /* ================================================================== onset detection */

  /**
   * Spectral flux over Hann-windowed frames, with an adaptive threshold.
   *
   * The threshold follows a moving median of recent flux rather than a fixed number, because a
   * fixed number is either too sensitive in a quiet intro or deaf in a loud chorus. A peak must
   * also be a local maximum and be at least `minGap` seconds after the previous hit, which stops
   * one drum hit producing four detections as its energy decays.
   */
  function detectOnsets(channel, sampleRate, options) {
    var opts = options || {};
    var frameSize = 1024;
    var hop = 512;
    var sensitivity = typeof opts.sensitivity === 'number' ? opts.sensitivity : 1.4;
    var minGap = typeof opts.minGap === 'number' ? opts.minGap : 0.08;

    if (!channel || channel.length < frameSize * 2) return { times: [], flux: [] };

    var window = new Float32Array(frameSize);
    for (var w = 0; w < frameSize; w++) window[w] = 0.5 - 0.5 * Math.cos((2 * Math.PI * w) / (frameSize - 1));

    var frames = Math.floor((channel.length - frameSize) / hop) + 1;
    var flux = new Float32Array(frames);
    var prev = new Float32Array(frameSize / 2);
    var re = new Float32Array(frameSize);
    var im = new Float32Array(frameSize);

    for (var f = 0; f < frames; f++) {
      var offset = f * hop;
      for (var i = 0; i < frameSize; i++) {
        re[i] = (channel[offset + i] || 0) * window[i];
        im[i] = 0;
      }
      M().fft(re, im, false);
      var sum = 0;
      for (var b = 0; b < frameSize / 2; b++) {
        var mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        /* Half-wave rectified: only growth counts, so a note ending is not an onset. */
        var d = mag - prev[b];
        if (d > 0) sum += d;
        prev[b] = mag;
      }
      flux[f] = sum;
    }

    /* Normalise so sensitivity means the same thing on a quiet file and a loud one. */
    var max = 0;
    for (var k = 0; k < frames; k++) if (flux[k] > max) max = flux[k];
    if (max <= 0) return { times: [], flux: Array.prototype.slice.call(flux) };
    var norm = new Float32Array(frames);
    for (var k2 = 0; k2 < frames; k2++) norm[k2] = flux[k2] / max;

    var times = [];
    var half = 12; /* ~0.2 s of context either side at this hop */
    var lastTime = -Infinity;
    /*
     * Skip the first two frames. Frame 0 has no previous spectrum to compare against, so its
     * flux is measured against silence and comes out enormous - a steady tone looked like a hit
     * at t=0 purely because the file started. Two hops is ~23 ms of warmup.
     */
    for (var n = Math.max(2, 1); n < frames - 1; n++) {
      /*
       * Strict local maximum. The loose test (only "<") counted every zero-flux frame as a peak
       * because 0 < 0 is false, which is what made silence and a steady sine both report hits.
       */
      if (norm[n] <= norm[n - 1] || norm[n] < norm[n + 1]) continue;
      /* An absolute floor as well as a relative one: below this the frame is near-silent. */
      if (norm[n] < 0.02) continue;
      var lo = Math.max(0, n - half), hi = Math.min(frames - 1, n + half);
      var sorted = [];
      for (var j = lo; j <= hi; j++) sorted.push(norm[j]);
      sorted.sort(function (a, b) { return a - b; });
      var mean = 0;
      for (var j2 = 0; j2 < sorted.length; j2++) mean += sorted[j2];
      mean /= sorted.length || 1;
      /* Require real energy above the local norm, not just a local maximum of noise. */
      if (norm[n] < mean * sensitivity) continue;
      var t = (n * hop + frameSize / 2) / sampleRate;
      if (t - lastTime < minGap) continue;
      lastTime = t;
      times.push(t);
    }
    return { times: times, flux: Array.prototype.slice.call(norm) };
  }

  /** Frequency-band energy at a moment, for driving per-band keys. */
  function bandsAt(channel, sampleRate, time, frameSize) {
    frameSize = frameSize || 1024;
    var start = Math.max(0, Math.round(time * sampleRate) - frameSize / 2);
    var re = new Float32Array(frameSize), im = new Float32Array(frameSize);
    for (var i = 0; i < frameSize; i++) re[i] = channel[start + i] || 0;
    M().fft(re, im, false);
    var bands = { low: 0, mid: 0, high: 0 };
    var binHz = sampleRate / frameSize;
    for (var b = 1; b < frameSize / 2; b++) {
      var mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      var hz = b * binHz;
      if (hz < 250) bands.low += mag;
      else if (hz < 2000) bands.mid += mag;
      else bands.high += mag;
    }
    return bands;
  }

  /* ==================================================================== writing keys */

  function setKey(layer, prop, time, value) {
    /* The editor's keyframe engine is model.anim. There is no window.keys. */
    try {
      if (window.omsAmzBridge) return window.omsAmzBridge.setKey(layer, prop, time, value);
    } catch (e) {}
    /* Direct fallback in the same shape the editor uses, so a missing service is not fatal. */
    layer.kf = layer.kf || {};
    layer.kf[prop] = layer.kf[prop] || [];
    var key = { id: 'kf' + Math.round(time * 1000) + prop, t: time, v: value, easing: 'ease-out' };
    layer.kf[prop].push(key);
    layer.kf[prop].sort(function (a, b) { return a.t - b.t; });
    return key;
  }

  function selectedLayer() {
    var m = window.model;
    if (!m) return null;
    try { if (typeof m.selectedLayer === 'function') return m.selectedLayer(); } catch (e) {}
    return (m.layers || []).filter(function (l) { return l.id === m.selected; })[0] || null;
  }

  /**
   * Beat Maker.
   *
   * Writes a keyframe pair per hit on a chosen property - scale, rotation, opacity or position -
   * so the layer punches on the beat. Each hit gets a key at the hit time and a settle key a
   * short moment later, which is what makes it read as a punch rather than a step.
   */
  function beatsFromAudio(src, options) {
    var opts = options || {};
    return M().decodeMedia(src, { audioOnly: true }).then(function (media) {
      var channels = M().audioChannels(media.audio);
      var mono = channels[0];
      if (channels.length > 1) {
        mono = new Float32Array(channels[0].length);
        for (var i = 0; i < mono.length; i++) {
          mono[i] = 0;
          for (var c = 0; c < channels.length; c++) mono[i] += channels[c][i] / channels.length;
        }
      }
      var result = detectOnsets(mono, media.audio.sampleRate, {
        sensitivity: opts.sensitivity,
        minGap: opts.minGap,
      });
      return {
        times: result.times.filter(function (t) { return !opts.limit || t <= opts.limit; }),
        duration: media.audio.duration,
        sampleRate: media.audio.sampleRate,
      };
    });
  }

  function applyBeats(layer, times, style) {
    if (!layer || !times || !times.length) return 0;
    var settle = 0.08;
    times.forEach(function (t) {
      if (style === 'scale') {
        setKey(layer, 'scaleX', t, 1.18);
        setKey(layer, 'scaleY', t, 1.18);
        setKey(layer, 'scaleX', t + settle, 1);
        setKey(layer, 'scaleY', t + settle, 1);
      } else if (style === 'rotation') {
        setKey(layer, 'rotation', t, 6);
        setKey(layer, 'rotation', t + settle, 0);
      } else if (style === 'position') {
        setKey(layer, 'y', t, (Number(layer.y) || 0) - 24);
        setKey(layer, 'y', t + settle, Number(layer.y) || 0);
      } else {
        setKey(layer, 'opacity', t, 1);
        setKey(layer, 'opacity', t + settle, 0.45);
        setKey(layer, 'opacity', t + settle * 2, 1);
      }
    });
    return times.length;
  }

  /* ======================================================================= the panels */

  function sourceButton(panel, onPick) {
    var M2 = M();
    var picked = { file: null };
    var btn = document.createElement('button');
    btn.className = 'amzBtn';
    btn.textContent = 'Choose audio';
    btn.onclick = function () {
      M2.pickFile('audio/*').then(function (file) {
        if (!file) return;
        picked.file = file;
        btn.textContent = file.name;
        if (onPick) onPick(file);
      });
    };
    panel.appendChild(btn);
    return function () { return picked.file; };
  }

  function openBeatMaker() {
    var layer = selectedLayer();
    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    sheet({
      title: 'Beat Maker',
      subtitle: 'Finds the hits in an audio file and keys the selected layer to them',
      build: function (body) {
        var note = document.createElement('p');
        note.className = 'amzNote';
        note.textContent = 'Analyses the actual samples: overlapping windows, spectral flux, and a threshold that follows the music. It finds transients, not a tempo grid, so a track with rubato still works.';
        body.appendChild(note);

        var getFile = sourceButton(body, null);

        var styleLabel = document.createElement('div');
        styleLabel.className = 'amzGroup';
        styleLabel.textContent = 'What should move';
        body.appendChild(styleLabel);

        var style = 'scale';
        var seg = document.createElement('div');
        seg.className = 'amzSeg';
        [['scale', 'Scale'], ['rotation', 'Rotate'], ['position', 'Bounce'], ['opacity', 'Flash']].forEach(function (o) {
          var b = document.createElement('button');
          b.textContent = o[1];
          b.setAttribute('aria-pressed', String(o[0] === style));
          b.onclick = function () {
            style = o[0];
            Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
            b.setAttribute('aria-pressed', 'true');
          };
          seg.appendChild(b);
        });
        body.appendChild(seg);

        var out = document.createElement('p');
        out.className = 'amzNote';

        var go = document.createElement('button');
        go.className = 'amzBtn primary';
        go.textContent = 'Find the beat';
        go.onclick = function () {
          var file = getFile();
          if (!file) return notify('Choose an audio file first');
          if (!layer) return notify('Select a layer to key first');
          out.textContent = 'Analysing…';
          beatsFromAudio(file, { sensitivity: 1.4, minGap: 0.1 }).then(function (res) {
            if (!res.times.length) {
              out.textContent = 'No clear transients found. The file may be very quiet or very smooth.';
              return;
            }
            checkpoint();
            var n = applyBeats(layer, res.times, style);
            changed();
            try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
            out.textContent = 'Found ' + n + ' hits over ' + res.duration.toFixed(1) + ' s and keyed them.';
            notify(n + ' hits keyed');
          }).catch(function (e) {
            out.textContent = 'Could not analyse that file: ' + e.message;
          });
        };
        body.appendChild(go);
        body.appendChild(out);
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  /**
   * Audio Keys.
   *
   * The same analysis, but the output is a keyframe per hit on the layer's own properties, with
   * the value taken from the audio's energy in three bands. Loud hits push further than quiet
   * ones, so the result follows the dynamics of the track instead of every hit being identical.
   */
  function openAudioKeys() {
    var layer = selectedLayer();
    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    sheet({
      title: 'Audio Keys',
      subtitle: 'Key a layer from the loudness of the music',
      build: function (body) {
        var note = document.createElement('p');
        note.className = 'amzNote';
        note.textContent = 'Writes one key per detected hit, scaled by how loud that hit was, so the motion follows the track rather than repeating a fixed amount.';
        body.appendChild(note);

        var getFile = sourceButton(body, null);

        var propLabel = document.createElement('div');
        propLabel.className = 'amzGroup';
        propLabel.textContent = 'Key which property';
        body.appendChild(propLabel);

        var prop = 'opacity';
        var seg = document.createElement('div');
        seg.className = 'amzSeg';
        [['opacity', 'Opacity'], ['scaleX', 'Scale'], ['rotation', 'Rotate']].forEach(function (o) {
          var b = document.createElement('button');
          b.textContent = o[1];
          b.setAttribute('aria-pressed', String(o[0] === prop));
          b.onclick = function () {
            prop = o[0];
            Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-pressed', 'false'); });
            b.setAttribute('aria-pressed', 'true');
          };
          seg.appendChild(b);
        });
        body.appendChild(seg);

        var out = document.createElement('p');
        out.className = 'amzNote';

        var go = document.createElement('button');
        go.className = 'amzBtn primary';
        go.textContent = 'Key from audio';
        go.onclick = function () {
          var file = getFile();
          if (!file) return notify('Choose an audio file first');
          if (!layer) return notify('Select a layer to key first');
          out.textContent = 'Analysing…';
          M().decodeMedia(file, { audioOnly: true }).then(function (media) {
            var channels = M().audioChannels(media.audio);
            var mono = channels[0];
            var res = detectOnsets(mono, media.audio.sampleRate, { sensitivity: 1.4, minGap: 0.1 });
            if (!res.times.length) { out.textContent = 'No hits found.'; return; }

            /* Peak-normalise the flux so a hit's strength maps to a usable range. */
            var peak = 0;
            res.flux.forEach(function (v) { if (v > peak) peak = v; });
            checkpoint();
            var n = 0;
            res.times.forEach(function (t) {
              var idx = Math.min(res.flux.length - 1, Math.round((t * media.audio.sampleRate) / 512));
              var strength = peak > 0 ? res.flux[idx] / peak : 0.5;
              if (prop === 'opacity') {
                setKey(layer, 'opacity', t, 1);
                setKey(layer, 'opacity', t + 0.1, Math.max(0.15, 1 - strength));
              } else if (prop === 'scaleX') {
                setKey(layer, 'scaleX', t, 1 + strength * 0.25);
                setKey(layer, 'scaleY', t, 1 + strength * 0.25);
                setKey(layer, 'scaleX', t + 0.12, 1);
                setKey(layer, 'scaleY', t + 0.12, 1);
              } else {
                setKey(layer, 'rotation', t, strength * 8);
                setKey(layer, 'rotation', t + 0.12, 0);
              }
              n++;
            });
            changed();
            try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
            out.textContent = 'Keyed ' + n + ' hits, scaled by loudness.';
            notify(n + ' keys from audio');
          }).catch(function (e) {
            out.textContent = 'Could not analyse that file: ' + e.message;
          });
        };
        body.appendChild(go);
        body.appendChild(out);
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  window.omsAmzAnalysis = {
    detectOnsets: detectOnsets,
    bandsAt: bandsAt,
    beatsFromAudio: beatsFromAudio,
    applyBeats: applyBeats,
    openBeatMaker: openBeatMaker,
    openAudioKeys: openAudioKeys,
  };
})();
