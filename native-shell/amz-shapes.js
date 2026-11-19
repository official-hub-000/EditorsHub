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
    /* Scalloped edge: arcs bulging outward, which a straight-line polygon cannot express. */
    var lobes = Math.max(3, s.sides);
    var step = Math.PI * 2 / lobes;
    var r = Math.min(s.rx, s.ry);
    for (var i = 0; i < lobes; i++) {
      var a0 = (s.phase - 90) * Math.PI / 180 + i * step;
      var a1 = a0 + step;
      var p0 = [s.cx + Math.cos(a0) * r, s.cy + Math.sin(a0) * r];
      var p1 = [s.cx + Math.cos(a1) * r, s.cy + Math.sin(a1) * r];
      if (i === 0) ctx.moveTo(p0[0], p0[1]);
      ctx.arc(s.cx, s.cy, r, a0, a1, false);
      ctx.lineTo(p1[0], p1[1]);
    }
    ctx.closePath();
  });

  register('heart', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx, o.y + h);
    ctx.bezierCurveTo(o.x - w * 0.12, o.y + h * 0.62, o.x + w * 0.06, o.y - h * 0.06, s.cx, o.y + h * 0.26);
    ctx.bezierCurveTo(o.x + w * 0.94, o.y - h * 0.06, o.x + w * 1.12, o.y + h * 0.62, s.cx, o.y + h);
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
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y + h * 0.55, s.cx, o.y + h);
    ctx.quadraticCurveTo(o.x, o.y + h * 0.55, s.cx, o.y);
    ctx.closePath();
  });

  register('leaf', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(o.x, o.y + h);
    ctx.quadraticCurveTo(o.x, o.y, o.x + w, o.y);
    ctx.quadraticCurveTo(o.x + w, o.y + h, o.x, o.y + h);
    ctx.closePath();
  });

  register('crescent', function (ctx, s) {
    /* Outer arc, then an inner arc back the other way — an actual crescent, not two circles. */
    var r = Math.min(s.rx, s.ry);
    ctx.arc(s.cx, s.cy, r, Math.PI * 0.55, Math.PI * 2.45, false);
    ctx.arc(s.cx + r * 0.55, s.cy, r * 0.92, Math.PI * 2.05, Math.PI * 0.95, true);
    ctx.closePath();
  });

  register('moon', function (ctx, s) {
    var r = Math.min(s.rx, s.ry) * 0.92;
    ctx.arc(s.cx, s.cy, r, Math.PI * 0.62, Math.PI * 2.38, false);
    ctx.arc(s.cx + r * 0.72, s.cy - r * 0.1, r * 0.98, Math.PI * 2.3, Math.PI * 0.7, true);
    ctx.closePath();
  });

  register('cloud', function (ctx, s) {
    var w = s.w, h = s.h, o = s.offset;
    var by = o.y + h * 0.72, r1 = h * 0.28, r2 = h * 0.38, r3 = h * 0.26;
    ctx.moveTo(o.x + w * 0.16, by);
    ctx.arc(o.x + w * 0.24, by - r1 * 0.5, r1, Math.PI, Math.PI * 1.5, false);
    ctx.arc(o.x + w * 0.46, by - r2 * 0.9, r2, Math.PI * 1.15, Math.PI * 1.85, false);
    ctx.arc(o.x + w * 0.74, by - r3 * 0.6, r3, Math.PI * 1.3, Math.PI * 1.95, false);
    ctx.lineTo(o.x + w * 0.92, by);
    ctx.quadraticCurveTo(o.x + w * 0.5, by + h * 0.16, o.x + w * 0.08, by);
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
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx, o.y);
    ctx.bezierCurveTo(o.x + w * 0.82, o.y + h * 0.28, o.x + w * 0.82, o.y + h * 0.66, o.x + w * 0.78, o.y + h * 0.76);
    ctx.lineTo(o.x + w * 0.56, o.y + h * 0.7);
    ctx.lineTo(o.x + w * 0.44, o.y + h * 0.7);
    ctx.lineTo(o.x + w * 0.22, o.y + h * 0.76);
    ctx.bezierCurveTo(o.x + w * 0.18, o.y + h * 0.66, o.x + w * 0.18, o.y + h * 0.28, s.cx, o.y);
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
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx - w * 0.06, o.y);
    ctx.lineTo(s.cx + w * 0.06, o.y);
    ctx.lineTo(s.cx + w * 0.1, o.y + h * 0.42);
    ctx.lineTo(o.x + w, o.y + h * 0.62);
    ctx.lineTo(o.x + w, o.y + h * 0.72);
    ctx.lineTo(s.cx + w * 0.1, o.y + h * 0.58);
    ctx.lineTo(s.cx + w * 0.06, o.y + h * 0.9);
    ctx.lineTo(s.cx + w * 0.22, o.y + h);
    ctx.lineTo(s.cx - w * 0.22, o.y + h);
    ctx.lineTo(s.cx - w * 0.06, o.y + h * 0.9);
    ctx.lineTo(s.cx - w * 0.1, o.y + h * 0.58);
    ctx.lineTo(o.x, o.y + h * 0.72);
    ctx.lineTo(o.x, o.y + h * 0.62);
    ctx.lineTo(s.cx - w * 0.1, o.y + h * 0.42);
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
    var w = s.w, h = s.h, o = s.offset;
    ctx.moveTo(s.cx, o.y);
    ctx.bezierCurveTo(o.x + w * 0.86, o.y + h * 0.36, o.x + w * 0.9, o.y + h * 0.7, s.cx, o.y + h);
    ctx.bezierCurveTo(o.x + w * 0.1, o.y + h * 0.7, o.x + w * 0.14, o.y + h * 0.36, s.cx, o.y);
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
    var inner = r * 0.62;
    ctx.arc(s.cx, s.cy, r, 0, Math.PI * 2, false);
    ctx.moveTo(s.cx + inner, s.cy);
    ctx.arc(s.cx, s.cy, inner, 0, Math.PI * 2, true);
    ctx.closePath();
  });
  register('donut', function (ctx, s) {
    var r = Math.min(s.rx, s.ry) * 0.96;
    var inner = r * 0.5;
    ctx.arc(s.cx, s.cy, r, 0, Math.PI * 2, false);
    ctx.moveTo(s.cx + inner, s.cy);
    ctx.arc(s.cx, s.cy, inner, 0, Math.PI * 2, true);
    ctx.closePath();
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
    var r = Math.min(s.w, s.h) / 2;
    ctx.moveTo(s.offset.x + r, s.offset.y);
    ctx.lineTo(s.offset.x + s.w - r, s.offset.y);
    ctx.arc(s.offset.x + s.w - r, s.cy, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.lineTo(s.offset.x + r, s.offset.y + s.h);
    ctx.arc(s.offset.x + r, s.cy, r, Math.PI / 2, Math.PI * 1.5, false);
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
    var k = 0.36, cx = s.cx, cy = s.cy, hw = s.rx, hh = s.ry;
    var a = hw * k, b = hh * k;
    trace(ctx, [[cx - a, cy - hh], [cx + a, cy - hh], [cx + a, cy - b], [cx + hw, cy - b],
                [cx + hw, cy + b], [cx + a, cy + b], [cx + a, cy + hh], [cx + b * 0.2 - a, cy + hh],
                [cx - a, cy + hh], [cx - a, cy + b], [cx - hw, cy + b], [cx - hw, cy - b],
                [cx - a, cy - b]]);
  });
  register('xmark', function (ctx, s) {
    var t = 0.22, cx = s.cx, cy = s.cy, hw = s.rx, hh = s.ry;
    var dx = hw * t, dy = hh * t;
    trace(ctx, [[cx - dx, cy - hh], [cx, cy - hh + dy * 1.4], [cx + dx, cy - hh], [cx + hw, cy - hh + dy * 1.4],
                [cx + dx * 1.4, cy], [cx + hw, cy + hh - dy * 1.4], [cx + dx, cy + hh],
                [cx, cy + hh - dy * 1.4], [cx - dx, cy + hh], [cx - hw, cy + hh - dy * 1.4],
                [cx - dx * 1.4, cy], [cx - hw, cy - hh + dy * 1.4]]);
  });
  register('checkmark', function (ctx, s) {
    trace(ctx, [[s.offset.x + s.w * 0.06, s.cy - s.h * 0.02], [s.offset.x + s.w * 0.34, s.offset.y + s.h],
                [s.offset.x + s.w, s.offset.y], [s.offset.x + s.w * 0.84, s.offset.y + s.h * 0.3],
                [s.offset.x + s.w * 0.34, s.offset.y + s.h * 0.72]]);
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
    var b = s.w * 0.28;
    ctx.rect(s.offset.x + s.w * 0.16, s.offset.y, b, s.h);
    ctx.rect(s.offset.x + s.w * 0.56, s.offset.y, b, s.h);
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
    var r = Math.min(s.rx, s.ry) * 0.72;
    ctx.arc(s.cx - r * 0.18, s.cy - r * 0.18, r, 0, Math.PI * 2, false);
    ctx.moveTo(s.cx + r * 0.5, s.cy + r * 0.5);
    ctx.lineTo(s.cx + r * 1.15, s.cy + r * 1.15);
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
    var w = s.w, h = s.h, o = s.offset;
    trace(ctx, [[o.x, o.y], [o.x + w * 0.86, o.y], [o.x + w * 0.86, o.y + h * 0.3], [o.x + w, o.y + h * 0.3],
                [o.x + w, o.y + h * 0.7], [o.x + w * 0.86, o.y + h * 0.7], [o.x + w * 0.86, o.y + h],
                [o.x, o.y + h], [o.x + w * 0.14, o.y + h * 0.5]]);
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
    var arms = 6;
    for (var i = 0; i < arms; i++) {
      var a = (i * Math.PI * 2) / arms - Math.PI / 2;
      var x = s.cx + Math.cos(a) * s.rx;
      var y = s.cy + Math.sin(a) * s.ry;
      ctx.moveTo(s.cx, s.cy);
      ctx.lineTo(x, y);
      var bx = s.cx + Math.cos(a) * s.rx * 0.62;
      var by = s.cy + Math.sin(a) * s.ry * 0.62;
      for (var b = -1; b <= 1; b += 2) {
        var ba = a + b * 0.6;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * s.rx * 0.3, by + Math.sin(ba) * s.ry * 0.3);
      }
    }
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
    var fake = {
      beginPath: function () { parts.length = 0; },
      moveTo: function (x, y) { parts.push('M' + r(x) + ' ' + r(y)); },
      lineTo: function (x, y) { parts.push('L' + r(x) + ' ' + r(y)); },
      quadraticCurveTo: function (a, b, c, d) { parts.push('Q' + r(a) + ' ' + r(b) + ' ' + r(c) + ' ' + r(d)); },
      bezierCurveTo: function (a, b, c, d, e, f) {
        parts.push('C' + r(a) + ' ' + r(b) + ' ' + r(c) + ' ' + r(d) + ' ' + r(e) + ' ' + r(f));
      },
      arc: function (cx, cy, r0, s, e, ccw) { parts.push(arcPath(cx, cy, r0, s, e, ccw)); },
      rect: function (x, y, w, h) {
        parts.push('M' + r(x) + ' ' + r(y) + 'L' + r(x + w) + ' ' + r(y) + 'L' + r(x + w) + ' ' + r(y + h) +
          'L' + r(x) + ' ' + r(y + h) + 'Z');
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

  function arcPath(cx, cy, rad0, a0, a1, ccw) {
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
            if (window.history && window.history.push) window.history.push();
            window.model.addLayer('shape', { shape: id, name: LABELS[id] || id });
            if (window.ui && window.ui.rebuildAll) window.ui.rebuildAll();
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
  function hookRenderer() {
    var original = window.tracePrimitiveShapePath;
    if (typeof original !== 'function') return false;
    if (original.__amzWrapped) return true;
    var wrapped = function (ctx, layer, w, h, offsetX, offsetY, time) {
      var id = layer && layer.shape;
      if (id && SHAPES[id]) {
        var st = window.omsShapeState ? window.omsShapeState(layer, time == null ? undefined : time) : null;
        if (traceShape(ctx, id, layer, w, h, offsetX || 0, offsetY || 0)) return st;
      }
      return original.apply(this, arguments);
    };
    wrapped.__amzWrapped = true;
    try {
      window.tracePrimitiveShapePath = wrapped;
    } catch (e) {
      log('could not replace the shape renderer: ' + e.message);
      return false;
    }
    return window.tracePrimitiveShapePath === wrapped;
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
