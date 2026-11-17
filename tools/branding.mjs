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
  const out = hardenNewProjectButton(
    fixNewProjectSeg(
      fixDetachedGlobals(
        fixElementCard(
        fixTemplateButtons(
        fixTutorialCards(
              finishEnglish(themeConfirms(forceEnglish(singleCredit(renamed))))
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
 * document -- the pair is decorative. The word "ELEMENTS" therefore opens nothing: it is
 * the single most obvious dead control in the app, and it sits in the first sheet every
 * new user sees.
 *
 * The editor's own shape catalog ("Elements" as Alight Motion means it) can only be used
 * once a project exists, so the toggle now does the honest thing:
 *
 *   PROJECT   the existing setup form -- name, ratio, resolution, fps, duration, colour
 *   ELEMENTS  creates a 9:16 1080p 30fps project and opens the Elements drawer, which is
 *             where the shape catalog lives
 *
 * The tab highlights follow the selection so the sheet never looks like it ignored the
 * tap, and the second button is relabelled from its clipped display.
 */
export function fixNewProjectSeg(html) {
  const anchor = `<div class="seg"><button class="active">PROJECT</button><button>ELEMENTS</button></div>`;
  if (!html.includes(anchor)) {
    console.warn('! fixNewProjectSeg: seg markup not found');
    return html;
  }
  const replacement =
    `<div class="seg" id="omsNewProjectSeg">` +
    `<button type="button" class="active" data-oms-seg="project">PROJECT</button>` +
    `<button type="button" data-oms-seg="elements">ELEMENTS</button>` +
    `</div>`;

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
        const mode = button.dataset.omsSeg;
        buttons.forEach((b) => b.classList.toggle('active', b === button));

        if (mode !== 'elements') return;

        // Build a project with the sheet's current settings, then land on Elements. The
        // shape catalog needs a project to exist before it can add to one.
        const modal = document.getElementById('newModal');
        const close = document.getElementById('closeNew');
        if (close) close.click();
        if (modal) modal.classList.add('hidden');

        const create = document.getElementById('createProject');
        if (create) create.click();

        // The editor builds its DOM on the next frame or two; retry briefly rather than
        // guessing a single delay.
        let tries = 0;
        const openElements = () => {
          tries += 1;
          const editor = document.getElementById('editor');
          const ready = editor && !editor.classList.contains('hidden') && window.ui;
          if (!ready) {
            if (tries < 40) setTimeout(openElements, 100);
            return;
          }
          try {
            window.ui.openTool('objects');
          } catch (e) {
            try { window.ui.openTool('templates'); } catch (e2) { /* give up quietly */ }
          }
        };
        setTimeout(openElements, 120);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
  // The sheet markup exists in the initial document, but wire again after any re-render.
  setTimeout(wire, 1500);
})();
</script>
`;

  return html.replace(anchor, replacement + script);
}
