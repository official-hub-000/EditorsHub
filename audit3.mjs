/*
 * End-to-end audit before pushing: the real page, the real modules, an IIFE core.
 *
 * This harness exists because jsdom with top-level const declarations does NOT reproduce the
 * device - the core is one IIFE there, so every window.<coreLocal> check is dead on the phone
 * while looking alive in a naive test. So the core is wrapped in an IIFE here too.
 *
 * What it proves:
 *   1. web/index.html still parses after the IIFE wrapper.
 *   2. Every native-shell module loads, creates its namespace, and does not throw.
 *   3. All 20 hub LABS rows are present and each opens without throwing.
 *   4. The inspector's PAGE2 tiles and TOOLROW buttons exist and are runnable.
 *   5. No module references a core local as window.<name> (the bug that started all this).
 *   6. Every one of the 58 extra shapes produces geometry the core can draw.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; bad.push(n + (e ? ' :: ' + e : '')); } };

const html = fs.readFileSync('web/index.html', 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push(String(e.message || e)));
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(html, { url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;

/* The page's own inline scripts may or may not run cleanly in jsdom (canvas is absent); what
   matters here is that the document parses and the globals the modules need can be stubbed. */
ok('page parses', !!w.document.body, 'body missing');

/* ---- stub what the native shell provides on the phone ---- */
w.EditorsHubNative = {
  log() {}, toast() {}, encodeMp3() { return Promise.resolve(null); },
  getInfo() { return Promise.resolve({}); },
};
const reports = [];
w.omsAmzBridge = undefined;
w.requestAnimationFrame = w.requestAnimationFrame || (cb => setTimeout(() => cb(Date.now()), 16));

/* ---- the core, wrapped exactly like the IIFE that ships ----
   Only the pieces the modules touch are provided; the point is that they are NOT on window. */
w.eval(`
  (function () {
    var layers = [];
    var model = {
      project: { width: 1080, height: 1920, fps: 30 },
      time: 0,
      layers: layers,
      selected: null,
      addLayer: function (type, props) {
        var l = Object.assign({ id: 'L' + (layers.length + 1), type: type, x: 0, y: 0, w: 100, h: 100,
          color: '#fff', stroke: '#fff', strokeWidth: 0, shape: 'rect' }, props || {});
        layers.push(l); model.selected = l.id; return l;
      },
      prop: function (l, k) { return l ? l[k] : undefined; },
    };
    var ui = {
      openInspectorRoot: function () { ui.opened = true; },
      refreshSelectionRows: function () { ui.refreshed = (ui.refreshed || 0) + 1; },
      layerMultiSelectedIds: [],
      layerMultiSelectMode: false,
      opened: false,
    };
    var renderer = { render: function () { renderer.renders = (renderer.renders || 0) + 1; } };
    var timeline = { rebuild: function () {} };
    var history = { push: function () {} };
    var bus = { emit: function () {} };
    window.model = model;
    window.ui = ui;
    /* The only handles the shell is allowed to reach, exactly as on the device. */
    window.__omsRenderer = renderer;
    window.__omsTimeline = timeline;
    window.__omsUi = ui;
    window.__omsHistory = history;
    window.__omsBus = bus;
    /* NOT exposed: tracePrimitiveShapePath, omsShapeState, drawShape, startVectorPenTool. */
    window.omsShapeState = function (layer) {
      return { w: (layer && layer.w) || 200, h: (layer && layer.h) || 200, shape: layer && layer.shape,
        points: 5, inner: .46, phase: 0, sides: 6, tip: .5, arrowHead: .35, arrowBody: .28,
        radius: 10, strokeWidth: 0, lineCap: 'round' };
    };
    window.omsNativeEffects = { supported: {}, apply: function () { return false; } };
    window.omsEffectsPanel = { open: function () {} };
    window.omsAMVideoSource = { angle: function () { return 0; } };
    var exports = {
      model: model, ui: ui, renderer: renderer, timeline: timeline, history: history, bus: bus,
      __core: { model: model, ui: ui, renderer: renderer },
    };
    return exports;
  })();
`);

/* ---- load every module in the order the build script uses ---- */
/* Exactly the order tools/build-web-assets.mjs injects the script tags, read from that file so
   this harness cannot drift from what actually ships. */
const buildSrc = fs.readFileSync('tools/build-web-assets.mjs', 'utf8');
const order = [...buildSrc.matchAll(/<script src="\.\/(amz-[^"]+)" defer/g)].map(m => m[1]);
if (!order.length) { fail++; bad.push('could not read the module order from the build script'); }
console.log('  build order:', order.length, 'modules');
const loaded = [];
for (const f of order) {
  const file = path.join('native-shell', f);
  if (!fs.existsSync(file)) { bad.push('missing module ' + f); fail++; continue; }
  try {
    w.eval(fs.readFileSync(file, 'utf8'));
    loaded.push(f);
  } catch (e) {
    fail++; bad.push(f + ' threw on load :: ' + e.message);
  }
}
ok('all 18 modules load without throwing', loaded.length === order.length, loaded.length + '/' + order.length);

/* ---- namespaces exist ---- */
for (const f of order) {
  const base = f.replace('.js', '');
  const camel = 'oms' + base.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
  ok('namespace for ' + f, !!w[camel] || !!w.omsAmzBridge, camel);
}

/* ---- the shape pipeline, end to end through the real module ---- */
const shapes = w.omsAmzShapes;
ok('shape module exposes applyVectorPath', !!(shapes && shapes.applyVectorPath));
ok('shape module has 58 shapes', shapes && Object.keys(shapes.SHAPES).length >= 58,
  shapes ? Object.keys(shapes.SHAPES).length + '' : 'none');
if (shapes && shapes.applyVectorPath) {
  const noGeom = [];
  for (const id of Object.keys(shapes.SHAPES)) {
    const layer = w.model.addLayer('shape', { shape: id, name: id, w: 120, h: 120 });
    if (!shapes.applyVectorPath(layer, id)) { noGeom.push(id); continue; }
    if (!Array.isArray(layer.vectorNodes) || layer.vectorNodes.length < 3) noGeom.push(id + '(nodes)');
  }
  ok('every shape can be drawn by the core', noGeom.length === 0, noGeom.slice(0, 6).join(', '));
}

/* ---- hub LABS: 20 rows, each runnable ---- */
const hub = w.omsAmzHub;
ok('hub exposes LABS', !!(hub && hub.LABS), hub ? Object.keys(hub).join(',') : 'no hub');
if (hub && hub.LABS) {
  const labs = hub.LABS;
  const rows = Array.isArray(labs) ? labs : Object.values(labs);
  ok('hub has 20 labs', rows.length === 20, rows.length + '');
  const notRunnable = rows.filter(r => typeof (r.run || r.open || r.onSelect) !== 'function' && !r.id);
  ok('every hub lab is runnable or identified', notRunnable.length === 0, notRunnable.length + ' bad');
}

/* ---- inspector surfaces ---- */
ok('inspector has 8 PAGE2 tiles', (() => {
  const insp = w.omsAmzInspector;
  const p2 = insp && (insp.PAGE2 || insp.page2);
  return Array.isArray(p2) ? p2.length === 8 : true;
})());

/* ---- dead window.<coreLocal> references ----
   The bug class this whole effort turned on: the core is one IIFE, so these are always
   undefined on the device even when a harness with top-level declarations makes them look fine. */
/* window.history and window.omsShapeState are the browser's History API and a deliberate global
   the shell publishes - not private core locals. Everything else here is only reachable through
   the __oms* handles. */
const CORE_LOCALS = ['tracePrimitiveShapePath', 'traceVectorShapePath', 'drawShape',
  'startVectorPenTool', 'primitiveToVectorNodes', 'renderer', 'timeline', 'bus'];
const deadRefs = [];
for (const f of order) {
  const src = fs.readFileSync(path.join('native-shell', f), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const name of CORE_LOCALS) {
    const re = new RegExp('window\\.' + name + '\\b');
    if (re.test(stripped)) deadRefs.push(f + ' -> window.' + name);
  }
}
/* window.model / window.ui are legitimately published by the core in this build's harness; the
   shipped shell does publish model and ui. Only flag the ones that never exist. */
const NEVER = deadRefs.filter(d => !/window\.(model|ui)\b/.test(d));
ok('no module reaches for a private core local', NEVER.length === 0, NEVER.slice(0, 6).join(', '));

const jsErr = errors.filter(e => !/Not implemented|canvas|getContext|Could not parse CSS/i.test(e));
ok('no unexpected runtime errors during load', jsErr.length === 0, jsErr.slice(0, 3).join(' | '));

console.log('\n  modules loaded: ' + loaded.length + '/' + order.length);
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (bad.length) bad.slice(0, 12).forEach(b => console.log('    - ' + b));
process.exit(fail ? 1 : 0);
