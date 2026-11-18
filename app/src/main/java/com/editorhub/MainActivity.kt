package com.editorhub

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import com.editorhub.nativeed.EditorStore
import com.editorhub.nativeed.Exporter
import com.editorhub.nativeed.MediaCache
import com.editorhub.nativeed.ui.EditorScreen
import com.editorhub.nativeed.ui.EditorTheme
import com.editorhub.nativeed.ui.Gap
import com.editorhub.nativeed.ui.Ink
import com.editorhub.nativeed.ui.Pill
import com.editorhub.nativeed.ui.shareVideo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The native editor.
 *
 * Launcher of the app. Everything the user builds here lives in [EditorStore] and is written
 * to `filesDir/native-project.json` after every edit, so closing the app mid-project loses
 * nothing.
 *
 * The WebView editor is still installed and reachable from this screen's menu. It is not a
 * fallback that gets in the way: it is there because it has effects, LUTs and a 317-entry
 * catalogue that the native editor does not have yet, and hiding working features from the
 * user would be worse than keeping two doors.
 */
class MainActivity : ComponentActivity() {

    /**
     * The document lives in the Application, not the Activity.
     *
     * A rotation destroys and recreates the Activity; if the store were an Activity field the
     * undo history would be lost and the project would be re-read from disk mid-gesture. This
     * is the standard fix for that and it costs one property.
     */
    private val store: EditorStore get() = EditorsHubApplication.store(this)
    private lateinit var cache: MediaCache

    private var exportState: ExportState by mutableStateOf(ExportState.Idle)

    /** Where the export is up to, for the overlay. */
    sealed interface ExportState {
        object Idle : ExportState
        data class Running(val fraction: Float) : ExportState
        data class Done(val file: File) : ExportState
        data class Failed(val message: String) : ExportState
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        // Keep whatever the user had. A missing or unreadable file starts a new project.
        if (!store.loaded) store.bootstrap()
        cache = MediaCache(this)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                store.save()
                finish()
            }
        })

        setContent {
            EditorTheme {
                Box(Modifier.fillMaxSize().background(Ink.bg)) {
                    EditorScreen(
                        store = store,
                        cache = cache,
                        onShare = { /* handled inside the screen via FileProvider */ },
                        onExport = { startExport() },
                        onOpenSettings = { openWebEditor() }
                    )
                    when (val state = exportState) {
                        is ExportState.Running -> ExportOverlay(state.fraction, onCancel = { exportState = ExportState.Idle })
                        is ExportState.Done -> ExportDoneOverlay(
                            file = state.file,
                            onShare = { shareVideo(this@MainActivity, state.file); exportState = ExportState.Idle },
                            onDismiss = { exportState = ExportState.Idle }
                        )
                        is ExportState.Failed -> ExportFailedOverlay(state.message) { exportState = ExportState.Idle }
                        ExportState.Idle -> Unit
                    }
                    // A discreet way into the WebView editor without burying it in a menu.
                    Box(Modifier.align(Alignment.TopEnd).padding(Gap.sm)) {
                        Pill("Effects \u2197") { openWebEditor() }
                    }
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        store.save()
    }

    private fun openWebEditor() {
        startActivity(Intent(this, EditorActivity::class.java))
    }

    /**
     * Encodes the project off the main thread.
     *
     * The export runs on a background dispatcher because the frame loop is CPU-bound (the
     * BGRA-to-YUV conversion is per pixel); running it on the main thread would freeze the
     * UI for the whole encode. Progress hops back to the main thread per frame batch.
     */
    private fun startExport() {
        if (exportState is ExportState.Running) return
        val project = store.project.copyOf()
        if (project.layers.isEmpty()) {
            Toast.makeText(this, "Add a layer first", Toast.LENGTH_SHORT).show()
            return
        }
        exportState = ExportState.Running(0f)
        val bitmaps: Map<String, Bitmap> = store.project.layers.associate { layer ->
            layer.id to (cache.bitmap(layer.id, layer.sourceUri, project.width) ?: Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888))
        }
        val dir = File(cacheDir, "export").apply { mkdirs() }
        val out = File(dir, "editorshub-${System.currentTimeMillis()}.mp4")
        val exporter = Exporter(this)
        // A snapshot, not a live store: edits made during the encode must not change a frame
        // that has already been handed to the encoder, or the file would contain two versions
        // of the project spliced together.
        val canvasView = com.editorhub.nativeed.CompositionView(this).apply {
            this.bitmaps = bitmaps
            // Export pulls the exact frame for each instant, snapped to the nearest keyframe
            // only when the exact frame would be slow. That is what stops an exported video
            // from being one still per layer.
            this.videoFrame = { layer, time ->
                val offset = ((time - layer.start) * 1000.0 * layer.speed).toLong().coerceAtLeast(0L)
                cache.videoFrame(layer.sourceUri ?: "", layer.id, offset, targetWidth = project.width, exact = true)
            }
        }

        lifecycleScope.launch {
            val file = withContext(Dispatchers.Default) {
                exporter.export(
                    project = project,
                    bitmaps = bitmaps,
                    out = out,
                    drawFrame = { canvas, proj, time -> canvasView.drawComposition(canvas, proj, time, null, forExport = true) },
                    onProgress = { progress ->
                        runOnUiThread { exportState = ExportState.Running(progress.fraction) }
                    }
                )
            }
            exportState = if (file != null) ExportState.Done(file)
            else ExportState.Failed("The video encoder refused this project. Try 30 fps or a smaller composition.")
        }
    }

}

// ---------------------------------------------------------------- overlays

@Composable
private fun ExportOverlay(fraction: Float, onCancel: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(280.dp).clip(RoundedCornerShape(20.dp)).background(Ink.panel).padding(Gap.xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Rendering", color = Ink.text, fontSize = 15.sp)
            Spacer(Modifier.height(Gap.md))
            Box(Modifier.width(220.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Ink.line)) {
                Box(Modifier.width((220 * fraction.coerceIn(0f, 1f)).dp).height(6.dp).background(Ink.accent))
            }
            Spacer(Modifier.height(Gap.sm))
            Text("${(fraction * 100).toInt()}%", color = Ink.dim, fontSize = 12.sp)
            Spacer(Modifier.height(Gap.lg))
            Pill("Hide", onClick = onCancel)
        }
    }
}

@Composable
private fun ExportDoneOverlay(file: File, onShare: () -> Unit, onDismiss: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(300.dp).clip(RoundedCornerShape(20.dp)).background(Ink.panel).padding(Gap.xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Video ready", color = Ink.text, fontSize = 15.sp)
            Spacer(Modifier.height(Gap.sm))
            Text(
                "${file.name} \u00B7 ${"%.1f".format(file.length() / 1_048_576f)} MB",
                color = Ink.dim, fontSize = 11.sp
            )
            Spacer(Modifier.height(Gap.lg))
            Row {
                Pill("Share", active = true, onClick = onShare)
                Spacer(Modifier.width(Gap.sm))
                Pill("Close", onClick = onDismiss)
            }
        }
    }
}

@Composable
private fun ExportFailedOverlay(message: String, onDismiss: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(300.dp).clip(RoundedCornerShape(20.dp)).background(Ink.panel).padding(Gap.xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Export failed", color = Ink.danger, fontSize = 15.sp)
            Spacer(Modifier.height(Gap.sm))
            Text(message, color = Ink.dim, fontSize = 12.sp)
            Spacer(Modifier.height(Gap.lg))
            Pill("Close", onClick = onDismiss)
        }
    }
}
