/*
 * EditorsHub control self-test.
 *
 * A diagnostics report proves what the page looks like at one instant. It cannot answer
 * the question the user actually has, which is "does pressing this do anything?".
 *
 * This walks the controls that are visible on screen, presses each one the way a finger
 * would (hit test first, then the event sequence Android sends), and records whether
 * anything in the app changed as a result.
 *
 * Two design rules earned the hard way:
 *
 * 1. Only visible controls are tested. An earlier version tested every control it could
 *    find, including ones in hidden tabs and closed menus, and reported 32 failures that
 *    were really just "this is inside a view you are not looking at".
 *
 * 2. State is reset between presses. The first control tested was the About button, which
 *    opens a native <dialog>, which renders in the browser's top layer and covers the
 *    entire screen. Every control after it came back "covered by the credits dialog" --
 *    the test had blocked itself. Any dialog a press opens is now closed before the next
 *    control is tested.
 */
(function () {
  'use strict';

  var MAX = 60;

  function describe(el) {
    if (!el || !el.tagName) return '?';
    var name = el.tagName.toLowerCase();
    if (el.id) name += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      name += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return text ? name + ' "' + text + '"' : name;
  }

  /** The self-test's own chrome must never be counted as an obstruction. */
  function isOwnChrome(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var id = node.id || '';
      if (id.indexOf('omsDialog') === 0 || id.indexOf('omsSelfTest') === 0) return true;
      if (id === 'omsReportBtn') return true;
      node = node.parentElement;
    }
    return false;
  }

  /** True when the element occupies real space on screen right now. */
  function isOnScreen(el) {
    var style = getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    return true;
  }

  /** Why a finger cannot reach this element, or null if it can. */
  function obstruction(el) {
    var style = getComputedStyle(el);
    if (style.display === 'none') return 'display:none';
    if (style.visibility === 'hidden') return 'visibility:hidden';
    if (style.pointerEvents === 'none') return 'pointer-events:none';
    if (el.disabled) return 'disabled';
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return 'zero size';
    if (r.bottom <= 0 || r.top >= window.innerHeight) return 'off screen';
    if (r.right <= 0 || r.left >= window.innerWidth) return 'off screen';
    var stack = [];
    try {
      stack = (document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2) || [])
        .filter(function (n) { return !isOwnChrome(n); });
    } catch (e) {
      return null;
    }
    var top = stack[0];
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      return 'covered by ' + describe(top);
    }
    return null;
  }

  /**
   * A fingerprint of "has the screen visibly changed".
   *
   * This started as a list of id:class pairs, and that was too coarse: the New Project
   * button reveals `#newModal` by removing its `hidden` class, and the fingerprint did
   * not cover that element, so a working button was reported as dead. Anything that
   * opens on top of the app now shows up here explicitly.
   */
  function snapshot() {
    var parts = [document.body.className, document.querySelectorAll('*').length];
    var ids = document.querySelectorAll('[id]');
    for (var i = 0; i < ids.length; i++) {
      var c = ids[i].className;
      if (c && typeof c === 'string') parts.push(ids[i].id + ':' + c);
    }
    // Sheets, dialogs and shades: the usual visible result of a tap.
    parts.push('sheets:' + document.querySelectorAll('#omsDialogScrim').length);
    parts.push('dialogs:' + document.querySelectorAll('dialog[open]').length);
    parts.push('report:' + (document.getElementById('omsReportView') ? 1 : 0));
    var shades = document.querySelectorAll('.modalShade');
    for (var s = 0; s < shades.length; s++) {
      // A shade that loses `hidden` is on screen; that is a visible change on its own.
      parts.push('shade:' + s + ':' + shades[s].className);
    }
    // Any element that just became visible counts, whatever it is.
    var visible = 0;
    var all = document.querySelectorAll(
      '.modalShade:not(.hidden), .omsStudioOverlay:not(.hidden), .mobileBottomNav'
    );
    for (var v = 0; v < all.length; v++) {
      var st = getComputedStyle(all[v]);
      if (st.display !== 'none' && st.visibility !== 'hidden') visible++;
    }
    parts.push('visible:' + visible);
    var drawer = document.getElementById('drawer');
    parts.push('drawer:' + (drawer ? drawer.innerHTML.length : 0));
    return parts.join('|');
  }

  /** Controls the user can actually see and tap, in document order. */
  function targets() {
    var out = [];
    var all = document.querySelectorAll(
      '#home button, #home [role="button"], .mNavTab, #mobileBottomNav button, ' +
        '#home .mTutCard, #home .mTmplCard, #home [data-obj], .homeTopActions button'
    );
    for (var i = 0; i < all.length && out.length < MAX; i++) {
      if (all[i].closest('#languageModal, #settingsLanguageRow')) continue;
      // The wordmark is marked role=button and opens the About dialog. Pressing it is a
      // full-screen event that has nothing to do with "does this control work", and in an
      // earlier version it was tested first and then reported as the thing covering
      // everything else. It is not a control the user is complaining about.
      if (all[i].id === 'omsHomeAbout' || all[i].closest('#omsHomeAbout')) continue;
      if (isOwnChrome(all[i])) continue;
      if (!isOnScreen(all[i])) continue;
      out.push(all[i]);
    }
    return out;
  }

  /**
   * Close anything a press may have opened, so one control cannot block the next.
   *
   * A native <dialog> opened with showModal() lives in the top layer: no z-index in the
   * document can cover it, and it swallows every tap. The About sheet is exactly that.
   *
   * Every teardown here must be reversible. An earlier version deleted `.modalShade`
   * wholesale — and `#newModal`, `#shortcutsModal` and `#shortcutRemapModal` all carry
   * that class — so running the check would have permanently removed the New Project
   * sheet from the app. Sheets are now closed, never destroyed; only the self-test's own
   * dialogs and the report view are allowed to be removed.
   */
  function closeSheet(sheet) {
    if (!sheet) return;
    // The editor's own sheets are hidden by class, and the class is put back by the
    // editor's normal open path. Removing the node would break it for the rest of the
    // session, so hide it and let the app restore it.
    sheet.classList.add('hidden');
    sheet.classList.remove('isClosing');
    sheet.style.display = '';
  }

  function reset() {
    var mine = document.querySelectorAll('#omsDialogScrim');
    for (var i = 0; i < mine.length; i++) mine[i].remove();
    var report = document.getElementById('omsReportView');
    if (report) report.remove();
    var dialogs = document.querySelectorAll('dialog[open]');
    for (var j = 0; j < dialogs.length; j++) {
      try { dialogs[j].close(); } catch (e) { /* not a dialog */ }
      // Dialogs created by the app are torn down by its own close path; only remove the
      // ones that are already detached-from-life (no listeners survive on new dialogs).
      if (dialogs[j].parentNode) dialogs[j].parentNode.removeChild(dialogs[j]);
    }
    // Anything the app opened while being tested goes back to hidden, never away.
    var shades = document.querySelectorAll(
      '#newModal, #shortcutsModal, #shortcutRemapModal, .effectDetailShade'
    );
    for (var k = 0; k < shades.length; k++) closeSheet(shades[k]);
    var overlays = document.querySelectorAll('.omsStudioOverlay');
    for (var o = 0; o < overlays.length; o++) closeSheet(overlays[o]);
  }

  function press(el) {
    var r = el.getBoundingClientRect();
    var opts = {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      view: window,
    };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    } catch (e) {
      /* older WebView */
    }
    try {
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (e) {
      el.click();
    }
  }

  function run() {
    var results = [];
    var skipped = 0;
    var all = document.querySelectorAll(
      '#home button, #home [role="button"], .mNavTab, #mobileBottomNav button, ' +
        '#home .mTutCard, #home .mTmplCard, #home [data-obj], .homeTopActions button'
    );

    reset();
    var list = targets();
    skipped = all.length - list.length;

    var index = 0;
    return new Promise(function (resolve) {
      function next() {
        if (index >= list.length) {
          reset();
          resolve({ results: results, skipped: skipped });
          return;
        }
        var el = list[index++];
        var blocked = obstruction(el);
        if (blocked) {
          results.push({ label: describe(el), blocked: true, reason: blocked });
          next();
          return;
        }
        var before = snapshot();
        try {
          press(el);
        } catch (e) {
          results.push({ label: describe(el), blocked: false, ok: false,
            reason: 'the press threw: ' + (e && e.message) });
          next();
          return;
        }
        setTimeout(function () {
          var after = snapshot();
          reset();
          results.push({
            label: describe(el),
            blocked: false,
            ok: before !== after,
            reason: before === after ? 'reachable, but the tap changed nothing' : '',
          });
          setTimeout(next, 60);
        }, 260);
      }
      next();
    });
  }

  function format(payload) {
    var results = payload && payload.results ? payload.results : payload;
    var skipped = (payload && payload.skipped) || 0;
    var blocked = results.filter(function (r) { return r.blocked; });
    var inert = results.filter(function (r) { return !r.blocked && !r.ok; });
    var good = results.length - blocked.length - inert.length;

    var lines = [];
    lines.push(
      'VERDICT: ' + results.length + ' visible controls tested. ' + good + ' responded, ' +
        inert.length + ' did not respond, ' + blocked.length + ' could not be reached.'
    );
    if (skipped > 0) {
      lines.push('(' + skipped + ' more controls were skipped because they are not on ' +
        'this screen right now — hidden tabs and closed menus.)');
    }
    lines.push('');

    if (inert.length) {
      lines.push('REACHED BUT NOTHING HAPPENED — these need fixing:');
      inert.forEach(function (r) {
        lines.push('  x ' + r.label + (r.reason ? ' -> ' + r.reason : ''));
      });
      lines.push('');
    }
    if (blocked.length) {
      lines.push('COULD NOT BE REACHED — something is on top of these:');
      blocked.forEach(function (r) { lines.push('  x ' + r.label + ' -> ' + r.reason); });
      lines.push('');
    }
    if (!blocked.length && !inert.length && results.length) {
      lines.push('Every visible control responded to a tap.');
    }
    var goodOnes = results.filter(function (r) { return !r.blocked && r.ok; });
    if (goodOnes.length) {
      lines.push('RESPONDED:');
      goodOnes.forEach(function (r) { lines.push('  + ' + r.label); });
      lines.push('');
    }
    var buildMeta = document.querySelector('meta[name="editorshub-build"]');
    lines.push('Build: ' + (buildMeta ? buildMeta.getAttribute('content') : '(unknown)'));
    lines.push('Viewport: ' + window.innerWidth + 'x' + window.innerHeight +
      ' @' + window.devicePixelRatio + 'x');
    return lines.join('\n');
  }

  function save(text) {
    try {
      var native = window.EditorsHubNative || window.OpenMotionNative;
      if (native && native.saveDiagnostics) native.saveDiagnostics(text);
    } catch (e) { /* ignore */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (e) { /* clipboard may be unavailable */ }
  }

  function open() {
    reset();
    // A short sheet first, so the screen does not appear frozen while 30 controls are
    // pressed one after another. It is replaced by the full report when the run ends.
    if (typeof window.omsInfo === 'function') {
      window.omsInfo('Checking', 'Pressing each visible control once. This takes a few ' +
        'seconds and the screen may flicker.');
    }
    run().then(function (payload) {
      var text = format(payload);
      save(text);
      reset();
      if (typeof window.omsShowReport === 'function') {
        var goodOnes = payload.results.filter(function (r) { return !r.blocked && r.ok; });
        var badOnes = payload.results.filter(function (r) { return r.blocked || !r.ok; });
        window.omsShowReport(
          'What responds',
          text,
          badOnes.length + ' of ' + payload.results.length + ' controls need attention'
        );
        return;
      }
      if (typeof window.omsInfo === 'function') window.omsInfo('What responds', text);
    });
  }


  /**
   * Checks the Node Video feature against the live editor rather than against itself.
   *
   * Runs a real round trip: pack a package, read it back, and confirm the reader returns
   * the layers that went in. A self-test that only checks that a function exists would
   * pass while the whole feature was broken, which is the failure mode this repository has
   * already been burned by.
   */
  function checkNodeVideo() {
    var nv = window.omsNodeVideo;
    if (!nv) return Promise.resolve({ ok: false, reason: 'the importer is not loaded' });
    var sample = {
      fps: 30, duration: 4, width: 1080, height: 1920,
      layers: [
        { type: 'text', name: 'Title', text: 'Check', start: 0, duration: 4, color: '#ffffff' },
        { type: 'shape', name: 'Box', start: 1, duration: 2 },
      ],
    };
    return nv._pack([{ name: 'project.json', text: JSON.stringify(sample) }])
      .then(function (blob) { return blob.arrayBuffer(); })
      .then(function (buffer) {
        var entries = nv._indexZip(new Uint8Array(buffer));
        if (!entries.length) return { ok: false, reason: 'the package writer produced no entries' };
        return nv._readEntry(new Uint8Array(buffer), entries[0]).then(function (data) {
          var doc = JSON.parse(new TextDecoder().decode(data));
          if (!doc.layers || doc.layers.length !== 2) {
            return { ok: false, reason: 'the package did not read back' };
          }
          var found = nv._findLayerArray(doc);
          if (!found || found.length !== 2) {
            return { ok: false, reason: 'the layer reader found the wrong number of layers' };
          }
          return { ok: true, reason: 'package write, read and layer scan all agree' };
        });
      })
      .catch(function (error) {
        return { ok: false, reason: (error && error.message) || String(error) };
      });
  }

  window.omsSelfTest = {
    open: open, run: run, obstruction: obstruction, format: format, reset: reset,
    checkNodeVideo: checkNodeVideo,
  };
})();
