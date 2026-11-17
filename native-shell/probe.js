/*
 * EditorsHub tap probe.
 *
 * Every diagnosis so far has been indirect: a script fired a synthetic click, then a
 * guess explained why the app did not react. Android does not send a click on its own --
 * it sends touchstart -> touchend -> pointerdown -> pointerup -> click, and the editor
 * reacts to specific ones. A synthetic click therefore reaches handlers a real finger
 * might never reach, and misses ones it does.
 *
 * This probe watches the real thing: every touch, pointer and click event that arrives
 * anywhere in the document, what element it landed on, and whether the screen changed.
 * The user taps the button that does not work, taps REC, and gets a transcript.
 *
 * That transcript separates three cases that have been impossible to tell apart:
 *
 *   - the tap never arrives           -> an overlay or the WebView is eating it
 *   - the tap arrives but no click    -> the handler is not bound to this event type
 *   - the tap arrives and clicks      -> the app reacted, but not visibly, or the
 *                                        finger landed on a different element
 */
(function () {
  'use strict';

  var MAX_EVENTS = 150;
  var TYPES = ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'click'];

  var recording = [];
  var active = false;
  var startedAt = 0;

  function describe(el) {
    if (!el || el.nodeType !== 1) return '(not an element)';
    var name = el.tagName.toLowerCase();
    if (el.id) name += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      name += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26);
    return text ? name + ' "' + text + '"' : name;
  }

  function isProbeChrome(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.id === 'omsTapProbe' || node.id === 'omsReportView' ||
          node.id === 'omsDialogScrim' || node.id === 'omsBuildBadgeHost') return true;
      node = node.parentElement;
    }
    return false;
  }

  function under(x, y) {
    if (typeof x !== 'number' || isNaN(x)) return null;
    try {
      var stack = document.elementsFromPoint(x, y) || [];
      for (var i = 0; i < stack.length; i++) {
        if (stack[i] && stack[i].nodeType === 1 && !isProbeChrome(stack[i])) return stack[i];
      }
    } catch (e) { /* older WebView */ }
    return null;
  }

  function state() {
    var open = 0;
    var sel = '#omsDialogScrim, dialog[open], #omsReportView, ' +
      '.modalShade:not(.hidden), .effectDetailShade:not(.hidden), ' +
      '.omsStudioOverlay:not(.hidden)';
    var nodes = document.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      var style = getComputedStyle(nodes[i]);
      if (style.display !== 'none' && style.visibility !== 'hidden') open++;
    }
    var view = '';
    var views = document.querySelectorAll('.omsMobileTabView.active');
    for (var v = 0; v < views.length; v++) view += views[v].id + ' ';
    var editor = document.getElementById('editor');
    return {
      sheets: open,
      view: view.trim() || '(none)',
      editor: !!(editor && !editor.classList.contains('hidden')),
    };
  }

  function record(type, event) {
    if (!active || recording.length >= MAX_EVENTS) return;
    var target = event.target;
    var point = null;
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number' &&
        (event.clientX || event.clientY)) {
      point = under(event.clientX, event.clientY);
    }
    recording.push({
      at: Math.round(performance.now() - startedAt),
      type: type,
      target: describe(target),
      hit: point ? describe(point) : '',
      misplaced: !!(point && target && point !== target &&
        !point.contains(target) && !target.contains(point)),
      state: state(),
    });
  }

  var handlers = {};
  TYPES.forEach(function (type) {
    handlers[type] = function (event) { record(type, event); };
  });

  function start() {
    if (active) return;
    active = true;
    recording = [];
    startedAt = performance.now();
    TYPES.forEach(function (type) {
      document.addEventListener(type, handlers[type], true);
    });
  }

  function stop() {
    if (!active) return;
    active = false;
    TYPES.forEach(function (type) {
      document.removeEventListener(type, handlers[type], true);
    });
  }

  function summarise() {
    var taps = [];
    var current = null;
    recording.forEach(function (event) {
      if (event.type === 'touchstart' || event.type === 'pointerdown') {
        if (current) taps.push(current);
        current = {
          target: event.target,
          hit: event.hit,
          misplaced: event.misplaced,
          seen: {},
          stateBefore: event.state,
          stateAfter: event.state,
        };
      }
      if (!current) return;
      current.seen[event.type] = true;
      current.stateAfter = event.state;
      if (event.misplaced) {
        current.misplaced = true;
        current.hit = event.hit;
      }
    });
    if (current) taps.push(current);
    return taps;
  }

  function format() {
    var taps = summarise();
    var lines = ['TAPS RECORDED: ' + taps.length];
    var dead = 0;
    var wrong = 0;

    taps.forEach(function (tap, index) {
      var chain = TYPES.filter(function (t) { return tap.seen[t]; }).join(' ');
      var changed = tap.stateBefore.sheets !== tap.stateAfter.sheets ||
        tap.stateBefore.view !== tap.stateAfter.view ||
        tap.stateBefore.editor !== tap.stateAfter.editor;

      var verdict;
      if (tap.misplaced) {
        verdict = 'WRONG ELEMENT - your finger landed on something else';
        wrong++;
      } else if (!tap.seen.touchstart && !tap.seen.pointerdown) {
        verdict = 'NO TAP ARRIVED';
        dead++;
      } else if (!tap.seen.click) {
        verdict = 'tap arrived, but the page never got a click';
        dead++;
      } else if (!changed) {
        verdict = 'arrived and clicked, but the app did not react';
        dead++;
      } else {
        verdict = 'worked';
      }

      lines.push('');
      lines.push('#' + (index + 1) + '  ' + tap.target);
      lines.push('    ' + verdict);
      if (tap.misplaced && tap.hit) lines.push('    finger landed on: ' + tap.hit);
      lines.push('    events: ' + (chain || '(none)'));
      if (changed) {
        lines.push('    screen: ' + JSON.stringify(tap.stateBefore) + ' -> ' +
          JSON.stringify(tap.stateAfter));
      }
    });

    lines.push('');
    if (!taps.length) {
      lines.push('Nothing recorded. Either no tap reached the page, or the probe was ' +
        'opened after the taps.');
    } else {
      lines.push('SUMMARY: ' + taps.length + ' taps, ' + wrong +
        ' landed on the wrong element, ' + dead + ' did not work.');
    }
    var meta = document.querySelector('meta[name="editorshub-build"]');
    lines.push('Build: ' + (meta ? meta.getAttribute('content') : '(unknown)'));
    lines.push('Viewport: ' + window.innerWidth + 'x' + window.innerHeight +
      ' @' + window.devicePixelRatio + 'x');
    return lines.join('\n');
  }

  function pill() {
    var existing = document.getElementById('omsTapProbe');
    if (existing) return existing;
    var el = document.createElement('div');
    el.id = 'omsTapProbe';
    el.textContent = 'STOP + SHOW';
    el.style.cssText = [
      'position:fixed', 'right:8px',
      'bottom:calc(140px + env(safe-area-inset-bottom, 0px))',
      'z-index:2147482800', 'padding:8px 11px', 'border-radius:999px',
      'background:#25b58a', 'color:#04120f',
      'font:900 10px/1 system-ui,sans-serif', 'letter-spacing:.05em',
      'box-shadow:0 6px 18px rgba(0,0,0,.5)', 'touch-action:manipulation',
    ].join(';');
    el.addEventListener('click', function (event) {
      event.stopPropagation();
      event.preventDefault();
      finish();
    }, true);
    document.body.appendChild(el);
    return el;
  }

  function finish() {
    stop();
    var el = document.getElementById('omsTapProbe');
    if (el) el.remove();
    var text = format();
    try {
      var native = window.EditorsHubNative || window.OpenMotionNative;
      if (native && native.saveDiagnostics) native.saveDiagnostics(text);
    } catch (e) { /* optional */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) { /* optional */ }
    if (typeof window.omsShowReport === 'function') {
      var taps = summarise();
      var bad = 0;
      taps.forEach(function (t) { if (t.misplaced || !t.seen.click) bad++; });
      window.omsShowReport('Your taps', text,
        taps.length + ' taps recorded, ' + bad + ' did not work');
    }
  }

  window.omsTapProbe = {
    start: function () { start(); pill(); },
    stop: stop,
    format: format,
    summarise: summarise,
  };
})();
