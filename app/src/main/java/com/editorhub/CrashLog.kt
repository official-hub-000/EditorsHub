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
 * Keeps the last crash instead of losing it.
 *
 * A crash on someone else's phone is otherwise invisible: the process dies, the trace goes to
 * logcat, and there is no way to get it off the device without a cable. This writes it to the
 * app's own files directory, where the next launch can read it, show it, and share it.
 *
 * It also counts consecutive launches that ended in a crash, so the app can decide to stop
 * opening the screen that was killing it rather than crash-looping. Losing the native editor
 * is recoverable; losing the whole app is not.
 */
object CrashLog {

    private const val FILE = "last-crash.txt"
    private const val COUNTER = "crash-streak.txt"

    /** How many launches in a row may crash before the app stops booting into the native editor. */
    const val MAX_STREAK = 2

    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { record(context, thread, throwable) }
            previous?.uncaughtException(thread, throwable)
        }
    }

    /**
     * Records a caught failure.
     *
     * Used where the app survives: a fault that was handled still needs to reach the user,
     * because a silently swallowed exception is a bug nobody can ever fix.
     */
    fun recordNow(context: Context, throwable: Throwable, where: String) {
        runCatching { write(context, Throwable("$where: ${throwable.message}", throwable)) }
    }

    /**
     * A real uncaught exception: the process is about to die.
     *
     * Only this path advances the streak, because only this path proves the launch failed.
     * A caught fault is recorded but must not push the app into the fallback, or a handled
     * problem in one dialog would start opening a different editor.
     */
    private fun record(context: Context, thread: Thread, throwable: Throwable) {
        runCatching {
            write(context, throwable)
            counterFile(context).writeText((streak(context) + 1).toString())
        }
    }

    private fun write(context: Context, throwable: Throwable) {
        val stack = StringWriter().also { writer ->
            PrintWriter(writer).use { throwable.printStackTrace(it) }
        }.toString()
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val report = buildString {
            appendLine("EditorsHub crash report")
            appendLine("time      : $stamp")
            appendLine("thread    : ${Thread.currentThread().name}")
            appendLine("exception : ${throwable.javaClass.name}: ${throwable.message}")
            appendLine("device    : ${Build.MANUFACTURER} ${Build.MODEL} (API ${Build.VERSION.SDK_INT})")
            appendLine("build     : ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine()
            appendLine(stack)
        }
        file(context).writeText(report)
    }

    private fun file(context: Context) = File(context.filesDir, FILE)
    private fun counterFile(context: Context) = File(context.filesDir, COUNTER)

    fun streak(context: Context): Int =
        counterFile(context).takeIf { it.exists() }?.readText()?.trim()?.toIntOrNull() ?: 0

    /** The last crash report, or null when there is nothing pending. */
    fun pending(context: Context): String? =
        file(context).takeIf { it.exists() && it.length() > 0 }?.readText()

    /**
     * Records that the app reached a normal exit.
     *
     * Only the streak is reset. The report itself is kept until it is actually sent, because
     * a crash in the middle of a session is followed by a clean exit often enough that
     * deleting the trace on exit would lose most of them.
     */
    fun markHealthy(context: Context) {
        counterFile(context).writeText("0")
    }

    /** Called once the report has been handed to the share sheet. */
    fun reportConsumed(context: Context) {
        file(context).delete()
    }

    /**
     * True when the native editor has crashed on enough consecutive launches that opening it
     * again is more likely to waste the user's time than to work.
     */
    fun shouldFallBack(context: Context): Boolean = streak(context) >= MAX_STREAK && pending(context) != null

    /** Lets the user ask for the native editor again after a fallback. */
    fun resetStreak(context: Context) {
        counterFile(context).writeText("0")
        file(context).delete()
    }

    /** Builds the share intent body for the pending report. */
    fun shareText(context: Context): String = pending(context) ?: "No crash recorded."
}
