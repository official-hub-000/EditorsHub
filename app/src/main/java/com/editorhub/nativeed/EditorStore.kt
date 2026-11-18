package com.editorhub.nativeed

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The document, the undo stack and every edit.
 *
 * All mutation goes through here so undo, autosave and the renderer's invalidation have one
 * owner. There is no per-widget state: the UI reads from [project] and calls these methods,
 * which is why an undo restores the whole picture rather than one control.
 */
class EditorStore(private val context: Context) {

    var project: Project = Project()
        private set

    var selectedLayerId: String? = null
        private set

    var time: Double = 0.0
        private set

    /**
     * Called after every mutation and after the playhead moves.
     *
     * The UI has exactly one subscription: recompose the panels and request one preview
     * frame. Nothing polls, and no widget owns a copy of a value, so an undo or a loaded
     * project cannot leave a stale slider behind.
     */
    var onChange: (() -> Unit)? = null

    private fun changed() { onChange?.invoke() }

    /** Disk writes are debounced: a drag is one write, not four hundred. */
    private val handler = Handler(Looper.getMainLooper())
    private val saveRunnable = Runnable { save() }

    // ------------------------------------------------------------------ undo

    private val undoStack = ArrayDeque<Project>()
    private val redoStack = ArrayDeque<Project>()
    private val maxUndo = 40

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    /** Snapshot before a mutation. Call once per user gesture, not per pointer move. */
    fun checkpoint() {
        undoStack.addLast(project.copyOf())
        if (undoStack.size > maxUndo) undoStack.removeFirst()
        redoStack.clear()
    }

    fun undo(): Boolean {
        val previous = undoStack.removeLastOrNull() ?: return false
        redoStack.addLast(project)
        project = previous
        if (project.layer(selectedLayerId) == null) selectedLayerId = null
        save()
        changed()
        return true
    }

    fun redo(): Boolean {
        val next = redoStack.removeLastOrNull() ?: return false
        undoStack.addLast(project)
        project = next
        if (project.layer(selectedLayerId) == null) selectedLayerId = null
        save()
        changed()
        return true
    }

    // --------------------------------------------------------------- project

    fun newProject(width: Int, height: Int, fps: Int, duration: Double, name: String = "Untitled") {
        undoStack.clear(); redoStack.clear()
        project = Project(name, width, height, fps, duration)
        selectedLayerId = null
        time = 0.0
        save()
        changed()
    }

    /**
     * Moves the playhead.
     *
     * Deliberately does NOT fire [onChange]: during playback this is called once per frame
     * and recomposing the timeline and inspector sixty times a second is precisely the jank
     * this rewrite exists to remove. [onTimeChange] is the cheap path (redraw the preview,
     * slide the playhead); panels read the time when they need it.
     */
    /** True once a project has been loaded from disk (or a new one created). */
    var loaded: Boolean = false
        private set

    /**
     * Reads the saved project, or starts an empty one.
     *
     * Called once, by the Activity, so that a process death restores the work and a first
     * launch does not open onto a blank screen with no layers and no way to see what to do.
     */
    fun bootstrap() {
        if (loaded) return
        val restored = load()
        loaded = true
        if (!restored) {
            newProject(1080, 1920, 30, 10.0)
            seedStarterProject()
        }
    }

    /**
     * A first-run composition.
     *
     * A title card and a background, already keyframed, so the timeline is not empty, the
     * playhead has something to scrub, and the ease panel has a segment to shape. An empty
     * editor teaches nothing; this shows what the app does in one press of Play.
     */
    private fun seedStarterProject() {
        // Named canvasW/canvasH rather than width/height: inside the `apply` blocks below a
        // local called `width` would shadow the Layer's own `width` property, and the compiler
        // would then be trying to assign a Float to an Int.
        val canvasW = project.width
        val canvasH = project.height
        project.duration = 6.0
        addShape(ShapeKind.RECT).apply {
            name = "Background"
            width = canvasW.toFloat()
            height = canvasH.toFloat()
            x = Track(canvasW / 2f)
            y = Track(canvasH / 2f)
            color = 0xFF12171D.toInt()
            cornerRadius = 0f
            duration = 6.0
        }
        addText("EditorsHub").apply {
            textSize = canvasH * .09f
            textBold = true
            duration = 6.0
            // A real animation: scale up and fade in, so the first Play does something.
            scaleX = Track(1f, mutableListOf(
                Keyframe(0.0, .6f, Ease.Overshoot),
                Keyframe(1.0, 1f, Ease.Linear)
            ))
            scaleY = Track(1f, mutableListOf(
                Keyframe(0.0, .6f, Ease.Overshoot),
                Keyframe(1.0, 1f, Ease.Linear)
            ))
            opacity = Track(1f, mutableListOf(
                Keyframe(0.0, 0f, Ease.EaseOut),
                Keyframe(.8, 1f, Ease.Linear)
            ))
        }
        select(null)
        save()
        changed()
    }

    fun setTime(t: Double) {
        time = t.coerceIn(0.0, project.duration)
        onTimeChange?.invoke(time)
    }

    /** Cheap per-frame subscription. */
    var onTimeChange: ((Double) -> Unit)? = null

    fun select(id: String?) {
        if (id == selectedLayerId) return
        selectedLayerId = id
        changed()
    }

    val selected: Layer? get() = project.layer(selectedLayerId)

    // ---------------------------------------------------------------- layers

    fun addLayer(layer: Layer): Layer {
        checkpoint()
        project.layers.add(layer)
        selectedLayerId = layer.id
        touchDuration()
        save()
        changed()
        return layer
    }

    fun addShape(shape: ShapeKind = ShapeKind.RECT) = addLayer(
        Layer(name = shape.name.lowercase().replaceFirstChar { it.uppercase() }, kind = LayerKind.SHAPE).apply {
            width = project.width * .5f
            height = project.width * .5f
            x = Track(project.width / 2f)
            y = Track(project.height / 2f)
            this.shape = shape
            color = 0xFF3AD9C6.toInt()
            duration = project.duration
        }
    )

    fun addText(text: String = "Text") = addLayer(
        Layer(name = "Text", kind = LayerKind.TEXT).apply {
            this.text = text
            x = Track(project.width / 2f)
            y = Track(project.height / 2f)
            textSize = project.height * .07f
            duration = project.duration
        }
    )

    fun addMedia(uri: Uri, kind: LayerKind, displayName: String, width: Int, height: Int) = addLayer(
        Layer(name = displayName, kind = kind).apply {
            sourceUri = uri.toString()
            this.width = width.toFloat()
            this.height = height.toFloat()
            // Fit inside the composition without cropping, centred.
            val fit = minOf(project.width.toFloat() / maxOf(1, width), project.height.toFloat() / maxOf(1, height))
            x = Track(project.width / 2f)
            y = Track(project.height / 2f)
            scaleX = Track(fit)
            scaleY = Track(fit)
            duration = if (kind == LayerKind.IMAGE) project.duration else 5.0
        }
    )

    fun addNull() = addLayer(
        Layer(name = "Null", kind = LayerKind.NULL).apply {
            x = Track(project.width / 2f)
            y = Track(project.height / 2f)
            width = 80f; height = 80f
            duration = project.duration
        }
    )

    fun deleteLayer(id: String?) {
        val layer = project.layer(id) ?: return
        checkpoint()
        project.layers.remove(layer)
        if (selectedLayerId == id) selectedLayerId = null
        save()
        changed()
    }

    fun duplicateLayer(id: String?) {
        val layer = project.layer(id) ?: return
        checkpoint()
        val copy = layer.copyOf().also { it.name = layer.name + " copy" }
        val index = project.layers.indexOf(layer)
        project.layers.add(index + 1, copy)
        selectedLayerId = copy.id
        save()
        changed()
    }

    fun renameLayer(id: String?, name: String) {
        val layer = project.layer(id) ?: return
        checkpoint()
        layer.name = name.ifBlank { "Layer" }
        save()
        changed()
    }

    /** Moves a layer within the stack. [delta] is +1 towards the front. */
    fun reorder(id: String?, delta: Int) {
        val layer = project.layer(id) ?: return
        val from = project.layers.indexOf(layer)
        val to = (from + delta).coerceIn(0, project.layers.size - 1)
        if (from == to) return
        checkpoint()
        project.layers.removeAt(from)
        project.layers.add(to, layer)
        save()
        changed()
    }

    // ------------------------------------------------------------- transforms

    fun setValue(layer: Layer, track: String, value: Float) {
        val t = layer.tracks()[track] ?: return
        // A property that is animated records a keyframe at the playhead; a static one just
        // changes. This is the same rule every timeline editor uses, and it means dragging a
        // slider on an animated layer does not silently flatten the animation.
        if (t.animated) t.setKey(time, value) else {
            replaceTrack(layer, track, Track(value, t.keys))
        }
        scheduleSave()
        changed()
    }

    fun toggleKeyframe(layer: Layer, track: String) {
        val t = layer.tracks()[track] ?: return
        val existing = t.keyAt(time)
        if (existing != null) t.keys.remove(existing) else t.setKey(time, t.valueAt(time))
        save()
        changed()
    }

    fun setEase(layer: Layer, track: String, ease: Ease, atTime: Double = time) {
        val t = layer.tracks()[track] ?: return
        val segStart = t.keys.sortedBy { it.t }.lastOrNull { it.t <= atTime + 1e-6 } ?: return
        val index = t.keys.indexOf(segStart)
        t.keys[index] = segStart.copy(ease = ease)
        scheduleSave()
        changed()
    }

    // ------------------------------------------------------------ navigation

    /**
     * Every keyframe time on the canvas, sorted.
     *
     * The playhead jumps between these, which is how you inspect an animation: place a key,
     * shape it, jump to the next one. Distinct because several properties usually share a
     * key time and the user wants one stop there, not six.
     */
    fun keyTimes(): List<Double> =
        project.layers.flatMap { layer -> layer.tracks().values.flatMap { it.keys.map { k -> k.t } } }
            .distinct().sorted()

    /** Moves the playhead to the next keyframe after the current time, if any. */
    fun nextKeyframe(): Double? = keyTimes().firstOrNull { it > time + 1e-4 }?.also { setTime(it) }

    /** Moves the playhead to the previous keyframe before the current time, if any. */
    fun previousKeyframe(): Double? = keyTimes().lastOrNull { it < time - 1e-4 }?.also { setTime(it) }

    // ------------------------------------------------------------- clipboard

    private var clipboard: Layer? = null

    fun copySelected() {
        clipboard = selected?.copyOf()
    }

    val canPaste: Boolean get() = clipboard != null

    /** Pastes the copied layer on top, nudged so it is visibly a second copy. */
    fun paste(): Layer? {
        val source = clipboard ?: return null
        checkpoint()
        val copy = source.copyOf()
        // A fresh id, or the two layers would collide in every map keyed by id.
        val pasted = Layer(name = copy.name + " copy", kind = copy.kind).also { fresh ->
            fresh.start = copy.start
            fresh.duration = copy.duration
            fresh.visible = copy.visible
            fresh.x = copy.x.copyOf(); fresh.y = copy.y.copyOf()
            fresh.scaleX = copy.scaleX.copyOf(); fresh.scaleY = copy.scaleY.copyOf()
            fresh.rotation = copy.rotation.copyOf(); fresh.opacity = copy.opacity.copyOf()
            fresh.width = copy.width; fresh.height = copy.height
            fresh.shape = copy.shape; fresh.color = copy.color; fresh.cornerRadius = copy.cornerRadius
            fresh.text = copy.text; fresh.textSize = copy.textSize; fresh.textBold = copy.textBold
            fresh.sourceUri = copy.sourceUri
            fresh.volume = copy.volume; fresh.speed = copy.speed
            fresh.brightness = copy.brightness; fresh.contrast = copy.contrast
            fresh.saturation = copy.saturation; fresh.vibrance = copy.vibrance
            fresh.tint = copy.tint; fresh.tintAmount = copy.tintAmount
            fresh.blur = copy.blur; fresh.blendMode = copy.blendMode
            fresh.x.setKey(time, fresh.x.valueAt(time))
        }
        project.layers.add(pasted)
        selectedLayerId = pasted.id
        touchDuration()
        save()
        changed()
        return pasted
    }

    private fun replaceTrack(layer: Layer, name: String, track: Track) {
        when (name) {
            "x" -> layer.x = track
            "y" -> layer.y = track
            "scaleX" -> layer.scaleX = track
            "scaleY" -> layer.scaleY = track
            "rotation" -> layer.rotation = track
            "opacity" -> layer.opacity = track
        }
    }

    // --------------------------------------------------------------- persist

    private val file: File get() = File(context.filesDir, "native-project.json")

    fun save() {
        handler.removeCallbacks(saveRunnable)
        runCatching { file.writeText(serialise(project).toString()) }
    }

    /** Coalesces rapid edits (drags, sliders) into one write half a second later. */
    fun scheduleSave() {
        handler.removeCallbacks(saveRunnable)
        handler.postDelayed(saveRunnable, 500)
    }

    fun load(): Boolean = runCatching {
        if (!file.exists()) return false
        project = deserialise(JSONObject(file.readText()))
        selectedLayerId = null
        time = 0.0
        changed()
        true
    }.getOrDefault(false)

    private fun touchDuration() {
        val content = project.contentDuration()
        if (content > project.duration) project.duration = content
    }

    // ---------------------------------------------------------- file exchange

    /** The document as the exact text a `.editorshub` project file holds. */
    fun exportJson(): String = serialise(project).toString(2)

    /**
     * Replaces the document with one read from a file.
     *
     * Undoable: an import that turns out to be the wrong file is one tap from gone. Returns
     * false when the text is not a project this build understands, and leaves the current
     * document untouched in that case.
     */
    fun importJson(text: String): Boolean = runCatching {
        val parsed = deserialise(JSONObject(text))
        if (parsed.layers.isEmpty() && parsed.width <= 0) return false
        checkpoint()
        project = parsed
        selectedLayerId = null
        time = 0.0
        save()
        changed()
        true
    }.getOrDefault(false)

    // ------------------------------------------------------------- JSON form

    companion object {
        /**
         * The saved form.
         *
         * Written as plain JSON with no version-specific tricks so a project opened by an
         * older build still loads: unknown keys are ignored and missing tracks fall back to
         * their defaults.
         */
        fun serialise(project: Project): JSONObject = JSONObject().apply {
            put("format", "editorshub-native-1")
            put("name", project.name)
            put("width", project.width)
            put("height", project.height)
            put("fps", project.fps)
            put("duration", project.duration)
            put("background", project.background)
            put("layers", JSONArray().also { out ->
                project.layers.forEach { l ->
                    out.put(JSONObject().apply {
                        put("id", l.id); put("name", l.name); put("kind", l.kind.name)
                        put("start", l.start); put("duration", l.duration)
                        put("visible", l.visible); put("locked", l.locked)
                        put("width", l.width); put("height", l.height)
                        put("shape", l.shape.name); put("color", l.color)
                        put("cornerRadius", l.cornerRadius)
                        put("text", l.text); put("textSize", l.textSize); put("textBold", l.textBold)
                        put("source", l.sourceUri ?: JSONObject.NULL)
                        put("volume", l.volume); put("speed", l.speed)
                        put("brightness", l.brightness); put("contrast", l.contrast)
                        put("saturation", l.saturation); put("vibrance", l.vibrance)
                        put("tint", l.tint); put("tintAmount", l.tintAmount)
                        put("blur", l.blur); put("blend", l.blendMode.name)
                        put("tracks", JSONObject().also { tracks ->
                            l.tracks().forEach { (name, t) ->
                                tracks.put(name, JSONObject().apply {
                                    put("base", t.base)
                                    put("keys", JSONArray().also { arr ->
                                        t.keys.sortedBy { it.t }.forEach { k ->
                                            arr.put(JSONObject().apply {
                                                put("t", k.t); put("v", k.v)
                                                put("ease", JSONObject().apply {
                                                    put("kind", k.ease.kind.name)
                                                    put("x1", k.ease.x1); put("y1", k.ease.y1)
                                                    put("x2", k.ease.x2); put("y2", k.ease.y2)
                                                    put("stiffness", k.ease.stiffness)
                                                    put("damping", k.ease.damping)
                                                })
                                            })
                                        }
                                    })
                                })
                            }
                        })
                    })
                }
            })
        }

        fun deserialise(json: JSONObject): Project {
            val p = Project(
                name = json.optString("name", "Untitled"),
                width = json.optInt("width", 1080),
                height = json.optInt("height", 1920),
                fps = json.optInt("fps", 30),
                duration = json.optDouble("duration", 10.0),
                background = json.optInt("background", 0xFF000000.toInt())
            )
            val layers = json.optJSONArray("layers") ?: JSONArray()
            for (i in 0 until layers.length()) {
                val o = layers.optJSONObject(i) ?: continue
                val layer = Layer(
                    id = o.optString("id"),
                    name = o.optString("name", "Layer"),
                    kind = runCatching { LayerKind.valueOf(o.optString("kind")) }.getOrDefault(LayerKind.SHAPE),
                    start = o.optDouble("start", 0.0),
                    duration = o.optDouble("duration", 5.0)
                )
                layer.visible = o.optBoolean("visible", true)
                layer.locked = o.optBoolean("locked", false)
                layer.width = o.optDouble("width", 0.0).toFloat()
                layer.height = o.optDouble("height", 0.0).toFloat()
                layer.shape = runCatching { ShapeKind.valueOf(o.optString("shape")) }.getOrDefault(ShapeKind.RECT)
                layer.color = o.optInt("color", 0xFFFFFFFF.toInt())
                layer.cornerRadius = o.optDouble("cornerRadius", 0.0).toFloat()
                layer.text = o.optString("text", "")
                layer.textSize = o.optDouble("textSize", 96.0).toFloat()
                layer.textBold = o.optBoolean("textBold", false)
                layer.sourceUri = if (o.isNull("source")) null else o.optString("source")
                layer.volume = o.optDouble("volume", 1.0).toFloat()
                layer.speed = o.optDouble("speed", 1.0).toFloat()
                layer.brightness = o.optDouble("brightness", 0.0).toFloat()
                layer.contrast = o.optDouble("contrast", 1.0).toFloat()
                layer.saturation = o.optDouble("saturation", 1.0).toFloat()
                layer.vibrance = o.optDouble("vibrance", 0.0).toFloat()
                layer.tint = o.optInt("tint", 0x00FFFFFF)
                layer.tintAmount = o.optDouble("tintAmount", 0.0).toFloat()
                layer.blur = o.optDouble("blur", 0.0).toFloat()
                layer.blendMode = runCatching { BlendMode.valueOf(o.optString("blend")) }
                    .getOrDefault(BlendMode.NORMAL)
                val tracks = o.optJSONObject("tracks")
                tracks?.keys()?.forEach { name ->
                    val to = tracks.optJSONObject(name) ?: return@forEach
                    val track = Track(to.optDouble("base", 0.0).toFloat())
                    val keys = to.optJSONArray("keys") ?: JSONArray()
                    for (k in 0 until keys.length()) {
                        val ko = keys.optJSONObject(k) ?: continue
                        val eo = ko.optJSONObject("ease")
                        val ease = if (eo == null) Ease.Linear else Ease(
                            kind = runCatching { EaseKind.valueOf(eo.optString("kind")) }.getOrDefault(EaseKind.LINEAR),
                            x1 = eo.optDouble("x1", 0.0).toFloat(),
                            y1 = eo.optDouble("y1", 0.0).toFloat(),
                            x2 = eo.optDouble("x2", 1.0).toFloat(),
                            y2 = eo.optDouble("y2", 1.0).toFloat(),
                            stiffness = eo.optDouble("stiffness", 130.0).toFloat(),
                            damping = eo.optDouble("damping", 13.0).toFloat()
                        )
                        track.keys.add(Keyframe(ko.optDouble("t"), ko.optDouble("v").toFloat(), ease))
                    }
                    when (name) {
                        "x" -> layer.x = track
                        "y" -> layer.y = track
                        "scaleX" -> layer.scaleX = track
                        "scaleY" -> layer.scaleY = track
                        "rotation" -> layer.rotation = track
                        "opacity" -> layer.opacity = track
                    }
                }
                p.layers.add(layer)
            }
            return p
        }
    }
}
