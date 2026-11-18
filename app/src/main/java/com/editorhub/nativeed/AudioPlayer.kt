package com.editorhub.nativeed

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import kotlin.math.abs

/**
 * Plays the audio of a composition.
 *
 * WHY A MediaPlayer PER LAYER
 *
 * Each video or audio layer is its own clip with its own trim, speed and volume, and the
 * timeline can have several audible at once. One player per audible layer is the only model
 * that matches that; a single mixer would need a decoder per track anyway.
 *
 * WHY POSITION IS SET, NOT ASSUMED
 *
 * A player's own idea of its position drifts from the playhead the moment the user scrubs,
 * loops or pauses. On every seek the players are re-synced to the composition time, and during
 * playback the drift is corrected only when it exceeds a threshold -- correcting constantly
 * would produce audible stuttering from repeated seeks.
 *
 * A player is only started for a layer that should be audible at this instant, so a timeline
 * with a dozen clips does not open a dozen decoders.
 */
class AudioPlayer(private val context: Context) {

    private val players = HashMap<String, MediaPlayer>()

    /** Starts, seeks or stops each clip so the mix matches [time]. */
    fun sync(project: Project, time: Double, playing: Boolean) {
        val audible = project.layers.filter {
            (it.kind == LayerKind.AUDIO || it.kind == LayerKind.VIDEO) &&
                it.visible && it.volume > 0.001f && it.covers(time) && it.sourceUri != null
        }
        val audibleIds = audible.map { it.id }.toSet()

        // Clips that stopped being audible.
        players.keys.toList().forEach { id ->
            if (id !in audibleIds) {
                release(id)
            }
        }

        audible.forEach { layer ->
            val player = players[layer.id] ?: open(layer) ?: return@forEach
            val target = layer.sourceTimeAt(time)
            val drift = abs(player.currentPosition / 1000.0 - target)
            if (!playing) {
                if (drift > .05) runCatching { player.seekTo((target * 1000).toInt()) }
                if (player.isPlaying) runCatching { player.pause() }
            } else {
                // A clip that starts mid-timeline only begins once the playhead reaches it.
                if (drift > .30) runCatching { player.seekTo((target * 1000).toInt()) }
                if (!player.isPlaying && drift <= .30) runCatching { player.start() }
            }
            runCatching {
                player.setVolume(layer.volume, layer.volume)
                // Speed is applied by the platform as a pitch-preserving time stretch.
                val speed = layer.speed.coerceIn(.5f, 2f)
                player.playbackParams = player.playbackParams.setSpeed(speed)
            }
        }
    }

    private fun open(layer: Layer): MediaPlayer? = runCatching {
        val player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                    .build()
            )
            setDataSource(context, Uri.parse(layer.sourceUri))
            isLooping = false
            prepare()
        }
        players[layer.id] = player
        player
    }.getOrNull()

    fun release(id: String) {
        players.remove(id)?.let { player ->
            runCatching { if (player.isPlaying) player.pause() }
            runCatching { player.release() }
        }
    }

    fun releaseAll() {
        players.keys.toList().forEach { release(it) }
    }
}
