/*
 * Selection panels the editor did not have: Shift Keyframes, and Split Text.
 *
 * Both are additive. They read the model and write through the editor's own history and bus, so
 * undo works and every view refreshes exactly as it does for a built-in action.
 */
(function () {
  'use strict';
  if (window.omsAmzSelect) return;

  function settings() { return window.omsAmzSettings; }
  function hub() { return window.omsAmzHub; }
  function notify(m) {
    try {
      if (hub() && hub().notify) return hub().notify(m);
      if (window.toast) return window.toast(m);
    } catch (e) {}
  }
  /** A recorded undo step, so Shift KF behaves like every other edit. */
  function checkpoint() {
    try { if (window.history && window.history.push) window.history.push(); } catch (e) {}
  }
  function changed() {
    try { if (window.bus && window.bus.emit) window.bus.emit('model:changed'); } catch (e) {}
  }
  function selectedLayer() {
    var m = window.model;
    if (!m) return null;
    try { if (typeof m.selectedLayer === 'function') return m.selectedLayer(); } catch (e) {}
    return (m.layers || []).filter(function (l) { return l.id === m.selected; })[0] || null;
  }

  /* ============================================================== shift keyframes */

  /**
   * Moves every keyframe of a layer by an offset, without moving the layer.
   *
   * This is the operation the mod calls Shift KF: nudge the animation earlier or later while
   * the layer itself stays where it is, which is how you line an entrance up to a beat.
   *
   * Times are clamped to the layer's own span rather than the project's, because a keyframe
   * outside a layer's start/end is invisible and looks like it was deleted.
   */
  function shiftKeyframes(layer, offset) {
    if (!layer || !layer.kf) return 0;
    var props = Object.keys(layer.kf);
    if (!props.length) return 0;
    var lo = Number(layer.start) || 0;
    var hi = lo + (Number(layer.duration) || 0);
    var moved = 0;
    props.forEach(function (prop) {
      var keys = layer.kf[prop];
      if (!Array.isArray(keys)) return;
      keys.forEach(function (k) {
        var t = Math.min(hi, Math.max(lo, (Number(k.t) || 0) + offset));
        if (t !== k.t) { k.t = t; moved++; }
      });
      /* Two keys landing on the same frame would fight each other, so the later one wins and
         the collision is resolved once, after the move. */
      keys.sort(function (a, b) { return a.t - b.t; });
      var seen = -1;
      for (var i = keys.length - 1; i > 0; i--) {
        if (Math.abs(keys[i].t - keys[i - 1].t) < 0.001) keys.splice(i - 1, 1);
      }
    });
    return moved;
  }

  /** A small section heading, matching the sheets elsewhere in this app. */
  function groupLabel(text) {
    var d = document.createElement('div');
    d.className = 'amzGroup';
    d.textContent = text;
    return d;
  }

  function countKeys(layer) {
    if (!layer || !layer.kf) return 0;
    var n = 0;
    Object.keys(layer.kf).forEach(function (p) {
      if (Array.isArray(layer.kf[p])) n += layer.kf[p].length;
    });
    return n;
  }

  function openShiftKf() {
    var layer = selectedLayer();
    if (!layer) return notify('Select a layer first');
    var total = countKeys(layer);
    if (!total) return notify('That layer has no keyframes to shift');

    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    sheet({
      title: 'Shift Keyframes',
      subtitle: total + ' keyframes on ' + (layer.name || 'this layer'),
      build: function (body) {
        var out = document.createElement('p');
        out.className = 'amzNote';
        out.textContent = 'The layer stays put. Only its animation moves. Times are clamped to the layer, so nothing can be pushed out of sight.';
        body.appendChild(out);

        function apply(offset) {
          checkpoint();
          var moved = shiftKeyframes(layer, offset);
          changed();
          notify(moved ? 'Shifted ' + moved + ' keyframe' + (moved === 1 ? '' : 's') : 'Nothing to shift');
        }

        body.appendChild(groupLabel('Nudge'));
        var row = document.createElement('div');
        row.className = 'amzKfRow';
        [-1, -0.5, -0.1, 0.1, 0.5, 1].forEach(function (n) {
          var btn = document.createElement('button');
          btn.className = 'amzBtn';
          btn.textContent = (n > 0 ? '+' : '') + n + 's';
          btn.onclick = function () { apply(n); };
          row.appendChild(btn);
        });
        body.appendChild(row);

        body.appendChild(groupLabel('Exact'));
        var exactRow = document.createElement('div');
        exactRow.className = 'amzKfRow';
        var custom = document.createElement('input');
        custom.type = 'number';
        custom.step = '0.05';
        custom.placeholder = 'Seconds, e.g. -0.25';
        custom.className = 'amzNum';
        var go = document.createElement('button');
        go.className = 'amzBtn primary';
        go.textContent = 'Shift';
        go.onclick = function () {
          var v = Number(custom.value);
          if (!isFinite(v) || v === 0) return notify('Enter a number of seconds');
          apply(v);
        };
        exactRow.appendChild(custom);
        exactRow.appendChild(go);
        body.appendChild(exactRow);
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  /* ================================================================== split text */

  /**
   * Splits a text layer into one layer per character, word or line, preserving the look.
   *
   * Each piece is a copy of the original with its own text and its position offset by where
   * that piece sat in the original string. The original's own transform, effects and keyframes
   * are copied, so an animated title splits into pieces that keep the animation.
   *
   * Width is divided by the fraction of the string each piece represents. That is an estimate -
   * the renderer measures text with real font metrics - so the pieces keep the original's
   * anchor and read as a split of it rather than as separately placed text.
   */
  /*
   * Word splitting keeps the spaces.
   *
   * The obvious `split(/\s+/)` drops them, which turns "Hi there" into two layers that render
   * as "Hithere" - the words are separate but the gap between them is gone. Each word therefore
   * carries its own trailing space as a separate piece, placed in the gap, so the sentence still
   * reads as a sentence when the pieces are back in order.
   */
  var SPLIT_MODES = {
    character: function (s) { return s.split(''); },
    word: function (s) {
      var out = [];
      s.split(/(\s+)/).forEach(function (chunk) {
        if (!chunk) return;
        if (/^\s+$/.test(chunk)) {
          /* A run of spaces becomes one spacer piece, so the gap survives. */
          out.push(chunk);
          return;
        }
        out.push(chunk);
      });
      return out;
    },
    line: function (s) { return s.split(/\r?\n/); },
  };

  function splitText(layer, mode) {
    if (!layer || layer.type !== 'text') return null;
    var text = String(layer.text == null ? '' : layer.text);
    if (!text.length) return null;
    var pieces = (SPLIT_MODES[mode] || SPLIT_MODES.character)(text);
    if (!pieces.length || pieces.length === 1) return null;

    var m = window.model;
    var clone = function (o) {
      try { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
      catch (e) { return JSON.parse(JSON.stringify(o)); }
    };

    checkpoint();
    var container = null;
    /* A parent keeps the pieces together, so the split can still be moved as one thing. */
    try {
      container = m.addLayer('group', { name: (layer.name || 'Text') + ' (split)' });
      container.hidden = true;
      container.start = layer.start;
      container.duration = layer.duration;
    } catch (e) { container = null; }

    var baseW = Number(layer.w) || 0;
    var pieces_total = pieces.length;
    var made = [];

    pieces.forEach(function (piece, index) {
      var copy = clone(layer);
      copy.id = undefined; /* let the model assign */
      copy.name = (layer.name || 'Text') + ' ' + (index + 1);
      copy.text = piece;
      copy.kf = clone(layer.kf || {});
      copy.effectStack = clone(layer.effectStack || []);
      copy.effects = clone(layer.effects || {});
      copy.w = Math.max(1, baseW / pieces_total);
      /* Spread the pieces across the original's width, centred on where it was. */
      var fraction = pieces_total > 1 ? index / (pieces_total - 1) : 0.5;
      copy.x = (Number(layer.x) || 0) - baseW / 2 + (baseW * (pieces_total > 1 ? fraction : 0.5));
      copy.start = layer.start;
      copy.duration = layer.duration;
      copy.parentId = container ? container.id : layer.parentId;

      var added = null;
      try {
        added = m.addLayer('text', copy);
        if (added) {
          added.text = piece;
          added.w = copy.w;
          added.x = copy.x;
          added.name = copy.name;
          changed();
          made.push(added);
        }
      } catch (e) {}
    });

    /* The original is removed last, so a failure midway leaves the user with the text they
       had rather than with nothing. */
    if (made.length) {
      try {
        var i = m.layers.indexOf(layer);
        if (i >= 0) m.layers.splice(i, 1);
      } catch (e) {}
      changed();
    }
    return made;
  }

  function openSplitText() {
    var layer = selectedLayer();
    if (!layer) return notify('Select a text layer first');
    if (layer.type !== 'text') return notify('That is not a text layer');

    var sheet = hub() && hub().sheet;
    if (!sheet) return notify('Panels are still loading');

    sheet({
      title: 'Split Text',
      subtitle: 'Each piece becomes its own layer with the same look',
      build: function (body) {
        var note = document.createElement('p');
        note.className = 'amzNote';
        note.textContent = 'The pieces are grouped so you can still move them together. Undo puts the original back.';
        body.appendChild(note);

        [['character', 'By character'], ['word', 'By word'], ['line', 'By line']].forEach(function (mode) {
          var btn = document.createElement('button');
          btn.className = 'amzBtn';
          btn.style.display = 'block';
          btn.style.margin = '0 0 8px';
          btn.textContent = mode[1];
          btn.onclick = function () {
            var made = splitText(layer, mode[0]);
            if (!made || !made.length) return notify('Nothing to split');
            notify('Split into ' + made.length + ' layers');
          };
          body.appendChild(btn);
        });
      },
      footer: [{ label: 'Done', primary: true }],
    });
  }

  function injectStyles() {
    if (document.getElementById('amz-select-style')) return;
    var style = document.createElement('style');
    style.id = 'amz-select-style';
    style.textContent =
      '.amzKfRow{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 14px}' +
      '.amzKfRow .amzBtn{margin:0;flex:1 1 auto;min-width:62px}' +
      '.amzNum{flex:1 1 120px;min-width:0;height:38px;padding:0 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit;font:inherit;font-size:13px}';
    document.head.appendChild(style);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
  else injectStyles();

  window.omsAmzSelect = {
    openShiftKf: openShiftKf,
    openSplitText: openSplitText,
    shiftKeyframes: shiftKeyframes,
    splitText: splitText,
    countKeys: countKeys,
  };
})();
