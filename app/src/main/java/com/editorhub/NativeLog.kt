package com.editorhub

import android.util.Log

/** Thin logging shim so JS console output shows up in `adb logcat`. */
object NativeLog {
    private const val TAG = "EditorsHub"

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
