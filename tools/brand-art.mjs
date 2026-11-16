/**
 * The EditorsHub mark and the opening animation, drawn as inline SVG.
 *
 * `tools/render-icons.py` draws the launcher from the same four rectangles and
 * the same teal-to-blue ramp, so the icon on the home screen, the mark in the
 * header and the splash all show one logo. Geometry is unit-space, matching the
 * Python renderer bar for bar; keeping them in one place would be nicer, but the
 * launcher has to be a PNG and this has to be inline SVG, so the shared truth is
 * the four rectangles below.
 */

/** `E` bars in unit space, plus the chamfer on the two outer arm tips. */
export const MARK_BARS = [
  [0.24, 0.22, 0.4, 0.78], // stem
  [0.4, 0.22, 0.72, 0.38], // top arm
  [0.4, 0.42, 0.62, 0.58], // middle arm
  [0.4, 0.62, 0.72, 0.78], // bottom arm
];

const TEAL = '#56cfbf';
const BLUE = '#2e6bff';

/**
 * The mark as an SVG string.
 *
 * `idSuffix` keeps gradient ids unique: the markup is injected twice (header and
 * splash) and duplicate ids make the second copy borrow the first one's fill.
 */
export function markSvg(idSuffix = 'a', size = 64) {
  const gid = `ehMark-${idSuffix}`;
  // The chamfer is cut with a mask so the arms stay one solid shape rather than
  // three rectangles that meet at a hairline seam.
  const rects = MARK_BARS.map(
    ([l, t, r, b]) =>
      `<rect x="${l}" y="${t}" width="${(r - l).toFixed(4)}" height="${(b - t).toFixed(4)}"/>`
  ).join('');
  return `<svg viewBox="0 0 1 1" width="${size}" height="${size}" role="img" aria-label="EditorsHub" focusable="false">
<defs>
<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${BLUE}"/>
</linearGradient>
<mask id="${gid}-cut">
<rect x="0" y="0" width="1" height="1" fill="#fff"/>
<polygon points="0.72,0.22 0.82,0.22 0.72,0.38" fill="#000"/>
<polygon points="0.72,0.62 0.82,0.62 0.72,0.78" fill="#000"/>
</mask>
</defs>
<g fill="url(#${gid})" mask="url(#${gid}-cut)">${rects}</g>
</svg>`;
}

/** The splash lockup: mark, wordmark, and a progress track that fills. */
export function splashMarkup() {
  return `<div class="ehSplashLockup">
  <div class="ehSplashMark">${markSvg('splash', 116)}</div>
  <div class="ehSplashWord">Editors<span>Hub</span></div>
  <div class="ehSplashTag">OFFICIAL HUB ENGINE</div>
</div>`;
}
