package com.editorhub.nativeed

import java.util.UUID
import kotlin.math.max

/**
 * The project document: compositions, layers, keyframes and the easing between them.
 *
 * This is the Kotlin replacement for the editor state that used to live in a 6 MB
 * JavaScript bundle. It holds data only -- no Android types -- so it can be unit tested on
 * a desktop JVM and serialised without a Context.
 *
 * COORDINATES use composition pixels with Y down, which is what every layer tool and every
 * touch gesture already speaks. Normalised device coordinates only appear inside the
 * renderer.
 */

/** One keyframe. [ease] describes the curve leaving this key towards the next one. */
data class Keyframe(
    val t: Double,
    val v: Float,
    val ease: Ease = Ease.Linear
)

enum class EaseKind { LINEAR, CUBIC, SPRING, HOLD }

/**
 * An easing curve.
 *
 * [CUBIC] holds the two control points of a CSS-style cubic-bezier, which is what both the
 * graph editor's handles and the preset rail write. Evaluation is a real solve, not a
 * lookup into a table, so a dragged handle is reflected exactly.
 */
data class Ease(
    val kind: EaseKind = EaseKind.LINEAR,
    val x1: Float = 0f,
    val y1: Float = 0f,
    val x2: Float = 1f,
    val y2: Float = 1f,
    val stiffness: Float = 130f,
    val damping: Float = 13f
) {
    companion object {
        val Linear = Ease()
        val EaseIn = Ease(EaseKind.CUBIC, .42f, 0f, 1f, 1f)
        val EaseOut = Ease(EaseKind.CUBIC, 0f, 0f, .58f, 1f)
        val EaseInOut = Ease(EaseKind.CUBIC, .42f, 0f, .58f, 1f)
        val Overshoot = Ease(EaseKind.CUBIC, .18f, .86f, .28f, 1.32f)
        val Spring = Ease(EaseKind.SPRING)
        val Hold = Ease(EaseKind.HOLD)

        /** The preset rail in the Ease panel, in the order it is drawn. */
        val presets: List<Pair<String, Ease>> = listOf(
            "Linear" to Linear,
            "Ease In" to EaseIn,
            "Ease Out" to EaseOut,
            "Ease In/Out" to EaseInOut,
            "Overshoot" to Overshoot,
            "Spring" to Spring,
            "Hold" to Hold
        )
    }

    /** Progress 0..1 for a normalised time 0..1 along the segment. */
    fun at(fraction: Float): Float = when (kind) {
        EaseKind.LINEAR -> fraction
        EaseKind.HOLD -> 0f
        EaseKind.CUBIC -> cubic(fraction)
        // A damped spring sampled at the segment's end: it settles on 1, which is what the
        // next keyframe expects. The oscillation is what the user is choosing.
        EaseKind.SPRING -> {
            val w = max(1f, stiffness)
            val damp = max(.05f, damping)
            val envelope = Math.exp((-damp * fraction).toDouble()).toFloat()
            (1f - envelope * Math.cos((w * fraction).toDouble()).toFloat())
        }
    }

    private fun cubic(x: Float): Float {
        // Bezier with control points (0,0) (x1,y1) (x2,y2) (1,1): solve x(t)=fraction for t,
        // then read y(t). Newton with a bisection fallback keeps a dragged handle stable.
        val px = x.coerceIn(0f, 1f)
        var lo = 0f
        var hi = 1f
        var t = px
        repeat(24) {
            val bx = bezier(t, 0f, x1, x2, 1f)
            if (bx < px) lo = t else hi = t
            t = (lo + hi) * .5f
            if (hi - lo < 1e-5f) return bezier(t, 0f, y1, y2, 1f)
        }
        return bezier(t, 0f, y1, y2, 1f)
    }

    private fun bezier(t: Float, p0: Float, p1: Float, p2: Float, p3: Float): Float {
        val u = 1f - t
        return u * u * u * p0 + 3f * u * u * t * p1 + 3f * u * t * t * p2 + t * t * t * p3
    }
}

/** A keyframed property. An empty list means "use [base]". */
class Track(val base: Float, val keys: MutableList<Keyframe> = mutableListOf()) {

    val animated: Boolean get() = keys.size >= 2

    /**
     * Value at [time]. Before the first key it holds the first key, after the last it holds
     * the last, which is what every editor does and what makes adding a keyframe not move
     * the rest of the timeline.
     */
    fun valueAt(time: Double): Float {
        if (keys.isEmpty()) return base
        if (keys.size == 1) return keys[0].v
        val sorted = keys.sortedBy { it.t }
        if (time <= sorted.first().t) return sorted.first().v
        if (time >= sorted.last().t) return sorted.last().v
        for (i in 0 until sorted.size - 1) {
            val a = sorted[i]
            val b = sorted[i + 1]
            if (time >= a.t && time <= b.t) {
                val span = (b.t - a.t).takeIf { it > 1e-9 } ?: return b.v
                val f = ((time - a.t) / span).toFloat().coerceIn(0f, 1f)
                return a.v + (b.v - a.v) * a.ease.at(f)
            }
        }
        return sorted.last().v
    }

    fun keyAt(time: Double, tolerance: Double = .015): Keyframe? =
        keys.firstOrNull { Math.abs(it.t - time) <= tolerance }

    /** Adds or replaces the key at [time], keeping the list sorted. */
    fun setKey(time: Double, value: Float, ease: Ease = Ease.EaseInOut): Keyframe {
        keyAt(time)?.let { keys.remove(it) }
        val key = Keyframe(time, value, ease)
        keys.add(key)
        keys.sortBy { it.t }
        return key
    }

    fun copyOf(): Track = Track(base, keys.map { it.copy() }.toMutableList())
}

enum class LayerKind { IMAGE, VIDEO, SHAPE, TEXT, NULL, CAMERA, GROUP }

enum class ShapeKind { RECT, ELLIPSE, TRIANGLE }

/**
 * One layer.
 *
 * Properties are [Track]s rather than plain floats so animation is the same code path as a
 * static value: there is no "is it animated" branch in the renderer, only `valueAt`.
 */
class Layer(
    val id: String = UUID.randomUUID().toString(),
    var name: String,
    var kind: LayerKind,
    var start: Double = 0.0,
    var duration: Double = 5.0
) {
    var visible: Boolean = true
    var locked: Boolean = false

    var x = Track(0f)
    var y = Track(0f)
    var scaleX = Track(1f)
    var scaleY = Track(1f)
    var rotation = Track(0f)
    var opacity = Track(1f)

    // Shapes carry their own size and colour; media carries the source uri.
    var width: Float = 0f
    var height: Float = 0f
    var shape: ShapeKind = ShapeKind.RECT
    var color: Int = 0xFFFFFFFF.toInt()
    var cornerRadius: Float = 0f

    var text: String = ""
    var textSize: Float = 96f
    var textBold: Boolean = false

    var sourceUri: String? = null

    /** Volume 0..1 and playback speed, used by video and audio layers. */
    var volume: Float = 1f
    var speed: Float = 1f

    val animated: Boolean
        get() = listOf(x, y, scaleX, scaleY, rotation, opacity).any { it.animated }

    fun covers(time: Double): Boolean = time >= start && time <= start + duration

    fun copyOf(): Layer {
        val l = Layer(id = id, name = name, kind = kind, start = start, duration = duration)
        l.visible = visible; l.locked = locked
        l.x = x.copyOf(); l.y = y.copyOf()
        l.scaleX = scaleX.copyOf(); l.scaleY = scaleY.copyOf()
        l.rotation = rotation.copyOf(); l.opacity = opacity.copyOf()
        l.width = width; l.height = height; l.shape = shape; l.color = color
        l.cornerRadius = cornerRadius; l.text = text; l.textSize = textSize
        l.textBold = textBold; l.sourceUri = sourceUri
        l.volume = volume; l.speed = speed
        return l
    }

    /** Every track by name, for the graph editor and for serialisation. */
    fun tracks(): Map<String, Track> = linkedMapOf(
        "x" to x, "y" to y, "scaleX" to scaleX, "scaleY" to scaleY,
        "rotation" to rotation, "opacity" to opacity
    )
}

/** A composition: the canvas size, frame rate and the layers on it. */
class Project(
    var name: String = "Untitled",
    var width: Int = 1080,
    var height: Int = 1920,
    var fps: Int = 30,
    var duration: Double = 10.0,
    var background: Int = 0xFF000000.toInt()
) {
    /** Index 0 is the BACK of the stack; later elements draw on top. */
    val layers = mutableListOf<Layer>()

    fun layer(id: String?): Layer? = layers.firstOrNull { it.id == id }

    fun topMostAt(time: Double): Layer? =
        layers.lastOrNull { it.visible && it.covers(time) }

    /** How long the project must be to contain every layer. */
    fun contentDuration(): Double = layers.maxOfOrNull { it.start + it.duration } ?: 0.0

    fun copyOf(): Project {
        val p = Project(name, width, height, fps, duration, background)
        layers.forEach { p.layers.add(it.copyOf()) }
        return p
    }
}
