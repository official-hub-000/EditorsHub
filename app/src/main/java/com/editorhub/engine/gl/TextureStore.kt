package com.editorhub.engine.gl

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLUtils
import android.util.LruCache

/**
 * Uploaded media textures, keyed by source path.
 *
 * A frame must not decode media. The first time a still is drawn its bitmap is uploaded once and
 * the texture is kept; a decode only happens again after eviction. The cache is bounded by pixel
 * count rather than entry count, because one 4K still costs sixty-four times a thumbnail.
 */
class TextureStore(maxPixels: Int = 64 * 1024 * 1024) {

    /** An uploaded texture and its pixel size. Public because [texture] returns it. */
    class Entry(val texture: Int, val width: Int, val height: Int)

    private val cache = object : LruCache<String, Entry>(maxPixels) {
        override fun sizeOf(key: String, value: Entry): Int = value.width * value.height

        override fun entryRemoved(
            evicted: Boolean, key: String, oldValue: Entry, newValue: Entry?,
        ) {
            GLES20.glDeleteTextures(1, intArrayOf(oldValue.texture), 0)
        }
    }

    /** Uploads [bitmap] for [key] unless it is already resident, and returns the texture id. */
    fun texture(key: String, bitmap: () -> Bitmap?): Entry? {
        cache.get(key)?.let { return it }
        val bmp = bitmap() ?: return null
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, ids[0])
        // Clamping matters: a layer scaled beyond its box must not tile its edge pixels.
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
        val entry = Entry(ids[0], bmp.width, bmp.height)
        cache.put(key, entry)
        return entry
    }

    fun widthOf(key: String): Int = cache.get(key)?.width ?: 1
    fun heightOf(key: String): Int = cache.get(key)?.height ?: 1

    fun clear() = cache.evictAll()
}
