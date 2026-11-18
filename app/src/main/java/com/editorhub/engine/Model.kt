package com.editorhub.engine

import java.util.UUID

/** What a layer draws. */
enum class LayerKind(val label: String) {
    IMAGE("Image"),
    VIDEO("Video"),
    AUDIO("Audio"),
    SHAPE("Shape"),
    TEXT("Text"),
    NULL("Null"),
    ADJUSTMENT("Adjustment"),
}

enum class ShapeKind(val label: String) {
    RECT("Rectangle"), ELLIPSE("Ellipse"), TRIANGLE("Triangle"), STAR("Star");
}

/** How a layer's pixels combine with the layers under it. Matches the GPU blend equations. */
enum class BlendMode(val label: String) {
    NORMAL("Normal"),
    ADD("Add"),
    MULTIPLY("Multiply"),
    SCREEN("Screen"),
    OVERLAY("Overlay"),
    DIFFERENCE("Difference"),
    LIGHTEN("Lighten"),
    DARKEN("Darken"),
}

/**
 * The effect catalogue.
 *
 * [id] is the shader program's name; every entry here has a matching fragment shader and an
 * `amount` uniform in 0..1, so adding an effect is a shader plus one enum case and nothing else.
 */
enum class EffectKind(val label: String) {
    BLUR("Blur"),
    SHARPEN("Sharpen"),
    GLOW("Glow"),
    VIGNETTE("Vignette"),
    PIXELATE("Pixelate"),
    INVERT("Invert"),
    GRAIN("Grain"),
    CHROMA_KEY("Chroma Key"),
    POSTERIZE("Posterize"),
    HALFTONE("Halftone"),
    RGB_SPLIT("RGB Split"),
    SATURATION("Saturation"),
    BRIGHTNESS("Brightness"),
    CONTRAST("Contrast"),
}

/** One effect instance, keyed by the property path so it can be animated like anything else. */
data class Effect(
    val id: String = UUID.randomUUID().toString(),
    val kind: EffectKind,
    val amount: Channel = Channel.static(DEFAULTS[kind] ?: .5f),
    val enabled: Boolean = true,
) {
    companion object {
        /** A neutral-looking starting value per effect, so a freshly added effect does something. */
        val DEFAULTS = mapOf(
            EffectKind.BLUR to .35f, EffectKind.SHARPEN to .3f, EffectKind.GLOW to .5f,
            EffectKind.VIGNETTE to .6f, EffectKind.PIXELATE to .3f, EffectKind.INVERT to 1f,
            EffectKind.GRAIN to .3f, EffectKind.CHROMA_KEY to .4f, EffectKind.POSTERIZE to .5f,
            EffectKind.HALFTONE to .5f, EffectKind.RGB_SPLIT to .4f, EffectKind.SATURATION to .5f,
            EffectKind.BRIGHTNESS to .5f, EffectKind.CONTRAST to .5f,
        )
    }
}

/**
 * Transform, opacity and grade: the properties that animate on every layer.
 *
 * Kept as one object rather than three so a snapshot for the GPU uniform block is one read.
 */
data class Transform(
    val positionX: Channel = Channel.static(0.5f),
    val positionY: Channel = Channel.static(0.5f),
    val scaleX: Channel = Channel.static(1f),
    val scaleY: Channel = Channel.static(1f),
    /** Degrees, clockwise. */
    val rotation: Channel = Channel.static(0f),
    val anchorX: Channel = Channel.static(0.5f),
    val anchorY: Channel = Channel.static(0.5f),
    val opacity: Channel = Channel.static(1f),
    val brightness: Channel = Channel.static(0f),
    val contrast: Channel = Channel.static(0f),
    val saturation: Channel = Channel.static(0f),
    val hue: Channel = Channel.static(0f),
) {
    /** Everything that can be keyframed, by the label the inspector shows. */
    fun channels(): List<Pair<String, Channel>> = listOf(
        "Position X" to positionX, "Position Y" to positionY,
        "Scale X" to scaleX, "Scale Y" to scaleY,
        "Rotation" to rotation,
        "Opacity" to opacity,
        "Brightness" to brightness, "Contrast" to contrast,
        "Saturation" to saturation, "Hue" to hue,
    )

    fun named(label: String): Channel? = channels().firstOrNull { it.first == label }?.second

    fun with(label: String, channel: Channel): Transform = when (label) {
        "Position X" -> copy(positionX = channel)
        "Position Y" -> copy(positionY = channel)
        "Scale X" -> copy(scaleX = channel)
        "Scale Y" -> copy(scaleY = channel)
        "Rotation" -> copy(rotation = channel)
        "Opacity" -> copy(opacity = channel)
        "Brightness" -> copy(brightness = channel)
        "Contrast" -> copy(contrast = channel)
        "Saturation" -> copy(saturation = channel)
        "Hue" -> copy(hue = channel)
        else -> this
    }

    /**
     * Default ranges, so the inspector's sliders and the graph editor agree. Position is in
     * normalised composition space, opacity 0..1, rotation in degrees.
     */
    fun rangeOf(label: String): ClosedFloatingPointRange<Float> = when (label) {
        "Position X", "Position Y" -> -1f..2f
        "Scale X", "Scale Y" -> 0f..4f
        "Rotation" -> -720f..720f
        "Opacity" -> 0f..1f
        "Hue" -> -180f..180f
        else -> -1f..1f
    }
}

/**
 * A layer. [start] and [duration] place it on the timeline in composition seconds; [sourceStart]
 * is where playback begins inside the media, which is what makes trimming non-destructive.
 */
data class Layer(
    val id: String = UUID.randomUUID().toString(),
    val kind: LayerKind,
    val name: String,
    val start: Float = 0f,
    val duration: Float = 3f,
    val sourceStart: Float = 0f,
    /** Media path for image/video/audio layers, resolved through [MediaResolver]. */
    val source: String? = null,
    val transform: Transform = Transform(),
    val effects: List<Effect> = emptyList(),
    val blend: BlendMode = BlendMode.NORMAL,
    /** Text layers. */
    val text: String = "",
    val fontSize: Float = 0.12f,
    val textColor: Int = -1,
    /** Shape layers. */
    val shape: ShapeKind = ShapeKind.RECT,
    val fill: Int = 0xFF3AD9C6.toInt(),
    /** A parent layer's transform is composed before this one's. */
    val parentId: String? = null,
    val visible: Boolean = true,
    val locked: Boolean = false,
    /** True when the layer has an audio track that should be mixed into playback. */
    val audible: Boolean = false,
    val volume: Float = 1f,
) {
    val end: Float get() = start + duration

    fun isActiveAt(time: Float): Boolean = visible && time >= start && time < end

    /** Composition time -> time inside the source media. */
    fun sourceTimeAt(time: Float): Float = sourceStart + (time - start).coerceAtLeast(0f)
}

/** The document: composition settings and layers, ordered bottom to top. */
data class Composition(
    val name: String = "Untitled",
    val width: Int = 1080,
    val height: Int = 1920,
    val frameRate: Int = 30,
    val duration: Float = 10f,
    val background: Int = 0xFF000000.toInt(),
    val layers: List<Layer> = emptyList(),
) {
    /** Layers that need drawing at [time], bottom first, with parents resolved. */
    fun activeLayers(time: Float): List<Layer> = layers.filter { it.isActiveAt(time) }

    fun layer(id: String?): Layer? = layers.firstOrNull { it.id == id }

    fun indexOf(id: String): Int = layers.indexOfFirst { it.id == id }

    /**
     * World transform for a layer, composing its parent chain.
     *
     * A cycle would loop forever; the depth cap is the guard, and it is far above any real rig.
     */
    fun parentChain(layer: Layer): List<Layer> {
        val out = ArrayList<Layer>()
        var current = layer.parentId
        var guard = 0
        while (current != null && guard++ < 32) {
            val parent = layer(current) ?: break
            out.add(parent)
            current = parent.parentId
        }
        return out
    }
}
