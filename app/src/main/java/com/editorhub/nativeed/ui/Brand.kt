package com.editorhub.nativeed.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The brand mark, drawn with vectors.
 *
 * Same geometry as the launcher icon (`res/drawable/ic_brand_foreground.xml`): a stem and
 * three timeline bars, the middle one shortened with a playhead notch. Drawing it here rather
 * than loading a bitmap keeps it crisp at any size and avoids shipping the icon twice.
 */
@Composable
fun BrandMark(size: Int = 22, onBrand: Boolean = true) {
    Canvas(Modifier.size(size.dp)) {
        val w = this.size.width
        val h = this.size.height
        // Proportions of the 108x108 icon viewport.
        fun x(v: Float) = v / 108f * w
        fun y(v: Float) = v / 108f * h
        val ink = if (onBrand) Ink.bg else Ink.text
        val bar = { left: Float, top: Float, right: Float, bottom: Float, colour: Color ->
            drawRect(colour, Offset(x(left), y(top)), Size(x(right - left), y(bottom - top)))
        }
        bar(36f, 30f, 48f, 78f, ink)
        bar(48f, 30f, 74f, 42f, ink)
        bar(48f, 48f, 66f, 60f, ink)
        bar(48f, 66f, 74f, 78f, ink)
        // The playhead notch, as a triangle.
        val path = androidx.compose.ui.graphics.Path().apply {
            moveTo(x(70f), y(48f)); lineTo(x(74f), y(54f)); lineTo(x(70f), y(60f)); close()
        }
        drawPath(path, ink)
    }
}

/** The mark in its brand field, used in headers and on the home screen. */
@Composable
fun BrandBadge(size: Int = 30) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size * 0.28f).dp))
            .background(
                Brush.linearGradient(listOf(Ink.accent, Color(0xFF22B8D4), Color(0xFF2B7FFF)))
            ),
        contentAlignment = Alignment.Center
    ) {
        BrandMark(size = (size * 0.72f).toInt())
    }
}

/**
 * The wordmark.
 *
 * Two weights rather than one bold string: the split is what makes it read as a name instead
 * of a label, and it is the only typographic decision in the app worth this much space.
 */
@Composable
fun Wordmark(fontSize: Int = 16) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text("Editors", color = Ink.text, fontSize = fontSize.sp, fontWeight = FontWeight.Light)
        Text("Hub", color = Ink.accent, fontSize = fontSize.sp, fontWeight = FontWeight.Bold)
    }
}

/** Mark plus wordmark, the app's header lockup. */
@Composable
fun BrandLockup(compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BrandBadge(size = if (compact) 26 else 30)
        Spacer(Modifier.width(if (compact) Gap.sm else Gap.md))
        Column {
            Wordmark(fontSize = if (compact) 15 else 17)
            if (!compact) {
                Text(
                    "MOTION EDITOR",
                    color = Ink.dim,
                    fontSize = 7.sp,
                    letterSpacing = 1.6.sp,
                    modifier = Modifier.padding(top = 1.dp)
                )
            }
        }
    }
}
