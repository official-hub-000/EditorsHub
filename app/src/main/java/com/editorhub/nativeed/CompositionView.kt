package com.editorhub.nativeed

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Looper
import android.view.Choreographer
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.max
import kotlin.math.min

/**
 * The preview surface.
 *
 * WHY A SurfaceView AND NOT AN IMAGE-BASED VIEW
 *
 * A `View` that redraws into the window's own buffer forces the whole window (toolbars,
 * timeline, every popup) to be re-composited whenever one layer moves. A `SurfaceView` gets
 * its own hardware layer and its own buffer, so a frame here only updates the surface: no
 * layout pass, no re-composite of the UI. That is the difference between a timeline that
 * stutters while a layer is dragged and one that does not.
 *
 * DRAWS ARE RECORDED, NOT RE-READ
 *
 * Every per-frame value is read from [EditorStore] once and cached in a small struct. The
 * draw loop never allocates: the Paint, the Matrix, the Path and the RectF are all owned by
 * this class and reset between frames. Allocating in a 60 Hz loop is the single most common
 * cause of jank in Android graphics code, because it hands the collector work at exactly the
 * wrong moment.
 */
class CompositionView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {

    /** The store is attached by the activity; nothing draws until it is. */
    var store: EditorStore? = null
        set(value) { field = value; requestRender() }

    /** Bitmaps for image layers, keyed by layer id, supplied by [MediaCache]. */
    var bitmaps: Map<String, Bitmap> = emptyMap()
        set(value) { field = value; requestRender() }

    /**
     * Supplies the current frame of a video layer.
     *
     * A callback rather than a map because a video's picture changes as the playhead moves:
     * the frame cache is asked at draw time for the one that matches this instant, and it
     * answers with the latest decoded frame while a new one is being pulled in the background.
     */
    var videoFrame: ((Layer, Double) -> Bitmap?)? = null

    /** Letterbox transform from composition space into this view, recomputed on resize. */
    private val contentMatrix = Matrix()
    private val drawMatrix = Matrix()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        isSubpixelText = true
        isLinearText = true
    }
    private val path = Path()
    private val rect = RectF()

    private var scale = 1f
    private var offsetX = 0f
    private var offsetY = 0f

    /** Frames drawn since the last report, and how many display frames were missed. */
    private var frames = 0
    private var dropped = 0
    private var windowStart = 0L

    /**
     * Called once a second with the measured frame rate and the number of skipped frames.
     *
     * Measured against the display's own vsync timestamps rather than wall-clock time, because
     * that is the only number that matches what the eye sees. A frame that took two vsync
     * intervals shows up as one dropped frame, which is exactly the stutter being reported.
     */
    var onFrames: ((Int, Int) -> Unit)? = null
    private var lastVsync = 0L

    @Volatile private var drawingEnabled = true

    init {
        holder.addCallback(this)
        holder.setFormat(android.graphics.PixelFormat.OPAQUE)
    }

    // -------------------------------------------------------------- lifecycle

    override fun surfaceCreated(holder0: SurfaceHolder) { drawingEnabled = true; requestRender() }
    override fun surfaceChanged(holder0: SurfaceHolder, format: Int, width: Int, height: Int) {
        recomputeLetterbox(width, height)
        requestRender()
    }
    override fun surfaceDestroyed(holder0: SurfaceHolder) { drawingEnabled = false }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        recomputeLetterbox(w, h)
    }

    /**
     * Fit the composition inside the view.
     *
     * Composition pixels are the coordinate space of every layer and every gesture, so a
     * single matrix maps them onto the surface. Gestures multiply by the inverse of this,
     * which is why dragging a layer lands under the finger at any zoom.
     */
    private fun recomputeLetterbox(w: Int, h: Int) {
        val project = store?.project ?: return
        if (w <= 0 || h <= 0 || project.width <= 0 || project.height <= 0) return
        scale = min(w.toFloat() / project.width, h.toFloat() / project.height)
        offsetX = (w - project.width * scale) * .5f
        offsetY = (h - project.height * scale) * .5f
        contentMatrix.setScale(scale, scale)
        contentMatrix.postTranslate(offsetX, offsetY)
    }

    /**
     * Composition pixels per view pixel.
     *
     * Exposed because gestures must convert a finger's movement into composition units using
     * the same letterbox fit this class draws with. Dividing by the view's width alone is
     * wrong whenever the composition is letterboxed vertically, and that error shows up as a
     * layer that crawls slower than the finger.
     */
    val compositionScale: Float get() = scale

    /** View x -> composition x. */
    fun toCompositionX(viewX: Float): Float = if (scale > 0f) (viewX - offsetX) / scale else 0f

    /** View y -> composition y. */
    fun toCompositionY(viewY: Float): Float = if (scale > 0f) (viewY - offsetY) / scale else 0f

    private fun accountFrame(frameTimeNanos: Long) {
        val callback = onFrames ?: return
        if (windowStart == 0L) { windowStart = frameTimeNanos; lastVsync = frameTimeNanos; return }
        // Assume a 60 Hz display; anything slower than 1.5 intervals is a dropped frame.
        val interval = 1_000_000_000L / 60
        val gap = frameTimeNanos - lastVsync
        if (gap > interval * 3 / 2) dropped += ((gap / interval) - 1).toInt().coerceAtLeast(1)
        lastVsync = frameTimeNanos
        frames++
        val elapsed = frameTimeNanos - windowStart
        if (elapsed >= 1_000_000_000L) {
            val fps = (frames * 1_000_000_000L / elapsed).toInt()
            callback(fps, dropped)
            frames = 0
            dropped = 0
            windowStart = frameTimeNanos
        }
    }

    // ----------------------------------------------------------------- drawing

    /**
     * Draws the current time immediately.
     *
     * Frames are requested through the activity's choreographer so a burst of edits collapses
     * into one draw; this is the method that burst eventually calls.
     */
    fun drawNow() {
        if (!drawingEnabled) return
        val store = store ?: return
        val project = store.project
        val holder0 = holder
        if (!holder0.surface.isValid) return
        var canvas: Canvas? = null
        try {
            canvas = holder0.lockCanvas() ?: return
            drawComposition(canvas, store, project)
            frames++
        } catch (_: Throwable) {
            // A surface can be withdrawn mid-frame when the activity is backgrounded. That is
            // not an error worth crashing for; the next frame draws normally.
        } finally {
            if (canvas != null) runCatching { holder0.unlockCanvasAndPost(canvas) }
        }
    }

    /**
     * Core paint.
     *
     * Takes the document, the time and the selection explicitly, which is what lets the
     * exporter render a frozen snapshot while the user keeps editing: the snapshot supplies
     * the values, so no frame can be drawn from a half-applied edit.
     */
    fun drawComposition(
        canvas: Canvas,
        project: Project,
        time: Double,
        selectionId: String?,
        forExport: Boolean = false
    ) {
        canvas.drawColor(project.background)
        canvas.save()
        if (!forExport) {
            canvas.concat(contentMatrix)
        }
        // NOTE for export: the caller is responsible for the canvas transform. The MP4
        // encoder pre-scales its canvas to composition units, and the still renderer allocates
        // a bitmap of exactly the composition size, so scaling here as well would apply it
        // twice -- which is exactly the class of bug that made the old preview glitch.
        for (layer in project.layers) {
            if (!layer.visible || !layer.covers(time)) continue
            if (layer.kind == LayerKind.ADJUSTMENT) {
                drawAdjustment(canvas, layer, time, project, selectionId)
            } else {
                drawLayer(canvas, layer, time)
            }
        }
        if (!forExport) drawSelection(canvas, project, selectionId, time)
        canvas.restore()
    }

    /**
     * One layer, with its grade and blend mode applied.
     *
     * A grade is a colour matrix; drawing a layer through it needs the layer rendered into
     * its own buffer first, which is what `saveLayer` does. That costs one offscreen buffer
     * per graded layer per frame, so it is skipped entirely when the grade is neutral -- an
     * ungraded project pays nothing for the feature existing.
     */
    /**
     * An adjustment layer re-grades what is already on the canvas.
     *
     * Drawing cannot read the pixels it has already drawn, so the only way to apply a grade to
     * everything beneath is to draw it again into a fresh layer with the grade applied. That is
     * what this does: the layers below are re-rendered through the adjustment's colour matrix.
     * The cost is real, so an adjustment layer is a deliberate choice rather than something
     * that happens by default -- and it is skipped entirely when the grade is neutral.
     */
    private fun drawAdjustment(canvas: Canvas, layer: Layer, time: Double, project: Project, selectionId: String?) {
        val matrix = colourMatrix(layer) ?: return
        val paint = android.graphics.Paint().apply {
            isAntiAlias = true
            colorFilter = android.graphics.ColorMatrixColorFilter(matrix)
            alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        }
        rect.set(0f, 0f, project.width.toFloat(), project.height.toFloat())
        val saved = canvas.saveLayer(rect, paint)
        // Redraw everything below this layer, without selection chrome.
        project.layers.takeWhile { it.id != layer.id }.forEach { below ->
            if (below.visible && below.covers(time) && below.kind != LayerKind.ADJUSTMENT) {
                drawLayer(canvas, below, time)
            }
        }
        canvas.restoreToCount(saved)
    }

    private fun drawLayer(canvas: Canvas, layer: Layer, time: Double) {
        val needsPaint = layer.graded || layer.blendMode != BlendMode.NORMAL || layer.effects.isNotEmpty()
        if (!needsPaint) {
            drawLayerContent(canvas, layer, time)
            return
        }
        paint.reset()
        paint.isAntiAlias = true
        if (layer.graded) {
            val matrix = colourMatrix(layer)
            if (matrix != null) paint.colorFilter = android.graphics.ColorMatrixColorFilter(matrix)
        }
        layer.blendMode.androidMode?.let { mode ->
            paint.xfermode = android.graphics.PorterDuffXfermode(mode)
        }
        // Bounds of the layer in composition space, used as the saved layer's extent. Using
        // the whole composition would allocate a full-canvas buffer for a 40 px dot.
        val blur = safe(layer.blur).coerceIn(0f, MAX_DIMENSION)
        // Effects that need their own buffer (blur, glow) widen the saved layer's bounds.
        val effectPad = (layer.effects[Effect.BLUR] ?: 0f) * 24f + (layer.effects[Effect.GLOW] ?: 0f) * 30f
        val halfW = safe(kotlin.math.max(layer.width, layer.textSize * layer.text.length * .6f)) / 2f + blur + effectPad
        val halfH = safe(kotlin.math.max(layer.height, layer.textSize * 1.4f)) / 2f + blur + effectPad
        val cx = safe(layer.x.valueAt(time))
        val cy = safe(layer.y.valueAt(time))
        rect.set(cx - halfW, cy - halfH, cx + halfW, cy + halfH)
        val saved = canvas.saveLayer(rect, paint)
        drawLayerContent(canvas, layer, time)
        // Overlays that sit on top of the layer's own pixels.
        if (layer.effects.containsKey(Effect.INVERT)) {
            canvas.drawRect(rect, android.graphics.Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.DIFFERENCE)
                color = Color.WHITE
                alpha = ((layer.effects[Effect.INVERT] ?: 1f) * 255).toInt().coerceIn(0, 255)
            })
        }
        if (layer.effects.containsKey(Effect.GLOW)) {
            // A soft additive halo: the shape drawn again, blown out, in ADD mode.
            val strength = layer.effects[Effect.GLOW] ?: .5f
            val glowPaint = android.graphics.Paint().apply {
                color = if (layer.kind == LayerKind.SHAPE) layer.color else Color.WHITE
                alpha = (strength.coerceIn(0f, 1f) * 120).toInt()
                maskFilter = android.graphics.BlurMaskFilter(
                    (12f + strength * 28f).coerceAtLeast(1f),
                    android.graphics.BlurMaskFilter.Blur.NORMAL
                )
                xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.ADD)
            }
            canvas.drawRoundRect(rect, 8f, 8f, glowPaint)
        }
        if (layer.effects.containsKey(Effect.VIGNETTE)) drawVignette(canvas, rect, layer.effects[Effect.VIGNETTE] ?: .5f)
        if (layer.effects.containsKey(Effect.GRAIN)) drawGrain(canvas, rect, layer.effects[Effect.GRAIN] ?: .3f)
        canvas.restoreToCount(saved)
    }

    /** A soft dark edge: a radial gradient in the layer's own bounds. */
    private fun drawVignette(canvas: Canvas, bounds: RectF, strength: Float) {
        val paint = android.graphics.Paint().apply {
            shader = android.graphics.RadialGradient(
                bounds.centerX(), bounds.centerY(), kotlin.math.max(bounds.width(), bounds.height()) * .7f,
                intArrayOf(0x00000000, 0x00000000, (0xCC000000).toInt()),
                floatArrayOf(0f, .55f, 1f),
                android.graphics.Shader.TileMode.CLAMP
            )
            alpha = (strength.coerceIn(0f, 1f) * 255).toInt()
        }
        canvas.drawRect(bounds, paint)
    }

    /**
     * Film grain.
     *
     * A tiled noise bitmap at low alpha, generated once and reused. Generating noise per frame
     * would cost more than every other effect combined, and a static grain is what a still
     * frame of film actually looks like.
     */
    private fun drawGrain(canvas: Canvas, bounds: RectF, strength: Float) {
        val tile = grainTile ?: buildGrain().also { grainTile = it }
        val paint = android.graphics.Paint().apply {
            shader = android.graphics.BitmapShader(tile, android.graphics.Shader.TileMode.REPEAT, android.graphics.Shader.TileMode.REPEAT)
            alpha = (strength.coerceIn(0f, 1f) * 90).toInt()
        }
        canvas.drawRect(bounds, paint)
    }

    private var grainTile: Bitmap? = null

    private fun buildGrain(): Bitmap {
        val size = 128
        val pixels = IntArray(size * size)
        val random = java.util.Random(7)
        for (i in pixels.indices) {
            val v = random.nextInt(255)
            pixels[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
        }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
    }

    /**
     * The grade as a 4x5 colour matrix.
     *
     * Applied in the order saturate -> contrast -> brightness -> tint, because that is the
     * order that behaves the way people expect: saturation looks wrong if it runs after a
     * contrast boost, and a tint should land on top of the finished image rather than be
     * stretched by the contrast term.
     */
    private fun colourMatrix(layer: Layer): FloatArray? {
        if (!layer.graded) return null
        val sat = layer.saturation.coerceIn(0f, 3f)
        val contrast = layer.contrast.coerceIn(0f, 3f)
        val brightness = (layer.brightness * 255f).coerceIn(-255f, 255f)
        val t = 1f - sat
        val r = .213f * t
        val g = .715f * t
        val b = .072f * t
        // Saturation.
        val m = floatArrayOf(
            r + sat, g, b, 0f, 0f,
            r, g + sat, b, 0f, 0f,
            r, g, b + sat, 0f, 0f,
            0f, 0f, 0f, 1f, 0f
        )
        // Contrast about mid-grey, then brightness as an offset.
        val c = contrast
        val off = 128f * (1f - c) + brightness
        for (i in 0 until 3) {
            m[i * 5 + 0] *= c
            m[i * 5 + 1] *= c
            m[i * 5 + 2] *= c
            m[i * 5 + 4] = m[i * 5 + 4] * c + off
        }
        // Tint: pull each channel towards the tint's channel by `tintAmount`.
        if (layer.tintAmount > 0f) {
            val amount = layer.tintAmount.coerceIn(0f, 1f)
            val tr = android.graphics.Color.red(layer.tint) / 255f
            val tg = android.graphics.Color.green(layer.tint) / 255f
            val tb = android.graphics.Color.blue(layer.tint) / 255f
            // A blend of identity and a channel-gain matrix.
            m[0] = m[0] * (1 - amount) + amount * tr * 1.4f
            m[6] = m[6] * (1 - amount) + amount * tg * 1.4f
            m[12] = m[12] * (1 - amount) + amount * tb * 1.4f
        }
        return m
    }

    private fun drawLayerContent(canvas: Canvas, layer: Layer, time: Double) {
        val blurAmount = (layer.effects[Effect.BLUR] ?: 0f) * 24f
        when (layer.kind) {
            LayerKind.ADJUSTMENT -> Unit
                LayerKind.SHAPE -> {
                    // A blur effect on a shape is a masked blur, which the shape's own paint
                    // mask filter already does; it is applied inside drawShape.
                    drawShape(canvas, layer, time, blurAmount)
                }
                LayerKind.TEXT -> drawText(canvas, layer, time)
                LayerKind.IMAGE, LayerKind.VIDEO -> drawMedia(canvas, layer, time)
                LayerKind.AUDIO -> Unit
                LayerKind.NULL -> drawNull(canvas, layer, time)
                LayerKind.CAMERA, LayerKind.GROUP -> Unit
            }
    }

    /**
     * Keeps a value inside the range the platform can actually draw.
     *
     * A hand-edited or shared project file is allowed to contain anything. `Float` can be
     * infinite, and `toInt()` on an infinite value saturates to `Int.MAX_VALUE`, which then
     * reaches `drawRoundRect` as a radius and throws. Everything that crosses into a Canvas
     * call goes through here first.
     */
    private fun safe(value: Float, fallback: Float = 0f): Float =
        if (!value.isFinite()) fallback else value.coerceIn(-MAX_DIMENSION, MAX_DIMENSION)

    private companion object {
        /** Far beyond any composition; keeps integers and radii inside sane bounds. */
        const val MAX_DIMENSION = 100_000f
    }

    private fun applyTransform(canvas: Canvas, layer: Layer, time: Double) {
        canvas.translate(safe(layer.x.valueAt(time)), safe(layer.y.valueAt(time)))
        canvas.rotate(safe(layer.rotation.valueAt(time)))
        canvas.scale(
            safe(layer.scaleX.valueAt(time), 1f).takeIf { it != 0f } ?: .0001f,
            safe(layer.scaleY.valueAt(time), 1f).takeIf { it != 0f } ?: .0001f
        )
    }

    private fun drawShape(canvas: Canvas, layer: Layer, time: Double, extraBlur: Float = 0f) {
        paint.reset()
        paint.isAntiAlias = true
        paint.color = layer.color
        paint.alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        val w = safe(layer.width).coerceAtLeast(0f)
        val h = safe(layer.height).coerceAtLeast(0f)
        // A negative radius throws, and a radius larger than half the shape is just a
        // rectangle with rounded corners, which is what the caller meant anyway.
        val radius = safe(layer.cornerRadius).coerceIn(0f, kotlin.math.min(w, h) / 2f)
        val blur = (safe(layer.blur).coerceIn(0f, MAX_DIMENSION) + extraBlur).coerceIn(0f, MAX_DIMENSION)
        if (blur > 0f) paint.maskFilter = android.graphics.BlurMaskFilter(blur, android.graphics.BlurMaskFilter.Blur.NORMAL)
        canvas.save()
        applyTransform(canvas, layer, time)
        rect.set(-w / 2f, -h / 2f, w / 2f, h / 2f)
        when (layer.shape) {
            ShapeKind.RECT -> canvas.drawRoundRect(rect, radius, radius, paint)
            ShapeKind.ELLIPSE -> canvas.drawOval(rect, paint)
            ShapeKind.TRIANGLE -> {
                path.reset()
                path.moveTo(0f, -h / 2f)
                path.lineTo(w / 2f, h / 2f)
                path.lineTo(-w / 2f, h / 2f)
                path.close()
                canvas.drawPath(path, paint)
            }
        }
        canvas.restore()
    }

    private fun drawText(canvas: Canvas, layer: Layer, time: Double) {
        textPaint.reset()
        textPaint.isAntiAlias = true
        textPaint.color = Color.WHITE
        textPaint.alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        // Text size is used by the platform layout for the string; zero or negative throws.
        textPaint.textSize = safe(layer.textSize, 96f).coerceIn(1f, MAX_DIMENSION)
        textPaint.textAlign = Paint.Align.CENTER
        textPaint.typeface = if (layer.textBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        canvas.save()
        applyTransform(canvas, layer, time)
        // Baseline: centre the glyph's visual middle, not its ascent, or text sits high.
        val metrics = textPaint.fontMetrics
        val baseline = -(metrics.ascent + metrics.descent) / 2f
        layer.text.split('\n').forEachIndexed { index, line ->
            canvas.drawText(line, 0f, baseline + index * (metrics.descent - metrics.ascent) * 1.15f, textPaint)
        }
        canvas.restore()
    }

    private fun drawMedia(canvas: Canvas, layer: Layer, time: Double) {
        // Guard before the bitmap lookup: a zero-size destination makes drawBitmap a no-op on
        // some devices and an exception on others.
        if (safe(layer.width) <= 0f || safe(layer.height) <= 0f) return
        val bitmap = when (layer.kind) {
            // The frame cache is asked for the *source* time, so a trimmed or retimed clip
            // shows the picture that belongs to this instant rather than its first frame.
            LayerKind.VIDEO -> videoFrame?.invoke(layer, time) ?: bitmaps[layer.id]
            else -> bitmaps[layer.id]
        } ?: return
        paint.reset()
        paint.isAntiAlias = true
        paint.isFilterBitmap = true
        paint.alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        canvas.save()
        applyTransform(canvas, layer, time)
        val w = safe(layer.width)
        val h = safe(layer.height)
        rect.set(-w / 2f, -h / 2f, w / 2f, h / 2f)
        canvas.drawBitmap(bitmap, null, rect, paint)
        canvas.restore()
    }

    private fun drawNull(canvas: Canvas, layer: Layer, time: Double) {
        val s = 28f
        paint.reset()
        paint.isAntiAlias = true
        paint.color = if (layer.id == store?.selectedLayerId) 0xFF3AD9C6.toInt() else 0xFFFFC857.toInt()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f
        val x = layer.x.valueAt(time)
        val y = layer.y.valueAt(time)
        canvas.drawLine(x - s, y, x + s, y, paint)
        canvas.drawLine(x, y - s, x, y + s, paint)
        rect.set(x - s * .6f, y - s * .6f, x + s * .6f, y + s * .6f)
        canvas.drawRect(rect, paint)
    }

    /** Preview overload: draws the store's current document, time and selection. */
    fun drawComposition(canvas: Canvas, store: EditorStore, project: Project, forExport: Boolean = false) {
        drawComposition(canvas, project, store.time, store.selectedLayerId, forExport)
    }

    /** The selection frame, drawn in composition space so it matches the layer exactly. */
    private fun drawSelection(canvas: Canvas, project: Project, selectionId: String?, time: Double) {
        val layer = project.layer(selectionId) ?: return
        if (!layer.covers(time) || layer.kind == LayerKind.NULL) return
        val w = if (layer.kind == LayerKind.SHAPE || layer.kind == LayerKind.TEXT) {
            if (layer.kind == LayerKind.TEXT) max(layer.textSize * layer.text.length * .6f, 40f) else layer.width
        } else layer.width
        val h = if (layer.kind == LayerKind.TEXT) layer.textSize * 1.4f else layer.height
        if (w <= 0f || h <= 0f) return
        canvas.save()
        applyTransform(canvas, layer, time)
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2.5f / max(.05f, scale)
        paint.color = 0xFF3AD9C6.toInt()
        rect.set(-w / 2f, -h / 2f, w / 2f, h / 2f)
        canvas.drawRect(rect, paint)
        canvas.restore()
    }

    /**
     * Asks for one frame.
     *
     * A SurfaceView is NOT drawn by `invalidate`: the window never owns its pixels, so an
     * invalidation reaches `View.draw` and stops there, leaving the surface showing whatever
     * was last locked and posted. The frame must therefore be requested on the choreographer
     * and painted through [drawNow], which is also what makes a burst of edits collapse into a
     * single frame instead of a queue of them.
     */
    fun requestRender() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            post { requestRender() }
            return
        }
        if (frameScheduled || !drawingEnabled) return
        frameScheduled = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    private var frameScheduled = false
    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            frameScheduled = false
            drawNow()
            accountFrame(frameTimeNanos)
        }
    }
}
