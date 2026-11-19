/*
 * Renders the 58 shape layers through the core's traceVectorShapePath into PNG contact sheets.
 *
 * Why this exists: area arithmetic caught arithmetic bugs but not "what does it look like".
 * The ring passed a signed-area test while still being a solid disc, because a single contour
 * cannot express a hole and my test could not tell. Looking at pixels can.
 *
 * Run: node shapes-render.mjs  ->  /tmp/shapes-1.png ... (not committed; scratch output)
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import zlib from 'zlib';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://local.test/', runScripts: 'outside-only' });
const w = dom.window;
w.omsShapeState = (layer) => ({ w: layer.w || 200, h: layer.h || 200, shape: layer.shape, points: 5, inner: .46, phase: 0, sides: 6, tip: .5, arrowHead: .35, arrowBody: .28, radius: 10, strokeWidth: 0, lineCap: 'round' });
w.omsAmzBridge = { report() {}, refresh() {} };
w.eval(fs.readFileSync('native-shell/amz-shapes.js', 'utf8'));
const S = w.omsAmzShapes;
const ids = Object.keys(S.SHAPES);

/* ---------- the core's renderer, copied from web/index.html ---------- */
function traceCore(layer) {
  const segs = [];
  const ctx = {
    beginPath() { segs.length = 0; },
    moveTo(x, y) { segs.push(['M', x, y]); },
    bezierCurveTo(a, b, c, d, e, f) { segs.push(['C', a, b, c, d, e, f]); },
    closePath() { segs.push(['Z']); },
  };
  const nodes = layer.vectorNodes || [];
  if (!nodes.length) return segs;
  const pt = (n, k, f) => Number.isFinite(+n?.[k]) ? +n[k] : +n?.[f] || 0;
  const seg = (a, b) => ctx.bezierCurveTo(pt(a, 'outX', 'x'), pt(a, 'outY', 'y'), pt(b, 'inX', 'x'), pt(b, 'inY', 'y'), +(b.x) || 0, +(b.y) || 0);
  ctx.beginPath();
  ctx.moveTo(+(nodes[0].x) || 0, +(nodes[0].y) || 0);
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (layer.vectorClosed && nodes.length > 2) { seg(nodes[nodes.length - 1], nodes[0]); ctx.closePath(); }
  return segs;
}

/* ---------- flatten to line segments ---------- */
function toLines(segs, steps = 20) {
  const lines = [];
  let cur = null;
  for (const s of segs) {
    if (s[0] === 'M') cur = [s[1], s[2]];
    else if (s[0] === 'C') {
      const p0 = cur, [, a, b, c, d] = s, p3 = [s[5], s[6]];
      let prev = p0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        const x = u * u * u * p0[0] + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * p3[0];
        const y = u * u * u * p0[1] + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * p3[1];
        lines.push([prev, [x, y]]); prev = [x, y];
      }
      cur = p3;
    }
  }
  return lines;
}

/* ---------- tiny raster: nonzero winding fill + stroke ---------- */
const CELL = Number(process.env.CELL || 120), COLS = Number(process.env.COLS || 8);
function render(idsPage, closed) {
  const rows = Math.ceil(idsPage.length / COLS);
  const W = COLS * CELL, H = rows * CELL;
  const buf = new Uint8Array(W * H).fill(24);
  idsPage.forEach((id, k) => {
    const ox = (k % COLS) * CELL, oy = Math.floor(k / COLS) * CELL;
    const layer = { w: 100, h: 100, shape: id };
    if (!S.applyVectorPath(layer, id)) return;
    const segs = traceCore(layer);
    /* Local cell coordinates. An earlier version offset these to absolute grid space but then
       scanned locally, so only the top row of each page ever filled and every shape in the
       other rows looked like a hollow outline. */
    const lines = toLines(segs).map(([a, b]) => [
      [10 + a[0] * 0.5, 10 + a[1] * 0.5],
      [10 + b[0] * 0.5, 10 + b[1] * 0.5],
    ]);
    if (layer.vectorClosed) {
      /* scanline, nonzero winding */
      for (let y = 0; y < CELL; y++) {
        const xs = [];
        for (const [a, b] of lines) {
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            xs.push([a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
          }
        }
        xs.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let i = 0; i < xs.length - 1; i++) {
          wind += xs[i][1];
          if (wind !== 0) {
            for (let x = Math.ceil(xs[i][0]); x < Math.floor(xs[i + 1][0]); x++) {
              if (x >= 0 && x < CELL) buf[(oy + y) * W + ox + x] = 235;
            }
          }
        }
      }
    }
    /* always stroke the outline so open shapes are visible */
    for (const [a, b] of lines) {
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let i = 0; i <= n; i++) {
        const x = Math.round(a[0] + (b[0] - a[0]) * i / n), y = Math.round(a[1] + (b[1] - a[1]) * i / n);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < CELL && yy >= 0 && yy < CELL) buf[(oy + yy) * W + ox + xx] = 90;
        }
      }
    }
  });
  return { buf, W, H, idsPage };
}

/* ---------- minimal PNG writer ---------- */
function png({ buf, W, H }, file) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const v = buf[y * W + x];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = v;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xFFFFFFFF;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    const cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const PAGES = Number(process.env.PAGES || 4);
const half = Math.ceil(ids.length / PAGES);
for (let p = 0; p < PAGES; p++) {
  const page = ids.slice(p * half, (p + 1) * half);
  if (!page.length) continue;
  png(render(page), `/tmp/shapes-${p + 1}.png`);
  console.log('page', p + 1, page.length, 'shapes:', page[0], '..', page[page.length - 1]);
}
