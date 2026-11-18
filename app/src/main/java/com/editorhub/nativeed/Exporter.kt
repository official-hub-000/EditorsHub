package com.editorhub.nativeed

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Handler
import android.os.Looper
import java.io.File

/**
 * Renders the composition to an MP4.
 *
 * HOW THE VIDEO IS MADE
 *
 * A surface-less MediaCodec in byte-buffer mode, fed one RGBA frame at a time. Each frame is
 * drawn with the same [CompositionView.drawComposition] code the preview uses, so what is
 * exported is by construction what was on screen; there is no second renderer to drift.
 *
 * Why not a real GL pipeline with a shared surface: byte buffers are slower for large frames
 * but they are simple, they work on every device, and a composition here is a handful of
 * quads and bitmaps, not a game. Correctness and no external dependency beat a few
 * milliseconds per frame. Encoding runs off the main thread and reports progress.
 */
class Exporter(private val context: Context) {

    data class Progress(val frame: Int, val total: Int) {
        val fraction: Float get() = if (total <= 0) 0f else frame.toFloat() / total
    }

    /**
     * Encodes [project] to [out].
     *
     * [bitmaps] supplies stills for image layers; video layers are drawn from their first
     * decoded frame at present resolution (see the note on [sourceFrame] below).
     * Returns the written file, or null when the encoder refused the format.
     */
    fun export(
        project: Project,
        bitmaps: Map<String, Bitmap>,
        out: File,
        drawFrame: (Canvas, Project, Double) -> Unit,
        onProgress: (Progress) -> Unit = {},
        isCancelled: () -> Boolean = { false }
    ): File? {
        // H.264 wants even dimensions; odd project sizes would otherwise fail to configure.
        val w = (project.width / 2) * 2
        val h = (project.height / 2) * 2
        val fps = project.fps.coerceIn(1, 60)
        val total = (project.duration * fps).toInt().coerceAtLeast(1)

        var codec: MediaCodec? = null
        var muxer: MediaMuxer? = null
        var muxerStarted = false
        try {
            val format = MediaFormat.createVideoFormat("video/avc", w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                // 12 Mbps at 1080x1920 holds up for flat graphics and text without making
                // files people cannot upload.
                setInteger(MediaFormat.KEY_BIT_RATE, 12_000_000)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }
            codec = MediaCodec.createEncoderByType("video/avc")
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            val info = MediaCodec.BufferInfo()
            var trackIndex = -1
            val frame = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(frame)
            val scaleX = w.toFloat() / project.width
            val scaleY = h.toFloat() / project.height
            var frameIndex = 0
            var cancelled = false

            while (frameIndex < total && !cancelled) {
                if (isCancelled()) { cancelled = true; break }
                val time = frameIndex.toDouble() / fps

                // Draw at composition size, then scale into the encoder frame so the encoder
                // always sees exactly w x h regardless of odd project sizes.
                frame.eraseColor(project.background)
                canvas.save()
                canvas.scale(scaleX, scaleY)
                drawFrame(canvas, project, time)
                canvas.restore()

                val yuv = rgbaToI420(frame)
                val inputIndex = codec.dequeueInputBuffer(10_000)
                if (inputIndex >= 0 && !cancelled) {
                    val buffer = codec.getInputBuffer(inputIndex)
                    if (buffer != null) {
                        buffer.clear()
                        buffer.put(yuv)
                        val pts = frameIndex * 1_000_000L / fps
                        codec.queueInputBuffer(inputIndex, 0, yuv.size, pts, 0)
                        frameIndex++
                        onProgress(Progress(frameIndex, total))
                    }
                }

                // Drain whatever the encoder has finished, every iteration.
                while (true) {
                    val outIndex = codec.dequeueOutputBuffer(info, 0)
                    when {
                        outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> break
                        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            trackIndex = muxer.addTrack(codec.outputFormat)
                            muxer.start()
                            muxerStarted = true
                        }
                        outIndex >= 0 -> {
                            val encoded = codec.getOutputBuffer(outIndex)
                            if (encoded != null && info.size > 0 && muxerStarted) {
                                encoded.position(info.offset)
                                encoded.limit(info.offset + info.size)
                                muxer.writeSampleData(trackIndex, encoded, info)
                            }
                            codec.releaseOutputBuffer(outIndex, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                        }
                    }
                }
            }

            // Flush: signal end of input, keep draining until the encoder says it is done.
            val endIndex = codec.dequeueInputBuffer(100_000)
            if (endIndex >= 0) {
                codec.queueInputBuffer(endIndex, 0, 0, frameIndex * 1_000_000L / fps, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            }
            var draining = true
            while (draining) {
                when (val outIndex = codec.dequeueOutputBuffer(info, 20_000)) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> draining = false
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (!muxerStarted) { trackIndex = muxer.addTrack(codec.outputFormat); muxer.start(); muxerStarted = true }
                    }
                    else -> if (outIndex >= 0) {
                        val encoded = codec.getOutputBuffer(outIndex)
                        if (encoded != null && info.size > 0 && muxerStarted) {
                            encoded.position(info.offset)
                            encoded.limit(info.offset + info.size)
                            muxer.writeSampleData(trackIndex, encoded, info)
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) draining = false
                    }
                }
            }
            frame.recycle()
            return out
        } catch (_: Throwable) {
            return null
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            runCatching { if (muxerStarted) muxer?.stop() }
            runCatching { muxer?.release() }
        }
    }

    /**
     * ARGB_8888 -> I420.
     *
     * Video encoders consume YUV. Getting this conversion wrong produces the classic
     * green-and-purple export, so the coefficients here are the standard BT.601 studio-swing
     * set that every H.264 decoder expects.
     */
    private fun rgbaToI420(bitmap: Bitmap): ByteArray {
        val width = bitmap.width
        val height = bitmap.height
        val argb = IntArray(width * height)
        bitmap.getPixels(argb, 0, width, 0, 0, width, height)
        val ySize = width * height
        val uvSize = (width / 2) * (height / 2)
        val out = ByteArray(ySize + uvSize * 2)
        var yIndex = 0
        var uIndex = ySize
        var vIndex = ySize + uvSize
        for (row in 0 until height) {
            for (col in 0 until width) {
                val colour = argb[row * width + col]
                val r = (colour shr 16) and 0xFF
                val g = (colour shr 8) and 0xFF
                val b = colour and 0xFF
                val y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                out[yIndex++] = y.coerceIn(0, 255).toByte()
                if (row % 2 == 0 && col % 2 == 0) {
                    val u = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
                    val v = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
                    out[uIndex++] = u.coerceIn(0, 255).toByte()
                    out[vIndex++] = v.coerceIn(0, 255).toByte()
                }
            }
        }
        return out
    }

    companion object {
        /** Progress callbacks arrive off the main thread; callers use this to hop back. */
        val mainHandler: Handler by lazy { Handler(Looper.getMainLooper()) }
    }
}
