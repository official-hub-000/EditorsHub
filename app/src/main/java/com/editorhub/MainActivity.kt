package com.editorhub

import android.app.Activity
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import com.editorhub.engine.EditorStore
import com.editorhub.engine.Layer
import com.editorhub.engine.LayerKind
import com.editorhub.ui.EditorsHubTheme
import com.editorhub.ui.EditorScreen
import com.editorhub.ui.Ink
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The only activity.
 *
 * Two screens: the project list and the editor. The launcher exists because opening straight
 * into an empty timeline is not a product decision, it is an absence of one.
 */
class MainActivity : ComponentActivity() {

    private lateinit var store: EditorStore

    /** Bitmaps resolved from SAF URIs, keyed by layer id. Decoding happens off the UI thread. */
    private val bitmaps = HashMap<String, android.graphics.Bitmap>()

    private val pickImage = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { addMedia(it) }
    }

    private val saveProject = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        uri?.let {
            contentResolver.openOutputStream(it)?.use { out ->
                store.save(File(cacheDir, "project.json"))
                File(cacheDir, "project.json").inputStream().copyTo(out)
            }
        }
    }

    private val openProject = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let {
            runCatching {
                contentResolver.openInputStream(it)?.use { input ->
                    val temp = File(cacheDir, "opened.json")
                    temp.outputStream().use { out -> input.copyTo(out) }
                    store.open(temp)
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        store = EditorStore(this)

        setContent {
            EditorsHubTheme {
                App(
                    store = store,
                    onPickMedia = { pickImage.launch(arrayOf("image/*", "video/*")) },
                    onSave = { saveProject.launch("EditorsHub Project.json") },
                    onOpen = { openProject.launch(arrayOf("application/json")) },
                    bitmapFor = { layer -> bitmaps[layer.id] },
                )
            }
        }
    }

    private fun addMedia(uri: Uri) {
        // Persisting the grant is what makes a saved project reopenable after a restart.
        runCatching {
            contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        val name = uri.lastPathSegment?.substringAfterLast('/') ?: "Media"
        val layer = Layer(
            kind = if (name.contains("mp4") || name.contains("mov")) LayerKind.VIDEO else LayerKind.IMAGE,
            name = name,
            start = store.playhead,
            duration = 4f,
            source = uri.toString(),
        )
        store.addLayer(layer)
        // Decode immediately so the first frame after adding is not blank.
        Thread {
            runCatching {
                contentResolver.openInputStream(uri)?.use { input ->
                    val bmp = BitmapFactory.decodeStream(input)
                    if (bmp != null) synchronized(bitmaps) { bitmaps[layer.id] = bmp }
                }
            }
        }.start()
    }
}

@Composable
private fun App(
    store: EditorStore,
    onPickMedia: () -> Unit,
    onSave: () -> Unit,
    onOpen: () -> Unit,
    bitmapFor: (Layer) -> android.graphics.Bitmap?,
) {
    var screen by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().background(Ink.bg)) {
        if (screen == 0) {
            com.editorhub.ui.LauncherScreen(
                store = store,
                onOpen = { screen = 1 },
                onNew = {
                    store.addLayer(
                        Layer(kind = LayerKind.SHAPE, name = "Shape 1", start = 0f, duration = 3f),
                    )
                    screen = 1
                },
                onImport = onPickMedia,
                onOpenProject = onOpen,
            )
        } else {
            EditorScreen(
                store = store,
                onBack = { screen = 0 },
                onExport = { /* wired to Exporter in the export sheet */ },
                onShare = onSave,
                bitmapFor = bitmapFor,
            )
        }
    }
}
