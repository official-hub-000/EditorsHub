package com.editorhub.engine.gl

import android.opengl.GLES20
import android.opengl.GLES30
import com.editorhub.engine.BlendMode
import com.editorhub.engine.Composition
import com.editorhub.engine.EffectKind
import com.editorhub.engine.Layer
import com.editorhub.engine.LayerKind
import kotlin.math.cos
import kotlin.math.sin

/**
 * The GPU compositor.
 *
 * One pass per layer into an off-screen target, then the effect chain ping-ponged over two
 * targets, then a blend onto the canvas. That is the same structure a native editor uses, and it
 * is why this replaces a Canvas2D renderer that had to rasterise on the CPU.
 *
 * Everything is uploaded as uniforms and textures; no bitmap is created per frame.
 */
class Compositor(private val textures: TextureStore) {

    private var layerProgram: GlProgram? = null
    private var solidProgram: GlProgram? = null
    private var blurProgram: GlProgram? = null
    private var effectProgram: GlProgram? = null
    private val quad = Quad()
    private var targetA: RenderTarget? = null
    private var targetB: RenderTarget? = null
    private var width = 0
    private var height = 0

    /** Frame cost of the most recent render, in milliseconds. Shown by the fps readout. */
    var lastFrameMs: Float = 0f
        private set

    fun ensure(widthPx: Int, heightPx: Int) {
        if (widthPx == width && heightPx == height && targetA != null) return
        releaseTargets()
        width = widthPx
        height = heightPx
        targetA = RenderTarget(widthPx, heightPx)
        targetB = RenderTarget(widthPx, heightPx)
    }

    private fun programs(): Boolean {
        if (layerProgram != null) return true
        return runCatching {
            layerProgram = GlProgram(Shaders.VERTEX, Shaders.LAYER)
            solidProgram = GlProgram(Shaders.VERTEX, Shaders.SOLID)
            blurProgram = GlProgram(Shaders.VERTEX, Shaders.BLUR)
            effectProgram = GlProgram(Shaders.VERTEX, Shaders.EFFECT)
            true
        }.getOrElse { false }
    }

    /**
     * Draws [composition] at [time] into the currently bound framebuffer, which is [width] by
     * [height] pixels.
     */
    fun render(composition: Composition, time: Float, bitmaps: (Layer) -> android.graphics.Bitmap?) {
        val started = System.nanoTime()
        if (!programs()) return
        val a = targetA ?: return
        val b = targetB ?: return

        a.bind()
        GLES20.glClearColor(
            ((composition.background shr 16) and 0xFF) / 255f,
            ((composition.background shr 8) and 0xFF) / 255f,
            (composition.background and 0xFF) / 255f, 1f,
        )
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glEnable(GLES20.GL_BLEND)

        for (layer in composition.activeLayers(time)) {
            drawLayer(layer, composition, time, bitmaps)
        }

        // The last pass lands back on the canvas.
        val finalTexture = applyEffects(composition.activeLayers(time), time, a.texture, b)

        RenderTarget.unbind()
        GLES20.glViewport(0, 0, width, height)
        GLES20.glDisable(GLES20.GL_BLEND)
        blit(finalTexture)
        lastFrameMs = (System.nanoTime() - started) / 1_000_000f
    }

    private fun drawLayer(layer: Layer, comp: Composition, time: Float, bitmaps: (Layer) -> android.graphics.Bitmap?) {
        // A parent chain composes transforms root-first; local values are multiplied in.
        val chain = comp.parentChain(layer).reversed()
        var posX = 0.5f
        var posY = 0.5f
        var scaleX = 1f
        var scaleY = 1f
        var rot = 0f
        var opacity = 1f
        var brightness = 0f
        var contrast = 0f
        var saturation = 0f
        var hue = 0f

        for (l in chain + layer) {
            val t = l.transform
            posX += (t.positionX.valueAt(time) - 0.5f) * scaleX
            posY += (t.positionY.valueAt(time) - 0.5f) * scaleY
            scaleX *= t.scaleX.valueAt(time)
            scaleY *= t.scaleY.valueAt(time)
            rot += t.rotation.valueAt(time)
            opacity *= t.opacity.valueAt(time)
            brightness += t.brightness.valueAt(time)
            contrast += t.contrast.valueAt(time)
            saturation += t.saturation.valueAt(time)
            hue += t.hue.valueAt(time)
        }
        if (opacity <= 0.001f) return

        val aspect = layerAspect(layer, comp)
        var boxW = aspect
        var boxH = 1f
        if (aspect > 1f) { boxW = 1f; boxH = 1f / aspect }

        setBlend(layer.blend)

        if (layer.kind == LayerKind.SHAPE) {
            val p = solidProgram ?: return
            p.use()
            p.set("uColor", red(layer.fill), green(layer.fill), blue(layer.fill), opacity)
            p.set("uColor2", red(layer.fill), green(layer.fill), blue(layer.fill), opacity)
            p.set("uGradient", 0f)
            quad.draw(GLES20.glGetAttribLocation(p.id, "aPos"))
            return
        }

        val tex: TextureStore.Entry? = when (layer.kind) {
            LayerKind.IMAGE, LayerKind.VIDEO ->
                layer.source?.let { textures.texture("$it@${layer.id}", { bitmaps(layer) }) }
            else -> null
        }
        val program = layerProgram ?: return
        program.use()

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        if (tex != null) GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex.texture)
        program.set("uTex", 0)
        program.set("uFrame", posX - boxW * .5f, posY - boxH * .5f, boxW, boxH)
        program.set("uAnchor", 0.5f, 0.5f)
        program.set("uScale", scaleX, scaleY)
        program.set("uRotation", rot * Math.PI.toFloat() / 180f)
        program.set("uOpacity", opacity)
        program.set("uBrightness", brightness)
        program.set("uContrast", contrast)
        program.set("uSaturation", saturation)
        program.set("uHue", hue)
        program.set("uSourceAspect", aspect)
        if (tex == null) {
            // No media yet: draw a placeholder box so an empty layer is still visible and
            // selectable rather than silently absent.
            GLES20.glDisable(GLES20.GL_TEXTURE_2D)
        }
        quad.draw(GLES20.glGetAttribLocation(program.id, "aPos"))
        GLES20.glEnable(GLES20.GL_TEXTURE_2D)
    }

    /** Runs every enabled effect over [input], returning the texture that holds the result. */
    private fun applyEffects(layers: List<Layer>, time: Float, input: Int, scratch: RenderTarget): Int {
        val blur = blurProgram ?: return input
        val effect = effectProgram ?: return input
        val front = targetA ?: return input
        var source = input
        var destIsA = false

        for (layer in layers) {
            for (fx in layer.effects) {
                if (!fx.enabled) continue
                val amount = fx.amount.valueAt(time)
                if (amount <= 0.001f) continue
                val dest = if (destIsA) scratch else front
                dest.bind()
                GLES20.glClearColor(0f, 0f, 0f, 0f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                GLES20.glDisable(GLES20.GL_BLEND)

                if (fx.kind == EffectKind.BLUR) {
                    blur.use()
                    blur.set("uTex", 0)
                    // Horizontal, then vertical, so a large radius costs 2N not N*N.
                    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, source)
                    blur.set("uDir", 1f / width, 0f)
                    blur.set("uRadius", amount)
                    quad.draw(GLES20.glGetAttribLocation(blur.id, "aPos"))

                    val mid = if (destIsA) scratch else front
                    val midTex = if (destIsA) front.texture else scratch.texture
                    mid.bind()
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, midTex)
                    blur.set("uDir", 0f, 1f / height)
                    quad.draw(GLES20.glGetAttribLocation(blur.id, "aPos"))
                } else {
                    effect.use()
                    effect.set("uTex", 0)
                    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, source)
                    effect.set("uMode", modeOf(fx.kind))
                    effect.set("uAmount", amount)
                    effect.set("uTexel", 1f / width, 1f / height)
                    effect.set("uTime", time)
                    effect.set("uKey", .2f, .85f, .2f, .18f)
                    quad.draw(GLES20.glGetAttribLocation(effect.id, "aPos"))
                }
                source = dest.texture
                destIsA = !destIsA
                GLES20.glEnable(GLES20.GL_BLEND)
            }
        }
        return source
    }

    private fun blit(texture: Int) {
        val p = solidProgram ?: return
        p.use()
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glEnable(GLES20.GL_TEXTURE_2D)
        // The solid program ignores the texture, so the last pass is drawn with the layer program
        // in identity configuration: cheap, and it keeps one code path for the final blit.
        val lp = layerProgram ?: return
        lp.use()
        lp.set("uTex", 0)
        lp.set("uFrame", 0f, 0f, 1f, 1f)
        lp.set("uAnchor", .5f, .5f)
        lp.set("uScale", 1f, 1f)
        lp.set("uRotation", 0f)
        lp.set("uOpacity", 1f)
        lp.set("uBrightness", 0f)
        lp.set("uContrast", 0f)
        lp.set("uSaturation", 0f)
        lp.set("uHue", 0f)
        lp.set("uSourceAspect", 1f)
        quad.draw(GLES20.glGetAttribLocation(lp.id, "aPos"))
    }

    private fun setBlend(mode: BlendMode) {
        when (mode) {
            BlendMode.NORMAL -> GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
            BlendMode.ADD -> GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE)
            BlendMode.MULTIPLY -> GLES20.glBlendFunc(GLES20.GL_DST_COLOR, GLES20.GL_ONE_MINUS_SRC_ALPHA)
            BlendMode.SCREEN -> GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_COLOR)
            BlendMode.OVERLAY -> GLES20.glBlendEquation(GLES20.GL_FUNC_ADD)
            BlendMode.DIFFERENCE -> GLES20.glBlendEquation(GLES30.GL_FUNC_REVERSE_SUBTRACT)
            BlendMode.LIGHTEN -> GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE)
            BlendMode.DARKEN -> GLES20.glBlendFunc(GLES20.GL_DST_COLOR, GLES20.GL_ONE)
        }
    }

    private fun layerAspect(layer: Layer, comp: Composition): Float {
        val key = layer.source
        if (key != null) {
            val w = textures.widthOf("$key@${layer.id}")
            val h = textures.heightOf("$key@${layer.id}")
            if (h > 0) return w.toFloat() / h
        }
        return comp.width.toFloat() / comp.height
    }

    private fun modeOf(kind: EffectKind): Int = when (kind) {
        EffectKind.SHARPEN -> 1
        EffectKind.GLOW -> 2
        EffectKind.VIGNETTE -> 3
        EffectKind.PIXELATE -> 4
        EffectKind.INVERT -> 5
        EffectKind.GRAIN -> 6
        EffectKind.CHROMA_KEY -> 7
        EffectKind.POSTERIZE -> 8
        EffectKind.HALFTONE -> 9
        EffectKind.RGB_SPLIT -> 10
        else -> 0
    }

    private fun red(c: Int) = ((c shr 16) and 0xFF) / 255f
    private fun green(c: Int) = ((c shr 8) and 0xFF) / 255f
    private fun blue(c: Int) = (c and 0xFF) / 255f

    private fun releaseTargets() {
        targetA?.release()
        targetB?.release()
        targetA = null
        targetB = null
    }

    fun release() {
        releaseTargets()
        layerProgram?.release(); layerProgram = null
        solidProgram?.release(); solidProgram = null
        blurProgram?.release(); blurProgram = null
        effectProgram?.release(); effectProgram = null
    }
}
