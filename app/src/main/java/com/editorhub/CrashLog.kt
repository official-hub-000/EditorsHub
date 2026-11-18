package com.editorhub

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Last-resort crash capture.
 *
 * A process that dies during startup leaves the user with a closed app and no information, which
 * is indistinguishable from "it does not work". The handler writes the throwable to
 * `filesDir/last-crash.txt` before letting the process die, so the next launch can show what
 * happened and offer to send it.
 */
object CrashLog {

    private const val FILE = "last-crash.txt"

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { write(app, error, thread.name) }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun write(context: Context, error: Throwable, threadName: String) {
        val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        File(context.filesDir, FILE).writeText(
            """
            EditorsHub crash
            time: $stamp
            thread: $threadName
            device: ${Build.MANUFACTURER} ${Build.MODEL} (API ${Build.VERSION.SDK_INT})
            version: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})

            $trace
            """.trimIndent(),
        )
    }

    fun pending(context: Context): String? {
        val file = File(context.filesDir, FILE)
        return if (file.exists() && file.length() > 0) file.readText() else null
    }

    fun clear(context: Context) {
        runCatching { File(context.filesDir, FILE).delete() }
    }

    /** Called once the editor has been up long enough that startup cannot be the cause. */
    fun markHealthy(context: Context) = clear(context)
}
