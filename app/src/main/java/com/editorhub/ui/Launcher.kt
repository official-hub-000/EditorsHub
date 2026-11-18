package com.editorhub.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.editorhub.engine.EditorStore

/** The first screen: what you are working on, and the two ways to start. */
@Composable
fun LauncherScreen(
    store: EditorStore,
    onOpen: () -> Unit,
    onNew: () -> Unit,
    onImport: () -> Unit,
    onOpenProject: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Ink.bg).padding(20.dp)) {
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The mark is drawn, not typed: a glyph's metrics differ per device, and the brand
            // badge has to look identical to the launcher icon.
            androidx.compose.foundation.Canvas(Modifier.size(38.dp)) {
                val s = size.minDimension
                drawRoundRect(
                    brush = Brush.linearGradient(
                        listOf(Ink.accent, Ink.accentDeep),
                        start = androidx.compose.ui.geometry.Offset.Zero,
                        end = androidx.compose.ui.geometry.Offset(s, s),
                    ),
                    size = androidx.compose.ui.geometry.Size(s, s),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(s * .28f, s * .28f),
                )
                val left = s * .26f
                val right = s * .74f
                val top = s * .28f
                val bottom = s * .72f
                val stem = s * .10f
                val arm = s * .085f
                val mid = (top + bottom) / 2f
                val p = androidx.compose.ui.graphics.Path()
                p.addRect(androidx.compose.ui.geometry.Rect(left, top, left + stem, bottom))
                p.addRect(androidx.compose.ui.geometry.Rect(left, top, right, top + arm))
                p.addRect(androidx.compose.ui.geometry.Rect(left, mid - arm / 2, right - s * .10f, mid + arm / 2))
                p.addRect(androidx.compose.ui.geometry.Rect(left, bottom - arm, right - s * .04f, bottom))
                drawPath(p, Ink.bg)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Row {
                    Text("Editors", color = Ink.text, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                    Text("Hub", color = Ink.accent, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                }
                Text(
                    "MOTION GRAPHICS",
                    color = Ink.dim,
                    fontSize = 8.5.sp,
                    letterSpacing = 1.8.sp,
                )
            }
        }

        Spacer(Modifier.height(30.dp))
        SectionLabel("Continue")
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Corners.card))
                .background(Ink.panel)
                .border(1.dp, Ink.line, RoundedCornerShape(Corners.card))
                .clickable { onOpen() }
                .padding(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Thumb("P", Ink.accent, size = 40)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        store.composition.name,
                        color = Ink.text,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        "${store.composition.layers.size} layers · ${store.composition.width}×${store.composition.height}",
                        color = Ink.dim,
                        fontSize = 10.5.sp,
                    )
                }
                Text("›", color = Ink.dim, fontSize = 20.sp)
            }
        }

        Spacer(Modifier.height(20.dp))
        SectionLabel("Start")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionTile("New project", "Empty timeline", Ink.accent, Modifier.weight(1f)) { onNew() }
            ActionTile("Open file", "Project or media", Ink.video, Modifier.weight(1f)) { onOpenProject() }
        }
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Corners.card))
                .background(Ink.panel)
                .clickable { onImport() }
                .padding(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Import media", color = Ink.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.weight(1f))
                Text("image · video", color = Ink.dim, fontSize = 10.sp)
            }
        }

        Spacer(Modifier.weight(1f))
        Text(
            "Keyframes, easing and a GPU canvas — all offline.",
            color = Ink.line,
            fontSize = 9.5.sp,
        )
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun ActionTile(
    title: String,
    subtitle: String,
    tint: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .clip(RoundedCornerShape(Corners.card))
            .background(Ink.panel)
            .border(1.dp, Ink.line, RoundedCornerShape(Corners.card))
            .clickable { onClick() }
            .padding(14.dp),
    ) {
        Box(
            Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(tint.copy(alpha = .18f)),
            contentAlignment = Alignment.Center,
        ) {
            Text("+", color = tint, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, color = Ink.text, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
        Text(subtitle, color = Ink.dim, fontSize = 9.5.sp)
    }
}
