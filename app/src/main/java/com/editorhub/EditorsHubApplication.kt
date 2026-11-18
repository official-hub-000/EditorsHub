package com.editorhub

import android.app.Application
import android.content.Context
import com.editorhub.nativeed.EditorStore

/**
 * EditorsHub: a motion-graphics editor written in Kotlin.
 *
 * There is one editor in this app. It draws with the Android canvas, keeps its document in
 * Kotlin, encodes with MediaCodec and reads media through the content resolver. Nothing here
 * embeds a browser.
 */
class EditorsHubApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Installed before anything else can fail: a crash during startup is the one case
        // where the report matters most and where nothing else would have been able to help.
        CrashLog.install(this)
    }

    companion object {
        lateinit var instance: EditorsHubApplication
            private set

        /**
         * The one document store for the whole app.
         *
         * Held here rather than in an Activity so a rotation or a theme change cannot destroy
         * it. That means the undo history and the
         * decoded bitmaps survive, and the project file is never re-read underneath a gesture.
         */
        @Volatile private var storeRef: EditorStore? = null

        fun store(context: Context): EditorStore =
            storeRef ?: synchronized(this) {
                storeRef ?: EditorStore(context.applicationContext).also { storeRef = it }
            }

    }
}
