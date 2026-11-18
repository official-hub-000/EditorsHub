package com.editorhub.nativeed.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.editorhub.nativeed.BlendMode
import com.editorhub.nativeed.Ease
import com.editorhub.nativeed.BlendMode
import com.editorhub.nativeed.EaseKind
import com.editorhub.nativeed.EditorStore
import com.editorhub.nativeed.Layer
import com.editorhub.nativeed.LayerKind
import com.editorhub.nativeed.ShapeKind
import kotlin.math.abs

/** The properties the inspector can animate, in display order. */
private val transformProps = listOf(
    "x" to "Position X",
    "y" to "Position Y",
    "scaleX" to "Scale X",
    "scaleY" to "Scale Y",
    "rotation" to "Rotation",
    "opacity" to "Opacity"
)

/** Every slider in this file reports continuously and takes one checkpoint per gesture. */
@Composable
private fun LiveSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    store: EditorStore,
    format: (Float) -> String = { it.toInt().toString() },
    resetTo: Float? = null,
    onGestureStart: () -> Unit,
    onGestureEnd: () -> Unit,
    onChange: (Float) -> Unit
) {
    ValueSlider(
        label = label,
        value = value,
        range = range,
        format = format,
        resetTo = resetTo,
        onStart = { store.checkpoint(); onGestureStart() },
        onEnd = onGestureEnd,
        onChange = onChange
    )
}

/**
 * The inspector.
 *
 * Three tabs, the same three the web build ended up with after tuning: Transform (values and
 * their keyframe toggles), Style (colour, radius, text, media, timing) and Ease (the preset
 * rail plus the bezier graph).
 *
 * Nothing here holds document state. Every control reads through [EditorStore] and writes
 * back through it, which is why undo works from any tab and why the graph and the sliders can
 * never disagree.
 */
@Composable
fun Inspector(
    store: EditorStore,
    modifier: Modifier = Modifier,
    /** Bumped by the store on every edit; forces the controls to re-read their values. */
    version: Int = 0,
    onPickMedia: () -> Unit = {},
    onGestureStart: () -> Unit = {},
    onGestureEnd: () -> Unit = {}
) {
    var tab by remember { mutableStateOf(0) }
    val tabs = listOf("Transform", "Style", "Ease")
    @Suppress("UNUSED_EXPRESSION")
    version
    val layer = store.selected

    Column(modifier.background(Ink.panel)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Gap.md, vertical = Gap.sm)) {
            tabs.forEachIndexed { index, label ->
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 34.dp)
                        .clip(Corners.pill)
                        .background(if (tab == index) Ink.panelHigh else Color.Transparent)
                        .clickable { tab = index },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        label,
                        color = if (tab == index) Ink.text else Ink.dim,
                        fontSize = 12.sp,
                        fontWeight = if (tab == index) FontWeight.SemiBold else FontWeight.Normal
                    )
                }
            }
        }
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        if (layer == null) {
            EmptyInspector(onPickMedia)
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(Gap.md)
            ) {
                when (tab) {
                    0 -> TransformTab(store, layer, onGestureStart, onGestureEnd)
                    1 -> StyleTab(store, layer, onGestureStart, onGestureEnd)
                    else -> EaseTab(store, layer, onGestureStart, onGestureEnd)
                }
                // Room to scroll past the last control, and to clear the keyboard.
                Spacer(Modifier.height(Gap.xl))
            }
        }
    }
}

@Composable
private fun EmptyInspector(onPickMedia: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(Gap.lg)) {
        Text("Nothing selected", color = Ink.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(Gap.xs))
        Text(
            "Tap a layer in the timeline or on the canvas. Layers you add appear in the timeline and can be dragged, scaled, rotated and keyframed.",
            color = Ink.dim,
            fontSize = 12.sp
        )
        Spacer(Modifier.height(Gap.md))
        Pill("Import media", active = true, onClick = onPickMedia)
    }
}

// ------------------------------------------------------------------ transform

@Composable
private fun TransformTab(store: EditorStore, layer: Layer, gestureStart: () -> Unit, gestureEnd: () -> Unit) {
    var tick by remember { mutableStateOf(0) }
    @Suppress("UNUSED_EXPRESSION") tick

    var editing by remember { mutableStateOf(false) }
    if (editing) {
        OutlinedTextField(
            value = layer.name,
            onValueChange = { store.renameLayer(layer.id, it) },
            singleLine = true,
            label = { Text("Name") },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(Gap.sm))
        Pill("Done") { editing = false }
    } else {
        Row(
            Modifier.fillMaxWidth().heightIn(min = TapTarget).clickable { editing = true },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(layer.name, color = Ink.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text("rename", color = Ink.accent, fontSize = 11.sp)
        }
    }

    Spacer(Modifier.height(Gap.sm))

    transformProps.forEach { (key, label) ->
        val track = layer.tracks()[key] ?: return@forEach
        val value = track.valueAt(store.time)
        val range = when (key) {
            "x" -> -store.project.width.toFloat()..(store.project.width * 2f)
            "y" -> -store.project.height.toFloat()..(store.project.height * 2f)
            "rotation" -> -360f..360f
            "opacity" -> 0f..1f
            else -> 0f..4f
        }
        val reset = when (key) {
            "scaleX", "scaleY", "opacity" -> 1f
            else -> 0f
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                LiveSlider(
                    label = label,
                    value = value,
                    range = range,
                    store = store,
                    resetTo = reset,
                    format = { v ->
                        when (key) {
                            "opacity" -> "${(v * 100).toInt()}%"
                            "rotation" -> "${v.toInt()}\u00B0"
                            "scaleX", "scaleY" -> String.format("%.2f", v)
                            else -> v.toInt().toString()
                        }
                    },
                    onGestureStart = gestureStart,
                    onGestureEnd = gestureEnd,
                    onChange = { store.setValue(layer, key, it); tick++ }
                )
            }
            KeyframeButton(
                animated = track.keys.size >= 2,
                onKey = track.keyAt(store.time) != null,
                onToggle = { store.toggleKeyframe(layer, key) }
            )
        }
    }

    if (layer.kind == LayerKind.TEXT) {
        Spacer(Modifier.height(Gap.sm))
        OutlinedTextField(
            value = layer.text,
            onValueChange = {
                layer.text = it
                store.scheduleSave()
                store.onChange?.invoke()
                tick++
            },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
            label = { Text("Text") }
        )
    }

    Spacer(Modifier.height(Gap.md))
    Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
        Pill("Duplicate") { store.duplicateLayer(layer.id) }
        Pill("Front") { store.reorder(layer.id, 1) }
        Pill("Back") { store.reorder(layer.id, -1) }
        Pill("Delete") { store.deleteLayer(layer.id) }
    }
}

/** The diamond that shows whether a property is animated and toggles a key at the playhead. */
@Composable
private fun KeyframeButton(animated: Boolean, onKey: Boolean, onToggle: () -> Unit) {
    Box(
        Modifier
            .size(TapTarget)
            .clickable { onToggle() },
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.size(18.dp)) {
            val r = size.minDimension / 2f
            val path = Path().apply {
                moveTo(size.width / 2f, size.height / 2f - r)
                lineTo(size.width / 2f + r, size.height / 2f)
                lineTo(size.width / 2f, size.height / 2f + r)
                lineTo(size.width / 2f - r, size.height / 2f)
                close()
            }
            when {
                onKey -> drawPath(path, Ink.key)
                animated -> drawPath(path, Ink.key, style = Stroke(2f))
                else -> drawPath(path, Ink.dim, style = Stroke(1.5f))
            }
        }
    }
}

// ---------------------------------------------------------------------- style

@Composable
private fun StyleTab(store: EditorStore, layer: Layer, gestureStart: () -> Unit, gestureEnd: () -> Unit) {
    var tick by remember { mutableStateOf(0) }
    @Suppress("UNUSED_EXPRESSION") tick

    if (layer.kind == LayerKind.SHAPE) {
        SectionLabel("Shape")
        Spacer(Modifier.height(Gap.sm))
        Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
            ShapeKind.values().forEach { kind ->
                Pill(kind.name.lowercase().replaceFirstChar { it.uppercase() }, active = layer.shape == kind) {
                    layer.shape = kind; store.scheduleSave(); store.onChange?.invoke(); tick++
                }
            }
        }
        Spacer(Modifier.height(Gap.sm))
        LiveSlider(
            label = "Width", value = layer.width, range = 1f..store.project.width.toFloat(),
            store = store, onGestureStart = gestureStart, onGestureEnd = gestureEnd,
            onChange = { layer.width = it; layer.height = if (layer.shape == ShapeKind.ELLIPSE) it else layer.height; store.scheduleSave(); tick++ }
        )
    }

    if (layer.kind == LayerKind.SHAPE || layer.kind == LayerKind.TEXT) {
        Spacer(Modifier.height(Gap.md))
        SectionLabel("Colour")
        Spacer(Modifier.height(Gap.sm))
        SwatchRow(current = layer.color) { picked ->
            layer.color = picked; store.scheduleSave(); store.onChange?.invoke(); tick++
        }
        Spacer(Modifier.height(Gap.sm))
        LiveSlider(
            label = "Corner radius", value = layer.cornerRadius, range = 0f..(layer.width / 2f).coerceAtLeast(1f),
            store = store, onGestureStart = gestureStart, onGestureEnd = gestureEnd,
            onChange = { layer.cornerRadius = it; store.scheduleSave(); tick++ }
        )
    }

    if (layer.kind == LayerKind.TEXT) {
        Spacer(Modifier.height(Gap.sm))
        LiveSlider(
            label = "Size", value = layer.textSize, range = 12f..400f,
            store = store, onGestureStart = gestureStart, onGestureEnd = gestureEnd,
            onChange = { layer.textSize = it; store.scheduleSave(); tick++ }
        )
        ToggleRow("Bold", layer.textBold) {
            layer.textBold = it; store.scheduleSave(); store.onChange?.invoke(); tick++
        }
    }

    if (layer.kind == LayerKind.IMAGE || layer.kind == LayerKind.VIDEO) {
        Spacer(Modifier.height(Gap.md))
        SectionLabel("Media")
        Text(
            layer.sourceUri?.substringAfterLast('/') ?: "no source",
            color = Ink.dim, fontSize = 11.sp, modifier = Modifier.padding(top = Gap.xs)
        )
        if (layer.kind == LayerKind.VIDEO) {
            Spacer(Modifier.height(Gap.sm))
            LiveSlider(
                label = "Speed", value = layer.speed, range = .25f..4f,
                store = store, format = { String.format("%.2fx", it) },
                onGestureStart = gestureStart, onGestureEnd = gestureEnd,
                onChange = { layer.speed = it; store.scheduleSave(); tick++ }
            )
            LiveSlider(
                label = "Volume", value = layer.volume, range = 0f..1f,
                store = store, format = { "${(it * 100).toInt()}%" },
                onGestureStart = gestureStart, onGestureEnd = gestureEnd,
                onChange = { layer.volume = it; store.scheduleSave(); tick++ }
            )
        }
    }

    // Grade and blend, on every layer kind.
    Spacer(Modifier.height(Gap.md))
    SectionLabel("Colour grade")
    LiveSlider(
        label = "Brightness", value = layer.brightness, range = -1f..1f, store = store,
        resetTo = 0f, format = { "${(it * 100).toInt()}" },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.brightness = it; store.scheduleSave(); tick++ }
    )
    LiveSlider(
        label = "Contrast", value = layer.contrast, range = 0f..3f, store = store,
        resetTo = 1f, format = { String.format("%.2f", it) },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.contrast = it; store.scheduleSave(); tick++ }
    )
    LiveSlider(
        label = "Saturation", value = layer.saturation, range = 0f..3f, store = store,
        resetTo = 1f, format = { String.format("%.2f", it) },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.saturation = it; store.scheduleSave(); tick++ }
    )
    LiveSlider(
        label = "Blur", value = layer.blur, range = 0f..40f, store = store,
        resetTo = 0f, format = { it.toInt().toString() },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.blur = it; store.scheduleSave(); tick++ }
    )
    LiveSlider(
        label = "Tint strength", value = layer.tintAmount, range = 0f..1f, store = store,
        resetTo = 0f, format = { "${(it * 100).toInt()}%" },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.tintAmount = it; store.scheduleSave(); tick++ }
    )
    SwatchRow(current = layer.tint) { picked ->
        layer.tint = picked; store.scheduleSave(); store.onChange?.invoke(); tick++
    }

    Spacer(Modifier.height(Gap.sm))
    SectionLabel("Blend")
    Spacer(Modifier.height(Gap.xs))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
        items(BlendMode.values().size) { index ->
            val mode = BlendMode.values()[index]
            Pill(mode.label, active = layer.blendMode == mode) {
                layer.blendMode = mode; store.scheduleSave(); store.onChange?.invoke(); tick++
            }
        }
    }

    Spacer(Modifier.height(Gap.md))
    SectionLabel("Timing")
    LiveSlider(
        label = "Start", value = layer.start.toFloat(), range = 0f..store.project.duration.toFloat(),
        store = store, format = { String.format("%.2fs", it) },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.start = it.toDouble(); store.scheduleSave(); tick++ }
    )
    LiveSlider(
        label = "Duration", value = layer.duration.toFloat(), range = .1f..store.project.duration.toFloat(),
        store = store, format = { String.format("%.2fs", it) },
        onGestureStart = gestureStart, onGestureEnd = gestureEnd,
        onChange = { layer.duration = it.toDouble(); store.scheduleSave(); tick++ }
    )
    ToggleRow("Visible", layer.visible) {
        layer.visible = it; store.scheduleSave(); store.onChange?.invoke(); tick++
    }
    ToggleRow("Locked", layer.locked) {
        layer.locked = it; store.scheduleSave(); store.onChange?.invoke(); tick++
    }
}

/** A row of preset colour swatches, current colour first. */
@Composable
private fun SwatchRow(current: Int, onPick: (Int) -> Unit) {
    val swatches = listOf(
        0xFFFFFFFF.toInt(), 0xFF0B0D10.toInt(), 0xFF3AD9C6.toInt(), 0xFFFFC857.toInt(),
        0xFFFF5C7A.toInt(), 0xFF9B5DE5.toInt(), 0xFF3A7BD5.toInt(), 0xFF35C759.toInt()
    )
    Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm), modifier = Modifier.fillMaxWidth()) {
        (listOf(current) + swatches).distinct().take(8).forEach { colour ->
            Box(
                Modifier
                    .size(30.dp)
                    .clip(Corners.chip)
                    .background(Color(colour))
                    .clickable { onPick(colour) }
            )
        }
    }
}

// ----------------------------------------------------------------------- ease

/**
 * The Ease tab.
 *
 * A preset rail -- the seven curves the web build settled on, because those are the seven
 * people actually reach for -- and the bezier graph underneath. Both write through
 * [EditorStore.setEase], so picking "Overshoot" and then dragging a handle leaves a curve
 * built from the preset rather than two unrelated settings.
 */
@Composable
private fun EaseTab(store: EditorStore, layer: Layer, gestureStart: () -> Unit, gestureEnd: () -> Unit) {
    var tick by remember { mutableStateOf(0) }
    @Suppress("UNUSED_EXPRESSION") tick

    var prop by remember { mutableStateOf("x") }

    val animatedProps = transformProps.filter { (key, _) -> (layer.tracks()[key]?.keys?.size ?: 0) >= 2 }
    val editable = animatedProps.ifEmpty { transformProps }
    val chosen = if (editable.any { it.first == prop }) prop else editable.first().first

    SectionLabel("Curve for")
    Spacer(Modifier.height(Gap.xs))
    ChipRail(items = editable.map { it.first }, selected = chosen, onSelect = { prop = it })
    Spacer(Modifier.height(Gap.sm))

    val track = layer.tracks()[chosen] ?: return
    val sorted = track.keys.sortedBy { it.t }
    if (sorted.size < 2) {
        Text(
            "Add at least two keyframes on this property, then the curve between them can be shaped here.",
            color = Ink.dim, fontSize = 12.sp
        )
        Spacer(Modifier.height(Gap.sm))
        Pill("Add keyframe now", active = true) { store.toggleKeyframe(layer, chosen); tick++ }
        return
    }

    val index = sorted.indexOfLast { it.t <= store.time + 1e-6 }.coerceIn(0, sorted.size - 2)
    val segment = sorted[index]
    val next = sorted[index + 1]
    Text(
        "Segment ${index + 1} of ${sorted.size - 1} \u00B7 ${"%.2f".format(segment.t)}s \u2192 ${"%.2f".format(next.t)}s",
        color = Ink.dim, fontSize = 11.sp
    )
    Spacer(Modifier.height(Gap.sm))

    Column {
        Ease.presets.chunked(4).forEach { rowItems ->
            Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm), modifier = Modifier.padding(bottom = Gap.sm)) {
                rowItems.forEach { (label, ease) ->
                    Pill(label, active = sameCurve(segment.ease, ease)) {
                        store.setEase(layer, chosen, ease)
                        tick++
                    }
                }
            }
        }
    }

    Spacer(Modifier.height(Gap.md))
    SectionLabel("Curve")
    Spacer(Modifier.height(Gap.sm))
    BezierGraph(
        ease = segment.ease,
        onGestureStart = { store.checkpoint(); gestureStart() },
        onGestureEnd = gestureEnd,
        onChange = { ease -> store.setEase(layer, chosen, ease); tick++ }
    )
    Spacer(Modifier.height(Gap.xs))
    Text(
        "Drag the two handles. X is time, Y is the value; overshoot above the box is allowed so a bounce is actually a bounce.",
        color = Ink.dim, fontSize = 11.sp
    )

    if (segment.ease.kind == EaseKind.SPRING) {
        Spacer(Modifier.height(Gap.sm))
        LiveSlider(
            label = "Stiffness", value = segment.ease.stiffness, range = 20f..300f,
            store = store, onGestureStart = gestureStart, onGestureEnd = gestureEnd,
            onChange = { store.setEase(layer, chosen, segment.ease.copy(stiffness = it)); tick++ }
        )
        LiveSlider(
            label = "Damping", value = segment.ease.damping, range = 1f..30f,
            store = store, onGestureStart = gestureStart, onGestureEnd = gestureEnd,
            onChange = { store.setEase(layer, chosen, segment.ease.copy(damping = it)); tick++ }
        )
    }
}

private fun sameCurve(a: Ease, b: Ease): Boolean =
    a.kind == b.kind &&
        (a.kind != EaseKind.CUBIC || (
            abs(a.x1 - b.x1) < .02f && abs(a.y1 - b.y1) < .02f &&
                abs(a.x2 - b.x2) < .02f && abs(a.y2 - b.y2) < .02f))

/**
 * The bezier graph.
 *
 * The plot leaves vertical padding so a curve that overshoots (y outside 0..1) stays visible,
 * and the handles are drawn as large dots because a fingertip is not a mouse pointer. Handles
 * are clamped in X to 0..1: control points outside that range make x(t) non-monotonic, which
 * would make a keyframe appear to move backwards in time.
 */
@Composable
fun BezierGraph(
    ease: Ease,
    onGestureStart: () -> Unit,
    onGestureEnd: () -> Unit = {},
    onChange: (Ease) -> Unit
) {
    var dragging by remember { mutableStateOf(0) }
    val graph = remember(ease) { ease.copy(kind = EaseKind.CUBIC) }
    val pad = 34.dp

    Canvas(
        Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(Corners.card)
            .background(Ink.panelHigh)
            .pointerInput(ease) {
                detectDragGestures(
                    onDragStart = { offset ->
                        onGestureStart()
                        val box = graphBox(size.width.toFloat(), size.height.toFloat(), pad.toPx())
                        val p1 = Offset(box.x + graph.x1 * box.w, box.y + (1f - graph.y1) * box.h)
                        val p2 = Offset(box.x + graph.x2 * box.w, box.y + (1f - graph.y2) * box.h)
                        dragging = if ((offset - p1).getDistance() < (offset - p2).getDistance()) 1 else 2
                    },
                    onDragEnd = { dragging = 0; onGestureEnd() },
                    onDragCancel = { dragging = 0; onGestureEnd() }
                ) { change, _ ->
                    val box = graphBox(size.width.toFloat(), size.height.toFloat(), pad.toPx())
                    val x = ((change.position.x - box.x) / box.w).coerceIn(0f, 1f)
                    val y = (1f - (change.position.y - box.y) / box.h).coerceIn(-.6f, 1.6f)
                    val next = if (dragging == 1) graph.copy(x1 = x, y1 = y) else graph.copy(x2 = x, y2 = y)
                    onChange(next)
                }
            }
    ) {
        val box = graphBox(size.width, size.height, pad.toPx())

        drawRect(Ink.line, Offset(box.x, box.y), androidx.compose.ui.geometry.Size(box.w, box.h), style = Stroke(1f))
        drawLine(Ink.line.copy(alpha = .5f), Offset(box.x, box.y + box.h), Offset(box.x + box.w, box.y), strokeWidth = 1f)

        val curve = Ease(EaseKind.CUBIC, graph.x1, graph.y1, graph.x2, graph.y2)
        val path = Path()
        val steps = 72
        for (i in 0..steps) {
            val f = i / steps.toFloat()
            val v = curve.at(f)
            val px = box.x + f * box.w
            val py = box.y + (1f - v) * box.h
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, Ink.accent, style = Stroke(2.5f))

        val p1 = Offset(box.x + graph.x1 * box.w, box.y + (1f - graph.y1) * box.h)
        val p2 = Offset(box.x + graph.x2 * box.w, box.y + (1f - graph.y2) * box.h)
        drawLine(Ink.dim, Offset(box.x, box.y + box.h), p1, strokeWidth = 1.5f)
        drawLine(Ink.dim, Offset(box.x + box.w, box.y), p2, strokeWidth = 1.5f)
        drawCircle(Ink.key, radius = 9.dp.toPx(), center = p1)
        drawCircle(Ink.key, radius = 9.dp.toPx(), center = p2)
        drawCircle(Ink.bg, radius = 3.dp.toPx(), center = p1)
        drawCircle(Ink.bg, radius = 3.dp.toPx(), center = p2)
    }
}

/** The plot rectangle inside the canvas. */
private data class Box4(val x: Float, val y: Float, val w: Float, val h: Float)

private fun graphBox(width: Float, height: Float, pad: Float): Box4 =
    Box4(pad, pad, width - pad * 2f, height - pad * 2f)
