/*
 * EditorsHub native core — plain C ABI.
 *
 * Everything here is deliberately free of the JVM, of exceptions and of the C++ standard
 * library: the same translation unit is compiled by the NDK for Android, by the host compiler
 * for the correctness tests in tests/native, and can later be compiled for any other target
 * without changes. That is the point of the port — one implementation, several front ends.
 *
 * Conventions used throughout:
 *   - every image is 8-bit RGBA, straight (non-premultiplied) alpha, row-major, with an
 *     explicit byte stride so a sub-rectangle of a larger surface can be processed in place;
 *   - every entry point returns 0 on success and a negative code on a rejected argument,
 *     and never throws, aborts or writes outside the described bounds;
 *   - no allocation happens on the hot path.
 */
#ifndef OHC_CORE_H
#define OHC_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OHC_OK                 0
#define OHC_ERR_ARGUMENT      (-1)
#define OHC_ERR_RANGE         (-2)
#define OHC_ERR_UNSUPPORTED   (-3)

/* Blend modes, ordered as the editor's effect list orders them. */
enum {
    OHC_BLEND_NORMAL = 0,
    OHC_BLEND_MULTIPLY,
    OHC_BLEND_SCREEN,
    OHC_BLEND_OVERLAY,
    OHC_BLEND_DARKEN,
    OHC_BLEND_LIGHTEN,
    OHC_BLEND_COLOR_DODGE,
    OHC_BLEND_COLOR_BURN,
    OHC_BLEND_HARD_LIGHT,
    OHC_BLEND_SOFT_LIGHT,
    OHC_BLEND_DIFFERENCE,
    OHC_BLEND_EXCLUSION,
    OHC_BLEND_ADD,
    OHC_BLEND_MODE_COUNT
};

/* Keyframe interpolation modes. */
enum {
    OHC_INTERP_HOLD = 0,
    OHC_INTERP_LINEAR = 1,
    OHC_INTERP_BEZIER = 2
};

/*
 * One keyframe.
 *
 * `c1x/c1y/c2x/c2y` are the Bezier control handles, normalised the way CSS cubic-bezier()
 * takes them: c1 is the outgoing handle of this key, c2 the incoming handle of the next.
 * They are only consulted when this key's `interp` is OHC_INTERP_BEZIER.
 */
typedef struct {
    double time;
    double value;
    double c1x, c1y;
    double c2x, c2y;
    int32_t interp;
} OhcKey;

/** Semantic version of the core, packed as MAJOR*10000 + MINOR*100 + PATCH. */
int32_t ohc_version(void);

/** Number of blend modes this build implements. */
int32_t ohc_blend_mode_count(void);

/** Human-readable name of a blend mode, or "unknown". */
const char *ohc_blend_mode_name(int32_t mode);

/**
 * Solves the CSS cubic-bezier easing for `t` in [0,1] and returns the eased progress.
 * Control points are (x1,y1) and (x2,y2); x values are clamped to [0,1] as CSS requires.
 * Degenerate curves (x1==x2==0 or 1) still return a monotonic result rather than NaN.
 */
double ohc_bezier_ease(double x1, double y1, double x2, double y2, double t);

/**
 * Evaluates a keyframe track at time `t`.
 *
 * Keys need not be sorted; the track is expected to be sorted by the caller because sorting on
 * every frame is the sort of thing that makes a preview stutter. Before the first key the first
 * value is returned, and after the last key the last value is returned — matching how the
 * editor holds a value outside its keyed range.
 */
int32_t ohc_eval_keys(const OhcKey *keys, int32_t count, double t, double *out_value);

/**
 * Composites `src` onto `dst` in place.
 *
 * Both surfaces must be RGBA8 with the given dimensions and strides in bytes. `dst_w/dst_h`
 * describe the destination surface; `src` is sampled 1:1 from its own top-left corner, so a
 * caller wanting to place a smaller source must use ohc_transform_blit instead.
 *
 * `opacity` multiplies the source alpha, in [0,1]. `mode` is one of the OHC_BLEND_* values.
 */
int32_t ohc_composite(uint8_t *dst, int32_t dst_w, int32_t dst_h, int32_t dst_stride,
                      const uint8_t *src, int32_t src_stride,
                      double opacity, int32_t mode);

/**
 * Draws `src` into `dst` through an affine transform.
 *
 * `m` is the six-value affine matrix in the order [a, b, c, d, e, f], mapping a source pixel
 * (sx, sy) to (a*sx + c*sy + e, b*sx + d*sy + f) — the same order as Canvas2D's setTransform and
 * as the editor's layer transform. Sampling is bilinear when `bilinear` is non-zero and nearest
 * otherwise. Destination pixels outside the inverse-mapped source are left untouched, which makes
 * this usable as a layer blit without clearing the frame first.
 */
int32_t ohc_transform_blit(uint8_t *dst, int32_t dst_w, int32_t dst_h, int32_t dst_stride,
                           const uint8_t *src, int32_t src_w, int32_t src_h, int32_t src_stride,
                           const double *m, int32_t bilinear, double opacity, int32_t mode);

/**
 * Converts an RGBA8 surface to NV12 (full-range BT.709 by default), the layout MediaCodec's
 * hardware H.264 encoders accept on Android. `y` receives width*height bytes and `uv`
 * receives width*height/2 bytes of interleaved chroma.
 *
 * This is the bridge that lets a rendered frame reach a hardware encoder without a round trip
 * through a JavaScript typed-array copy per plane.
 */
int32_t ohc_rgba_to_nv12(const uint8_t *rgba, int32_t w, int32_t h, int32_t stride,
                         uint8_t *y, uint8_t *uv);

/**
 * Converts an RGBA8 surface to RGBA8 premultiplied alpha in place, and back.
 * Premultiplication is what every GPU blend expects; the editor exposes straight alpha.
 */
int32_t ohc_premultiply(uint8_t *rgba, int32_t w, int32_t h, int32_t stride);
int32_t ohc_unpremultiply(uint8_t *rgba, int32_t w, int32_t h, int32_t stride);

/**
 * Applies a 256-entry RGB lookup table, the represention every LUT in the editor's colour
 * panel is stored in. `lut` holds 256*3 bytes of R,G,B in ascending input order.
 */
int32_t ohc_apply_lut(uint8_t *rgba, int32_t w, int32_t h, int32_t stride, const uint8_t *lut);

/**
 * Separable box blur over the alpha-weighted RGB, used by the glow and shadow effects.
 * `radius` is the kernel half-width in pixels; 0 is a no-op.
 */
int32_t ohc_box_blur(uint8_t *rgba, int32_t w, int32_t h, int32_t stride, int32_t radius);

#ifdef __cplusplus
}
#endif

#endif /* OHC_CORE_H */
