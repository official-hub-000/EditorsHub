package com.editorhub.engine.gl

import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * A compiled program plus a uniform-location cache.
 *
 * [GLES20.glGetUniformLocation] is a string lookup into the driver; doing it per draw call is a
 * measurable cost when a project has forty layers and six effects each. Locations are resolved
 * once, here, and reused.
 */
class GlProgram(vertexSrc: String, fragmentSrc: String) {
    val id: Int
    private val uniforms = HashMap<String, Int>()

    init {
        val vs = compile(GLES20.GL_VERTEX_SHADER, vertexSrc)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)
        id = GLES20.glCreateProgram()
        GLES20.glAttachShader(id, vs)
        GLES20.glAttachShader(id, fs)
        GLES20.glLinkProgram(id)
        val status = IntArray(1)
        GLES20.glGetProgramiv(id, GLES20.GL_LINK_STATUS, status, 0)
        if (status[0] != GLES20.GL_TRUE) {
            val log = GLES20.glGetProgramInfoLog(id)
            GLES20.glDeleteProgram(id)
            throw IllegalStateException("Program link failed: $log")
        }
        GLES20.glDeleteShader(vs)
        GLES20.glDeleteShader(fs)
    }

    fun use() = GLES20.glUseProgram(id)

    fun loc(name: String): Int = uniforms.getOrPut(name) { GLES20.glGetUniformLocation(id, name) }

    fun set(name: String, v: Float) = GLES20.glUniform1f(loc(name), v)
    fun set(name: String, v: Int) = GLES20.glUniform1i(loc(name), v)
    fun set(name: String, x: Float, y: Float) = GLES20.glUniform2f(loc(name), x, y)
    fun set(name: String, x: Float, y: Float, z: Float, w: Float) =
        GLES20.glUniform4f(loc(name), x, y, z, w)

    private fun compile(type: Int, src: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, src)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        if (status[0] != GLES20.GL_TRUE) {
            val log = GLES20.glGetShaderInfoLog(shader)
            GLES20.glDeleteShader(shader)
            throw IllegalStateException("Shader compile failed: $log")
        }
        return shader
    }

    fun release() = GLES20.glDeleteProgram(id)
}

/**
 * The full-screen quad every pass draws.
 *
 * One buffer, created once and reused for every pass: the geometry never changes, only the
 * uniforms and the bound textures do.
 */
class Quad {
    private val coords: FloatBuffer = ByteBuffer
        .allocateDirect(8 * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .apply {
            put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
            position(0)
        }

    fun draw(aPosLoc: Int) {
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, 0)
        GLES20.glEnableVertexAttribArray(aPosLoc)
        GLES20.glVertexAttribPointer(aPosLoc, 2, GLES20.GL_FLOAT, false, 0, coords)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(aPosLoc)
    }
}
