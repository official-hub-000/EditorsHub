package com.editorhub.engine.gl

import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * An off-screen framebuffer with a colour texture.
 *
 * The compositor needs these because an effect cannot read and write the same texture in one
 * pass. Two targets are allocated and ping-ponged: draw layers into A, run the effect chain
 * A->B->A, then blend A onto the canvas.
 */
class RenderTarget(val width: Int, val height: Int) {
    val texture: Int
    val framebuffer: Int

    init {
        val tex = IntArray(1)
        GLES20.glGenTextures(1, tex, 0)
        texture = tex[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, width, height, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null,
        )
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        val fbo = IntArray(1)
        GLES20.glGenFramebuffers(1, fbo, 0)
        framebuffer = fbo[0]
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer)
        GLES20.glFramebufferTexture2D(
            GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, texture, 0,
        )
        val status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER)
        if (status != GLES20.GL_FRAMEBUFFER_COMPLETE) {
            throw IllegalStateException("Framebuffer incomplete: 0x${Integer.toHexString(status)}")
        }
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }

    fun bind() {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer)
        GLES20.glViewport(0, 0, width, height)
    }

    /** Reads the target back as RGBA bytes. Used by the exporter, never by the preview. */
    fun readPixels(): ByteBuffer {
        val buffer = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer)
        GLES20.glReadPixels(0, 0, width, height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buffer)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        buffer.rewind()
        return buffer
    }

    fun release() {
        GLES20.glDeleteFramebuffers(1, intArrayOf(framebuffer), 0)
        GLES20.glDeleteTextures(1, intArrayOf(texture), 0)
    }

    companion object {
        fun unbind() = GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }
}
