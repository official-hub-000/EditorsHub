/**
 * EditorsHub look: pure black, calm surfaces, and motion.
 *
 * Three things are wrong with the inherited skin, all of them visible on a phone:
 *
 *   - `background:var(--bg)` sits at `#10121d`, so the app reads as navy rather
 *     than the black the user asked for. True AMOLED black also stops panel edges
 *     from glowing on an OLED panel.
 *   - Panels are scattered across four near-identical navies. On black they read
 *     as four different materials, so they collapse to two neutral greys and
 *     depth comes from elevation instead of hue.
 *   - Pop-ups appear by toggling `display`, with no motion, and the leftover
 *     dialogs keep the stock browser framing.
 *
 * The overrides are appended as one stylesheet at the end of `<head>`, so they
 * win the cascade without touching upstream rules. Nothing is removed and no
 * selector the app's scripts query is renamed, which is what makes this safe on
 * top of a 9 MB bundle we do not control.
 */

const AMOLED = `
/* --- AMOLED canvas ------------------------------------------------------ */
:root{
  --bg:#000000;
  --bg2:#07070a;
  --panel:#0d0d11;
  --panel2:#15151b;
  --line:#26262f;
  --home-ink:#000000;
  --home-panel:#0b0b0f;
  --home-panel-2:#131319;
  /* The mobile tab bar and its sheets run on their own token set. */
  --oms-m-bg:#000000;
  --oms-m-panel:#0b0b0f;
  --oms-m-card:#131319;
  --oms-m-card-hover:#1b1b22;
}
html,body,.app{background:#000000!important}
.home{background:#000000!important}
.home:before{opacity:.10}
.homeTop{background:rgba(0,0,0,.82)!important;border-bottom-color:#1c1c23}
.projectsWrap,.homeBody,.homeList{background:#000!important}

/* Panels: two neutrals instead of four navies. */
.modal,.modalCard,.exportSheet,.shortcutsModalCard,.amDialog,.addHubBody,
.effectDetail,.layerActionsPopup,.librarySheet,.panel,.card{
  background:#0d0d11!important;
  border-color:#242430!important;
}
.modalShade{background:rgba(0,0,0,.72)!important}
.modalHead,.shortcutsModalHead,.exportSheetHead{border-bottom-color:#202028!important}
.toast{background:#15151b!important;border-color:#2b2b36!important;color:#eef1f6!important}
`;

const MOTION = `
/* --- Motion ------------------------------------------------------------- */
@keyframes ehScrimIn{from{opacity:0}to{opacity:1}}
@keyframes ehScrimOut{from{opacity:1}to{opacity:0}}
@keyframes ehSheetIn{
  from{opacity:0;transform:translateY(22px) scale(.965)}
  to{opacity:1;transform:none}
}
@keyframes ehFadeIn{from{opacity:0}to{opacity:1}}

/* Every pop-up surface: one entry curve, so the app feels like one thing. */
.modal,.exportSheet,.shortcutsModalCard,.amDialog,.layerActionsPopup,
.addHubBody,.effectDetail{
  animation:ehSheetIn .26s cubic-bezier(.2,.85,.3,1) both;
}
.modalShade{animation:ehScrimIn .2s ease both}

/* Closing is driven by the app's own class, so it stays in sync with teardown. */
.modal.isClosing,.exportSheet.isClosing{
  animation:ehScrimOut .16s ease both!important;
}

/* Native <dialog> pop-ups (AM link import, colour picker...). */
dialog[open]{
  animation:ehSheetIn .26s cubic-bezier(.2,.85,.3,1) both;
}
dialog::backdrop{animation:ehScrimIn .2s ease both;background:rgba(0,0,0,.72)}
dialog{background:#0d0d11;color:#eaeef5;border:1px solid #242430;border-radius:16px}

/* Lists and grids settle instead of snapping when content is swapped. */
.homeTab{transition:background .18s ease,color .18s ease,transform .18s ease}
.homeTab:active{transform:scale(.96)}
.projectCard,.templateCard,.addHubItem,.libraryItem{
  animation:ehFadeIn .22s ease both;
  transition:transform .16s ease,box-shadow .16s ease;
}
/* Press feedback via brightness, not transform: many editor buttons are already
   positioned or rotated with transform, and scaling them would fight that.
   It also avoids promoting a compositing layer for every button on a phone. */
button,.rightBtn,.leftBtn{transition:filter .12s ease,background .15s ease,opacity .15s ease}
button:active{filter:brightness(1.28)}
#omsDialogActions button:active,.homeTab:active{filter:none;transform:scale(.97)}

/* Respect the system switch. */
@media (prefers-reduced-motion:reduce){
  .modal,.exportSheet,.shortcutsModalCard,.amDialog,.layerActionsPopup,
  .addHubBody,.effectDetail,dialog[open],dialog::backdrop,.projectCard,
  .templateCard,.addHubItem,.libraryItem{animation:none!important;transition:none!important}
}
`;

/** Appends the theme stylesheet once, immediately before `</head>`. */
export function applyTheme(html) {
  return html.replace('</head>', `<style id="editorshub-theme">${AMOLED}${MOTION}</style>\n</head>`);
}

/**
 * Replaces the borrowed splash artwork with the EditorsHub lockup and the
 * opening animation that goes with it.
 *
 * The upstream splash is a 138 KB base64 WebP of a borrowed `M` wordmark on a
 * navy field, decoded synchronously during the busiest moment of startup. It is
 * replaced with about 1 KB of inline SVG: the mark rises and fades in, the
 * wordmark follows, then the progress track takes over. The element ids the
 * splash driver script writes to (`#omsSplashStatus`, `#omsSplashTrack`,
 * `#omsSplashFill`, `#omsSplashPercent`, `#omsSplashError`) are untouched, so the
 * driver keeps working.
 */
export function replaceSplash(splashSvg) {
  return (html) => {
    let out = html;

    // 1. Swap the bitmap for the vector lockup, keeping the node the CSS targets.
    out = out.replace(/<img[^>]*class="splashImage"[^>]*>/, splashSvg);

    // 2. Re-skin the splash screen itself.
    const css = `
.appSplashScreen{background:#000!important}
.splashContainer{gap:28px!important}
.ehSplashLockup{display:flex;flex-direction:column;align-items:center;gap:10px}
.ehSplashMark{
  animation:ehMarkIn .62s cubic-bezier(.2,.85,.3,1) both;
  filter:drop-shadow(0 0 34px rgba(86,207,191,.28));
}
.ehSplashWord{
  font:800 30px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;color:#fff;
  animation:ehWordIn .5s cubic-bezier(.2,.85,.3,1) .16s both;
}
.ehSplashWord span{color:#56cfbf}
.ehSplashTag{
  font:700 8px/1 Inter,system-ui,sans-serif;letter-spacing:.34em;color:#5d6b7a;
  animation:ehWordIn .5s cubic-bezier(.2,.85,.3,1) .26s both;
}
.omsSplashProgress{color:#8994a6!important}
.omsSplashTrack{background:#16161c!important;height:3px!important}
#omsSplashFill{background:linear-gradient(90deg,#56cfbf,#2e6bff)!important}
.iosSpinner{opacity:.75}
@keyframes ehMarkIn{
  0%{opacity:0;transform:translateY(16px) scale(.86)}
  60%{opacity:1}
  100%{opacity:1;transform:none}
}
@keyframes ehWordIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .ehSplashMark,.ehSplashWord,.ehSplashTag{animation:none!important}
}`;
    out = out.replace('</style>', css + '\n</style>');
    return out;
  };
}

/** Swaps the header mark for the same logo, so the two cannot drift apart. */
export function replaceHeaderMark(headerSvg) {
  return (html) => html.replace(/(<span class="homeMark"[^>]*>)[\s\S]*?(<\/span>)/, `$1${headerSvg}$2`);
}

/**
 * Raises the floor on the tiny type the inherited skin uses everywhere.
 *
 * 311 declarations in the bundled stylesheet set 5.5-9px. On a ~400dpi phone that is
 * genuinely unreadable, which is why the complaint was "the text is far too small".
 * Rewriting them by hand is not viable and would rot against the upstream file, so the
 * sizes are recomputed mechanically: anything at or below 9px is scaled up by 25% and
 * clamped into 10-11px.
 *
 * Only the number after `font-size:` changes. Selectors, colours, spacing and every
 * structural value stay exactly as the editor wrote them, so nothing is renamed, no rule
 * is dropped, and no selector loses specificity.
 */
const TINY = 9;

export function enlargeTinyText(html) {
  let bumped = 0;
  const out = html.replace(/font-size:\s*(\d*\.?\d+)px/g, (decl, size) => {
    const value = parseFloat(size);
    if (!(value <= TINY)) return decl;
    const next = Math.min(11, Math.max(10, value * 1.25));
    bumped += 1;
    return `font-size:${Math.round(next * 2) / 2}px`;
  });
  console.log(`  tiny type ${bumped} declarations raised to a 10px floor`);
  return out;
}

/**
 * Kills the 300 ms tap delay.
 *
 * Chromium holds a tap for ~300 ms before firing `click` unless it is told the page
 * does not need double-tap-to-zoom. With the delay in place every control in the app
 * feels broken: you tap, nothing happens for a third of a second, so you tap again and
 * the second tap lands somewhere else. It also makes the whole UI read as "laggy" even
 * when the processor is idle.
 *
 * `touch-action: manipulation` is the platform's documented opt-out. It is applied to
 * the leaf controls only, never to containers: containers that pan or zoom (viewport,
 * timeline, canvas) must keep their own touch handling, and a broad rule would break
 * dragging.
 */
export function removeTapDelay(html) {
  const css = `
/* --- Tap responsiveness ------------------------------------------------- */
/* Chromium waits ~300ms after a tap before firing click unless the page opts out.
   Without this every control feels dead and a second tap lands elsewhere. */
button,input,select,textarea,label,summary,a[href],[role="button"],[role="tab"],
[role="menuitem"],[role="option"],.insBtn,.homeTab,.mNavTab,.amMenuRow{
  touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;
}
/* Range/colour/scrub controls need their own gesture handling. */
input[type="range"],input[type="color"],.trim,.playhead,.ruler,.zoomTrack{
  touch-action:none;
}`;
  return html.replace('</head>', `<style id="editorshub-touch">${css}</style>\n</head>`);
}

/**
 * Moves the embedded graph textures out of the document.
 *
 * Six `<script type="text/plain">` blocks hold 2.82 MB of base64 WebP (bump maps and
 * grunge overlays for the Alight-Motion-graph effects). They are not inlined for
 * performance: the upstream file embeds them so the bundle is one file. Inside the APK
 * that is pure cost — the WebView has to read, decode and hold 2.82 MB of base64 (about
 * 2.1 MB of raw image) as part of the document before the editor can start, on a device
 * that then has to keep the whole 9.1 MB document alive.
 *
 * The images are written to `www/res252/` and the document keeps only a URL. The lookup
 * is already lazy — `oms-res252-N` is read through a getter the first time an effect
 * needs the texture — so redirecting it to a file keeps the lazy behaviour and simply
 * stops paying for the payload up front.
 *
 * `assets` is a `{id: dataUri}` map; the caller writes the files.
 */
export function externaliseGraphTextures() {
  return (html) => {
    const assets = new Map();
    const pattern = /<script type="text\/plain" id="(oms-res252-\d)">(data:[^<]+)<\/script>/g;
    let out = html.replace(pattern, (match, id, uri) => {
      const extension = /image\/webp/.test(uri) ? 'webp' : 'bin';
      assets.set(id, { uri, file: `${id}.${extension}` });
      return `<script type="text/plain" id="${id}" data-src="./res252/${id}.${extension}"></script>`;
    });

    // The getter reads `textContent`; read the file URL instead when the payload is gone.
    const getter =
      "const el=document.getElementById(m.id);cache=el?(el.textContent.trim()||el.dataset.src||''):'';";
    if (out.includes("const el=document.getElementById(m.id);cache=el?el.textContent.trim():'';")) {
      out = out.replace("const el=document.getElementById(m.id);cache=el?el.textContent.trim():'';", getter);
    } else {
      console.warn('! externaliseGraphTextures: getter not found');
    }
    console.log(`  textures    ${assets.size} moved out of the document`);
    return { html: out, assets };
  };
}
