package com.editorhub.nativeed.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.content.FileProvider
import com.editorhub.nativeed.CompositionView
import com.editorhub.nativeed.EditorStore
import java.io.File

/**
 * Renders a still and hands it to the system share sheet.
 *
 * The PNG is written into the app's cache and shared through the existing FileProvider, so
 * any app the user has -- Drive, Photos, messaging -- can receive it without this app asking
 * for a single permission. [CompositionView.drawComposition] is the same code that paints the
 * preview, with the export flag on, so a shared still is exactly what was on screen.
 */
fun shareStill(context: Context, store: EditorStore, bitmaps: Map<String, Bitmap>) {
    val bitmap = renderStillBitmap(context, store, bitmaps)
    val dir = File(context.cacheDir, "share").apply { mkdirs() }
    val file = File(dir, "frame-${System.currentTimeMillis()}.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Share frame"))
    bitmap.recycle()
}

/** The bitmap a share or a thumbnail needs, at full composition size. */
fun renderStillBitmap(context: Context, store: EditorStore, bitmaps: Map<String, Bitmap>): Bitmap {
    val project = store.project
    val bitmap = Bitmap.createBitmap(project.width, project.height, Bitmap.Config.ARGB_8888)
    val view = CompositionView(context)
    view.store = store
    view.bitmaps = bitmaps
    view.drawComposition(android.graphics.Canvas(bitmap), project, store.time, null, forExport = true)
    return bitmap
}

/** Shares an exported video file through the same provider. */
fun shareVideo(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "video/mp4"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Share video"))
}
