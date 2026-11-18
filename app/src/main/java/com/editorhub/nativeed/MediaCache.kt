package com.editorhub.nativeed

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

/**
 * Decoded stills for the preview, and the facts the editor needs to place them.
 *
 * Bitmaps are decoded at the size the preview can actually show, not at source resolution.
 * A 4K photo decoded full size costs 48 MB; the preview surface is a few hundred pixels
 * wide. Sampling on decode is one line and removes the single largest source of memory
 * pressure in a phone editor.
 */
class MediaCache(private val context: Context) {

    private val bitmaps = ConcurrentHashMap<String, Bitmap>()

    /**
     * One retriever per video uri.
     *
     * Creating a `MediaMetadataRetriever` is the expensive part of pulling a frame -- several
     * milliseconds of container parsing -- so they are kept alive and reused for the length of
     * a session. They are released in [releaseRetrievers].
     */
    private val retrievers = ConcurrentHashMap<String, MediaMetadataRetriever>()

    /** Facts about a picked file, used to build the layer. */
    data class MediaInfo(val width: Int, val height: Int, val durationMs: Long, val name: String)

    fun describe(uri: Uri): MediaInfo? = runCatching {
        val type = context.contentResolver.getType(uri) ?: ""
        val name = queryName(uri) ?: "media"
        if (type.startsWith("video/")) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context, uri)
                val w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 1080
                val h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 1920
                // Rotated phone video reports its stored width; the display orientation is
                // what the viewer expects, and swapping here keeps the aspect right.
                val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                if (rotation == 90 || rotation == 270) MediaInfo(h, w, duration, name) else MediaInfo(w, h, duration, name)
            } finally {
                runCatching { retriever.release() }
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            MediaInfo(max(1, bounds.outWidth), max(1, bounds.outHeight), 0L, name)
        }
    }.getOrNull()

    /**
     * Bitmap for a layer, decoded once and cached.
     *
     * [targetWidth] is the widest the composition can show it; decoding larger wastes memory
     * and copying it down costs a frame.
     */
    fun bitmap(layerId: String, uriString: String?, targetWidth: Int): Bitmap? {
        bitmaps[layerId]?.let { return it }
        val uri = uriString?.let { Uri.parse(it) } ?: return null
        val bitmap = runCatching {
            val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
            // Two-pass: read the size, then pick a power-of-two sample that lands at or above
            // the target. `inSampleSize` is the only sampling the decoder does for free.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= targetWidth) sample *= 2
            options.inSampleSize = sample
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        }.getOrNull() ?: return null
        bitmaps[layerId] = bitmap
        return bitmap
    }

    /**
     * One video frame at [timeMs] into the clip, scaled down to the preview's needs.
     *
     * Uses `OPTION_CLOSEST_SYNC`: seeking to the nearest keyframe is dramatically faster than
     * decoding forward to the exact frame, and while scrubbing a hundredth of a second's
     * difference is not visible. Exact frames are used for export.
     */
    fun videoFrame(uriString: String, layerId: String, timeMs: Long, targetWidth: Int = 720, exact: Boolean = false): Bitmap? {
        if (uriString.isBlank()) return null
        return runCatching {
            val retriever = retrievers.getOrPut(uriString) {
                MediaMetadataRetriever().also { it.setDataSource(context, Uri.parse(uriString)) }
            }
            val option = if (exact) MediaMetadataRetriever.OPTION_CLOSEST
            else MediaMetadataRetriever.OPTION_CLOSEST_SYNC
            val frame = retriever.getFrameAtTime(timeMs * 1000L, option) ?: return null
            if (frame.width > targetWidth) {
                val height = (frame.height.toFloat() * targetWidth / frame.width).toInt().coerceAtLeast(1)
                Bitmap.createScaledBitmap(frame, targetWidth, height, true).also { frame.recycle() }
            } else frame
        }.getOrNull()
    }

    fun releaseRetrievers() {
        retrievers.values.forEach { runCatching { it.release() } }
        retrievers.clear()
    }

    fun release(layerId: String) {
        bitmaps.remove(layerId)?.let { if (!it.isRecycled) it.recycle() }
    }

    fun releaseAll() {
        bitmaps.values.forEach { if (!it.isRecycled) it.recycle() }
        bitmaps.clear()
        releaseRetrievers()
    }

    fun snapshot(): Map<String, Bitmap> = HashMap(bitmaps)

    private fun queryName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    }.getOrNull()
}
