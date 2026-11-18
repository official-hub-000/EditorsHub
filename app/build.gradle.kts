plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * EditorsHub: a motion-graphics editor written in Kotlin.
 *
 * One app, one engine. Compose draws the chrome, a GLSurfaceView draws the canvas through an
 * OpenGL ES compositor, and MediaCodec encodes the export. There is no bundled web runtime and
 * no second editor: `./gradlew assembleDebug` is the whole build.
 *
 * The upstream web editor is kept archived in `web/` (see ARCHIVE.md) so the previous app is
 * recoverable, but it is not compiled, not bundled, and not referenced.
 */
base.archivesName.set("EditorsHub")

android {
    namespace = "com.editorhub"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.editorhub"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "2.0.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1", "META-INF/*.kotlin_module")
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
