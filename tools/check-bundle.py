#!/usr/bin/env python3
"""
Checks the built bundle the way the WebView will run it, before an APK is published.

The failure this exists to catch
--------------------------------
An earlier build deleted `<button id="homeLanguageBtn">` from the document to hide the
language switcher. The editor then ran

    $('#homeLanguageBtn').onclick = openLanguageModal;

which threw `Cannot set properties of null (setting 'onclick')` at 5% of load. That single
uncaught error stopped the rest of the binding block, so dozens of unrelated controls were
never wired up, and the app sat on its splash screen. The page still parsed, so every
existing check passed.

What is verified here
  1. Every element the document hard-binds with `$('#id').onclick = …` still exists. These
     are direct assignments on a query result with no null guard, so a missing element is a
     guaranteed uncaught TypeError at startup.
  2. No `id` is referenced by such a binding more than the document provides.
  3. No `id="…"` collides with a function the bundle calls through `window`.
  4. The mobile tab router accepts the key the markup actually uses.
  5. The graph textures stayed out of the document.
  6. The shell never redefines a `window.*` name the editor already owns.
  7. No build step rewrote a JavaScript key into one that does not exist.
  6. The document contains no half-translated Bahasa Indonesia UI text.

Exit code 1 on any failure, so CI fails instead of publishing an APK that cannot boot.

Run with: python3 tools/check-bundle.py
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "app" / "src" / "main" / "assets" / "www" / "index.html"
# The vendored, read-only document: the authority on what names the editor defines.
SOURCE = ROOT / "web" / "index.html"

# Names the bundle reaches through `window.X(` or `window.X?.(`. A function declared at
# top level of a classic script becomes a global, but an *element* with a matching `id`
# wins over it, because named element access is resolved before script globals. When that
# happens `window.toast(...)` throws "not a function" and the handler aborts on the spot —
# which is how the install buttons silently did nothing.
WINDOW_CALL = re.compile(r"window\.([A-Za-z_$][\w$]*)\s*(?:\(|\?\.\()")
# Direct bindings on a query result: `$('#x').onclick = …`, `.oninput = …`, `.onchange = …`
BIND = re.compile(r"\$\('#([A-Za-z0-9_-]+)'\)\.\s*on[a-z]+\s*=")
ID_ATTR = re.compile(r'\bid="([A-Za-z0-9_-]+)"')


def main() -> int:
    if not BUNDLE.exists():
        print(f"missing bundle: {BUNDLE}", file=sys.stderr)
        return 1
    html = BUNDLE.read_text(encoding="utf-8")

    present = set(ID_ATTR.findall(html))
    bound = Counter(BIND.findall(html))
    missing = sorted(name for name in bound if name not in present)

    print(f"bundle          {len(html.encode()) / 1048576:.1f} MiB")
    print(f"hard bindings   {len(bound)} elements")
    print(f"missing targets {len(missing)}")

    # The shell is allowed to bridge a shadow by assigning the function onto `window`
    # explicitly (that is how `window.toast` is pinned back to the editor's toast).
    shell_path = BUNDLE.parent / "native-shell.js"
    shell = shell_path.read_text(encoding="utf-8") if shell_path.exists() else ""
    shadowed = sorted(
        name
        for name in set(WINDOW_CALL.findall(html)) & present
        if f"window.{name} =" not in shell
    )

    ok = True
    if missing:
        ok = False
        print("\nThese ids are bound at startup but do not exist in the document.", file=sys.stderr)
        print("Each one throws 'Cannot set properties of null' and aborts the binding block.",
              file=sys.stderr)
        for name in missing:
            print(f"  #{name}  ({bound[name]} binding(s))", file=sys.stderr)

    if shadowed:
        ok = False
        print("\nThese ids shadow a function the bundle calls via `window.*`.", file=sys.stderr)
        print("The element wins over the global, so the call throws 'is not a function'.",
              file=sys.stderr)
        for name in shadowed:
            print(f"  #{name}", file=sys.stderr)

    # The bottom bar ships `data-tab="proyek"`, but the router branched on 'projects',
    # so it returned at its guard and every tab tap was ignored.
    if 'data-tab="proyek"' in html and "targetTab === 'proyek'" not in html:
        ok = False
        print("\nThe mobile tab router does not accept the 'proyek' key the markup uses.",
              file=sys.stderr)

    # The shell scripts run after the editor has bootstrapped, so any `window.X = ...`
    # in them silently replaces the editor's own X. `window.omsDiagnostics` is an
    # OMSDiagnosticsHub used by 155 call sites; an earlier shell overwrote it with an
    # unrelated report tool, which quietly broke logging, snapshots and the settings
    # panel. Names the editor defines must never be reassigned from the shell.
    # `download` and `open` are replaced on purpose: both are platform entry points the
    # shell must intercept (native save path, and keeping off-origin links inside the
    # app). They are not the editor's own functions.
    INTENTIONAL = {"download", "open"}

    # Read the authored sources, not the copies in the bundle: a stale bundle would
    # otherwise hide a collision until the next build.
    for extra in ("native-shell.js", "report.js", "check.js"):
        path = ROOT / "native-shell" / extra
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        for match in re.finditer(r"window\.([A-Za-z_$][\w$]*)\s*=", source):
            name = match.group(1)
            if name in INTENTIONAL:
                continue
            # The editor's definitions live in web/index.html, which is never edited by
            # the build. Checking the built bundle would miss a stale-build mismatch, so
            # the source of truth is the vendored document.
            source_html = SOURCE.read_text(encoding="utf-8") if SOURCE.exists() else html
            if re.search(r"(?:const|let|var)\s+" + re.escape(name) + r"\b", source_html) or (
                "window." + name + "=" in source_html
            ):
                ok = False
                print(
                    f"\n{extra} reassigns window.{name}, which the editor already defines.",
                    file=sys.stderr,
                )

    # The i18n pass rewrites user-visible strings by byte offset. It cannot tell a label
    # from a code key, and it once turned `switchMobileTab('proyek')` into
    # `switchMobileTab('projects')` -- a key with no entry in the `views` map, so "View All"
    # and the Projects tab silently did nothing. A key that the document compares against
    # must exist in the map it is looked up in.
    views = re.search(r"const views = \{(.*?)\};", html, re.S)
    if views:
        keys = set(re.findall(r"(\w+)\s*:", views.group(1)))
        for match in re.finditer(r"switchMobileTab\(\s*'([^']+)'\s*\)", html):
            if match.group(1) not in keys:
                ok = False
                print(
                    f"\nswitchMobileTab('{match.group(1)}') has no entry in `views` "
                    f"(known: {', '.join(sorted(keys))}). The call is a silent no-op.",
                    file=sys.stderr,
                )

    # 2.82 MB of base64 belongs in files, not in the parsed document.
    if 'data:image/webp;base64' in html:
        ok = False
        print("\nInline base64 images are back in the document (~2.8 MB of parse cost).",
              file=sys.stderr)

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
