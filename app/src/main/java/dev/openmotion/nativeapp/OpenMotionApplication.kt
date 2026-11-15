package dev.openmotion.nativeapp

import android.app.Application
import android.webkit.WebView

/**
 * Open Motion ships as a self-contained, offline-first bundle inside the APK.
 *
 * The editor is a single-page canvas/WebGL application, so the native side focuses on
 * providing a first-class Android shell: full-screen edge-to-edge rendering, hardware
 * accelerated media, native file import/export, sharing, and durable project storage.
 */
class OpenMotionApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
        configureWebView()
    }

    /** WebView is a full browser engine; make it behave like an app-grade runtime. */
    private fun configureWebView() {
        // Remote debugging is a debug-only affordance (chrome://inspect).
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    companion object {
        lateinit var instance: OpenMotionApplication
            private set

        const val ASSET_ASSET_HOST = "appassets.androidplatform.net"

        /**
         * Path the asset loader is registered on. `AssetsPathHandler` resolves the URL
         * suffix *after* this prefix against the APK's `assets/` directory, so
         * `/assets/www/index.html` is served from `assets/www/index.html`.
         */
        const val ASSET_ROOT = "/assets/"
        const val ASSET_BASE_URL = "https://$ASSET_ASSET_HOST/assets/www/index.html"
    }
}
