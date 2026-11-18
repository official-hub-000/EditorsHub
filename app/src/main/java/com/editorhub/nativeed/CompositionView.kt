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

    /** Bitmaps for media layers, keyed by layer id, supplied by [MediaCache]. */
    var bitmaps: Map<String, Bitmap> = emptyMap()
        set(value) { field = value; requestRender() }

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

    /** Frames drawn since the last [consumeFrameCount], used by the on-screen meter. */
    private var frames = 0

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
        if (w <= 0 || h <= 0) return
        scale = min(w.toFloat() / project.width, h.toFloat() / project.height)
        offsetX = (w - project.width * scale) * .5f
        offsetY = (h - project.height * scale) * .5f
        contentMatrix.setScale(scale, scale)
        contentMatrix.postTranslate(offsetX, offsetY)
    }

    /** View x -> composition x. */
    fun toCompositionX(viewX: Float): Float = (viewX - offsetX) / scale

    /** View y -> composition y. */
    fun toCompositionY(viewY: Float): Float = (viewY - offsetY) / scale

    fun consumeFrameCount(): Int { val f = frames; frames = 0; return f }

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
            when (layer.kind) {
                LayerKind.SHAPE -> drawShape(canvas, layer, time)
                LayerKind.TEXT -> drawText(canvas, layer, time)
                LayerKind.IMAGE, LayerKind.VIDEO -> drawMedia(canvas, layer, time)
                LayerKind.NULL -> drawNull(canvas, layer, time)
                LayerKind.CAMERA, LayerKind.GROUP -> Unit
            }
        }
        if (!forExport) drawSelection(canvas, project, selectionId, time)
        canvas.restore()
    }

    private fun applyTransform(canvas: Canvas, layer: Layer, time: Double) {
        canvas.translate(layer.x.valueAt(time), layer.y.valueAt(time))
        canvas.rotate(layer.rotation.valueAt(time))
        canvas.scale(
            layer.scaleX.valueAt(time).takeIf { it != 0f } ?: .0001f,
            layer.scaleY.valueAt(time).takeIf { it != 0f } ?: .0001f
        )
    }

    private fun drawShape(canvas: Canvas, layer: Layer, time: Double) {
        paint.reset()
        paint.isAntiAlias = true
        paint.color = layer.color
        paint.alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        val w = layer.width
        val h = layer.height
        canvas.save()
        applyTransform(canvas, layer, time)
        rect.set(-w / 2f, -h / 2f, w / 2f, h / 2f)
        when (layer.shape) {
            ShapeKind.RECT -> canvas.drawRoundRect(rect, layer.cornerRadius, layer.cornerRadius, paint)
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
        textPaint.textSize = layer.textSize
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
        val bitmap = bitmaps[layer.id] ?: return
        paint.reset()
        paint.isAntiAlias = true
        paint.isFilterBitmap = true
        paint.alpha = (layer.opacity.valueAt(time).coerceIn(0f, 1f) * 255).toInt()
        canvas.save()
        applyTransform(canvas, layer, time)
        rect.set(-layer.width / 2f, -layer.height / 2f, layer.width / 2f, layer.height / 2f)
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
        }
    }
}
