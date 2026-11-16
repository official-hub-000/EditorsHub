#!/usr/bin/env node
/*
 * Prepares the editor bundle that ships inside the Android APK.
 *
 *   web/index.html          upstream Open Motion (single-file editor, vendored read-only)
 *   native-shell/           Android-only adapter scripts (this repository)
 *   vendor/                 locally pinned third-party ESM modules
 *
 * Output: app/src/main/assets/www/  (generated, not committed)
 *
 * The build is deliberately non-destructive: upstream files are copied byte for byte
 * except for these surgical, clearly marked rewrites:
 *
 *  1. `<meta charset>` is moved before the (very large) inline scripts so the document
 *     is decoded as UTF-8 before any of them stream in.
 *  2. The editor's main inline script is wrapped so the Android adapter can replace its
 *     scoped `download(blob, name)` helper (the editor exports PNG/JSON/XML/MP4 through
 *     it, and `window.download` cannot shadow a `const` in that scope).
 *  3. A `<script src="./native-shell.js" defer>` tag is appended so the Android adapter
 *     runs after the editor bootstraps.
 *
 * Remote ES-module imports (medabunny) are rewritten to the vendored copy so export and
 * scrubbing keep working with no network. ONNX Runtime and Google Fonts stay remote on
 * purpose: they are optional features and fetching them must never break startup.
 *
 * Run with: node tools/build-web-assets.mjs
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { patchBranding } from './branding.mjs';
import {
  applyTheme,
  replaceSplash,
  replaceHeaderMark,
  enlargeTinyText,
  removeTapDelay,
  externaliseGraphTextures,
} from './theme.mjs';
import { markSvg, splashMarkup } from './brand-art.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'web');
const shellDir = path.join(root, 'native-shell');
const vendorDir = path.join(root, 'vendor');
const outDir = path.join(root, 'app', 'src', 'main', 'assets', 'www');

const MEDIABUNNY_CDN = 'https://cdn.jsdelivr.net/npm/mediabunny@1.52.2/+esm';
const MEDIABUNNY_LOCAL = './vendor/mediabunny/mediabunny.mjs';

/** Moves `<meta charset>` to the very top of <head> if it is not already there. */
function hoistCharset(html) {
  const charsetRe = /<meta\s+charset=["']?([\w-]+)["']?\s*\/?>/i;
  const match = html.match(charsetRe);
  if (!match) return html;
  const headIndex = html.search(/<head[^>]*>/i);
  const headEnd = html.indexOf('>', headIndex) + 1;
  if (headIndex === -1) return html;
  const alreadyFirst = html.slice(headEnd).trimStart().toLowerCase().startsWith(match[0].toLowerCase());
  if (alreadyFirst) return html;
  const withoutCharset = html.replace(match[0], '');
  const insertAt = withoutCharset.search(/<head[^>]*>/i);
  const insertEnd = withoutCharset.indexOf('>', insertAt) + 1;
  return (
    withoutCharset.slice(0, insertEnd) +
    `\n<meta charset="${match[1]}">` +
    withoutCharset.slice(insertEnd)
  );
}

/** Rewrites the pinned CDN module specifier to the vendored file. */
function localiseVendorImports(html, { vendoredMediabunny }) {
  if (!vendoredMediabunny) return html;
  return html.split(MEDIABUNNY_CDN).join(MEDIABUNNY_LOCAL);
}

/**
 * The editor funnels every file export (MP4, PNG frame, JSON package, Alight Motion
 * XML, presets) through this scoped helper:
 *
 *   const download=(blob,name)=>{const a=document.createElement('a');a.href=...;a.click();...}
 *
 * Android WebView cannot write to the Downloads folder and silently drops such
 * downloads, so the helper is pointed at the native save pipeline. This is an exact
 * string replacement of one upstream line: if upstream ever edits it the build prints a
 * loud warning and the runtime anchor interceptor in native-shell.js still covers it.
 */
const DOWNLOAD_DECL =
  "const download=(blob,name)=>{const a=document.createElement('a');" +
  "a.href=URL.createObjectURL(blob);a.download=name;a.click();" +
  "setTimeout(()=>URL.revokeObjectURL(a.href),2000)};";

const DOWNLOAD_PATCHED =
  "const download=(blob,name)=>{try{if(window.omsNativeShell&&window.omsNativeShell.saveBlobAs)" +
  "return window.omsNativeShell.saveBlobAs(blob,name,(blob&&blob.type)||'')}catch(e){}" +
  "const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;" +
  "a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)};";

function patchEditorScope(html) {
  const hits = html.split(DOWNLOAD_DECL).length - 1;
  if (hits === 1) return html.split(DOWNLOAD_DECL).join(DOWNLOAD_PATCHED);
  if (hits === 0) {
    console.warn(
      '! upstream download helper changed — native-shell.js anchor interceptor will handle exports'
    );
    return html;
  }
  console.warn(`! download helper matched ${hits} times — left untouched`);
  return html;
}

function injectShell(html) {
  if (html.includes('native-shell.js')) return html;
  const tag =
    '<script src="./selftest.js" defer id="oms-selftest"></script>\n' +
    '<script src="./diagnostics.js" defer id="oms-diagnostics"></script>\n' +
    '<script src="./native-shell.js" defer id="oms-native-shell"></script>\n';
  // The upstream document keeps a large trailing <style> block after </body>, so the
  // tag is anchored on the closing </html> instead: defer still guarantees the adapter
  // runs after the editor has bootstrapped.
  const htmlClose = html.lastIndexOf('</html>');
  const anchor = htmlClose === -1 ? html.lastIndexOf('</body>') : htmlClose;
  if (anchor === -1) return html + '\n' + tag;
  return html.slice(0, anchor) + tag + html.slice(anchor);
}

/**
 * Maps code-point offsets to JavaScript (UTF-16) offsets.
 *
 * The edit list is produced by Python, which counts code points; `String.prototype.slice`
 * counts UTF-16 code units, so every astral character before an edit (emoji in the UI)
 * would shift it by one. `codepoints` holds the code-point index of each such character.
 */
function makeIndexMapper(html) {
  const codepoints = [];
  const astral = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  let match;
  let seen = 0;
  while ((match = astral.exec(html)) !== null) {
    codepoints.push(match.index - seen);
    seen += 1;
  }
  if (codepoints.length === 0) return (i) => i;
  return (cp) => {
    let lo = 0;
    let hi = codepoints.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (codepoints[mid] < cp) lo = mid + 1;
      else hi = mid;
    }
    return cp + lo;
  };
}

/**
 * Applies tools/i18n/edits.json to the document.
 *
 * The edit list was computed against one exact revision of web/index.html; the recorded
 * SHA-256 is verified first so a drifted document fails the build instead of silently
 * getting translations spliced into the wrong offsets.
 */
function applyTranslations(html) {
  const editsPath = path.join(root, 'tools', 'i18n', 'edits.json');
  let payload;
  try {
    payload = JSON.parse(readFileSync(editsPath, 'utf8'));
  } catch (error) {
    console.warn(`! translations skipped: ${error.message} (run python3 tools/i18n/build-edits.py)`);
    return html;
  }
  const digest = createHash('sha256').update(html, 'utf8').digest('hex');
  if (digest !== payload.source_sha256) {
    throw new Error(
      'translations: edits.json was built against a different web/index.html\n' +
        `  recorded ${payload.source_sha256}\n  current  ${digest}\n` +
        '  re-run: python3 tools/i18n/build-edits.py'
    );
  }
  if (payload.offsets === 'codepoints') {
    const toUtf16 = makeIndexMapper(html);
    const out = [];
    let cursor = 0;
    for (const [start, end, replacement] of payload.edits) {
      const from = toUtf16(start);
      const to = toUtf16(end);
      out.push(html.slice(cursor, from), replacement);
      cursor = to;
    }
    out.push(html.slice(cursor));
    const result = out.join('');
    console.log(
      `  translations ${payload.stats.edits.toLocaleString()} edits ` +
        `(${payload.stats.dictionary_markup} markup + ${payload.stats.dictionary_script} runtime entries)`
    );
    return result;
  }
  const out = [];
  let cursor = 0;
  for (const [start, end, replacement] of payload.edits) {
    out.push(html.slice(cursor, start), replacement);
    cursor = end;
  }
  out.push(html.slice(cursor));
  const result = out.join('');
  console.log(
    `  translations ${payload.stats.edits.toLocaleString()} edits ` +
      `(${payload.stats.dictionary_markup} markup + ${payload.stats.dictionary_script} runtime entries)`
  );
  return result;
}

async function main() {
  const started = Date.now();
  const indexPath = path.join(webDir, 'index.html');
  const raw = await readFile(indexPath, 'utf8');

  let vendoredMediabunny = false;
  try {
    await stat(path.join(vendorDir, 'mediabunny', 'mediabunny.mjs'));
    vendoredMediabunny = true;
  } catch {
    console.warn('! vendor/mediabunny missing — export will fall back to the CDN');
  }

  // Translations are applied to the raw document first: their offsets were computed
  // against this exact revision, so any earlier rewrite would invalidate them.
  let html = hoistCharset(applyTranslations(raw));
  html = localiseVendorImports(html, { vendoredMediabunny });
  html = patchEditorScope(html);
  html = injectShell(html);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');
  const branding = await patchBranding(path.join(outDir, 'index.html'));
  html = branding.html;

  // Splash art, header mark and the AMOLED/motion sheet are applied after branding so
  // they land on the finished document and can key off the final class names.
  html = replaceHeaderMark(markSvg('header', 38))(html);
  html = replaceSplash(splashMarkup())(html);
  html = enlargeTinyText(html);
  html = removeTapDelay(html);
  html = applyTheme(html);

  // The graph textures are the single largest lump in the document; they are written as
  // files and referenced by URL so startup does not decode 2.8 MB of base64.
  const textures = externaliseGraphTextures()(html);
  html = textures.html;
  const res252 = path.join(outDir, 'res252');
  await mkdir(res252, { recursive: true });
  for (const [, asset] of textures.assets) {
    const comma = asset.uri.indexOf(',');
    await writeFile(path.join(res252, asset.file), Buffer.from(asset.uri.slice(comma + 1), 'base64'));
  }
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8');

  // PWA extras (icon set, manifest, service worker) are kept so the bundle is a complete
  // web build too, even though the native shell supersedes the install surface.
  for (const extra of ['manifest.webmanifest', 'sw.js']) {
    await cp(path.join(webDir, extra), path.join(outDir, extra));
  }
  await cp(path.join(webDir, 'icons'), path.join(outDir, 'icons'), { recursive: true });

  await cp(path.join(shellDir, 'native-shell.js'), path.join(outDir, 'native-shell.js'));
  await cp(path.join(shellDir, 'diagnostics.js'), path.join(outDir, 'diagnostics.js'));
  await cp(path.join(shellDir, 'selftest.js'), path.join(outDir, 'selftest.js'));

  if (vendoredMediabunny) {
    await cp(
      path.join(vendorDir, 'mediabunny'),
      path.join(outDir, 'vendor', 'mediabunny'),
      { recursive: true }
    );
  }

  const digest = createHash('sha256').update(html).digest('hex').slice(0, 12);
  const sizeMb = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(2);
  console.log(`Open Motion bundle ready in ${outDir}`);
  console.log(`  index.html   ${sizeMb} MB  sha256:${digest}`);
  console.log(`  mediabunny   ${vendoredMediabunny ? 'vendored (offline)' : 'CDN'}`);
  console.log(`  shell        native-shell.js injected, download() patched`);
  console.log(`  elapsed      ${Date.now() - started} ms`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
