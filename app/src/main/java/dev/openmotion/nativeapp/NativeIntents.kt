package dev.openmotion.nativeapp

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Handles custom schemes / `intent://` links the editor may emit. */
object NativeIntents {

    fun tryLaunchScheme(context: Context, url: String): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val intent = when {
            url.startsWith("intent:") -> runCatching {
                Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            }.getOrNull()
            uri.scheme == "alightmotion" || uri.scheme == "am" -> Intent(Intent.ACTION_VIEW, uri)
            else -> Intent(Intent.ACTION_VIEW, uri)
        } ?: return false

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            false
        } catch (e: SecurityException) {
            false
        }
    }
}
