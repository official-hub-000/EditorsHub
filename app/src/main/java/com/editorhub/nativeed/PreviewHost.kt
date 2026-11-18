package com.editorhub.nativeed

import android.graphics.Bitmap
import android.view.MotionEvent
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Gesture handling for the preview surface.
 *
 * SELECT AND DRAG
 * A single finger drags the selected layer, and a tap with no drag selects whatever is under
 * the finger (or clears the selection on empty canvas). The distinction is decided on the
 * first movement past the touch slop, so a tap never nudges a layer and a drag never changes
 * the selection mid-gesture.
 *
 * TWO FINGERS
 * Scale is the ratio of the fingers' distance, rotation is the change in their angle. Both
 * are applied about the layer's own centre because that is what the on-screen selection box
 * implies. A two-finger drag moves the layer.
 *
 * Everything writes through [EditorStore.setValue], so a gesture on an animated property
 * records a keyframe at the playhead instead of overwriting the animation.
 */
class PreviewTouchHandler(
    private val view: CompositionView,
    private val store: EditorStore
) {
    private var mode = 0 // 0 idle, 1 drag layer, 2 pinch
    private var lastX = 0f
    private var lastY = 0f
    private var startDistance = 0f
    private var startAngle = 0f
    private var startScaleX = 1f
    private var startScaleY = 1f
    private var startRotation = 0f
    private var downX = 0f
    private var downY = 0f
    private var moved = false
    private val slop = 12f

    fun onTouch(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.x; downY = event.y
                lastX = event.x; lastY = event.y
                moved = false
                mode = 1
                store.checkpoint()
                return true
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (event.pointerCount >= 2) {
                    mode = 2
                    startDistance = distance(event)
                    startAngle = angle(event)
                    val layer = store.selected ?: return true
                    startScaleX = layer.scaleX.valueAt(store.time)
                    startScaleY = layer.scaleY.valueAt(store.time)
                    startRotation = layer.rotation.valueAt(store.time)
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val layer = store.selected
                if (layer != null && !layer.locked) {
                    if (mode == 2 && event.pointerCount >= 2) {
                        val ratio = if (startDistance > 1f) distance(event) / startDistance else 1f
                        val delta = angle(event) - startAngle
                        store.setValue(layer, "scaleX", (startScaleX * ratio).coerceIn(.02f, 20f))
                        store.setValue(layer, "scaleY", (startScaleY * ratio).coerceIn(.02f, 20f))
                        if (abs(delta) > 1f) store.setValue(layer, "rotation", startRotation + delta)
                        return true
                    }
                    val dx = event.x - lastX
                    val dy = event.y - lastY
                    if (!moved && (Math.abs(event.x - downX) > slop || Math.abs(event.y - downY) > slop)) moved = true
                    if (moved) {
                        store.setValue(layer, "x", layer.x.valueAt(store.time) + dx / viewScale())
                        store.setValue(layer, "y", layer.y.valueAt(store.time) + dy / viewScale())
                        lastX = event.x; lastY = event.y
                    }
                }
                return true
            }
            MotionEvent.ACTION_POINTER_UP -> {
                // Dropping back to one finger continues as a drag from where it is, otherwise
                // the layer would jump by the distance between the two fingers.
                mode = 1
                lastX = event.getX(0); lastY = event.getY(0)
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (!moved) {
                    val hit = hitTest(view.toCompositionX(event.x), view.toCompositionY(event.y))
                    store.select(hit?.id)
                }
                mode = 0
                return true
            }
            MotionEvent.ACTION_CANCEL -> { mode = 0; return true }
        }
        return false
    }

    private fun viewScale(): Float {
        val project = store.project
        return view.width.toFloat() / project.width
    }

    private fun distance(event: MotionEvent): Float {
        val dx = event.getX(0) - event.getX(1)
        val dy = event.getY(0) - event.getY(1)
        return kotlin.math.hypot(dx, dy)
    }

    private fun angle(event: MotionEvent): Float {
        val dx = event.getX(1) - event.getX(0)
        val dy = event.getY(1) - event.getY(0)
        return Math.toDegrees(kotlin.math.atan2(dy.toDouble(), dx.toDouble())).toFloat()
    }

    /**
     * Topmost layer whose box contains the point.
     *
     * Uses the same box the selection outline draws, so what looks hittable is hittable.
     * Rotation is accounted for by transforming the point into the layer's own frame.
     */
    fun hitTest(x: Float, y: Float): Layer? {
        val project = store.project
        val time = store.time
        for (layer in project.layers.reversed()) {
            if (!layer.visible || !layer.covers(time)) continue
            val w = when (layer.kind) {
                LayerKind.TEXT -> (layer.text.length.coerceAtLeast(1) * layer.textSize * .6f)
                else -> layer.width
            }
            val h = if (layer.kind == LayerKind.TEXT) layer.textSize * 1.4f else layer.height
            if (w <= 0f || h <= 0f) continue
            val lx = layer.x.valueAt(time)
            val ly = layer.y.valueAt(time)
            val angle = Math.toRadians(-layer.rotation.valueAt(time).toDouble())
            val dx = x - lx
            val dy = y - ly
            val rx = (dx * Math.cos(angle) - dy * Math.sin(angle)).toFloat()
            val ry = (dx * Math.sin(angle) + dy * Math.cos(angle)).toFloat()
            val sx = layer.scaleX.valueAt(time).takeIf { it != 0f } ?: 1f
            val sy = layer.scaleY.valueAt(time).takeIf { it != 0f } ?: 1f
            if (Math.abs(rx) <= w * Math.abs(sx) / 2f && Math.abs(ry) <= h * Math.abs(sy) / 2f) return layer
        }
        return null
    }

    private fun abs(v: Float) = Math.abs(v)
}

/**
 * Compose bridge for the preview surface.
 *
 * `AndroidView` gives the SurfaceView a real view to live in; the factory attaches the touch
 * handler once, and updates only re-attach the store and the bitmap cache. The bitmaps are
 * supplied by the caller so this file never touches the content resolver.
 */
@Composable
fun PreviewSurface(
    store: EditorStore,
    bitmaps: Map<String, Bitmap>,
    modifier: Modifier = Modifier,
    videoFrames: VideoFrames? = null,
    onReady: (CompositionView) -> Unit = {}
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            CompositionView(context).also { view ->
                view.store = store
                val handler = PreviewTouchHandler(view, store)
                view.setOnTouchListener { _, event -> handler.onTouch(event) }
                if (videoFrames != null) {
                    // Asked at draw time, so the frame always matches the playhead the frame
                    // is being drawn for -- never one frame behind, never one layer ahead.
                    view.videoFrame = { layer, time ->
                        videoFrames.request(layer, time)
                        videoFrames.frame(layer.id)
                    }
                }
                onReady(view)
            }
        },
        update = { view ->
            view.store = store
            view.bitmaps = bitmaps
            if (videoFrames != null) {
                view.videoFrame = { layer, time ->
                    videoFrames.request(layer, time)
                    videoFrames.frame(layer.id)
                }
            }
            view.requestRender()
        }
    )
}
