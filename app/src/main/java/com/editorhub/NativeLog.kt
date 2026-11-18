package com.editorhub

import android.util.Log

/** Logging under one tag, so `adb logcat -s EditorsHub` shows the whole app. */
object NativeLog {
    const val TAG = "EditorsHub"

    fun d(message: String) = Log.d(TAG, message)
    fun i(message: String) = Log.i(TAG, message)
    fun w(message: String, error: Throwable? = null) = Log.w(TAG, message, error)
    fun e(message: String, error: Throwable? = null) = Log.e(TAG, message, error)
}
