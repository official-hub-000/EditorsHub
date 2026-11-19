# Feature audit — screenshots vs. this repository

Status: **notes only, nothing implemented.** This file records what the supplied screenshots
show, what the repository actually contains, and what would need to change. It is a working
document, not a specification.

Source screenshots: 20 images captured on 2026-11-19 from an app installed as
`com.goldmotion.pnkj`, screen title **Gold Motion**, at 10:37–10:43.

---

## 1. Before anything else: the screenshots are not from this app

This was checked before writing any other part of this note, because an audit against the wrong
baseline is worthless.

| Evidence | Screenshots | This repository |
| --- | --- | --- |
| Package | `com.goldmotion.pnkj` (from the filenames) | `com.editorhub` |
| App name | Gold Motion | EditorsHub (`app/src/main/res/values/strings.xml:3`) |
| Bundle title | — | `Open Motion · Marker Edges & Top Flags · 2026-10-30` |
| Home screen | "Good morning, Siuu", gold wordmark, FOLLOW ME / Instagram / Telegram | no such screen |
| Onboarding | "Make it yours", name + age, "Tuning the video engine" | no such screen |
| Projects screen | "Your projects", Sort by Date, grid, Projects / Your elements / Cloud tabs | no such screen |
| Bottom nav | Home / Projects / Templates / **3D Labs** | no such nav |
| Extra tools | DFR, Project Doctor, Twixtor, Upscale Quality, Audio Converter, Reverse | none of these screens |

Whole-repo searches for `goldmotion`, `Gold Motion`, `com.goldmotion`, `Sort by Date`,
`Your projects`, `Make it yours`, `Tuning the video engine`, `3D Labs`,
`Customize your workspace`, `FOLLOW ME` all return **zero hits** — the strings are not in the
web bundle, the native shell modules, or the Android resources.

**Conclusion:** the screenshots document a different product. The only string in this list that
this repository also contains is `Reverse`, and that comes from unrelated engine internals
(`ReverseCurve`, `ReverseSolidusAtomEscape`) — not a video-reverse feature. `DFR` matches only
base64 blobs in embedded data. Neither is a real correspondence.

---

## 2. What the screenshots show, and whether this repository has it

Grouped by screen. "Repo status" means: present in this repository as a working feature, present
without UI, or absent.

### 2.1 Splash and onboarding

| Screen | Contents | Repo status |
| --- | --- | --- |
| "Make it yours" | Name + age entry, CONTINUE, claims "stays on your device" | **Absent.** No onboarding flow at all. |
| "Tuning the video engine" | Progress bar, engine messages, ENTER GOLD MOTION button, "H.264 ready + HEVC · 24 hardware paths · up to 32 instances" | **Absent as UI.** The underlying probe exists (`native-shell/codec-probe.js`, `NativeCodecs.kt` enumerates H.264/HEVC encoders), but there is no startup screen, no progress animation, and no "hardware paths / instances" counters. The numbers shown are not computed by anything in this repo. |
| "Opening Gold Motion" | Second splash with progress line | **Absent.** |

Note: the splash number "up to 32 instances" is not backed by anything measurable in this
repository. If reproduced, it must be computed from `MediaCodecList` rather than printed.

### 2.2 Home

| Contents | Repo status |
| --- | --- |
| Greeting with the user's name ("Good morning, Siuu") | **Absent.** |
| Engine status line ("Video engine ready · H.264 ready + HEVC · 24 hardware paths · up to 32 instances") | **Partially available.** Encoder enumeration exists and is reported in the log, not in the UI. |
| Centred gold mark, wordmark, MOTION DESIGN subtitle | **Absent.** The current bundle opens straight into the editor. |
| FOLLOW ME: Instagram, Telegram links | **Absent.** |
| "Customize your workspace" link | **Absent.** |
| Bottom nav: Home / Projects / Templates / 3D Labs + centre + button | **Absent.** |
| Floating gold + button (bottom right, copper disc) | **Absent.** |

### 2.3 Projects

| Contents | Repo status |
| --- | --- |
| "Your projects" heading with a project count | **Absent as a screen.** Projects are stored and restored by the shell, but there is no project browser. |
| Tabs: Projects / Your elements / Cloud | **"Your elements" is close to an existing feature**: `native-shell/elements.js` implements an element library (saved compositions reusable across projects). It has no browser screen of this kind. |
| "Sort by Date" dropdown | **Absent.** |
| Grid / list toggle, search icon | **Absent.** |
| Project card: thumbnail, 3-dot menu, duration badge, resolution / fps / frame-count caption | **Absent.** Duration/resolution/fps are known to the editor but are not surfaced in a list. |
| Date grouping header ("19 November 2026") | **Absent.** |
| Empty thumbnail (grey placeholder) | N/A |

### 2.4 Editor — project screen

| Contents | Repo status |
| --- | --- |
| Header: back arrow, project name, filter icon, export/share icon | **Present in substance**, different arrangement. The editor exists with export wiring. |
| Canvas area with letterboxed 1080p stage | **Present** (WebGL2 renderer). |
| Transport: undo, redo, jump start, play, jump end, layers, fit-to-screen | **Present.** |
| Timecode readout under the transport | **Present.** |
| Floating gold + button | **Partially** — the editor has an add-layer affordance; the floating copper disc is not the current design. |
| Bottom category rail: Shape / Media / Audio / Object·Element (NEW badge) / Template / Freehand Drawing / Vector Drawing / Text / × | **Mostly present, arranged differently.** Shape, Media, Audio, Text, Freehand Drawing and Vector Drawing all exist. The `NEW` badge on Object/Element and the icon set differ. |
| Object/Element sheet: Camera, Null, Light, Empty Group, Element/Project | **Present as concepts, not this sheet.** Camera, Null and Empty Group exist as layer types. Light and Element/Project are the ones to check. |

### 2.5 Custom effects

| Contents | Repo status |
| --- | --- |
| "Custom" category, "Add effect" button | **Absent.** The effect catalog is a fixed list of ~160 effects; it is not extensible by the user. |
| "GM Custom FX" starting item, Raster badge, description | **Absent.** |
| Full-screen effect preview with X, Guide, star/favourite | **Partially.** Effects can be added and configured, but there is no full-screen preview sheet with a guide. |
| "Import your own effect XML" | **Absent, and significant.** This is a user-extensible effect system with an XML schema. Nothing in this repo parses effect XML. |

### 2.6 Extra tools ("Gold Motion Extra")

Seven screens, all sharing the heading block `ENGINE WORKSPACE`, a back link labelled
"‹ Gold Motion Extra", and — on first open — a modal titled "Welcome to X" with the text
"Choose source media to open the preview workspace. This module is isolated from Gold Motion
projects, so experiments cannot damage your timeline." and a START CREATING button.

| Tool | What it does per the screenshots | Repo status |
| --- | --- | --- |
| **Audio Converter** | MP3 / AAC / WAV / FLAC / M4A / OGG conversion with quality, plus a repair mode. Buttons: CHOOSE AUDIO, ANALYZE AUDIO, REPAIR AUDIO, EXPORT AUDIO | **Absent.** This repository decodes audio for the timeline; it does not re-encode or repair files. |
| **DFR** | Dead/frozen frame detection with a red/blue grid before export; Pixel Compare vs Smart (ffmpeg); sensitivity slider; RMV ALL DEAD FRAMES; EXPORT VIDEO | **Absent.** No frame-difference analysis and no ffmpeg. |
| **Project Doctor** | Checks Storage (172 GB available), H.264 export, HEVC export, cache (176232 MB usable), timeline safety; "Run safe health scan" | **Partially available as internals.** Storage and codec checks exist across `NativeCodecs.kt` and `NativeFiles.kt`; there is no health-scan screen and no "cache usable" figure. Note the screenshot's cache figure is labelled "MB usable" but reads like a byte count — worth confirming before reproducing. |
| **Reverse** | Reverse a video frame-by-frame, export a new MP4; "gold play button previews backwards"; export is silent by design | **Absent as a tool.** The editor can retime, and `native-shell/smooth-motion.js` handles slowed playback, but there is no reverse-export path. |
| **Twixtor** | Motion-aware slow motion; OUTPUT SPEED 40%, MOTION SENSITIVITY, "Twixtor-style AI frame blending", "Protect difficult edges", presets Balanced / Smooth / Sharp motion, AI ENGINE "Cinematic (FILM AI)", Live preview, Export. Claims FILM optical-flow on-device, 32 and 64-bit | **Partially available.** `native-shell/smooth-motion.js` implements frame *blending* (averaging neighbouring frames). Optical-flow interpolation (FILM) is a **different and much larger** capability and is **not** in this repository. The claims "32 and 64-bit devices" and the preset names are not backed by anything here. |
| **Upscale Quality** | Offline Real-ESRGAN with GM Anime and GM Soul models, 2x / 4x, "Generate & Save to Gallery", fully offline | **Absent.** No ML runtime, no ONNX/ESRGAN weights, no super-resolution. This is the single largest item in the list — it needs a model runtime and two model files. |
| **Custom FX** (see 2.5) | XML effect import | **Absent.** |

---

## 3. What needs re-arranging (versus building)

"Forget everything and restore" left the app at `88de765`. Against that baseline, the distinction
matters:

**Re-arranging only — the capability exists, the screen does not:**

- Editor bottom rail: categories exist but are laid out differently; Shape / Media / Audio /
  Text / Freehand / Vector are all functional.
- Object·Element sheet: Camera, Null, Empty Group exist as layer types.
- Transport bar: every control in the screenshot already exists.
- Element library (`elements.js`): would become the "Your elements" tab.
- Encoder/engine status: exists as a log line and a probe, would become a home-screen strip.
- Effect preview: effects render; there is no full-screen preview sheet.

**Building — nothing in this repository does this today:**

1. Onboarding (name/age) and both splash screens.
2. Home screen with greeting, engine status, social links, bottom nav.
3. Projects browser (thumbnails, counts, sort, grid/list, search, date grouping, per-project menu, `Templates`, `3D Labs` destinations).
4. Custom effect system with **XML import**.
5. Extra-tool shell: the "Engine workspace" container, welcome modal, isolation copy, back link.
6. Audio Converter (encode/transcode/repair).
7. DFR (dead/frozen frame detection, red/blue grid, removal + export).
8. Project Doctor screen (health scan UI over existing checks).
9. Reverse export path.
10. **Optical-flow frame interpolation** (Twixtor / FILM) — distinct from the frame blending already present.
11. **Super-resolution** (Upscale Quality / Real-ESRGAN, two models, 2x/4x).
12. 3D Labs.

**Honest sizing:** items 1–3 and 5 are UI work. Items 6, 7, 9 are media-pipeline work. Items 10
and 11 need entirely new engine capabilities (optical flow; an ML runtime with model weights).
Item 11 is not a screen — it is a dependency the app has never had.

---

## 4. Open questions

1. Are these screenshots the same product as this repository, under different branding, or a
   different product entirely? The evidence in section 1 says the latter.
2. If the goal is to make this repository *look like* those screenshots, which parts are wanted:
   the navigation shell, the extra tools, or both?
3. For Upscale Quality: is a bundled model expected (large, needs an ML runtime), or is the
   screen wanted with the capability stubbed?
4. "24 hardware paths" and "up to 32 instances" — are these figures that should be measured, or
   fixed copy?

Nothing in this note has been implemented. No code has changed since the restore.
