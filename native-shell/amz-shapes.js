/*
 * Extra shapes.
 *
 * Two halves, both necessary: a path generator so the renderer can draw them, and a picker
 * entry so they can be chosen. A shape that only appears in the picker draws nothing; a shape
 * that only draws is unreachable.
 *
 * Geometry is normalised to the layer box (offsetX..offsetX+w, offsetY..offsetY+h) so every
 * shape obeys the same width, height, rotation and keyframes as the existing ones. The star,
 * polygon, arrow and line shapes take their parameter counts from omsShapeState, so a custom
 * point count still works where it makes sense.
 */
(function () {
  'use strict';
  if (window.omsAmzShapes) return;

  var SHAPES = {};

  /* ---------------------------------------------------------------- path helpers */

  /**
   * Builds an ellipse-like ring of points.
   * @param n      point count
   * @param inner  inner radius fraction for star-like shapes (1 = circle)
   */
  function ring(cx, cy, rx, ry, n, inner, phase) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = phase + (i * Math.PI * 2) / n;
      var r = inner === 1 ? 1 : (i % 2 === 0 ? 1 : inner);
      pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
    }
    return pts;
  }

  function polar(cx, cy, rx, ry, angleDeg, radius) {
    var a = (angleDeg - 90) * Math.PI / 180;
    return [cx + Math.cos(a) * rx * (radius == null ? 1 : radius), cy + Math.sin(a) * ry * (radius == null ? 1 : radius)];
  }

  function trace(ctx, pts, close) {
    if (!pts.length) return;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close !== false) ctx.closePath();
  }

  /* Corners inset by `k` of the half-extent, used by the four-pointed shapes. */
  function pinch(cx, cy, rx, ry, k) {
    return [
      [cx, cy - ry], [cx + rx * k, cy - ry * k], [cx + rx, cy],
      [cx + rx * k, cy + ry * k], [cx, cy + ry], [cx - rx * k, cy + ry * k],
      [cx - rx, cy], [cx - rx * k, cy - ry * k],
    ];
  }

  /** A petal outline built from four quadratic curves, widened by `spread`. */
  function petal(ctx, cx, cy, rx, ry, spread) {
    var top = [cx, cy - ry], right = [cx + rx * spread, cy];
    var bottom = [cx, cy + ry], left = [cx - rx * spread, cy];
    ctx.moveTo(top[0], top[1]);
    ctx.quadraticCurveTo(cx + rx, cy - ry, right[0], right[1]);
    ctx.quadraticCurveTo(cx + rx, cy + ry, bottom[0], bottom[1]);
    ctx.quadraticCurveTo(cx - rx, cy + ry, left[0], left[1]);
    ctx.quadraticCurveTo(cx - rx, cy - ry, top[0], top[1]);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------- the shapes */

  register('squircle', function (ctx, s) {
    var o = s.offset, w = s.w, h = s.h, cx = s.cx, cy = s.cy;
    var k = Math.min(w, h) * 0.28;
    ctx.moveTo(o.x + k, o.y);
    ctx.lineTo(o.x + w - k, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y, o.x + w, o.y + k);
    ctx.lineTo(o.x + w, o.y + h - k);
    ctx.quadraticCurveTo(o.x + w, o.y + h, o.x + w - k, o.y + h);
    ctx.lineTo(o.x + k, o.y + h);
    ctx.quadraticCurveTo(o.x, o.y + h, o.x, o.y + h - k);
    ctx.lineTo(o.x, o.y + k);
    ctx.quadraticCurveTo(o.x, o.y, o.x + k, o.y);
    ctx.closePath();
  });

  register('star4', function (ctx, s) {
    var ctxPts = pinch(s.cx, s.cy, s.rx, s.ry, 0.18);
    trace(ctx, ctxPts);
  });

  register('star5', function (ctx, s) {
    trace(ctx, ring(s.cx, s.cy, s.rx, s.ry, 10, s.inner, (s.phase - 90) * Math.PI / 180));
  });

  register('star6', function (ctx, s) {
    var pts = [];
    for (var i = 0; i < 12; i++) {
      var a = (s.phase - 90 + i * 30) * Math.PI / 180;
      var r = i % 2 ? s.inner : 1;
      pts.push([s.cx + Math.cos(a) * s.rx * r, s.cy + Math.sin(a) * s.ry * r]);
    }
    trace(ctx, pts);
  });

  register('star8', function (ctx, s) {
    var pts = [];
    for (var i = 0; i < 16; i++) {
      var a = (s.phase - 90 + i * 22.5) * Math.PI / 180;
      var r = i % 2 ? s.inner : 1;
      pts.push([s.cx + Math.cos(a) * s.rx * r, s.cy + Math.sin(a) * s.ry * r]);
    }
    trace(ctx, pts);
  });

  register('burst', function (ctx, s) {
    /* Many fine spikes rather than few; the point count is what separates it from a star. */
    var n = Math.max(10, s.points * 2);
    trace(ctx, ring(s.cx, s.cy, s.rx, s.ry, n, Math.max(0.5, s.inner), (s.phase - 90) * Math.PI / 180));
  });

  register('sparkle', function (ctx, s) {
    /* Four long points with concave waists — a twinkle, not a star. */
    var k = 0.12;
    ctx.moveTo(s.cx, s.cy - s.ry);
    ctx.quadraticCurveTo(s.cx + s.rx * k, s.cy - s.ry * k, s.cx + s.rx, s.cy);
    ctx.quadraticCurveTo(s.cx + s.rx * k, s.cy + s.ry * k, s.cx, s.cy + s.ry);
    ctx.quadraticCurveTo(s.cx - s.rx * k, s.cy + s.ry * k, s.cx - s.rx, s.cy);
    ctx.quadraticCurveTo(s.cx - s.rx * k, s.cy - s.ry * k, s.cx, s.cy - s.ry);
    ctx.closePath();
  });

  register('sun', function (ctx, s) {
    var pts = [];
    var rays = 12;
    for (var i = 0; i < rays * 2; i++) {
      var a = (s.phase - 90 + (i * 180) / rays) * Math.PI / 180;
      var r = i % 2 ? 0.72 : 1;
      pts.push([s.cx + Math.cos(a) * s.rx * r, s.cy + Math.sin(a) * s.ry * r]);
    }
    trace(ctx, pts);
  });

  register('flower', function (ctx, s) {
    var pts = [];
    var petals = Math.max(4, s.points);
    for (var i = 0; i < petals * 2; i++) {
      var a = (s.phase - 90 + (i * 180) / petals) * Math.PI / 180;
      var r = i % 2 ? 0.45 : 1;
      pts.push([s.cx + Math.cos(a) * s.rx * r, s.cy + Math.sin(a) * s.ry * r]);
    }
    trace(ctx, pts);
  });

  register('multifoil', function (ctx, s) {
    /*
     * Scalloped edge. Arcs centred on the shape's own centre just retrace the circle and come
     * out as a plain disc; a scallop has to bulge from a centre partway out, between two points
     * that sit ON the circle.
     */
    var lobes = Math.max(3, s.sides);
    var step = Math.PI * 2 / lobes;
    var r = Math.min(s.rx, s.ry);
    var phase = (s.phase - 90) * Math.PI / 180;
    /* Radius of a circle through two adjacent on-circle points whose centre sits at r*0.74. */
    var chord = 2 * r * Math.sin(step / 2);
    var bulge = Math.sqrt(Math.max(0.01, chord * chord / 4 + Math.pow(r * 0.26, 2)));
    for (var i = 0; i < lobes; i++) {
      var a0 = phase + i * step;
      var a1 = a0 + step;
      var mx = s.cx + Math.cos((a0 + a1) / 2) * r * 0.74;
      var my = s.cy + Math.sin((a0 + a1) / 2) * r * 0.74;
      var p0 = [s.cx + Math.cos(a0) * r, s.cy + Math.sin(a0) * r];
      if (i === 0) ctx.moveTo(p0[0], p0[1]);
      /* Sweep from the first on-circle point round the outside back to the second. */
      var arcStart = Math.atan2(s.cy + Math.sin(a0) * r - my, s.cx + Math.cos(a0) * r - mx);
      var arcEnd = Math.atan2(s.cy + Math.sin(a1) * r - my, s.cx + Math.cos(a1) * r - mx);
      ctx.arc(mx, my, bulge, arcStart, arcEnd, false);
    }
    ctx.closePath();
  });

  register('heart', function (ctx, s) {
    /*
     * Point at the bottom, two round lobes on top, a notch between them. The original control
     * points reached from -0.12w to 1.12w (outside the layer box) and the lobes never rose above
     * the notch, so the first render was a slim leaf with a dimple.
     *
     * Coordinates below are fractions of the layer box. The lobe curves run from the shoulders
     * (y = 0.31h) up to a top of about y = 0.12h and down to a notch at y = 0.31h, so the notch is
     * a good third of the way down - shallow enough to keep the lobes round, deep enough to read
     * as a heart rather than a leaf.
     */
    var w = s.w, h = s.h, o = s.offset, cx = s.cx;
    ctx.moveTo(cx, o.y + h * 0.98);
    /* up the left flank into the shoulder */
    ctx.bezierCurveTo(o.x + w * 0.04, o.y + h * 0.75, o.x + w * 0.01, o.y + h * 0.48, o.x + w * 0.10, o.y + h * 0.31);
    /* round the left lobe, down into the notch */
    ctx.bezierCurveTo(o.x + w * 0.20, o.y + h * 0.05, o.x + w * 0.42, o.y + h * 0.07, cx, o.y + h * 0.31);
    /* round the right lobe, out to the shoulder */
    ctx.bezierCurveTo(o.x + w * 0.58, o.y + h * 0.07, o.x + w * 0.80, o.y + h * 0.05, o.x + w * 0.90, o.y + h * 0.31);
    /* down the right flank to the point */
    ctx.bezierCurveTo(o.x + w * 0.99, o.y + h * 0.48, o.x + w * 0.96, o.y + h * 0.75, cx, o.y + h * 0.98);
    ctx.closePath();
  });

  register('droplet', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx, o.y);
    ctx.bezierCurveTo(o.x + w * 0.92, o.y + h * 0.38, o.x + w, o.y + h * 0.76, s.cx, o.y + h);
    ctx.bezierCurveTo(o.x, o.y + h * 0.76, o.x + w * 0.08, o.y + h * 0.38, s.cx, o.y);
    ctx.closePath();
  });

  register('drop', function (ctx, s) {
    /*
     * A falling drop: round belly at the bottom, tapering to a point at the top, narrower than
     * "droplet". These three used to be the same teardrop at slightly different widths, which is
     * not worth three chips in the picker.
     */
    var w = s.w, h = s.h, o = s.offset, cx = s.cx;
    ctx.moveTo(cx, o.y);
    ctx.bezierCurveTo(o.x + w * 0.30, o.y + h * 0.30, o.x + w * 0.86, o.y + h * 0.56, o.x + w * 0.86, o.y + h * 0.74);
    ctx.bezierCurveTo(o.x + w * 0.86, o.y + h * 0.92, o.x + w * 0.70, o.y + h, cx, o.y + h);
    ctx.bezierCurveTo(o.x + w * 0.14, o.y + h, o.x + w * 0.14, o.y + h * 0.92, o.x + w * 0.14, o.y + h * 0.74);
    ctx.bezierCurveTo(o.x + w * 0.14, o.y + h * 0.56, o.x + w * 0.70, o.y + h * 0.30, cx, o.y);
    ctx.closePath();
  });

  register('leaf', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x, o.y + h);
    ctx.quadraticCurveTo(o.x, o.y, o.x + w, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y + h, o.x, o.y + h);
    ctx.closePath();
  });

  /**
   * A crescent, as the region common to the shape's circle and everything LEFT of a cutting
   * circle. The previous version drew a nearly-full outer arc and then a second circle that
   * reached 56% further right than the layer is wide, so the body spilled out of its own box
   * and was clipped on the canvas and wrong in the texture cache.
   *
   * Geometry in unit space, then scaled to fit:
   *   outer circle  radius 1 at the origin
   *   cutter circle radius r2 at (d, 0)
   * The two intersect at x = (d^2 + 1 - r2^2) / (2d). The outline runs along the outer circle
   * from the lower intersection round the left to the upper one, then back along the cutter's
   * left side. Every point is within |x| <= 1, |y| <= 1.
   */
  function crescentPath(ctx, s, d, r2) {
    var R = Math.min(s.rx, s.ry) * 0.98;
    if (!(R > 0)) return;
    var ix = (d * d + 1 - r2 * r2) / (2 * d);
    var iy = Math.sqrt(Math.max(0, 1 - ix * ix));
    /* Unit -> canvas. */
    var px = function (x) { return s.cx + x * R; };
    var py = function (y) { return s.cy + y * R; };
    var aOuterLower = Math.atan2(-iy, ix);
    var aOuterUpper = Math.atan2(iy, ix);
    /* Around the outside, the long way through the left, from lower to upper. */
    ctx.moveTo(px(ix), py(-iy));
    ctx.arc(s.cx, s.cy, R, aOuterLower, aOuterUpper, true);
    /* Back along the cutter's left edge from the upper intersection to the lower one. */
    var cxc = px(d), cyc = s.cy, Rc = r2 * R;
    var aCutUpper = Math.atan2(iy * R, (ix - d) * R);
    var aCutLower = Math.atan2(-iy * R, (ix - d) * R);
    /*
     * Which way round the cutter to travel is NOT a constant: the side that faces the moon's
     * bright limb is the one through the cutter's own left extreme (angle PI), and whether that
     * side is the short way or the long way round depends on how deep the cut is. Hardcoding one
     * direction drew a shallow crescent correctly and a deep one as the wrong region entirely.
     * So test which sweep passes through PI and use that.
     */
    /*
     * Pick the sweep whose midpoint sits on the cutter's LEFT side. Testing "does it pass through
     * PI" was not enough: for a shallow cut the correct sweep passes through PI the long way, and
     * for a deep one the same test picks the sweep that goes round the right, which draws the
     * union instead of the difference. The midpoint test is the same answer regardless of depth.
     */
    var twoPi = Math.PI * 2;
    var norm = function (x) { return ((x % twoPi) + twoPi) % twoPi; };
    /* cx.arc(...,ccw) sweeps with INCREASING angle when ccw is false. Getting these two the
       wrong way round picks the union for a shallow cut and the difference for a deep one, which
       is exactly what happened: fixing moon broke crescent. */
    var midNoCcw = aCutUpper + norm(aCutLower - aCutUpper) / 2;
    var midCcw = aCutUpper - norm(aCutUpper - aCutLower) / 2;
    var sweepCcw = Math.cos(midCcw) < Math.cos(midNoCcw);
    ctx.arc(cxc, cyc, Rc, aCutUpper, aCutLower, sweepCcw);
    ctx.closePath();
  }

  register('crescent', function (ctx, s) {
    crescentPath(ctx, s, 0.72, 0.86);
  });

  register('moon', function (ctx, s) {
    /* Same construction as crescent, cut deeper - a fuller moon rather than a thin sliver. */
    crescentPath(ctx, s, 0.70, 1.02);
  });

  register('cloud', function (ctx, s) {
    /*
     * Rounded top over a flat base. Built from two quarters per lobe plus a shoulder curve at
     * each end, because free-standing arcs of different radii get joined by a chord and the
     * chords read as creases - the first version looked like an envelope, not a cloud.
     */
    var o = s.offset, w = s.w, h = s.h;
    var base = o.y + h * 0.92, top = o.y + h * 0.30;
    var cx = s.cx;
    ctx.moveTo(o.x + w * 0.06, base);
    /* left shoulder */
    ctx.bezierCurveTo(o.x + w * 0.00, o.y + h * 0.86, o.x + w * 0.02, o.y + h * 0.62, o.x + w * 0.08, o.y + h * 0.56);
    /* left lobe */
    ctx.bezierCurveTo(o.x + w * 0.06, o.y + h * 0.30, o.x + w * 0.30, o.y + h * 0.20, o.x + w * 0.36, o.y + h * 0.34);
    /* middle lobe, the tall one */
    ctx.bezierCurveTo(o.x + w * 0.42, o.y + h * 0.06, o.x + w * 0.72, o.y + h * 0.06, o.x + w * 0.72, o.y + h * 0.34);
    /* right lobe */
    ctx.bezierCurveTo(o.x + w * 0.82, o.y + h * 0.30, o.x + w * 0.98, o.y + h * 0.34, o.x + w * 0.96, o.y + h * 0.58);
    /* right shoulder down to the base */
    ctx.bezierCurveTo(o.x + w * 1.00, o.y + h * 0.80, o.x + w * 0.96, o.y + h * 0.90, o.x + w * 0.94, base);
    ctx.closePath();
  });

  register('bubble', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    var r = Math.min(w, h) * 0.16;
    var b = o.y + h * 0.74;
    ctx.moveTo(o.x + r, o.y);
    ctx.lineTo(o.x + w - r, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y, o.x + w, o.y + r);
    ctx.lineTo(o.x + w, b - r);
    ctx.quadraticCurveTo(o.x + w, b, o.x + w - r, b);
    ctx.lineTo(o.x + w * 0.42, b);
    ctx.lineTo(o.x + w * 0.26, o.y + h);
    ctx.lineTo(o.x + w * 0.3, b);
    ctx.lineTo(o.x + r, b);
    ctx.quadraticCurveTo(o.x, b, o.x, b - r);
    ctx.lineTo(o.x, o.y + r);
    ctx.quadraticCurveTo(o.x, o.y, o.x + r, o.y);
    ctx.closePath();
  });

  register('speech', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    var b = o.y + h * 0.7;
    ctx.moveTo(o.x + w * 0.2, o.y);
    ctx.lineTo(o.x + w * 0.8, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y, o.x + w, o.y + h * 0.35);
    ctx.quadraticCurveTo(o.x + w, b, o.x + w * 0.8, b);
    ctx.lineTo(o.x + w * 0.55, b);
    ctx.lineTo(o.x + w * 0.34, o.y + h);
    ctx.lineTo(o.x + w * 0.38, b);
    ctx.lineTo(o.x + w * 0.2, b);
    ctx.quadraticCurveTo(o.x, b, o.x, o.y + h * 0.35);
    ctx.quadraticCurveTo(o.x, o.y, o.x + w * 0.2, o.y);
    ctx.closePath();
  });

  register('badge', function (ctx, s) {
    /* A circle with a pointed foot, for labels and counters. */
    var r = Math.min(s.rx, s.ry) * 0.82;
    ctx.arc(s.cx, s.cy - r * 0.12, r, 0.5 * Math.PI, Math.PI * 0.5 + Math.PI * 2 * 0.75, false);
    ctx.lineTo(s.cx + r * 0.28, s.cy + r * 1.28);
    ctx.lineTo(s.cx - r * 0.28, s.cy + r * 0.86);
    ctx.closePath();
  });

  register('pin', function (ctx, s) {
    var r = Math.min(s.rx, s.ry) * 0.86;
    var top = s.cy - r * 0.95;
    ctx.arc(s.cx, top + r, r, Math.PI, Math.PI * 2, false);
    ctx.lineTo(s.cx + r * 0.42, top + r * 1.32);
    ctx.lineTo(s.cx, s.cy + r * 1.7);
    ctx.lineTo(s.cx - r * 0.42, top + r * 1.32);
    ctx.closePath();
  });

  register('shield', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x, o.y + h * 0.12);
    ctx.lineTo(s.cx, o.y);
    ctx.lineTo(o.x + w, o.y + h * 0.12);
    ctx.lineTo(o.x + w, o.y + h * 0.52);
    ctx.quadraticCurveTo(o.x + w * 0.86, o.y + h * 0.92, s.cx, o.y + h);
    ctx.quadraticCurveTo(o.x + w * 0.14, o.y + h * 0.92, o.x, o.y + h * 0.52);
    ctx.closePath();
  });

  register('rocket', function (ctx, s) {
    /*
     * Nose cone, a body with real width, fins that kick out near the tail, then a narrow exhaust.
     * Two earlier attempts failed in opposite directions: the first flared the nose out to 0.6w
     * inside the top third and read as a golf tee, the second gave the body only 6% of the width
     * and read as a pin.
     */
    var o = s.offset, w = s.w, h = s.h, cx = s.cx;
    var body = w * 0.17;                        /* half-width of the fuselage */
    ctx.moveTo(cx, o.y);
    /* right flank of the nose, easing into the body */
    ctx.bezierCurveTo(cx + body * 0.35, o.y + h * 0.10, cx + body, o.y + h * 0.20, cx + body, o.y + h * 0.30);
    ctx.lineTo(cx + body, o.y + h * 0.62);
    /* right fin */
    ctx.lineTo(cx + w * 0.40, o.y + h * 0.82);
    ctx.lineTo(cx + w * 0.34, o.y + h * 0.93);
    ctx.lineTo(cx + body, o.y + h * 0.86);
    /* exhaust plate */
    ctx.lineTo(cx - body, o.y + h * 0.86);
    /* left fin */
    ctx.lineTo(cx - w * 0.34, o.y + h * 0.93);
    ctx.lineTo(cx - w * 0.40, o.y + h * 0.82);
    ctx.lineTo(cx - body, o.y + h * 0.62);
    ctx.lineTo(cx - body, o.y + h * 0.30);
    ctx.bezierCurveTo(cx - body, o.y + h * 0.20, cx - body * 0.35, o.y + h * 0.10, cx, o.y);
    ctx.closePath();
  });

  register('paperplane', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x, o.y + h * 0.46);
    ctx.lineTo(o.x + w, o.y);
    ctx.lineTo(o.x + w * 0.56, o.y + h);
    ctx.lineTo(o.x + w * 0.42, o.y + h * 0.62);
    ctx.closePath();
  });

  register('airplane', function (ctx, s) {
    /*
     * A plane read from above: fuselage down the middle, wings swept back, a tailplane. Drawn as
     * one symmetric outline - the old version put the wings on as separate strokes, which a
     * single-contour renderer cannot keep, so it drew a bare cross.
     */
    var o = s.offset, w = s.w, h = s.h, cx = s.cx;
    ctx.moveTo(cx, o.y);                                        /* nose */
    ctx.lineTo(cx + w * 0.10, o.y + h * 0.24);
    ctx.lineTo(cx + w * 0.10, o.y + h * 0.46);
    ctx.lineTo(cx + w * 0.46, o.y + h * 0.76);                  /* right wingtip */
    ctx.lineTo(cx + w * 0.46, o.y + h * 0.84);
    ctx.lineTo(cx + w * 0.10, o.y + h * 0.72);
    ctx.lineTo(cx + w * 0.10, o.y + h * 0.84);
    ctx.lineTo(cx + w * 0.22, o.y + h * 0.94);                  /* right tailplane */
    ctx.lineTo(cx + w * 0.22, o.y + h);
    ctx.lineTo(cx, o.y + h * 0.94);
    ctx.lineTo(cx - w * 0.22, o.y + h);                         /* left tailplane */
    ctx.lineTo(cx - w * 0.22, o.y + h * 0.94);
    ctx.lineTo(cx - w * 0.10, o.y + h * 0.84);
    ctx.lineTo(cx - w * 0.10, o.y + h * 0.72);
    ctx.lineTo(cx - w * 0.46, o.y + h * 0.84);                  /* left wingtip */
    ctx.lineTo(cx - w * 0.46, o.y + h * 0.76);
    ctx.lineTo(cx - w * 0.10, o.y + h * 0.46);
    ctx.lineTo(cx - w * 0.10, o.y + h * 0.24);
    ctx.closePath();
  });

  register('envelope', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x + w * 0.05, o.y + h * 0.16);
    ctx.lineTo(o.x + w * 0.95, o.y + h * 0.16);
    ctx.lineTo(o.x + w, o.y + h * 0.26);
    ctx.lineTo(o.x + w, o.y + h * 0.84);
    ctx.lineTo(o.x, o.y + h * 0.84);
    ctx.lineTo(o.x, o.y + h * 0.26);
    ctx.closePath();
  });

  register('lightning', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x + w * 0.6, o.y);
    ctx.lineTo(o.x + w * 0.18, o.y + h * 0.56);
    ctx.lineTo(o.x + w * 0.46, o.y + h * 0.56);
    ctx.lineTo(o.x + w * 0.34, o.y + h);
    ctx.lineTo(o.x + w * 0.86, o.y + h * 0.38);
    ctx.lineTo(o.x + w * 0.56, o.y + h * 0.38);
    ctx.closePath();
  });

  register('flame', function (ctx, s) {
    /*
     * A flame, not a teardrop: asymmetric, leaning right, with a hooked tip and a rounded base
     * that is wider on the right. Without that lean three chips in the picker were the same
     * shape at three widths.
     */
    var w = s.w, h = s.h, o = s.offset, cx = s.cx;
    ctx.moveTo(o.x + w * 0.66, o.y);
    ctx.bezierCurveTo(o.x + w * 0.60, o.y + h * 0.18, o.x + w * 0.34, o.y + h * 0.24, o.x + w * 0.32, o.y + h * 0.46);
    ctx.bezierCurveTo(o.x + w * 0.30, o.y + h * 0.60, o.x + w * 0.44, o.y + h * 0.64, o.x + w * 0.40, o.y + h * 0.72);
    ctx.bezierCurveTo(o.x + w * 0.20, o.y + h * 0.72, o.x + w * 0.10, o.y + h * 0.82, o.x + w * 0.18, o.y + h * 0.94);
    ctx.bezierCurveTo(o.x + w * 0.34, o.y + h * 1.02, o.x + w * 0.86, o.y + h * 0.90, o.x + w * 0.88, o.y + h * 0.62);
    ctx.bezierCurveTo(o.x + w * 0.90, o.y + h * 0.36, o.x + w * 0.76, o.y + h * 0.16, o.x + w * 0.66, o.y);
    ctx.closePath();
  });

  register('crown', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x, o.y + h * 0.82);
    ctx.lineTo(o.x + w * 0.04, o.y + h * 0.16);
    ctx.lineTo(o.x + w * 0.3, o.y + h * 0.52);
    ctx.lineTo(s.cx, o.y + h * 0.06);
    ctx.lineTo(o.x + w * 0.7, o.y + h * 0.52);
    ctx.lineTo(o.x + w * 0.96, o.y + h * 0.16);
    ctx.lineTo(o.x + w, o.y + h * 0.82);
    ctx.closePath();
  });

  register('diamond', function (ctx, s) {
    trace(ctx, [[s.cx, s.offset.y], [s.offset.x + s.w, s.cy], [s.cx, s.offset.y + s.h], [s.offset.x, s.cy]]);
  });

  register('penta', function (ctx, s) { trace(ctx, ring(s.cx, s.cy, s.rx, s.ry, 5, 1, (s.phase - 90) * Math.PI / 180)); });
  register('hexagon', function (ctx, s) { trace(ctx, ring(s.cx, s.cy, s.rx, s.ry, 6, 1, (s.phase - 90) * Math.PI / 180)); });
  register('octagon', function (ctx, s) { trace(ctx, ring(s.cx, s.cy, s.rx, s.ry, 8, 1, (s.phase - 90) * Math.PI / 180)); });
  register('ring', function (ctx, s) {
    var r = Math.min(s.rx, s.ry) * 0.94;
    bandPath(ctx, s.cx, s.cy, r, r * 0.62);
  });
  register('donut', function (ctx, s) {
    var r = Math.min(s.rx, s.ry) * 0.96;
    bandPath(ctx, s.cx, s.cy, r, r * 0.5);
  });
  register('pie', function (ctx, s) {
    var r = Math.min(s.rx, s.ry);
    ctx.moveTo(s.cx, s.cy);
    ctx.arc(s.cx, s.cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.5, false);
    ctx.closePath();
  });
  register('arc', function (ctx, s) {
    var r = Math.min(s.rx, s.ry);
    ctx.arc(s.cx, s.cy, r, Math.PI * 0.15, Math.PI * 0.85, false);
  });
  register('capsule', function (ctx, s) {
    /*
     * A stadium: straight sides, semicircular ends. The radius has to be computed inside the
     * builder - it used to lean on an outer variable that was deleted, so every coordinate came
     * out NaN and the shape silently produced no path at all.
     */
    var cap = Math.min(s.w, s.h) / 2;
    ctx.moveTo(s.offset.x + cap, s.offset.y);
    ctx.lineTo(s.offset.x + s.w - cap, s.offset.y);
    ctx.arc(s.offset.x + s.w - cap, s.cy, cap, -Math.PI / 2, Math.PI / 2, false);
    ctx.lineTo(s.offset.x + cap, s.offset.y + s.h);
    ctx.arc(s.offset.x + cap, s.cy, cap, Math.PI / 2, Math.PI * 1.5, false);
    ctx.closePath();
  });
  register('parallelogram', function (ctx, s) {
    var k = s.w * 0.22;
    trace(ctx, [[s.offset.x + k, s.offset.y], [s.offset.x + s.w, s.offset.y], [s.offset.x + s.w - k, s.offset.y + s.h], [s.offset.x, s.offset.y + s.h]]);
  });
  register('trapezoid', function (ctx, s) {
    var k = s.w * 0.18;
    trace(ctx, [[s.offset.x + k, s.offset.y], [s.offset.x + s.w - k, s.offset.y], [s.offset.x + s.w, s.offset.y + s.h], [s.offset.x, s.offset.y + s.h]]);
  });
  register('plus', function (ctx, s) {
    var t = 0.32, cx = s.cx, cy = s.cy;
    var hw = s.rx, hh = s.ry, tx = s.rx * t, ty = s.ry * t;
    trace(ctx, [[cx - tx, cy - hh], [cx + tx, cy - hh], [cx + tx, cy - ty], [cx + hw, cy - ty],
                [cx + hw, cy + ty], [cx + tx, cy + ty], [cx + tx, cy + hh], [cx - tx, cy + hh],
                [cx - tx, cy + ty], [cx - hw, cy + ty], [cx - hw, cy - ty], [cx - tx, cy - ty]]);
  });
  register('cross', function (ctx, s) {
    /* Same silhouette as plus, cut thicker. The old point list carried a bogus vertex that
       notched one corner. */
    var t = 0.42, cx = s.cx, cy = s.cy, hw = s.rx, hh = s.ry;
    var tx = hw * t, ty = hh * t;
    trace(ctx, [[cx - tx, cy - hh], [cx + tx, cy - hh], [cx + tx, cy - ty], [cx + hw, cy - ty],
                [cx + hw, cy + ty], [cx + tx, cy + ty], [cx + tx, cy + hh], [cx - tx, cy + hh],
                [cx - tx, cy + ty], [cx - hw, cy + ty], [cx - hw, cy - ty], [cx - tx, cy - ty]]);
  });
  register('xmark', function (ctx, s) {
    /*
     * An X is a four-armed star: tips at the corners, valleys pinched in between. The previous
     * hand-written point list stepped the valleys unevenly and drew a butterfly.
     */
    var R = Math.min(s.rx, s.ry), r = R * 0.30;
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = (-90 + 45 + i * 45) * Math.PI / 180;
      var rad = i % 2 ? r : R;
      pts.push([s.cx + Math.cos(a) * rad, s.cy + Math.sin(a) * rad]);
    }
    trace(ctx, pts);
  });
  register('checkmark', function (ctx, s) {
    var o = s.offset, w = s.w, h = s.h;
    var t = Math.min(w, h) * 0.13;
    ctx.moveTo(o.x + w * 0.08, o.y + h * 0.52);
    ctx.lineTo(o.x + w * 0.08 + t, o.y + h * 0.52 + t);
    ctx.lineTo(o.x + w * 0.34, o.y + h * 0.72);
    ctx.lineTo(o.x + w * 0.86, o.y + h * 0.14);
    ctx.lineTo(o.x + w * 0.86 - t * 0.4, o.y + h * 0.10);
    ctx.lineTo(o.x + w * 0.34, o.y + h * 0.60);
    ctx.lineTo(o.x + w * 0.08 - t * 0.2, o.y + h * 0.40);
    ctx.closePath();
  });
  register('chevron', function (ctx, s) {
    trace(ctx, [[s.offset.x, s.offset.y], [s.offset.x + s.w * 0.5, s.offset.y + s.h * 0.5],
                [s.offset.x, s.offset.y + s.h], [s.offset.x + s.w * 0.28, s.offset.y + s.h],
                [s.offset.x + s.w * 0.78, s.offset.y + s.h * 0.5], [s.offset.x + s.w * 0.28, s.offset.y]]);
  });
  register('doublearrow', function (ctx, s) {
    var head = 0.24, bw = 0.34;
    trace(ctx, [[s.offset.x, s.cy], [s.offset.x + s.w * head, s.offset.y],
                [s.offset.x + s.w * head, s.offset.y + s.h * bw], [s.offset.x + s.w * (1 - head), s.offset.y + s.h * bw],
                [s.offset.x + s.w * (1 - head), s.offset.y], [s.offset.x + s.w, s.cy],
                [s.offset.x + s.w * (1 - head), s.offset.y + s.h], [s.offset.x + s.w * (1 - head), s.offset.y + s.h * (1 - bw)],
                [s.offset.x + s.w * head, s.offset.y + s.h * (1 - bw)], [s.offset.x + s.w * head, s.offset.y + s.h]]);
  });
  register('play', function (ctx, s) {
    trace(ctx, [[s.offset.x + s.w * 0.12, s.offset.y], [s.offset.x + s.w * 0.94, s.cy], [s.offset.x + s.w * 0.12, s.offset.y + s.h]]);
  });
  register('pause', function (ctx, s) {
    /*
     * Two bars are two subpaths, and the renderer keeps one contour - so the second bar was
     * dropped and the first became a lens. The same silhouette as a single contour: one wide
     * bar with two slots cut in from the top. Nothing between the bars reaches the edge, so
     * nothing is lost visually.
     */
    var o = s.offset, w = s.w, h = s.h;
    ctx.moveTo(o.x + w * 0.16, o.y);
    ctx.lineTo(o.x + w * 0.60, o.y);
    ctx.lineTo(o.x + w * 0.60, o.y + h);
    ctx.lineTo(o.x + w * 0.68, o.y + h);
    ctx.lineTo(o.x + w * 0.68, o.y);
    ctx.lineTo(o.x + w * 0.84, o.y);
    ctx.lineTo(o.x + w * 0.84, o.y + h);
    ctx.lineTo(o.x + w * 0.16, o.y + h);
    ctx.closePath();
  });
  register('lock', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    var bodyTop = o.y + h * 0.42;
    ctx.rect(o.x + w * 0.08, bodyTop, w * 0.84, h * 0.58);
    ctx.moveTo(o.x + w * 0.26, bodyTop);
    ctx.lineTo(o.x + w * 0.26, o.y + h * 0.26);
    ctx.quadraticCurveTo(o.x + w * 0.26, o.y, s.cx, o.y);
    ctx.quadraticCurveTo(o.x + w * 0.74, o.y, o.x + w * 0.74, o.y + h * 0.26);
    ctx.lineTo(o.x + w * 0.74, bodyTop);
    ctx.closePath();
  });
  register('search', function (ctx, s) {
    /*
     * A magnifier: disc plus handle, as ONE contour. Separate subpaths get dropped by the
     * renderer, and ctx.arc's direction flags put the gap on the wrong side, so the sweep is
     * walked explicitly from one root of the handle all the way round to the other.
     */
    var R = Math.min(s.rx, s.ry) * 0.66;
    var cx = s.cx - R * 0.26, cy = s.cy - R * 0.26;
    var a = Math.PI * 0.25;                     /* the handle points to the lower right */
    var half = 0.30;                            /* half-width of the handle root, in radians */
    var r0 = a - half, r1 = a + half;
    var nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
    var tipX = cx + Math.cos(a) * R * 1.68, tipY = cy + Math.sin(a) * R * 1.68;
    ctx.moveTo(cx + Math.cos(r0) * R, cy + Math.sin(r0) * R);
    /* Round the far side, from r1 all the way back to r0 (a full turn minus the notch). */
    arcLine(ctx, cx, cy, R, r1, r0 + Math.PI * 2, 28);
    /* The handle: out one side, across the tip, back down the other. */
    ctx.lineTo(tipX + nx * R * 0.17, tipY + ny * R * 0.17);
    ctx.lineTo(tipX - nx * R * 0.17, tipY - ny * R * 0.17);
    ctx.closePath();
  });
  register('bell', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x + w * 0.1, o.y + h * 0.76);
    ctx.quadraticCurveTo(o.x + w * 0.24, o.y + h * 0.62, o.x + w * 0.24, o.y + h * 0.36);
    ctx.quadraticCurveTo(o.x + w * 0.24, o.y + h * 0.04, s.cx, o.y + h * 0.04);
    ctx.quadraticCurveTo(o.x + w * 0.76, o.y + h * 0.04, o.x + w * 0.76, o.y + h * 0.36);
    ctx.quadraticCurveTo(o.x + w * 0.76, o.y + h * 0.62, o.x + w * 0.9, o.y + h * 0.76);
    ctx.closePath();
  });
  register('bookmark', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    trace(ctx, [[o.x + w * 0.16, o.y], [o.x + w * 0.84, o.y], [o.x + w * 0.84, o.y + h],
                [s.cx, o.y + h * 0.72], [o.x + w * 0.16, o.y + h]]);
  });
  register('flag', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    trace(ctx, [[o.x + w * 0.1, o.y], [o.x + w * 0.1, o.y + h], [o.x + w * 0.2, o.y + h],
                [o.x + w * 0.2, o.y + h * 0.56], [o.x + w * 0.9, o.y + h * 0.62],
                [o.x + w * 0.9, o.y + h * 0.06], [o.x + w * 0.2, o.y + h * 0.12], [o.x + w * 0.2, o.y]]);
  });
  register('banner1', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    trace(ctx, [[o.x, o.y], [o.x + w, o.y], [o.x + w * 0.86, o.y + h * 0.5], [o.x + w, o.y + h],
                [o.x, o.y + h], [o.x + w * 0.14, o.y + h * 0.5]]);
  });
  register('banner2', function (ctx, s) {
    /*
     * A ribbon with a swallow-tail notch at each end. The old one ran its tail out to 1.0w, which
     * the renderer clipped, leaving an odd stub on the right edge.
     */
    var o = s.offset, w = s.w, h = s.h;
    var top = o.y + h * 0.16, bot = o.y + h * 0.84, tail = w * 0.16;
    ctx.moveTo(o.x + w * 0.04, top);
    ctx.lineTo(o.x + w * 0.96, top);
    ctx.lineTo(o.x + w * 0.96 - tail, (top + bot) / 2);
    ctx.lineTo(o.x + w * 0.96, bot);
    ctx.lineTo(o.x + w * 0.04, bot);
    ctx.lineTo(o.x + w * 0.04 + tail, (top + bot) / 2);
    ctx.closePath();
  });
  register('wideline', function (ctx, s) {
    var t = s.offset.y + s.h / 2;
    ctx.moveTo(s.offset.x, t);
    ctx.lineTo(s.offset.x + s.w, t);
  });
  register('waveline', function (ctx, s) {
    var steps = 24;
    for (var i = 0; i <= steps; i++) {
      var x = s.offset.x + (s.w * i) / steps;
      var y = s.cy + Math.sin((i / steps) * Math.PI * 2) * s.ry * 0.4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  });
  register('snowflake', function (ctx, s) {
    /*
     * Six loose spokes cannot survive the single-contour renderer, so this is a twelve-point
     * star: six long arms with the valleys pulled right in. The valleys used to sit at the same
     * radius as star6's, which made the two chips identical.
     */
    var R = Math.min(s.rx, s.ry);
    var pts = [];
    for (var i = 0; i < 12; i++) {
      var a = (s.phase - 90 + 15 + i * 30) * Math.PI / 180;
      var rad = i % 2 ? R * 0.26 : R;
      pts.push([s.cx + Math.cos(a) * rad, s.cy + Math.sin(a) * rad]);
    }
    trace(ctx, pts);
  });

  /* ------------------------------------------------------------------- registration */

  function register(id, fn) { SHAPES[id] = fn; }

  /**
   * Draws shape `id` into the current path. Returns true if this module handled it.
   *
   * The outline is built through Path2D rather than the caller's context directly. The
   * built-in shapes get away with plain arc() calls because the context has no existing
   * path when they run; ours can be called at any point, and a stray arc() would join the
   * previous point with a line. Path2D starts clean and is then added to the live context,
   * so what gets filled is exactly the outline below.
   *
   * SVG path data rather than Path2D methods for arcs because the phone WebView has been
   * shipping Path2D for far longer than Path2D.arc().
   */
  /**
   * Convert an SVG path string into the node list the core's vector renderer wants.
   *
   * The core's traceVectorShapePath replays cubic segments between nodes:
   *   moveTo(n0) then for each i>0: bezierCurveTo(a.outX,a.outY, b.inX,b.inY, b.x,b.y)
   * and closes with a segment from the last node back to the first.
   *
   * So an M/L/Q/C/Z path becomes nodes where a line segment has its control points collapsed
   * onto the endpoints, and a cubic keeps them. Curves are subdivided because the core uses a
   * single cubic per node pair and a long arc split into one cubic would visibly flatten.
   */
  function nodesFor(id, W, H, state) {
    var data = pathData(id, W, H, 0, 0, state || {});
    if (!data) return null;
    var tokens = data.match(/[MLQCZA][^MLQCZA]*/g) || [];
    var nodes = [];
    var cur = null, start = null;
    var num = function (str) { return (str.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number); };
    for (var i = 0; i < tokens.length; i++) {
      var cmd = tokens[i][0];
      var v = num(tokens[i].slice(1));
      if (cmd === 'M') {
        cur = { x: v[0], y: v[1], inX: v[0], inY: v[1], outX: v[0], outY: v[1] };
        nodes.push(cur); start = cur;
      } else if (cmd === 'L') {
        var n = { x: v[0], y: v[1] };
        n.inX = n.x; n.inY = n.y; n.outX = n.x; n.outY = n.y;
        nodes.push(n); cur = n;
      } else if (cmd === 'Q') {
        /* Quadratic -> one cubic. */
        var qx = cur.x + 2 / 3 * (v[0] - cur.x), qy = cur.y + 2 / 3 * (v[1] - cur.y);
        cur.outX = qx; cur.outY = qy;
        var end = { x: v[2], y: v[3] };
        end.inX = v[2] + 2 / 3 * (v[0] - v[2]);
        end.inY = v[3] + 2 / 3 * (v[1] - v[3]);
        end.outX = end.x; end.outY = end.y;
        nodes.push(end); cur = end;
      } else if (cmd === 'C') {
        /*
         * A cubic leaves the current node and arrives at the next one. The previous version
         * wrote BOTH control points onto `cur`: the outgoing handle was overwritten by the
         * incoming one, so every curved shape (heart, droplet, flame) collapsed to a flat line -
         * its nodes all ended up on one axis.
         */
        cur.outX = v[0]; cur.outY = v[1];
        var e2 = { x: v[4], y: v[5], inX: v[2], inY: v[3], outX: v[4], outY: v[5] };
        nodes.push(e2); cur = e2;
      } else if (cmd === 'A') {
        /*
         * Elliptical arc, as emitted by my own arcPath helper for ring/donut/pie/arc.
         * The core's vector renderer only understands cubics, so the arc is converted here:
         * endpoint-parameterised arc -> centre parameterisation -> up to four cubic segments.
         * Without this those four shapes collapsed to a straight line.
         */
        var arcNodes = arcToNodes(cur, v);
        for (var a = 0; a < arcNodes.length; a++) nodes.push(arcNodes[a]);
        if (arcNodes.length) cur = arcNodes[arcNodes.length - 1];
      } else if (cmd === 'Z') {
        /*
         * Do NOT stop here. The renderer keeps a single contour, so a subpath close has nowhere
         * to go, but shapes like lock are a body followed by a shackle and the shackle came out
         * completely missing because this used to break the loop on the body's Z.
         */
      }
    }
    /*
     * The renderer needs three anchors to make a path: moveTo plus at least two segments, and
     * it only closes loops with more than two. A straight two-point line would apply cleanly
     * and then draw nothing, so give it its own midpoint as a third anchor. Same line, valid path.
     */
    if (nodes.length === 2) {
      var m = { x: (nodes[0].x + nodes[1].x) / 2, y: (nodes[0].y + nodes[1].y) / 2 };
      nodes.splice(1, 0, m);
    }
    /* The arc emitter can place an anchor on the point the pen is already at - harmless for
       rendering, but it makes the point read as two nodes in the path editor. Fold those. */
    var clean = [];
    for (var k = 0; k < nodes.length; k++) {
      var prev = clean[clean.length - 1];
      if (prev && Math.abs(prev.x - nodes[k].x) < 0.01 && Math.abs(prev.y - nodes[k].y) < 0.01) {
        /*
         * Same point twice. Take a handle from the duplicate only when it is a REAL handle, and
         * only when this one does not already have one - a collapsed point reports its own
         * coordinates as its handles, and adopting those flattened every curve at the join.
         */
        var hasIn = Math.abs(nodes[k].inX - nodes[k].x) > 0.01 || Math.abs(nodes[k].inY - nodes[k].y) > 0.01;
        var hasOut = Math.abs(nodes[k].outX - nodes[k].x) > 0.01 || Math.abs(nodes[k].outY - nodes[k].y) > 0.01;
        var prevInFlat = Math.abs(prev.inX - prev.x) < 0.01 && Math.abs(prev.inY - prev.y) < 0.01;
        var prevOutFlat = Math.abs(prev.outX - prev.x) < 0.01 && Math.abs(prev.outY - prev.y) < 0.01;
        if (hasIn && prevInFlat) { prev.inX = nodes[k].inX; prev.inY = nodes[k].inY; }
        if (hasOut && prevOutFlat) { prev.outX = nodes[k].outX; prev.outY = nodes[k].outY; }
        continue;
      }
      clean.push(nodes[k]);
    }
    nodes = clean;
    if (nodes.length < 3) return null;
    return nodes;
  }

  /**
   * Convert one SVG arc command into cubic nodes.
   * v = [rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x, y]
   */
  function arcToNodes(from, v) {
    var rx = Math.abs(v[0]) || 0, ry = Math.abs(v[1]) || 0;
    var x2 = v[5], y2 = v[6];
    if (!rx || !ry) {
      from.outX = x2; from.outY = y2;
      return [{ x: x2, y: y2, inX: x2, inY: y2, outX: x2, outY: y2 }];
    }
    var phi = (v[2] || 0) * Math.PI / 180;
    var largeArc = v[3] ? 1 : 0, sweep = v[4] ? 1 : 0;
    var cosP = Math.cos(phi), sinP = Math.sin(phi);
    var dx = (from.x - x2) / 2, dy = (from.y - y2) / 2;
    var x1p = cosP * dx + sinP * dy;
    var y1p = -sinP * dx + cosP * dy;
    /* Scale the radii up if they are too small to span the endpoints. */
    var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { var sq = Math.sqrt(lambda); rx *= sq; ry *= sq; }
    var sign = largeArc === sweep ? -1 : 1;
    var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    var co = sign * Math.sqrt(Math.max(0, num / den));
    var cxp = co * (rx * y1p) / ry;
    var cyp = co * (-ry * x1p) / rx;
    var cx = cosP * cxp - sinP * cyp + (from.x + x2) / 2;
    var cy = sinP * cxp + cosP * cyp + (from.y + y2) / 2;

    function angle(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
      var a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
      return (ux * vy - uy * vx < 0) ? -a : a;
    }
    var theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
    if (sweep && dTheta < 0) dTheta += Math.PI * 2;

    var segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
    var delta = dTheta / segments;
    var k = 4 / 3 * Math.tan(delta / 4);
    var out = [];
    var t = theta1;
    var px = from.x, py = from.y;
    for (var i = 0; i < segments; i++) {
      var t2 = t + delta;
      var cosT = Math.cos(t), sinT = Math.sin(t);
      var cosT2 = Math.cos(t2), sinT2 = Math.sin(t2);
      var ex = cx + rx * cosT2 * cosP - ry * sinT2 * sinP;
      var ey = cy + rx * cosT2 * sinP + ry * sinT2 * cosP;
      var c1x = px + k * (-rx * sinT * cosP - ry * cosT * sinP);
      var c1y = py + k * (-rx * sinT * sinP + ry * cosT * cosP);
      if (i === 0) {
        /* First segment: the control point leaves the node the arc started from. */
        from.outX = c1x; from.outY = c1y;
      }
      var c2x = ex + k * (rx * sinT2 * cosP + ry * cosT2 * sinP);
      var c2y = ey + k * (rx * sinT2 * sinP - ry * cosT2 * cosP);
      out.push({ x: ex, y: ey, inX: c2x, inY: c2y, outX: ex, outY: ey });
      if (out.length === 1) {
        out[0].outX = ex; out[0].outY = ey;
      }
      t = t2;
      px = ex; py = ey;
    }
    return out;
  }

  function traceShape(ctx, id, layer, w, h, offsetX, offsetY) {
    if (!SHAPES[id]) return false;
    if (ctx && ctx.__amzActive === id) return true;
    var st = window.omsShapeState ? window.omsShapeState(layer) : null;
    if (!st) return false;
    var W = Math.max(1, w == null ? st.w : w);
    var H = Math.max(1, h == null ? st.h : h);
    var data = pathData(id, W, H, offsetX || 0, offsetY || 0, st);
    if (!data) return false;
    ctx.beginPath();
    if (typeof Path2D === 'function') {
      try {
        ctx.addPath(new Path2D(data));
        return true;
      } catch (e) {
        /* Fall through to the manual replay below. */
      }
    }
    replay(ctx, data);
    return true;
  }

  /** Minimal replay of the path subset this module emits, for contexts without Path2D. */
  function replay(ctx, data) {
    var tokens = data.match(/[MLQCZA]|-?\d*\.?\d+/g) || [];
    var i = 0;
    var cmd = null;
    while (i < tokens.length) {
      if (/^[MLQCZA]$/.test(tokens[i])) { cmd = tokens[i]; i++; continue; }
      var n = function () { return parseFloat(tokens[i++]); };
      if (cmd === 'M') ctx.moveTo(n(), n());
      else if (cmd === 'L') ctx.lineTo(n(), n());
      else if (cmd === 'Q') ctx.quadraticCurveTo(n(), n(), n(), n());
      else if (cmd === 'C') ctx.bezierCurveTo(n(), n(), n(), n(), n(), n());
      else if (cmd === 'A') {
        var r = n(); n(); n(); var large = n(), sweep = n(), x = n(), y = n();
        if (ctx.arcTo) {
          /* Close enough for a preview: an arc becomes a straight segment. */
          ctx.lineTo(x, y);
        }
      } else if (cmd === 'Z') ctx.closePath();
      else i++;
      if (i > 5000) break;
    }
  }

  /**
   * Installs the extra entries into the shape picker.
   *
   * The picker is rebuilt on every drawer open, so this runs on each open rather than once.
   * Entries are appended to the existing grid so they land in the same scroll region and
   * inherit the same styling.
   */
  var GROUPS = [
    {
      label: 'Bintang & cahaya',
      items: ['star4', 'star5', 'star6', 'star8', 'burst', 'sparkle', 'sun', 'flower', 'snowflake', 'multifoil'],
    },
    {
      label: 'Bentuk dasar',
      items: ['squircle', 'capsule', 'parallelogram', 'trapezoid', 'diamond', 'penta', 'hexagon', 'octagon',
              'plus', 'cross', 'xmark', 'checkmark', 'chevron', 'doublearrow', 'play', 'pause'],
    },
    {
      label: 'Alam',
      items: ['heart', 'droplet', 'drop', 'leaf', 'crescent', 'moon', 'cloud', 'flame', 'bubble', 'speech'],
    },
    {
      label: 'Simbol',
      items: ['pin', 'badge', 'shield', 'lock', 'search', 'bell', 'bookmark', 'flag', 'rocket',
              'paperplane', 'airplane', 'envelope', 'lightning', 'crown'],
    },
    {
      label: 'Bidang',
      items: ['ring', 'donut', 'pie', 'arc', 'banner1', 'banner2', 'wideline', 'waveline'],
    },
  ];

  var LABELS = {
    star5: 'Bintang 5', star6: 'Bintang 6', star8: 'Bintang 8', burst: 'Ledakan',
    sparkle: 'Kelip', sun: 'Matahari', flower: 'Bunga', snowflake: 'Salju',
    squircle: 'Kotak Halus', capsule: 'Kapsul', parallelogram: 'Jajar Genjang',
    trapezoid: 'Trapesium', plus: 'Tambah', cross: 'Silang', xmark: 'Silang Miring',
    checkmark: 'Centang', chevron: 'Panah Sudut', doublearrow: 'Panah Dua Arah',
    play: 'Main', pause: 'Jeda', heart: 'Hati', droplet: 'Tetes', drop: 'Air',
    leaf: 'Daun', crescent: 'Bulan Sabit', moon: 'Bulan', cloud: 'Awan', flame: 'Api',
    pin: 'Pin', badge: 'Lencana', shield: 'Perisai', lock: 'Kunci', search: 'Cari',
    bell: 'Lonceng', bookmark: 'Penanda', flag: 'Bendera', rocket: 'Roket',
    paperplane: 'Pesawat Kertas', airplane: 'Pesawat', envelope: 'Amplop',
    lightning: 'Petir', crown: 'Mahkota', ring: 'Cincin', donut: 'Donat', pie: 'Pai',
    star4: 'Bintang 4', multifoil: 'Daun Ganda', bubble: 'Balon Kata', speech: 'Ucapan',
    diamond: 'Belah Ketupat', penta: 'Segi Lima', hexagon: 'Segi Enam', octagon: 'Segi Delapan',
    arc: 'Busur', banner1: 'Spanduk 1', banner2: 'Spanduk 2', wideline: 'Garis Tebal',
    waveline: 'Garis Gelombang',
  };

  /** A small preview icon, drawn from the same path code so it cannot drift from the result. */
  function icon(id) {
    return '<svg viewBox="0 0 48 48" width="28" height="28" fill="currentColor"><path d="' +
      pathData(id) + '"/></svg>';
  }

  /**
   * Renders the shape's outline to SVG path data by running the real generator against a
   * stand-in context. Using the generator rather than hand-written icons means a shape's
   * button always shows the shape you actually get.
   */
  function pathData(id, W, H, ox, oy, state) {
    var w = W || 40, h = H || 40, x0 = ox || 4, y0 = oy || 4;
    var parts = [];
    /*
     * The current point has to be tracked here, because canvas arc() and rect() do things the
     * shape builders rely on and the path string has to reproduce them:
     *   - arc() connects the current point to the arc's start with a straight line, then leaves
     *     the current point at the arc's end;
     *   - rect() starts a new subpath of its own.
     * Emitting the raw arc without that join is what turned capsule into two stray half circles,
     * cloud into a blob with loose arcs, and lock into a body with its shackle cut off - the
     * core was faithfully drawing a path that did not mean what the shape meant.
     */
    var tx = 0, ty = 0, started = false;
    var move = function (x, y) { parts.push('M' + r(x) + ' ' + r(y)); tx = x; ty = y; started = true; };
    var line = function (x, y) { parts.push('L' + r(x) + ' ' + r(y)); tx = x; ty = y; };
    var fake = {
      beginPath: function () { parts.length = 0; started = false; },
      moveTo: move,
      lineTo: line,
      quadraticCurveTo: function (a, b, c, d) {
        parts.push('Q' + r(a) + ' ' + r(b) + ' ' + r(c) + ' ' + r(d)); tx = c; ty = d;
      },
      bezierCurveTo: function (a, b, c, d, e, f) {
        parts.push('C' + r(a) + ' ' + r(b) + ' ' + r(c) + ' ' + r(d) + ' ' + r(e) + ' ' + r(f)); tx = e; ty = f;
      },
      arc: function (cx, cy, r0, s, e, ccw) {
        var sx = cx + Math.cos(s) * r0, sy = cy + Math.sin(s) * r0;
        var ex = cx + Math.cos(e) * r0, ey = cy + Math.sin(e) * r0;
        if (!started) { move(sx, sy); }
        else if (Math.abs(sx - tx) > 0.01 || Math.abs(sy - ty) > 0.01) { line(sx, sy); }
        /*
         * arcPath() begins with its own M at the arc's start, which is the point the pen is on
         * already. Keeping it made a duplicate anchor at every arc join, and the duplicate's
         * plain handles then overwrote the real ones - which is what squared off the ring.
         */
        parts.push(String(arcPath(cx, cy, r0, s, e, ccw)).replace(/^M[-\d.eE+ ]+/, ''));
        tx = ex; ty = ey;
      },
      rect: function (x, y, w2, h2) {
        parts.push('M' + r(x) + ' ' + r(y) + 'L' + r(x + w2) + ' ' + r(y) + 'L' + r(x + w2) + ' ' + r(y + h2) +
          'L' + r(x) + ' ' + r(y + h2) + 'Z');
        tx = x; ty = y;
      },
      closePath: function () { if (parts.length) parts.push('Z'); },
    };
    var fn = SHAPES[id];
    if (!fn) return '';
    fn(fake, {
      w: w, h: h, offset: { x: x0, y: y0 }, cx: x0 + w / 2, cy: y0 + h / 2,
      rx: w / 2, ry: h / 2,
      points: (state && state.points) || 5,
      inner: (state && state.inner) || 0.46,
      phase: (state && state.phase) || 0,
      sides: (state && state.sides) || 6,
      tip: (state && state.tip) || 0.5,
      arrowHead: (state && state.arrowHead) || 0.35,
      arrowBody: (state && state.arrowBody) || 0.28,
    });
    return parts.join(' ');
  }

  function r(n) { return Math.round(n * 100) / 100; }

  /**
   * An annulus (ring / donut) as ONE closed contour.
   *
   * The core's vector renderer draws a single contour with a single closed flag - there is no
   * second subpath, so the obvious "outer circle then a hole" cannot survive the conversion to
   * vector nodes and the layer came out either a solid disc or, worse, an invisible sliver.
   * Instead the band is drawn the way a pen plotter would: all the way round the outside, then
   * across to the inside, all the way round the inside in the opposite direction, then closed.
   * The outer loop winds one way and the inner loop winds back, so under the nonzero fill rule
   * that canvas fill() uses the middle cancels out to empty and the band fills. The seam is
   * traversed once and has no area, so it is invisible.
   */
  function bandPath(ctx, cx, cy, ro, ri) {
    if (!(ro > 0) || !(ri > 0) || ri >= ro) {
      /* Degenerate - fall back to a plain disc rather than an unclosed mess. */
      ctx.arc(cx, cy, Math.max(ro, ri, 0.5), 0, Math.PI * 2, false);
      ctx.closePath();
      return;
    }
    ctx.moveTo(cx + ro, cy);
    ctx.arc(cx, cy, ro, 0, Math.PI, false);
    ctx.arc(cx, cy, ro, Math.PI, Math.PI * 2, false);
    /* Back out along the seam and return over it, so the connector encloses no area. Without
       the doubled lineTo the two loops are just joined corner to corner and the band fills in
       as a solid disc, which is exactly what it did. */
    ctx.lineTo(cx + ri, cy);
    ctx.lineTo(cx + ro, cy);
    ctx.lineTo(cx + ri, cy);
    ctx.arc(cx, cy, ri, 0, Math.PI, true);
    ctx.arc(cx, cy, ri, Math.PI, Math.PI * 2, true);
    ctx.closePath();
  }

  /**
   * Walk a circular arc by explicit angle from a0 to a1, adding lineTo points.
   *
   * ctx.arc() relies on four flags whose meaning flips with the direction of travel, and the
   * renderer only ever stores cubics, so the flags have to be re-derived downstream. For the few
   * shapes where which side of the circle gets drawn is the whole point, this avoids the question.
   */
  function arcLine(ctx, cx, cy, rad, a0, a1, steps) {
    var n = Math.max(2, steps || 24);
    for (var i = 1; i <= n; i++) {
      var a = a0 + (a1 - a0) * (i / n);
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
  }

  function arcPath(cx, cy, rad0, a0, a1, ccw) {
    /*
     * A full turn is two half arcs. Emitted as one arc the start and end point coincide, the
     * core's endpoint-parameterised converter sees an arc of zero extent and the circle
     * collapses to nothing. Split, each half has real width.
     */
    if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) {
      var mid = a0 + (a1 - a0) / 2;
      return arcPath(cx, cy, rad0, a0, mid, ccw) + ' ' + arcPath(cx, cy, rad0, mid, a1, ccw).slice(1);
    }
    var p0 = [cx + Math.cos(a0) * rad0, cy + Math.sin(a0) * rad0];
    var p1 = [cx + Math.cos(a1) * rad0, cy + Math.sin(a1) * rad0];
    var large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    var sweep = ccw ? 0 : 1;
    return 'M' + r(p0[0]) + ' ' + r(p0[1]) + 'A' + r(rad0) + ' ' + r(rad0) + ' 0 ' + large + ' ' + sweep +
      ' ' + r(p1[0]) + ' ' + r(p1[1]);
  }

  function installInto(grid) {
    if (!grid || grid.getAttribute('data-amz-shapes') === '1') return false;
    var frag = document.createDocumentFragment();
    GROUPS.forEach(function (group) {
      var heading = document.createElement('div');
      heading.className = 'amzShapeHeading';
      heading.textContent = group.label;
      frag.appendChild(heading);
      group.items.forEach(function (id) {
        if (!SHAPES[id]) return;
        var b = document.createElement('button');
        b.className = 'amShapeItem shapeItem';
        b.setAttribute('data-add', id);
        b.setAttribute('title', LABELS[id] || id);
        b.innerHTML = icon(id);
        b.onclick = function () {
          try {
            if (window.omsAmzBridge) window.omsAmzBridge.checkpoint();
            var layer = window.model.addLayer('shape', { shape: id, name: LABELS[id] || id });
            if (!layer) { if (window.omsAmzHub) window.omsAmzHub.notify('Open a project first'); return; }
            /* Hand the layer real geometry, otherwise the core has no idea how to draw it. */
            if (!applyVectorPath(layer, id)) {
              if (window.omsAmzHub) window.omsAmzHub.notify('Could not build that shape');
              return;
            }
            if (window.omsAmzBridge) window.omsAmzBridge.refresh();
            if (window.ui && window.ui.openInspectorRoot) window.ui.openInspectorRoot();
          } catch (e) {
            if (window.omsAmzHub) window.omsAmzHub.notify('Could not add that shape');
          }
        };
        frag.appendChild(b);
      });
    });
    grid.appendChild(frag);
    grid.setAttribute('data-amz-shapes', '1');
    return true;
  }

  function install() {
    var grids = document.querySelectorAll('.amShapeGrid');
    var any = false;
    for (var i = 0; i < grids.length; i++) {
      if (installInto(grids[i])) any = true;
    }
    return any;
  }

  /**
   * Routes the built-in draw path through this module for the shapes it owns.
   *
   * `tracePrimitiveShapePath` is a top-level function declaration, so it is a property of
   * the global object and can be replaced. The wrapper calls the original for every shape
   * it did not invent, and returns the original's value unchanged, so nothing that already
   * drew keeps a different code path.
   *
   * This is done here rather than by editing the document because `web/index.html` is
   * vendored byte-identical against a recorded hash; a single inserted line invalidates the
   * translation offsets and fails the build.
   */
  var HOOK_ATTEMPTS = 0;
  /**
   * Shapes the core cannot draw closed.
   *
   * arc and wideline are meant to be seen as a stroke, not a fill, so marking them closed
   * would string a chord back across the opening and turn an arc into a lens. A 2-point line
   * has no interior at all and a closed 2-point path is invisible. So these are stamped open
   * and given a stroke width, which makes the core take its stroke branch.
   */
  var OPEN_SHAPES = { arc: 1, wideline: 1, waveline: 1 };

  var OPEN_STROKE_WIDTH = 10;

  /** Fill in the handles a node list leaves implicit, the way traceVectorShapePath reads them. */
  function finishContour(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return null;
      if (!Number.isFinite(n.inX)) { n.inX = n.x; n.inY = n.y; }
      if (!Number.isFinite(n.outX)) { n.outX = n.x; n.outY = n.y; }
    }
    return nodes;
  }

  /**
   * Give a shape layer a real vector path.
   *
   * The core draws nine primitives (star, circle, polygon...). Anything else it does not know,
   * so a layer with shape:'heart' rendered as nothing at all - which is exactly why the 58
   * chips appeared to do nothing when tapped.
   *
   * The core DOES draw arbitrary paths when layer.shape is 'vector' and layer.vectorNodes holds
   * the node list. So the fix is not to hook the renderer: it is to hand each layer the geometry
   * it needs at creation time.
   */
  function applyVectorPath(layer, id) {
    if (!layer || !SHAPES[id]) return false;
    try {
      var w = Math.max(1, Number(layer.w) || 100);
      var h = Math.max(1, Number(layer.h) || 100);
      var st = { points: layer.shapePoints, inner: (Number(layer.shapeInner) || 46) / 100,
                 phase: layer.shapePhase, sides: layer.shapeSides,
                 tip: (Number(layer.shapeTip) || 50) / 100,
                 arrowHead: (Number(layer.shapeArrowHead) || 35) / 100,
                 arrowBody: (Number(layer.shapeArrowBody) || 28) / 100 };
      var nodes = nodesFor(id, w, h, st);
      if (!nodes) {
        log('"' + id + '" could not be converted to a path.');
        return false;
      }
      nodes = finishContour(nodes);
      if (!nodes) {
        log('"' + id + '" produced coordinates the renderer cannot use.');
        return false;
      }
      var open = !!OPEN_SHAPES[id];
      layer.shape = 'vector';
      layer.vectorNodes = nodes;
      layer.vectorClosed = !open;
      if (open && !(Number(layer.strokeWidth) > 0)) layer.strokeWidth = OPEN_STROKE_WIDTH;
      layer.amzShapeId = id;
      return true;
    } catch (e) {
      log('could not build a path for ' + id + ': ' + e.message);
      return false;
    }
  }

  function hookRenderer() {
    /*
     * The core is one IIFE, so tracePrimitiveShapePath is private and window.* is always
     * undefined. Kept as a no-op that reports honestly rather than pretending to install.
     */
    if (window.omsAmzBridge) {
      window.omsAmzBridge.report('shapes', true, 'path-based; no renderer hook needed');
    }
    return true;
  }

  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-shapes: ' + m);
    } catch (e) {}
  }

  window.omsAmzShapes = {
    SHAPES: SHAPES,
    traceShape: traceShape,
    pathData: pathData,
    install: install,
    hookRenderer: hookRenderer,
    LABELS: LABELS,
    GROUPS: GROUPS,
    applyVectorPath: applyVectorPath,
    nodesFor: nodesFor,
  };

  function boot() {
    var tries = 0;
    (function attempt() {
      var hooked = hookRenderer();
      install();
      tries++;
      if (!hooked && tries < 40) setTimeout(attempt, 500);
      else if (hooked) log('renderer hooked with ' + Object.keys(SHAPES).length + ' shapes');
    })();
    document.addEventListener('click', function () { setTimeout(install, 70); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
