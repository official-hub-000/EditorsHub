/*
 * JNI bridge for the EditorsHub native core.
 *
 * Deliberately thin: it converts Java array/string types at the boundary and owns the direct
 * ByteBuffers that hold pixels, so per-frame work never crosses the JNI boundary more than once.
 * All geometry and blending lives in ohc_core.cpp, which knows nothing about Android.
 */
#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "ohc_core.h"

namespace {

/* Reads a keyframe track out of three parallel jdouble arrays. */
OhcKey *read_keys(JNIEnv *env, jdoubleArray times, jdoubleArray values, jintArray interps,
                  jdoubleArray handles, jsize count) {
    if (!times || !values || count <= 0) return NULL;
    if (env->GetArrayLength(times) < count || env->GetArrayLength(values) < count) return NULL;

    jdouble *t = env->GetDoubleArrayElements(times, NULL);
    jdouble *v = env->GetDoubleArrayElements(values, NULL);
    if (!t || !v) {
        if (t) env->ReleaseDoubleArrayElements(times, t, JNI_ABORT);
        if (v) env->ReleaseDoubleArrayElements(values, v, JNI_ABORT);
        return NULL;
    }
    jint *m = interps ? env->GetIntArrayElements(interps, NULL) : NULL;
    jdouble *h = handles ? env->GetDoubleArrayElements(handles, NULL) : NULL;

    OhcKey *keys = (OhcKey *)calloc((size_t)count, sizeof(OhcKey));
    if (keys) {
        for (jsize i = 0; i < count; ++i) {
            keys[i].time = t[i];
            keys[i].value = v[i];
            keys[i].interp = m ? m[i] : OHC_INTERP_LINEAR;
            if (h && env->GetArrayLength(handles) >= (jsize)count * 4) {
                keys[i].c1x = h[i * 4 + 0];
                keys[i].c1y = h[i * 4 + 1];
                keys[i].c2x = h[i * 4 + 2];
                keys[i].c2y = h[i * 4 + 3];
            }
        }
    }

    env->ReleaseDoubleArrayElements(times, t, JNI_ABORT);
    env->ReleaseDoubleArrayElements(values, v, JNI_ABORT);
    if (m) env->ReleaseIntArrayElements(interps, m, JNI_ABORT);
    if (h) env->ReleaseDoubleArrayElements(handles, h, JNI_ABORT);
    return keys;
}

} /* namespace */

extern "C" {

JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeVersion(JNIEnv *, jclass) {
    return (jint)ohc_version();
}

JNIEXPORT jstring JNICALL
Java_com_editorhub_NativeCore_nativeBlendModeName(JNIEnv *env, jclass, jint mode) {
    return env->NewStringUTF(ohc_blend_mode_name((int32_t)mode));
}

JNIEXPORT jdouble JNICALL
Java_com_editorhub_NativeCore_nativeBezierEase(JNIEnv *, jclass,
                                               jdouble x1, jdouble y1, jdouble x2, jdouble y2,
                                               jdouble t) {
    return (jdouble)ohc_bezier_ease(x1, y1, x2, y2, t);
}

JNIEXPORT jdouble JNICALL
Java_com_editorhub_NativeCore_nativeEvalKeys(JNIEnv *env, jclass,
                                             jdoubleArray times, jdoubleArray values,
                                             jintArray interps, jdoubleArray handles,
                                             jdouble t, jdouble fallback) {
    const jsize count = times ? env->GetArrayLength(times) : 0;
    OhcKey *keys = read_keys(env, times, values, interps, handles, count);
    if (!keys) return fallback;
    double out = fallback;
    const int32_t rc = ohc_eval_keys(keys, (int32_t)count, t, &out);
    free(keys);
    return rc == OHC_OK ? (jdouble)out : fallback;
}

/*
 * Composites `src` (a direct ByteBuffer of RGBA8) onto `dst` at the given offset.
 *
 * Both buffers are addressed by their base pointer plus the caller's stride, so the JS side can
 * hand over one large canvas-backed buffer and composite many small layers into it without ever
 * copying a frame.
 */
JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeComposite(JNIEnv *env, jclass,
                                              jobject dst, jint dstW, jint dstH, jint dstStride,
                                              jobject src, jint srcStride,
                                              jdouble opacity, jint mode) {
    if (!dst || !src) return OHC_ERR_ARGUMENT;
    uint8_t *d = (uint8_t *)env->GetDirectBufferAddress(dst);
    const uint8_t *s = (const uint8_t *)env->GetDirectBufferAddress(src);
    if (!d || !s) return OHC_ERR_ARGUMENT;
    return (jint)ohc_composite(d, (int32_t)dstW, (int32_t)dstH, (int32_t)dstStride,
                               s, (int32_t)srcStride, (double)opacity, (int32_t)mode);
}

JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeTransformBlit(JNIEnv *env, jclass,
                                                  jobject dst, jint dstW, jint dstH, jint dstStride,
                                                  jobject src, jint srcW, jint srcH, jint srcStride,
                                                  jdoubleArray matrix, jboolean bilinear,
                                                  jdouble opacity, jint mode) {
    if (!dst || !src || !matrix) return OHC_ERR_ARGUMENT;
    if (env->GetArrayLength(matrix) < 6) return OHC_ERR_ARGUMENT;
    uint8_t *d = (uint8_t *)env->GetDirectBufferAddress(dst);
    const uint8_t *s = (const uint8_t *)env->GetDirectBufferAddress(src);
    if (!d || !s) return OHC_ERR_ARGUMENT;

    jdouble m[6];
    env->GetDoubleArrayRegion(matrix, 0, 6, m);
    return (jint)ohc_transform_blit(d, (int32_t)dstW, (int32_t)dstH, (int32_t)dstStride,
                                    s, (int32_t)srcW, (int32_t)srcH, (int32_t)srcStride,
                                    m, bilinear ? 1 : 0, (double)opacity, (int32_t)mode);
}

/*
 * Converts RGBA8 to NV12 into the caller's two direct buffers. This is the path a rendered frame
 * takes to reach a hardware H.264 encoder without a per-plane typed-array copy in JavaScript.
 */
JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeRgbaToNv12(JNIEnv *env, jclass,
                                               jobject rgba, jint w, jint h, jint stride,
                                               jobject y, jobject uv) {
    if (!rgba || !y || !uv) return OHC_ERR_ARGUMENT;
    const uint8_t *r = (const uint8_t *)env->GetDirectBufferAddress(rgba);
    uint8_t *yp = (uint8_t *)env->GetDirectBufferAddress(y);
    uint8_t *uvp = (uint8_t *)env->GetDirectBufferAddress(uv);
    if (!r || !yp || !uvp) return OHC_ERR_ARGUMENT;
    return (jint)ohc_rgba_to_nv12(r, (int32_t)w, (int32_t)h, (int32_t)stride, yp, uvp);
}

JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeBoxBlur(JNIEnv *env, jclass,
                                            jobject rgba, jint w, jint h, jint stride, jint radius) {
    if (!rgba) return OHC_ERR_ARGUMENT;
    uint8_t *p = (uint8_t *)env->GetDirectBufferAddress(rgba);
    if (!p) return OHC_ERR_ARGUMENT;
    return (jint)ohc_box_blur(p, (int32_t)w, (int32_t)h, (int32_t)stride, (int32_t)radius);
}

JNIEXPORT jint JNICALL
Java_com_editorhub_NativeCore_nativeApplyLut(JNIEnv *env, jclass,
                                             jobject rgba, jint w, jint h, jint stride, jbyteArray lut) {
    if (!rgba || !lut) return OHC_ERR_ARGUMENT;
    if (env->GetArrayLength(lut) < 768) return OHC_ERR_ARGUMENT;
    uint8_t *p = (uint8_t *)env->GetDirectBufferAddress(rgba);
    if (!p) return OHC_ERR_ARGUMENT;
    jbyte table[768];
    env->GetByteArrayRegion(lut, 0, 768, table);
    return (jint)ohc_apply_lut(p, (int32_t)w, (int32_t)h, (int32_t)stride, (const uint8_t *)table);
}

} /* extern "C" */
