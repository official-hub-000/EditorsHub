/*
 * Correctness tests for the EditorsHub native core.
 *
 * These run on the host, not on a phone: the core is plain C++ so the same assertions that
 * would need an instrumented device to run otherwise can run in CI in under a second. Any
 * failure here means the native path disagrees with the definition, which is a bug the app
 * would ship.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "../../app/src/main/cpp/ohc_core.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond, fmt, ...)                                        \
    do {                                                             \
        ++checks;                                                    \
        if (!(cond)) {                                               \
            ++failures;                                              \
            printf("  FAIL: " fmt "\n", ##__VA_ARGS__);              \
        }                                                            \
    } while (0)

static void test_version(void) {
    printf("version and introspection\n");
    CHECK(ohc_version() == 10000, "version is %d", ohc_version());
    CHECK(ohc_blend_mode_count() == OHC_BLEND_MODE_COUNT, "mode count mismatch");
    CHECK(strcmp(ohc_blend_mode_name(OHC_BLEND_SOFT_LIGHT), "soft-light") == 0, "soft-light name");
    CHECK(strcmp(ohc_blend_mode_name(999), "unknown") == 0, "unknown mode name");
}

static void test_bezier(void) {
    printf("cubic bezier easing\n");
    /* Endpoints are pinned. */
    CHECK(fabs(ohc_bezier_ease(0.42, 0, 0.58, 1, 0.0)) < 1e-9, "ease at 0");
    CHECK(fabs(ohc_bezier_ease(0.42, 0, 0.58, 1, 1.0) - 1.0) < 1e-9, "ease at 1");
    /* A curve whose handles lie on the diagonal is the identity. */
    for (int i = 0; i <= 10; ++i) {
        const double t = i / 10.0;
        CHECK(fabs(ohc_bezier_ease(0.3, 0.3, 0.7, 0.7, t) - t) < 1e-6, "linear-ish at %f", t);
    }
    /* Monotonic for the classic ease-in-out, and symmetric about 0.5. */
    double prev = -1.0;
    for (int i = 0; i <= 100; ++i) {
        const double t = i / 100.0;
        const double v = ohc_bezier_ease(0.42, 0.0, 0.58, 1.0, t);
        CHECK(v >= prev - 1e-9, "monotonic at %f", t);
        prev = v;
    }
    const double mid = ohc_bezier_ease(0.42, 0.0, 0.58, 1.0, 0.5);
    CHECK(fabs(mid - 0.5) < 1e-6, "symmetric at 0.5, got %f", mid);
    /* ease-in stays below linear in its first half. */
    CHECK(ohc_bezier_ease(0.42, 0, 1.0, 1.0, 0.25) < 0.25, "ease-in below linear");
    /* Out-of-range and NaN inputs must not produce NaN. */
    const double nan_value = ohc_bezier_ease(0.42, 0, 0.58, 1, NAN);
    CHECK(nan_value == nan_value, "NaN input produced NaN output");
    CHECK(fabs(ohc_bezier_ease(0.42, 0, 0.58, 1, -5.0)) < 1e-9, "negative t clamps to 0");
    CHECK(fabs(ohc_bezier_ease(0.42, 0, 0.58, 1, 5.0) - 1.0) < 1e-9, "t>1 clamps to 1");
}

static void test_keyframes(void) {
    printf("keyframe evaluation\n");
    OhcKey keys[3] = {
        {0.0, 0.0, 0, 0, 0, 0, OHC_INTERP_LINEAR},
        {1.0, 100.0, 0, 0, 0, 0, OHC_INTERP_LINEAR},
        {2.0, 200.0, 0, 0, 0, 0, OHC_INTERP_HOLD},
    };
    double v = -1;
    CHECK(ohc_eval_keys(keys, 3, 0.5, &v) == OHC_OK && fabs(v - 50.0) < 1e-9, "linear mid");
    CHECK(ohc_eval_keys(keys, 3, -1.0, &v) == OHC_OK && fabs(v - 0.0) < 1e-9, "before first");
    CHECK(ohc_eval_keys(keys, 3, 99.0, &v) == OHC_OK && fabs(v - 200.0) < 1e-9, "after last");
    /* Hold keeps the LEFT key's value across its segment, so the interpolation mode of the
     * second key (linear) governs 1.0 -> 2.0. */
    CHECK(ohc_eval_keys(keys, 3, 1.5, &v) == OHC_OK && fabs(v - 150.0) < 1e-9, "linear second segment");

    /* With the second key set to hold, the value is frozen at 100 until the key at 2.0. */
    OhcKey held[3] = {
        {0.0, 0.0, 0, 0, 0, 0, OHC_INTERP_LINEAR},
        {1.0, 100.0, 0, 0, 0, 0, OHC_INTERP_HOLD},
        {2.0, 200.0, 0, 0, 0, 0, OHC_INTERP_LINEAR},
    };
    CHECK(ohc_eval_keys(held, 3, 1.5, &v) == OHC_OK && fabs(v - 100.0) < 1e-9, "hold segment");
    CHECK(ohc_eval_keys(held, 3, 2.0, &v) == OHC_OK && fabs(v - 200.0) < 1e-9, "lands on next key");

    /* Bezier segment interpolates between the key values. */
    OhcKey curve[2] = {
        {0.0, 0.0, 0.42, 0.0, 0.58, 1.0, OHC_INTERP_BEZIER},
        {1.0, 10.0, 0.0, 0.0, 0.0, 0.0, OHC_INTERP_LINEAR},
    };
    CHECK(ohc_eval_keys(curve, 2, 0.5, &v) == OHC_OK && fabs(v - 5.0) < 1e-6, "bezier mid");
    CHECK(ohc_eval_keys(curve, 2, 0.25, &v) == OHC_OK && v < 2.5, "bezier ease-in below linear");

    /* Rejected arguments. */
    CHECK(ohc_eval_keys(NULL, 3, 0, &v) == OHC_ERR_ARGUMENT, "null keys rejected");
    CHECK(ohc_eval_keys(keys, 0, 0, &v) == OHC_ERR_ARGUMENT, "empty track rejected");
    CHECK(ohc_eval_keys(keys, 3, 0, NULL) == OHC_ERR_ARGUMENT, "null output rejected");
}

static void test_composite(void) {
    printf("compositing and blend modes\n");
    /* Opaque source replaces the destination in normal mode. */
    uint8_t dst[16] = {10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint8_t src[16] = {200, 210, 220, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    CHECK(ohc_composite(dst, 4, 1, 16, src, 16, 1.0, OHC_BLEND_NORMAL) == OHC_OK, "composite ok");
    CHECK(dst[0] == 200 && dst[1] == 210 && dst[2] == 220 && dst[3] == 255, "opaque replace");

    /* Half-opacity source lands halfway. */
    uint8_t dst2[4] = {0, 0, 0, 255};
    uint8_t src2[4] = {255, 255, 255, 255};
    ohc_composite(dst2, 1, 1, 4, src2, 4, 0.5, OHC_BLEND_NORMAL);
    CHECK(abs(dst2[0] - 128) <= 1, "half opacity gave %d", dst2[0]);

    /* Multiply of 128 over 128 is 64, screen is 191. */
    const int product = (128 * 128 + 127) / 255;
    uint8_t md[4] = {128, 128, 128, 255};
    uint8_t ms[4] = {128, 128, 128, 255};
    ohc_composite(md, 1, 1, 4, ms, 4, 1.0, OHC_BLEND_MULTIPLY);
    CHECK(abs(md[0] - product) <= 1, "multiply gave %d, expected ~%d", md[0], product);

    uint8_t sd[4] = {128, 128, 128, 255};
    ohc_composite(sd, 1, 1, 4, ms, 4, 1.0, OHC_BLEND_SCREEN);
    CHECK(sd[0] > 128, "screen lightened, got %d", sd[0]);

    /* Fully transparent source leaves the destination untouched. */
    uint8_t td[4] = {1, 2, 3, 4};
    uint8_t ts[4] = {9, 9, 9, 0};
    ohc_composite(td, 1, 1, 4, ts, 4, 1.0, OHC_BLEND_NORMAL);
    CHECK(td[0] == 1 && td[1] == 2 && td[2] == 3 && td[3] == 4, "transparent src is a no-op");

    /* Invalid arguments are rejected rather than corrupting memory. */
    CHECK(ohc_composite(NULL, 1, 1, 4, src, 4, 1, 0) == OHC_ERR_ARGUMENT, "null dst");
    CHECK(ohc_composite(dst, 1, 1, 2, src, 4, 1, 0) == OHC_ERR_ARGUMENT, "stride too small");
    CHECK(ohc_composite(dst, 1, 1, 4, src, 4, 1, 99) == OHC_ERR_UNSUPPORTED, "bad mode");
}

static void test_transform(void) {
    printf("affine transform blit\n");
    /* 2x2 source, identity transform onto a 2x2 destination. */
    uint8_t src[16] = {
        255, 0, 0, 255,   0, 255, 0, 255,
        0, 0, 255, 255,   255, 255, 255, 255,
    };
    uint8_t dst[16];
    memset(dst, 0, sizeof(dst));
    const double identity[6] = {1, 0, 0, 1, 0, 0};
    CHECK(ohc_transform_blit(dst, 2, 2, 8, src, 2, 2, 8, identity, 0, 1.0, OHC_BLEND_NORMAL) == OHC_OK,
          "identity blit");
    CHECK(dst[0] == 255 && dst[1] == 0 && dst[3] == 255, "top-left copied");
    CHECK(dst[12] == 255 && dst[13] == 255 && dst[14] == 255, "bottom-right copied");

    /* A translate by (1,0) moves the source right; column 0 is untouched. */
    uint8_t dst2[16];
    memset(dst2, 0, sizeof(dst2));
    const double shift[6] = {1, 0, 0, 1, 1, 0};
    ohc_transform_blit(dst2, 2, 2, 8, src, 2, 2, 8, shift, 0, 1.0, OHC_BLEND_NORMAL);
    CHECK(dst2[0] == 0 && dst2[1] == 0 && dst2[2] == 0, "left column left empty after shift");
    CHECK(dst2[4] == 255 && dst2[5] == 0, "shifted top-left landed at x=1");

    /* A translate fully outside the destination writes nothing. */
    uint8_t dst3[16];
    memset(dst3, 7, sizeof(dst3));
    const double away[6] = {1, 0, 0, 1, 100, 100};
    ohc_transform_blit(dst3, 2, 2, 8, src, 2, 2, 8, away, 0, 1.0, OHC_BLEND_NORMAL);
    int untouched = 1;
    for (int i = 0; i < 16; ++i) if (dst3[i] != 7) untouched = 0;
    CHECK(untouched, "off-screen transform must not write");

    /* A singular matrix is rejected, not divided by zero. */
    const double singular[6] = {0, 0, 0, 0, 0, 0};
    CHECK(ohc_transform_blit(dst3, 2, 2, 8, src, 2, 2, 8, singular, 0, 1.0, 0) == OHC_ERR_ARGUMENT,
          "singular matrix rejected");
}

static void test_nv12(void) {
    printf("RGBA to NV12 conversion\n");
    /* Pure white is full luma; pure black is zero. */
    uint8_t white[16] = {255, 255, 255, 255, 255, 255, 255, 255,
                         255, 255, 255, 255, 255, 255, 255, 255};
    uint8_t y[4] = {0, 0, 0, 0};
    uint8_t uv[2] = {0, 0};
    CHECK(ohc_rgba_to_nv12(white, 2, 2, 8, y, uv) == OHC_OK, "white conversion ok");
    CHECK(y[0] >= 254, "white luma %d", y[0]);
    CHECK(abs(uv[0] - 128) <= 1 && abs(uv[1] - 128) <= 1, "white chroma neutral: %d %d", uv[0], uv[1]);

    uint8_t black[16] = {0};
    ohc_rgba_to_nv12(black, 2, 2, 8, y, uv);
    CHECK(y[0] == 0, "black luma %d", y[0]);

    /* Pure red: luma ~54 at BT.709, Cr above neutral. */
    uint8_t red[16] = {255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255};
    ohc_rgba_to_nv12(red, 2, 2, 8, y, uv);
    CHECK(abs(y[0] - 54) <= 2, "red luma %d, expected ~54", y[0]);
    CHECK(uv[1] > 200, "red Cr %d should be high", uv[1]);
    CHECK(abs(uv[0] - 102) <= 3, "red Cb %d, expected ~102", uv[0]);

    /* Odd dimensions are rejected: 4:2:0 cannot describe them. */
    CHECK(ohc_rgba_to_nv12(white, 3, 2, 12, y, uv) == OHC_ERR_ARGUMENT, "odd width rejected");
}

static void test_alpha_lut_blur(void) {
    printf("alpha, LUT and blur\n");
    uint8_t px[4] = {200, 100, 50, 128};
    CHECK(ohc_premultiply(px, 1, 1, 4) == OHC_OK, "premultiply ok");
    CHECK(abs(px[0] - 100) <= 1, "premultiplied red %d, expected ~100", px[0]);
    CHECK(ohc_unpremultiply(px, 1, 1, 4) == OHC_OK, "unpremultiply ok");
    CHECK(abs(px[0] - 200) <= 1, "round trip red %d, expected ~200", px[0]);

    /* Fully transparent round trip is safe and does not divide by zero. */
    uint8_t clear[4] = {9, 9, 9, 0};
    ohc_unpremultiply(clear, 1, 1, 4);
    CHECK(clear[0] == 0 && clear[1] == 0 && clear[2] == 0, "transparent unpremultiply zeroes");

    /* Identity LUT is a no-op; an inverted LUT inverts. */
    uint8_t lut[768];
    for (int i = 0; i < 256; ++i) { lut[i * 3] = (uint8_t)i; lut[i * 3 + 1] = (uint8_t)i; lut[i * 3 + 2] = (uint8_t)i; }
    uint8_t img[4] = {10, 20, 30, 255};
    ohc_apply_lut(img, 1, 1, 4, lut);
    CHECK(img[0] == 10 && img[1] == 20 && img[2] == 30, "identity LUT");
    for (int i = 0; i < 256; ++i) { lut[i * 3] = (uint8_t)(255 - i); lut[i * 3 + 1] = (uint8_t)(255 - i); lut[i * 3 + 2] = (uint8_t)(255 - i); }
    ohc_apply_lut(img, 1, 1, 4, lut);
    CHECK(img[0] == 245 && img[1] == 235 && img[2] == 225, "inverting LUT");

    /* A blur of a uniform field is that same field: this is the property that catches the
     * accumulate-into-self bug a running sum invites. */
    const int W = 16, H = 16;
    uint8_t field[16 * 16 * 4];
    for (int i = 0; i < W * H; ++i) {
        field[i * 4] = 120; field[i * 4 + 1] = 60; field[i * 4 + 2] = 200; field[i * 4 + 3] = 255;
    }
    CHECK(ohc_box_blur(field, W, H, W * 4, 4) == OHC_OK, "blur ok");
    int uniform = 1;
    for (int i = 0; i < W * H; ++i) {
        if (abs(field[i * 4] - 120) > 1 || abs(field[i * 4 + 1] - 60) > 1 || abs(field[i * 4 + 2] - 200) > 1) {
            uniform = 0;
            break;
        }
    }
    CHECK(uniform, "blurring a uniform field changed it");

    /* Blurring a single bright pixel on black spreads energy but conserves the centre order. */
    uint8_t spike[9 * 9 * 4];
    memset(spike, 0, sizeof(spike));
    spike[(4 * 9 + 4) * 4 + 0] = 255;
    spike[(4 * 9 + 4) * 4 + 3] = 255;
    ohc_box_blur(spike, 9, 9, 9 * 4, 1);
    CHECK(spike[(4 * 9 + 3) * 4] > 0, "blur spread left of the spike");
    CHECK(spike[(4 * 9 + 4) * 4] < 255, "blur reduced the spike centre to %d", spike[(4 * 9 + 4) * 4]);

    CHECK(ohc_box_blur(field, W, H, W * 4, -1) == OHC_ERR_ARGUMENT, "negative radius rejected");
    CHECK(ohc_box_blur(field, W, H, W * 4, 200) == OHC_ERR_RANGE, "huge radius rejected");
    CHECK(ohc_box_blur(field, W, H, W * 4, 0) == OHC_OK, "zero radius is a no-op");
}

int main(void) {
    printf("EditorsHub native core tests\n\n");
    test_version();
    test_bezier();
    test_keyframes();
    test_composite();
    test_transform();
    test_nv12();
    test_alpha_lut_blur();
    printf("\n%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
