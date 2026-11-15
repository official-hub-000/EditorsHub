# Open Motion — Native Android

A **real, installable Android app** built around the [Open Motion](https://hada45.github.io/Open-Motion/)
editor from [Hada45/Open-Motion](https://github.com/Hada45/Open-Motion) (MIT licensed).

The editor itself is the upstream Open Motion application, vendored unmodified in
[`web/`](web) and bundled inside the APK. It runs offline on the device's own Chromium
engine (Android System WebView), so the UI, keyframes, curve editor, vector editor, 3D
camera, effects graph and exporter are **pixel-identical to the published app** — while
the native layer adds what a browser tab can never do.

<p align="left">
  <img src="docs/branding/open-motion-512.png" width="120" alt="Open Motion">
</p>

---

## What is native here

| Capability | Browser / PWA | This Android app |
| --- | --- | --- |
| Startup | Network fetch of a 9 MB document | Served from APK assets, **fully offline** |
| Install | "Add to Home Screen" | A real APK (Play Store ready, adaptive icon, splash) |
| Storage | Browser quota, evictable | App-private profile, included in Android backups |
| Import media | File picker | Storage Access Framework + `SEND`/`VIEW` intents from other apps |
| Export | Browser download tab | Native **"Save as"** document picker, or app export folder |
| Share | `navigator.share` | Android share sheet with a real `FileProvider` URI |
| System Back | History guard | Routed into Open Motion's own in-app back router |
| Screen during export | `navigator.wakeLock` (Chromium only) | `FLAG_KEEP_SCREEN_ON` |
| Fullscreen preview | Fullscreen API banner / pseudo-fullscreen | Immersive mode, no browser chrome |
| Window chrome | Tabs, address bar, overscroll | Edge-to-edge, cutouts, safe areas mapped into CSS |
| Renderer crash | Tab dies | Automatic WebView recovery, projects intact |

Everything the editor draws — home screen, project list, timeline, canvas, export
overlay, language picker — is the upstream UI. Nothing was re-skinned.

---

## Project layout

```
web/                       Vendored upstream Open-Motion (read-only, do not edit)
native-shell/native-shell.js  Android adapter injected into the editor document
vendor/mediabunny/          Pinned Mediabunny ESM build (offline MP4/WebM export)
tools/build-web-assets.mjs   Assembles web/ + native-shell/ + vendor/ -> assets/www
app/src/main/java/dev/openmotion/nativeapp/
    OpenMotionApplication.kt  WebView runtime configuration
    EditorActivity.kt         Edge-to-edge WebView host, back routing, insets
    NativeBridge.kt           window.OpenMotionNative JS <-> Kotlin contract
    NativeFiles.kt            SAF pickers, MIME mapping, base64 transfer
    NativeIntents.kt          Custom scheme / intent:// handling
    NativeLog.kt              JS console -> logcat
app/src/main/res/          Adaptive launcher icon, theme, FileProvider paths
.github/workflows/android.yml  CI: builds debug + release APKs
```

`app/src/main/assets/www/` is **generated** (git-ignored) from `web/` on every build, so
the APK can never silently drift from the upstream editor.

---

## Build the APK

Requirements: JDK 17, Android SDK 35 (`ANDROID_HOME`), Node.js 18+ (only for the asset
step — no npm install needed).

```bash
# Debug APK
./gradlew :app:assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk

# Install on a connected device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or open the folder in **Android Studio** (Ladybug or newer), let it sync, and press Run.

`./gradlew :app:assembleRelease` produces an unsigned release APK; add your own
`signingConfig` (or use Android Studio → Build → Generate Signed Bundle/APK) to publish.

Every push builds the debug APK in CI (`.github/workflows/android.yml`); grab it from
the run's **open-motion-android-debug** artifact.

> **Runner without outbound downloads?** Gradle needs `services.gradle.org` and Google
> Maven on first run. If your network only allows GitHub, run the
> *Refresh Gradle wrapper* workflow once to add `gradle/wrapper/gradle-wrapper.jar`
> (fetched from the Gradle repository through the GitHub API).

### Rebuilding the editor bundle by hand

```bash
node tools/build-web-assets.mjs
```

---

## How the editor is hosted

```
https://appassets.androidplatform.net/assets/www/index.html
        ▲ WebViewAssetLoader (serves straight out of the APK)
```

A `https://` origin is deliberate: Workers, IndexedDB, `crossOriginIsolated` behaviour
and WebCodecs all require a secure context, and `file://` would break them.

Three surgical changes are applied to the vendored document at build time:

1. `<meta charset>` is hoisted to the top of `<head>` so the 9 MB document is decoded as
   UTF-8 before its inline scripts stream in (upstream ships many blank lines first).
2. `https://cdn.jsdelivr.net/npm/mediabunny@1.52.2/+esm` is rewritten to the vendored
   copy, so export/scrub never needs the network.
3. `<script src="./native-shell.js" defer>` is appended.

Optional network features of the upstream editor are left untouched: the Google Fonts
catalog and the AI portrait-matting model (ONNX Runtime + MODNet, ~26 MB) are only
fetched when the user actually opens those features.

---

## JavaScript ↔ native bridge

`NativeBridge` exposes `window.OpenMotionNative`:

| Method | Purpose |
| --- | --- |
| `ping()` / `deviceInfo()` | Shell + device capabilities |
| `beginUpload` / `appendUpload` / `finishUpload` | Streamed transfer for large exports (no base64 memory spike) |
| `saveBase64(b64, name)` | Write an artefact to `files/exports` |
| `saveDocumentBase64(b64, name, mime)` | Native "Save as" via SAF |
| `shareBase64(b64, name, mime)` | Android share sheet (FileProvider URI) |
| `setKeepScreenOn(bool)` | Wake lock during export |
| `setImmersive(bool)` | Hide system bars for preview/fullscreen |
| `pickDocument(accept)` | Native open-document picker |
| `toast(msg)` / `shareText()` / `log()` | Small UX helpers |

`native-shell/native-shell.js` wraps these into `window.omsNativeShell` and adapts the
editor:

- **Exports** (MP4/WebM, PNG frame, JSON package, Alight Motion XML, presets) go to the
  Android "Save as" picker. Two layers cover this: the build retargets the editor's own
  `download()` helper, and the adapter also intercepts every `a[download]` click —
  including detached anchors, which never reach DOM event listeners.
- **Share** in the export preview opens the Android share sheet (the button is enabled
  even though `navigator.share({files})` is unreliable in WebView).
- **Large files** stream in 1 MiB chunks so a 4K export never doubles peak memory.
- **Wake lock**, **fullscreen**, the **PWA install banner**, **imports** from other
  apps, and **Back** are all forwarded to the native equivalents.

---

## Downloading a build

Successful CI runs publish `open-motion-debug.apk` as a release asset — open the
repository's **Releases** page, or:

```bash
gh release download --pattern open-motion-debug.apk --repo official-hub-000/EditorsHub
```

## Media decoding & export

Export uses WebCodecs (`VideoEncoder`) through Mediabunny. Android System WebView
supports WebCodecs on Android 10+ (`MediaCodec`-backed), so hardware H.264/AAC encoding
works on device; the editor automatically falls back to its legacy engines where a codec
is unavailable, exactly as it does in Chrome.

## Updating to a newer Open Motion

```bash
git fetch upstream
git subtree pull --prefix=web upstream main
```

`web/` is a pristine copy of upstream, so this stays conflict-free as long as no one
edits the vendored files (all Android-specific code lives outside `web/`).

---

## Licensing

- **This Android app shell** (Kotlin code, resources, build tooling): MIT — see
  [LICENSE](LICENSE).
- **Open Motion editor** (`web/`, `app/src/main/assets/www` output): MIT, © Hada45 —
  see [web/LICENSE](web/LICENSE) and [web/THIRD_PARTY_NOTICES.txt](web/THIRD_PARTY_NOTICES.txt).
- **Mediabunny** (`vendor/mediabunny`): Mozilla Public License 2.0 — see
  [vendor/mediabunny/package.json](vendor/mediabunny/package.json).
- **AndroidX / WebKit**: Apache License 2.0.

Open Motion is an independent project and is not affiliated with, endorsed by, or
sponsored by Alight Motion or Alight Creative.
