package com.editorhub.nativeed.ui

import android.app.Activity
import android.graphics.Bitmap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.editorhub.nativeed.CompositionView
import com.editorhub.nativeed.PreviewSurface
import com.editorhub.nativeed.VideoFrames
import com.editorhub.nativeed.EditorStore
import com.editorhub.nativeed.Layer
import com.editorhub.nativeed.LayerKind
import com.editorhub.nativeed.MediaCache
import com.editorhub.nativeed.Playback
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The editor screen.
 *
 * Layout, top to bottom: transport bar, preview, timeline, inspector. That is the shape of
 * every phone editor that works -- the picture gets the top half, the timeline gets the
 * middle, and the numbers get the bottom -- and it means the two things people touch most
 * (the canvas and the timeline) are both in thumb reach without a mode switch.
 *
 * STATE
 * One [EditorStore] owns the document. A single [rev] counter is the UI's only subscription:
 * every mutation bumps it, which recomposes the panels once. The preview is NOT driven by
 * this counter -- it is a SurfaceView that gets a redraw request -- so dragging a layer at
 * 60 fps does not recompose the timeline 60 times a second. That split is the whole reason
 * this is fast on a phone.
 */
@Composable
fun EditorScreen(
    store: EditorStore,
    cache: MediaCache,
    onShare: () -> Unit = {},
    onExport: () -> Unit,
    onOpenSettings: () -> Unit = {}
) {
    val context = LocalContext.current
    var rev by remember { mutableStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var bitmaps by remember { mutableStateOf<Map<String, Bitmap>>(emptyMap()) }
    var sheet by remember { mutableStateOf(0) }  // 0 none, 1 add, 2 project
    var previewView by remember { mutableStateOf<CompositionView?>(null) }
    val previewRef = remember { java.util.concurrent.atomic.AtomicReference<CompositionView?>(null) }
    // Set while a slider or a canvas drag is reporting continuously. Continuous callbacks only
    // redraw the preview; panels refresh once, on gesture end. Otherwise a drag would rebuild
    // the whole inspector on every pixel and the drag itself would stutter -- the exact thing
    // this rewrite is meant to fix.
    var gestureActive by remember { mutableStateOf(false) }
    // The playhead as Compose state. It is read inside canvas draw lambdas (which records a
    // draw-scope read, not a recomposition) and by the time readout, so a moving playhead
    // repaints the timeline without rebuilding it. Without this the playhead would sit still
    // during playback while the preview animated, because store.time is not observable.
    val playhead = remember { androidx.compose.runtime.mutableDoubleStateOf(store.time) }
    // The store's callbacks run from Compose's effect scope, so they read the atomic rather
    // than a captured state object that would be stale inside the SurfaceView.
    val renderRequest: () -> Unit = { previewRef.get()?.requestRender() }

    // Reading `rev` is what subscribes this composable to store changes: every mutation bumps
    // it, so the panels rebuild once per edit while the preview is only asked for a frame.
    DisposableEffect(store) {
        store.onChange = { if (!gestureActive) rev++; renderRequest() }
        store.onTimeChange = { time -> playhead.doubleValue = time; renderRequest() }
        onDispose { store.onChange = null; store.onTimeChange = null }
    }

    // Decode whatever media the current project references, once per change of that set.
    val sources = store.project.layers.mapNotNull { it.sourceUri }.toSet()
    LaunchedEffect(sources, rev) {
        val missing = store.project.layers.filter {
            (it.kind == LayerKind.IMAGE || it.kind == LayerKind.VIDEO) && bitmaps[it.id] == null
        }
        if (missing.isEmpty()) return@LaunchedEffect
        val decoded = withContext(Dispatchers.IO) {
            val out = HashMap<String, Bitmap>()
            missing.forEach { layer ->
                cache.bitmap(layer.id, layer.sourceUri, store.project.width)?.let { out[layer.id] = it }
            }
            out
        }
        if (decoded.isNotEmpty()) bitmaps = bitmaps + decoded
    }

    // Video frames, decoded on a background thread and asked for at draw time.
    val videoFrames = remember(cache) { VideoFrames(cache) { renderRequest() } }
    DisposableEffect(videoFrames) {
        onDispose { videoFrames.releaseAll() }
    }

    val playback = remember(store) {
        Playback(
            store = store,
            onFrame = { renderRequest() },
            onStopped = { playing = false }
        )
    }

    // Photo picker for imports. Uses the system picker, so no storage permission is needed
    // on any supported Android version.
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val info = cache.describe(uri)
        store.addMedia(
            uri = uri,
            kind = LayerKind.IMAGE,
            displayName = info?.name ?: "image",
            width = info?.width ?: 1080,
            height = info?.height ?: 1080
        )
        rev++
    }
    val pickVideo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val info = cache.describe(uri)
        store.addMedia(
            uri = uri,
            kind = LayerKind.VIDEO,
            displayName = info?.name ?: "video",
            width = info?.width ?: 1080,
            height = info?.height ?: 1920
        )
        rev++
    }

    // Reading the counter is what subscribes this composable to store changes.
    @Suppress("UNUSED_EXPRESSION")
    rev

    Column(Modifier.fillMaxSize().background(Ink.bg)) {

        // ------------------------------------------------------------- transport
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = Gap.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            GlyphButton("\u21B6", enabled = store.canUndo) { store.undo(); rev++ }
            GlyphButton("\u21B7", enabled = store.canRedo) { store.redo(); rev++ }
            Spacer(Modifier.weight(1f))
            Text(
                store.project.name,
                color = Ink.text,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { sheet = 2 }
            )
            Spacer(Modifier.weight(1f))
            GlyphButton("\u21AA") { shareStill(context, store, bitmaps) }
            GlyphButton("\u2B07") { onExport() }
        }
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        // ---------------------------------------------------------------- preview
        Box(Modifier.fillMaxWidth().weight(1f).background(Color.Black)) {
            PreviewSurface(
                store = store,
                bitmaps = bitmaps,
                videoFrames = videoFrames,
                modifier = Modifier.fillMaxSize(),
                onReady = { view -> previewRef.set(view); previewView = view }
            )
            // Floating add button, bottom-start of the canvas.
            Box(Modifier.align(Alignment.BottomStart).padding(Gap.md)) {
                Pill("+ Add", active = true) { sheet = 1 }
            }
            Box(Modifier.align(Alignment.BottomEnd).padding(Gap.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
                    GlyphButton(if (playing) "\u275A\u275A" else "\u25B6") {
                        playback.toggle(); playing = playback.isPlaying; rev++
                    }
                    GlyphButton("\u21BA") { playback.seek(0.0); rev++ }
                }
            }
        }

        // --------------------------------------------------------------- timeline
        Row(Modifier.fillMaxWidth().height(26.dp).padding(horizontal = Gap.md), verticalAlignment = Alignment.CenterVertically) {
            Text("TIMELINE", color = Ink.dim, fontSize = 9.sp, letterSpacing = 1.sp)
            Spacer(Modifier.weight(1f))
            Text(
                "${String.format("%.2f", playhead.doubleValue)}s / ${String.format("%.2f", store.project.duration)}s \u00B7 ${store.project.fps}fps",
                color = Ink.dim, fontSize = 10.sp
            )
        }
        TimelinePanel(
            store = store,
            version = rev,
            playhead = playhead,
            modifier = Modifier.fillMaxWidth().height(196.dp),
            onSeek = { playback.seek(it) },
            onSeekEnd = { rev++ },
            onGestureStart = { gestureActive = true }
        )
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        // -------------------------------------------------------------- inspector
        Inspector(
            store = store,
            version = rev,
            modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 320.dp),
            onPickMedia = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            onGestureStart = { gestureActive = true },
            onGestureEnd = { gestureActive = false; rev++ }
        )
    }

    // ---------------------------------------------------------------- sheets
    if (sheet == 1) {
        AddSheet(
            onDismiss = { sheet = 0 },
            onShape = { kind -> store.addShape(kind); rev++; sheet = 0 },
            onText = { store.addText("Text"); rev++; sheet = 0 },
            onNull = { store.addNull(); rev++; sheet = 0 },
            onImage = {
                sheet = 0
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            onVideo = {
                sheet = 0
                pickVideo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
            }
        )
    }
    if (sheet == 2) {
        ProjectSheet(store, onDismiss = { sheet = 0 }, onChanged = { rev++ })
    }
}
