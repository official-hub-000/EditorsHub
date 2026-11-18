package com.editorhub.nativeed.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The first screen.
 *
 * Every editor opens on a project list, not a blank canvas, because that is the question in the
 * user's head: *which* thing am I working on. The saved project is offered as a card with its
 * own name and layer count, the two ways to start are beside it, and the whole thing is
 * branded -- this is where the app says what it is before it asks anything of you.
 */
@Composable
fun LauncherScreen(
    projectName: String,
    layerCount: Int,
    onContinue: () -> Unit,
    onNewProject: () -> Unit,
    onOpenProject: () -> Unit
) {
    Box(Modifier.fillMaxSize().background(Ink.bg)) {
        // A single soft brand wash behind the header, so the screen is not a flat void.
        Box(
            Modifier
                .fillMaxWidth()
                .height(300.dp)
                .background(
                    Brush.verticalGradient(
                        listOf(Ink.accent.copy(alpha = .10f), Color.Transparent)
                    )
                )
        )

        Column(Modifier.fillMaxSize().padding(horizontal = Gap.xl)) {
            Spacer(Modifier.height(72.dp))
            BrandBadge(size = 62)
            Spacer(Modifier.height(Gap.lg))
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Editors", color = Ink.text, fontSize = 34.sp, fontWeight = FontWeight.Light)
                Text("Hub", color = Ink.accent, fontSize = 34.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(Gap.xs))
            Text(
                "MOTION GRAPHICS STUDIO",
                color = Ink.dim,
                fontSize = 9.sp,
                letterSpacing = 2.4.sp
            )
            Spacer(Modifier.height(Gap.xl))

            if (layerCount > 0) {
                Text("CONTINUE", color = Ink.dim, fontSize = 9.sp, letterSpacing = 1.4.sp)
                Spacer(Modifier.height(Gap.sm))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(Corners.card)
                        .background(Ink.panelHigh)
                        .clickable { onContinue() }
                        .padding(Gap.lg)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Ink.accent.copy(alpha = .16f)),
                            contentAlignment = Alignment.Center
                        ) { BrandMark(size = 22, onBrand = false) }
                        Spacer(Modifier.width(Gap.md))
                        Column(Modifier.weight(1f)) {
                            Text(projectName, color = Ink.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                if (layerCount == 1) "1 layer" else "$layerCount layers",
                                color = Ink.dim, fontSize = 11.sp
                            )
                        }
                        Text("\u25B6", color = Ink.accent, fontSize = 16.sp)
                    }
                }
                Spacer(Modifier.height(Gap.xl))
            }

            Text("START", color = Ink.dim, fontSize = 9.sp, letterSpacing = 1.4.sp)
            Spacer(Modifier.height(Gap.sm))

            Row(horizontalArrangement = Arrangement.spacedBy(Gap.md), modifier = Modifier.fillMaxWidth()) {
                ActionTile(
                    glyph = "+",
                    title = "New project",
                    subtitle = "1080 \u00D7 1920, 30 fps",
                    accent = true,
                    modifier = Modifier.weight(1f),
                    onClick = onNewProject
                )
                ActionTile(
                    glyph = "\u2630",
                    title = "Open file",
                    subtitle = ".editorshub",
                    accent = false,
                    modifier = Modifier.weight(1f),
                    onClick = onOpenProject
                )
            }

            Spacer(Modifier.weight(1f))
            Text(
                "Keyframes \u00B7 easing curves \u00B7 effects \u00B7 MP4 export",
                color = Ink.dim, fontSize = 10.sp
            )
            Spacer(Modifier.height(Gap.lg))
        }
    }
}

/** A large tap target for a primary action, with a glyph, a title and a hint. */
@Composable
private fun ActionTile(
    glyph: String,
    title: String,
    subtitle: String,
    accent: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Box(
        modifier
            .heightIn(min = 104.dp)
            .clip(Corners.card)
            .background(if (accent) Ink.accent else Ink.panelHigh)
            .clickable { onClick() }
            .padding(Gap.lg)
    ) {
        Column(Modifier.align(Alignment.TopStart)) {
            Text(
                glyph,
                color = if (accent) Ink.bg else Ink.accent,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(Gap.sm))
            Text(
                title,
                color = if (accent) Ink.bg else Ink.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                subtitle,
                color = if (accent) Ink.bg.copy(alpha = .7f) else Ink.dim,
                fontSize = 10.sp
            )
        }
    }
}
