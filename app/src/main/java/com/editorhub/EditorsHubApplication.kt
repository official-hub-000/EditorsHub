package com.editorhub

import android.app.Application

/**
 * Process-level setup.
 *
 * There is deliberately very little here: no engine to warm up, no runtime to configure, no
 * remote debugging hook. The compositor builds its GL programs on first draw and the document
 * store is created by the activity that needs it.
 */
class EditorsHubApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: EditorsHubApplication
            private set
    }
}
