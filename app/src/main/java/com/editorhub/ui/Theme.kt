package com.editorhub.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The app's palette. One near-black, one accent, and a small ramp of greys between them. */
object Ink {
    val bg = Color(0xFF0B0D10)
    val panel = Color(0xFF14181D)
    val panelHigh = Color(0xFF1C2128)
    val line = Color(0xFF2A3139)
    val text = Color(0xFFE9EDF2)
    val dim = Color(0xFF8A94A0)
    val accent = Color(0xFF3AD9C6)
    val accentDeep = Color(0xFF22B8D4)
    val danger = Color(0xFFFF6B6B)
    val video = Color(0xFF2B7FFF)
    val audio = Color(0xFF9B7BFF)
}

object Corners {
    val card = 14.sp
    val pill = 999.sp
}

object Gap {
    val xs = 4.sp
    val sm = 8.sp
    val md = 12.sp
    val lg = 18.sp
    val xl = 26.sp
}

private val scheme = darkColorScheme(
    primary = Ink.accent,
    onPrimary = Ink.bg,
    secondary = Ink.accentDeep,
    background = Ink.bg,
    onBackground = Ink.text,
    surface = Ink.panel,
    onSurface = Ink.text,
    surfaceVariant = Ink.panelHigh,
    onSurfaceVariant = Ink.dim,
    outline = Ink.line,
    error = Ink.danger,
)

private val type = Typography(
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 13.sp),
    labelSmall = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.6.sp),
)

@Composable
fun EditorsHubTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
