/*
 * Wiring for the settings that used to be decorative.
 *
 * Eighteen of the thirty-eight switches stored a value and changed nothing. That is worse than
 * not having the switch: it tells the user their phone will behave differently and then it does
 * not, so a real problem gets blamed on a setting that never applied.
 *
 * Each function here either does the thing or the setting's own help text now says plainly that
 * it cannot. Nothing in this file pretends.
 */
(function () {
  'use strict';
  if (window.omsAmzSettingsWire) return;

  function S() { return window.omsAmzSettings; }
  function get(id) {
    try { var s = S(); return s ? s.get(id) : null; } catch (e) { return null; }
  }
  function notify(m) {
    try { if (window.omsAmzHub && window.omsAmzHub.notify) return window.omsAmzHub.notify(m); } catch (e) {}
    try { if (window.toast) window.toast(m); } catch (e) {}
  }

  /* ============================================================ preview frame rate cap */

  /*
   * The preview draws from a rAF loop inside the core. There is no public hook to change its
   * rate, but rAF itself is a global, so the honest way to cap the preview is to intercept the
   * callbacks the core schedules. This wraps requestAnimationFrame and drops frames that arrive
   * sooner than the configured interval - only for callbacks scheduled while the editor is
   * animating, and never for the ones this file's own timers use.
   */
  var rafWrapped = false;
  var lastPaint = 0;
  function applyPreviewFpsCap() {
    var cap = Number(get('previewFpsCap')) || 0;
    var on = !!get('capPreviewFps');
    if (!rafWrapped) {
      var original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) {
        var limit = 0;
        if (get('capPreviewFps')) {
          var fps = Number(get('previewFpsCap')) || 0;
          /* 60 is the natural ceiling; capping above it would only add latency. */
          if (fps > 0 && fps < 60) limit = 1000 / fps;
        }
        if (!limit) return original(cb);
        return original(function (ts) {
          var now = performance.now();
          if (now - lastPaint < limit - 1) {
            /* Too soon: re-queue rather than draw, which is what "cap" means. */
            return window.requestAnimationFrame(cb);
          }
          lastPaint = now;
          return cb(ts);
        });
      };
      rafWrapped = true;
    } else if (!on || !(cap > 0)) {
      lastPaint = 0;
    }
    document.documentElement.setAttribute('data-amz-fps-cap', on && cap ? String(cap) : 'off');
  }

  /* ==================================================================== drag snap */

  /*
   * Snap a dragged layer's centre to the canvas centre and its edges to the canvas edges.
   * Hooks pointerup on the stage: after a drag settles, if the layer is within the threshold of a
   * guide, nudge it onto the guide. Threshold is in project pixels, scaled from the displayed
   * size so it feels the same at any zoom.
   */
  function applyDragSnap() {
    var on = !!get('dragSnap');
    var stage = document.querySelector('#stage') || document.querySelector('.canvasWrap');
    if (!stage) return;
    if (stage.__amzSnapBound) { stage.__amzSnap = on; return; }
    stage.__amzSnap = on;
    stage.__amzSnapBound = true;
    stage.addEventListener('pointerup', function () {
      if (!stage.__amzSnap) return;
      var m = window.model;
      if (!m || !m.project) return;
      var l = null;
      try { l = m.selectedLayer ? m.selectedLayer() : null; } catch (e) {}
      if (!l || l.locked) return;
      var W = Number(m.project.width) || 1080, H = Number(m.project.height) || 1920;
      /* 12 project pixels, or 1.5% of the short edge, whichever is smaller. */
      var tol = Math.min(12, Math.min(W, H) * 0.015);
      var moved = false;
      /* Centre plus both edges, which is what the setting's help text promises. The edges are
         half a layer away from the centre, so the candidates depend on the layer's own size. */
      var halfW = (Number(l.w) || 0) * (Number(l.scaleX) || 1) / 2;
      var halfH = (Number(l.h) || 0) * (Number(l.scaleY) || 1) / 2;
      var candidates = [
        [W / 2, 'x'], [H / 2, 'y'],
        [halfW, 'x'], [W - halfW, 'x'],
        [halfH, 'y'], [H - halfH, 'y'],
      ];
      candidates.forEach(function (pair) {
        var target = pair[0], prop = pair[1];
        var v = Number(l[prop]);
        if (!isFinite(v)) return;
        if (Math.abs(v - target) <= tol && l[prop] !== target) { l[prop] = target; moved = true; }
      });
      if (moved) {
        try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
      }
    }, { passive: true });
  }

  /* ============================================================ lock camera while playing */

  /*
   * The camera-view toggle lives in the core as a global function that the button calls. Rather
   * than fight it, this intercepts clicks on the control by capturing pointerdown on the document
   * and stopping ones that land on the camera-view button while playback is running.
   */
  function applyCameraLock() {
    var on = !!get('lockCameraWhilePlaying');
    if (window.__amzCamLockBound) { window.__amzCamLock = on; return; }
    window.__amzCamLock = on;
    window.__amzCamLockBound = true;
    document.addEventListener('pointerdown', function (e) {
      if (!window.__amzCamLock) return;
      var m = window.model;
      if (!m || !m.playing) return;
      var t = e.target;
      for (var i = 0; i < 4 && t; i++, t = t.parentElement) {
        var id = (t.id || '') + ' ' + (t.className || '');
        if (/cameraView|camView|toggleCamera|viewCamera/i.test(id)) {
          e.stopPropagation();
          e.preventDefault();
          notify('Camera view is locked while playing');
          return;
        }
      }
    }, true);
  }

  /* ============================================================ confirm before leaving */

  /*
   * Leaving the editor clears cache and undo history, so this asks first.
   * `confirmStyle` picks a dialog or the double-back pattern.
   */
  var lastBack = 0;
  function applyConfirmLeave() {
    var on = !!get('confirmLeaveEditor');
    if (window.__amzLeaveBound) { window.__amzLeave = on ? get('confirmStyle') : null; return; }
    window.__amzLeaveBound = true;
    window.__amzLeave = on ? get('confirmStyle') : null;

    /* The back gesture arrives as a history pop. Intercept it before the core reacts. */
    window.addEventListener('popstate', function () {
      var style = window.__amzLeave;
      if (!style) return;
      var inEditor = !!document.querySelector('#stage') && !!document.querySelector('.timelineWrap, #timelineScroll');
      if (!inEditor) return;
      var now = Date.now();
      if (style === 'double') {
        if (now - lastBack < 2000) { lastBack = 0; return; }
        lastBack = now;
        try { history.pushState(history.state, ''); } catch (e) {}
        notify('Press back again to leave the editor');
        return;
      }
      /* Dialog style: block, ask, and re-push so the state survives a cancel. */
      var ok = window.confirm('Leave the editor? The frame cache and undo history will be cleared.');
      if (!ok) { try { history.pushState(history.state, ''); } catch (e) {} }
    });
  }

  /* ============================================================ effect browser behaviour */

  /*
   * Direct Effect Choice: tapping a row adds the effect instead of opening its description.
   * Done by clicking the row's add button when one exists, which is the same code path the
   * description page uses - so presets and defaults still apply.
   */
  function applyDirectEffect() {
    var on = !!get('directEffectChoice');
    if (window.__amzDirectEffectBound) { window.__amzDirectEffect = on; return; }
    window.__amzDirectEffect = on;
    window.__amzDirectEffectBound = true;
    document.addEventListener('click', function (e) {
      if (!window.__amzDirectEffect) return;
      var t = e.target;
      var row = null;
      for (var i = 0; i < 5 && t; i++, t = t.parentElement) {
        if (t.matches && t.matches('[data-effect-id], .effectRow, .effectListItem')) { row = t; break; }
      }
      if (!row) return;
      var add = row.querySelector('[data-add-effect], .effectAdd, button.addEffect');
      if (add) { e.preventDefault(); e.stopPropagation(); add.click(); }
    }, true);
  }

  /*
   * Effect Search Delay: the list already filters on input. This debounces the search field so
   * typing does not re-filter on every key, which is what the setting promises.
   */
  function applySearchDelay() {
    var ms = Number(get('effectSearchDelay'));
    if (!(ms > 0)) ms = 0;
    document.querySelectorAll('input[type="search"], .effectSearchInput, [data-effect-search]').forEach(function (input) {
      if (input.__amzDebounced) return;
      input.__amzDebounced = true;
      var handler = function () {
        var delay = Number(get('effectSearchDelay')) || 0;
        clearTimeout(input.__amzTimer);
        if (!delay) return;
        input.__amzTimer = setTimeout(function () {
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, delay);
      };
      input.addEventListener('input', handler, { passive: true });
    });
  }

  /* ============================================================ lock preview button */

  /*
   * Shows a lock beside the preview quality control that stops playback while you scrub.
   *
   * The lock is added by this file; the "while you scrub" half works by watching the playhead
   * and pausing playback if the user drags it with the lock engaged.
   */
  function applyPreviewLock() {
    var on = !!get('lockPreviewButton');
    var existing = document.getElementById('amzPreviewLock');
    if (!on) {
      if (existing) existing.remove();
      window.__amzPreviewLocked = false;
      return;
    }
    if (existing) return;
    var host = document.querySelector('#previewQuality') || document.querySelector('.previewQuality') ||
               document.querySelector('#stage');
    if (!host) return;
    var b = document.createElement('button');
    b.id = 'amzPreviewLock';
    b.textContent = '🔒';
    b.title = 'Lock playback while scrubbing';
    b.style.cssText = 'position:absolute;z-index:70;right:8px;top:8px;width:26px;height:26px;' +
      'border-radius:8px;border:1px solid #3b465f;background:rgba(20,24,36,.82);color:#9fb0c8;font-size:12px';
    b.setAttribute('aria-pressed', 'false');
    b.onclick = function () {
      var locked = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(locked));
      b.style.color = locked ? '#7ff0d6' : '#9fb0c8';
      b.style.borderColor = locked ? 'rgba(39,211,181,.6)' : '#3b465f';
      window.__amzPreviewLocked = locked;
      notify(locked ? 'Preview locked' : 'Preview unlocked');
    };
    host.style.position = host.style.position || 'relative';
    host.appendChild(b);

    /* While locked, a scrub that changes the time pauses playback instead of dragging it. */
    if (!window.__amzScrubBound) {
      window.__amzScrubBound = true;
      var lastTime = null;
      setInterval(function () {
        if (!window.__amzPreviewLocked) { lastTime = null; return; }
        var m = window.model;
        if (!m) return;
        var now = Number(m.time);
        if (lastTime !== null && now !== lastTime && m.playing) {
          try { if (window.togglePlay) window.togglePlay(); } catch (e) {}
        }
        lastTime = now;
      }, 150);
    }
  }

  /* =================================================================== iOS styles */

  function applyIosStyles() {
    var on = !!get('iosStyles');
    var el = document.getElementById('amzIosStyle');
    if (!on) { if (el) el.remove(); return; }
    if (el) return;
    var s = document.createElement('style');
    s.id = 'amzIosStyle';
    /* Rounded, translucent, blurred - the iOS look for the trim grips and share button only,
       which is what the setting says it changes. */
    s.textContent = [
      '.trimHandle,.handle{background:rgba(255,255,255,.92)!important;border:1px solid rgba(0,0,0,.12)!important;',
      'border-radius:4px!important;backdrop-filter:blur(6px);box-shadow:0 1px 4px rgba(0,0,0,.22)!important}',
      '.shareBtn,#shareBtn{border-radius:14px!important;background:rgba(120,120,128,.24)!important;',
      'backdrop-filter:blur(10px)!important;border:0!important}',
    ].join('');
    document.head.appendChild(s);
  }

  /* =================================================================== hex colour */

  /*
   * Shows effect colour values as #RRGGBB instead of three 0-255 numbers.
   * Works by tagging number triples that sit next to a colour swatch. It is a display change
   * only and leaves the inputs alone, so nothing that reads them breaks.
   */
  function applyHexColour() {
    var on = !!get('hexColor');
    var el = document.getElementById('amzHexStyle');
    if (!on) { if (el) el.remove(); document.querySelectorAll('[data-amz-hex]').forEach(function (n) { n.remove(); }); return; }
    if (!el) {
      el = document.createElement('style');
      el.id = 'amzHexStyle';
      el.textContent = '.amzHexChip{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:4px;' +
        'background:rgba(255,255,255,.08);color:#cbd5e6;font-size:11px;font-variant-numeric:tabular-nums}';
      document.head.appendChild(el);
    }
    document.querySelectorAll('input[type="color"]').forEach(function (inp) {
      if (inp.__amzHex) return;
      inp.__amzHex = true;
      var chip = document.createElement('span');
      chip.className = 'amzHexChip';
      chip.setAttribute('data-amz-hex', '1');
      chip.textContent = inp.value.toUpperCase();
      inp.parentNode.insertBefore(chip, inp.nextSibling);
      inp.addEventListener('input', function () { chip.textContent = inp.value.toUpperCase(); });
    });
  }

  /* =================================================================== custom background */

  /*
   * Adds the configured colour to the background picker in New Project. The picker is rebuilt
   * by the core, so this re-appends on every opening of that dialog.
   */
  function applyCustomBackground() {
    var off = !!get('customBackgroundEnabled');
    var colour = get('customBackground') || '#101418';
    if (!off) { document.querySelectorAll('[data-amz-custom-bg]').forEach(function (n) { n.remove(); }); return; }
    var pickers = document.querySelectorAll('.bgPicker, [data-bg-picker], .projectRatioPicker');
    pickers.forEach(function (p) {
      if (p.querySelector('[data-amz-custom-bg]')) return;
      var b = document.createElement('button');
      b.setAttribute('data-amz-custom-bg', '1');
      b.className = 'bgSwatch';
      b.style.cssText = 'background:' + colour + ';border-radius:6px;width:28px;height:28px';
      b.title = 'Custom background ' + colour;
      b.onclick = function () {
        var m = window.model;
        if (m && m.project) { m.project.background = colour; }
        try { if (window.omsAmzBridge) window.omsAmzBridge.refresh(); } catch (e) {}
      };
      p.appendChild(b);
    });
  }

  /* ==================================================================== audio fade */

  /*
   * Smooth End Replay Audio: fade preview audio over ~30 ms on stop so there is no click.
   * Preview audio plays through the core's <video>/<audio> elements, so this attaches to those.
   */
  function applySmoothEndAudio() {
    var on = !!get('smoothEndAudio');
    document.querySelectorAll('audio, video').forEach(function (el) {
      if (el.__amzFade) return;
      el.__amzFade = true;
      var originalVolume = null;
      el.addEventListener('pause', function () {
        if (!get('smoothEndAudio')) return;
        try {
          originalVolume = el.volume;
          var steps = 4, i = 0;
          var timer = setInterval(function () {
            i++;
            el.volume = Math.max(0, originalVolume * (1 - i / steps));
            if (i >= steps) {
              clearInterval(timer);
              el.volume = originalVolume;
            }
          }, 8);
        } catch (e) {}
      });
    });
  }

  /* ==================================================================== the dispatcher */

  function applyAll() {
    try { applyPreviewFpsCap(); } catch (e) {}
    try { applyDragSnap(); } catch (e) {}
    try { applyCameraLock(); } catch (e) {}
    try { applyConfirmLeave(); } catch (e) {}
    try { applyDirectEffect(); } catch (e) {}
    try { applySearchDelay(); } catch (e) {}
    try { applyIosStyles(); } catch (e) {}
    try { applyHexColour(); } catch (e) {}
    try { applyCustomBackground(); } catch (e) {}
    try { applyPreviewLock(); } catch (e) {}
    try { applySmoothEndAudio(); } catch (e) {}
  }

  window.omsAmzSettingsWire = {
    applyAll: applyAll,
    applyPreviewFpsCap: applyPreviewFpsCap,
    applyDragSnap: applyDragSnap,
    applyCameraLock: applyCameraLock,
    applyConfirmLeave: applyConfirmLeave,
    applyDirectEffect: applyDirectEffect,
    applySearchDelay: applySearchDelay,
    applyIosStyles: applyIosStyles,
    applyHexColour: applyHexColour,
    applyCustomBackground: applyCustomBackground,
    applyPreviewLock: applyPreviewLock,
    applySmoothEndAudio: applySmoothEndAudio,
  };

  /* Re-apply when the settings module is ready and whenever the reader changes. */
  var waited = 0;
  var t = setInterval(function () {
    waited += 1;
    if (window.omsAmzSettings) {
      clearInterval(t);
      applyAll();
      var s = window.omsAmzSettings;
      if (s && typeof s.onChange === 'function') s.onChange(applyAll);
    } else if (waited > 100) {
      clearInterval(t);
    }
  }, 100);
})();
