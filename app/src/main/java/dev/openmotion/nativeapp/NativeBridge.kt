package dev.openmotion.nativeapp

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The native <-> editor contract.
 *
 * Everything exposed to JavaScript lives here and is intentionally small and
 * "capability" shaped: storage, sharing, fullscreen, wake-lock and file hand-off.
 * The editor keeps owning all creative behaviour.
 */
class NativeBridge(
    private val activity: EditorActivity,
    private val webView: WebView
) {
    private val main = Handler(Looper.getMainLooper())
    private val tag = "OpenMotionBridge"

    /** Root for user-visible editor artefacts (exports, preview frames, bundles). */
    private val exportsDir: File
        get() = File(activity.filesDir, "exports").apply { if (!exists()) mkdirs() }

    private val sharedDir: File
        get() = File(activity.cacheDir, "shared").apply { if (!exists()) mkdirs() }

    // ---------------------------------------------------------------- lifecycle

    @JavascriptInterface
    fun ping(): String = JSONObject(
        mapOf(
            "shell" to "android",
            "version" to BuildConfig.VERSION_NAME,
            "sdk" to Build.VERSION.SDK_INT
        )
    ).toString()

    @JavascriptInterface
    fun log(level: String, message: String) = NativeLog.log(level, message, "js", 0)

    // --------------------------------------------------------------- keep awake

    /** Keeps the device screen on during export, mirroring the editor's wake lock use. */
    @JavascriptInterface
    fun setKeepScreenOn(enabled: Boolean) = activity.setKeepScreenOn(enabled)

    /** Immersive mode for the editor / fullscreen preview. */
    @JavascriptInterface
    fun setImmersive(enabled: Boolean) = activity.setImmersive(enabled)

    /** Device-level fullscreen request from the WebView (Fullscreen API is unreliable). */
    @JavascriptInterface
    fun requestFullscreen() = activity.setImmersive(true)

    @JavascriptInterface
    fun exitFullscreen() = activity.setImmersive(false)

    // ------------------------------------------------------------------ toasts

    @JavascriptInterface
    fun toast(message: String) {
        main.post {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    // ------------------------------------------------------------------ sharing

    /**
     * Receives an exported artefact as a base64 payload (Blob -> ArrayBuffer -> base64 on
     * the JS side), writes it to app storage and opens the Android share sheet.
     *
     * @return absolute path of the written file, or an empty string on failure.
     */
    @JavascriptInterface
    fun shareBase64(base64: String, filename: String, mimeType: String): String {
        return try {
            val clean = NativeFiles.sanitiseFileName(filename)
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val target = File(sharedDir, clean)
            FileOutputStream(target).use { it.write(bytes) }

            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                target
            )
            main.post {
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = mimeType.ifBlank { "application/octet-stream" }
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(
                    Intent.createChooser(share, "Open Motion exports")
                )
            }
            target.absolutePath
        } catch (t: Throwable) {
            NativeLog.log("ERROR", "shareBase64 failed: ${t.message}", tag, 0)
            ""
        }
    }

    /** Saves an exported artefact into the app's export folder without sharing it. */
    @JavascriptInterface
    fun saveBase64(base64: String, filename: String): String {
        return try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val target = File(exportsDir, NativeFiles.sanitiseFileName(filename))
            FileOutputStream(target).use { it.write(bytes) }
            target.absolutePath
        } catch (t: Throwable) {
            NativeLog.log("ERROR", "saveBase64 failed: ${t.message}", tag, 0)
            ""
        }
    }

    /** Lists artefacts already written by the editor (name -> bytes). */
    @JavascriptInterface
    fun listExports(): String {
        val root = org.json.JSONArray()
        exportsDir.listFiles()?.sortedByDescending { it.lastModified() }?.forEach { file ->
            root.put(
                JSONObject(
                    mapOf(
                        "name" to file.name,
                        "bytes" to file.length(),
                        "modified" to file.lastModified(),
                        "mime" to NativeFiles.mimeFor(file.name)
                    )
                )
            )
        }
        return root.toString()
    }

    /**
     * Native "save as" flow for documents the editor produced (JSON/XML/MP4/PNG).
     * Uses the Storage Access Framework so the user picks the final location.
     */
    @JavascriptInterface
    fun saveDocumentBase64(base64: String, filename: String, mimeType: String) {
        main.post {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mimeType.ifBlank { "application/octet-stream" }
                    putExtra(Intent.EXTRA_TITLE, NativeFiles.sanitiseFileName(filename))
                }
                activity.launchCreateDocument(intent) { uri ->
                    if (uri != null) {
                        try {
                            activity.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            Toast.makeText(activity, "Saved", Toast.LENGTH_SHORT).show()
                        } catch (t: Throwable) {
                            Toast.makeText(activity, "Save failed", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            } catch (t: Throwable) {
                NativeLog.log("ERROR", "saveDocumentBase64 failed: ${t.message}", tag, 0)
            }
        }
    }

    /** Opens a native open-document picker and hands the chosen file to the editor. */
    @JavascriptInterface
    fun pickDocument(accept: String) {
        main.post {
            val mime = if (accept.isBlank()) "*/*" else accept
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
            }
            activity.launchOpenDocument(intent) { uri ->
                if (uri != null) {
                    jsDispatchOpenDocument(uri)
                }
            }
        }
    }

    private fun jsDispatchOpenDocument(uri: Uri) {
        val payload = NativeFiles.readAsBase64(activity, uri) ?: return
        val name = JSONObject.quote(NativeFiles.displayName(activity, uri) ?: "import")
        val mime = JSONObject.quote(activity.contentResolver.getType(uri) ?: "")
        webView.post {
            webView.evaluateJavascript(
                "window.omsNativeShell && window.omsNativeShell.onDocument(" +
                    "{name:$name,mime:$mime,base64:'$payload'});",
                null
            )
        }
    }

    /** Share a plain link (used by the About / credits section). */
    @JavascriptInterface
    fun shareText(text: String, subject: String) {
        main.post {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                if (subject.isNotBlank()) putExtra(Intent.EXTRA_SUBJECT, subject)
            }
            activity.startActivity(Intent.createChooser(send, subject))
        }
    }

    // ------------------------------------------------------------------- misc

    @JavascriptInterface
    fun deviceInfo(): String = JSONObject(
        mapOf(
            "manufacturer" to Build.MANUFACTURER,
            "model" to Build.MODEL,
            "device" to Build.DEVICE,
            "android" to Build.VERSION.RELEASE,
            "sdk" to Build.VERSION.SDK_INT,
            "cores" to Runtime.getRuntime().availableProcessors(),
            "heapMb" to (Runtime.getRuntime().maxMemory() / (1024 * 1024)),
            "storageFreeMb" to (activity.filesDir.usableSpace / (1024 * 1024))
        )
    ).toString()

    @JavascriptInterface
    fun platform(): String = "android"

    fun detach() {
        main.removeCallbacksAndMessages(null)
    }

    companion object {
        /** Name the page reaches the shell through: `window.OpenMotionNative`. */
        const val NAME = "OpenMotionNative"
    }
}
