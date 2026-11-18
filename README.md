# EditorsHub

A motion-graphics editor for Android, with two engines behind one icon.

**1. The full editor.** The complete [Open Motion](https://github.com/Hada45/Open-Motion)
editor (MIT), vendored in [`web/`](web) and bundled into the APK, so it runs offline from the
APK's own assets. This is the editor with everything: the effects catalogue, curve editor,
vector editor, 3D camera, project bundles and the full exporter.

**2. The fast canvas.** A Kotlin editor (`com.editorhub.nativeed`) with its own document model,
keyframes, easing, timeline, inspector and MP4 encoder, drawn straight to a `SurfaceView`. It is
the quicker path for simple work and it does not depend on the WebView at all.

The launcher offers both by name. The full editor is the default.

<p align="left">
  <img src="docs/branding/open-motion-512.png" width="120" alt="EditorsHub">
</p>

**APK:** https://github.com/official-hub-000/EditorsHub/releases/download/android-latest/editorshub-debug.apk

---

## What the Android shell adds

| Capability | Browser / PWA | This Android app |
| --- | --- | --- |
| Startup | Network fetch of a 9 MB document | Served from APK assets, **fully offline** |
| Install | "Add to Home Screen" | A real APK with an adaptive icon and splash |
| Storage | Browser quota, evictable | App-private profile, included in Android backups |
| Import media | File picker | Storage Access Framework + `SEND`/`VIEW` intents |
| Export | Browser download tab | Native "Save as" picker, or the app export folder |
| Share | `navigator.share` | Android share sheet with a real `FileProvider` URI |
| System Back | History guard | Routed into the editor's own in-app back router |
| Renderer crash | Tab dies | Automatic WebView recovery, projects intact |

## The Kotlin canvas editor

| Area | What is in the app |
| --- | --- |
| Layers | Image, video, audio, shape, text, adjustment, null |
| Animation | Per-property keyframes for position, scale, rotation, opacity |
| Easing | Linear, Ease In, Ease Out, Ease In/Out, Overshoot, Spring, Hold, plus a draggable bezier graph |
| Compositing | Brightness, contrast, saturation, tint, blur; seven blend modes |
| Effects | Blur, sharpen, glow, vignette, pixelate, invert, grain |
| Video | Real frames under the playhead, trim, speed, volume |
| Audio | Playback of audio and video sound, synced to the playhead |
| Export | H.264 MP4 through MediaCodec at a chosen size and frame rate |
| Files | Project save/open as `.editorshub` through the Storage Access Framework |

Its preview is a `SurfaceView` painted on the Choreographer, so playback never
re-composites the chrome; the panels are Compose and only recompose when something they show
changes.

## Layout

```
app/src/main/java/com/editorhub/
  HomeActivity.kt       launcher: crash report, and the two doors
  EditorActivity.kt     the full editor: WebView host, import/export, share, diagnostics
  MainActivity.kt       the Kotlin canvas editor
  NativeBridge.kt       the @JavascriptInterface contract for the bundled editor
  nativeed/             the Kotlin editor: model, store, renderer, UI, exporter
web/                    vendored upstream editor (read-only, MIT)
native-shell/           the glue layer injected into the bundled editor
tools/                  build-web-assets.mjs and the build-time patches
```

## Build

```
./gradlew assembleDebug
```

Requires JDK 17, the Android SDK with platform 35, and Node (the editor bundle is assembled
by `tools/build-web-assets.mjs` at `preBuild`).

## Credits

Open Motion by Hada45 and contributors, MIT. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
