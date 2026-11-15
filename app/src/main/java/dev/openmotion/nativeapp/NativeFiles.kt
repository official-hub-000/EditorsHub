package dev.openmotion.nativeapp

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import java.util.Locale

/** File plumbing shared by the WebView file-chooser and the JS bridge. */
object NativeFiles {

    private val MIME_BY_EXTENSION = mapOf(
        "mp4" to "video/mp4",
        "mkv" to "video/x-matroska",
        "webm" to "video/webm",
        "mov" to "video/quicktime",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "webp" to "image/webp",
        "gif" to "image/gif",
        "svg" to "image/svg+xml",
        "mp3" to "audio/mpeg",
        "wav" to "audio/wav",
        "m4a" to "audio/mp4",
        "aac" to "audio/aac",
        "ogg" to "audio/ogg",
        "json" to "application/json",
        "xml" to "application/xml",
        "ttf" to "font/ttf",
        "otf" to "font/otf",
        "woff" to "font/woff",
        "woff2" to "font/woff2",
        "zip" to "application/zip"
    )

    fun mimeFor(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
        return MIME_BY_EXTENSION[ext]
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: "application/octet-stream"
    }

    fun sanitiseFileName(name: String): String {
        val trimmed = name.trim().ifEmpty { "open-motion-${System.currentTimeMillis()}" }
        return trimmed.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").take(180)
    }

    /**
     * Builds a picker that satisfies the editor's `<input type="file" accept="..." multiple>`
     * declarations. Multiple types (image, video, audio) cannot be expressed as a single
     * ACTION_GET_CONTENT filter, so we fall back to `*/*` and keep the editor's own
     * validation in charge of what it accepts.
     */
    fun createChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val accepted = params.acceptTypes.filter { it.isNotBlank() }
        val allowMultiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val simple = accepted.filter { !it.contains('*') && !it.startsWith('.') }

        val intent = if (simple.size == 1 && accepted.size == 1) {
            Intent(Intent.ACTION_GET_CONTENT).apply { type = simple.first() }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*" }
        }

        val extensionTypes = accepted.filter { it.startsWith('.') }
        if (simple.size == 1 && extensionTypes.isEmpty()) {
            intent.type = simple.first()
        } else if (simple.isEmpty() && extensionTypes.isNotEmpty()) {
            val mimes = extensionTypes.map { mimeFor("x$it") }.distinct().toTypedArray()
            intent.type = "*/*"
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes)
        } else if (simple.isNotEmpty()) {
            intent.type = "*/*"
            intent.putExtra(
                Intent.EXTRA_MIME_TYPES,
                simple.map { normaliseMime(it) }.distinct().toTypedArray()
            )
        }

        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
        return Intent.createChooser(intent, "Select media")
    }

    private fun normaliseMime(mime: String): String =
        if (mime.contains('/')) mime else mimeFor("x.$mime")

    /** Reads URIs from a chooser result (single or multi-select). */
    fun extractUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        val clip = data.clipData
        return if (clip != null && clip.itemCount > 0) {
            Array(clip.itemCount) { clip.getItemAt(it).uri }
        } else {
            data.data?.let { arrayOf(it) }
        }
    }

    fun displayName(context: Context, uri: Uri): String? {
        if (uri.scheme == ContentResolver.SCHEME_FILE) return uri.lastPathSegment
        runCatching {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) return cursor.getString(index)
            }
        }
        return uri.lastPathSegment
    }

    fun readAsBase64(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            Base64.encodeToString(input.readBytes(), Base64.NO_WRAP)
        }
    }.getOrNull()

    /** Whether the URI needs a persistable read grant (documents, not cache URIs). */
    fun canPersistPermission(uri: Uri): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT &&
            (uri.scheme == ContentResolver.SCHEME_CONTENT)
}
