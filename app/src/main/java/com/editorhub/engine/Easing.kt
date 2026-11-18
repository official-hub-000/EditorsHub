package com.editorhub.engine

/**
 * Timing curves.
 *
 * A keyframe holds a value; the curve between two keyframes decides how the value travels.
 * Everything here is a normalised function `f(0..1) -> 0..1`, which is what both the renderer
 * and the graph editor consume, so a curve drawn in the UI is bit-identical to the one the
 * compositor evaluates.
 */
enum class Easing(
    val label: String,
    private val x1: Float = 0f,
    private val y1: Float = 0f,
    private val x2: Float = 1f,
    private val y2: Float = 1f,
) {
    LINEAR("Linear", 0f, 0f, 1f, 1f),
    EASE_IN("Ease In", .42f, 0f, 1f, 1f),
    EASE_OUT("Ease Out", 0f, 0f, .58f, 1f),
    EASE_IN_OUT("Ease In-Out", .42f, 0f, .58f, 1f),
    OVERSHOOT("Overshoot", .18f, .86f, .28f, 1.32f),
    ANTICIPATE("Anticipate", .34f, -.28f, .64f, 1f),
    HOLD("Hold", 0f, 0f, 0f, 1f);

    /** Cubic-bezier through (0,0) and (1,1) with the two control points above. */
    fun at(t: Float): Float {
        if (this == LINEAR || this == HOLD) return if (this == HOLD) 0f else t
        val p = if (t <= 0f) 0f else if (t >= 1f) 1f else t
        // Solve x(s) = p by bisection, then read y(s). 24 iterations is far past float precision.
        var lo = 0f
        var hi = 1f
        var s = p
        repeat(24) {
            s = (lo + hi) * .5f
            val x = bezier(s, x1, x2)
            if (x < p) lo = s else hi = s
        }
        return bezier(s, y1, y2)
    }

    private fun bezier(s: Float, c1: Float, c2: Float): Float {
        val u = 1f - s
        return 3f * u * u * s * c1 + 3f * u * s * s * c2 + s * s * s
    }

    companion object {
        fun of(name: String): Easing = entries.firstOrNull { it.name == name } ?: LINEAR
    }
}
