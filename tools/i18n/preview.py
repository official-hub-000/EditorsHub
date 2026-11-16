#!/usr/bin/env python3
"""Applies tools/i18n/edits.json to web/index.html and writes /tmp/patched.html.

A quick way to inspect the translation result without running the whole JS build.

Run with: python3 tools/i18n/preview.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
edits = json.loads((ROOT / "tools" / "i18n" / "edits.json").read_text(encoding="utf-8"))
raw = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
out, pos = [], 0
for start, end, replacement in edits["edits"]:
    out.append(raw[pos:start])
    out.append(replacement)
    pos = end
out.append(raw[pos:])
text = "".join(out)
Path("/tmp/patched.html").write_text(text, encoding="utf-8")
print(f"patched preview written: /tmp/patched.html ({len(text):,} chars, "
      f"{len(edits['edits'])} edits)")
