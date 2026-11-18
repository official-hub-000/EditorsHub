package com.editorhub

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.util.Locale

/**
 * File plumbing.
 *
 * Everything the editor reads or writes goes through the Storage Access Framework, so the app
 * asks for no storage permission at all: the user picks a file, or a place to put one, and
 * that single grant is all the app ever gets.
 */
object NativeFiles {

    /** A file the user picked, with the facts needed to place it on the canvas. */
    data class Picked(val uri: Uri, val name: String, val type: String, val sizeBytes: Long)

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
        "mp3" to "audio/mpeg",
        "wav" to "audio/wav",
        "m4a" to "audio/mp4",
        "aac" to "audio/aac",
        "ogg" to "audio/ogg",
        "json" to "application/json",
        "editorshub" to "application/json",
        "ttf" to "font/ttf",
        "otf" to "font/otf"
    )

    /** Describes a picked uri. Never throws: a failed lookup returns null. */
    fun describe(context: Context, uri: Uri): Picked? = runCatching {
        val resolver: ContentResolver = context.contentResolver
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "media"
        var size = 0L
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIndex >= 0) cursor.getString(nameIndex)?.let { name = it }
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        val type = resolver.getType(uri)
            ?: MIME_BY_EXTENSION[name.substringAfterLast('.', "").lowercase(Locale.US)]
            ?: "application/octet-stream"
        Picked(uri, name, type, size)
    }.getOrNull()

    /** Copies a picked file into app storage so an expiring grant cannot lose the media. */
    fun copyInto(context: Context, uri: Uri, name: String): File? = runCatching {
        val dir = File(context.filesDir, "media").apply { mkdirs() }
        val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val target = File(dir, "${System.currentTimeMillis()}-$safeName")
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        }
        target.takeIf { it.length() > 0 }
    }.getOrNull()

    fun mimeFor(name: String): String =
        MIME_BY_EXTENSION[name.substringAfterLast('.', "").lowercase(Locale.US)] ?: "application/octet-stream"

    fun extensionFor(mime: String): String =
        MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "bin"
}
