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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.editorhub.engine.EditorStore
import com.editorhub.engine.Layer
import com.editorhub.engine.LayerKind
import com.editorhub.engine.PreviewGLView
import kotlinx.coroutines.delay

/**
 * The editor screen: brand bar, preview, inspector, timeline.
 *
 * Playback is a coroutine that advances the playhead from a monotonic clock rather than from the
 * frame callback, so a late frame does not slow the whole project down.
 */
@Composable
fun EditorScreen(
    store: EditorStore,
    onBack: () -> Unit,
    onExport: () -> Unit,
    onShare: () -> Unit,
    bitmapFor: (Layer) -> android.graphics.Bitmap?,
) {
    var preview by remember { mutableStateOf<PreviewGLView?>(null) }
    var fps by remember { mutableStateOf(0) }

    // Playback clock.
    LaunchedEffect(store.playing) {
        if (!store.playing) return@LaunchedEffect
        var last = System.nanoTime()
        while (store.playing) {
            delay(16)
            val now = System.nanoTime()
            val delta = (now - last) / 1_000_000_000f
            last = now
            val next = store.playhead + delta
            store.playhead = if (next >= store.composition.duration) {
                store.playing = false
                0f
            } else next
            preview?.invalidatePreview()
        }
    }

    DisposableEffect(Unit) {
        onDispose { store.playing = false }
    }

    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        BrandBar(
            title = store.composition.name,
            onBack = onBack,
            onShare = onShare,
            onExport = onExport,
        )

        // Preview. The GL view is created once and told what to draw.
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(Corners.card)),
                factory = { context ->
                    PreviewGLView(context).apply {
                        provider = { store.composition to store.playhead }
                        bitmaps = { layer -> bitmapFor(layer) }
                        onFrameMs = { ms -> if (ms > 0f) fps = (1000f / ms).toInt() }
                        preview = this
                    }
                },
                update = { it.invalidatePreview() },
            )
        }

        // Transport.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GlyphButton("↺", enabled = store.canUndo) { store.undo() }
            GlyphButton("↻", enabled = store.canRedo) { store.redo() }
            Spacer(Modifier.weight(1f))
            GlyphButton(
                if (store.playing) "❚❚" else "▶",
                tint = Ink.accent,
                size = 44,
            ) {
                store.playing = !store.playing
            }
            Spacer(Modifier.weight(1f))
            Text("$fps fps", color = Ink.dim, fontSize = 10.sp)
            GlyphButton("+") { addLayerMenu(store) }
        }

        Inspector(store, Modifier.fillMaxWidth().height(232.dp))
        Spacer(Modifier.height(1.dp))
        Timeline(store, Modifier.fillMaxWidth())
    }
}

@Composable
private fun BrandBar(title: String, onBack: () -> Unit, onShare: () -> Unit, onExport: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("‹", color = Ink.text, fontSize = 22.sp, modifier = Modifier.clickable { onBack() })
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .width(4.dp)
                .height(18.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Ink.accent),
        )
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                "EditorsHub",
                color = Ink.text,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-.2).sp,
            )
            Text(title.uppercase(), color = Ink.dim, fontSize = 8.5.sp, letterSpacing = 1.sp)
        }
        Spacer(Modifier.weight(1f))
        TextButtonSmall("Share") { onShare() }
        Spacer(Modifier.width(6.dp))
        TextButtonSmall("Export", accent = true) { onExport() }
    }
}

/** Adds a layer with a sane default at the playhead. */
private fun addLayerMenu(store: EditorStore) {
    val start = store.playhead
    store.addLayer(
        com.editorhub.engine.Layer(
            kind = LayerKind.SHAPE,
            name = "Shape ${store.composition.layers.size + 1}",
            start = start,
            duration = 3f,
        ),
    )
}
