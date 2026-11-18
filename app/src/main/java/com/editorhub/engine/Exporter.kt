package com.editorhub.engine

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * MP4 export on the hardware encoder.
 *
 * Frames come from the same [com.editorhub.engine.gl.Compositor] the preview uses, so what is
 * exported is what was on screen. MediaCodec does the encoding on the device's dedicated block
 * rather than in the CPU, which is the difference between an export that takes a minute and one
 * that takes twenty.
 *
 * The encoder is fed in surface-free YUV420 planar mode: the compositor's RGBA readback is
 * converted here. That costs one pass over the frame and avoids the colour banding a texture
 * round-trip introduces on some drivers.
 */
class Exporter(
    private val bitrate: Int = 12_000_000,
    private val keyFrameIntervalSeconds: Float = 1f,
) {

    /** Reports progress 0..1. Called from the export thread. */
    var onProgress: ((Float) -> Unit)? = null

    /** Encodes [composition] at its own size and frame rate into [output]. */
    fun export(
        composition: Composition,
        output: File,
        frameProvider: (timeSeconds: Float) -> Bitmap,
        onCancel: () -> Boolean = { false },
    ) {
        val width = composition.width.even()
        val height = composition.height.even()
        val fps = composition.frameRate.coerceIn(24, 60)
        val totalFrames = (composition.duration * fps).roundToInt().coerceAtLeast(1)

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, keyFrameIntervalSeconds.roundToInt().coerceAtLeast(1))
            // Baseline on purpose: it is universally decodable, including by older social apps.
            setInteger(
                MediaFormat.KEY_PROFILE,
                MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline,
            )
            setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel41)
        }

        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()

        val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var trackIndex = -1
        var muxerStarted = false
        val info = MediaCodec.BufferInfo()
        val yuv = ByteArray(width * height * 3 / 2)

        try {
            var frameIndex = 0
            while (frameIndex < totalFrames) {
                if (onCancel()) throw Cancelled()
                val timeUs = (frameIndex * 1_000_000L / fps)
                val bitmap = frameProvider(frameIndex / fps.toFloat())
                convert(bitmap, yuv, width, height)
                if (bitmap.width != width || bitmap.height != height) bitmap.recycle()

                // Feed. A full queue means the encoder is behind: drain, then retry.
                var fed = false
                while (!fed) {
                    val inputIndex = codec.dequeueInputBuffer(10_000)
                    if (inputIndex >= 0) {
                        val buffer = codec.getInputBuffer(inputIndex) ?: continue
                        buffer.clear()
                        buffer.put(yuv)
                        val flags = if (frameIndex == totalFrames - 1) {
                            MediaCodec.BUFFER_FLAG_END_OF_STREAM
                        } else 0
                        codec.queueInputBuffer(inputIndex, 0, yuv.size, timeUs, flags)
                        fed = true
                    }
                    // Drain whatever is ready while waiting.
                    while (true) {
                        val outIndex = codec.dequeueOutputBuffer(info, 0)
                        if (outIndex < 0) break
                        if (info.size > 0 && muxerStarted) {
                            val out = codec.getOutputBuffer(outIndex) ?: break
                            muxer.writeSampleData(trackIndex, out, info)
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                    }
                }

                // Drain the encoded output.
                while (true) {
                    val outIndex = codec.dequeueOutputBuffer(info, 0)
                    if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER) break
                    if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (!muxerStarted) {
                            trackIndex = muxer.addTrack(codec.outputFormat)
                            muxer.start()
                            muxerStarted = true
                        }
                        continue
                    }
                    if (outIndex < 0) continue
                    val out = codec.getOutputBuffer(outIndex)
                    if (out != null && info.size > 0 && muxerStarted) {
                        muxer.writeSampleData(trackIndex, out, info)
                    }
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    codec.releaseOutputBuffer(outIndex, false)
                    if (eos) break
                }

                frameIndex++
                onProgress?.invoke(frameIndex.toFloat() / totalFrames)
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { if (muxerStarted) muxer.stop() }
            runCatching { muxer.release() }
        }
    }

    /**
     * RGBA bitmap to NV12-ish planar YUV.
     *
     * The integer coefficients are the BT.601 studio-swing matrix, which is what MediaCodec
     * assumes for this colour format; using the full-range JPEG matrix instead produces a
     * washed-out export that looks wrong next to the preview.
     */
    private fun convert(bitmap: Bitmap, out: ByteArray, width: Int, height: Int) {
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        val frameSize = width * height
        var uIndex = frameSize
        var vIndex = frameSize + frameSize / 4
        var yIndex = 0
        var i = 0
        var row = 0
        while (row < height) {
            var col = 0
            while (col < width) {
                val c = pixels[i]
                val r = (c shr 16) and 0xFF
                val g = (c shr 8) and 0xFF
                val b = c and 0xFF
                val y = ((66 * r + 129 * g + 25 * b + 128) shr 8) + 16
                out[yIndex++] = y.coerceIn(0, 255).toByte()
                // Chroma is subsampled 2x2: one sample per four luma samples.
                if (row % 2 == 0 && col % 2 == 0) {
                    val u = ((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128
                    val v = ((112 * r - 94 * g - 18 * b + 128) shr 8) + 128
                    out[uIndex++] = u.coerceIn(0, 255).toByte()
                    out[vIndex++] = v.coerceIn(0, 255).toByte()
                }
                col++
                i++
            }
            row++
        }
    }

    private fun Int.even(): Int = if (this % 2 == 0) this else this + 1

    class Cancelled : Exception("Export cancelled")

    /** Writes the frame back out of a ByteBuffer the encoder produced, for the still export path. */
    fun encodeStill(bitmap: Bitmap, quality: Int = 95): ByteBuffer {
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        return ByteBuffer.wrap(stream.toByteArray())
    }
}
