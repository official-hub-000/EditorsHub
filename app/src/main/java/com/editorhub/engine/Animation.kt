package com.editorhub.engine

/**
 * One keyframe: a value at a time, with the curve that carries it to the next keyframe.
 *
 * [time] is layer-local seconds. Holding the curve on the keyframe that starts a segment (rather
 * than the one that ends it) is the convention every editor uses, so the last keyframe's easing
 * simply never applies.
 */
data class Keyframe(
    val time: Float,
    val value: Float,
    val easing: Easing = Easing.EASE_IN_OUT,
)

/**
 * An animated scalar channel.
 *
 * A channel with no keyframes is a constant, which is why [static] exists: the overwhelming
 * majority of properties in a real project never animate, and sampling a one-element list per
 * frame per property per layer is wasted work.
 */
class Channel private constructor(
    private val keys: List<Keyframe>,
    private val constant: Float,
) {
    val isAnimated: Boolean get() = keys.isNotEmpty()

    fun valueAt(time: Float): Float {
        if (keys.isEmpty()) return constant
        if (keys.size == 1) return keys[0].value
        if (time <= keys.first().time) return keys.first().value
        if (time >= keys.last().time) return keys.last().value

        // Keys are kept sorted on write, so a binary search is the whole lookup.
        var lo = 0
        var hi = keys.size - 1
        while (hi - lo > 1) {
            val mid = (lo + hi) ushr 1
            if (keys[mid].time <= time) lo = mid else hi = mid
        }
        val a = keys[lo]
        val b = keys[hi]
        val span = b.time - a.time
        if (span <= 1e-6f) return b.value
        val t = ((time - a.time) / span).coerceIn(0f, 1f)
        return a.value + (b.value - a.value) * a.easing.at(t)
    }

    fun keys(): List<Keyframe> = keys

    /** Returns a new channel with a keyframe set at [time], replacing one within 0.5 ms. */
    fun withKey(time: Float, value: Float, easing: Easing): Channel {
        val t = time.coerceAtLeast(0f)
        val next = keys.filterNot { kotlin.math.abs(it.time - t) < 5e-4f } + Keyframe(t, value, easing)
        return animated(next.sortedBy { it.time })
    }

    fun withoutKey(time: Float): Channel =
        animated(keys.filterNot { kotlin.math.abs(it.time - time) < 5e-4f })

    /** Nudges the value at [time] without disturbing the shape of the surrounding segment. */
    fun moved(): Channel = if (keys.isEmpty()) static(constant) else animated(keys)

    companion object {
        fun static(value: Float) = Channel(emptyList(), value)
        fun animated(keys: List<Keyframe>) = Channel(keys, keys.firstOrNull()?.value ?: 0f)
    }
}
