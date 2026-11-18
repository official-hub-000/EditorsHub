package com.editorhub

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the device can actually encode, and whether it is hardware.
 *
 * WHY THIS EXISTS
 *
 * The editor exports through WebCodecs. On Android, a WebView's WebCodecs implementation is
 * expected to sit on top of the platform encoder, which means the export is very likely already
 * running on the hardware H.264 block — but "expected" is not a measurement, and the difference
 * between a software and a hardware encoder is the difference between an export that takes a
 * minute and one that takes ten.
 *
 * This reports the truth: which encoders the device has, whether each is hardware-accelerated,
 * and the maximum resolution and frame rate it advertises. The shell logs it once at startup and
 * exposes it to the editor, so the export path can be chosen from facts.
 */
object NativeCodecs {

    /** Every H.264 encoder on the device, hardware first. */
    fun encoders(): List<EncoderInfo> {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        val out = ArrayList<EncoderInfo>()
        for (info in list.codecInfos) {
            if (!info.isEncoder) continue
            val supportsAvc = info.supportedTypes.any { it.equals("video/avc", ignoreCase = true) }
            if (!supportsAvc) continue
            out.add(readInfo(info))
        }
        // Hardware first: the whole point of the query is to find the accelerated one.
        return out.sortedByDescending { it.hardware }
    }

    private fun readInfo(info: MediaCodecInfo): EncoderInfo {
        var maxWidth = 0
        var maxHeight = 0
        var maxFps = 0
        var bitrateRange = ""
        var hardware = false

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                hardware = info.isHardwareAccelerated
            } else {
                // Before API 29 the name is the only signal: every vendor prefixes software
                // codecs with "OMX.google" or "c2.android".
                val n = info.name.lowercase()
                hardware = !(n.startsWith("omx.google") || n.startsWith("c2.android"))
            }
        }

        runCatching {
            val caps = info.getCapabilitiesForType("video/avc")
            for (profileLevels in caps.profileLevels) {
                // Resolution ceilings live in the video capabilities, not the profile list.
            }
            caps.videoCapabilities?.let { vc ->
                maxWidth = vc.supportedWidths.upper
                maxHeight = vc.supportedHeights.upper
                maxFps = vc.supportedFrameRates.upper.toInt()
                bitrateRange = "${vc.bitrateRange.lower}-${vc.bitrateRange.upper}"
            }
        }

        return EncoderInfo(info.name, hardware, maxWidth, maxHeight, maxFps, bitrateRange)
    }

    /**
     * A single JSON object describing the device's encoding capability.
     *
     * The editor asks for this once: if a hardware H.264 encoder is present, export can be trusted
     * to that path with a resolution it advertises rather than one that fails at run time.
     */
    fun describe(): String {
        val json = JSONObject()
        val encoders = encoders()
        json.put("sdk", Build.VERSION.SDK_INT)
        json.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        json.put("hasHardwareH264", encoders.any { it.hardware })
        json.put(
            "encoders",
            JSONArray().apply {
                encoders.forEach { e ->
                    put(
                        JSONObject().apply {
                            put("name", e.name)
                            put("hardware", e.hardware)
                            put("maxWidth", e.maxWidth)
                            put("maxHeight", e.maxHeight)
                            put("maxFps", e.maxFps)
                            put("bitrate", e.bitrateRange)
                        },
                    )
                }
            },
        )
        // The largest resolution a hardware encoder advertises, which is the safe ceiling for an
        // export preset.
        val best = encoders.firstOrNull { it.hardware }
        json.put("hardwareMaxWidth", best?.maxWidth ?: 0)
        json.put("hardwareMaxHeight", best?.maxHeight ?: 0)
        json.put("hardwareMaxFps", best?.maxFps ?: 0)
        return json.toString()
    }

    data class EncoderInfo(
        val name: String,
        val hardware: Boolean,
        val maxWidth: Int,
        val maxHeight: Int,
        val maxFps: Int,
        val bitrateRange: String,
    )
}
