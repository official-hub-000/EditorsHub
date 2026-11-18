/*
 * EditorsHub native core — implementation.
 *
 * Compiled twice: by the NDK into libeditorhubcore.so for the app, and by the host compiler into
 * tests/native for the correctness suite. It must therefore stay free of anything Android-only.
 */
#include "ohc_core.h"

#include <math.h>
#include <stdlib.h>

/* A local std::min/std::max is used instead of <algorithm>: the library is built with
 * -fno-exceptions -fno-rtti and should not pull in a broader dependency surface than needed. */
namespace {

template <typename T>
inline T min_of(T a, T b) { return a < b ? a : b; }

inline double clamp01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

inline int clamp_byte(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

inline double clamp_byte_d(double v) { return v < 0.0 ? 0.0 : (v > 255.0 ? 255.0 : v); }

inline uint8_t to_byte(double v) { return (uint8_t)(clamp_byte_d(v) + 0.5); }

/* ---------------------------------------------------------------- cubic bezier */

/*
 * Evaluates a 1-D cubic bezier with endpoints at 0 and 1: B(p) for p in [0,1].
 * Written out rather than using de Casteljau to keep it branch-free and vectorisable.
 */
inline double bezier1d(double c1, double c2, double p) {
    const double q = 1.0 - p;
    /* B(p) = 3(1-p)^2 p c1 + 3(1-p) p^2 c2 + p^3 */
    return 3.0 * q * q * p * c1 + 3.0 * q * p * p * c2 + p * p * p;
}

inline double bezier1d_slope(double c1, double c2, double p) {
    const double q = 1.0 - p;
    /* d/dp of the expression above. */
    return 3.0 * q * q * c1 + 6.0 * q * p * (c2 - c1) + 3.0 * p * p * (1.0 - c2);
}

/* ------------------------------------------------------------------- blending */

/*
 * Mixes two 8-bit channels for a given mode. Working in doubles for every pixel would be slow in
 * a blur-heavy scene, so the separable modes are integer-scaled by 255 and the rest use a small
 * amount of floating point. Accuracy target is +-1 of a level, which is below the display's.
 */
inline int blend_channel(int mode, int cb, int cs) {
    switch (mode) {
        case OHC_BLEND_NORMAL:      return cs;
        case OHC_BLEND_MULTIPLY:    return (cb * cs + 127) / 255;
        case OHC_BLEND_SCREEN:      return 255 - ((255 - cb) * (255 - cs) + 127) / 255;
        case OHC_BLEND_OVERLAY:
            return cb < 128 ? (2 * cb * cs + 127) / 255
                            : 255 - (2 * (255 - cb) * (255 - cs) + 127) / 255;
        case OHC_BLEND_DARKEN:      return cb < cs ? cb : cs;
        case OHC_BLEND_LIGHTEN:     return cb > cs ? cb : cs;
        case OHC_BLEND_COLOR_DODGE:
            if (cb == 0) return 0;
            if (cs >= 255) return 255;
            return min_of(255, (cb * 255) / (255 - cs));
        case OHC_BLEND_COLOR_BURN:
            if (cb >= 255) return 255;
            if (cs == 0) return 0;
            return 255 - min_of(255, ((255 - cb) * 255) / cs);
        case OHC_BLEND_HARD_LIGHT:
            return cs < 128 ? (2 * cb * cs + 127) / 255
                            : 255 - (2 * (255 - cb) * (255 - cs) + 127) / 255;
        case OHC_BLEND_SOFT_LIGHT: {
            /* W3C compositing formula, in 0..1 space. */
            const double b = cb / 255.0, s = cs / 255.0;
            double d;
            if (s <= 0.5) {
                d = b - (1.0 - 2.0 * s) * b * (1.0 - b);
            } else {
                const double c = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b
                                             : sqrt(b);
                d = b + (2.0 * s - 1.0) * (c - b);
            }
            return clamp_byte((int)(d * 255.0 + 0.5));
        }
        case OHC_BLEND_DIFFERENCE:  return cb > cs ? cb - cs : cs - cb;
        case OHC_BLEND_EXCLUSION:   return cb + cs - 2 * cb * cs / 255;
        case OHC_BLEND_ADD:         return min_of(255, cb + cs);
        default:                    return cs;
    }
}

} /* namespace */

extern "C" {

/* ---------------------------------------------------------------- introspection */

int32_t ohc_version(void) { return 1 * 10000 + 0 * 100 + 0; }

int32_t ohc_blend_mode_count(void) { return OHC_BLEND_MODE_COUNT; }

const char *ohc_blend_mode_name(int32_t mode) {
    switch (mode) {
        case OHC_BLEND_NORMAL:      return "normal";
        case OHC_BLEND_MULTIPLY:    return "multiply";
        case OHC_BLEND_SCREEN:      return "screen";
        case OHC_BLEND_OVERLAY:     return "overlay";
        case OHC_BLEND_DARKEN:      return "darken";
        case OHC_BLEND_LIGHTEN:     return "lighten";
        case OHC_BLEND_COLOR_DODGE: return "color-dodge";
        case OHC_BLEND_COLOR_BURN:  return "color-burn";
        case OHC_BLEND_HARD_LIGHT:  return "hard-light";
        case OHC_BLEND_SOFT_LIGHT:  return "soft-light";
        case OHC_BLEND_DIFFERENCE:  return "difference";
        case OHC_BLEND_EXCLUSION:   return "exclusion";
        case OHC_BLEND_ADD:         return "add";
        default:                    return "unknown";
    }
}

/* --------------------------------------------------------------------- easing */

double ohc_bezier_ease(double x1, double y1, double x2, double y2, double t) {
    if (!(t > 0.0)) return 0.0;      /* also catches NaN */
    if (t >= 1.0) return 1.0;
    x1 = clamp01(x1);
    x2 = clamp01(x2);
    /* A linear curve is the overwhelmingly common case; skip the solver entirely. */
    if (x1 == y1 && x2 == y2) return t;

    /*
     * Solve Bx(p) = t for p with Newton's method, falling back to bisection when the derivative
     * is too small to trust. Ten iterations of Newton puts the residual below 1e-9 for every
     * curve a timeline can express; the bisection fallback guarantees termination.
     */
    double p = t;
    for (int i = 0; i < 10; ++i) {
        const double x = bezier1d(x1, x2, p) - t;
        if (x < 1e-9 && x > -1e-9) break;
        const double slope = bezier1d_slope(x1, x2, p);
        if (slope < 1e-6 && slope > -1e-6) break;
        p -= x / slope;
        if (p < 0.0) p = 0.0;
        if (p > 1.0) p = 1.0;
    }
    /* Verify; if Newton wandered, bisect. This is the correctness guarantee, not a nicety. */
    double lo = 0.0, hi = 1.0;
    if (!(bezier1d(x1, x2, p) - t < 1e-6 && bezier1d(x1, x2, p) - t > -1e-6)) {
        for (int i = 0; i < 40; ++i) {
            p = 0.5 * (lo + hi);
            const double x = bezier1d(x1, x2, p);
            if (x < t) lo = p; else hi = p;
        }
        p = 0.5 * (lo + hi);
    }
    return bezier1d(y1, y2, p);
}

/* ------------------------------------------------------------------ keyframes */

int32_t ohc_eval_keys(const OhcKey *keys, int32_t count, double t, double *out_value) {
    if (!out_value) return OHC_ERR_ARGUMENT;
    if (!keys || count <= 0) return OHC_ERR_ARGUMENT;

    if (t <= keys[0].time) { *out_value = keys[0].value; return OHC_OK; }
    if (t >= keys[count - 1].time) { *out_value = keys[count - 1].value; return OHC_OK; }

    /* Binary search for the segment containing t. Keys are assumed sorted. */
    int32_t lo = 0, hi = count - 1;
    while (hi - lo > 1) {
        const int32_t mid = lo + (hi - lo) / 2;
        if (keys[mid].time <= t) lo = mid; else hi = mid;
    }

    const OhcKey &a = keys[lo];
    const OhcKey &b = keys[hi];
    const double span = b.time - a.time;
    if (span <= 0.0) { *out_value = b.value; return OHC_OK; }

    const double u = (t - a.time) / span;
    switch (a.interp) {
        case OHC_INTERP_HOLD:
            *out_value = a.value;
            return OHC_OK;
        case OHC_INTERP_BEZIER: {
            const double eased = ohc_bezier_ease(a.c1x, a.c1y, a.c2x, a.c2y, u);
            *out_value = a.value + (b.value - a.value) * eased;
            return OHC_OK;
        }
        case OHC_INTERP_LINEAR:
        default:
            *out_value = a.value + (b.value - a.value) * u;
            return OHC_OK;
    }
}

/* ----------------------------------------------------------------- compositing */

int32_t ohc_composite(uint8_t *dst, int32_t dst_w, int32_t dst_h, int32_t dst_stride,
                      const uint8_t *src, int32_t src_stride,
                      double opacity, int32_t mode) {
    if (!dst || !src) return OHC_ERR_ARGUMENT;
    if (dst_w <= 0 || dst_h <= 0) return OHC_ERR_ARGUMENT;
    if (dst_stride < dst_w * 4 || src_stride < dst_w * 4) return OHC_ERR_ARGUMENT;
    if (mode < 0 || mode >= OHC_BLEND_MODE_COUNT) return OHC_ERR_UNSUPPORTED;
    if (opacity <= 0.0) return OHC_OK;
    opacity = clamp01(opacity);

    for (int32_t y = 0; y < dst_h; ++y) {
        uint8_t *d = dst + (size_t)y * (size_t)dst_stride;
        const uint8_t *s = src + (size_t)y * (size_t)src_stride;
        for (int32_t x = 0; x < dst_w; ++x, d += 4, s += 4) {
            const int sa = (int)(s[3] * opacity + 0.5);
            if (sa <= 0) continue;
            if (sa >= 255 && mode == OHC_BLEND_NORMAL) {
                d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; d[3] = 255;
                continue;
            }
            const int db = d[3];
            /* Porter-Duff source-over with a per-channel blend function on the colour. */
            for (int c = 0; c < 3; ++c) {
                const int mixed = blend_channel(mode, d[c], s[c]);
                /* Straight-alpha interpolation: result = mix(dst, mixed, sa/255). */
                const double a = sa / 255.0;
                d[c] = clamp_byte((int)(d[c] * (1.0 - a) + mixed * a + 0.5));
            }
            const int out_a = sa + (db * (255 - sa) + 127) / 255;
            d[3] = (uint8_t)(out_a > 255 ? 255 : out_a);
        }
    }
    return OHC_OK;
}

/* ------------------------------------------------------------ affine transform */

int32_t ohc_transform_blit(uint8_t *dst, int32_t dst_w, int32_t dst_h, int32_t dst_stride,
                           const uint8_t *src, int32_t src_w, int32_t src_h, int32_t src_stride,
                           const double *m, int32_t bilinear, double opacity, int32_t mode) {
    if (!dst || !src || !m) return OHC_ERR_ARGUMENT;
    if (dst_w <= 0 || dst_h <= 0 || src_w <= 0 || src_h <= 0) return OHC_ERR_ARGUMENT;
    if (dst_stride < dst_w * 4 || src_stride < src_w * 4) return OHC_ERR_ARGUMENT;
    if (mode < 0 || mode >= OHC_BLEND_MODE_COUNT) return OHC_ERR_UNSUPPORTED;
    opacity = clamp01(opacity);
    if (opacity <= 0.0) return OHC_OK;

    /* Invert the affine map so each destination pixel can find its source. */
    const double a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];
    const double det = a * d - b * c;
    if (det == 0.0 || det != det) return OHC_ERR_ARGUMENT;
    const double id = 1.0 / det;

    for (int32_t y = 0; y < dst_h; ++y) {
        uint8_t *row = dst + (size_t)y * (size_t)dst_stride;
        for (int32_t x = 0; x < dst_w; ++x) {
            const double dx = x + 0.5 - e;
            const double dy = y + 0.5 - f;
            const double sx = (d * dx - c * dy) * id;
            const double sy = (-b * dx + a * dy) * id;
            if (sx < 0.0 || sy < 0.0 || sx >= src_w || sy >= src_h) continue;

            uint8_t sample[4] = {0, 0, 0, 0};
            if (bilinear) {
                const int32_t x0 = (int32_t)sx;
                const int32_t y0 = (int32_t)sy;
                const int32_t x1 = x0 + 1 < src_w ? x0 + 1 : x0;
                const int32_t y1 = y0 + 1 < src_h ? y0 + 1 : y0;
                const double fx = sx - x0, fy = sy - y0;
                const uint8_t *p00 = src + (size_t)y0 * src_stride + (size_t)x0 * 4;
                const uint8_t *p10 = src + (size_t)y0 * src_stride + (size_t)x1 * 4;
                const uint8_t *p01 = src + (size_t)y1 * src_stride + (size_t)x0 * 4;
                const uint8_t *p11 = src + (size_t)y1 * src_stride + (size_t)x1 * 4;
                for (int ch = 0; ch < 4; ++ch) {
                    const double top = p00[ch] + (p10[ch] - p00[ch]) * fx;
                    const double bot = p01[ch] + (p11[ch] - p01[ch]) * fx;
                    sample[ch] = to_byte(top + (bot - top) * fy);
                }
            } else {
                const uint8_t *p = src + (size_t)(int32_t)sy * src_stride + (size_t)(int32_t)sx * 4;
                sample[0] = p[0]; sample[1] = p[1]; sample[2] = p[2]; sample[3] = p[3];
            }

            uint8_t *dp = row + (size_t)x * 4;
            const int sa = (int)(sample[3] * opacity + 0.5);
            if (sa <= 0) continue;
            if (sa >= 255 && mode == OHC_BLEND_NORMAL) {
                dp[0] = sample[0]; dp[1] = sample[1]; dp[2] = sample[2]; dp[3] = 255;
                continue;
            }
            const int db = dp[3];
            const double alpha = sa / 255.0;
            for (int ch = 0; ch < 3; ++ch) {
                const int mixed = blend_channel(mode, dp[ch], sample[ch]);
                dp[ch] = clamp_byte((int)(dp[ch] * (1.0 - alpha) + mixed * alpha + 0.5));
            }
            const int out_a = sa + (db * (255 - sa) + 127) / 255;
            dp[3] = (uint8_t)(out_a > 255 ? 255 : out_a);
        }
    }
    return OHC_OK;
}

/* -------------------------------------------------------------- colour convert */

int32_t ohc_rgba_to_nv12(const uint8_t *rgba, int32_t w, int32_t h, int32_t stride,
                         uint8_t *y_plane, uint8_t *uv_plane) {
    if (!rgba || !y_plane || !uv_plane) return OHC_ERR_ARGUMENT;
    if (w <= 0 || h <= 0 || (w & 1) || (h & 1)) return OHC_ERR_ARGUMENT; /* 4:2:0 needs even */
    if (stride < w * 4) return OHC_ERR_ARGUMENT;

    for (int32_t j = 0; j < h; ++j) {
        const uint8_t *row = rgba + (size_t)j * (size_t)stride;
        for (int32_t i = 0; i < w; ++i) {
            const uint8_t *p = row + (size_t)i * 4;
            /* BT.709 full-range luma. */
            const double yy = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
            y_plane[(size_t)j * (size_t)w + (size_t)i] = to_byte(yy);
        }
    }
    /* Chroma: average each 2x2 block, then BT.709 full-range Cb/Cr. */
    for (int32_t j = 0; j < h; j += 2) {
        const uint8_t *r0 = rgba + (size_t)j * (size_t)stride;
        const uint8_t *r1 = rgba + (size_t)(j + 1) * (size_t)stride;
        for (int32_t i = 0; i < w; i += 2) {
            const uint8_t *a = r0 + (size_t)i * 4;
            const uint8_t *b = r0 + (size_t)(i + 1) * 4;
            const uint8_t *c = r1 + (size_t)i * 4;
            const uint8_t *d = r1 + (size_t)(i + 1) * 4;
            const double rr = (a[0] + b[0] + c[0] + d[0]) * 0.25;
            const double gg = (a[1] + b[1] + c[1] + d[1]) * 0.25;
            const double bb = (a[2] + b[2] + c[2] + d[2]) * 0.25;
            const double cb = -0.1146 * rr - 0.3854 * gg + 0.5 * bb + 128.0;
            const double cr = 0.5 * rr - 0.4542 * gg - 0.0458 * bb + 128.0;
            const size_t idx = ((size_t)(j / 2) * (size_t)(w / 2) + (size_t)(i / 2)) * 2;
            uv_plane[idx] = to_byte(cb);
            uv_plane[idx + 1] = to_byte(cr);
        }
    }
    return OHC_OK;
}

/* ------------------------------------------------------------ alpha and colour */

int32_t ohc_premultiply(uint8_t *rgba, int32_t w, int32_t h, int32_t stride) {
    if (!rgba) return OHC_ERR_ARGUMENT;
    if (w <= 0 || h <= 0 || stride < w * 4) return OHC_ERR_ARGUMENT;
    for (int32_t j = 0; j < h; ++j) {
        uint8_t *row = rgba + (size_t)j * (size_t)stride;
        for (int32_t i = 0; i < w; ++i) {
            uint8_t *p = row + (size_t)i * 4;
            const int a = p[3];
            p[0] = (uint8_t)((p[0] * a + 127) / 255);
            p[1] = (uint8_t)((p[1] * a + 127) / 255);
            p[2] = (uint8_t)((p[2] * a + 127) / 255);
        }
    }
    return OHC_OK;
}

int32_t ohc_unpremultiply(uint8_t *rgba, int32_t w, int32_t h, int32_t stride) {
    if (!rgba) return OHC_ERR_ARGUMENT;
    if (w <= 0 || h <= 0 || stride < w * 4) return OHC_ERR_ARGUMENT;
    for (int32_t j = 0; j < h; ++j) {
        uint8_t *row = rgba + (size_t)j * (size_t)stride;
        for (int32_t i = 0; i < w; ++i) {
            uint8_t *p = row + (size_t)i * 4;
            const int a = p[3];
            if (a == 0) { p[0] = p[1] = p[2] = 0; continue; }
            p[0] = (uint8_t)min_of(255, (p[0] * 255 + a / 2) / a);
            p[1] = (uint8_t)min_of(255, (p[1] * 255 + a / 2) / a);
            p[2] = (uint8_t)min_of(255, (p[2] * 255 + a / 2) / a);
        }
    }
    return OHC_OK;
}

int32_t ohc_apply_lut(uint8_t *rgba, int32_t w, int32_t h, int32_t stride, const uint8_t *lut) {
    if (!rgba || !lut) return OHC_ERR_ARGUMENT;
    if (w <= 0 || h <= 0 || stride < w * 4) return OHC_ERR_ARGUMENT;
    for (int32_t j = 0; j < h; ++j) {
        uint8_t *row = rgba + (size_t)j * (size_t)stride;
        for (int32_t i = 0; i < w; ++i) {
            uint8_t *p = row + (size_t)i * 4;
            p[0] = lut[(size_t)p[0] * 3 + 0];
            p[1] = lut[(size_t)p[1] * 3 + 1];
            p[2] = lut[(size_t)p[2] * 3 + 2];
        }
    }
    return OHC_OK;
}

/* --------------------------------------------------------------------- blur */

/*
 * Two-pass box blur with a running sum, so cost is independent of radius. Three passes of a box
 * blur approximate a Gaussian closely enough for glow and drop-shadow work.
 *
 * Each pass writes into a scratch buffer and copies back: a running sum that reads from the row
 * it is overwriting accumulates its own output and turns the filter into a smear. The scratch
 * line is one row (horizontal pass) or one row-length column (vertical pass) wide.
 */
int32_t ohc_box_blur(uint8_t *rgba, int32_t w, int32_t h, int32_t stride, int32_t radius) {
    if (!rgba) return OHC_ERR_ARGUMENT;
    if (w <= 0 || h <= 0 || stride < w * 4) return OHC_ERR_ARGUMENT;
    if (radius < 0) return OHC_ERR_ARGUMENT;
    if (radius == 0) return OHC_OK;
    if (radius > 64) return OHC_ERR_RANGE;

    const int32_t window = radius * 2 + 1;
    const int32_t half = window / 2;

    /* Horizontal pass: one scratch row of 4 channels per pixel. */
    uint8_t *scratch = (uint8_t *)malloc((size_t)w * 4u);
    if (!scratch) return OHC_ERR_RANGE;
    for (int32_t j = 0; j < h; ++j) {
        uint8_t *row = rgba + (size_t)j * (size_t)stride;
        int32_t sum[4] = {0, 0, 0, 0};
        for (int32_t k = -radius; k <= radius; ++k) {
            const int32_t xi = k < 0 ? 0 : (k >= w ? w - 1 : k);
            const uint8_t *p = row + (size_t)xi * 4;
            for (int ch = 0; ch < 4; ++ch) sum[ch] += p[ch];
        }
        for (int32_t i = 0; i < w; ++i) {
            uint8_t *o = scratch + (size_t)i * 4;
            for (int ch = 0; ch < 4; ++ch) o[ch] = (uint8_t)((sum[ch] + half) / window);
            /* Advance the window: drop the pixel leaving, add the one entering. */
            int32_t leaving = i - radius;
            int32_t entering = i + radius + 1;
            if (leaving < 0) leaving = 0;
            if (entering >= w) entering = w - 1;
            const uint8_t *pl = row + (size_t)leaving * 4;
            const uint8_t *pe = row + (size_t)entering * 4;
            for (int ch = 0; ch < 4; ++ch) sum[ch] += pe[ch] - pl[ch];
        }
        for (int32_t i = 0; i < w; ++i) {
            uint8_t *p = row + (size_t)i * 4;
            const uint8_t *o = scratch + (size_t)i * 4;
            p[0] = o[0]; p[1] = o[1]; p[2] = o[2]; p[3] = o[3];
        }
    }
    free(scratch);

    /* Vertical pass: one scratch column of h pixels. */
    uint8_t *col = (uint8_t *)malloc((size_t)h * 4u);
    if (!col) return OHC_ERR_RANGE;
    for (int32_t i = 0; i < w; ++i) {
        int32_t sum[4] = {0, 0, 0, 0};
        for (int32_t k = -radius; k <= radius; ++k) {
            const int32_t yi = k < 0 ? 0 : (k >= h ? h - 1 : k);
            const uint8_t *p = rgba + (size_t)yi * (size_t)stride + (size_t)i * 4;
            for (int ch = 0; ch < 4; ++ch) sum[ch] += p[ch];
        }
        for (int32_t j = 0; j < h; ++j) {
            uint8_t *o = col + (size_t)j * 4;
            for (int ch = 0; ch < 4; ++ch) o[ch] = (uint8_t)((sum[ch] + half) / window);
            int32_t leaving = j - radius;
            int32_t entering = j + radius + 1;
            if (leaving < 0) leaving = 0;
            if (entering >= h) entering = h - 1;
            const uint8_t *pl = rgba + (size_t)leaving * (size_t)stride + (size_t)i * 4;
            const uint8_t *pe = rgba + (size_t)entering * (size_t)stride + (size_t)i * 4;
            for (int ch = 0; ch < 4; ++ch) sum[ch] += pe[ch] - pl[ch];
        }
        for (int32_t j = 0; j < h; ++j) {
            uint8_t *p = rgba + (size_t)j * (size_t)stride + (size_t)i * 4;
            const uint8_t *o = col + (size_t)j * 4;
            p[0] = o[0]; p[1] = o[1]; p[2] = o[2]; p[3] = o[3];
        }
    }
    free(col);
    return OHC_OK;
}

} /* extern "C" */
