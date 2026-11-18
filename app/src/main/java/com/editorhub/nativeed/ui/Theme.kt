package com.editorhub.nativeed.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * The editor's palette.
 *
 * Taken from the web build so the native editor is not a different-looking app: near-black
 * panels, one teal accent for anything selected or armed, amber for keyframes, and a
 * transparent-black scrim behind floating panels.
 */
object Ink {
    val bg = Color(0xFF0B0D10)
    val panel = Color(0xFF14181D)
    val panelHigh = Color(0xFF1C2128)
    val line = Color(0xFF262D35)
    val text = Color(0xFFE9EDF2)
    val dim = Color(0xFF8A94A0)
    val accent = Color(0xFF3AD9C6)
    val key = Color(0xFFFFC857)
    val danger = Color(0xFFFF5C7A)
    val scrim = Color(0xCC0B0D10)
}

/** Shape tokens: panels are softly rounded, pills are fully round. */
object Corners {
    val panel = RoundedCornerShape(18.dp)
    val card = RoundedCornerShape(14.dp)
    val chip = RoundedCornerShape(10.dp)
    val pill = RoundedCornerShape(50)
}

/** Standard gaps, so spacing is consistent without a design-system dependency. */
object Gap {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
}

/** Minimum tap target; every control is at least this big. */
val TapTarget = 44.dp

@Composable
fun EditorTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Ink.accent,
            onPrimary = Ink.bg,
            background = Ink.bg,
            onBackground = Ink.text,
            surface = Ink.panel,
            onSurface = Ink.text,
            surfaceVariant = Ink.panelHigh,
            onSurfaceVariant = Ink.dim,
            outline = Ink.line,
            error = Ink.danger
        ),
        content = content
    )
}

/** A thin hairline used between timeline rows and inspector groups. */
@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.background(Ink.line))
}

/** A small dot used for keyframe markers and status lights. */
@Composable
fun Dot(color: Color, size: Int = 6) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(50)).background(color))
}

val LocalAccent = staticCompositionLocalOf { Ink.accent }
