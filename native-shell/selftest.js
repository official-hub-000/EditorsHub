/*
 * EditorsHub control self-test.
 *
 * A diagnostics report proves what the page looks like at one instant. It cannot answer
 * the question the user actually has, which is "does pressing this do anything?".
 *
 * This walks the controls on screen, presses each one the way a finger would (hit test
 * first, then the event sequence Android sends), and records whether anything in the app
 * changed as a result. A control that cannot be reached is reported with the reason it is
 * blocked; a control that is reachable but changes nothing is reported separately, because
 * those are two different faults with two different fixes.
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

  /** The self-test's own dialog must never be counted as an obstruction. */
  function isOwnChrome(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var id = node.id || '';
      if (id.indexOf('omsDialog') === 0 || id.indexOf('omsSelfTest') === 0) return true;
      node = node.parentElement;
    }
    return false;
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
    if (r.bottom < 0 || r.top > window.innerHeight) return 'off screen';
    if (r.right < 0 || r.left > window.innerWidth) return 'off screen';
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

  /** A cheap fingerprint: unchanged means the tap had no observable effect. */
  function snapshot() {
    var parts = [document.body.className, document.querySelectorAll('*').length];
    var ids = document.querySelectorAll('[id]');
    for (var i = 0; i < ids.length; i++) {
      var c = ids[i].className;
      if (c && typeof c === 'string') parts.push(ids[i].id + ':' + c);
    }
    var drawer = document.getElementById('drawer');
    parts.push('drawer:' + (drawer ? drawer.innerHTML.length : 0));
    return parts.join('|');
  }

  function targets() {
    var out = [];
    var all = document.querySelectorAll(
      '#home button, #home [role="button"], .mNavTab, #mobileBottomNav button, ' +
        '#home .mTutCard, #home .mTmplCard, #home [data-obj], .homeTopActions button'
    );
    for (var i = 0; i < all.length && out.length < MAX; i++) {
      // Hidden by design, not broken.
      if (all[i].closest('#languageModal, #settingsLanguageRow')) continue;
      if (isOwnChrome(all[i])) continue;
      out.push(all[i]);
    }
    return out;
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

  function closeSheets() {
    var sheets = document.querySelectorAll('#omsDialogScrim');
    for (var i = 0; i < sheets.length; i++) sheets[i].remove();
  }

  function run() {
    var results = [];
    var list = targets();
    var index = 0;

    return new Promise(function (resolve) {
      function next() {
        if (index >= list.length) {
          closeSheets();
          resolve(results);
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
        press(el);
        setTimeout(function () {
          var after = snapshot();
          closeSheets();
          results.push({
            label: describe(el),
            blocked: false,
            ok: before !== after,
            reason: before === after ? 'reachable, but the tap changed nothing' : '',
          });
          setTimeout(next, 30);
        }, 90);
      }
      next();
    });
  }

  function format(results) {
    var blocked = results.filter(function (r) { return r.blocked; });
    var inert = results.filter(function (r) { return !r.blocked && !r.ok; });
    var good = results.length - blocked.length - inert.length;

    var lines = [];
    lines.push(
      'VERDICT: ' + results.length + ' controls tested. ' + good + ' responded, ' +
        inert.length + ' did not respond, ' + blocked.length + ' could not be reached.'
    );
    lines.push('');

    if (blocked.length) {
      lines.push('COULD NOT BE REACHED — something is on top of these:');
      blocked.forEach(function (r) { lines.push('  x ' + r.label + ' -> ' + r.reason); });
      lines.push('');
    }
    if (inert.length) {
      lines.push('REACHED BUT NOTHING HAPPENED — these need wiring, not unblocking:');
      inert.forEach(function (r) { lines.push('  x ' + r.label); });
      lines.push('');
    }
    if (!blocked.length && !inert.length) {
      lines.push('Every control on this screen responded to a tap.');
    }
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
    if (typeof window.omsInfo !== 'function') return;
    run().then(function (results) {
      var text = format(results);
      save(text);
      window.omsInfo('What responds', text);
    });
  }

  window.omsSelfTest = { open: open, run: run, obstruction: obstruction, format: format };
})();
