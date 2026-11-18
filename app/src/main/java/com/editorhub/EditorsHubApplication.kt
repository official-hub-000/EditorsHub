package com.editorhub

import android.app.Application
import android.content.Context
import android.webkit.WebView
import com.editorhub.nativeed.EditorStore

/**
 * EditorsHub is the native Android home of the Open Motion editor engine.
 *
 * The editor ships as a self-contained, offline-first bundle inside the APK, so the
 * native side focuses on providing a first-class Android shell: full-screen
 * edge-to-edge rendering, hardware accelerated media, native file import/export,
 * sharing, and durable project storage.
 */
class EditorsHubApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        // Installed before anything else can fail: a crash during startup is the one case
        // where the report matters most and where nothing else would have been able to help.
        CrashLog.install(this)
        // Each startup step is isolated. A failure in any of them used to take the whole
        // process down before a single screen existed, which is indistinguishable from "the
        // app is broken"; now it costs that feature only.
        runCatching { configureWebView() }
    }

    /** WebView is a full browser engine; make it behave like an app-grade runtime. */
    private fun configureWebView() {
        // Remote debugging is a debug-only affordance (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    companion object {
        lateinit var instance: EditorsHubApplication
            private set

        /**
         * The one document store for the whole app.
         *
         * Held here rather than in an Activity so a rotation, a theme change or the WebView
         * editor being opened on top cannot destroy it. That means the undo history and the
         * decoded bitmaps survive, and the project file is never re-read underneath a gesture.
         */
        @Volatile private var storeRef: EditorStore? = null

        fun store(context: Context): EditorStore =
            storeRef ?: synchronized(this) {
                storeRef ?: EditorStore(context.applicationContext).also { storeRef = it }
            }

        /**
         * Virtual https origin used to serve the bundled editor out of the APK.
         *
         * A secure origin is required: Workers, IndexedDB, `crossOriginIsolated` and
         * WebCodecs (used by the export pipeline) are unavailable on `file://`.
         */
        const val ASSET_HOST = "appassets.androidplatform.net"

        /**
         * Path the asset loader is registered on. `AssetsPathHandler` resolves the URL
         * suffix *after* this prefix against the APK's `assets/` directory, so
         * `/assets/www/index.html` is served from `assets/www/index.html`.
         */
        const val ASSET_ROOT = "/assets/"
        const val ASSET_BASE_URL = "https://$ASSET_HOST/assets/www/index.html"
    }
}
