package com.editorhub.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.editorhub.engine.EditorStore
import com.editorhub.engine.LayerKind
import kotlin.math.roundToInt

private const val ROW_HEIGHT = 42
private const val LABEL_WIDTH = 96

/**
 * The timeline.
 *
 * Two regions: a fixed label column and a scrolling track area. The ruler samples the composition
 * at fixed pixel intervals, so zooming changes how much time is visible without changing how the
 * ruler looks.
 */
@Composable
fun Timeline(store: EditorStore, modifier: Modifier = Modifier) {
    val comp = store.composition
    // Zoom must be state: reassigning a plain local from a click would not recompose the ruler.
    var pixelsPerSecond by remember { mutableStateOf(64f) }

    Column(modifier.background(Ink.panel)) {
        // Transport row: playhead readout, then the scale buttons.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                formatTime(store.playhead),
                color = Ink.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "${comp.frameRate} fps",
                    color = Ink.dim,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(top = 3.dp),
                )
                TextButtonSmall("−") { pixelsPerSecond = (pixelsPerSecond / 1.4f).coerceAtLeast(16f) }
                TextButtonSmall("+") { pixelsPerSecond = (pixelsPerSecond * 1.4f).coerceAtMost(400f) }
            }
        }

        // Ruler. Tapping or dragging scrubs.
        Box(
            Modifier
                .fillMaxWidth()
                .height(22.dp)
                .padding(start = LABEL_WIDTH.dp)
                .pointerInput(comp.duration, pixelsPerSecond) {
                    detectTapGestures { offset ->
                        store.playhead = (offset.x / pixelsPerSecond).coerceIn(0f, comp.duration)
                    }
                }
                .pointerInput(comp.duration, pixelsPerSecond) {
                    detectDragGestures { change, _ ->
                        store.playhead = (change.position.x / pixelsPerSecond)
                            .coerceIn(0f, comp.duration)
                    }
                },
        ) {
            Canvas(Modifier.fillMaxWidth().fillMaxHeight()) {
                val step = when {
                    pixelsPerSecond >= 160 -> .25f
                    pixelsPerSecond >= 80 -> .5f
                    pixelsPerSecond >= 40 -> 1f
                    else -> 2f
                }
                var t = 0f
                while (t <= comp.duration) {
                    val x = t * pixelsPerSecond
                    // A label must not be drawn past the right edge: drawText throws if the
                    // rectangle it is given is wider than the space left.
                    if (x > size.width - 24f) break
                    drawLine(
                        color = Ink.line,
                        start = Offset(x, size.height * .45f),
                        end = Offset(x, size.height),
                        strokeWidth = 1f,
                    )
                    drawContext.canvas.nativeCanvas.drawText(
                        if (step < 1f) "%.2fs".format(t) else "${t.toInt()}s",
                        x + 3f,
                        size.height * .6f,
                        android.graphics.Paint().apply {
                            color = 0xFF8A94A0.toInt()
                            textSize = 8.5f * density
                            isAntiAlias = true
                        },
                    )
                    t += step
                }
            }
        }

        Row(Modifier.fillMaxWidth().height(1.dp).background(Ink.line)) {}

        // Layer rows.
        LazyColumn(Modifier.fillMaxWidth().height(ROW_HEIGHT.dp * 5.5f)) {
            items(comp.layers.reversed()) { layer ->
                val selected = layer.id == store.selectedLayerId
                val tint = when (layer.kind) {
                    LayerKind.AUDIO -> Ink.audio
                    LayerKind.VIDEO -> Ink.video
                    LayerKind.ADJUSTMENT -> Ink.accentDeep
                    else -> Ink.accent
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(ROW_HEIGHT.dp)
                        .background(if (selected) Ink.panelHigh else Color.Transparent),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        Modifier.width(LABEL_WIDTH.dp).padding(start = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Thumb(layer.kind.name.take(1), tint, size = 20)
                        Text(
                            layer.name,
                            color = if (selected) Ink.text else Ink.dim,
                            fontSize = 10.sp,
                            maxLines = 1,
                            modifier = Modifier.padding(start = 6.dp),
                        )
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .fillMaxHeight()
                            .pointerInput(layer.id, pixelsPerSecond) {
                                detectTapGestures { store.selectedLayerId = layer.id }
                            },
                    ) {
                        Canvas(Modifier.fillMaxWidth().fillMaxHeight()) {
                            val x = 0f + layer.start * pixelsPerSecond
                            val w = (layer.duration * pixelsPerSecond).coerceAtLeast(6f)
                            val barTop = size.height * .22f
                            val barHeight = size.height * .56f
                            drawRoundRect(
                                color = tint.copy(alpha = if (selected) .85f else .5f),
                                topLeft = Offset(x, barTop),
                                size = Size(w, barHeight),
                                cornerRadius = androidx.compose.ui.geometry.CornerRadius(4f, 4f),
                            )
                            if (selected) {
                                drawRoundRect(
                                    color = Ink.text,
                                    topLeft = Offset(x, barTop),
                                    size = Size(w, barHeight),
                                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(4f, 4f),
                                    style = Stroke(width = 1.5f),
                                )
                            }
                        }
                    }
                }
            }
        }

        // Playhead line over everything.
        Box(Modifier.fillMaxWidth().height(2.dp).background(Ink.accent.copy(alpha = .0f))) {}
    }
}
