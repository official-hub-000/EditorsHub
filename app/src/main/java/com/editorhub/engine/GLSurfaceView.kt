package com.editorhub.engine

import android.content.Context
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.util.AttributeSet
import com.editorhub.engine.gl.Compositor
import com.editorhub.engine.gl.TextureStore
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * The canvas.
 *
 * A GLSurfaceView rather than a SurfaceView plus a canvas: every frame is composited on the GPU,
 * and the UI thread never touches a pixel. Time comes from a clock rather than from the draw
 * callback, so playback speed is honest even when a frame is late.
 */
class PreviewGLView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : GLSurfaceView(context, attrs) {

    /** Supplies the composition and the time to draw. Set from the UI. */
    @Volatile var provider: (() -> Pair<Composition, Float>)? = null

    /** Resolves a layer's bitmap, or null while media is still loading. */
    @Volatile var bitmaps: ((Layer) -> android.graphics.Bitmap?)? = null

    /** Called after each frame with the frame cost in milliseconds. */
    @Volatile var onFrameMs: ((Float) -> Unit)? = null

    private val renderer = Renderer()

    init {
        setEGLContextClientVersion(2)
        preserveEGLContextOnPause = true
        setRenderer(renderer)
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    /** Requests a redraw. Called from the UI whenever anything visible changes. */
    fun invalidatePreview() = requestRender()

    private inner class Renderer : GLSurfaceView.Renderer {
        private val textures = TextureStore()
        private val compositor = Compositor(textures)

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            GLES20.glDisable(GLES20.GL_DEPTH_TEST)
            GLES20.glDisable(GLES20.GL_CULL_FACE)
            GLES20.glEnable(GLES20.GL_BLEND)
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            GLES20.glViewport(0, 0, width, height)
            compositor.ensure(width, height)
            // RENDERMODE_WHEN_DIRTY: without this the first frame is never requested and the
            // canvas stays empty until something else triggers a redraw.
            requestRender()
        }

        override fun onDrawFrame(gl: GL10?) {
            val pair = provider?.invoke() ?: return
            val (composition, time) = pair
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            compositor.render(composition, time) { layer -> bitmaps?.invoke(layer) }
            onFrameMs?.invoke(compositor.lastFrameMs)
        }
    }
}
