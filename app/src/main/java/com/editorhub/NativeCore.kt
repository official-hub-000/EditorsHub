package com.editorhub

import android.util.Log
import java.nio.ByteBuffer

/**
 * JNI front door to the C++ core in `app/src/main/cpp`.
 *
 * Every method here is a plain C call on the other side of the boundary: no allocation, no
 * exceptions, no object graphs. The library is optional by construction — [loaded] is false on a
 * build made without the NDK, and callers are expected to fall back to the JavaScript path
 * instead of assuming the native one exists.
 *
 * The bridge deliberately exposes primitives rather than editor concepts. Blending, keyframes,
 * transforms, colour conversion and blur are things a compositor needs that do not change when
 * the UI around them changes, which is exactly why they were the first to leave JavaScript.
 */
object NativeCore {

    private const val TAG = "EditorsHubCore"

    /** True when libeditorhubcore loaded and its version matches what this build expects. */
    val loaded: Boolean

    /** Version reported by the loaded library, or 0 when it did not load. */
    val version: Int

    /** True when every symbol the Kotlin side binds to resolved. */
    val complete: Boolean

    init {
        var v = 0
        var ok = false
        v = try {
            System.loadLibrary("editorhubcore")
            nativeVersion()
        } catch (t: Throwable) {
            Log.i(TAG, "native core unavailable: ${t.javaClass.simpleName}: ${t.message}")
            0
        }
        version = v
        loaded = v > 0
        // Prove the binding end to end: a symbol that silently failed to resolve would otherwise
        // surface much later, on the frame path, as an UnsatisfiedLinkError.
        complete = loaded && try {
            nativeBlendModeName(0) == "normal" &&
                nativeBezierEase(0.42, 0.0, 0.58, 1.0, 0.5) > 0.4 &&
                nativeEvalKeys(
                    doubleArrayOf(0.0, 1.0), doubleArrayOf(0.0, 10.0),
                    intArrayOf(1, 1), null, 0.5, -1.0
                ) > 4.9
        } catch (t: Throwable) {
            Log.w(TAG, "native core loaded but a symbol failed: ${t.message}")
            false
        }
        Log.i(
            TAG,
            "native core version=$version loaded=$loaded complete=$complete (expect $EXPECTED_VERSION)"
        )
    }

    /**
     * One-line report for the JS shell, the startup log and the CI assertions.
     * Shape matches what `native-shell.js` prints so both sides read the same way.
     */
    fun describe(): String {
        val state = when {
            !loaded -> "unavailable"
            !complete -> "loaded-but-incomplete"
            else -> "ready"
        }
        return """{"state":"$state","version":$version,"expected":$EXPECTED_VERSION,""" +
            """"blendModes":${ohc.BLEND_MODE_COUNT},"jit":${if (loaded) "true" else "false"}}"""
    }

    /** Blend-mode identifiers, mirrored from `ohc_core.h`. */
    object ohc {
        const val BLEND_MODE_COUNT = 13
    }

    // ---------------------------------------------------------------- primitives

    /** Eased progress for a CSS-style cubic-bezier curve. */
    fun bezierEase(x1: Double, y1: Double, x2: Double, y2: Double, t: Double): Double {
        if (!loaded) return t.coerceIn(0.0, 1.0)
        return nativeBezierEase(x1, y1, x2, y2, t)
    }

    /**
     * Evaluates a keyframe track. `interps` holds OHC_INTERP_* per key; `handles` holds four
     * values per key (c1x, c1y, c2x, c2y) or may be null for linear/hold tracks.
     */
    fun evalKeys(
        times: DoubleArray,
        values: DoubleArray,
        interps: IntArray?,
        handles: DoubleArray?,
        time: Double,
        fallback: Double,
    ): Double {
        if (!loaded) return fallback
        return nativeEvalKeys(times, values, interps, handles, time, fallback)
    }

    /** Composites RGBA8 `src` onto RGBA8 `dst`. Both must be direct buffers. */
    fun composite(
        dst: ByteBuffer, dstWidth: Int, dstHeight: Int, dstStride: Int,
        src: ByteBuffer, srcStride: Int,
        opacity: Double, mode: Int,
    ): Int {
        if (!loaded) return -3
        return nativeComposite(dst, dstWidth, dstHeight, dstStride, src, srcStride, opacity, mode)
    }

    /** Draws a transformed layer into `dst` without clearing it. */
    fun transformBlit(
        dst: ByteBuffer, dstWidth: Int, dstHeight: Int, dstStride: Int,
        src: ByteBuffer, srcWidth: Int, srcHeight: Int, srcStride: Int,
        matrix: DoubleArray, bilinear: Boolean, opacity: Double, mode: Int,
    ): Int {
        if (!loaded) return -3
        return nativeTransformBlit(
            dst, dstWidth, dstHeight, dstStride,
            src, srcWidth, srcHeight, srcStride,
            matrix, bilinear, opacity, mode
        )
    }

    /** Converts RGBA8 to NV12 for a hardware encoder. Direct buffers, zero copy. */
    fun rgbaToNv12(
        rgba: ByteBuffer, width: Int, height: Int, stride: Int,
        y: ByteBuffer, uv: ByteBuffer,
    ): Int {
        if (!loaded) return -3
        return nativeRgbaToNv12(rgba, width, height, stride, y, uv)
    }

    fun boxBlur(rgba: ByteBuffer, width: Int, height: Int, stride: Int, radius: Int): Int {
        if (!loaded) return -3
        return nativeBoxBlur(rgba, width, height, stride, radius)
    }

    // ------------------------------------------------------------------- natives

    @JvmStatic private external fun nativeVersion(): Int
    @JvmStatic private external fun nativeBlendModeName(mode: Int): String
    @JvmStatic private external fun nativeBezierEase(
        x1: Double, y1: Double, x2: Double, y2: Double, t: Double
    ): Double
    @JvmStatic private external fun nativeEvalKeys(
        times: DoubleArray, values: DoubleArray, interps: IntArray?, handles: DoubleArray?,
        t: Double, fallback: Double
    ): Double
    @JvmStatic private external fun nativeComposite(
        dst: ByteBuffer, dstW: Int, dstH: Int, dstStride: Int,
        src: ByteBuffer, srcStride: Int, opacity: Double, mode: Int
    ): Int
    @JvmStatic private external fun nativeTransformBlit(
        dst: ByteBuffer, dstW: Int, dstH: Int, dstStride: Int,
        src: ByteBuffer, srcW: Int, srcH: Int, srcStride: Int,
        matrix: DoubleArray, bilinear: Boolean, opacity: Double, mode: Int
    ): Int
    @JvmStatic private external fun nativeRgbaToNv12(
        rgba: ByteBuffer, w: Int, h: Int, stride: Int, y: ByteBuffer, uv: ByteBuffer
    ): Int
    @JvmStatic private external fun nativeBoxBlur(
        rgba: ByteBuffer, w: Int, h: Int, stride: Int, radius: Int
    ): Int

    private const val EXPECTED_VERSION = 10000
}
