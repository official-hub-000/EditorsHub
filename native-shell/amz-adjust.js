/*
 * Adjustment layers.
 *
 * An adjustment layer is not content. It is an effect that applies to everything drawn beneath
 * it in the same composition, which is why you can colour-grade a scene by adding one layer
 * instead of pasting the same effect onto every clip.
 *
 * This is implemented as a second pass, not as a new layer type with its own drawing code:
 *
 *   1. Before a frame's layers are drawn, every adjustment layer in it is asked which region it
 *      covers (usually the whole canvas) and what it does.
 *   2. drawLayer() returns immediately for those layers, so they never draw on their own.
 *   3. After the frame is complete the pass composites a buffer through the adjustment's effect
 *      stack and blends the result back over the region.
 *
 * Wrapping drawLayer is what makes it work for the preview and the exporter at the same time:
 * both draw frames through that one method, so neither needs to know adjustment layers exist.
 */
(function () {
  'use strict';
  if (window.omsAmzAdjust) return;

  var TYPE = 'adjustment';
  var installed = false;
  var failures = [];

  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-adjust: ' + m);
    } catch (e) {}
  }
  function changed() {
    try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
  }
  function isAdjustment(l) {
    return !!l && l.type === TYPE;
  }

  /** Adjustment layers in this frame's stack, bottom to top. */
  function activeAdjustments() {
    var m = window.model;
    if (!m || !Array.isArray(m.layers)) return [];
    var t = Number(m.time) || 0;
    return m.layers.filter(function (l) {
      if (!isAdjustment(l) || l.hidden) return false;
      var start = Number(l.start) || 0;
      var dur = Number(l.duration);
      if (!isFinite(dur)) dur = 0;
      return t >= start && t <= start + dur;
    }).reverse(); /* model.layers is top-first, so reverse for painting order */
  }

  function hasEffects(l) {
    if (!l) return false;
    if (Array.isArray(l.effectStack) && l.effectStack.length) return true;
    var e = l.effects || {};
    return !!((e.blur || 0) || (Number(e.brightness) || 100) !== 100 ||
      (Number(e.contrast) || 100) !== 100 || (Number(e.saturate) || 100) !== 100 || (e.hue || 0));
  }

  /**
   * The CSS filter an adjustment's legacy effects add up to.
   *
   * The renderer exposes the same mapping for ordinary layers; using it keeps a brightness
   * adjustment looking identical to the brightness slider on a clip.
   */
  function cssFilterFor(l, time) {
    try {
      if (typeof window.omsEffectCssFilterForLayer === 'function') {
        return window.omsEffectCssFilterForLayer(l, time) || 'none';
      }
    } catch (e) {}
    var e = l.effects || {};
    var parts = [];
    if (e.blur) parts.push('blur(' + (Number(e.blur) || 0) + 'px)');
    if ((Number(e.brightness) || 100) !== 100) parts.push('brightness(' + e.brightness + '%)');
    if ((Number(e.contrast) || 100) !== 100) parts.push('contrast(' + e.contrast + '%)');
    if ((Number(e.saturate) || 100) !== 100) parts.push('saturate(' + e.saturate + '%)');
    if (e.hue) parts.push('hue-rotate(' + (Number(e.hue) || 0) + 'deg)');
    return parts.length ? parts.join(' ') : 'none';
  }

  /**
   * Applies one adjustment to whatever is already in the target context.
   *
   * The context holds the frame drawn so far. Reading it back into a buffer, filtering the
   * buffer, and drawing it over the region is the only reliable way to do this in 2D canvas,
   * because a canvas filter applies to what you draw, not to what is already there.
   */
  function composite(ctx, l, canvas, time) {
    if (!ctx || !canvas) return false;
    var filter = hasEffects(l) ? cssFilterFor(l, time) : 'none';
    var opacity = Math.min(1, Math.max(0, Number(l.opacity == null ? 1 : l.opacity)));

    /* Region: the layer's own box, clamped to the canvas, so an adjustment layer can be scaled
       down to grade only part of the frame like it can in the mod. */
    var w = canvas.width, h = canvas.height;
    var x = 0, y = 0, rw = w, rh = h;
    var coversAll = l.fullFrame !== false && !l.w && !l.h;
    if (!coversAll && l.w && l.h) {
      var sx = w / Math.max(1, Number(window.model?.project?.width) || w);
      var sy = h / Math.max(1, Number(window.model?.project?.height) || h);
      rw = Math.max(1, Math.round(Number(l.w) * sx));
      rh = Math.max(1, Math.round(Number(l.h) * sy));
      x = Math.round((Number(l.x) || 0) * sx - rw / 2);
      y = Math.round((Number(l.y) || 0) * sy - rh / 2);
      /* A layer hanging off the left or top edge is legal, so the region is clipped by
         shrinking it, not by moving it - moving it would grade the wrong part of the frame. */
      if (x < 0) { rw += x; x = 0; }
      if (y < 0) { rh += y; y = 0; }
      if (x + rw > w) rw = w - x;
      if (y + rh > h) rh = h - y;
      rw = Math.max(1, Math.min(w - x, rw));
      rh = Math.max(1, Math.min(h - y, rh));
    }

    if (filter === 'none' && opacity >= 1) return false;

    try {
      /* One shared scratch buffer: compositing runs per adjustment per frame, so a fresh
         element every call was pure garbage-collection pressure. */
      if (!scratch) scratch = document.createElement('canvas');
      var buffer = scratch;
      if (buffer.width !== rw || buffer.height !== rh) { buffer.width = rw; buffer.height = rh; }
      var bctx = buffer.getContext('2d');
      bctx.clearRect(0, 0, rw, rh);
      bctx.drawImage(canvas, x, y, rw, rh, 0, 0, rw, rh);

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = filter;
      /* Blending in the adjustment's blend mode, matching how the layer itself would draw. */
      ctx.globalCompositeOperation = l.blend || 'source-over';
      ctx.drawImage(buffer, 0, 0, rw, rh, x, y, rw, rh);
      ctx.restore();
      return true;
    } catch (e) {
      failures.push(String(e && e.message));
      return false;
    }
  }

  /* One scratch canvas is shared by every composite() call in a frame. */
  var scratch = null;

  /** Draws every active adjustment for the current frame. */
  function applyAdjustments(ctx, canvas) {
    var list = activeAdjustments();
    if (!list.length) return 0;
    var m = window.model;
    var time = Number(m && m.time) || 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (composite(ctx, list[i], canvas, time)) n++;
    }
    return n;
  }

  /**
   * Hooks the render path, whichever one the device ended up with.
   *
   * The core is one IIFE, so `renderer` is private; the build publishes it as
   * window.__omsRenderer (the WebGL renderer) and, when WebGL is unavailable, its 2D
   * fallback as window.__omsRenderer2D. Earlier revisions looked for window.renderer and
   * then for a bare `renderer` - neither exists from a separate script - so this module
   * never installed and the self-check reported "renderer never became reachable".
   *
   * 2D fallback renderer: the stage is a plain 2D canvas and frames go through
   * drawLayer()/render(). drawLayer is short-circuited so adjustment layers never draw
   * content, and render()/renderLayersToTarget() composite the grade afterwards, so
   * preview, thumbnails and exports all agree.
   *
   * WebGL renderer: the stage is a GL canvas a 2D filter cannot draw back into. The core
   * calls window.omsPostFrame(this) at the end of every frame (build-time patch); the
   * hook copies the GL canvas into a borderless 2D overlay laid exactly over the stage
   * and grades the copy there. The copy is synchronous with the GL render, so the
   * drawing buffer is still valid. GL exports bypass the overlay and stay ungraded.
   */
  function install() {
    if (installed) return true;
    var ok = false;
    var r2 = null, rgl = null;
    try { r2 = window.__omsRenderer2D || null; } catch (e) {}
    try { rgl = window.__omsRenderer || null; } catch (e) {}
    if (r2 && typeof r2.drawLayer === 'function') ok = install2D(r2) || ok;
    if (rgl) ok = installGL(rgl) || ok;
    if (ok) { installed = true; log('installed'); }
    return ok;
  }

  function install2D(r) {
    if (r.__amzAdjust) return true;

    var originalDrawLayer = r.drawLayer;
    r.drawLayer = function (layer) {
      /* An adjustment layer has no content of its own; it is applied after the frame. */
      if (isAdjustment(layer)) return;
      return originalDrawLayer.call(this, layer);
    };

    /* renderLayersToTarget is the path the exporter and thumbnails take. Wrapping it too
       means an exported frame is graded exactly like the preview. */
    var originalRender = r.renderLayersToTarget;
    if (typeof originalRender === 'function') {
      r.renderLayersToTarget = function (canvas, layers, withBackground) {
        var result = originalRender.call(this, canvas, layers, withBackground);
        try {
          var ctx = canvas.getContext('2d');
          applyAdjustments(ctx, canvas);
        } catch (e) {}
        return result;
      };
    }

    /* The live 2D preview paints through render(), not renderLayersToTarget - grade it. */
    var originalFrame = r.render;
    if (typeof originalFrame === 'function') {
      r.render = function () {
        var out = originalFrame.apply(this, arguments);
        try {
          if (this.canvas && activeAdjustments().length) {
            applyAdjustments(this.canvas.getContext('2d'), this.canvas);
          }
        } catch (e) {}
        return out;
      };
    }

    r.__amzAdjust = true;
    log('installed on the 2D renderer');
    return true;
  }

  /* ------------------------------------------------- WebGL preview: the graded overlay */

  var glOverlay = null;

  function installGL(r) {
    if (r.__amzAdjustGL) return true;
    r.__amzAdjustGL = true;
    /* One hook serves whichever renderer is live; the frame's canvas comes in as the
       argument, so a renderer swap cannot strand the overlay. */
    window.omsPostFrame = glPostFrame;
    log('installed on the WebGL renderer (overlay grade)');
    return true;
  }

  function ensureGlOverlay() {
    if (glOverlay && glOverlay.isConnected) return glOverlay;
    glOverlay = document.createElement('canvas');
    glOverlay.className = 'amzAdjustOverlay';
    glOverlay.setAttribute('aria-hidden', 'true');
    glOverlay.style.display = 'none';
    glOverlay.__amzStyle = '';
    document.body.appendChild(glOverlay);
    return glOverlay;
  }

  function hideGlOverlay() {
    if (glOverlay && glOverlay.style.display !== 'none') {
      glOverlay.style.display = 'none';
      glOverlay.__amzStyle = '';
    }
  }

  function glPostFrame(renderer) {
    try {
      var canvas = renderer && renderer.canvas;
      if (!canvas || !canvas.width || !canvas.height) { hideGlOverlay(); return; }
      /* Zero active adjustments costs nothing: the overlay stays hidden. */
      if (!activeAdjustments().length) { hideGlOverlay(); return; }
      var rect = canvas.getBoundingClientRect();
      if (!rect || rect.width < 2 || rect.height < 2) { hideGlOverlay(); return; }

      var o = ensureGlOverlay();
      if (o.width !== canvas.width || o.height !== canvas.height) {
        o.width = canvas.width;
        o.height = canvas.height;
      }
      /* position:fixed tracks the stage wherever the layout puts it (zoom, rotation,
         scrolling) because the rect is re-read every frame. */
      var style = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' +
        rect.width + 'px;height:' + rect.height + 'px;pointer-events:none;z-index:5;display:block;';
      if (o.__amzStyle !== style) { o.style.cssText = style; o.__amzStyle = style; }

      var ctx = o.getContext('2d');
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.drawImage(canvas, 0, 0, o.width, o.height);
      ctx.restore();
      applyAdjustments(ctx, o);
    } catch (e) {
      failures.push(String(e && e.message));
      hideGlOverlay();
    }
  }

  /* ------------------------------------------------------------------- adding one */

  function addAdjustmentLayer(effectId) {
    var m = window.model;
    if (!m || typeof m.addLayer !== 'function') return null;
    try { if (window.history && window.history.push) window.history.push(); } catch (e) {}

    var layer = m.addLayer('group', {
      name: effectId ? 'Adjustment · ' + effectId : 'Adjustment',
      duration: Number(m.project && m.project.duration) || 5,
    });
    if (!layer) return null;

    /* A group is the shell; the type is what makes the renderer treat it as an adjustment. */
    layer.type = TYPE;
    layer.fullFrame = true;
    layer.effectStack = [];
    layer.blend = 'source-over';
    if (effectId && window.omsEffectInstance) {
      try {
        var inst = window.omsEffectInstance(effectId, {});
        if (inst) layer.effectStack.push(inst);
      } catch (e) {}
    }
    changed();
    return layer;
  }

  /* ------------------------------------------------------------------ choosing an effect */

  /**
   * Opens a picker that adds an effect to the adjustment rather than to a clip.
   *
   * The effect browser already applies to the selected layer, and an adjustment layer can be
   * selected, so this exists for the case where you just added one and want to see it do
   * something without hunting for it in the drawer.
   */
  function openAdjustmentPicker(layer) {
    var hub = window.omsAmzHub;
    if (!hub || !hub.sheet) return;
    var catalog = window.OMS_EFFECT_CATALOG || [];
    /* Only effects this layer can actually accept, so the list is not full of rejections. */
    var usable = catalog.filter(function (spec) {
      try {
        var cap = window.OMSUnifiedRender && window.OMSUnifiedRender.capability;
        if (!cap) return true;
        return !!cap(layer, spec).available;
      } catch (e) { return true; }
    });

    hub.sheet({
      title: 'Adjustment effect',
      subtitle: 'Applies to everything beneath this layer',
      build: function (body) {
        var groups = {}, order = [];
        usable.forEach(function (spec) {
          var key = spec.category || 'Lain';
          if (!groups[key]) { groups[key] = []; order.push(key); }
          groups[key].push(spec);
        });
        order.forEach(function (cat) {
          var head = document.createElement('div');
          head.className = 'amzGroup';
          head.textContent = cat;
          body.appendChild(head);
          groups[cat].forEach(function (spec) {
            var row = document.createElement('div');
            row.className = 'amzTool';
            row.innerHTML = '<div class="amzToolText"><b>' + spec.name + '</b><p>' +
              ((spec.params || []).length) + ' controls</p></div><div class="chev">+</div>';
            row.onclick = function () {
              if (!window.omsEffectInstance) return;
              try {
                if (window.history && window.history.push) window.history.push();
                layer.effectStack = layer.effectStack || [];
                layer.effectStack.push(window.omsEffectInstance(spec.id, {}));
                changed();
                /* There is no window.renderer or window.timeline: those are module locals. */
                changed();
                if (hub.notify) hub.notify(spec.name + ' added to the adjustment');
              } catch (e) {
                if (hub.notify) hub.notify('Could not add that effect');
              }
            };
            body.appendChild(row);
          });
        });
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  window.omsAmzAdjust = {
    TYPE: TYPE,
    install: install,
    addAdjustmentLayer: addAdjustmentLayer,
    openAdjustmentPicker: openAdjustmentPicker,
    applyAdjustments: applyAdjustments,
    activeAdjustments: activeAdjustments,
    isAdjustment: isAdjustment,
    cssFilterFor: cssFilterFor,
    composite: composite,
    failures: failures,
    get installed() { return installed; },
  };

  /*
   * Try once immediately - the extension scripts are injected after the editor, so the renderer
   * normally already exists - and retry on a timer only if it did not.
   */
  var tries = 0;
  if (!install()) {
    var timer = setInterval(function () {
      tries++;
      if (install()) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.report('adjust', true); }
      else if (tries > 120) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.gaveUp('adjust', 'renderer never became reachable'); }
    }, 500);
  }
})();
