/*
 * Frame blending for slowed-down video.
 *
 * When a video plays below 1x the decoder delivers the same number of frames it always
 * did, so the picture advances in visible steps. Editors solve this two ways:
 *
 *   frame blending   average the two frames either side of the current time
 *   optical flow     estimate per-pixel motion between them and generate a new in-between
 *
 * This implements frame blending. It does not implement optical flow: that needs a dense
 * motion estimate per frame, which is a GPU feature this engine does not have, and faking
 * it with a cross-fade and calling it "optical flow" would be a lie in the UI. The Node
 * Video importer still records which clips used optical flow, so the setting is visible
 * and its clips fall back to blending.
 *
 * HOW IT ATTACHES
 *
 * The renderer paints a video layer from `layer.frameCanvas`, the decoded-frame cache the
 * model maintains. `paintTexture` is wrapped: while a blended layer is being painted the
 * cache is temporarily swapped for a blended canvas, then put back in the same call. If
 * anything throws, the finally block restores it, so a failure here degrades to normal
 * playback rather than a broken frame or a broken project.
 */
(function () {
  'use strict';

  var installed = false;
  var previous = new WeakMap();   // layer -> { time, canvas, ctx }

  function wants(layer) {
    if (!layer || layer.type !== 'video') return false;
    var mode = layer.omsInterpolation;
    if (!mode || mode === 'off') return false;
    var rate = Math.max(0.05, +layer.playbackRate || 1);
    return rate < 0.999;
  }

  /**
   * Cross-fades from the previous decoded frame into the current one.
   *
   * The weight comes from how long the current frame has been on screen compared with
   * how long a frame lasts at this playback rate. A newly decoded frame starts the cycle
   * again from the previous frame, so the picture advances continuously instead of in
   * steps. Nothing is invented: both images are frames the decoder actually produced.
   */
  function blend(layer, source) {
    var record = previous.get(layer);
    if (!record) {
      record = { time: null, snapshot: null, snapshotCtx: null, lastBlend: null, born: 0 };
      previous.set(layer, record);
    }
    var width = source.width;
    var height = source.height;
    if (!record.out) {
      record.out = document.createElement('canvas');
      record.outCtx = record.out.getContext('2d', { alpha: true });
    }
    if (!record.snapshot) {
      record.snapshot = document.createElement('canvas');
      record.snapshotCtx = record.snapshot.getContext('2d', { alpha: true });
    }
    if (record.out.width !== width || record.out.height !== height) {
      record.out.width = width;
      record.out.height = height;
    }
    if (record.snapshot.width !== width || record.snapshot.height !== height) {
      record.snapshot.width = width;
      record.snapshot.height = height;
      record.snapshotReady = false;
    }

    var decodedAt = +layer.frameCacheTime || 0;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (record.time === null || Math.abs(record.time - decodedAt) > 1e-6) {
      // A new frame arrived: the one that was showing becomes the outgoing frame.
      if (record.snapshotReady) {
        record.snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
        record.snapshotCtx.clearRect(0, 0, record.snapshot.width, record.snapshot.height);
        record.snapshotCtx.drawImage(source, 0, 0);
      }
      record.time = decodedAt;
      record.born = now;
    }

    var rate = Math.min(1, Math.max(0.05, +layer.playbackRate || 1));
    var fps = Math.max(1, +(window.model && window.model.project && window.model.project.fps) || 30);
    var frameMs = 1000 / Math.max(0.5, fps * rate);
    var phase = Math.min(1, Math.max(0, (now - record.born) / frameMs));
    var outgoing = record.snapshotReady ? 1 - phase : 0;

    var ctx = record.outCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    if (outgoing > 0) {
      ctx.globalAlpha = outgoing;
      ctx.drawImage(record.snapshot, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(source, 0, 0);

    // First sight of this layer: there is no outgoing frame yet, so start storing one.
    if (!record.snapshotReady) {
      record.snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
      record.snapshotCtx.clearRect(0, 0, record.snapshot.width, record.snapshot.height);
      record.snapshotCtx.drawImage(source, 0, 0);
      record.snapshotReady = true;
    }
    return record.out;
  }

  function install() {
    if (installed) return;
    var renderer = window.__omsRenderer;
    if (!renderer || typeof renderer.paintTexture !== 'function') return;
    installed = true;

    var original = renderer.paintTexture;
    renderer.paintTexture = function (layer, entry) {
      if (!wants(layer)) return original.call(this, layer, entry);
      var source = layer.frameCacheReady && layer.frameCanvas && layer.frameCanvas.width
        ? layer.frameCanvas
        : null;
      if (!source) return original.call(this, layer, entry);

      var savedCanvas = layer.frameCanvas;
      var savedCtx = layer.frameCtx;
      try {
        var blended = blend(layer, source);
        layer.frameCanvas = blended;
        layer.frameCtx = blended.getContext ? blended.getContext('2d') : savedCtx;
      } catch (error) {
        layer.frameCanvas = savedCanvas;
        layer.frameCtx = savedCtx;
        return original.call(this, layer, entry);
      }
      try {
        return original.call(this, layer, entry);
      } finally {
        layer.frameCanvas = savedCanvas;
        layer.frameCtx = savedCtx;
      }
    };
  }

  // The renderer is created during boot, after every deferred script has parsed. Poll
  // briefly rather than relying on an event that may already have fired.
  var attempts = 0;
  function waitForRenderer() {
    if (installed) return;
    install();
    if (installed || attempts++ > 600) return;      // ~60 s at 100 ms
    setTimeout(waitForRenderer, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForRenderer, { once: true });
  } else {
    waitForRenderer();
  }

  window.omsSmoothMotion = {
    install: install,
    isBlended: function (layer) { return wants(layer); },
    clear: function (layer) { previous.delete(layer); },
  };
})();
