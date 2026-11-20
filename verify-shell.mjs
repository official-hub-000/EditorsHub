/*
 * Regression test: hub sheet footer buttons must dismiss the sheet even when the
 * footer spec has no onClick (the plain `footer:[{label:'Close'}]` pattern), and the
 * adjustment module must install on the published renderers.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';

const PAGE = 'app/src/main/assets/www/index.html';
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { const m = String(e.message || e); if (!/getContext|Not implemented|matchMedia|CanvasRenderingContext2D/.test(m)) errs.push(m.slice(0, 180)); });

const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'),
  { url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
await new Promise(r => setTimeout(r, 1200));

const buildSrc = fs.readFileSync('tools/build-web-assets.mjs', 'utf8');
const modules = [...buildSrc.matchAll(/\.\/(amz-[^"]+)" defer/g)].map(m => m[1]);
for (const m of modules) {
  const f = 'native-shell/' + m;
  if (fs.existsSync(f)) { try { w.eval(fs.readFileSync(f, 'utf8')); } catch (e) { /* counted below */ } }
}
await new Promise(r => setTimeout(r, 300));

let fail = 0;
const ok = (n, c, e = '') => { if (!c) { fail++; console.log('  FAIL ' + n + (e ? ' :: ' + e : '')); } else console.log('  ok   ' + n); };

// 1. renderer publication
ok('__omsRenderer published', !!w.__omsRenderer, 'WebGLRenderer instance missing');
ok('__omsTimeline published', !!w.__omsTimeline);
ok('__omsBus published', !!w.__omsBus);

// 2. adjustment module installed (GL overlay mode in jsdom: no real GL context)
await new Promise(r => setTimeout(r, 800));
ok('adjust module loaded', !!w.omsAmzAdjust);
ok('adjust installed', !!(w.omsAmzAdjust && w.omsAmzAdjust.installed));
ok('post-frame hook wired', typeof w.omsPostFrame === 'function');

// 3. footer Close buttons dismiss their sheet
const hub = w.omsAmzHub;
ok('hub loaded', !!hub && typeof hub.sheet === 'function');
if (hub && hub.sheet) {
  const api = hub.sheet({ title: 'Probe', build: () => {}, footer: [{ label: 'Close' }] });
  const wrap = api.element;
  const footerBtns = [...wrap.querySelectorAll('.amzFoot button')];
  ok('footer button exists', footerBtns.length === 1);
  footerBtns[0].click();
  await new Promise(r => setTimeout(r, 250)); // close() removes after 150 ms
  ok('footer Close removed the sheet', !wrap.isConnected);
}

// 4. the × button still closes
if (hub && hub.sheet) {
  const api = hub.sheet({ title: 'Probe2', build: () => {}, footer: [] });
  const x = api.element.querySelector('.amzX');
  x.click();
  await new Promise(r => setTimeout(r, 250));
  ok('× removed the sheet', !api.element.isConnected);
}

// 5. service worker registration is guarded out of the native shell
ok('SW registration guarded', !/if\('serviceWorker' in navigator/.test(
  fs.readFileSync(PAGE, 'utf8').replace(/!window\.EditorsHubNative&&!window\.OpenMotionNative&&'serviceWorker' in navigator/g, '')));

console.log(fail ? `\n  ${fail} FAILURES` : '\n  all checks passed');
process.exit(fail ? 1 : 0);
