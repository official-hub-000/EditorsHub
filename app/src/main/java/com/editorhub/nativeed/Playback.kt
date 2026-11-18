package com.editorhub.nativeed

import android.view.Choreographer
import kotlin.math.roundToLong

/**
 * The playback clock.
 *
 * WHY THIS IS NOT A TIMER
 *
 * Every frame is scheduled from [Choreographer], not from a fixed-delay handler. The
 * choreographer fires once per display refresh, immediately before the frame is wanted, so
 * the playhead time is computed from the frame's own timestamp instead of accumulating a
 * delay's error. Drift, speed wobble and the "it plays slower than the timeline says" bug
 * all come from accumulating; this does not accumulate.
 *
 * The playhead is also quantised to project frames, because the compositor draws the layer
 * values at a frame time. Advancing by wall-clock seconds and drawing at that instant would
 * produce sub-frame values nobody can see and make a 30 fps project repaint 60 times a
 * second for 30 distinct pictures.
 */
class Playback(
    private val store: EditorStore,
    private val onFrame: (Double) -> Unit,
    private val onStopped: () -> Unit
) : Choreographer.FrameCallback {

    var isPlaying: Boolean = false
        private set

    private var startNanos = 0L
    private var startTime = 0.0
    private var frameCallbackScheduled = false

    /** How many frames this project shows per second. */
    private val fps: Int get() = store.project.fps.coerceIn(1, 240)

    fun toggle() = if (isPlaying) stop() else start()

    fun start() {
        if (isPlaying) return
        val project = store.project
        if (project.duration <= 0.0) return
        // Pressing play at the very end restarts from the top, which is what a transport
        // button is expected to do rather than sitting on the last frame doing nothing.
        if (store.time >= project.duration - 1.0 / fps) store.setTime(0.0)
        isPlaying = true
        startNanos = 0L
        startTime = store.time
        schedule()
    }

    fun stop() {
        if (!isPlaying) return
        isPlaying = false
        startNanos = 0L
        if (frameCallbackScheduled) {
            Choreographer.getInstance().removeFrameCallback(this)
            frameCallbackScheduled = false
        }
        onStopped()
    }

    /** Scrubbing while playing re-anchors the clock instead of fighting it. */
    fun seek(time: Double) {
        store.setTime(time)
        startTime = store.time
        startNanos = 0L
    }

    private fun schedule() {
        if (frameCallbackScheduled) return
        frameCallbackScheduled = true
        Choreographer.getInstance().postFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        frameCallbackScheduled = false
        if (!isPlaying) return
        if (startNanos == 0L) startNanos = frameTimeNanos

        val elapsed = (frameTimeNanos - startNanos) / 1_000_000_000.0
        val raw = startTime + elapsed
        val project = store.project

        if (raw >= project.duration) {
            store.setTime(project.duration)
            onFrame(project.duration)
            stop()
            return
        }

        // Snap to the project's own frame grid so the drawn values match the timeline.
        val frame = (raw * fps).roundToLong()
        val snapped = frame.toDouble() / fps
        store.setTime(snapped)
        onFrame(snapped)
        schedule()
    }
}
