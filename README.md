# EditorsHub

A motion-graphics editor for Android, written in **Kotlin**.

One app, one engine. There is no bundled website, no WebView, no JavaScript and no second
editor hiding behind a button. The document model, the keyframes, the easing curves, the
renderer, the timeline, the inspector and the MP4 encoder are all Kotlin running on the
Android canvas.

<p align="left">
  <img src="docs/branding/open-motion-512.png" width="120" alt="EditorsHub">
</p>

**APK:** https://github.com/official-hub-000/EditorsHub/releases/download/android-latest/editorshub-debug.apk

---

## What it does

| Area | What is in the app |
| --- | --- |
| Layers | Image, video, audio, shape (rectangle / ellipse / triangle), text, adjustment, null |
| Animation | Per-property keyframes for position, scale, rotation and opacity |
| Easing | Linear, Ease In, Ease Out, Ease In/Out, Overshoot, Spring and Hold, plus a draggable bezier graph |
| Compositing | Brightness, contrast, saturation, tint, blur; seven PorterDuff blend modes |
| Effects | Blur, sharpen, glow, vignette, pixelate, invert and grain, each with an amount |
| Adjustment layers | Re-grade everything beneath them |
| Video | Real frames under the playhead, trim offset, speed, volume |
| Audio | Playback of audio and video sound, synced to the playhead |
| Timeline | Pinch zoom, scrub, drag a clip in time, keyframe diamonds, step between keys |
| Export | H.264 MP4 through MediaCodec at a chosen resolution and frame rate |
| Files | Project save/open as `.editorshub` through the Storage Access Framework |
| Sharing | Rendered frame or video through the system share sheet |

## How it is built

- **Preview:** a `SurfaceView` painted on the Choreographer. Frames go to their own surface,
  so playback never re-composites the toolbar or the timeline, and nothing allocates inside
  the draw loop.
- **Chrome:** Jetpack Compose, which only recomposes when the selection or a panel changes --
  never once per frame.
- **Media:** bitmaps are sampled to the size the screen needs; video frames are pulled on a
  background thread and snapped to a keyframe while scrubbing, exact for export.
- **Encode:** `MediaCodec` in byte-buffer mode, fed frames drawn by the same code the preview
  uses, so what is exported is what was on screen.
- **Storage:** one JSON document per project in the app's own files, plus SAF for anything the
  user wants to keep or share.

No network permission is declared. No storage permission is declared.

## Install

See [INSTALL.md](INSTALL.md).

## Build

```
./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. Requirements: JDK 17 and the Android SDK
with platform 35. There is no other build step -- no asset pipeline, no Node, no code
generation.

## Credits

The design language and feature set began from [Hada45/Open-Motion](https://github.com/Hada45/Open-Motion)
(MIT). This repository is an independent Kotlin implementation; none of that project's code
ships in the APK. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
