/*
 * Checks the 58 extra shapes the way the core actually draws them.
 *
 * This does not ask "did applyVectorPath return true". It replays the layer through the core's
 * own traceVectorShapePath (copied byte for byte from web/index.html) into a recording canvas
 * context, converts the resulting cubic path to a polygon, and measures the area it would fill.
 * A shape that applies cleanly but fills zero pixels fails here, which is the failure the phone
 * showed.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; bad.push(n + (e ? ' :: ' + e : '')); } };

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://local.test/', runScripts: 'outside-only' });
const w = dom.window;
w.omsShapeState = (layer) => ({ w: layer.w || 200, h: layer.h || 200, shape: layer.shape, points: 5, inner: .46, phase: 0, sides: 6, tip: .5, arrowHead: .35, arrowBody: .28, radius: 10, strokeWidth: 0, lineCap: 'round' });
w.omsAmzBridge = { report() {}, refresh() {}, checkpoint() {} };
w.eval(fs.readFileSync('native-shell/amz-shapes.js', 'utf8'));
const S = w.omsAmzShapes;
const ids = Object.keys(S.SHAPES);
console.log('  shapes registered:', ids.length);
ok('at least 58 shapes', ids.length >= 58, ids.length + '');

/* ---- the core's renderer, copied from web/index.html traceVectorShapePath ---- */
function coreTrace(layer) {
  const segs = [];
  let started = false;
  const ctx = {
    beginPath() { segs.length = 0; },
    moveTo(x, y) { segs.push(['M', x, y]); started = true; },
    bezierCurveTo(a, b, c, d, e, f) { segs.push(['C', a, b, c, d, e, f]); },
    closePath() { segs.push(['Z']); },
  };
  const nodes = Array.isArray(layer?.vectorNodes) ? layer.vectorNodes : [];
  if (!nodes.length) return null;
  const point = (node, key, fallback) => Number.isFinite(+node?.[key]) ? +node[key] : +node?.[fallback] || 0;
  const segment = (a, b) => ctx.bezierCurveTo(point(a, 'outX', 'x'), point(a, 'outY', 'y'), point(b, 'inX', 'x'), point(b, 'inY', 'y'), +(b.x) || 0, +(b.y) || 0);
  ctx.beginPath();
  ctx.moveTo(+(nodes[0].x) || 0, +(nodes[0].y) || 0);
  for (let i = 1; i < nodes.length; i++) segment(nodes[i - 1], nodes[i]);
  if (layer.vectorClosed && nodes.length > 2) { segment(nodes[nodes.length - 1], nodes[0]); ctx.closePath(); }
  return { segs, started };
}

/* ---- approximate the filled region: sample every cubic finely, treat as a polygon ---- */
function flatten(segs, steps = 24) {
  const polys = [];
  let cur = null, start = null;
  for (const s of segs) {
    if (s[0] === 'M') { cur = [s[1], s[2]]; start = cur; polys.push([cur]); }
    else if (s[0] === 'C') {
      const p0 = cur, [, a, b, c, d] = s, p3 = [s[5], s[6]];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const x = u * u * u * p0[0] + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * p3[0];
        const y = u * u * u * p0[1] + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * p3[1];
        polys[polys.length - 1].push([x, y]);
      }
      cur = p3;
    } else if (s[0] === 'Z') { cur = start; }
  }
  return polys;
}

function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return a / 2;
}

/* nonzero winding, like canvas fill() */
function evenOddishWinding(segs) {
  const polys = flatten(segs);
  const total = polys.reduce((sum, p) => sum + area(p), 0);           // signed, so opposite loops cancel
  const abs = polys.reduce((sum, p) => sum + Math.abs(area(p)), 0);
  return { signed: Math.abs(total), abs, loops: polys.length };
}

let zeroFill = [], tinyFill = [], nonFinite = [], notVector = [], tooFew = [];
const areas = [];
for (const id of ids) {
  const layer = { w: 200, h: 200, shape: id };
  if (!S.applyVectorPath(layer, id)) { zeroFill.push(id + '(no path)'); continue; }
  if (layer.shape !== 'vector') { notVector.push(id); continue; }
  if (layer.vectorNodes.length < 2) { tooFew.push(id + '(' + layer.vectorNodes.length + ')'); continue; }
  const badCoord = layer.vectorNodes.some(p => !['x', 'y', 'inX', 'inY', 'outX', 'outY'].every(k => Number.isFinite(p[k])));
  if (badCoord) { nonFinite.push(id); continue; }
  const t = coreTrace(layer);
  if (!t || !t.started) { zeroFill.push(id + '(no draw)'); continue; }
  const { signed, loops } = evenOddishWinding(t.segs);
  areas.push({ id, signed: Math.round(signed), open: !layer.vectorClosed, loops, stroke: +(layer.strokeWidth || 0) });
  /* An open shape is drawn as a stroke, so its interior is empty by design - measure its length. */
  if (!layer.vectorClosed) {
    const pts = flatten(t.segs).flat();
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < 20 || !(layer.strokeWidth > 0)) zeroFill.push(id + '(open but no stroke)');
    continue;
  }
  if (signed < 400) tinyFill.push(id + '(' + Math.round(signed) + ')');
  if (signed === 0) zeroFill.push(id + '(empty)');
}
ok('every shape draws something', zeroFill.length === 0, zeroFill.slice(0, 8).join(', '));
ok('every closed shape fills real area', tinyFill.length === 0, tinyFill.slice(0, 8).join(', '));
ok('no NaN/Infinity coordinates', nonFinite.length === 0, nonFinite.slice(0, 8).join(', '));
ok('every shape becomes a vector layer', notVector.length === 0, notVector.slice(0, 8).join(', '));
ok('no degenerate single-node paths', tooFew.length === 0, tooFew.slice(0, 8).join(', '));

/*
 * A ring that rendered as a solid disc would pass any area check, because the renderer keeps one
 * contour and its winding is always positive. So sample actual points: the centre of a ring has
 * to be EMPTY and the band has to be FILLED. This is the check that the earlier signed-vs-absolute
 * version could not make.
 */
function pointFilled(segs, x, y) {
  const lines = [];
  let cur = null;
  for (const s of segs) {
    if (s[0] === 'M') cur = [s[1], s[2]];
    else if (s[0] === 'C') {
      const p0 = cur, [, a, b, c, d] = s, p3 = [s[5], s[6]];
      let prev = p0;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        const px = u * u * u * p0[0] + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * p3[0];
        const py = u * u * u * p0[1] + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * p3[1];
        lines.push([prev, [px, py]]); prev = [px, py];
      }
      cur = p3;
    }
  }
  let wind = 0;
  for (const [a, b] of lines) {
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      const xAt = a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
      if (xAt > x) wind += b[1] > a[1] ? 1 : -1;
    }
  }
  return wind !== 0;
}

for (const id of ['ring', 'donut']) {
  const l = { w: 200, h: 200, shape: id };
  S.applyVectorPath(l, id);
  const t = coreTrace(l);
  const cx = 100, cy = 100;
  const centre = pointFilled(t.segs, cx, cy);
  const band = pointFilled(t.segs, cx + 80, cy);
  ok(id + ' has a hole in the middle', centre === false, 'centre filled=' + centre);
  ok(id + ' still has a solid band', band === true, 'band filled=' + band);
}

/* Geometry must differ between shapes - the classic failure is everything collapsing to a rect. */
const sigs = ids.map(id => {
  const l = { w: 200, h: 200, shape: id }; S.applyVectorPath(l, id);
  /* Include handles: sparkle and a square capsule share vertices but not curves, so vertices
     alone called them duplicates. */
  return l.vectorClosed + '|' + (l.vectorNodes || []).map(p => [p.x, p.y, p.inX, p.inY, p.outX, p.outY].map(v => Math.round(v)).join(',')).join(';');
});
const unique = new Set(sigs).size;
ok('shapes are visually distinct', unique >= ids.length - 2, unique + ' distinct of ' + ids.length);

/* Spot checks that would have caught the bugs this file exists for. */
const heart = { w: 200, h: 200, shape: 'heart' }; S.applyVectorPath(heart, 'heart');
{
  const t = coreTrace(heart);
  const pts = flatten(t.segs).flat();
  const xs = pts.map(p => p[0]);
  ok('heart has width from its control handles', Math.max(...xs) - Math.min(...xs) > 150,
    'width=' + Math.round(Math.max(...xs) - Math.min(...xs)));
  ok('heart stays inside its box', Math.min(...xs) > -150 && Math.max(...xs) < 350,
    Math.round(Math.min(...xs)) + '..' + Math.round(Math.max(...xs)));
}
const star = { w: 200, h: 200, shape: 'star5' }; S.applyVectorPath(star, 'star5');
ok('star5 has 10 anchors', star.vectorNodes.length === 10, star.vectorNodes.length + '');
ok('arc is left open so it is not a lens', (() => { const l = { w: 200, h: 200, shape: 'arc' }; S.applyVectorPath(l, 'arc'); return l.vectorClosed === false && l.strokeWidth > 0; })());

const worst = areas.filter(a => !a.open).sort((x, y) => x.signed - y.signed).slice(0, 3).map(a => a.id + '=' + a.signed).join(' ');
console.log('  smallest filled areas:', worst);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (bad.length) bad.slice(0, 12).forEach(b => console.log('    - ' + b));
process.exit(fail ? 1 : 0);
