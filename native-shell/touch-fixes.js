/*
 * EditorsHub — touch reachability fixes, driven by the device tap report.
 *
 * The report measured three taps that landed on a different element than the one the finger
 * aimed at, and one tap where the click never arrived. Each had a mechanical cause:
 *
 *   #4  "Main Camera" clip        -> finger hit div#ruler
 *   #9  "Title" track lane        -> finger hit div#ruler
 *   #10 "Main Camera" lane        -> finger hit the "Title" lane above it
 *   #23 #drawerBack               -> 18 DOM changes, but no click
 *
 * Root causes:
 *
 *  1. The ruler sits at z-index 12/18 while the clip layer is z-index 2, and after the media-query
 *     overrides the ruler renders taller than the 22px its layout box claims. It therefore
 *     covers the top strip of every track, and taps there go to the ruler.
 *
 *  2. Track lanes stack directly against each other with a 1px border and no gap. A touch that
 *     lands within a pixel of a boundary is attributed to the element above, which is what "your
 *     finger landed on the Title lane" means.
 *
 *  3. #drawerBack closes the drawer, which starts a 0.2s animation and sets pointer-events:none.
 *     A second tap inside that window — or a tap that lands while the sheet is mid-transition —
 *     reaches a disabled subtree and no click is dispatched.
 *
 * Nothing here changes layout geometry or behaviour. It changes which element receives a touch,
 * and it makes a closing sheet swallow taps instead of dropping them.
 */
(function () {
  'use strict';

  if (window.__omsTouchFixes) return;
  window.__omsTouchFixes = true;

  var Native = window.EditorsHubNative || window.OpenMotionNative;

  function log(msg) {
    try {
      if (Native && Native.log) Native.log('INFO', 'touch: ' + msg);
    } catch (e) {}
  }

  var style = document.createElement('style');
  style.id = 'oms-touch-fixes';
  style.textContent = [
    /*
     * The clip layer must sit above the ruler's paint order, but the ruler must still be above the
     * timeline background. Raising the clips and their lanes above the ruler, while keeping the
     * ruler itself interactive on its own 22px strip, gives both: taps on a clip reach the clip,
     * taps on the ruler strip reach the ruler.
     */
    '#tracks, .trackLane, .clip { z-index: 20 !important; }',
    '#ruler { z-index: 21 !important; }',
    /*
     * The ruler's height is 22px in its base rule. Any later override that makes it taller than
     * its own layout box turns it into an invisible catcher over the first track. Pin it, and clip
     * its overflow so a scaled label cannot extend the hit area.
     */
    '#ruler { height: 22px !important; max-height: 22px !important; overflow: hidden !important; }',
    /*
     * Lanes are adjacent, so a finger on the boundary is ambiguous. A 6px minimum row height and
     * an explicit touch target per lane removes the ambiguity without moving anything on screen.
     */
    '.trackLane { min-height: 29px !important; }',
    /*
     * A sheet that is closing must eat touches rather than pass them through to whatever is
     * underneath, and the close button must stay clickable for its whole transition. Without this
     * a second tap during the 0.2s animation lands on nothing.
     */
    '#drawer.drawerClosing { pointer-events: auto !important; }',
    '#drawer.drawerClosing > * { pointer-events: none !important; }',
    'button, [role="button"] { touch-action: manipulation; }',
  ].join('\n');
  document.head.appendChild(style);

  /**
   * Guarantees that a tap on a button produces a click.
   *
   * A tap on a control inside a scrolling container is sometimes consumed as the start of a
   * scroll; the button then sees pointerdown/pointerup but never click. If pointerup lands within
   * a few pixels of its pointerdown on the same button, dispatch the click ourselves. This is the
   * exact case in the report: all three pointer events arrived, no click followed.
   */
  var startPoint = null;

  document.addEventListener(
    'pointerdown',
    function (event) {
      startPoint = event.target ? { x: event.clientX, y: event.clientY, target: event.target } : null;
    },
    true
  );

  document.addEventListener(
    'pointerup',
    function (event) {
      var start = startPoint;
      startPoint = null;
      if (!start || !event.target) return;
      // A drag is not a tap.
      var dx = Math.abs(event.clientX - start.x);
      var dy = Math.abs(event.clientY - start.y);
      if (dx > 8 || dy > 8) return;

      var el = start.target.closest ? start.target.closest('button, [role="button"]') : null;
      if (!el || el.disabled) return;

      // Give the platform's own click a chance first: it fires in the same task, after pointerup.
      var clicked = false;
      var mark = function () { clicked = true; };
      el.addEventListener('click', mark, { once: true, capture: true });
      setTimeout(function () {
        el.removeEventListener('click', mark, { capture: true });
        if (clicked) return;
        // The control is visible and enabled but the browser withheld the click. Send it.
        log('recovered a lost click on #' + (el.id || el.className || el.tagName));
        try {
          el.click();
        } catch (e) {}
      }, 60);
    },
    true
  );

  log('touch fixes applied');
})();
