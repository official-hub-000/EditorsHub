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

  // The switcher is removed from the document, not just hidden: a later skin rule sets
  // `.languageBtn{display:inline-flex!important}`, which beat the id selector and left an
  // "EN" pill on the home screen that opened a picker this build must not have.
  const trigger =
    /<button id="homeLanguageBtn"[\s\S]{0,600}?<\/button>/;
  if (!trigger.test(out)) throw new Error('language: home language button not found');
  out = out.replace(trigger, '');

  // Everything else that can still reach the picker is hidden as a backstop.
  out = out.replace(
    '</style>',
    '#homeLanguageBtn,#languageQuickBtn,#settingsLanguageRow,' +
      '#homeTopActions .languageBtn,#languageModal{display:none!important}\n</style>'
  );
  return out;
}

export async function patchBranding(indexPath) {
  const html = await readFile(indexPath, 'utf8');
  const { html: renamed, renamed: count } = rebrand(html);
  const out = forceEnglish(singleCredit(renamed));
  await writeFile(indexPath, out, 'utf8');
  return { html: out, renamed: count };
}
