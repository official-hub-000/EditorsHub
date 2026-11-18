package com.editorhub.nativeed

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Video frames for the preview.
 *
 * WHY NOT A MediaPlayer OR ExoPlayer
 *
 * A player decodes and presents in real time, which is right for watching and wrong for
 * editing: the preview has to show the frame for an arbitrary playhead position, including
 * while scrubbing backwards, and several layers may be at different points in different
 * clips. Pulling frames on demand gives exactly the frame the timeline asks for, every time.
 *
 * WHY THE DECODE IS OFF THE DRAW PATH
 *
 * Retriever calls take milliseconds. Doing them inside the render loop would stutter every
 * frame that needs a new picture. Frames are requested ahead, decoded on one background
 * thread, and the renderer draws whatever is already decoded for that layer. Until a new
 * frame lands, the previous one is shown; that is exactly how an editor behaves while
 * scrubbing.
 *
 * Requests are bucketed to 100 ms. A 30 fps clip has 30 frames a second and a finger can
 * only produce scrubbing positions a few dozen times a second, so bucketing removes almost
 * all duplicate work while staying visually continuous.
 */
class VideoFrames(private val cache: MediaCache, private val onFrame: () -> Unit) {

    private val frames = ConcurrentHashMap<String, Bitmap>()
    private val requestedBucket = ConcurrentHashMap<String, Long>()
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "video-frames").apply { priority = Thread.NORM_PRIORITY - 1 }
    }
    private val shutdown = AtomicBoolean(false)

    /** The most recent decoded frame for a layer, or null before the first one lands. */
    fun frame(layerId: String): Bitmap? = frames[layerId]

    /** Asks for the frame at the current playhead, if it is not already decoded. */
    fun request(layer: Layer, time: Double) {
        val uri = layer.sourceUri ?: return
        if (layer.kind != LayerKind.VIDEO || shutdown.get()) return
        val offset = ((time - layer.start) * 1000.0 * layer.speed).toLong().coerceAtLeast(0L)
        val bucket = offset / 100
        if (requestedBucket[layerId(layer)] == bucket) return
        requestedBucket[layerId(layer)] = bucket
        executor.execute {
            if (shutdown.get()) return@execute
            val bitmap = cache.videoFrame(uri, layerId(layer), offset) ?: return@execute
            val previous = frames.put(layerId(layer), bitmap)
            if (previous !== bitmap && previous != null && !previous.isRecycled) {
                // Frames are small and replaced often; recycling here keeps a long scrub from
                // accumulating hundreds of megabytes of bitmaps.
                previous.recycle()
            }
            onFrame()
        }
    }

    private fun layerId(layer: Layer): String = layer.id

    fun releaseAll() {
        shutdown.set(true)
        executor.shutdownNow()
        frames.values.forEach { if (!it.isRecycled) it.recycle() }
        frames.clear()
        cache.releaseRetrievers()
    }

    /** Drops the cached frame for a layer that was deleted or whose source changed. */
    fun forget(layerId: String) {
        frames.remove(layerId)?.let { if (!it.isRecycled) it.recycle() }
        requestedBucket.remove(layerId)
    }
}
