# Archived: the bundled web editor

`web/`, `native-shell/` and `vendor/` are the Open Motion editor (MIT, © Hada45 and
contributors) that EditorsHub used to bundle and host in a WebView. They are kept here so the
previous application is recoverable, and are **not** part of the build: nothing compiles them,
nothing packages them, and `app/build.gradle.kts` never reads them.

To bring that app back, the whole state is one commit behind this one. See the commit log for
`restore: put EditorsHub back to the state before the Kotlin switch`.

Why it was replaced: the compositor was Canvas2D. Every frame was rasterised on the CPU, and
`ctx.filter` / `shadowBlur` fell back to CPU per layer, which is what made the app lag. Version
2.0 renders the same document on the GPU through OpenGL ES.

Why it might be wanted again: the bundle has 60,566 lines of editor — effects, vector tools, a
curve editor, 3D camera. Version 2.0 is a smaller, faster editor that does not yet have all of
that. Both trees exist; neither is lost.
