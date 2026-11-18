plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/*
 * The native editor.
 *
 * `app/src/main/java/com/editorhub/nativeed` is the Kotlin editor: its own document model,
 * keyframes, easing curves, canvas renderer, timeline and inspector. The WebView host
 * (`EditorActivity` + `NativeBridge`) stays in the APK as the media-import and
 * share/save gateway, and the web build stays installed as the fallback editor so nothing
 * that used to work stops working.
 *
 * Turning this off (`-Peditorshub.native=false`) builds exactly the previous shell.
 */
val nativeEditorEnabled = (project.findProperty("editorshub.native") as String?) != "false"

/*
 * The Android shell bundles the upstream Open Motion editor. `web/` is a read-only
 * vendored copy of https://github.com/Hada45/Open-Motion (MIT), and
 * tools/build-web-assets.mjs assembles web/ + native-shell/ + vendor/ into
 * app/src/main/assets/www before every build, so the APK can never drift from the
 * upstream editor.
 */
val prepareWebAssets by tasks.registering(Exec::class) {
    workingDir = rootProject.projectDir
    commandLine("node", "tools/build-web-assets.mjs")
    inputs.dir(rootProject.file("web"))
    inputs.dir(rootProject.file("native-shell"))
    inputs.dir(rootProject.file("vendor"))
    inputs.file(rootProject.file("tools/build-web-assets.mjs"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/www"))
    doFirst { println("Assembling Open Motion editor bundle into assets/www …") }
}

tasks.named("preBuild") { dependsOn(prepareWebAssets) }

// Name the APK after the app instead of the module: Open Motion-debug.apk
base.archivesName.set("EditorsHub")

android {
    namespace = "com.editorhub"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.editorhub"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Unsigned by default so `./gradlew assembleRelease` works without secrets.
            // Add your own signingConfig to produce an installable/releasable APK.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = false
        buildConfig = true
        compose = nativeEditorEnabled
    }

    // The editor bundle is ~10 MB of HTML. It is left `noCompress` on purpose: the asset
    // loader serves it to the WebView through a stream, and a stored (uncompressed) entry
    // avoids a synchronous full-file inflate before the first byte of the document reaches
    // the parser. Compression only saved ~2 MB of APK size and cost real startup time.
    androidResources {
        noCompress += listOf("html", "mjs", "wasm", "onnx", "json", "webmanifest")
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/*.kotlin_module"
            )
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    // Activity + WindowInsets + WebViewAssetLoader: everything the shell needs.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")

    // Compose drives the native editor chrome (timeline, inspector, panels). The preview
    // itself is a SurfaceView, which is why Compose here does not need to be on the hot path
    // of playback: it only recomposes when the selection or a panel changes.
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    // lifecycleScope for the background export coroutine.
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
