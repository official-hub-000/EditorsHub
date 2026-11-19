# Alight Motion (After Motion Z) vs EditorsHub — full UI and feature audit

Status: **analysis only. No code changed.** Working tree is `88de765` (the restored app) plus this
document.

Sources: **47 screenshots** from a Google Drive folder, captured 2026-11-19 at 11:40–11:49 from
`com.alightcreative.motioo` — Alight Motion with the **After Motion Z** mod by "Satriyaid".
Every screenshot was opened and read. Files are in `google_drive/` in this workspace.

The comparison baseline is this repository as it actually is: `web/index.html` (60,566 lines,
9.75 MB), the nine `native-shell/*.js` modules, and the six Kotlin files. Every "EditorsHub has
X" claim below was verified by grep against that code; the command output is what the
verdicts are based on.

---

## 0. One correction to the brief

The screenshots are not Alight Motion stock — they are the **After Motion Z** mod of it
(`com.alightcreative.motioo`). Every screen behaves like upstream Alight Motion, but a very
large amount of what is on these screens is *added by the mod*, not by Alight Motion:

- the whole **Patcher Menu** (28 toggles seen across 9 screenshots)
- **AmzLabs** — 13 separate media tools
- **AmzTools** — 13 layer/keyframe utilities
- **150 new effects** and **96 new shapes**
- iOS Styles, theme switcher, custom background colour, hex colour code, export log, etc.

So when something is missing from EditorsHub, it is usually missing because it is an
After-Motion-Z addition, not because it is an Alight Motion feature. This matters: stock Alight
Motion does not have AmzLabs, and neither does EditorsHub. I have marked each item below.

---

## 1. The screens, one by one

### 1.1 Launch — "Evaluating Video Codec Performance"

A modal over a dimmed home screen, dark navy with mint-green accent, rounded 20 px corners.

- Title in green: **Evaluating Video Codec Performance**
- Body: "This process usually takes less than a minute, and allows Alight Motion to make best use
  of video on your device."
- Green progress bar, percentage below it (17 % in the screenshot); this is a **determinate**
  bar that fills while codec probing runs.
- A result card titled *Estimate From The Video Encoder* with five label/value rows:
  `Export Limit → 2160p (4K)`, `Recommended → 1440p (2K)`, `HEVC (H.265) → Supported · Hardware`,
  `HEVC Up To → 3840×2160`, `H.264 Up To → 3840×2160`. Values are right-aligned; the
  "Recommended" value is green, the rest white.
- Footer note: "Final values come from this evaluation."
- One full-width **Minimize** button in mint green — it dismisses the modal, it does not cancel
  the probe.

How it works: this is a real `MediaCodecList` enumeration that then configures the export
ceiling. It runs once, it is minimisable, and the results persist.

**EditorsHub:** has the enumeration (`NativeCodecs.kt` walks `MediaCodecList` for H.264/HEVC and
records hardware support; `native-shell/codec-probe.js` additionally asks WebCodecs
`isConfigSupported`). It has **no UI for it at all** — the result goes to logcat and to a
triple-tap debug HUD. There is no determinate progress, no result card, no minimise, and no
use of the result to set an export ceiling.

### 1.2 Home

Header row: hamburger, a **theme sun icon**, a **feedback speech-bubble icon**, the centred
wordmark "Alight Motion" with the AM ribbon mark, then download, a **dice/shuffle** icon, and a
circular account avatar.

Body is a single grey card, radius ~24 px, on white:
- "After Motion Z" in blue, 30 px
- "Extended by Satriyaid" in grey
- Four lines of description
- Then a **list of 11 collapsible sections**, each a row with the label left and a `+` on the
  right: Home & Projects, Palette & Color, Editor, Speed Control, Timeline & Audio, Export,
  Effect Browser, AmzTools, AmzLabs, Display & Theme, Performance, Fixed Bugs, New Effects (150),
  New Shapes (96).
- Expanding a section turns the `+` into `–` and reveals a bulleted list (screenshots 22–36).
- Two pill buttons at the bottom: **+ Create Project**, **Open Projects**.

Bottom nav: Home (filled home icon) · Tutorials (open box) · **centre FAB, mint green, 96 px** ·
Projects (badged **NEW**, a video-frame icon) · Templates (grid icon).

**EditorsHub:** has a home screen — `#home` with `.mHomeHero`, `#projectList`, `#projectCountBadge`,
`#projectSort`, `#newProjectFab`, and a bottom nav with four tabs. But it is a different design:
white cards on a light background, Indonesian-first labels (`Beranda / Tutorial / Proyek /
Template`), a hero block instead of a wordmark and a changelog card. There is no theme picker,
no feedback dialog, no changelog, no account avatar, no download/dice icons, and no
"Create Project / Open Projects" pill pair.

### 1.3 Projects

- Search field: "Search Project", magnifier at the left inside the field.
- Card: **Upload XML file** with a folder-upload icon and an **Upload** button (lavender pill).
- Three tabs: **Projects** (active, navy pill), **Your Templates**, **Elements**.
- Heading "Your projects" with "Sort by Date ⌄" on the right.
- Date group header "19 November 2026".
- Project row card (white, radius 16): 74×50 thumbnail with a `00:00:00` duration badge bottom-left,
  then **New Project** title, then a 2×2 metadata grid — `16:9` (aspect), `1080p` (resolution),
  `372b` (file size), `30fps` — and a three-dot menu at the right.
- Floating round AM mod button bottom-right.

**EditorsHub:** has a project list, and the card is close in structure. Verified in
`loadProjectList()`: thumbnail (`OMSProjectThumbnails.paint`), name, `W×H · FPS`, and a
relative date ("Today · 14:32" or "19 Nov"). Sort options are Newest / Oldest / Name. Selection
mode with duplicate / delete / export exists.

Missing: **project search** (zero hits for any search implementation), **Upload XML**,
the three tabs, **file size in bytes** on the card, **aspect ratio** on the card, and a
per-card three-dot menu (EditorsHub uses long-press selection instead).

### 1.4 Editor — empty project

Top bar: back-arrow-in-a-box, title "New Project" with an underline indicator, then a
**padlock**, an **AUTO** pill (bordered), a **gear**, and a green **share/export** square.

Canvas: letterboxed dark stage, grey 16:9 composition area.

Transport row (7 icons, evenly spaced): undo, redo, |◀, ▶, ▶|, a **stack/layers** icon with a
yellow **NEW** badge, and a fit-to-frame icon.

Below: ruler with the playhead, timecode chip `00:00:00` on a grey pill, the playhead extending
the full height of the timeline area.

Bottom right: floating AM mod button, and a **circular mint `+`** button 72 px.

Opening the + reveals a **two-tier rail**:

Row 1 (horizontal, 5 items + 3 vertical on the right):
Shape (circle/triangle/square/heart composite glyph) · Media (image-in-frame) · Audio (note) ·
**Object / Element** (crossed shapes) · **Template** (badged NEW) · then a vertical column:
Freehand Drawing (pen), Vector Drawing (pen-on-curve), Text (Aa), and a ✕ to close.

Row 2 (contextual, changes per tab):
- **Object / Element** shows eight tiles in a 4×2 grid: Linked Camera, Camera (with a small
  badge), Null, Linked Null, Empty Group, Element / Project, Adjustment Layer, Import IMG
  Sequence. Each is an outline icon plus a two-line label; the active tab's label is green.
- **Media** shows an "All" filter chip and a thumbnail grid of the device's videos and images,
  each with an aspect-ratio/type badge.
- **Audio** shows only a "View All" tile.
- **Shape** shows a 4-page paginated grid of shape glyphs with dot pagination.

**EditorsHub:** the rail exists as `data-add-tool` with FIVE tabs — `shapes`, `media`, `audio`,
`objects`, `templates` — and the objects tab contains exactly three entries in Indonesian:
**Kamera 3D** (3D Camera), **Objek Null**, **Grup Kosong** (Empty Group), **Elemen & Proyek**,
plus three template presets (Title Motion, Parallax 3D, Camera Push) and **Gambar Bebas**
(freehand) / **Gambar Vektor** (vector) / **Teks**. Shape library is 66 primitives
(`shape==='...'` branches: rect, ellipse, star5/6/8, heart, hexagon, gear-like multifoil,
chevron, banner, burst, snowflake, etc.).

Missing versus the screenshot: **Linked Camera**, **Linked Null**, **Adjustment Layer**,
**Import IMG Sequence**, the **NEW badge** on Template, the second-tier visual layout and the
badge on the Camera tile. Media/Audio/Shape tabs exist; the media grid's per-item aspect badge
does not.

### 1.5 Editor — a layer selected

Same top bar but now the title is the layer name ("Toggle Switch 1") and the right side becomes
an image-sequence button, a **trash**, and a **⋯** overflow.

Canvas shows the layer with a selection box: purple fill, 4 corner handles, 4 edge handles, and a
small square widget at the right edge.

Ruler now shows tick marks. Below it a **layer row**: an eye toggle with an onion/motion-path pill,
the layer name on a mint-cyan bar (trim handles at both ends), and the keyframe timeline.

Bottom: a **two-page paged toolbar**, with page dots. Page 1:
a **tool row** of four icons (two of them badged NEW) then a 4×2 **grid of panel buttons**:
**Color & Fill**, **Border & Shadow**, **Blending & Opacity**, **New Move & Transform**,
**Edit Shape**, **Amz** (AMZ Tools, badged NEW), **Effects**.
Page 2 (swipe or tap the dots): another tool row (star, three align icons, arrow) then a 4×2
grid: **Beat Maker**, **Audio Keys** (green diamond badge), **Stabilizer**, **Shift KF**,
**Duplicate**, **Adj. Layer**, **Vectorscope**, **Split Text**.

Every panel button is a rounded square ~86 px with a line icon above its label; disabled ones are
dimmed.

**EditorsHub:** the inspector exists and is driven by `drawerMode` values `root`, `move`,
`effects`, `keys`, `settings`, `relink`, `multi`, `tool`, and a `data-tab` pair `border`/`shadow`
for the edge panel. Add-border / add-shadow flows with a 8-slot border list, per-slot enable dots
(`●`/`○`) and Indonesian copy are all implemented. Keyframes are real (569 mentions, per-property
rows with `data-kf-visual-prop`).

Missing: **Beat Maker**, **Audio Keys**, **Stabilizer** as a UI action, **Shift KF**, **Vectorscope**,
**Split Text** (character/word/line), **Adj. Layer** quick-action, the **NEW** badges, the
two-page pager, and the Icon+label tool row above the grid. "Amz" is the mod and has no
counterpart (EditorsHub has no such tool tray).

### 1.6 Effect Browser

Full-screen sheet, light-blue-grey background (`#5c6b8a`-ish), top bar: ✕, a sort icon,
centred title **Effect Browser**, a **three-dot page indicator**, and a magnifier.

- A horizontal row of **folder cards**: each is a 2×2 collage of effect thumbnails in a rounded
  square, with the folder name beneath. Seen: Last Added, Favorite Editor, Times, Glitch, Depth,
  Overlay, Texture, Retro, Star… (the row scrolls).
- A scroll indicator line under the active folder.
- Then a **two-column grid of category tiles**, each tile a full-bleed effect preview with the
  category name centred on a dark scrim: **Color & Light**, **Drawing & Edge**, **Blur**,
  **Distortion/Warp**, **Procedural**, **3D**, **Move/Transform**, **Repeat**, **Matte/Mask/Key**,
  **Opacity/Visibility**, **Text**, **Other**.
- A toast pill "Animated Thumbnails ON" appears when toggling the header button.

**EditorsHub:** has an effect system with a **93-effect catalog** in **8 Indonesian categories**
(Warna / Populer / Distorsi / Gerak / Blur / Generator / Stilisasi / Simulasi), a search field
(`effectSearch`, 13 hits, with a debounce), and effect preview thumbnails.

Missing: **folders** (Last Added / Favorite / Recently Used / 13 themed folders), the
**two-column category tile grid with photographic previews**, the **page-dot indicator**,
**sort control**, **animated thumbnails** toggle, and the **36 extra categories**. Stock Alight
Motion has ~15 folders; the mod's list of 19 folders is an AmzTools addition.

### 1.7 AmzLabs — 13 tools

Opened from the floating AM button. A centered mod logo, title **After Motion Z Labs** in green,
subtitle "Features Added By Satriyaid", then a **vertical list of tool cards**, each: bold title,
two-to-four-line grey description, and a `›` chevron at the right. A **CLOSE** button pinned at
the bottom.

The 13 tools and their exact claims:

| Tool | What the card says |
|---|---|
| Depth Map Generator | AI depth map from a picture or video, made on this phone (MiDaS), with live preview |
| Background Remover | AI cut-out of a person or any object, from picture or video. Transparent PNG, solid-colour video or matte |
| AI Upscale | Sharper and bigger pictures and videos (Real-ESRGAN 2×/4×), Before/After preview |
| TikTok Anti Compress | Rewrites only metadata of an MP4/MOV, zero quality loss: colour tags, clean tags + fast start, iPhone device tag, fresh date, resolution and bitrate tags |
| Twixtor | Optical-flow slow motion (10–75 %) or FPS boost to 24/30/60 fps: Motion, Blend or Nearest frames, flow quality, audio pitch kept/down/mute |
| Dead Frame Remover | Finds duplicate frames (lag, stutter, 24 fps inside 60 fps), exports with only new frames. Same length, audio in sync |
| Stabilizer | Removes camera shake (Warp-Stabilizer-like): Smooth Motion or No Motion, smoothness, rolling-shutter fix, auto crop, audio kept |
| Audio Converter | Any audio file, or the sound of a video, to M4A (AAC), WAV or FLAC: bitrate, sample rate, channels, trim, volume, fades |
| AI Frame Interpolation | AI (RIFE) makes new frames between real ones: 2×/3×/4× or 60/120 fps; model 10 MB downloaded once |
| Audio Denoise | Removes background noise (fan, wind, traffic, hum, room) from voice, on-phone (RNNoise) |
| Reverse Video | Plays a video backwards, sound reversed too; saved to `Download/AfterMotionZ/AmzReverse` |
| Convert Video | Any video to a new MP4: size, frame rate, H.264/H.265, bitrate; saved to `AmzConvert` |

**EditorsHub — what actually exists:**

| Tool | Status in EditorsHub | Evidence |
|---|---|---|
| Background Remover | **Exists, real** | `OMSBackgroundRemoval` with a MODNet ONNX model, `limit` guards, `SOURCE_MATTE` render kind |
| Stabilizer | **Exists as a tracker mode** | motion tracker with `mode==='stabilizer'` using a robust similarity fit |
| Twixtor | **Partial** — frame blending only | `native-shell/smooth-motion.js` averages adjacent frames; **no optical flow** (0 hits for `opticalFlow`/`RIFE`) |
| Everything else | **Absent** | depth map, upscale, anti-compress, dead-frame, audio converter, RIFE, denoise, reverse, convert: 0 hits each |

Two of the three present pieces are broken in the shipped APK. See §4.

### 1.8 Patcher Menu — 28 switches

A modal, dark navy, mint accents. Title **Patcher Menu**, subtitle "Modded by Satriyaid",
a search field ("Search Patch"), then grouped sections with a green section header. Each row:
title, multi-line description, and a control — either a **mint toggle switch**, a **two- or
four-way segmented control**, or a **numeric stepper** (a rounded box with the value).

Groups seen: FEATURES, OTHER, DISPLAY, FIXED BUGS, PERFORMANCE, AMZTOOLS, SELECTION LAYER.

The toggles, verbatim:

- Link To Null Button · Link To Camera Button (reorderable with ▲▼)
- AmzTools Animation (Off / Fade / Slide Right / Slide Bottom)
- Select All Button · Hide / Show Layers Button
- Effect Preview Dim · Thumbnail Frame on Export
- Effect Search Delay (ms) — stepper, default **444**, range 50–1000
- Custom Background Color (hex input, default DD0000)
- Auto Rename Text Layer (Off / Only Duplicate / All Text)
- Frame Rate & Default Layer (merges Duration into the Frame Rate row)
- Lock Camera View While Playing · Lock Preview Button · Direct Effect Choice
- Confirm Style (Confirm Dialog / Double Back)
- Confirm Before Leaving Editor · Paste Style Category First · Override Save Path
- Frame Cache · Frame Cache Size (MB) (stepper, default **192**, range 64–1024) · Auto Fill Frame Cache · Skip Late Frames
- iOS Styles (dropdown)
- Sign In Screen Fix · Fix Stroke Alpha · Stable Heavy Export
- Cap Preview FPS · Preview FPS Cap (stepper, default **30**, range 5–60) · Light UI While Playing
- Smooth End Replay Audio
- Reset Dont Show Dialogs (Reset button) · Clear Export Cache (Clear button, shows current size)

Footer: **RESET** and **SAVE**.

**EditorsHub:** no settings surface of any kind. There is no settings screen, no toggles, no
preferences store, no export log, no frame-cache sizing. The only configurable things are the
project's own properties and the UI language (14 languages via `LANGUAGES`, a **superset** of the
mod's 19 — EditorsHub has id, en, zh, ja, ms, th, vi, fil, my, km, lo, tet, pt, ta).

### 1.9 Feedback dialog

A "Send Feedback" modal with a 3-way segmented Type control (Bug Report / Feature Request /
Other), a Message textarea whose placeholder and the Subject line change per type, an
**Include Device Info** toggle with an explanation of what ON adds, a line naming the destination
address, and Cancel / Send. Nothing is sent until the mail app's own send is tapped.

**EditorsHub:** absent.

### 1.10 Other modals read from screenshots

- **Theme picker** (popover under the sun icon): Original / Dark / **Amoled**, each a row with an
  icon and a label, the active one highlighted with a lavender pill. EditorsHub has **zero**
  theme support (`amoled` = 0 hits).
- **Send Feedback** (above).

---

## 2. The 150 new effects, by group

Read from screenshot 35–37. This is the mod's added effect list, in its own grouping:

- **AE Inspiration (65)** — 8Bit AE, Advance Pencil Sketch AE, AutoPaint AE, Burn Film AE, Burning Wipe AE, Card Wipe AE, CC Ball Action, CC Card Dance, Channel Blur AE, Cross Glitch AE, Data Glitch AE, Datamosh AE, Deep Glow AE, Digital Block Wipe AE, Displacer Pro AE, Echospace AE, Etching AE, Flicker Reduction AE, Force Motion Blur AE, Freeze Frame AE, Frosted Glass AE, Glitchify AE, Gradient Wipe AE, HoloMatrix AE, Lens Blur AE, Levels AE, Motion Tile AE, Particles AE, Pixel Sorter 2 AE, Pixel Wipe AE, Posterize Time AE, RimLight AE, Ripple AE, Scale Wipe AE, Scatterize AE, Scribble AE, Shake AE, Sharpen AE, Signal AE, Smart Motion Blur AE, Text Animator, Text Animator 2, Text Case Wave, Text Evolution, Text Glitch, Text Highlight, Text Marquee, Text Scatter, Text Wiggle, Threshold RGB AE, Time Difference AE, Time Displacement AE, Time Echo AE, Time Slice, Time Warp AE, Time Warp RGB, Trails AE, Turbulent Displace AE, TV Damage AE, Twirl AE, Twister AE, Twitch AE, Twixtor AE, Venetian Blinds AE, Wide Time AE
- **Generate (28)** — Audio Kaleidoscope, Audio Particles, Audio Visualizer Pro, Black Hole, Bokeh Overlay, Bonfire Sparks, DNA Helix Shapes, Film Scratch, Ghost Echo, Halfdot Shape, Light Leak Dispersion, Lightning Storm, Metal Texture, Neural Network, Orbit Particles, Particle Tunnel, Psyko Blobs, Random Stars, Simple Glitter, Snowflakes, Space Ring, Sparkle Stars, Spectrum Bar, Spectrum Studio, Storm Clouds, Turbulent Fire, VHS Comet Noise, Wave Lines
- **Distortion (15)** — Cross Glitch 2, CRT Monitor, Flutter, Glitch Mask Lines 2, Glitch Random Pattern 2, Glitch RGB 2, NTSC Composite, Polar Warp 2, Polytrace Pro, Raindrop Stream, Shockwave, Simple Distort, Tear & Block Glitch, Voronoi Poly, Warp Styles
- **Color & Light (11)** — Advanced Invert, Black & White Mixer, Bleach Bypass, Blend Mode Pro, Clarity, Color Steal, Dehaze, Lift Gamma Gain, Manga Negative, Penta GradMap, RGB Curves Pro
- **Blur & Sharpen (5)** — Auto Motion Blur RGB, Chromatic Glow, Glow Pro, Morphism Glass, Tilt Shift Blur
- **Stylize (12)** — 3 Color Gradient Pro, Advance Shadow, Advance Stroke, ASCII Art, ASCII Matrix, Bar Color Palette, Broken Portrait, Emboss, Find Edges Clean, Highlight Sparkle, Orbit Gradient Lights, Smooth Bevel Gloss
- **Matte & Wipe (9)** — Depth 3D Photo, Depth Blur, Depth Fog, Depth Matte, Depth Relight, Diamond Checker Wipe, Dust Wipe, Noise Crossfade Wipe, Slice Transition
- **Transform (3)** — Auto Jedag Jedug, Shake Lighter, Twitch 2
- **Opacity (1)** — Flicker Pro
- **Other (1)** — Half Fold 3D

**EditorsHub has 93 effects in 8 categories.** For comparison:

| Present in EditorsHub | Not present |
|---|---|
| brightness/contrast, hue/saturation, fill, vignette, motion tile, transform, crop, wave warp, bulge, chromatic aberration, drop shadow, border, directional/zoom/spin/transform motion blur, gaussian blur, particular (particles), shatter, audio spectrum, text animator | every AE-inspired effect, the whole Generate set except Particular, every Depth effect, ASCII, Glow Pro, RGB Curves Pro, Dehaze, Polytrace, Voronoi, CRT, NTSC, Datamosh, Time Warp, Trails, Freeze Frame, all Text Evolution/Glitch/Wiggle/Marquee variants |

The gap is roughly **93 vs 243** (93 + 150), i.e. EditorsHub has about 38 % of the mod's effect
count, and the missing ones include all the text-animation effects and all the depth effects.

## 3. The 96 new shapes

Read from screenshot 36–37: Arrow Triangle, Diamond, Ginger Thin, Ginger, Kites, Pyramid,
Custom Shape A/B/C, Simcard, Simcard Mini, Wind Mill, Arrow 2, Tech Panel 1–14, Corner Tile 1–6,
Squircle, Heart, Gear, Scallop Badge, Flower, Cloud, Lightning Bolt, Sparkle, Shield, Location Pin,
Chevron, Block Arrow, Parallelogram, Trapezoid, Bookmark, Check Mark, Semicircle, Ticket,
Corner Frame, Pill, X Mark, Asterisk, HUD Brackets, Circuit Line, Chat Bubble, Cursor Arrow,
Play Button, Pause, Menu Lines, Battery, Folder, Price Tag, Phone Frame, Ring, Window Frame,
Toggle Switch, Signal Bars, Brutal Panel 1–3, Burst Badge, Pixel Frame, Folded Card, Slab Banner,
Window Tab, Chunky Arrow, Diagonal Arrow, Bent Arrow, U-Turn Arrow, Curved Arrow, Chevron Stack,
Double Arrow, Pixel Arrow, Expand Arrows, Nav Pointer, Pixel Chevron, Down Chevrons, Line Arrow,
Notch Nav Bar, Crossed Box, Hatch Block, Triangle Frame, Crosshair Plus.

**EditorsHub has 66 shape primitives.** Overlap is high for the basics (diamond, heart, chevron,
pill, cloud, flower, lightning, shield, bookmark, checkmark, trapezoid, parallelogram, star
family), and EditorsHub has shapes the mod list does not show (multifoil, crescent, donut, pie,
banner1/2, bell, capsule, drop, droplet, flag, flame, leaf, lock, moon, octagon, penta, ring,
rocket, paperplane, speech, sun, snowflake, arc, badge, burst, freehand, vector). What is missing
is the **UI-kit name set** — the 14 Tech Panels, 6 Corner Tiles, 3 Brutal Panels, HUD Brackets,
Circuit Line, Notch Nav Bar, and so on. Those are decorative components, not new geometry
primitives.

---

## 4. Three defects found while auditing

These are not style differences. They are broken behaviour, and two of them mean the
"AI" effect in this app cannot run at all.

### 4.1 The AI background remover cannot work offline

`OMSBackgroundRemoval` is real code, but it loads:

- `onnxruntime-web@1.30.0` from `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/`
- a 24 MB-class `.onnx` model from `https://huggingface.co/PotterWhite/AlphaMattingModels/...`

Verified in the built APK bundle: both URLs survive the build. CI's CDN guard only checks for
the mediabunny CDN — it does not check `onnxruntime`. The app declares INTERNET, so on a device
with a connection it may work; with no connection, or behind a filter, the effect fails. A
"fully offline" claim on these screens is not something this code can make.

### 4.2 AI Frame Interpolation (RIFE) does not exist

Zero hits for `RIFE` or `opticalFlow`. `smooth-motion.js` blends neighbouring decoded frames by
weighted average. That is a real feature (it is what makes slow-motion look less steppy) but it is
not frame interpolation and it does not synthesise new motion.

### 4.3 Auto-save is dead in the APK

The Android shell uses `WebViewAssetLoader`, so the origin is **`https://appassets.androidplatform.net`**.
`file://` storage never applies, and the bundle's persistence uses `sessionStorage` / `localStorage`.
`EditorActivity.purgeStaleBundle()` plus the cache purge on update means that origin's storage is
cleared when the bundle changes — which is why projects can appear to vanish after an update.
This is worth confirming on device before trusting any project to survive an update.

---

## 5. Summary tables

### 5.1 Screens

| Screen | Alight Motion + AMZ | EditorsHub | Verdict |
|---|---|---|---|
| Codec evaluation modal | yes, blocking-but-minimisable, determinate | data only in logcat | **Missing UI**, data exists |
| Home | wordmark, changelog card, theme/feedback | hero + project list, 4 tabs | **Different design** |
| Projects list | search, 3 tabs, XML upload, 4-field meta | list + sort + selection | **Close**, missing search/upload/tabs |
| Editor empty | 7-icon transport, 2-tier rail | equivalent rail, 5 tabs | **Close**, different layout |
| Layer selected | 2-page pager, 8 panels/page | inspector + drawers | **Partial**, 5 of 16 panels |
| Effect browser | 19 folders + 12 category tiles | 93 effects, 8 categories, search | **Partial**, no folders/tiles |
| AmzLabs | 13 media tools | 1.5 of 13 | **Mostly missing** |
| Patcher Menu | 28 toggles | **31 settings** + search (18 of the 28 have equivalents) | **Done**, exceeds |
| Feedback | modal | nothing | **Missing** |
| Theme picker | 3 themes | **9 themes** (5 dark, 2 light, original) | **Done**, exceeds |
| Settings | — | none | **Missing** |

### 5.2 Counts

| Thing | AMZ | EditorsHub |
|---|---|---|
| Effects | 243 (93 base + 150) | 93 base + **24 rendering** |
| Effect categories | 36 (12 browse + 24 groups) | 8 |
| Shapes | 66 + 96 new = 162 | 66 base + **58 new** |
| Layer types | 8 | 4 (camera, null, group, element) |
| Selection panels | 16 (2 pages) | ~6 |
| Patch toggles | 28 | **31** (18 mapped, rest not applicable) |
| Media tools | 13 | **15** (incl. native MP3) |
| UI languages | 19 | **19** |
| Themes | 3 | **9** |
| Export formats | MP4/H.265, PNG, GIF, image sequence, XML | MP4/WebM, PNG, GIF, JSON, **XML**, AM link |

EditorsHub is ahead on one thing nobody asked about and worth knowing: it has an **Alight Motion
XML interchange** export (with 3D features written as an Open Motion extension) and an
**AM link** publish path. That is a real compatibility feature the mod ships as "XML export" too,
so they are at parity there.

---

## 6. If this becomes work, the order that does not cost features

1. **Settings surface** (a Patcher-Menu-like sheet) — 0 risk, huge perceived gain, and several
   toggles are already implicitly implemented and merely hardcoded: preview quality, frame cache,
   skip late frames, confirm-before-leave.
2. **Codec result card** — the data exists; it needs a modal, a determinate bar and a minimise.
   This also fixes the export ceiling being a guess.
3. **Project search + XML upload + card metadata** — additive, touches one function
   (`loadProjectList`).
4. **Effect folders + category tiles** — presentation over the existing 93-effect catalog.
5. **Missing selection panels** (Shift KF, Split Text, Vectorscope, Beat Maker) — additive.
6. **Layer types** (Linked Camera/Null, Adjustment Layer, IMG Sequence) — additive to the model.
7. **Effects and shapes** — the long tail, each one independent, and the mod's own list is the
   specification.
8. **AmzLabs tools** — 12 of 13 need real media pipelines (encode/decode/ML). These are not UI
   work and should not be scheduled as if they were.

Items 1–6 are all additive and can land without touching the renderer. Item 8 is where the cost
is, and 4.1/4.2 mean two of these tools would be shipped broken if built the way the mod
describes.

---

Nothing in this document has been implemented. No code has changed since the restore to
`88de765`.
