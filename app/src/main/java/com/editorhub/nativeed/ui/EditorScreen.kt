package com.editorhub.nativeed.ui

import android.app.Activity
import android.graphics.Bitmap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.ui.input.pointer.pointerInput
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
    onOpenSettings: () -> Unit = {},
    onSaveProject: () -> Unit = {},
    onOpenProject: () -> Unit = {},
    /** True when the previous run crashed; a small button appears so it can be sent. */
    hasCrashReport: Boolean = false,
    onShareCrashReport: () -> Unit = {}
) {
    val context = LocalContext.current
    var rev by remember { mutableStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var bitmaps by remember { mutableStateOf<Map<String, Bitmap>>(emptyMap()) }
    var sheet by remember { mutableStateOf(0) }  // 0 none, 1 add, 2 project
    // A plain holder rather than Compose state: the preview view must not be remembered across
    // a configuration change (the old surface is gone), and storing it in `mutableStateOf`
    // would make every read of it a snapshot read inside callbacks that run off the compositions.
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
        store.onChange = {
            if (!gestureActive) rev++
            renderRequest()
        }
        store.onTimeChange = { time -> playhead.doubleValue = time; renderRequest() }
        onDispose {
            store.onChange = null
            store.onTimeChange = null
            // Dropping the reference is not cosmetic: the callbacks above outlive the
            // composition if the store outlives the activity, and a stale SurfaceView would
            // then be asked to draw onto a surface that no longer exists.
            previewRef.set(null)
        }
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

    // A visible frame meter, off until asked for. "It feels laggy" is a real report and a
    // number makes it actionable: this is what turns it into "34 fps, dropped 12 frames on
    // that scrub" and decides whether the fault is drawing, decoding or the clock.
    var showFps by remember { mutableStateOf(false) }
    var fpsValue by remember { mutableStateOf(0) }
    var droppedValue by remember { mutableStateOf(0) }

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

    // How much room the inspector takes. Dragging it down to a handle is how the preview
    // gets the whole screen for framing a shot; there is no other view mode to switch to,
    // because a phone does not have the room for one and people forget which mode they
    // are in anyway.
    var inspectorHeight by remember { mutableStateOf(268.dp) }

    Column(Modifier.fillMaxSize().background(Ink.bg)) {

        // ------------------------------------------------------------- transport
        Row(
            Modifier.fillMaxWidth().height(52.dp).padding(horizontal = Gap.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            GlyphButton("\u21B6", enabled = store.canUndo) { store.undo(); rev++ }
            GlyphButton("\u21B7", enabled = store.canRedo) { store.redo(); rev++ }
            GlyphButton("\u2398", enabled = store.selectedLayerId != null) { store.copySelected() }
            GlyphButton("\u2398\u002B", enabled = store.canPaste) { store.paste(); rev++ }
            Spacer(Modifier.weight(1f))
            Text(
                store.project.name,
                color = Ink.text,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable { sheet = 2 }
            )
            Spacer(Modifier.weight(1f))
            if (hasCrashReport) {
                // Small and out of the way, but present until a run finishes normally. Tapping
                // it sends the trace; the point is that a fault on a phone in someone's hand
                // is otherwise unreachable without a cable.
                GlyphButton("\u26A0", tint = Ink.key) { onShareCrashReport() }
            }
            GlyphButton("\u21AA") { shareStill(context, store, bitmaps) }
            GlyphButton("\u2B07") { onExport() }
        }
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        // ---------------------------------------------------------------- preview
        Box(Modifier.fillMaxWidth().weight(1f).heightIn(min = 200.dp).background(Color.Black)) {
            PreviewSurface(
                store = store,
                bitmaps = bitmaps,
                videoFrames = videoFrames,
                modifier = Modifier.fillMaxSize(),
                onReady = { view ->
                    previewRef.set(view)
                    view.onFrames = { frames, dropped ->
                        if (showFps) { fpsValue = frames; droppedValue = dropped }
                    }
                }
            )
            // Floating add button, bottom-start of the canvas.
            Box(Modifier.align(Alignment.BottomStart).padding(Gap.md)) {
                Pill("+ Add", active = true) { sheet = 1 }
            }
            // Frame meter, top-start of the canvas so it never sits under a finger.
            if (showFps) {
                Box(Modifier.align(Alignment.TopStart).padding(Gap.md)) {
                    Box(
                        Modifier
                            .clip(Corners.chip)
                            .background(Color(0xB3000000))
                            .padding(horizontal = Gap.sm, vertical = Gap.xs)
                    ) {
                        Text(
                            "$fpsValue fps \u00B7 $droppedValue dropped",
                            color = if (fpsValue >= 50) Ink.accent else Ink.key,
                            fontSize = 10.sp
                        )
                    }
                }
            }
            Box(Modifier.align(Alignment.BottomEnd).padding(Gap.md)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Gap.sm)) {
                    // Step to the previous keyframe: the fastest way to inspect an
                    // animation is to jump between its keys instead of scrubbing.
                    GlyphButton("\u25C0|") {
                        store.previousKeyframe()?.let { playback.seek(it) }; rev++
                    }
                    GlyphButton(if (playing) "\u275A\u275A" else "\u25B6") {
                        playback.toggle(); playing = playback.isPlaying; rev++
                    }
                    GlyphButton("|\u25B6") {
                        store.nextKeyframe()?.let { playback.seek(it) }; rev++
                    }
                    GlyphButton("\u21BA") { playback.seek(0.0); rev++ }
                    // Small, and only useful when someone is chasing jank: tap to show the
                    // measured frame rate and the number of frames the display skipped.
                    GlyphButton("fps", tint = if (showFps) Ink.accent else Ink.dim) { showFps = !showFps }
                }
            }
        }

        // --------------------------------------------------------------- timeline
        Row(
            Modifier.fillMaxWidth().height(24.dp).padding(horizontal = Gap.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
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
            modifier = Modifier.fillMaxWidth().height(176.dp),
            onSeek = { playback.seek(it) },
            onSeekEnd = { rev++ },
            onGestureStart = { gestureActive = true }
        )
        Hairline(Modifier.fillMaxWidth().height(1.dp))

        // -------------------------------------------------------------- inspector
        // Inspector: a fixed-height panel with a drag handle. The handle is the only thing
        // that resizes it, so a swipe inside the controls still scrolls them.
        Row(
            Modifier
                .fillMaxWidth()
                .height(22.dp)
                .background(Ink.panel)
                .pointerInput(Unit) {
                    // Track the running total of the drag rather than each delta: a finger
                    // wobbles, and deciding per-delta makes the panel flicker between open and
                    // closed. The total is then clamped to a sane range so it can also be left
                    // half-open, which is what you want while comparing a value against the
                    // picture.
                    var total = 0f
                    detectVerticalDragGestures(
                        onDragStart = { total = 0f },
                        onDragEnd = {
                            // A slow drag that ended near a stop snaps to it; anything else is
                            // left where the finger put it.
                            val px = inspectorHeight.value
                            inspectorHeight = when {
                                px < 80f -> 34.dp
                                px > 300f -> 320.dp
                                else -> px.dp
                            }
                        }
                    ) { _, drag ->
                        total += drag
                        val next = (inspectorHeight.value - drag / 2f).coerceIn(0f, 360f)
                        inspectorHeight = next.dp
                    }
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Box(Modifier.size(width = 48.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(Ink.line))
        }
        Inspector(
            store = store,
            version = rev,
            modifier = Modifier.fillMaxWidth().height(inspectorHeight),
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
        ProjectSheet(
            store,
            onDismiss = { sheet = 0 },
            onChanged = { rev++ },
            onSaveFile = { sheet = 0; onSaveProject() },
            onOpenFile = { sheet = 0; onOpenProject() }
        )
    }
}
