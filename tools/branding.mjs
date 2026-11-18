#!/usr/bin/env node
/*
 * EditorsHub rebrand + single-credit + English-only patch for the vendored document.
 *
 * `web/index.html` stays byte-identical to upstream so new revisions can be pulled in
 * without merge conflicts; everything below is applied at build time, after the
 * translation patch (see tools/i18n/build-edits.py) and before the Android shell tags.
 *
 *  1. `rebrand()`     — the app calls itself EditorsHub everywhere a user can see it
 *                       (title bar, splash screen, home wordmark, PWA metadata, runtime
 *                       messages). Licence notices and references to the upstream engine
 *                       and its file formats keep the upstream name: they are provenance
 *                       and format identifiers, not branding.
 *  2. `singleCredit()` — the upstream credits dialog lists 11 libraries, models and
 *                       reference projects. Its *data* is replaced by one "Official Hub"
 *                       entry; the renderer, styling and accessibility wiring are left
 *                       untouched, so nothing in the UI becomes dead.
 *  3. `forceEnglish()` — the UI is English-only: `homeLanguage` is pinned to `en`, the
 *                       stored `oms_language` preference is ignored (so every runtime
 *                       `isId` ternary resolves to English) and the language switcher is
 *                       hidden.
 */
import { readFile, writeFile } from 'node:fs/promises';

export const APP_NAME = 'EditorsHub';
export const APP_CREDIT = 'Official Hub';

/**
 * Mentions of the upstream name that must survive: licence text, copyright lines and the
 * names of the engine, formats and interchange files the app reads and writes.
 */
const PRESERVED_TERMS = [
  'Open Motion 3D Camera Tracker',
  'Open Motion engine',
  'Open Motion project',
  'Open Motion package',
  'Open Motion ZIP',
  'Open Motion resolver',
  'Open Motion XML',
  'Open Motion text preset',
  'Open Motion Scene',
  'Open Motion Studio',
  'Open Motion Home',
  'Open Motion / iOS',
  'Open Motion ber-',
  'native Open Motion',
  'Copyright (c) 2026 Hada45',
];

/** Static markup anchors that must carry the new name. */
const MARKUP_ANCHORS = [
  [/<title>[^<]*<\/title>/, `<title>${APP_NAME}</title>`],
  [/(<meta name="application-name" content=")[^"]*(")/, `$1${APP_NAME}$2`],
  [/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${APP_NAME}$2`],
  [/(<div class="homeWordmark"><b>)[^<]*(<\/b>)/, `$1${APP_NAME}$2`],
  [/(<div class="homeBrand" aria-label=")[^"]*(")/, `$1${APP_NAME}$2`],
  [/(<img src="data:image\/webp;base64,[^"]+" alt=")[^"]*(" class="splashImage")/, `$1${APP_NAME}$2`],
  [/(<div id="omsSplashStatus">)[^<]*(<\/div>)/, `$1Starting ${APP_NAME}...$2`],
];

/** True when `text` sits inside a licence/attribution block that must stay verbatim. */
function insideNotice(html, index) {
  const before = html.slice(Math.max(0, index - 4000), index);
  // The bundled third-party licence text lives in one <script type="text/plain"> block.
  const lastOpen = before.lastIndexOf('<script');
  const lastClose = before.lastIndexOf('</script>');
  if (lastOpen > lastClose) {
    const tag = before.slice(lastOpen, before.indexOf('>', lastOpen) + 1);
    if (/type="text\/plain"|licens|notice/i.test(tag)) return true;
  }
  return /MIT License|Copyright \(c\)/i.test(html.slice(Math.max(0, index - 200), index));
}

/** Rewrites the visible name, leaving preserved terms and notices untouched. */
export function rebrand(html) {
  let out = html;
  for (const [re, replacement] of MARKUP_ANCHORS) {
    if (!re.test(out)) throw new Error(`branding: anchor missing: ${re}`);
    out = out.replace(re, replacement);
  }

  // Prose rename, from the end of the file so offsets stay valid while splicing.
  const hits = [];
  const pattern = /Open Motion/g;
  let match;
  while ((match = pattern.exec(out)) !== null) {
    const before = out.slice(Math.max(0, match.index - 24), match.index);
    const after = out.slice(match.index, match.index + 48);
    if (PRESERVED_TERMS.some((term) => after.startsWith(term))) continue;
    if (/Open Motion's/.test(after)) continue; // possessive refers to upstream styling
    if (insideNotice(out, match.index)) continue;
    hits.push(match.index);
  }
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const at = hits[i];
    out = out.slice(0, at) + APP_NAME + out.slice(at + 'Open Motion'.length);
  }
  return { html: out, renamed: hits.length };
}

/** Replaces the credits payload with a single "Official Hub" credit. */
export function singleCredit(html) {
  const marker = 'const OMSCreditsData20261026=';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('credits: credits payload not found');
  let cursor = start + marker.length;
  let depth = 0;
  for (; cursor < html.length; cursor += 1) {
    const ch = html[cursor];
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('credits: unbalanced credits payload');
  const payload = {
    groups: [{ id: 'credit', idLabel: 'Kredit', en: 'Credit' }],
    items: [
      {
        id: 'officialhub',
        group: 'credit',
        name: APP_CREDIT,
        license: 'All rights reserved',
        scope: `Seluruh kredit aplikasi ${APP_NAME} dipersembahkan untuk ${APP_CREDIT}.`,
        en: `All credit for ${APP_NAME} belongs to ${APP_CREDIT}.`,
        links: [],
      },
    ],
    notices: {},
  };
  return `${html.slice(0, start)}${marker}${JSON.stringify(payload)}${html.slice(cursor + 1)}`;
}

/** Pins the UI language to English and removes the language switcher. */
export function forceEnglish(html) {
  const bootstrap =
    /let homeLanguage=\(\(\)=>\{[\s\S]{0,220}?\}\)\(\);\nif\(!HOME_I18N\[homeLanguage\]\)homeLanguage=detectSystemHomeLanguage\(\);/;
  if (!bootstrap.test(html)) throw new Error('language: homeLanguage bootstrap not found');
  let out = html.replace(bootstrap, "let homeLanguage='en';");

  const setter = /function setHomeLanguage\(id\)\{\s*if\(!HOME_I18N\[id\]\)return;\s*homeLanguage=id;/;
  if (!setter.test(out)) throw new Error('language: setHomeLanguage not found');
  out = out.replace(setter, "function setHomeLanguage(id){\n  homeLanguage='en';");

  // The switcher is hidden, never removed. Deleting the element looked cleaner but broke
  // startup: the editor binds `$('#homeLanguageBtn').onclick = ...` in a long block of
  // direct assignments, and a null there threw `Cannot set properties of null` at 5% load,
  // which stopped every binding after it and left the app on the splash screen.
  //
  // Hiding it needs `!important` and a selector that outranks the skin rule
  // `.simpleHome .languageBtn{display:inline-flex!important}`: that rule is a class
  // selector, so it ties on !important and loses only to a more specific one. The app root
  // id plus the element id plus the class is enough.
  out = out.replace(
    '</style>',
    'html body #home .homeTopActions #homeLanguageBtn.languageBtn,' +
      '#languageQuickBtn,#settingsLanguageRow,#languageModal{display:none!important}\n</style>'
  );

  // Belt and braces: the picker must never open, whatever reaches it.
  const openModal =
    /function openLanguageModal\([^)]*\)\{/;
  if (openModal.test(out)) {
    out = out.replace(openModal, (match) => match + '\n  return;');
  }

  return out;
}

/**
 * Routes the two `confirm()` call sites through the themed in-app dialog.
 *
 * Both live inside `async` functions, so they can `await`. Leaving them on the
 * native dialog shows the platform's grey "The page at
 * https://appassets.androidplatform.net says:" box, which reads as a browser
 * warning rather than part of the app.
 *
 * The fallback keeps the native dialog whenever the shim is unavailable, so the
 * delete flow can never silently proceed.
 */
export function themeConfirms(html) {
  let out = html;

  const projectDelete = 'if(!confirm(msg))return;';
  if (out.includes(projectDelete)) {
    out = out.replace(
      projectDelete,
      'if(!(await omsConfirm(msg,{acceptLabel:"Delete",cancelLabel:"Keep"})))return;'
    );
  }

  // The whole `!confirm('…')` expression is rewritten so the extra parenthesis
  // that `(await …)` needs is balanced. The message itself is copied verbatim.
  out = out.replace(/!confirm\(('(?:[^'\\]|\\.)*')\)/g, '!(await omsConfirm($1))');

  return out;
}

/**
 * Last-pass fixes for strings the dictionary scan cannot reach.
 *
 * These are values computed at runtime rather than markup text or plain literals,
 * so `edits.json` never saw them: ternaries that pick a label, a template string
 * built from a user-editable name, and one effect-category table where the keys
 * are the identifiers used to look values up (so only the *values* may change).
 */
export function finishEnglish(html) {
  let out = html;
  const pairs = [
    // Style sheet's add button.
    ["tab==='border'?'+ Tambah Border':shadow?'Shadow is already available':'+ Tambah Shadow'",
     "tab==='border'?'+ Add Border':shadow?'Shadow is already available':'+ Add Shadow'"],
    // Keyframe toggle.
    ["keyed?'◇ Remove Keyframe':'◇ Tambah Keyframe'",
     "keyed?'◇ Remove Keyframe':'◇ Add Keyframe'"],
    // Spectrum analyser status line.
    ["return 'Menganalysis audio…'", "return 'Analysing audio…'"],
    // Default name for a new project.
    ["input.value.trim() || 'Tanpa judul'", "input.value.trim() || 'Untitled'"],
    ["toast(`Nama proyek: ${newName}`)", "toast(`Project name: ${newName}`)"],
    // Third-party resolver name shown in the AM import dialog. The `value` stays
    // `zervida` — that is the protocol identifier — only the label changes.
    ["replace(/zervida/gi,'API pihak ketiga')", "replace(/zervida/gi,'Third-party API')"],
    ['<option value="zervida">API pihak ketiga</option>',
     '<option value="zervida">Third-party API</option>'],
    ["{id:'zervida',label:'API pihak ketiga'", "{id:'zervida',label:'Third-party API'"],
    // Effect categories: keys stay, labels are shown.
    ["Semua:'All',Populer:'Populer',Simulasi:'Simulasi',Distorsi:'Distortion',Warna:'Color',Gerak:'Motion',Stilisasi:'Stilisasi',Blur:'Blur',Generator:'Generator'",
     "Semua:'All',Populer:'Popular',Simulasi:'Simulation',Distorsi:'Distortion',Warna:'Color',Gerak:'Motion',Stilisasi:'Stylise',Blur:'Blur',Generator:'Generator'"],
  ];
  for (const [from, to] of pairs) {
    if (!out.includes(from)) {
      console.warn(`! finishEnglish: pattern not found — ${from.slice(0, 48)}`);
      continue;
    }
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Turns the tutorial cards' `alert()` into the app's own sheet.
 *
 * Tapping a tutorial card opened the platform's single-paragraph text box, prefixed
 * with a literal `=== Title ===` header — the one the screenshots show. The dialog
 * renders `\n` properly, so the numbered steps read as steps.
 */
export function fixTutorialCards(html) {
  const from = "alert('=== ' + tut.title + ' ===\\n\\n' + tut.body);";
  const to =
    "if (typeof window.omsInfo === 'function') { window.omsInfo(tut.title, tut.body); } " +
    "else { alert(tut.title + '\\n\\n' + tut.body); }";
  if (!html.includes(from)) {
    console.warn('! fixTutorialCards: pattern not found');
    return html;
  }
  return html.replace(from, to);
}

export async function patchBranding(indexPath) {
  const html = await readFile(indexPath, 'utf8');
  const { html: renamed, renamed: count } = rebrand(html);
  const out = addMoreTools(
    addEaseAccess(
    addQualityAndTapFixes(
      addResizeGuard(
      addGpuContextTuning(
      addPreviewScale(
        addPlayheadThrottle(
          addNodeVideoImport(
            addLutPaintHook(
              addLutEffectSpec(
                hardenNewProjectButton(
                  addElementsDrawerTab(
                    fixNewProjectSeg(
                      fixDetachedGlobals(
                        fixElementCard(
                          fixTemplateButtons(
                            fixTutorialCards(
                              finishEnglish(
                                themeConfirms(forceEnglish(singleCredit(renamed)))
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
      )
      )
      )
    )
  );
  await writeFile(indexPath, out, 'utf8');
  return { html: out, renamed: count };
}

/**
 * Makes the New Project button recoverable.
 *
 * `openNewProjectModal` hides the floating button as it opens:
 *
 *     modal.classList.remove('hidden');
 *     homeFab.style.display='none';
 *     homeFab.style.pointerEvents='none';
 *
 * Only the close path puts it back, and the close path is driven by a 190 ms
 * `setTimeout`. If anything in between fails — an exception while the sheet builds its
 * resolution list, a sheet closed by a route that does not run `closeNewProjectModal` —
 * the composer opens with no visible way to reach it again, and the button stays hidden
 * for the rest of the session. That reads as "the New Project button stopped working".
 *
 * The fix keeps the same behaviour but makes the state self-healing: the button is
 * re-shown whenever the modal is not on screen, whatever path got us there.
 */
export function hardenNewProjectButton(html) {
  const from = `homeFab.ontouchend=openNewProjectModal;`;
  const to = `homeFab.ontouchend=openNewProjectModal;

  // Self-healing visibility: whatever closes the sheet, the button comes back.
  (function watchNewProjectButton(){
    const fab=document.getElementById('newProjectFab');
    const modal=document.getElementById('newModal');
    if(!fab||!modal)return;
    const sync=()=>{
      const open=!modal.classList.contains('hidden');
      if(open){fab.style.display='none';fab.style.pointerEvents='none';}
      else if(fab.style.display==='none'){fab.style.display='';fab.style.pointerEvents='auto';}
    };
    try{new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});}catch(e){}
    sync();
  })();`;
  if (!html.includes(from)) {
    console.warn('! hardenNewProjectButton: pattern not found');
    return html;
  }
  return html.replace(from, to);
}

/**
 * Repairs the one-tap template buttons on the Template tab.
 *
 * On a fresh install no project is open, so `useTemplate` takes its "create a fresh
 * project first" branch, which calls:
 *
 *     model.createProject({ name, width, height, fps, background })
 *
 * There is no `Model.prototype.createProject`. Project creation is a global
 * `createProject()` driven by the New Project form, and the model exposes
 * `defaultProject(name, ratio, res, fps, duration, bg, customSize)` plus `reset()`.
 * The call therefore throws, the `catch` swallows it, and the fallback opens the New
 * Project sheet. The user taps "Use Template" on a template card and gets the composer
 * instead of the template -- which reads as the button being broken.
 *
 * The replacement builds the project the same way `createProject()` does, then applies
 * the template. Both calls already exist; nothing new is introduced.
 */
export function fixTemplateButtons(html) {
  const from = `              model.createProject({
                name: 'Project ' + tmplName.toUpperCase(),
                width: 1080,
                height: 1920,
                fps: 30,
                background: '#000000'
              });
              ui.authorizeEditorOpen?.();
              ui.showEditor();
              setTimeout(() => {
                ui.applyTemplate(tmplName);
                if (typeof toast === 'function') toast('Template applied');
              }, 100);`;
  const to = `              // No Model#createProject exists; build the project the way the New Project
              // sheet does, then apply the template to it.
              model.reset();
              model.project = model.defaultProject(
                'Project ' + tmplName.toUpperCase(), '9:16', 1080, 30, 10, '#000000', null
              );
              model.resetEditorCamera();
              model.mode3d = false;
              model.cameraView = true;
              try { renderer.resize(); } catch (e) {}
              // This block has no access to the editor's HistoryManager, so the bare
              // identifier resolves to window.history -- the browser's -- which has
              // neither clear() nor push(). Both calls threw and the template never
              // applied. Go through the global the build exposes instead.
              try { window.__omsHistory && window.__omsHistory.clear(); } catch (e) {}
              ui.authorizeEditorOpen?.();
              ui.showEditor();
              try { window.__omsHistory && window.__omsHistory.push(); } catch (e) {}
              setTimeout(() => {
                ui.applyTemplate(tmplName);
                if (typeof toast === 'function') toast('Template applied');
              }, 100);`;
  if (!html.includes(from)) {
    console.warn('! fixTemplateButtons: pattern not found');
    return html;
  }
  return html.replace(from, to);
}

/**
 * Makes the "Elements" object card say what it does.
 *
 * Under Elements there is a card labelled "Elements" (title "Elements & Projects",
 * `data-obj="element"`). Tapping it runs `this.openTool('templates')` -- it silently
 * switches to the Template tab and adds nothing. From the user's side the button did
 * nothing at all, because the content that replaced it is a different grid.
 *
 * The honest behaviour is to hand off to the template picker deliberately and say so,
 * rather than looking like a dead button that happens to relabel itself.
 */
export function fixElementCard(html) {
  const from = `else if(o==='element'){this.openTool('templates');return}`;
  const to =
    `else if(o==='element'){` +
    `this.openTool('templates');` +
    `if(typeof toast==='function')toast('Templates are on the Template tab');` +
    `return}`;
  if (!html.includes(from)) {
    console.warn('! fixElementCard: pattern not found');
    return html;
  }
  return html.replace(from, to);
}

/**
 * Publishes the editor's core objects so detached scripts can reach them.
 *
 * The document is a series of independent `<script>` blocks, each in its own IIFE. A few
 * of them -- the layer toolbar, the Alight Motion parity menu, the mobile overhaul
 * wrapper -- are written as if they shared the editor's scope: they call
 * `history.push()`, `timeline.rebuild()`, `renderer.resize()` and `bus.on()` on bare
 * identifiers that only exist inside the editor block.
 *
 * In those blocks the bare names resolve to something else or to nothing:
 *
 *   history.push()      -> window.history.push, which does not exist (throws)
 *   timeline.rebuild()  -> ReferenceError (swallowed by a try/catch)
 *   renderer.resize()   -> ReferenceError (swallowed by a try/catch)
 *   bus.on(...)         -> ReferenceError (swallowed by a try/catch)
 *
 * The last three are the dangerous ones: they are wrapped in `try {} catch {}`, so a
 * broken control looks exactly like a working one that had nothing to do. That is how
 * the layer toolbar's delete button, the parity action menu and the template buttons all
 * survived every check that only asked "is it wired?".
 *
 * The repair is deliberately small: publish the four objects on `window` next to the
 * existing `window.model` / `window.ui`, then point the detached call sites at them.
 * No behaviour changes in the editor's own scope.
 */
export function fixDetachedGlobals(html) {
  const decls = [
    ["const history=new HistoryManager(model);", "history"],
    ["const renderer=new WebGLRenderer(model,$('#stage'));", "renderer"],
    ["const timeline=new TimelineController(model);", "timeline"],
    ["const bus=new EventBus();", "bus"],
    ["const ui=new UIController()", "ui"],
  ];
  let out = html;
  for (const [decl, name] of decls) {
    const globalName = name === 'history' ? '__omsHistory' : '__oms' + name.charAt(0).toUpperCase() + name.slice(1);
    if (out.includes(decl) && !out.includes('window.' + globalName + '=')) {
      out = out.replace(
        decl,
        decl + `\nwindow.${globalName}=${name};`
      );
    } else if (!out.includes(decl)) {
      console.warn(`! fixDetachedGlobals: ${name} declaration not found`);
    }
  }

  // Point the detached blocks at the published globals.
  const blocks = ['oms-layer-header-v250-script', 'am-parity-action-menu-script',
    'oms-mobile-device-overhaul-script'];
  for (const id of blocks) {
    const at = out.indexOf('id="' + id + '"');
    if (at === -1) continue;
    const end = out.indexOf('</script>', at);
    if (end === -1) continue;
    let body = out.slice(at, end);
    if (re_hasDecl(body)) continue;
    body = body
      .replace(/\bhistory\.(push|undo|redo|clear)\(\)/g,
        '(window.__omsHistory&&window.__omsHistory.$1())')
      .replace(/(?:window\.timeline\?\.rebuild\s*&&\s*)?\btimeline\.rebuild\(\)/g,
        'window.__omsTimeline&&window.__omsTimeline.rebuild()')
      .replace(/\brenderer\.resize\?\.\(\)|\brenderer\.resize\(\)/g,
        'window.__omsRenderer&&window.__omsRenderer.resize()')
      .replace(/\bbus\.on\(/g, 'window.__omsBus&&window.__omsBus.on(');
    out = out.slice(0, at) + body + out.slice(end);
  }
  return out;
}

function re_hasDecl(body) {
  return /(?:const|let|var)\s+(?:history|timeline|renderer|bus)\s*=/.test(body);
}

/**
 * Repairs the layer-bar rename and delete buttons.
 *
 * `oms-layer-header-v250-script` is its own `<script>` block, wrapped in an IIFE. It
 * reaches the app through `window.model` and `window.ui`, which is correct -- but it
 * calls `history.push()` on the bare identifier. Inside that block `history` resolves to
 * `window.history`, the browser's session history, which has `pushState` and no `push`.
 * The call throws immediately, so:
 *
 *   - the toolbar delete button did nothing at all
 *   - renaming a layer in that bar was silently discarded
 *
 * Both look like dead controls. The fix exposes the editor's undo stack as
 * `window.__omsHistory` and points these two call sites at it. Nothing else in the
 * document changes: every other block runs in the editor's own scope where `history`
 * already means the HistoryManager.
 */
export function fixLayerBarHistory(html) {
  // 1. Publish the undo stack next to the other globals the shell already exposes.
  const fromDecl = `const history=new HistoryManager(model);`;
  const toDecl =
    `const history=new HistoryManager(model);\n` +
    `// Reached by detached IIFE blocks (the layer toolbar) that cannot see this scope.\n` +
    `window.__omsHistory=history;`;
  let out = html;
  if (out.includes(fromDecl)) {
    out = out.replace(fromDecl, toDecl);
  } else {
    console.warn('! fixLayerBarHistory: HistoryManager declaration not found');
  }

  // 2. Point the layer toolbar's two calls at it.
  const blockStart = out.indexOf('id="oms-layer-header-v250-script"');
  if (blockStart === -1) {
    console.warn('! fixLayerBarHistory: layer toolbar block not found');
    return out;
  }
  const blockEnd = out.indexOf('</script>', blockStart);
  const block = out.slice(blockStart, blockEnd);
  const patched = block.replace(
    /\bhistory\.push\(\)/g,
    '(window.__omsHistory&&window.__omsHistory.push())'
  );
  if (patched === block) {
    console.warn('! fixLayerBarHistory: no history.push() call in the block');
    return out;
  }
  return out.slice(0, blockStart) + patched + out.slice(blockEnd);
}


/**
 * Makes the New Project sheet's PROJECT / ELEMENTS toggle real.
 *
 * `.seg` holds two buttons and there is no handler on either of them anywhere in the
 * document -- the pair is decorative, so tapping ELEMENTS opened nothing.
 *
 * The two options are genuinely different things:
 *
 *   PROJECT    start a new empty composition
 *   ELEMENTS   open the saved-element library: reuse a piece of another project here,
 *              or export it to a file for later
 *
 * An earlier version of this patch created a project and jumped to the shape drawer,
 * which was wrong: a shape catalog is not a library, and it cannot save or export
 * anything. The library itself lives in `native-shell/elements.js`; this only routes the
 * tab to it.
 */
export function fixNewProjectSeg(html) {
  const anchor = '<div class="seg"><button class="active">PROJECT</button><button>ELEMENTS</button></div>';
  if (!html.includes(anchor)) {
    console.warn('! fixNewProjectSeg: seg markup not found');
    return html;
  }
  const replacement =
    '<div class="seg" id="omsNewProjectSeg">' +
    '<button type="button" class="active" data-oms-seg="project">PROJECT</button>' +
    '<button type="button" data-oms-seg="elements">ELEMENTS</button>' +
    '</div>';

  const script = `
<script id="oms-new-project-seg">
(() => {
  'use strict';
  function wire() {
    const seg = document.getElementById('omsNewProjectSeg');
    if (!seg || seg.dataset.omsWired === '1') return;
    seg.dataset.omsWired = '1';
    const buttons = seg.querySelectorAll('[data-oms-seg]');
    buttons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        buttons.forEach((b) => b.classList.toggle('active', b === button));
        if (button.dataset.omsSeg !== 'elements') return;
        const close = document.getElementById('closeNew');
        if (close) close.click();
        if (window.omsElementsUI) window.omsElementsUI.open();
        else if (typeof toast === 'function') toast('Elements are still loading');
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
  setTimeout(wire, 1500);
})();
</script>
`;
  return html.replace(anchor, replacement + script);
}

/**
 * Adds an Elements entry to the editor's add drawer, beside Template.
 *
 * The add drawer builds its tabs from a hardcoded array of five tools, and the swipe
 * pager indexes into that array, so a sixth entry there would shift the paging. A button
 * is appended to the tab holder instead and given its own handler.
 */
export function addElementsDrawerTab(html) {
  /*
   * Upstream writes this binding with a single-$ selector:
   *
   *     $('[data-addhub]').forEach(b=>b.onclick=...)
   *
   * `$` is `document.querySelector`, which returns one element, not a list -- so this line
   * throws "forEach is not a function" and the Add Hub's five tabs are never wired.
   * `$$` is the list form, which is clearly what was meant, and every other loop in the
   * same function uses it. Fixing the selector is part of making the drawer usable.
   */
  const broken = "$('[data-addhub]').forEach(b=>b.onclick=()=>this.openTool(b.dataset.addhub));";
  const from = "$$('[data-addhub]').forEach(b=>b.onclick=()=>this.openTool(b.dataset.addhub));";
  let out = html;
  if (out.includes(broken)) {
    // String#replace treats `$$` in the replacement as an escaped literal `$`, so passing
    // the replacement as a string silently collapses `$$(` to `$(` -- the fix rewrote
    // itself back to the bug. A function replacement is not interpreted.
    out = out.replace(broken, () => from);
    console.log('  add-hub   tab binding repaired ($ -> $$)');
  }
  if (!out.includes(from)) {
    console.warn('! addElementsDrawerTab: addHub binding not found');
    return out;
  }
  const to = from + `
      (() => {
        const holder = document.getElementById('elementTabHolder');
        if (!holder || document.getElementById('tabAddElements')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'amTab addHubTab';
        b.id = 'tabAddElements';
        const icon = document.createElement('span');
        icon.className = 'amTabIconWrap';
        icon.textContent = '◈';
        icon.style.fontSize = '19px';
        icon.style.lineHeight = '19px';
        const label = document.createElement('span');
        label.textContent = 'Elements';
        b.append(icon, label);
        b.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.omsElementsUI) window.omsElementsUI.open();
          else if (typeof toast === 'function') toast('Elements are still loading');
        };
        holder.appendChild(b);
      })();`;
  return out.replace(from, to);
}

/**
 * Adds Node Video package import and export, and widens the speed control.
 *
 * THE IMPORT BUTTON
 *
 * The home screen has one IMPORT button. Its picker is `#projectInput`, whose accept list
 * is `application/json,text/xml,.json,.xml`, so a .zip is filtered out of the device
 * chooser before it can be picked at all. Adding a fifth button to that row would squeeze
 * the wordmark on a narrow phone, so the existing button is widened instead: its picker
 * accepts packages as well, and the chosen file is routed by sniffing whether it is a
 * .zip. Anything else is handed straight back to the editor's own import path through a
 * synthetic DataTransfer, so project and XML import behave exactly as before.
 *
 * THE SPEED RANGE
 *
 * The editor clamps playback speed to 0.25x-4x in ten places. Slow motion to 0.1x needs
 * every one of them to agree, so they are rewritten together.
 */
export function addNodeVideoImport(html) {
  let out = html;
  // Widen the speed ceiling everywhere the editor clamps it.
  const clamps = [
    ['const speed=clamp(+layer?.playbackRate||1,.25,4);', 'const speed=clamp(+layer?.playbackRate||1,.1,4);'],
    ['const speed=clamp(+layer.playbackRate||1,.25,4);', 'const speed=clamp(+layer.playbackRate||1,.1,4);'],
    ['const speed=clamp(+l.playbackRate||1,.25,4)', 'const speed=clamp(+l.playbackRate||1,.1,4)'],
    ['const speed=clamp(+value||1,.25,4),old=clamp(+l.playbackRate||1,.25,4);',
      'const speed=clamp(+value||1,.1,4),old=clamp(+l.playbackRate||1,.1,4);'],
    ['<small>0.25× – 4.00×</small>', '<small>0.10× – 4.00×</small>'],
    ['<input id="mediaSpeedRange" type="range" min="0.25" max="4" step="0.05"',
      '<input id="mediaSpeedRange" type="range" min="0.1" max="4" step="0.05"'],
    ['<input id="mediaSpeedNumber" class="mediaQuickNumber" type="number" min="0.25" max="4" step="0.05"',
      '<input id="mediaSpeedNumber" class="mediaQuickNumber" type="number" min="0.1" max="4" step="0.05"'],
    ['${[.25,.5,.75,1,1.5,2,3,4].map(v=>`<button data-speedpreset="${v}"',
      '${[.1,.25,.5,.75,1,1.5,2,3,4].map(v=>`<button data-speedpreset="${v}"'],
  ];
  let widened = 0;
  for (const [from, to] of clamps) {
    const hits = out.split(from).length - 1;
    if (!hits) {
      console.warn(`! addNodeVideoImport: speed clamp not found (${from.slice(0, 44)}…)`);
      continue;
    }
    // Function replacement: the replacement contains `$`, which a string replacement
    // would treat as a capture reference.
    out = out.split(from).join(to);
    widened += hits;
  }
  if (widened) console.log(`  speed     ${widened} clamp site(s) widened to 0.10x`);

  // A settings row that reaches the Node Video tools and the speed panel, because the
  // clip's own Speed button only appears once a media layer is selected.
  const card = '<div class="true3dCard"><i>4</i><div><b>Open Motion Scene 4</b><small>';
  const cardIndex = out.indexOf(card);
  if (cardIndex === -1) {
    console.warn('! addNodeVideoImport: settings anchor not found');
  } else {
    const end = out.indexOf('</div></div>', cardIndex);
    const insertAt = end === -1 ? -1 : end + '</div></div>'.length;
    if (insertAt === -1) {
      console.warn('! addNodeVideoImport: settings anchor end not found');
    } else {
      const row = '<div class="propRow"><label>Tools</label><button type="button" data-oms-nv="pro" style="grid-column:span 2;justify-self:start;appearance:none;border:1px solid #2a3240;background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;padding:10px 12px;border-radius:9px">Tracking · AI matte · LUT · Optical flow</button><span></span></div>' +
        '<div class="propRow"><label>Node Video</label><button type="button" data-oms-nv="speed" style="grid-column:span 2;justify-self:start;appearance:none;border:1px solid #2a3240;background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;padding:10px 12px;border-radius:9px">Speed &amp; slow motion</button><span></span></div>' +
        '<div class="propRow"><label>Package</label><button type="button" data-oms-nv="import" style="grid-column:span 2;justify-self:start;appearance:none;border:1px solid #2a3240;background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;padding:10px 12px;border-radius:9px">Import .zip</button><span></span></div>' +
        '<div class="propRow"><label>Export</label><button type="button" data-oms-nv="export" style="grid-column:span 2;justify-self:start;appearance:none;border:1px solid #2a3240;background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;padding:10px 12px;border-radius:9px">Export .zip</button><span></span></div>';
      out = out.slice(0, insertAt) + row + out.slice(insertAt);
    }
  }

  const script = `
<script id="oms-nodevideo-entry">
(() => {
  'use strict';
  // Reads the first four bytes: every zip starts with "PK\u0003\u0004". Deciding by the
  // name alone would misroute a zip that was renamed on the way through a chat app.
  function looksLikeZip(file) {
    var head = file.slice(0, 4);
    if (head.arrayBuffer) {
      return head.arrayBuffer().then(function (buffer) {
        var b = new Uint8Array(buffer);
        return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
      }).catch(function () { return /\.zip$/i.test(file.name || ''); });
    }
    return Promise.resolve(/\.zip$/i.test(file.name || ''));
  }

  function wireImport() {
    var target = document.getElementById('projectInput');
    if (!target) return;

    // The picker is the thing that filters files, so the picker is what is widened. The
    // IMPORT button keeps its own handler and still calls click() on this input.
    if (target.dataset.omsZipAccept !== '1') {
      target.dataset.omsZipAccept = '1';
      target.setAttribute('accept',
        '.json,.xml,.zip,application/json,application/xml,application/zip,application/x-zip-compressed');
    }

    // Capture phase on the document, not a handler on the input.
    //
    // The editor assigns the input's handler as a property and reassigns it more than
    // once during boot. Wrapping that property was tried and lost the race twice: a wrap
    // installed before the editor's own assignment was silently replaced, which would
    // have dropped every project import. A capture listener runs before the target's own
    // handlers, so a package is taken here and stopped from ever reaching the editor's
    // parser, while a project or XML file is left completely alone.
    if (document.__omsZipCapture) return;
    document.__omsZipCapture = true;
    document.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || input.id !== 'projectInput') return;
      var file = input.files && input.files[0];
      if (!file || !window.omsNodeVideoUI) return;

      // The editor's handler is taken here, synchronously, before anything awaits. If it
      // is missing the event is left alone -- taking a file away from a handler that does
      // not exist would delete project import entirely.
      var editorHandler = input.onchange;
      var canTake = typeof editorHandler === 'function';

      // Reading the first bytes decides what the file is, and that is asynchronous. The
      // event stops here now, not later: once the promise resolves the dispatch is over
      // and stopPropagation would do nothing -- which is exactly how a zip still reached
      // the editor's JSON parser in the first test.
      if (canTake) {
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }

      looksLikeZip(file).then(function (zip) {
        if (zip) {
          input.value = '';
          window.omsNodeVideoUI.openImport(file);
          return;
        }
        if (canTake) editorHandler.call(input, event);
      });
    }, true);
  }

  // Delegated, so a row inside a drawer that is built later works the moment it is
  // tapped -- polling would leave a dead window of several seconds.
  function wireSettings() {
    if (document.__omsNvDelegated) return;
    document.__omsNvDelegated = true;
    document.addEventListener('click', function (event) {
      var target = event.target;
      var button = target && target.closest ? target.closest('[data-oms-nv]') : null;
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      var kind = button.dataset.omsNv;
      var ui = window.omsNodeVideoUI;
      if (!ui) {
        if (typeof toast === 'function') toast('The tools are still loading');
        return;
      }
      if (kind === 'speed') ui.openSpeed();
      else if (kind === 'import') ui.openImport();
      else ui.openExport();
    }, true);
  }

  function boot() {
    wireImport();
    wireSettings();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  setTimeout(boot, 1200);
  setInterval(boot, 4000);
})();
</script>
`;
  const close = out.lastIndexOf('</html>');
  if (close === -1) return out + script;
  return out.slice(0, close) + script + out.slice(close);
}

/**
 * Gives the LUT grade a real entry in the effect catalog.
 *
 * The catalog is a `const` inside the editor's own script, so nothing outside that scope can
 * extend it -- `window.OMS_EFFECT_CATALOG` never exists. The only place a new effect can be
 * declared is immediately before `OMS_EFFECT_BY_ID` is built, and that is where this goes.
 * Without it the layer stack would hold an effect the renderer and the panel have never
 * heard of, which is how a menu item ends up doing nothing.
 */
export function addLutEffectSpec(html) {
  const anchor = "const OMS_EFFECT_BY_ID=new Map(OMS_EFFECT_CATALOG.map(spec=>[spec.id,spec]));";
  if (!html.includes(anchor)) {
    console.warn('! addLutEffectSpec: effect catalog anchor not found');
    return html;
  }
  const inject = `/* EditorsHub: a real, keyframable LUT Grade effect. The colour table is applied by the
   renderer's paint step (see nodevideo-pro.js) because a 3D cube needs a texture the effect
   pipeline cannot bind; this entry is what makes the layer stack, the effects panel and the
   keyframe system treat it as a first-class effect. */
const OMS_LUT_GRADE_SPEC=Object.freeze({id:'oms_lut_grade',name:'LUT Grade',category:'Color',renderKind:'SHADER',params:[{id:'amount',label:'Amount',type:'SCALAR',default:1,min:0,max:1,step:.01,displayScale:100,group:'Grade'}]});
OMS_EFFECT_CATALOG=[...OMS_EFFECT_CATALOG,OMS_LUT_GRADE_SPEC];
// The effects panel reads window.omsUnifiedEffects.catalog, which is built later in this
// script, so the entry is added once that object exists.
queueMicrotask(()=>{try{window.omsUnifiedEffects?.catalog?.set?.('oms_lut_grade',OMS_LUT_GRADE_SPEC);OMS_EFFECT_RENDERABLE.add?.('oms_lut_grade')}catch(e){}});

`;
  return html.split(anchor).join(inject + anchor);
}

/**
 * Applies an active LUT grade to the layer raster, after the layer is painted.
 *
 * The grade cannot live in the GPU effect pipeline: that pipeline binds two textures and
 * float parameters only, and a 3D colour cube needs a third texture. Doing it here means the
 * lookup runs on the pixels the layer just produced, before they are uploaded, so the grade
 * is part of the frame rather than a pass over it.
 *
 * The lookup itself is a flat index into a 32^3 table (see nodevideo-pro.js), one multiply
 * per channel. Every failure path leaves the ungraded raster in place: a colour table that
 * cannot be read must never black out the preview or lose a layer.
 */
export function addLutPaintHook(html) {
  const anchor = '\n    c.restore();window.omsBackgroundRemoval?.apply(l,e,model.time);';
  if (!html.includes(anchor)) {
    console.warn('! addLutPaintHook: paint anchor not found');
    return html;
  }
  const hook = '\n    c.restore();window.omsNodeVideoPro?.gradeCanvas?.(l,e);' +
    'window.omsBackgroundRemoval?.apply(l,e,model.time);';
  let out = html.split(anchor).join(hook);
  console.log('  lut       paint hook installed');
  return out;
}

/**
 * Renders the preview at the preview's own size instead of the project's.
 *
 * WHY
 *
 * The WebGL canvas was always the full project resolution. A 1080p timeline therefore
 * shaded 1920x1080 pixels per frame to fill a preview box that is a few hundred pixels
 * wide, and every blur, effect pass and texture upload paid for pixels no one can see.
 * That is the largest single reason the editor felt heavy on a phone: the work scaled
 * with the project, not with the screen.
 *
 * WHAT CHANGES
 *
 *   `resize()` sizes the canvas to project size * preview quality
 *   `screenWorld`/`project` report composition pixels, not canvas pixels
 *   `canvasPointFromClient` converts the other way, so taps still land exactly
 *
 * Export is untouched: it sets its own native-resolution target and the code here never
 * runs while `_nativeExportTarget` is set.
 *
 * Every edit is anchored on an exact string from the shipped document and fails soft with
 * a console warning, because a wrong guess here would move every hit box in the editor.
 */

/** The three size assignments that must become preview-sized. */
const PREVIEW_SIZE_SITES = [
  // The Canvas2D fallback renderer is deliberately left at project size. It paints in
  // composition coordinates with no projection matrix, so a smaller backing store would
  // draw every layer at the wrong scale. It only runs on devices without WebGL, where
  // correctness matters more than the pixels it saves.
  //
  // 1. WebGL renderer. Keeps a 1:1 fallback while an export target is active.
  ['const w=target?.width||Math.max(1,+model.project.width||1),h=target?.height||Math.max(1,+model.project.height||1);',
    'const __p=target?null:omsPreviewCanvasSize(),w=target?.width||__p.width,h=target?.height||__p.height;'],
  // 2. Leaving an export restores the preview size, not the project size.
  ['this.canvas.width=Math.max(1,+model.project.width||1);this.canvas.height=Math.max(1,+model.project.height||1);\n    this.gl.viewport(0,0,this.canvas.width,this.canvas.height);',
    'const __p=omsPreviewCanvasSize();this.canvas.width=__p.width;this.canvas.height=__p.height;\n    this.gl.viewport(0,0,this.canvas.width,this.canvas.height);'],
];

/** The helper the size sites call. Inserted once, before the renderer class exists. */
const PREVIEW_HELPER = `const OMS_PREVIEW_SCALE_KEY='oms_preview_scale_v1';
// One place decides what "preview resolution" means. A cached value keeps this off the
// hot path: it is called from resize(), the export teardown and every live setting change.
let __omsPreviewSizeCache={key:'',width:2,height:2};
function omsPreviewCanvasSize(){
  const project=window.model&&model.project;
  if(!project)return{width:2,height:2,scale:1};
  const scale=typeof omsPreviewQualityScale==='function'?omsPreviewQualityScale():.5;
  const key=(+project.width||2)+'x'+(+project.height||2)+'@'+scale;
  if(__omsPreviewSizeCache.key===key)return __omsPreviewSizeCache;
  const width=Math.max(2,Math.round((+project.width||2)*scale));
  const height=Math.max(2,Math.round((+project.height||2)*scale));
  __omsPreviewSizeCache={key,width,height,scale};
  return __omsPreviewSizeCache;
}
window.omsPreviewCanvasSize=omsPreviewCanvasSize;
// Editor overlay surfaces are drawn in composition units even though the stage canvas is
// scaled, so they keep the project size and are scaled back down by CSS.
function omsCompositionWidth(){const p=window.model&&model.project;return Math.max(1,+p?.width||1)}
function omsCompositionHeight(){const p=window.model&&model.project;return Math.max(1,+p?.height||1)}
window.omsCompositionWidth=omsCompositionWidth;
window.omsCompositionHeight=omsCompositionHeight;
`;

export function addPreviewScale(html) {
  let out = html;

  // The quality functions are block-scoped inside the editor script, so the settings row
  // and the tools sheet can only reach them if they are published. Without this the sheet
  // would write localStorage and the renderer would never hear about it.
  const qualityAnchor = 'function omsPreviewQualityPercent(){return Math.round(omsPreviewQualityScale()*100)}';
  if (out.includes(qualityAnchor)) {
    out = out.split(qualityAnchor).join(
      qualityAnchor +
      '\nwindow.omsPreviewQualityScale=omsPreviewQualityScale;' +
      'window.omsPreviewQualityPercent=omsPreviewQualityPercent;'
    );
  } else {
    console.warn('! addPreviewScale: quality functions anchor missing');
  }
  const setQualityAnchor = 'function omsSetPreviewQuality(value){';
  if (out.includes(setQualityAnchor)) {
    out = out.split(setQualityAnchor).join('function omsSetPreviewQuality(value){');
    // Published after the body, so the export below sees the finished function.
    // Published after the closing brace, at the same block level as the declaration:
    // publishing inside the body would leave the function unreachable until someone had
    // already called it through a path that does not exist yet.
    const endAnchor = "  bus.emit('preview:quality',{preference:next,scale:omsPreviewQualityScale()});\n  return next\n}";
    if (out.includes(endAnchor)) {
      out = out.split(endAnchor).join(endAnchor + '\nwindow.omsSetPreviewQuality=omsSetPreviewQuality;');
    } else {
      console.warn('! addPreviewScale: set-quality body anchor missing');
    }
  } else {
    console.warn('! addPreviewScale: omsSetPreviewQuality anchor missing');
  }

  // The helper has to exist before the first renderer is constructed.
  const rendererAnchor = "const renderer=new WebGLRenderer(model,$('#stage'));";
  if (!out.includes(rendererAnchor)) {
    console.warn('! addPreviewScale: renderer construction anchor missing');
    return out;
  }
  out = out.split(rendererAnchor).join(PREVIEW_HELPER + rendererAnchor);

  // Projection results move back into composition pixels. This is the half that keeps
  // hit testing, drag deltas and overlay drawing honest once the canvas is smaller.
  const screenAnchor = 'screenWorld(x,y,z,vp=this.vp){const p=Mat4.point(vp,x,y,z);if(p.w<=.00001)return null;const nx=p.x/p.w,ny=p.y/p.w,nz=p.z/p.w;if(nz<-1.2||nz>1.2)return null;return{x:(nx*.5+.5)*this.canvas.width,y:(1-(ny*.5+.5))*this.canvas.height,z:nz,w:p.w}}';
  const screenTo = `screenWorld(x,y,z,vp=this.vp){const p=Mat4.point(vp,x,y,z);if(p.w<=.00001)return null;const nx=p.x/p.w,ny=p.y/p.w,nz=p.z/p.w;if(nz<-1.2||nz>1.2)return null;
    // Composition pixels, not canvas pixels. The projection is built in composition units
    // (ortho is -W/2..W/2), so the result is normalised against the COMPOSITION size --
    // never against this.canvas.width, which is the scaled preview size and is stale the
    // moment the quality changes. Using the canvas here drew every 3D layer at 1/scale and
    // made the selection box a quarter-size in the corner.
    return{x:(nx*.5+.5)*omsCompositionWidth(),y:(1-(ny*.5+.5))*omsCompositionHeight(),z:nz,w:p.w}}`;
  if (!out.includes(screenAnchor)) {
    console.warn('! addPreviewScale: screenWorld anchor missing — pointer maths left alone');
  } else {
    out = out.split(screenAnchor).join(screenTo);
  }

  // ...and the pointer conversion is the inverse of that.
  const pointAnchor = `function canvasPointFromClient(clientX,clientY,rect){
  return {
    x:(clientX-rect.left)*(renderer.canvas.width/rect.width),
    y:(clientY-rect.top)*(renderer.canvas.height/rect.height)
  };
}`;
  const pointTo = `function canvasPointFromClient(clientX,clientY,rect){
  // Composition pixels. The canvas backing store is scaled for speed, the composition is
  // not, so the ratio has to come from the project size rather than the canvas size.
  const p=window.model&&model.project||{},W=Math.max(1,+p.width||renderer.canvas.width),H=Math.max(1,+p.height||renderer.canvas.height);
  return {
    x:(clientX-rect.left)*(W/Math.max(1,rect.width)),
    y:(clientY-rect.top)*(H/Math.max(1,rect.height))
  };
}`;
  if (!out.includes(pointAnchor)) {
    console.warn('! addPreviewScale: canvasPointFromClient anchor missing');
  } else {
    out = out.split(pointAnchor).join(pointTo);
  }

  // `unproject` is the inverse of `screenWorld`: it takes composition pixels and turns them
  // into world space. With the canvas scaled down it has to normalise by the composition
  // size, or every drag of a 3D layer moves it by the wrong distance.
  const unprojectAnchor = 'unproject(x,y,depth){const inv=Mat4.inverse(this.vp),nx=x/this.canvas.width*2-1,ny=1-y/this.canvas.height*2,';
  if (out.includes(unprojectAnchor)) {
    out = out.split(unprojectAnchor).join(
      'unproject(x,y,depth){const inv=Mat4.inverse(this.vp),__c=omsPreviewCanvasSize(),nx=x/(__c.scale?this.canvas.width/__c.scale:this.canvas.width)*2-1,ny=1-y/(__c.scale?this.canvas.height/__c.scale:this.canvas.height)*2,'
    );
  } else {
    console.warn('! addPreviewScale: unproject anchor missing');
  }

  // The 3D camera handle radius was a fraction of the canvas size, which is now the preview
  // size. Measured against composition pixels it would shrink with the quality setting, so
  // it is expressed in composition units -- the same 2.8% of the short edge as before.
  const cameraHitAnchor = 'const radius=Math.max(20,Math.min(this.canvas.width,this.canvas.height)*.028);';
  if (out.includes(cameraHitAnchor)) {
    out = out.split(cameraHitAnchor).join(
      'const radius=Math.max(20,Math.min(omsCompositionWidth(),omsCompositionHeight())*.028);'
    );
    console.log('  preview   camera handle radius kept in composition units');
  } else {
    console.warn('! addPreviewScale: camera handle anchor missing');
  }

  // The selection overlay is drawn on its own canvas, which stays at project size, so its
  // strokes are scaled up by the canvas/project ratio to keep the same visual weight.
  // The overlay canvas is composition sized, so a stroke weight expressed as a fraction of
  // the composition short edge is the same visual weight at every preview quality.
  const overlayWidthAnchor = "c.lineWidth=Math.max(1.5,this.canvas.width*.0015);";
  if (out.includes(overlayWidthAnchor)) {
    out = out.split(overlayWidthAnchor).join(
      "c.lineWidth=Math.max(1.5,Math.min(omsCompositionWidth(),omsCompositionHeight())*.0015);"
    );
  }
  const overlayRadiusAnchor = "const handleR=Math.max(4,this.canvas.width*.0035);";
  if (out.includes(overlayRadiusAnchor)) {
    out = out.split(overlayRadiusAnchor).join(
      "const handleR=Math.max(4,omsCompositionWidth()*.0035);"
    );
  }
  // The white framing guide was drawn from the canvas size too.
  const overlayFrameAnchor = "const W=this.canvas.width,H=this.canvas.height,eps=Math.max(1.25,c.lineWi";
  if (out.includes(overlayFrameAnchor)) {
    out = out.split(overlayFrameAnchor).join(
      "const W=omsCompositionWidth(),H=omsCompositionHeight(),eps=Math.max(1.25,c.lineWi"
    );
  }

  // The editor's overlay surfaces are sized from the stage canvas but drawn in composition
  // coordinates, so at preview scale they must keep the composition size and the CSS box
  // does the down-scaling. Without this the selection box is a quarter size in the corner.
  const overlaySites = [
    [`if(this.interactionLayer){this.interactionLayer.width=this.canvas.width;this.interactionLayer.height=this.canvas.height;`,
      `if(this.interactionLayer){this.interactionLayer.width=omsCompositionWidth();this.interactionLayer.height=omsCompositionHeight();`],
    [`if(this.overlay){this.overlay.width=this.canvas.width;this.overlay.height=this.canvas.height;`,
      `if(this.overlay){this.overlay.width=omsCompositionWidth();this.overlay.height=omsCompositionHeight();`],
    ['    overlay.width=above.width=this.canvas.width;\n    overlay.height=above.height=this.canvas.height;',
      '    overlay.width=above.width=omsCompositionWidth();\n    overlay.height=above.height=omsCompositionHeight();'],
  ];
  let overlayHits = 0;
  for (const [from, to] of overlaySites) {
    const hits = out.split(from).length - 1;
    if (!hits) { console.warn(`! addPreviewScale: overlay site missing (${from.slice(0, 40)}…)`); continue; }
    out = out.split(from).join(to);
    overlayHits += hits;
  }
  if (overlayHits) console.log(`  preview   ${overlayHits} overlay surface(s) kept at composition size`);

  // The DOM-interaction fast path converts a composition delta into CSS pixels. Before this
  // it divided by the canvas backing width; now it must divide by the composition width so
  // a dragged layer still follows the finger at any preview scale.
  const domDragAnchor = 'const rect=this.canvas.getBoundingClientRect();\n    const sx=rect.width/this.canvas.width;';
  if (out.includes(domDragAnchor)) {
    out = out.split(domDragAnchor).join(
      'const rect=this.canvas.getBoundingClientRect();\n    const sx=rect.width/omsCompositionWidth();'
    );
    out = out.split('\n    const sy=rect.height/this.canvas.height;').join(
      '\n    const sy=rect.height/omsCompositionHeight();'
    );
    console.log('  preview   DOM drag follows the finger in CSS pixels');
  } else {
    console.warn('! addPreviewScale: DOM drag anchor missing');
  }

  let applied = 0;
  for (const [from, to] of PREVIEW_SIZE_SITES) {
    const hits = out.split(from).length - 1;
    if (!hits) {
      console.warn(`! addPreviewScale: size site not found (${from.slice(0, 40)}…)`);
      continue;
    }
    out = out.split(from).join(to);
    applied += hits;
  }
  console.log(`  preview   rendered at ${Math.round(100 * 0.5)}% default quality (${applied} size site(s))`);
  return out;
}

/**
 * Stops the playhead update from redoing per-frame work that cannot change mid-frame.
 *
 * `updatePlayhead` runs on every rendered frame. Unconditionally it walked the keyframe
 * list, rewrote the multi-selection tool strip and re-rendered the ruler labels — DOM and
 * allocation work at 30-60 Hz, none of which depends on the playhead during playback.
 * The guards below only skip the work when nothing about its input changed, so a value
 * that is on screen still updates the frame after it changes.
 */
export function addPlayheadThrottle(html) {
  const anchor = '    this.updateKeyframePlayheadState();\n    ui?.refreshMultiSelectionToolsContext?.();\n  }';
  if (!html.includes(anchor)) {
    console.warn('! addPlayheadThrottle: playhead anchor missing');
    return html;
  }
  const replacement =
    `    // The keyframe lane only depends on the frame index and the selected layer. During
    // playback the index changes at most once per frame, so this is the same call with a
    // cheap guard instead of a full walk per rendered frame.
    const __kfKey=timeline.frameIndex(model.time)+':'+(model.selected||'')+':'+(ui?.drawerMode||'');
    if(__kfKey!==this.__omsKfKey){this.__omsKfKey=__kfKey;this.updateKeyframePlayheadState()}
    // The multi-selection strip is only on screen in multi-select mode; the callee already
    // returns early otherwise, so it is called every frame on purpose and left as is.
    ui?.refreshMultiSelectionToolsContext?.();
  }`;
  return html.split(anchor).join(replacement);
}

/**
 * A "More tools" entry on every inspector root, because the tools existed but could not be
 * found.
 *
 * The report was not "these features are missing", it was "I didn't find other options to
 * test". Everything below already shipped -- motion tracking, the AI matte, LUT grading,
 * optical flow, the Node Video package tools, quality controls -- but each one lived inside
 * a different drawer, or behind a selection, or in a Settings panel two screens deep. A
 * feature nobody can reach is a missing feature.
 *
 * This adds one full-width button under the inspector grid that opens a single sheet
 * listing every tool the app has, each one calling the function that opens it directly.
 * The sheet is built from a table, so it can grow without touching the editor.
 *
 * The row is added from a capture-phase listener rather than by rewriting the inspector's
 * template: the template is a single long line whose exact text changes with the upstream
 * build, while `#drawer` and `[data-ins]` are stable.
 */
export const MORE_TOOLS_SCRIPT = `
<script id="oms-more-tools">
(() => {
  'use strict';
  const BUTTON_ID = 'omsMoreToolsBtn';
  const STYLE_ID = 'omsMoreToolsStyle';

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BUTTON_ID + '{width:100%;margin:4px 0 2px;appearance:none;display:flex;',
      'align-items:center;justify-content:center;gap:8px;min-height:44px;',
      'border:1px solid #2b3444;background:#101620;color:#dfe8f4;',
      'font:700 13px/1 system-ui,-apple-system,sans-serif;border-radius:12px}',
      '#' + BUTTON_ID + ':active{background:#17222f;border-color:#3ad9c6}',
      '.omsMtSheet{position:fixed;inset:0;z-index:2147483300;display:flex;',
      'align-items:flex-end;justify-content:center;background:rgba(0,0,0,.78)}',
      '.omsMtCard{width:100%;max-width:560px;max-height:88vh;display:flex;',
      'flex-direction:column;background:#000;border:1px solid #171d27;',
      'border-radius:20px 20px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom,0px));',
      'color:#e8edf4;font:400 13px/1.5 system-ui,-apple-system,sans-serif;',
      'animation:omsMtIn .2s cubic-bezier(.22,1,.36,1) both}',
      '@keyframes omsMtIn{from{transform:translateY(20px);opacity:.5}to{transform:none;opacity:1}}',
      '.omsMtHead{display:flex;align-items:center;gap:10px;padding-bottom:11px;',
      'border-bottom:1px solid #151a22}',
      '.omsMtHead b{flex:1 1 auto;font:800 16px/1.3 system-ui,sans-serif}',
      '.omsMtHead button{appearance:none;background:#0f131a;border:1px solid #222a36;',
      'color:#b9c4d3;font:700 12px/1 system-ui,sans-serif;padding:10px 13px;border-radius:10px}',
      '.omsMtBody{flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;',
      'padding:12px 0 2px;display:flex;flex-direction:column;gap:8px}',
      '.omsMtGroup{font:800 10.5px/1 system-ui,sans-serif;letter-spacing:.14em;',
      'text-transform:uppercase;color:#5f6b7c;padding:10px 4px 2px}',
      '.omsMtRow{display:flex;align-items:center;gap:10px;width:100%;text-align:left;',
      'padding:12px;border:1px solid #171d27;border-radius:13px;background:#070a0e;',
      'color:inherit;font:inherit;appearance:none}',
      '.omsMtRow:active{background:#0d141c;border-color:#2b3a4a}',
      '.omsMtRow>i{flex:0 0 30px;font-style:normal;font-size:18px;text-align:center;color:#4fe0cd}',
      '.omsMtRow>span{flex:1 1 auto;min-width:0}',
      '.omsMtRow b{display:block;font:700 13.5px/1.35 system-ui,sans-serif}',
      '.omsMtRow small{display:block;margin-top:2px;font-size:11.5px;line-height:1.45;color:#7d8796}',
      '.omsMtRow em{flex:0 0 auto;font-style:normal;color:#4a5566;font-size:16px}',
      '.omsMtNote{padding:10px 4px 4px;font-size:11px;line-height:1.6;color:#6b7686}',
    ].join('');
    document.head.appendChild(s);
  }

  function card(title, subtitle) {
    style();
    const host = document.createElement('div');
    host.className = 'omsMtSheet';
    const box = document.createElement('div');
    box.className = 'omsMtCard';
    const head = document.createElement('div');
    head.className = 'omsMtHead';
    const label = document.createElement('b');
    label.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    head.append(label, close);
    const body = document.createElement('div');
    body.className = 'omsMtBody';
    if (subtitle) {
      const note = document.createElement('div');
      note.className = 'omsMtNote';
      note.textContent = subtitle;
      body.appendChild(note);
    }
    box.append(head, body);
    host.appendChild(box);
    document.body.appendChild(host);
    const dismiss = () => host.remove();
    close.addEventListener('click', dismiss);
    host.addEventListener('click', (e) => { if (e.target === host) dismiss(); });
    return { body, close: dismiss };
  }

  function row(parent, icon, title, detail, run) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'omsMtRow';
    const i = document.createElement('i');
    i.textContent = icon;
    const span = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = title;
    const small = document.createElement('small');
    small.textContent = detail;
    span.append(b, small);
    const chevron = document.createElement('em');
    chevron.textContent = '\\u203a';
    button.append(i, span, chevron);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    parent.appendChild(button);
    return button;
  }

  function group(parent, title) {
    const heading = document.createElement('div');
    heading.className = 'omsMtGroup';
    heading.textContent = title;
    parent.appendChild(heading);
  }

  // Every entry below is a real call into an existing feature. If a call is missing the row
  // says so instead of closing onto nothing.
  function build() {
    const view = card('Everything in this app', 'Grouped by what you are working on. Nothing here is a shortcut: every row opens the real tool.');
    const ui = window.__omsUi || null;
    const pro = window.omsNodeVideoPro;
    const nv = window.omsNodeVideoUI;
    const elements = window.omsElementsUI;
    const renderer = window.__omsRenderer;

    const missing = (name) => () => {
      if (typeof window.toast === 'function') toast(name + ' is still loading');
    };
    const openSelected = (type) => () => {
      const layer = window.model && model.selectedLayer ? model.selectedLayer() : null;
      if (!layer) { if (typeof window.toast === 'function') toast('Select a layer first'); return; }
      view.close();
      ui && ui.openInspector(type);
    };

    group(view.body, 'Grade and finish');
    row(view.body, '\\u25c9', 'Colour grading (LUT)', 'Load a .cube table and grade the selected layer.',
      pro ? () => { view.close(); pro.openLut(); } : missing('Colour grading'));
    row(view.body, '\\u2726', 'Effects', '38 effect categories on the selected layer.',
      ui ? openSelected('effects') : missing('Effects'));
    row(view.body, '\\u25d2', 'Blending & Opacity', 'Blend mode, opacity and fill on the selected layer.',
      ui ? openSelected('blend') : missing('Blending'));
    row(view.body, '\\u25c8', 'Colour & Fill', 'Fill colour and stroke for shapes and text.',
      ui ? openSelected('color') : missing('Colour'));

    group(view.body, 'Time and motion');
    row(view.body, '\\u25b6', 'Speed & slow motion', '0.10x to 4.00x, ramps and frame blending.',
      nv ? () => { view.close(); nv.openSpeed(); } : missing('Speed'));
    row(view.body, '\\u25c7', 'Optical flow', 'Estimate motion between two frames and build an in-between.',
      pro ? () => { view.close(); pro.openFlow(); } : missing('Optical flow'));
    row(view.body, '\\u2313', 'Keyframes', 'Graph editor for the selected layer.',
      ui ? () => { openSelected('keys')(); } : missing('Keyframes'));
    row(view.body, '\\u223f', 'Easing', 'Ease in, ease out, overshoot, spring and custom Bezier.',
      ui ? () => { view.close(); ui.openInspector('move'); requestAnimationFrame(() => { const b = document.getElementById('transformEaseSide'); if (b) b.click(); }); } : missing('Easing'));
    row(view.body, '\\u2197', 'Curve graph', 'Value and speed curves with draggable Bezier handles.',
      ui ? () => { view.close(); const l = window.model && model.selectedLayer ? model.selectedLayer() : null; const props = l && ui.transformModeProps ? ui.transformModeProps(l) : []; ui.openGraphEditor(props[0]); } : missing('Curve graph'));

    group(view.body, 'Track and cut out');
    row(view.body, '\\u2316', 'Motion tracking', 'Tracker point, corner pin and stabiliser.',
      pro ? () => { view.close(); pro.openTracking(); } : missing('Tracking'));
    row(view.body, '\\u25a3', 'AI subject matte', 'Cut the subject out. The model downloads once.',
      pro ? () => { view.close(); pro.openSubjectMatte(); } : missing('AI matte'));
    row(view.body, '\\u2b21', 'Mask', 'Rectangle or ellipse mask on the selected layer.',
      ui ? openSelected('mask') : missing('Mask'));

    group(view.body, '3D and camera');
    row(view.body, '\\u25c6', 'True 3D & camera', 'Depth, camera, lens and projection for the selected layer.',
      ui ? openSelected('three') : missing('3D'));
    row(view.body, '\\u25ce', 'Scene graph', 'Parenting and hierarchy for the selected layer.',
      ui ? openSelected('hier') : missing('Scene graph'));
    row(view.body, '\\u270e', 'Vector drawing', 'Pen tool with editable points.',
      ui ? () => { view.close(); ui.openTool('vector'); } : missing('Vector'));

    group(view.body, 'Project and files');
    row(view.body, '\\u2913', 'Import Node Video .zip', 'Read a project package from Node Video.',
      nv ? () => { view.close(); nv.openImport(); } : missing('Import'));
    row(view.body, '\\u2911', 'Export .zip package', 'Write a package this app can read back.',
      nv ? () => { view.close(); nv.openExport(); } : missing('Export'));
    row(view.body, '\\u25c8', 'Elements library', 'Saved assets you can reuse in another project.',
      elements ? () => { view.close(); elements.open(); } : missing('Elements'));

    group(view.body, 'Smoothness');
    row(view.body, '\\u25d1', 'Preview quality', 'Lower it if the preview stutters. Export is unaffected.',
      ui && ui.openInspectorRoot ? () => { view.close(); if (window.omsPreviewQualitySheet) window.omsPreviewQualitySheet(); } : missing('Preview quality'));
    row(view.body, '\\u25a4', 'Self test', 'Check the engine and the tools on this device.',
      window.omsSelfTest ? () => { view.close(); window.omsSelfTest.run(); } : missing('Self test'));

    const foot = document.createElement('div');
    foot.className = 'omsMtNote';
    foot.textContent = 'Tip: most of these act on the layer you have selected. Select a layer on the timeline first.';
    view.body.appendChild(foot);
    return view;
  }

  function addButton() {
    const drawer = document.getElementById('drawer');
    if (!drawer || drawer.contains && drawer.querySelector('#' + BUTTON_ID)) return;
    // Only the inspector root gets the row; every other drawer has its own content.
    if (!drawer.querySelector('[data-ins]')) return;
    if (drawer.querySelector('#' + BUTTON_ID)) return;
    const grid = drawer.querySelector('.inspectorGrid');
    if (!grid) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.innerHTML = '<span aria-hidden="true">\\u2630</span> More tools';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      build();
    });
    grid.insertAdjacentElement('afterend', button);
  }

  // The inspector is rebuilt on every selection, so the row is re-added whenever the drawer
  // changes rather than once at boot.
  function watch() {
    const drawer = document.getElementById('drawer');
    if (!drawer) return;
    try {
      new MutationObserver(addButton).observe(drawer, { childList: true, subtree: true });
    } catch (e) { /* observer unavailable: the interval below still covers it */ }
    addButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
  setTimeout(watch, 1500);
  setInterval(addButton, 2000);
})();
</script>
`;

/** Appends the "More tools" sheet to the finished document. */
export function addMoreTools(html) {
  const close = html.lastIndexOf('</html>');
  if (close === -1) return html + MORE_TOOLS_SCRIPT;
  console.log('  tools     single "More tools" sheet installed');
  return html.slice(0, close) + MORE_TOOLS_SCRIPT + html.slice(close);
}

/**
 * A real Preview quality control, plus the two tap defects the transcript showed.
 *
 * PREVIEW QUALITY
 *
 * The editor already had the machinery -- `omsSetPreviewQuality` and a `preview:quality`
 * event the renderer listens to -- but no control anywhere reached it, so the setting was
 * unreachable and stuck on its automatic guess. The sheet below is the missing control, and
 * it is also reachable from Settings so it is not only inside "More tools".
 *
 * TAP DEFECTS
 *
 * 1. `div.switchRow` (e.g. "Enable Mask") received touchstart/touchend/pointerdown and no
 *    click at all, so tapping the row did nothing. The row is now a real target: any tap on
 *    it toggles its checkbox, and the click path is deduplicated so a device that sends both
 *    still toggles once.
 * 2. The floating + (plusBtn) sits over the right end of the timeline rows. A tap meant for
 *    the timeline, 671 ms long, landed on the button and opened the add drawer instead. The
 *    hit area is clipped to the circle it is drawn as, so the square corners that caught
 *    those taps no longer do.
 */
export const QUALITY_AND_TAP_SCRIPT = `
<script id="oms-quality-and-tap">
(() => {
  'use strict';
  const STYLE_ID = 'omsQualityStyle';

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.omsQSheet{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:flex-end;',
      'justify-content:center;background:rgba(0,0,0,.78)}',
      '.omsQCard{width:100%;max-width:520px;display:flex;flex-direction:column;background:#000;',
      'border:1px solid #171d27;border-radius:20px 20px 0 0;',
      'padding:14px 14px calc(16px + env(safe-area-inset-bottom,0px));color:#e8edf4;',
      'font:400 13px/1.5 system-ui,-apple-system,sans-serif;',
      'animation:omsQIn .2s cubic-bezier(.22,1,.36,1) both}',
      '@keyframes omsQIn{from{transform:translateY(20px);opacity:.5}to{transform:none;opacity:1}}',
      '.omsQHead{display:flex;align-items:center;gap:10px;padding-bottom:11px;',
      'border-bottom:1px solid #151a22}',
      '.omsQHead b{flex:1 1 auto;font:800 16px/1.3 system-ui,sans-serif}',
      '.omsQHead button{appearance:none;background:#0f131a;border:1px solid #222a36;',
      'color:#b9c4d3;font:700 12px/1 system-ui,sans-serif;padding:10px 13px;border-radius:10px}',
      '.omsQBody{display:flex;flex-direction:column;gap:8px;padding:12px 0 4px}',
      '.omsQOpt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;',
      'padding:13px 12px;border:1px solid #171d27;border-radius:13px;background:#070a0e;',
      'color:inherit;font:inherit;appearance:none}',
      '.omsQOpt b{display:block;font:700 13.5px/1.3 system-ui,sans-serif}',
      '.omsQOpt small{display:block;margin-top:2px;font-size:11.5px;color:#7d8796}',
      '.omsQOpt>span{flex:1 1 auto;min-width:0}',
      '.omsQOpt>em{font-style:normal;color:#3ad9c6;font-size:15px;opacity:0}',
      '.omsQOpt.on{border-color:#2b6f68;background:#0a1514}',
      '.omsQOpt.on>em{opacity:1}',
      '.omsQNote{padding:8px 2px 0;font-size:11px;line-height:1.6;color:#6b7686}',
      // The floating + was catching taps meant for the timeline beside it.
      '#plusBtn{clip-path:circle(50%)}',
    ].join('');
    document.head.appendChild(s);
  }

  function currentPreference() {
    try { return localStorage.getItem('oms_preview_quality') || 'auto'; } catch (e) { return 'auto'; }
  }

  function currentScale() {
    return typeof window.omsPreviewQualityScale === 'function'
      ? Math.round(window.omsPreviewQualityScale() * 100)
      : null;
  }

  const CHOICES = [
    ['auto', 'Automatic', 'Picks a size from the device. Usually the best balance.'],
    ['1', 'Full', 'Sharpest preview, most work per frame.'],
    ['0.75', 'High', '75% of the project size.'],
    ['0.5', 'Balanced', '50%. Noticeably smoother on a phone.'],
    ['0.25', 'Fastest', '25%. Softest preview, least work.'],
  ];

  window.omsPreviewQualitySheet = function () {
    style();
    const host = document.createElement('div');
    host.className = 'omsQSheet';
    const box = document.createElement('div');
    box.className = 'omsQCard';
    const head = document.createElement('div');
    head.className = 'omsQHead';
    const title = document.createElement('b');
    title.textContent = 'Preview quality';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    head.append(title, close);
    const body = document.createElement('div');
    body.className = 'omsQBody';
    box.append(head, body);
    host.appendChild(box);
    document.body.appendChild(host);

    const dismiss = () => host.remove();
    close.addEventListener('click', dismiss);
    host.addEventListener('click', (e) => { if (e.target === host) dismiss(); });

    const buttons = [];
    const paint = () => {
      const pref = currentPreference();
      const scale = currentScale();
      buttons.forEach(({ button, value }) => {
        button.classList.toggle('on', value === pref);
        const mark = button.querySelector('em');
        if (mark) mark.textContent = value === pref ? '\\u2713' : '';
      });
      note.textContent = scale
        ? 'The preview is drawing at ' + scale + '% of the project size. Export always renders at full size.'
        : 'Export always renders at full size.';
    };

    CHOICES.forEach(([value, label, detail]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'omsQOpt';
      const span = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = label;
      const small = document.createElement('small');
      small.textContent = detail;
      span.append(b, small);
      const mark = document.createElement('em');
      button.append(span, mark);
      button.addEventListener('click', () => {
        if (typeof window.omsSetPreviewQuality === 'function') {
          window.omsSetPreviewQuality(value);
        } else {
          try { localStorage.setItem('oms_preview_quality', value); } catch (e) { /* ignore */ }
        }
        paint();
        if (typeof window.toast === 'function') toast('Preview quality: ' + label);
      });
      buttons.push({ button, value });
      body.appendChild(button);
    });

    const note = document.createElement('div');
    note.className = 'omsQNote';
    body.appendChild(note);
    paint();
  };

  // A Settings row, so the control is not only reachable from the tools sheet.
  function addSettingsRow() {
    if (document.getElementById('omsPreviewQualityRow')) return;
    const anchor = document.querySelector('[data-oms-nv="pro"]');
    if (!anchor) return;
    const holder = anchor.closest('.propRow');
    if (!holder || !holder.parentNode) return;
    const row = document.createElement('div');
    row.className = 'propRow';
    row.id = 'omsPreviewQualityRow';
    const label = document.createElement('label');
    label.textContent = 'Preview';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Preview quality';
    button.style.cssText = 'grid-column:span 2;justify-self:start;appearance:none;border:1px solid #2a3240;background:#141821;color:#cfd8e5;font:700 12px/1 system-ui,sans-serif;padding:10px 12px;border-radius:9px';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.omsPreviewQualitySheet();
    });
    row.append(label, button);
    holder.parentNode.insertBefore(row, holder.nextSibling);
  }

  /* Tapping a switch row toggles it. */
  function wireSwitchRows() {
    if (document.__omsSwitchRows) return;
    document.__omsSwitchRows = true;
    const lastTouch = new WeakMap();
    const toggle = (row) => {
      const input = row.querySelector('input[type=checkbox]');
      if (!input || input.disabled) return false;
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* ignore */ }
      return true;
    };
    document.addEventListener('pointerup', (event) => {
      const row = event.target && event.target.closest ? event.target.closest('.switchRow') : null;
      if (!row) return;
      if (event.target.closest('input,select,textarea,button,a')) return;
      if (toggle(row)) lastTouch.set(row, Date.now());
    }, true);
    document.addEventListener('click', (event) => {
      const row = event.target && event.target.closest ? event.target.closest('.switchRow') : null;
      if (!row) return;
      if (event.target.closest('input,select,textarea,button,a')) return;
      // pointerup already handled this tap on devices that send both events.
      const at = lastTouch.get(row);
      if (at && Date.now() - at < 700) return;
      toggle(row);
    }, true);
  }

  function boot() {
    style();
    wireSwitchRows();
    addSettingsRow();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  setTimeout(boot, 1200);
  setInterval(addSettingsRow, 3000);
})();
</script>
`;

export function addQualityAndTapFixes(html) {
  const close = html.lastIndexOf('</html>');
  if (close === -1) return html + QUALITY_AND_TAP_SCRIPT;
  console.log('  quality   preview control + row taps + FAB hit area');
  return html.slice(0, close) + QUALITY_AND_TAP_SCRIPT + html.slice(close);
}

/**
 * The GPU context was configured for screenshots, not for playback.
 *
 * `preserveDrawingBuffer:true` forces the driver to keep a full copy of every frame after
 * it is presented, and `antialias:true` turns on multisampling over the whole composition.
 * Together they are two of the most expensive options a WebGL context accepts, and neither
 * buys anything here: every capture in this editor (PNG export, video export, the colour
 * picker) draws the canvas immediately after `render()` in the same task, which is exactly
 * the case `preserveDrawingBuffer` is not needed for. The preview is also scaled down by
 * CSS, so multisampling is thrown away before it ever reaches the screen.
 */
export function addGpuContextTuning(html) {
  const anchor = "const options={alpha:false,antialias:true,preserveDrawingBuffer:true,premultipliedAlpha:false,powerPreference:'high-performance'};";
  if (!html.includes(anchor)) {
    console.warn('! addGpuContextTuning: context options anchor missing');
    return html;
  }
  const replacement = `// antialias off: the preview canvas is down-scaled by CSS, so MSAA is discarded
    // before it reaches the screen; on a phone it is a large per-frame cost for nothing.
    // preserveDrawingBuffer off: every capture in this app reads the canvas immediately
    // after render(), inside the same task, which is the case it is not required for.
    const options={alpha:false,antialias:false,preserveDrawingBuffer:false,premultipliedAlpha:false,powerPreference:'high-performance'};`;
  let out = html.split(anchor).join(replacement);
  console.log('  gpu       multisampling + buffer copy disabled');
  return out;
}

/**
 * Prevents the preview from flashing to black when the quality changes mid-playback.
 *
 * Assigning `canvas.width` reallocates the drawing buffer, and a reallocated buffer is
 * empty until the next draw. Doing that during playback shows a white or black frame for
 * one or two frames -- a visible glitch on every quality change, and on every resize, which
 * is why the preview looked like it was flickering. The resize is now held until the
 * playhead is not moving, and the canvas is repainted in the same frame as the change when
 * it does happen.
 */
export function addResizeGuard(html) {
  const anchor = 'if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;this.gl.viewport(0,0,w,h);';
  if (!html.includes(anchor)) {
    console.warn('! addResizeGuard: canvas resize anchor missing');
    return html;
  }
  const replacement = `if(this.canvas.width!==w||this.canvas.height!==h){
      // A reallocated drawing buffer is empty until something draws into it. During
      // playback that is a visible flash, so the change waits for the playhead to stop.
      if(model.playing&&!this.exporting&&!this._nativeExportTarget){
        this._omsPendingResize={w,h};
        if(!this._omsResizeResumeHooked){
          this._omsResizeResumeHooked=true;
          try{window.__omsBus?.on?.('playback:stop',()=>{const p=this._omsPendingResize;this._omsPendingResize=null;if(p){this.resize();this.render()}})}catch(e){}
        }
      }else{
        this.canvas.width=w;this.canvas.height=h;this.gl.viewport(0,0,w,h);
        // Repaint in the same frame, so the empty buffer is never presented.
        if(!this.exporting&&!this._nativeExportTarget){try{this.render()}catch(e){}}
      }
    }`;
  let out = html.split(anchor).join(replacement);
  console.log('  preview   canvas resize held while playing');
  return out;
}

/**
 * Easing and the curve graph, reachable in one tap from the inspector.
 *
 * Both already exist: `#transformEaseSide` (the "EASE" button inside Transform) opens the
 * easing editor, and `openGraphEditor` opens the full value/speed graph with Bezier handles
 * and a preset rail. Neither could be found, because the first is two screens deep and
 * refuses to open unless the playhead already sits between two keyframes, and the second
 * is only reachable from the keyframe lane.
 *
 * Three changes, none of which add a second editor:
 *
 *   1. EASE and GRAPH buttons sit on the inspector root, next to the property grid.
 *   2. EASE with no segment no longer dead-ends on a toast; it opens the curve graph, which
 *      is where a segment is actually created.
 *   3. The graph is reachable even from a layer with no keyframes: it says what to do
 *      instead of opening an empty canvas with no explanation.
 */
export const EASE_ACCESS_SCRIPT = `
<script id="oms-ease-access">
(() => {
  'use strict';
  const ROW_ID = 'omsEaseRow';
  const STYLE_ID = 'omsEaseStyle';

  function style() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + ROW_ID + '{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0 2px}',
      '#' + ROW_ID + ' button{appearance:none;min-height:44px;display:flex;align-items:center;',
      'justify-content:center;gap:7px;border:1px solid #2b3444;background:#0f141c;',
      'color:#dfe8f4;font:700 12.5px/1 system-ui,-apple-system,sans-serif;border-radius:12px}',
      '#' + ROW_ID + ' button:active{border-color:#3ad9c6;background:#14212a}',
      '#' + ROW_ID + ' i{font-style:normal;font-size:15px;color:#4fe0cd}',
    ].join('');
    document.head.appendChild(s);
  }

  function ui() { return window.__omsUi || null; }
  function selectedLayer() {
    const m = window.model;
    return m && m.selectedLayer ? m.selectedLayer() : null;
  }
  function toast(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  // Opens the real easing editor. It needs a segment, so if there is none the graph is used
  // instead of a dead end -- the graph is where a segment can be made.
  function openEase() {
    const layer = selectedLayer();
    if (!layer) { toast('Select a layer first'); return; }
    const u = ui();
    if (!u) { toast('The editor is still loading'); return; }
    try {
      u.transformEaseEditorOpen = false;
      u.openInspector('move');
      requestAnimationFrame(() => {
        const hasSegment = typeof u.transformModeHasEaseSegment === 'function'
          ? u.transformModeHasEaseSegment(layer) : false;
        const easeButton = document.getElementById('transformEaseSide');
        if (hasSegment && easeButton) { easeButton.click(); return; }
        // No segment yet: the graph is the place keyframes and easing are created.
        const props = typeof u.transformModeProps === 'function' ? u.transformModeProps(layer) : [];
        u.openGraphEditor && u.openGraphEditor(props[0]);
      });
    } catch (error) {
      toast((error && error.message) || 'The easing editor could not open');
    }
  }

  function openGraph() {
    const layer = selectedLayer();
    if (!layer) { toast('Select a layer first'); return; }
    const u = ui();
    if (!u || typeof u.openGraphEditor !== 'function') { toast('The editor is still loading'); return; }
    try {
      const props = typeof u.transformModeProps === 'function' ? u.transformModeProps(layer) : [];
      const prop = props[0] || null;
      u.openGraphEditor(prop);
      // The graph draws from the keyframe list. A layer with none gets a sentence rather
      // than an empty grid with no way forward.
      const keys = prop && layer.kf && Array.isArray(layer.kf[prop]) ? layer.kf[prop] : [];
      if (keys.length < 2) {
        toast('Add a keyframe with ◇+ in Transform, then the curve appears here');
      }
    } catch (error) {
      toast((error && error.message) || 'The curve editor could not open');
    }
  }

  function addRow() {
    const drawer = document.getElementById('drawer');
    if (!drawer || drawer.querySelector('#' + ROW_ID)) return;
    const grid = drawer.querySelector('.inspectorGrid');
    if (!grid) return;
    style();
    const row = document.createElement('div');
    row.id = ROW_ID;

    const ease = document.createElement('button');
    ease.type = 'button';
    ease.innerHTML = '<i>\\u223f</i>Ease';
    ease.setAttribute('aria-label', 'Ease the keyframes of the selected layer');
    ease.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openEase(); });

    const graph = document.createElement('button');
    graph.type = 'button';
    graph.innerHTML = '<i>\\u2197</i>Graph';
    graph.setAttribute('aria-label', 'Open the curve graph for the selected layer');
    graph.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openGraph(); });

    row.append(ease, graph);
    // Above the property grid: easing is what people look for first.
    grid.insertAdjacentElement('beforebegin', row);
  }

  function watch() {
    const drawer = document.getElementById('drawer');
    if (!drawer) return;
    try { new MutationObserver(addRow).observe(drawer, { childList: true, subtree: true }); } catch (e) { /* interval covers it */ }
    addRow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  } else {
    watch();
  }
  setTimeout(watch, 1500);
  setInterval(addRow, 2000);
})();
</script>
`;

export function addEaseAccess(html) {
  const close = html.lastIndexOf('</html>');
  if (close === -1) return html + EASE_ACCESS_SCRIPT;
  console.log('  ease      Ease + Graph on the inspector root');
  return html.slice(0, close) + EASE_ACCESS_SCRIPT + html.slice(close);
}
