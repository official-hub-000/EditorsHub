package com.editorhub.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** A small uppercase heading, used to separate inspector sections. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        color = Ink.dim,
        fontSize = 9.5.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.1.sp,
        modifier = modifier.padding(vertical = 6.dp),
    )
}

/** The round accent button used for transport controls. */
@Composable
fun GlyphButton(
    glyph: String,
    tint: Color = Ink.text,
    size: Int = 36,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (enabled) Ink.panelHigh else Ink.panel)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, color = if (enabled) tint else Ink.line, fontSize = (size * .42f).sp)
    }
}

/**
 * A labelled slider.
 *
 * Drag anywhere on the track, no thumb-hunting: the whole row is the target, which matters on a
 * phone where the visual thumb is 12 dp across.
 */
@Composable
fun LiveSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onValueChange: (Float) -> Unit,
    onReset: () -> Unit = {},
    suffix: String = "",
    accent: Color = Ink.accent,
) {
    val fraction = ((value - range.start) / (range.endInclusive - range.start)).coerceIn(0f, 1f)
    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, color = Ink.dim, fontSize = 11.sp)
            Text(
                text = if (suffix.isEmpty()) "%.2f".format(value) else "%.1f%s".format(value, suffix),
                color = Ink.text,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { onReset() },
            )
        }
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(26.dp)
                .pointerInput(range, value) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            val f = (offset.x / size.width).coerceIn(0f, 1f)
                            onValueChange(range.start + f * (range.endInclusive - range.start))
                        },
                    ) { change, _ ->
                        val f = (change.position.x / size.width).coerceIn(0f, 1f)
                        onValueChange(range.start + f * (range.endInclusive - range.start))
                    }
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Ink.line),
            )
            Box(
                Modifier
                    .fillMaxWidth(fraction)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(accent),
            )
            Box(
                Modifier
                    .padding(start = 0.dp)
                    .size(0.dp),
            )
        }
    }
}

/** A row of mutually exclusive chips. */
@Composable
fun <T> Chips(
    items: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items.take(4).forEach { (value, label) ->
            val active = value == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (active) Ink.accent.copy(alpha = .16f) else Ink.panelHigh)
                    .border(
                        1.dp,
                        if (active) Ink.accent.copy(alpha = .5f) else Ink.line,
                        RoundedCornerShape(8.dp),
                    )
                    .clickable { onSelect(value) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(
                    label,
                    color = if (active) Ink.accent else Ink.dim,
                    fontSize = 10.5.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

/** A toggle row with a switch-like affordance drawn locally. */
@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = Ink.text, fontSize = 12.sp)
        Box(
            Modifier
                .width(34.dp)
                .height(18.dp)
                .clip(CircleShape)
                .background(if (checked) Ink.accent else Ink.line),
            contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart,
        ) {
            Box(Modifier.padding(2.dp).size(14.dp).clip(CircleShape).background(Ink.bg))
        }
    }
}

/** An icon-less text button used in the app bar. */
@Composable
fun TextButtonSmall(label: String, accent: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (accent) Ink.accent else Ink.panelHigh)
            .clickable { onClick() }
            .padding(horizontal = 11.dp, vertical = 7.dp),
    ) {
        Text(
            label,
            color = if (accent) Ink.bg else Ink.text,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** A cropped, rounded thumbnail placeholder with the layer's initial. */
@Composable
fun Thumb(letter: String, tint: Color, size: Int = 34) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(tint.copy(alpha = .18f))
            .border(1.dp, tint.copy(alpha = .35f), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = tint, fontSize = (size * .38f).sp, fontWeight = FontWeight.Bold)
    }
}

/** Formats seconds as m:ss, which is what a playhead readout should say. */
fun formatTime(seconds: Float): String {
    val total = seconds.coerceAtLeast(0f)
    val m = (total / 60).toInt()
    val s = total - m * 60
    val whole = s.toInt()
    val frames = ((s - whole) * 30).roundToInt()
    return "%d:%02d.%02d".format(m, whole, frames)
}
