package com.editorhub

import android.util.Log

/** Thin logging shim so JS console output shows up in `adb logcat`. */
object NativeLog {
    private const val TAG = "EditorsHub"

    /**
     * JvmStatic so Java callers (the MP3 encoder) can reach this as NativeLog.log(...)
     * instead of having to go through the INSTANCE field of the Kotlin object.
     */
    @JvmStatic
    fun log(level: String, message: String?, source: String?, line: Int) {
        val text = buildString {
            append(message ?: "")
            if (!source.isNullOrBlank()) append("  (").append(source).append(':').append(line).append(')')
        }
        when (level.uppercase()) {
            "ERROR", "SEVERE" -> Log.e(TAG, text)
            "WARNING", "WARN" -> Log.w(TAG, text)
            "DEBUG" -> Log.d(TAG, text)
            else -> Log.i(TAG, text)
        }
    }
}
