package com.editorhub.nativeed.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.editorhub.nativeed.EditorStore
import com.editorhub.nativeed.ShapeKind

/**
 * The add sheet.
 *
 * Every entry creates a layer immediately, positioned in the middle of the composition.
 * There is no second "choose options" screen: a tap gets you a layer you can see, drag and
 * animate. Empty-but-present beats a wizard.
 */
@Composable
fun AddSheet(
    onDismiss: () -> Unit,
    onShape: (ShapeKind) -> Unit,
    onText: () -> Unit,
    onNull: () -> Unit,
    onImage: () -> Unit,
    onVideo: () -> Unit
) {
    SheetScaffold(title = "Add layer", onDismiss = onDismiss) {
        val items = listOf(
            Triple("\u25A0", "Rectangle", { onShape(ShapeKind.RECT) }),
            Triple("\u25CF", "Ellipse", { onShape(ShapeKind.ELLIPSE) }),
            Triple("\u25B2", "Triangle", { onShape(ShapeKind.TRIANGLE) }),
            Triple("T", "Text", onText),
            Triple("\u25A3", "Image", onImage),
            Triple("\u25B6", "Video", onVideo),
            Triple("+", "Null", onNull)
        )
        Column {
            items.chunked(2).forEach { rowItems ->
                Row(Modifier.fillMaxWidth().padding(bottom = Gap.sm), horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
                    rowItems.forEach { (glyph, label, action) ->
                        Box(
                            Modifier
                                .weight(1f)
                                .heightIn(min = 72.dp)
                                .clip(Corners.card)
                                .background(Ink.panelHigh)
                                .clickable { action() }
                                .padding(Gap.md),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            Column {
                                Text(glyph, color = Ink.accent, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(Gap.xs))
                                Text(label, color = Ink.text, fontSize = 13.sp)
                            }
                        }
                    }
                    if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

/**
 * Composition settings.
 *
 * Changing the aspect ratio keeps layers where they are in absolute pixels, which is the
 * behaviour people expect when they flip between 9:16 and 1:1 and then move things back.
 * Frame rate and duration are editable because export speed and file size depend on both.
 */
@Composable
fun ProjectSheet(store: EditorStore, onDismiss: () -> Unit, onChanged: () -> Unit) {
    var name by remember { mutableStateOf(store.project.name) }
    val presets = listOf(
        "9:16" to (1080 to 1920),
        "1:1" to (1080 to 1080),
        "4:5" to (1080 to 1350),
        "16:9" to (1920 to 1080),
        "4K" to (2160 to 3840)
    )
    SheetScaffold(title = "Composition", onDismiss = onDismiss) {
        Column {
            Text("Preset", color = Ink.dim, fontSize = 11.sp)
            Spacer(Modifier.height(Gap.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm), modifier = Modifier.padding(bottom = Gap.md)) {
                presets.forEach { (label, size) ->
                    Pill(
                        label,
                        active = store.project.width == size.first && store.project.height == size.second
                    ) {
                        store.checkpoint()
                        store.project.width = size.first
                        store.project.height = size.second
                        store.scheduleSave()
                        onChanged()
                    }
                }
            }

            Text("Frame rate", color = Ink.dim, fontSize = 11.sp)
            Spacer(Modifier.height(Gap.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm), modifier = Modifier.padding(bottom = Gap.md)) {
                listOf(24, 30, 60).forEach { fps ->
                    Pill("$fps fps", active = store.project.fps == fps) {
                        store.checkpoint(); store.project.fps = fps; store.scheduleSave(); onChanged()
                    }
                }
            }

            ValueSlider(
                label = "Duration", value = store.project.duration.toFloat(), range = 1f..120f,
                format = { "${it.toInt()}s" },
                onStart = { store.checkpoint() },
                onChange = { store.project.duration = it.toDouble(); store.scheduleSave(); onChanged() }
            )
            ValueSlider(
                label = "Background brightness", value = store.project.background.let { android.graphics.Color.red(it) / 255f },
                range = 0f..1f,
                format = { "${(it * 100).toInt()}%" },
                onStart = { store.checkpoint() },
                onChange = {
                    val grey = (it * 255).toInt().coerceIn(0, 255)
                    store.project.background = android.graphics.Color.rgb(grey, grey, grey)
                    store.scheduleSave(); onChanged()
                }
            )

            Spacer(Modifier.height(Gap.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
                Pill("New project") {
                    store.newProject(1080, 1920, 30, 10.0)
                    onChanged(); onDismiss()
                }
                Pill("Save now") { store.save(); onDismiss() }
            }
        }
    }
}

/** A bottom sheet: scrim, rounded panel, tap-outside to dismiss. */
@Composable
fun SheetScaffold(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Ink.scrim).clickable { onDismiss() }) {
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                .background(Ink.panel)
                // Consumes taps so a tap inside the sheet does not fall through to the scrim
                // and dismiss it; `clickable(enabled=false)` does not consume anything.
                .pointerInput(Unit) { detectTapGestures { } }
                .padding(Gap.lg)
                .heightIn(max = 520.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = Ink.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(32.dp).clickable { onDismiss() }, contentAlignment = Alignment.Center) {
                    Text("\u2715", color = Ink.dim, fontSize = 15.sp)
                }
            }
            Spacer(Modifier.height(Gap.md))
            content()
            Spacer(Modifier.height(Gap.lg))
        }
    }
}
