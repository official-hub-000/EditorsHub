package com.editorhub.engine

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The document and its history.
 *
 * Undo is a stack of whole compositions rather than a command log. A composition is immutable
 * data, so a snapshot is a pointer, and the comparison that a command log would need to keep
 * itself consistent simply does not exist here. The stack is capped: a long session must not
 * grow without bound.
 */
class EditorStore(private val context: Context) {

    var composition by mutableStateOf(Composition())
        private set

    var selectedLayerId by mutableStateOf<String?>(null)
    var playhead by mutableStateOf(0f)
    var playing by mutableStateOf(false)

    private val undoStack = ArrayDeque<Composition>()
    private val redoStack = ArrayDeque<Composition>()
    private val undoLimit = 60

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    fun edit(block: (Composition) -> Composition) {
        val next = block(composition)
        if (next == composition) return
        undoStack.addLast(composition)
        while (undoStack.size > undoLimit) undoStack.removeFirst()
        redoStack.clear()
        composition = next
    }

    fun undo() {
        val previous = undoStack.removeLastOrNull() ?: return
        redoStack.addLast(composition)
        composition = previous
    }

    fun redo() {
        val next = redoStack.removeLastOrNull() ?: return
        undoStack.addLast(composition)
        composition = next
    }

    /** Applies [block] to the layer with [id], leaving the rest of the document untouched. */
    fun editLayer(id: String, block: (Layer) -> Layer) = edit { comp ->
        comp.copy(layers = comp.layers.map { if (it.id == id) block(it) else it })
    }

    fun addLayer(layer: Layer) = edit { comp ->
        comp.copy(layers = comp.layers + layer).also { selectedLayerId = layer.id }
    }

    fun deleteLayer(id: String) = edit { comp ->
        comp.copy(layers = comp.layers.filterNot { it.id == id })
    }

    fun moveLayer(id: String, delta: Int) = edit { comp ->
        val index = comp.indexOf(id)
        if (index < 0) return@edit comp
        val target = (index + delta).coerceIn(0, comp.layers.lastIndex)
        if (target == index) return@edit comp
        val mutable = comp.layers.toMutableList()
        mutable.add(target, mutable.removeAt(index))
        comp.copy(layers = mutable)
    }

    fun setKeyframe(layerId: String, label: String, time: Float, value: Float, easing: Easing) =
        editLayer(layerId) { layer ->
            val channel = layer.transform.named(label) ?: return@editLayer layer
            layer.copy(transform = layer.transform.with(label, channel.withKey(time, value, easing)))
        }

    fun removeKeyframe(layerId: String, label: String, time: Float) =
        editLayer(layerId) { layer ->
            val channel = layer.transform.named(label) ?: return@editLayer layer
            layer.copy(transform = layer.transform.with(label, channel.withoutKey(time)))
        }

    // ---- persistence ----

    fun save(file: File) {
        file.writeText(encode(composition).toString())
    }

    fun open(file: File) {
        val parsed = decode(JSONObject(file.readText()))
        undoStack.clear()
        redoStack.clear()
        composition = parsed
    }

    private fun encode(comp: Composition): JSONObject = JSONObject().apply {
        put("v", 1)
        put("name", comp.name)
        put("width", comp.width)
        put("height", comp.height)
        put("fps", comp.frameRate)
        put("duration", comp.duration.toDouble())
        put("background", comp.background)
        put("layers", JSONArray().apply {
            comp.layers.forEach { layer -> put(encodeLayer(layer)) }
        })
    }

    private fun encodeLayer(layer: Layer): JSONObject = JSONObject().apply {
        put("id", layer.id)
        put("kind", layer.kind.name)
        put("name", layer.name)
        put("start", layer.start.toDouble())
        put("duration", layer.duration.toDouble())
        put("sourceStart", layer.sourceStart.toDouble())
        put("source", layer.source ?: JSONObject.NULL)
        put("blend", layer.blend.name)
        put("text", layer.text)
        put("fontSize", layer.fontSize.toDouble())
        put("textColor", layer.textColor)
        put("shape", layer.shape.name)
        put("fill", layer.fill)
        put("parent", layer.parentId ?: JSONObject.NULL)
        put("visible", layer.visible)
        put("locked", layer.locked)
        put("audible", layer.audible)
        put("volume", layer.volume.toDouble())
        put("transform", encodeTransform(layer.transform))
        put("effects", JSONArray().apply {
            layer.effects.forEach { fx ->
                put(JSONObject().apply {
                    put("id", fx.id)
                    put("kind", fx.kind.name)
                    put("enabled", fx.enabled)
                    put("amount", encodeChannel(fx.amount))
                })
            }
        })
    }

    private fun encodeTransform(t: Transform): JSONObject = JSONObject().apply {
        t.channels().forEach { (label, channel) -> put(label, encodeChannel(channel)) }
    }

    private fun encodeChannel(c: Channel): JSONObject = JSONObject().apply {
        put("value", c.valueAt(0f).toDouble())
        put("keys", JSONArray().apply {
            c.keys().forEach { k ->
                put(JSONObject().apply {
                    put("t", k.time.toDouble())
                    put("v", k.value.toDouble())
                    put("e", k.easing.name)
                })
            }
        })
    }

    private fun decode(json: JSONObject): Composition = Composition(
        name = json.optString("name", "Untitled"),
        width = json.optInt("width", 1080),
        height = json.optInt("height", 1920),
        frameRate = json.optInt("fps", 30),
        duration = json.optDouble("duration", 10.0).toFloat(),
        background = json.optInt("background", 0xFF000000.toInt()),
        layers = json.optJSONArray("layers").let { array ->
            if (array == null) emptyList() else (0 until array.length()).map { i ->
                decodeLayer(array.getJSONObject(i))
            }
        },
    )

    private fun decodeLayer(json: JSONObject): Layer = Layer(
        id = json.optString("id"),
        kind = runCatching { LayerKind.valueOf(json.optString("kind")) }.getOrDefault(LayerKind.IMAGE),
        name = json.optString("name"),
        start = json.optDouble("start", 0.0).toFloat(),
        duration = json.optDouble("duration", 3.0).toFloat(),
        sourceStart = json.optDouble("sourceStart", 0.0).toFloat(),
        source = json.optString("source").takeIf { it.isNotEmpty() && it != "null" },
        blend = runCatching { BlendMode.valueOf(json.optString("blend")) }.getOrDefault(BlendMode.NORMAL),
        text = json.optString("text"),
        fontSize = json.optDouble("fontSize", 0.12).toFloat(),
        textColor = json.optInt("textColor", -1),
        shape = runCatching { ShapeKind.valueOf(json.optString("shape")) }.getOrDefault(ShapeKind.RECT),
        fill = json.optInt("fill", 0xFF3AD9C6.toInt()),
        parentId = json.optString("parent").takeIf { it.isNotEmpty() && it != "null" },
        visible = json.optBoolean("visible", true),
        locked = json.optBoolean("locked", false),
        audible = json.optBoolean("audible", false),
        volume = json.optDouble("volume", 1.0).toFloat(),
        transform = decodeTransform(json.optJSONObject("transform")),
        effects = json.optJSONArray("effects").let { array ->
            if (array == null) emptyList() else (0 until array.length()).map { i ->
                val fx = array.getJSONObject(i)
                Effect(
                    id = fx.optString("id"),
                    kind = runCatching { EffectKind.valueOf(fx.optString("kind")) }
                        .getOrDefault(EffectKind.BLUR),
                    enabled = fx.optBoolean("enabled", true),
                    amount = decodeChannel(fx.optJSONObject("amount")),
                )
            }
        },
    )

    private fun decodeTransform(json: JSONObject?): Transform {
        if (json == null) return Transform()
        var t = Transform()
        t.channels().forEach { (label, _) ->
            json.optJSONObject(label)?.let { t = t.with(label, decodeChannel(it)) }
        }
        return t
    }

    private fun decodeChannel(json: JSONObject?): Channel {
        if (json == null) return Channel.static(0f)
        val fallback = json.optDouble("value", 0.0).toFloat()
        val keys = json.optJSONArray("keys") ?: return Channel.static(fallback)
        if (keys.length() == 0) return Channel.static(fallback)
        return Channel.animated((0 until keys.length()).map { i ->
            val k = keys.getJSONObject(i)
            Keyframe(
                time = k.optDouble("t", 0.0).toFloat(),
                value = k.optDouble("v", 0.0).toFloat(),
                easing = Easing.of(k.optString("e")),
            )
        })
    }
}
