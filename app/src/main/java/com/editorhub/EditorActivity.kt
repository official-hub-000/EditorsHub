package com.editorhub

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import com.editorhub.R
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import kotlin.math.roundToInt
import android.webkit.WebStorage
import java.io.File

/**
 * Native Android host for the EditorsHub editor.
 *
 * The editor engine is the open-source Open Motion application (vendored in /web and
 * bundled into the APK), presented as EditorsHub. It is served over `https://appassets.androidplatform.net`
 * through [WebViewAssetLoader] so it runs fully offline while keeping the secure
 * origin the app needs for Workers, IndexedDB and WebCodecs.
 *
 * The native layer contributes what a browser tab cannot:
 *  - offline bundled assets, no network needed to start
 *  - edge-to-edge drawing with real insets mapped into the editor's CSS safe areas
 *  - native import/export through the Storage Access Framework
 *  - Android share sheet for exported videos and project bundles
 *  - hardware Back routed into the editor's own in-app back router
 *  - screen wake lock during long exports, immersive preview, renderer recovery
 */
class EditorActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    /** Continuation for the editor's `<input type="file">` pickers. */
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    /** Continuation for a native "save as" request. */
    private var pendingSaveCallback: ((Uri?) -> Unit)? = null

    /** Continuation for a native "open document" request. */
    private var pendingOpenCallback: ((Uri?) -> Unit)? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null
            val uris = NativeFiles.extractUris(result.resultCode, result.data)
            uris?.forEach { uri ->
                if (NativeFiles.canPersistPermission(uri)) {
                    runCatching {
                        contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    }
                }
            }
            callback.onReceiveValue(uris)
        }

    private val createDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingSaveCallback ?: return@registerForActivityResult
            pendingSaveCallback = null
            callback(if (result.resultCode == RESULT_OK) result.data?.data else null)
        }

    private val openDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingOpenCallback ?: return@registerForActivityResult
            pendingOpenCallback = null
            callback(if (result.resultCode == RESULT_OK) result.data?.data else null)
        }

    /** Fullscreen video: swap the WebView's custom view in and out, like a browser. */
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        // The editor manages its own themes; keep the system bars dark-content free.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }
        setContentView(root)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(EditorsHubApplication.ASSET_HOST)
            .addPathHandler(
                EditorsHubApplication.ASSET_ROOT,
                WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()

        purgeStaleBundle()

        webView = createWebView()
        webView.id = R.id.editor_webview
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        webView.addJavascriptInterface(NativeBridge(this, webView), NativeBridge.NAME)

        applySafeAreaInsets()
        applyImmersiveMode(true)
        installBackHandler()

        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        if (!restored) {
            webView.loadUrl(EditorsHubApplication.ASSET_BASE_URL, nativeHeaders())
        }
    }

    /** Extra request headers so the editor can detect the native shell. */
    private fun nativeHeaders(): Map<String, String> = mapOf(
        "X-EditorsHub-Shell" to "android",
        "X-EditorsHub-Shell-Version" to BuildConfig.VERSION_NAME
    )

    @SuppressLint("SetJavaScriptEnabled")
    /**
     * Drops any cached copy of the bundled editor when the installed version changes.
     *
     * The document lives inside the APK, so an update is the only way its bytes can
     * change — but WebView keeps its own cache across updates. `shouldInterceptRequest`
     * now marks the response `no-store`, and this is the belt to that braces: on the
     * first launch after an update the WebView cache is cleared and local storage is
     * left untouched, so projects survive while the editor is re-read from the package.
     *
     * Without this, a build that fixes a fault can still behave exactly like the build
     * that had it, with no way for the user or for a bug report to tell the difference.
     */
    private fun purgeStaleBundle() {
        val prefs = getSharedPreferences("editorshub_shell", MODE_PRIVATE)
        // Key the purge on the content fingerprint of the bundled editor, not on the
        // app version: in-place updates can ship a rebuilt bundle without a version
        // bump, and BuildConfig.VERSION_NAME alone never caught those.
        val fingerprint = try {
            assets.open("www/bundle-id.txt").bufferedReader().use { it.readText().trim() }
        } catch (_: Exception) {
            BuildConfig.VERSION_NAME
        }
        val installed = "${BuildConfig.VERSION_NAME}|$fingerprint"
        val seen = prefs.getString("bundle_version", null)
        if (seen == installed) return
        // The service worker database and CacheStorage live under the app data dir, not
        // in WebStorage: WebStorage.deleteAllData() alone leaves a stale registered SW
        // that can keep serving the previous bundle's pages. Delete the files before any
        // WebView API call - once the provider is up the database may be open and locked.
        try {
            val webViewData = File(applicationInfo.dataDir, "app_webview")
            listOf("Default/Service Worker", "Default/Cache", "Default/Code Cache").forEach {
                File(webViewData, it).deleteRecursively()
            }
        } catch (_: Exception) {
        }
        try {
            WebStorage.getInstance().deleteAllData()
        } catch (_: Exception) {
            // Storage is a cache of a cache; failing to clear it must not block startup.
        }
        try {
            val cacheDir = File(cacheDir, "WebView")
            cacheDir.deleteRecursively()
        } catch (_: Exception) {
        }
        prefs.edit().putString("bundle_version", installed).apply()
    }

    private fun createWebView(): WebView {
        return WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            // No forced hardware layer: the editor draws into its own WebGL surface, so a
            // layer here only adds a full-screen composite copy per frame.
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            // The editor implements long-press itself (trim holds, keyframe drags, layer
            // reorder, parameter typing — 80 call sites in the bundle). Swallowing the
            // gesture here made every one of them dead, so the WebView is left to deliver
            // it and only the platform's text-selection callout is suppressed.
            isLongClickable = false
            isHapticFeedbackEnabled = true

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = true
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                // Match the mobile-first viewport the editor is designed for.
                useWideViewPort = true
                loadWithOverviewMode = false
                // Honour the system font-size setting. Pinning this to 100 ignored a user
                // who runs Android at 115–130%, which is exactly when the editor's 11–12px
                // labels become hard to read.
                textZoom = (resources.configuration.fontScale * 100f).roundToInt()
                    .coerceIn(85, 160)
                setGeolocationEnabled(false)
                builtInZoomControls = false
                displayZoomControls = false
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    safeBrowsingEnabled = true
                }
                // The editor is self-themed; never let the platform re-tint canvas or
                // media. Also keeps the black backdrop behind the status bar invisible.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    @Suppress("DEPRECATION")
                    forceDark = WebSettings.FORCE_DARK_OFF
                    isAlgorithmicDarkeningAllowed = false
                }
                // Keep media/user data on the device profile and out of any sync path.
                setSupportZoom(false)
            }

            CookieManager.getInstance().setAcceptCookie(true)

            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val served = assetLoader.shouldInterceptRequest(request.url)
                    if (served != null) {
                        /*
                         * Never let the bundled document be cached.
                         *
                         * The editor ships inside the APK, so its content changes only when
                         * the APK changes -- but WebView will happily reuse a cached copy of
                         * `index.html` across an app update if the response carries no
                         * cache directive. The practical effect is that a fixed build runs
                         * the old script: the buttons are still broken, the version banner
                         * never appears, and every report describes code that is no longer
                         * in the package. Nothing about that is visible from inside the
                         * page, which is why it can masquerade as "still broken".
                         *
                         * `no-store` costs nothing here: the asset is read from the APK, not
                         * from a network, and the document is loaded once per launch.
                         */
                        val headers = HashMap<String, String>()
                        headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
                        headers["Pragma"] = "no-cache"
                        served.responseHeaders = headers
                    }
                    return served ?: super.shouldInterceptRequest(view, request)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url ?: return false
                    val scheme = url.scheme ?: return false
                    if (scheme == "https" && url.host == EditorsHubApplication.ASSET_HOST) {
                        return false
                    }
                    if (scheme == "blob" || scheme == "data" || scheme == "about") {
                        return false
                    }
                    // Everything off-origin is cancelled in place. Handing these to the
                    // browser is what threw the user out of the editor into Chrome with a
                    // URL bar; the app owns its own window and never leaves it.
                    if (scheme == "http" || scheme == "https") {
                        Toast.makeText(
                            this@EditorActivity,
                            "This link opens outside the editor",
                            Toast.LENGTH_SHORT
                        ).show()
                        return true
                    }
                    if (scheme == "mailto" || scheme == "tel") {
                        openExternally(url)
                        return true
                    }
                    return NativeIntents.tryLaunchScheme(this@EditorActivity, url.toString())
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    // native-shell.js is injected by tools/build-web-assets.mjs; the
                    // document only needs to know it is hosted by the APK shell.
                    view.evaluateJavascript(
                        "document.documentElement.classList.add('omsNativeShell');" +
                            "window.dispatchEvent(new Event('omsnative:page'));",
                        null
                    )
                }

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: android.webkit.RenderProcessGoneDetail
                ): Boolean {
                    // A heavy render can kill the renderer; recover instead of crashing.
                    root.removeView(view)
                    view.destroy()
                    webView = createWebView()
                    webView.id = R.id.editor_webview
                    webView.addJavascriptInterface(
                        NativeBridge(this@EditorActivity, webView),
                        NativeBridge.NAME
                    )
                    root.addView(
                        webView,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    Toast.makeText(
                        this@EditorActivity,
                        "Renderer restarted — your projects are safe",
                        Toast.LENGTH_LONG
                    ).show()
                    webView.loadUrl(EditorsHubApplication.ASSET_BASE_URL, nativeHeaders())
                    applyImmersiveMode(true)
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    // The editor shows its own splash screen; nothing to do here but let
                    // the page keep the native shell marker up to date.
                    if (newProgress >= 90) {
                        view.evaluateJavascript(
                            "document.documentElement.classList.add('omsNativeShell');",
                            null
                        )
                    }
                }

                override fun onShowFileChooser(
                    webView: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = callback
                    return try {
                        fileChooserLauncher.launch(NativeFiles.createChooserIntent(params))
                        true
                    } catch (e: ActivityNotFoundException) {
                        fileChooserCallback = null
                        Toast.makeText(
                            this@EditorActivity,
                            "No file picker available",
                            Toast.LENGTH_SHORT
                        ).show()
                        false
                    }
                }

                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread { request.grant(request.resources) }
                }

                override fun onShowCustomView(
                    view: View,
                    callback: WebChromeClient.CustomViewCallback
                ) {
                    if (customView != null) {
                        callback.onCustomViewHidden()
                        return
                    }
                    customView = view
                    customViewCallback = callback
                    root.addView(view, FrameLayout.LayoutParams(-1, -1))
                    webView.visibility = View.GONE
                    applyImmersiveMode(true)
                }

                override fun onHideCustomView() {
                    customView?.let { root.removeView(it) }
                    customView = null
                    webView.visibility = View.VISIBLE
                    customViewCallback?.onCustomViewHidden()
                    customViewCallback = null
                    applyImmersiveMode(false)
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    NativeLog.log(
                        consoleMessage.messageLevel().name,
                        consoleMessage.message(),
                        consoleMessage.sourceId(),
                        consoleMessage.lineNumber()
                    )
                    return true
                }
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applySafeAreaInsets()
            applyImmersiveMode(true)
        }
    }

    override fun onStart() {
        super.onStart()
        applyImmersiveMode(true)
    }

    /**
     * Android 15 draws edge-to-edge by default. Publish the real insets as CSS custom
     * properties (and as overrides for the editor's own safe-area variables) so nothing
     * hides behind the status bar, navigation bar or a display cutout.
     */
    private fun applySafeAreaInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val top = bars.top / density
            val bottom = maxOf(bars.bottom, ime.bottom) / density
            val left = bars.left / density
            val right = bars.right / density

            val js = """
                (() => {
                  const r = document.documentElement;
                  if (!r) return;
                  r.style.setProperty('--oms-safe-top', '${top}px');
                  r.style.setProperty('--oms-safe-bottom', '${bottom}px');
                  r.style.setProperty('--oms-safe-left', '${left}px');
                  r.style.setProperty('--oms-safe-right', '${right}px');
                  // Feed the values the editor already reads through env().
                  r.style.setProperty('--oms-sat', '${top}px');
                  r.style.setProperty('--oms-sab', '${bottom}px');
                  r.style.setProperty('--oms-sal', '${left}px');
                  r.style.setProperty('--oms-sar', '${right}px');
                  r.classList.add('omsNativeShell');
                  window.dispatchEvent(new Event('omsnative:insets'));
                })();
            """.trimIndent()
            webView.evaluateJavascript(js, null)
            // The compat insets have been consumed; hand the platform insets back so
            // children (WebView, custom views) still receive them normally.
            ViewCompat.onApplyWindowInsets(view, insets)
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    webChromeClient()?.onHideCustomView()
                    return
                }
                // Delegate to the editor's own router first: it closes drawers, sheets,
                // export overlays, and only then leaves the project back to Home.
                webView.evaluateJavascript(
                    """
                    (() => {
                      try {
                        if (window.omsNativeShell && window.omsNativeShell.onBack()) return 'handled';
                        if (window.omsAppBackRouter && window.omsAppBackRouter.handleInternalBack()) return 'handled';
                      } catch (e) { }
                      return 'exit';
                    })();
                    """.trimIndent()
                ) { result ->
                    if (result == null || result == "null" || result.contains("exit")) {
                        finish()
                    }
                }
            }
        })
    }

    private fun webChromeClient(): WebChromeClient? = webView.webChromeClient

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Cannot open ${uri.host}", Toast.LENGTH_SHORT).show()
        }
    }

    /** Keep the panel awake while the editor encodes/renders. */
    internal fun setKeepScreenOn(enabled: Boolean) {
        runOnUiThread {
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    /**
     * EditorsHub is edge-to-edge and full-screen at all times.
     *
     * The status bar used to come back whenever the window regained focus or the WebView
     * took a new inset pass, which put an unreachable ~24dp strip over the editor's top
     * toolbar. The bar is now hidden on every relevant lifecycle event, and swiping near
     * an edge reveals it only transiently (Android's standard immersive behaviour).
     */
    internal fun applyImmersiveMode(enabled: Boolean = true) {
        runOnUiThread {
            WindowCompat.getInsetsController(window, root).apply {
                systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                if (enabled) {
                    hide(WindowInsetsCompat.Type.systemBars())
                    hide(WindowInsetsCompat.Type.displayCutout())
                } else {
                    show(WindowInsetsCompat.Type.systemBars())
                }
            }
            // Belt and braces for OEM skins that ignore the insets controller for the
            // status bar specifically. IMMERSIVE_STICKY is deprecated on API 30+ but is
            // harmless there: WindowInsetsController above already did the real work.
            @Suppress("DEPRECATION")
            if (enabled) {
                window.decorView.systemUiVisibility =
                    window.decorView.systemUiVisibility or
                        View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            }
        }
    }

    internal fun launchCreateDocument(intent: Intent, callback: (Uri?) -> Unit) {
        pendingSaveCallback = callback
        createDocumentLauncher.launch(intent)
    }

    internal fun launchOpenDocument(intent: Intent, callback: (Uri?) -> Unit) {
        pendingOpenCallback = callback
        openDocumentLauncher.launch(intent)
    }

    /** Called when the app was launched to open a file from another app. */
    private fun handleIncomingIntent(intent: Intent?) {
        val uri: Uri? = intent?.data ?: intent?.getParcelableExtra(Intent.EXTRA_STREAM)
        if (uri == null) return
        val payload = NativeFiles.readAsBase64(this, uri) ?: return
        val name = NativeFiles.displayName(this, uri) ?: "import"
        val mime = contentResolver.getType(uri) ?: ""
        webView.postDelayed({
            webView.evaluateJavascript(
                "window.omsNativeShell && window.omsNativeShell.onDocument(" +
                    "{name:${org.json.JSONObject.quote(name)}," +
                    "mime:${org.json.JSONObject.quote(mime)}," +
                    "base64:'$payload'});",
                null
            )
        }, 1200)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        handleIncomingIntent(intent)
    }

    override fun onDestroy() {
        root.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_IMPORT_URI = "openmotion.extra.IMPORT_URI"

        fun intentFor(context: Context, importUri: Uri? = null): Intent =
            Intent(context, EditorActivity::class.java).apply {
                if (importUri != null) putExtra(EXTRA_IMPORT_URI, importUri.toString())
            }
    }
}
