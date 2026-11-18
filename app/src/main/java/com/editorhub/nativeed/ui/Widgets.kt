package com.editorhub.nativeed.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** Section label: small, dim, upper-case. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        color = Ink.dim,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.2.sp,
        modifier = modifier
    )
}

/**
 * One inspector field: caption above, control below.
 *
 * Named [FieldRow] rather than `Row` so it cannot be confused with the layout's Row, which
 * is imported everywhere in this package.
 */
@Composable
fun FieldRow(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = Gap.xs)) {
        Text(label, color = Ink.dim, fontSize = 11.sp)
        Box(Modifier.height(Gap.xs))
        content()
    }
}

/** A pill button. [active] paints it with the accent, used for modes and toggles. */
@Composable
fun Pill(
    text: String,
    active: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier
            .heightIn(min = 34.dp)
            .clip(Corners.pill)
            .background(if (active) Ink.accent else Ink.panelHigh)
            .clickable { onClick() }
            .padding(horizontal = Gap.md, vertical = Gap.sm),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text,
            color = if (active) Ink.bg else Ink.text,
            fontSize = 12.sp,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            textAlign = TextAlign.Center
        )
    }
}

/** A square icon-ish button with a short glyph, so no icon font is needed. */
@Composable
fun GlyphButton(
    glyph: String,
    enabled: Boolean = true,
    tint: Color = Ink.text,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier
            .size(TapTarget)
            .clip(Corners.chip)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(glyph, color = if (enabled) tint else Ink.dim, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * A horizontal slider that reports every movement, including during the drag.
 *
 * Material's Slider only exposes the settled value through its state, which makes a live
 * preview lag one gesture behind. This reports continuously and tells the caller when the
 * gesture begins so it can take an undo checkpoint once instead of per pixel.
 */
@Composable
fun ValueSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    format: (Float) -> String = { it.roundToInt().toString() },
    resetTo: Float? = null,
    onStart: () -> Unit = {},
    onEnd: () -> Unit = {},
    onChange: (Float) -> Unit
) {
    var live by remember(value) { mutableFloatStateOf(value) }
    val span = (range.endInclusive - range.start).takeIf { it > 0f } ?: 1f

    Column(Modifier.fillMaxWidth().padding(vertical = Gap.xs)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, color = Ink.dim, fontSize = 11.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(format(live), color = Ink.text, fontSize = 11.sp)
                if (resetTo != null) {
                    Spacer(Modifier.width(Gap.sm))
                    Text(
                        "reset",
                        color = Ink.accent,
                        fontSize = 11.sp,
                        modifier = Modifier.clickable {
                            onStart(); live = resetTo; onChange(resetTo); onEnd()
                        }
                    )
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(34.dp)
                .pointerInput(range) {
                    detectTapGestures { offset ->
                        onStart()
                        val fraction = (offset.x / size.width).coerceIn(0f, 1f)
                        val next = range.start + span * fraction
                        live = next; onChange(next); onEnd()
                    }
                }
                .pointerInput(range) {
                    detectHorizontalDragGestures(
                        onDragStart = { onStart() },
                        onDragEnd = { onEnd() },
                        onDragCancel = { onEnd() }
                    ) { change, drag ->
                        change.consume()
                        val deltaFraction = drag / size.width.toFloat()
                        val next = (live + span * deltaFraction).coerceIn(range.start, range.endInclusive)
                        live = next; onChange(next)
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            // Track, filled portion and knob: three boxes, no canvas, cheap to recompose.
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Ink.line)) {
                val fraction = ((live - range.start) / span).coerceIn(0f, 1f)
                Box(Modifier.fillMaxWidth(fraction).height(4.dp).background(Ink.accent))
            }
            val fraction = ((live - range.start) / span).coerceIn(0f, 1f)
            Box(Modifier.fillMaxWidth(fraction), contentAlignment = Alignment.CenterEnd) {
                Box(Modifier.size(14.dp).clip(RoundedCornerShape(50)).background(Ink.text))
            }
        }
    }
}

/** A labelled on/off row. */
@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = TapTarget).clickable { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, color = Ink.text, fontSize = 13.sp)
        Box(
            Modifier
                .size(width = 40.dp, height = 22.dp)
                .clip(Corners.pill)
                .background(if (checked) Ink.accent else Ink.line)
                .padding(2.dp),
            contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart
        ) {
            Box(Modifier.size(18.dp).clip(RoundedCornerShape(50)).background(Ink.bg))
        }
    }
}

/** A card container used for inspector groups and library tiles. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    content: @Composable () -> Unit
) {
    Box(
        modifier
            .clip(Corners.card)
            .background(Ink.panelHigh)
            .then(if (selected) Modifier.background(Ink.accent.copy(alpha = .12f)) else Modifier)
            .padding(Gap.md)
    ) {
        content()
    }
}

/** A scrollable chip rail. */
@Composable
fun ChipRail(
    items: List<String>,
    selected: String?,
    modifier: Modifier = Modifier,
    onSelect: (String) -> Unit
) {
    LazyRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Gap.sm)
    ) {
        items(items.size) { index ->
            val item = items[index]
            Pill(item, active = item == selected) { onSelect(item) }
        }
    }
}

/** Divider with optional centred caption, used inside sheets. */
@Composable
fun Caption(text: String) {
    Text(text, color = Ink.dim, fontSize = 11.sp, modifier = Modifier.padding(vertical = Gap.sm))
}

/** Small stat chip: a value and its unit, for the inspector header. */
@Composable
fun Stat(value: String, unit: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = Gap.sm)) {
        Text(value, color = Ink.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Text(unit, color = Ink.dim, fontSize = 9.sp)
    }
}

/** Reads as a border-only button when unselected. */
@Composable
fun OutlinePill(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 34.dp)
            .clip(Corners.pill)
            .background(Color.Transparent)
            .then(Modifier)
            .clickable { onClick() }
            .padding(horizontal = Gap.md, vertical = Gap.sm),
        contentAlignment = Alignment.Center
    ) {
        Text(text, color = Ink.text, fontSize = 12.sp)
    }
}
