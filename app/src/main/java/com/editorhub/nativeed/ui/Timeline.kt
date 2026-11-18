package com.editorhub.nativeed.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.MutableDoubleState
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import com.editorhub.nativeed.EditorStore
import com.editorhub.nativeed.Layer
import com.editorhub.nativeed.LayerKind

/**
 * The timeline.
 *
 * Layout: a fixed gutter of layer heads on the left, a scrollable track area on the right,
 * and a ruler on top. The playhead is drawn across all three so it reads as one line.
 *
 * Zoom is a per-pixel time scale. At the default zoom the whole composition fits, which is
 * what someone opening a project wants to see; pinching in and out changes only the scale,
 * so nothing about the document changes when the view does.
 */
@Composable
fun TimelinePanel(
    store: EditorStore,
    modifier: Modifier = Modifier,
    /** Bumped by the store on every edit; forces the rows to rebuild. */
    version: Int = 0,
    /** The live playhead. Read inside draw lambdas so playback repaints, not recomposes. */
    playhead: MutableDoubleState = remember { mutableDoubleStateOf(0.0) },
    onSeek: (Double) -> Unit,
    onSeekEnd: () -> Unit = {},
    onGestureStart: () -> Unit = {}
) {
    val project = store.project
    var scale by remember { mutableFloatStateOf(1f) }  // multiplier over the fitted scale
    var offsetX by remember { mutableFloatStateOf(0f) }
    val gutterWidth = 108.dp
    @Suppress("UNUSED_EXPRESSION")
    version

    Column(modifier.background(Ink.panel)) {
        // ---------------------------------------------------------------- ruler
        Row(Modifier.fillMaxWidth().height(26.dp)) {
            Spacer(Modifier.width(gutterWidth))
            Box(Modifier.weight(1f).fillMaxSize()) {
                // Memoised so the ruler canvas is not invalidated when unrelated layers
                // change; it only redraws when the zoom, the offset or the time does.
                RulerCanvas(
                    duration = project.duration,
                    scale = scale,
                    offsetX = offsetX,
                    playhead = playhead,
                    onScale = { scale = it },
                    onOffset = { offsetX = it },
                    onSeek = onSeek,
                    onSeekEnd = onSeekEnd
                )
            }
        }
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        // ---------------------------------------------------------------- tracks
        Row(Modifier.fillMaxWidth().weight(1f)) {
            // Layer heads.
            LazyColumn(Modifier.width(gutterWidth).fillMaxSize()) {
                items(project.layers.reversed(), key = { it.id }) { layer ->
                    LayerHead(
                        layer = layer,
                        selected = layer.id == store.selectedLayerId,
                        onSelect = { store.select(layer.id) },
                        onToggleVisible = {
                            store.checkpoint(); layer.visible = !layer.visible; store.save(); store.onChange?.invoke()
                        }
                    )
                }
            }
            // Bars.
            Box(Modifier.weight(1f).fillMaxSize().background(Ink.bg)) {
                TrackArea(
                    store = store,
                    playhead = playhead,
                    scale = scale,
                    offsetX = offsetX,
                    onScale = { scale = it },
                    onOffset = { offsetX = it },
                    onSeek = onSeek,
                    onSeekEnd = onSeekEnd,
                    onGestureStart = onGestureStart,
                    version = version
                )
            }
        }
    }
}

/**
 * Candidate ruler intervals, from a tenth of a second to two minutes.
 *
 * A top-level list rather than one allocated in the draw lambda: the ruler redraws on every
 * frame of playback, and allocating a list per frame is exactly the sort of quiet allocation
 * that shows up as the occasional dropped frame.
 */
private val TICK_STEPS = listOf(.1, .25, .5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0)

/**
 * Ruler + playhead + pinch zoom.
 *
 * Separate from the panel so its canvas has its own draw scope: a layer rename does not
 * invalidate the ruler, and a zoom does not invalidate the layer rows.
 */
@Composable
private fun RulerCanvas(
    duration: Double,
    scale: Float,
    offsetX: Float,
    playhead: MutableDoubleState,
    onScale: (Float) -> Unit,
    onOffset: (Float) -> Unit,
    onSeek: (Double) -> Unit,
    onSeekEnd: () -> Unit
) {
    val measurer = rememberTextMeasurer()
    Canvas(
        Modifier
            .fillMaxSize()
            .pointerInput(duration) {
                detectTapGestures { offset ->
                    val secondsPerPixel = duration / (size.width.toFloat() * scale)
                    onSeek(((offset.x - offsetX) * secondsPerPixel).toDouble().coerceIn(0.0, duration))
                    onSeekEnd()
                }
            }
            .pointerInput(Unit) {
                detectTransformGesturesCompat(
                    onZoom = { onScale(it) },
                    onPan = { onOffset(it) }
                )
            }
    ) {
        // Pick a tick interval that keeps labels at least 56 dp apart at this zoom.
        val pixelsPerSecond = (size.width / duration.toFloat()) * scale
        val candidates = TICK_STEPS
        val step = candidates.firstOrNull { (it * pixelsPerSecond) >= 56.dp.toPx() } ?: 120.0
        var t = 0.0
        while (t <= duration + 1e-6) {
            val x = (t * pixelsPerSecond).toFloat() - offsetX
            if (x >= -60f && x <= size.width + 60f) {
                drawLine(Ink.line, Offset(x, size.height * .55f), Offset(x, size.height), strokeWidth = 1f)
                val label = if (step < 1.0) "%.2fs".format(t) else "${t.roundToInt()}s"
                drawText(
                    textMeasurer = measurer,
                    text = label,
                    topLeft = Offset(x + 4f, 2f),
                    style = androidx.compose.ui.text.TextStyle(color = Ink.dim, fontSize = 9.sp)
                )
            }
            t += step
        }
        // Playhead. Read here, inside the draw scope, so a moving playhead only repaints.
        val px = (playhead.doubleValue.toFloat() * pixelsPerSecond) - offsetX
        drawLine(Ink.accent, Offset(px, 0f), Offset(px, size.height), strokeWidth = 2.5f)
    }
}

/** Layer names, kind glyphs and a visibility dot, in a fixed-width column. */
@Composable
private fun LayerHead(
    layer: Layer,
    selected: Boolean,
    onSelect: () -> Unit,
    onToggleVisible: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(38.dp)
            .background(if (selected) Ink.panelHigh else Color.Transparent)
            .clickable { onSelect() }
            .padding(horizontal = Gap.sm),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(Corners.chip)
                .background(if (selected) Ink.accent.copy(alpha = .22f) else Ink.line)
                .clickable { onToggleVisible() },
            contentAlignment = Alignment.Center
        ) {
            Text(kindGlyph(layer.kind), fontSize = 10.sp, color = if (layer.visible) Ink.text else Ink.dim)
        }
        Spacer(Modifier.width(Gap.sm))
        Text(
            layer.name,
            color = if (layer.visible) Ink.text else Ink.dim,
            fontSize = 11.sp,
            maxLines = 1,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
        )
    }
}

/** Bars, keyframe diamonds and the playhead in the track area. */
@Composable
private fun TrackArea(
    store: EditorStore,
    playhead: MutableDoubleState,
    scale: Float,
    offsetX: Float,
    onScale: (Float) -> Unit,
    onOffset: (Float) -> Unit,
    onSeek: (Double) -> Unit,
    onSeekEnd: () -> Unit,
    onGestureStart: () -> Unit,
    /** Bumped by the store; rebuilds the bars when a layer moves or a key is added. */
    version: Int = 0
) {
    val project = store.project
    val rowHeight = 38.dp

    // Drawn front-to-back-in-the-timeline (top row is the frontmost layer). Memoised on the
    // version counter so the draw lambda does not reverse a list and walk every keyframe of
    // every track sixty times a second. That walk used to be per layer per frame and it is
    // the kind of work that makes a timeline feel heavy on a mid-range phone.
    val rows = remember(version, project.layers.size) {
        project.layers.reversed().map { layer ->
            RowData(
                layer = layer,
                keyTimes = layer.tracks().values.flatMap { track -> track.keys.map { it.t } }.distinct().sorted()
            )
        }
    }

    @Suppress("UNUSED_EXPRESSION")
    version
    // Dragging the playhead area scrubs; dragging a bar's body moves the layer in time.
    var scrubMode by remember { mutableStateOf(true) }

    Canvas(
        Modifier
            .fillMaxSize()
            .pointerInput(project.duration, scale, offsetX) {
                detectTapGestures { offset ->
                    val pixelsPerSecond = (size.width / project.duration.toFloat()) * scale
                    val seconds = ((offset.x + offsetX) / pixelsPerSecond).toDouble()
                    val row = (offset.y / rowHeight.toPx()).toInt()
                    val layer = project.layers.reversed().getOrNull(row)
                    if (layer != null) store.select(layer.id)
                    onSeek(seconds.coerceIn(0.0, project.duration))
                    onSeekEnd()
                }
            }
            .pointerInput(project.duration, scale, offsetX) {
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        val row = (offset.y / rowHeight.toPx()).toInt()
                        // Grabbing the playhead itself scrubs; grabbing anywhere else drags
                        // that layer's bar in time. This is the muscle memory of every NLE.
                        val pixelsPerSecond = (size.width / project.duration.toFloat()) * scale
                        val playheadX = (playhead.doubleValue.toFloat() * pixelsPerSecond) - offsetX
                        scrubMode = kotlin.math.abs(offset.x - playheadX) < 24.dp.toPx() || row < 0
                        if (!scrubMode) {
                            store.select(project.layers.reversed().getOrNull(row)?.id)
                            store.checkpoint()
                            onGestureStart()
                        }
                    },
                    onDragEnd = { onSeekEnd() },
                    onDragCancel = { onSeekEnd() }
                ) { change, drag ->
                    change.consume()
                    val pixelsPerSecond = (size.width / project.duration.toFloat()) * scale
                    if (scrubMode) {
                        val seconds = ((change.position.x + offsetX) / pixelsPerSecond).toDouble()
                        onSeek(seconds.coerceIn(0.0, project.duration))
                    } else {
                        val layer = store.selected ?: return@detectHorizontalDragGestures
                        val deltaSeconds = (drag / pixelsPerSecond).toDouble()
                        layer.start = (layer.start + deltaSeconds).coerceIn(0.0, project.duration)
                        store.onChange?.invoke()
                    }
                }
            }
            .pointerInput(Unit) {
                detectTransformGesturesCompat(onZoom = onScale, onPan = onOffset)
            }
    ) {
        val pixelsPerSecond = (size.width / project.duration.toFloat()) * scale
        rows.forEachIndexed { index, row ->
            val top = index * rowHeight.toPx()
            if (index % 2 == 0) {
                drawRect(Ink.panel.copy(alpha = .35f), Offset(0f, top), Size(size.width, rowHeight.toPx()))
            }
            // Half-frame markers every half second, so bars read as time.
            var t = 0.0
            while (t <= project.duration) {
                val x = (t * pixelsPerSecond).toFloat() - offsetX
                drawLine(Ink.line.copy(alpha = .4f), Offset(x, top), Offset(x, top + rowHeight.toPx()), strokeWidth = 1f)
                t += 1.0
            }
            val layer = row.layer
            val startX = (layer.start * pixelsPerSecond).toFloat() - offsetX
            val endX = ((layer.start + layer.duration) * pixelsPerSecond).toFloat() - offsetX
            val barColor = when (layer.kind) {
                LayerKind.IMAGE -> Color(0xFF3A7BD5)
                LayerKind.VIDEO -> Color(0xFF9B5DE5)
                LayerKind.SHAPE -> Color(0xFF3AD9C6)
                LayerKind.TEXT -> Color(0xFFFFC857)
                LayerKind.NULL -> Color(0xFF8A94A0)
                else -> Color(0xFF4A5568)
            }
            val selected = layer.id == store.selectedLayerId
            val inset = 3.dp.toPx()
            drawRoundRect(
                color = if (selected) barColor else barColor.copy(alpha = .55f),
                topLeft = Offset(startX, top + inset),
                size = Size((endX - startX).coerceAtLeast(4f), rowHeight.toPx() - inset * 2),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f)
            )
            if (selected) {
                drawRoundRect(
                    color = Ink.accent,
                    topLeft = Offset(startX, top + inset),
                    size = Size((endX - startX).coerceAtLeast(4f), rowHeight.toPx() - inset * 2),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(1.5f)
                )
            }
            // Keyframe diamonds on the row.
            row.keyTimes.forEach { kt ->
                val x = (kt * pixelsPerSecond).toFloat() - offsetX
                if (x > -8f && x < size.width + 8f) {
                    val cy = top + rowHeight.toPx() / 2f
                    val r = 4.dp.toPx()
                    drawPath(
                        path = androidx.compose.ui.graphics.Path().apply {
                            moveTo(x, cy - r); lineTo(x + r, cy); lineTo(x, cy + r); lineTo(x - r, cy); close()
                        },
                        color = Ink.key
                    )
                }
            }
        }
        // Playhead over everything.
        val px = (playhead.doubleValue.toFloat() * pixelsPerSecond) - offsetX
        drawLine(Ink.accent, Offset(px, 0f), Offset(px, size.height), strokeWidth = 2.5f)
        drawCircle(Ink.accent, radius = 5.dp.toPx(), center = Offset(px, 0f))
    }
}

/** One timeline row: the layer, plus the keyframe times it should draw. */
private data class RowData(val layer: Layer, val keyTimes: List<Double>)

/** The glyph shown on a layer head. Text, not an icon font: no dependency, no size. */
fun kindGlyph(kind: LayerKind): String = when (kind) {
    LayerKind.IMAGE -> "IMG"
    LayerKind.VIDEO -> "VID"
    LayerKind.SHAPE -> "SHP"
    LayerKind.TEXT -> "TXT"
    LayerKind.NULL -> "NUL"
    LayerKind.CAMERA -> "CAM"
    LayerKind.GROUP -> "GRP"
}
