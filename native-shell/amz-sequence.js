/*
 * Image sequence layers.
 *
 * The editor draws an image layer with ctx.drawImage(l.img, ...). So a sequence does not need
 * new drawing code: it is an image layer whose `img` is swapped for the right frame before each
 * draw. That is the whole trick, and it means sequences inherit masking, effects, blend modes,
 * track mattes, 3D placement and export for free rather than reimplementing them.
 *
 * Frames are loaded lazily and kept in a small ring cache. A 300-frame sequence at 4K is not
 * something a phone keeps in memory, so this holds a window around the playhead and drops the
 * rest.
 */
(function () {
  'use strict';
  if (window.omsAmzSequence) return;

  var CACHE_SIZE = 12;

  function hub() { return window.omsAmzHub; }
  function bridge() { return window.omsAmzBridge; }
  function notify(m) {
    try { if (hub() && hub().notify) return hub().notify(m); } catch (e) {}
    try { if (window.toast) window.toast(m); } catch (e) {}
  }
  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-sequence: ' + m);
    } catch (e) {}
  }

  /* ------------------------------------------------------------ frame list from a picker */

  /** Natural sort, so frame2.png comes before frame10.png. */
  function naturalCompare(a, b) {
    var re = /(\d+)|(\D+)/g;
    var ax = String(a).match(re) || [];
    var bx = String(b).match(re) || [];
    for (var i = 0; i < Math.min(ax.length, bx.length); i++) {
      var an = parseInt(ax[i], 10), bn = parseInt(bx[i], 10);
      if (!isNaN(an) && !isNaN(bn)) {
        if (an !== bn) return an - bn;
      } else if (ax[i] !== bx[i]) {
        return ax[i] < bx[i] ? -1 : 1;
      }
    }
    return ax.length - bx.length;
  }

  function sortFrames(files) {
    return Array.prototype.slice.call(files).sort(function (a, b) {
      return naturalCompare(a.name, b.name);
    });
  }

  /**
   * Detect the numbering in a set of filenames.
   *
   * Reports the gap pattern, because a sequence with missing frames plays as a visible stutter
   * and the user should be told before they render rather than after. Also reports whether the
   * numbering is zero-padded, which is the usual reason a folder sorts wrong.
   */
  function analyseNames(names) {
    var numbers = [];
    var pattern = null;
    for (var i = 0; i < names.length; i++) {
      var m = String(names[i]).match(/(\d+)(?=\D*$)/);
      if (!m) continue;
      numbers.push(parseInt(m[1], 10));
      if (pattern === null) pattern = m[1];
    }
    if (numbers.length < 2) return { count: names.length, numbered: numbers.length, gaps: [], step: 0 };
    var steps = {};
    var gaps = [];
    for (var j = 1; j < numbers.length; j++) {
      var d = numbers[j] - numbers[j - 1];
      steps[d] = (steps[d] || 0) + 1;
      if (d !== 1) gaps.push({ after: names[j - 1], missing: d - 1 });
    }
    var step = Number(Object.keys(steps).sort(function (a, b) { return steps[b] - steps[a]; })[0]) || 0;
    return {
      count: names.length,
      numbered: numbers.length,
      step: step,
      gaps: gaps,
      padded: !!(pattern && /^0\d/.test(pattern)),
      first: numbers[0],
      last: numbers[numbers.length - 1],
    };
  }

  /* ------------------------------------------------------------------- the layer itself */

  /**
   * Turn a loaded image layer into a sequence layer.
   *
   * `frames` is an array of { name, url }. The layer keeps its geometry; only the pixels change
   * with time, which is what makes this work with everything the editor already does to a layer.
   */
  function buildSequence(layer, frames, fps, options) {
    var opts = options || {};
    if (!layer || !frames || !frames.length) return null;
    var ordered = sortFrames(frames);
    layer.type = 'image';
    layer.sequence = {
      frames: ordered.map(function (f) { return { name: f.name, url: f.url }; }),
      fps: fps > 0 ? fps : 24,
      loop: !!opts.loop,
      cache: {},
      cacheOrder: [],
      current: -1,
      loaded: 0,
    };
    layer.name = opts.name || (ordered[0].name.replace(/[._-]?\d+(?=\D*$)/, '') || 'Sequence') + ' (' + ordered.length + ')';
    /* A sequence is a clip, so it has a duration derived from its own frame count. */
    layer.sourceDuration = ordered.length / layer.sequence.fps;
    if (opts.fitDuration !== false) {
      layer.duration = layer.sourceDuration;
    }
    install();
    loadFrame(layer, 0, true);
    return layer.sequence;
  }

  function frameIndexAt(layer, time) {
    var seq = layer && layer.sequence;
    if (!seq) return -1;
    var local = Math.max(0, time - (Number(layer.start) || 0));
    /* sourceIn lets a sequence be trimmed without rebuilding it. */
    local += Number(layer.sourceIn) || 0;
    var idx = Math.floor(local * seq.fps + 1e-6);
    if (seq.loop) idx = ((idx % seq.frames.length) + seq.frames.length) % seq.frames.length;
    return Math.max(0, Math.min(seq.frames.length - 1, idx));
  }

  /** Load one frame, evicting the least recently used once the cache is full. */
  function loadFrame(layer, index, immediate) {
    var seq = layer.sequence;
    if (!seq || index < 0 || index >= seq.frames.length) return null;
    if (seq.cache[index]) {
      /* Refresh recency. */
      var at = seq.cacheOrder.indexOf(index);
      if (at >= 0) seq.cacheOrder.splice(at, 1);
      seq.cacheOrder.push(index);
      return seq.cache[index];
    }
    var entry = { img: new Image(), ready: false };
    seq.cache[index] = entry;
    seq.cacheOrder.push(index);
    entry.img.onload = function () {
      entry.ready = true;
      seq.loaded++;
      /* Only swap the visible frame if this is still the right one for the playhead. */
      if (layer.__seqIndex === index) {
        layer.img = entry.img;
        requestRedraw();
      }
    };
    entry.img.onerror = function () {
      log('frame ' + index + ' (' + seq.frames[index].name + ') failed to load');
    };
    entry.img.src = seq.frames[index].url;

    while (seq.cacheOrder.length > CACHE_SIZE) {
      var old = seq.cacheOrder.shift();
      if (old === index || old === layer.__seqIndex) { seq.cacheOrder.push(old); break; }
      delete seq.cache[old];
    }
    return entry;
  }

  function requestRedraw() {
    try { if (bridge()) bridge().refresh(); } catch (e) {}
  }

  /**
   * Point the layer at the frame for this time. Called from the draw hook.
   *
   * This must be synchronous and cheap: it runs once per layer per frame. If the frame is not
   * loaded yet the previous one stays on screen rather than flashing empty.
   */
  function syncLayer(layer, time) {
    var seq = layer && layer.sequence;
    if (!seq) return false;
    var idx = frameIndexAt(layer, time);
    if (idx === layer.__seqIndex) return true;
    layer.__seqIndex = idx;
    var entry = seq.cache[idx];
    if (entry && entry.ready) {
      layer.img = entry.img;
    } else {
      loadFrame(layer, idx);
      /* Prefetch the next couple so playback does not stall at every cut. */
      loadFrame(layer, idx + 1);
      loadFrame(layer, idx + 2);
    }
    return true;
  }

  /* ------------------------------------------------------------------- renderer hook */

  var installed = false;
  function install() {
    if (installed) return;
    /* The renderer is a module local, so its prototype may not be reachable. Both paths below
       are honest about which one is in use: the prototype wrap is exact, the interval is a
       fallback that still shows the right frame but reacts up to 120 ms late. */
    var proto = null;
    try { if (typeof WebGLRenderer !== 'undefined') proto = WebGLRenderer.prototype; } catch (e) {}
    if (!proto) { try { proto = window.WebGLRenderer && window.WebGLRenderer.prototype; } catch (e) {} }
    if (proto && typeof proto.drawLayer === 'function' && !proto.__amzSeqWrapped) {
      var original = proto.drawLayer;
      proto.drawLayer = function (layer) {
        try {
          if (layer && layer.sequence) {
            syncLayer(layer, Number(window.model && window.model.time) || 0);
          }
        } catch (e) {}
        return original.apply(this, arguments);
      };
      proto.__amzSeqWrapped = true;
      installed = true;
    }
    /* Fallback for the case above not holding: keep only the *active* sequence in sync on a
       timer. Slower to react but never wrong, and never blocks the draw. */
    if (!installed && !window.__amzSeqTimer) {
      window.__amzSeqTimer = setInterval(function () {
        var m = window.model;
        if (!m || !Array.isArray(m.layers)) return;
        var t = Number(m.time) || 0;
        for (var i = 0; i < m.layers.length; i++) {
          if (m.layers[i].sequence) syncLayer(m.layers[i], t);
        }
      }, 120);
    }
  }

  /* ------------------------------------------------------------------------ the picker */

  function openImport() {
    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    var chosen = [];
    sheet({
      title: 'Image Sequence',
      subtitle: 'A folder of frames, played back as one layer',
      build: function (body) {
        var note = document.createElement('p');
        note.className = 'amzNote';
        note.textContent = 'Pick the frames in any order — they are sorted by the number in the filename, so frame2 comes before frame10. The sequence becomes a normal image layer, which means masks, effects, blend modes and export all keep working.';
        body.appendChild(note);

        var summary = document.createElement('p');
        summary.className = 'amzNote';
        summary.textContent = 'No frames chosen yet.';

        var pick = document.createElement('button');
        pick.className = 'amzBtn';
        pick.textContent = 'Choose frames';
        pick.onclick = function () {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = true;
          input.onchange = function () {
            chosen = Array.prototype.slice.call(input.files || []);
            if (!chosen.length) return;
            var info = analyseNames(chosen.map(function (f) { return f.name; }));
            var text = info.count + ' frames';
            if (info.step > 1) text += ' · numbering steps by ' + info.step;
            if (info.gaps.length) text += ' · ' + info.gaps.length + ' gap(s) in the numbering';
            if (!info.padded && info.count > 9) text += ' · not zero-padded, so ordering may surprise';
            summary.textContent = text;
            pick.textContent = chosen.length + ' frames';
            if (info.gaps.length) {
              notify(info.gaps.length + ' missing frame(s) — the clip will stutter');
            }
          };
          input.click();
        };
        body.appendChild(pick);

        var fpsField = document.createElement('div');
        fpsField.className = 'amz-field';
        fpsField.appendChild(document.createElement('div')).className = 'amz-label';
        fpsField.firstChild.textContent = 'Frames per second';
        var fps = document.createElement('input');
        fps.type = 'number'; fps.value = '24'; fps.min = '1'; fps.max = '120';
        fpsField.appendChild(fps);
        body.appendChild(fpsField);

        var loopField = document.createElement('div');
        loopField.className = 'amz-field';
        var loop = document.createElement('input');
        loop.type = 'checkbox';
        var loopLabel = document.createElement('span');
        loopLabel.textContent = ' Loop back to the first frame at the end';
        loopField.appendChild(loop);
        loopField.appendChild(loopLabel);
        body.appendChild(loopField);

        body.appendChild(summary);

        var out = document.createElement('p');
        out.className = 'amzNote';

        var go = document.createElement('button');
        go.className = 'amzBtn primary';
        go.textContent = 'Create layer';
        go.onclick = function () {
          if (!chosen.length) return notify('Choose some frames first');
          var m = window.model;
          if (!m || typeof m.addLayer !== 'function') return notify('No project open');

          out.textContent = 'Reading frames…';
          var frames = [];
          var done = 0;
          chosen.forEach(function (file) {
            var reader = new FileReader();
            reader.onload = function () {
              frames.push({ name: file.name, url: reader.result });
              if (++done === chosen.length) finish(frames);
            };
            reader.onerror = function () {
              if (++done === chosen.length) finish(frames);
            };
            reader.readAsDataURL(file);
          });

          function finish(list) {
            if (!list.length) { out.textContent = 'None of those files could be read.'; return; }
            if (bridge()) bridge().checkpoint();
            var layer = m.addLayer('image', { name: list[0].name });
            if (!layer) { out.textContent = 'Could not create the layer.'; return; }
            var seq = buildSequence(layer, list, parseFloat(fps.value) || 24, {
              loop: !!loop.checked,
              fitDuration: true,
            });
            if (!seq) { out.textContent = 'Could not build the sequence.'; return; }
            if (bridge()) bridge().refresh();
            out.textContent = 'Created a layer with ' + seq.frames.length + ' frames at ' +
              seq.fps + ' fps (' + layer.duration.toFixed(2) + ' s).';
            notify(seq.frames.length + ' frames loaded');
          }
        };
        body.appendChild(go);
        body.appendChild(out);
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  window.omsAmzSequence = {
    naturalCompare: naturalCompare,
    sortFrames: sortFrames,
    analyseNames: analyseNames,
    buildSequence: buildSequence,
    frameIndexAt: frameIndexAt,
    syncLayer: syncLayer,
    install: install,
    openImport: openImport,
  };

  /* Install the draw hook as soon as the renderer class exists. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
