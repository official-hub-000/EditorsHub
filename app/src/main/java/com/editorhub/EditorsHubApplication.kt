package com.editorhub

import android.app.Application
import android.webkit.WebView

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
        configureWebView()
        // Recorded once at startup: the export path and its safe resolution depend on this, and
        // asking at export time is too late to influence the choice.
        runCatching {
            val info = NativeCodecs.describe()
            NativeLog.log("INFO", "codecs: $info", "app", 0)
        }
        // The C++ core is probed here so a missing or stale library is visible in the log from
        // the first line, rather than as a puzzling fallback to the JS path mid-session.
        runCatching {
            NativeLog.log("INFO", "core: ${NativeCore.describe()}", "app", 0)
        }
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
