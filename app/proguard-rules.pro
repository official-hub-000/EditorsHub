# WebView hosts the whole editor, so keep the view layer unobfuscated.
-keep class dev.openmotion.nativeapp.** { *; }
-keep class androidx.webkit.** { *; }

# JavascriptInterface surface is called by name from the bundled editor.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keepattributes JavascriptInterface
-keepattributes *Annotation*

-dontwarn org.chromium.**
