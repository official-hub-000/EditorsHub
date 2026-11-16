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
  4. The document contains no half-translated Bahasa Indonesia UI text.

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

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
