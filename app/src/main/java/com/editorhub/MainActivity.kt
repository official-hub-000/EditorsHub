package com.editorhub

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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

    private companion object {
        const val REQUEST_SAVE_PROJECT = 7301
        const val REQUEST_OPEN_PROJECT = 7302
    }
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

        // A build that crashes on this device is worse than an older build that runs. After
        // two consecutive crashes the app opens the WebView editor instead of the native one,
        // so the user still has an editor and can still send the trace.
        if (CrashLog.shouldFallBack(this)) {
            openWebEditor()
            finish()
            return
        }

        try {
            // Keep whatever the user had. A missing or unreadable file starts a new project.
            if (!store.loaded) store.bootstrap()
            cache = MediaCache(this)
        } catch (t: Throwable) {
            // Document loading is the one startup step that touches foreign data (a project
            // file, a photo the user picked). If it throws, keep a copy and start clean rather
            // than refusing to open the app at all.
            runCatching {
                File(filesDir, "native-project.json").copyTo(
                    File(filesDir, "native-project.recovered.json"), overwrite = true
                )
            }
            store.emergencyReset()
            cache = MediaCache(this)
        }

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
                        onExport = { showExportSheet = true },
                        onOpenSettings = { openWebEditor() },
                        onSaveProject = { saveProjectFile() },
                        onOpenProject = { openProjectFile() },
                        hasCrashReport = CrashLog.pending(this@MainActivity) != null,
                        onShareCrashReport = { shareCrashReport() }
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
                    if (showExportSheet) {
                        ExportSettingsSheet(
                            width = exportWidth,
                            fps = exportFps,
                            onWidth = { exportWidth = it },
                            onFps = { exportFps = it },
                            onDismiss = { showExportSheet = false },
                            onStart = { showExportSheet = false; startExport() }
                        )
                    }
                    // A discreet way into the WebView editor without burying it in a menu.
                    Box(Modifier.align(Alignment.TopEnd).padding(Gap.sm)) {
                        Pill("Effects \u2197") { openWebEditor() }
                    }
                }
            }
        }
    }

    /**
     * Writes the project as a `.editorshub` file the user picks a location for.
     *
     * Through the Storage Access Framework, so no storage permission is needed and the file
     * lands wherever the user's own file manager can find it -- Drive, Downloads, an SD card.
     */
    private fun saveProjectFile() {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "${store.project.name.ifBlank { "project" }}.editorshub")
        }
        runCatching {
            startActivityForResult(intent, REQUEST_SAVE_PROJECT)
        }.onFailure {
            Toast.makeText(this, "No file manager to save with", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openProjectFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        runCatching {
            startActivityForResult(intent, REQUEST_OPEN_PROJECT)
        }.onFailure {
            Toast.makeText(this, "No file manager to open with", Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Kept for the Storage Access Framework results on all supported versions")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_SAVE_PROJECT && requestCode != REQUEST_OPEN_PROJECT) return
        val uri = if (resultCode == RESULT_OK) data?.data else null
        if (uri == null) return
        runCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        when (requestCode) {
            REQUEST_SAVE_PROJECT -> runCatching {
                contentResolver.openOutputStream(uri)?.use { out ->
                    out.write(store.exportJson().toByteArray())
                }
                Toast.makeText(this, "Project saved", Toast.LENGTH_SHORT).show()
            }.onFailure {
                Toast.makeText(this, "Could not write that file", Toast.LENGTH_SHORT).show()
            }
            REQUEST_OPEN_PROJECT -> runCatching {
                val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                val ok = text != null && store.importJson(text)
                Toast.makeText(
                    this,
                    if (ok) "Project opened" else "That file is not an EditorsHub project",
                    Toast.LENGTH_SHORT
                ).show()
            }.onFailure {
                Toast.makeText(this, "Could not read that file", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        runCatching { store.save() }
    }

    override fun onResume() {
        super.onResume()
        // Reaching onResume means the screen was built and shown once. Clearing the streak
        // here rather than in onCreate matters: a crash inside the first composition would
        // never get this far, which is exactly the case the fallback is for.
        if (startedAt == 0L) {
            startedAt = System.currentTimeMillis()
        } else if (System.currentTimeMillis() - startedAt > 1500) {
            CrashLog.clear(this)
        }
    }

    private var startedAt = 0L

    /**
     * Sends the last crash trace wherever the user wants.
     *
     * The point of the crash log is that the user can get it here without a cable, so this
     * hands the whole text to the share sheet rather than showing a path they cannot reach.
     */
    private fun shareCrashReport() {
        val text = CrashLog.shareText(this)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "EditorsHub crash report")
            putExtra(Intent.EXTRA_TEXT, text)
        }
        runCatching { startActivity(Intent.createChooser(intent, "Send crash report")) }
    }

    private fun openWebEditor() {
        startActivity(Intent(this, EditorActivity::class.java))
    }

    // Export options, chosen before a render starts.
    private var exportWidth = 1080
    private var exportFps = 30
    private var showExportSheet by mutableStateOf(false)

    /**
     * Encodes the project off the main thread.
     *
     * The export runs on a background dispatcher because the frame loop is CPU-bound (the
     * ARGB-to-YUV conversion is per pixel); running it on the main thread would freeze the
     * UI for the whole encode. Progress hops back to the main thread per frame.
     */
    private fun startExport() {
        if (exportState is ExportState.Running) return
        val project = store.project.copyOf()
        // Export at the requested size and rate, whatever the composition is set to: people
        // routinely edit at 1080 and publish at 720 to keep the upload quick.
        val aspect = if (store.project.width > 0) store.project.height.toFloat() / store.project.width else 16f / 9f
        project.width = exportWidth
        project.height = ((exportWidth * aspect).toInt() / 2 * 2).coerceAtLeast(2)
        project.fps = exportFps
        if (project.layers.isEmpty()) {
            Toast.makeText(this, "Add a layer first", Toast.LENGTH_SHORT).show()
            return
        }
        exportState = ExportState.Running(0f)
        // Decoding happens inside the coroutine below, not here: a 4K photo takes long enough
        // to drop frames if it is decoded on the main thread while the overlay animates in.
        val dir = File(cacheDir, "export").apply { mkdirs() }
        val out = File(dir, "editorshub-${System.currentTimeMillis()}.mp4")
        val exporter = Exporter(this)
        // A snapshot, not a live store: edits made during the encode must not change a frame
        // that has already been handed to the encoder, or the file would contain two versions
        // of the project spliced together.
        val canvasView = com.editorhub.nativeed.CompositionView(this).apply {
            // Export pulls the exact frame for each instant, snapped to the nearest keyframe
            // only when the exact frame would be slow. That is what stops an exported video
            // from being one still per layer.
            this.videoFrame = { layer, time ->
                val offset = ((time - layer.start) * 1000.0 * layer.speed).toLong().coerceAtLeast(0L)
                cache.videoFrame(layer.sourceUri ?: "", layer.id, offset, targetWidth = project.width, exact = true)
            }
        }

        lifecycleScope.launch {
            val bitmaps = withContext(Dispatchers.IO) {
                store.project.layers.associate { layer ->
                    layer.id to (cache.bitmap(layer.id, layer.sourceUri, project.width)
                        ?: Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888))
                }
            }
            canvasView.bitmaps = bitmaps
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

/**
 * Export settings.
 *
 * Resolution and frame rate are the two choices that change what people can do with the
 * file, so they are asked once, up front, instead of being buried in project settings that
 * also change the editing canvas.
 */
@Composable
private fun ExportSettingsSheet(
    width: Int,
    fps: Int,
    onWidth: (Int) -> Unit,
    onFps: (Int) -> Unit,
    onDismiss: () -> Unit,
    onStart: () -> Unit
) {
    androidx.compose.foundation.layout.Box(
        Modifier.fillMaxSize().background(Color(0xCC000000)).clickable { onDismiss() },
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier.width(320.dp).clip(RoundedCornerShape(20.dp)).background(Ink.panel).padding(Gap.xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Export video", color = Ink.text, fontSize = 15.sp)
            Spacer(Modifier.height(Gap.lg))
            Text("Resolution", color = Ink.dim, fontSize = 11.sp)
            Spacer(Modifier.height(Gap.sm))
            Row {
                listOf(720, 1080, 1440).forEach { size ->
                    Pill("$size p", active = width == size, onClick = { onWidth(size) })
                    Spacer(Modifier.width(Gap.sm))
                }
            }
            Spacer(Modifier.height(Gap.md))
            Text("Frame rate", color = Ink.dim, fontSize = 11.sp)
            Spacer(Modifier.height(Gap.sm))
            Row {
                listOf(24, 30, 60).forEach { rate ->
                    Pill("$rate fps", active = fps == rate, onClick = { onFps(rate) })
                    Spacer(Modifier.width(Gap.sm))
                }
            }
            Spacer(Modifier.height(Gap.xl))
            Row {
                Pill("Render", active = true, onClick = onStart)
                Spacer(Modifier.width(Gap.sm))
                Pill("Cancel", onClick = onDismiss)
            }
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
