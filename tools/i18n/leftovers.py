#!/usr/bin/env python3
"""
Detects strings in the bundled editor that a user can still read in Indonesian.

Why not a hand-written word list
--------------------------------
The first version of this scan carried a hand-picked list of Indonesian words. Every time
the list was trimmed to remove false positives (`minimal`, `panel`, `manual`, `elegan`) it
lost real signal too — `buat`, `animasi`, `gerak` and `biasa` were all absent while the
home screen still read *"Buat Animasi Gerak Luar Biasa"*. A curated list cannot keep up
with a 9.7 MB document.

Instead the vocabulary is *derived from the translations themselves*: every source string
in `tools/i18n/parts/*.jsonl` is Indonesian, and every `en` value is English. A word that
occurs on the source side and never on the English side is Indonesian vocabulary. Nothing
has to be maintained by hand, and the list grows automatically as translations are added.

Output
    tools/i18n/parts/leftovers.jsonl   {"k": kind, "s": indonesian}
    plus a readable summary on stdout.

Run with: python3 tools/i18n/leftovers.py [--all]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jsscan_linear as jsscan  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PARTS = Path(__file__).resolve().parent / "parts"
SOURCE = ROOT / "web" / "index.html"
EDITS = Path(__file__).resolve().parent / "edits.json"
OUT = PARTS / "leftovers.jsonl"

WORD = re.compile(r"[A-Za-z][A-Za-z'-]{2,}")

# Vocabulary that is Indonesian but also appears in English UI copy. Without this the
# detector flags translated text: `manual`, `minimal` and `panel` are normal English.
AMBIGUOUS = {
    "manual", "minimal", "panel", "menu", "total", "normal", "audio", "video", "media",
    "layer", "layers", "mode", "render", "format", "export", "import", "project",
    "template", "mask", "alpha", "camera", "blend", "effect", "effects", "frame",
    "frames", "fps", "keyframe", "keyframes", "text", "shape", "audio", "texture",
    "shader", "gpu", "cpu", "ram", "url", "api", "web", "app", "code", "file", "font",
    "size", "speed", "scale", "auto", "animation", "motion", "graphics", "studio",
    "preview", "render", "cache", "buffer", "track", "tracking", "point", "points",
    "grid", "snap", "icon", "logo", "item", "data", "model", "preset", "presets",
    "status", "error", "info", "debug", "log", "logs", "test", "result", "value",
}

# Words that are code, not copy. A string made only of these is never user-visible text.
CODE_WORDS = {
    "const", "let", "var", "function", "return", "true", "false", "null", "undefined",
    "new", "this", "typeof", "instanceof", "await", "async", "catch", "throw", "class",
    "extends", "import", "export", "default", "window", "document", "element", "array",
    "object", "prototype", "length", "push", "slice", "splice", "concat", "string",
}


def load_vocabulary() -> tuple[set[str], set[str]]:
    """(indonesian words, english words) learned from the reviewed translation stores."""
    source_words: Counter[str] = Counter()
    english_words: set[str] = set()
    for path in sorted(PARTS.glob("*.jsonl")):
        if path.name in ("leftovers.jsonl", "pass4.jsonl", "pass3.jsonl", "untranslated.jsonl"):
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            source, english = row.get("s"), row.get("en")
            if isinstance(source, str):
                source_words.update(w.lower() for w in WORD.findall(source))
            if isinstance(english, str):
                english_words.update(w.lower() for w in WORD.findall(english))
    indonesian = {
        word for word in source_words
        if word not in english_words and word not in AMBIGUOUS and word not in CODE_WORDS
    }
    return indonesian, english_words


def looks_indonesian(text: str, vocabulary: set[str]) -> bool:
    words = [w.lower() for w in WORD.findall(text)]
    if not words:
        return False
    return any(word in vocabulary for word in words)


def load_spans() -> list[tuple[int, int]]:
    """The source ranges `edits.json` already replaces."""
    if not EDITS.exists():
        return []
    payload = json.loads(EDITS.read_text(encoding="utf-8"))
    return [(int(start), int(end)) for start, end, _ in payload["edits"]]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true",
                        help="also list candidates outside markup text and attributes")
    args = parser.parse_args()

    vocabulary, _ = load_vocabulary()
    html = SOURCE.read_text(encoding="utf-8")
    covered = sorted(load_spans())

    def is_covered(start: int, end: int) -> bool:
        return any(a <= start and end <= b for a, b in covered)

    blocks = jsscan.script_blocks(html)
    styles = [(m.start(1), m.end(1))
              for m in re.finditer(r"<style\b[^>]*>(.*?)</style>", html, re.S | re.I)]
    spans = [(a, a + len(b)) for a, b in blocks] + styles

    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in spans)

    found: dict[str, str] = {}

    def offer(text: str, start: int, end: int, kind: str) -> None:
        text = text.strip()
        if not text or text in found:
            return
        if len(text) < 3 or len(text) > 400 or not looks_indonesian(text, vocabulary):
            return
        # Embedded assets and style sheets are matched by the markup scan because a data
        # URI or a <style> body has no angle brackets; neither is copy.
        if text.startswith(("data:", "AGFzbQ", "UklGR")) or "base64," in text[:64]:
            return
        if text.startswith(("/*", "//", "#", ".", "@")) or re.search(r"[{};]", text):
            if not re.search(r">\s*[A-Z]", text):
                return
        if is_covered(start, end):
            return
        found[text] = kind

    # Markup text nodes and attributes are what a user sees on screen.
    for m in re.finditer(r">([^<>]+)<", html):
        if inside(m.start()):
            continue
        if re.match(r"^[.#@][\w-]{0,80}\{", m.group(1).strip()):
            continue  # a style sheet left in the body
        offer(m.group(1), m.start(1), m.end(1), "html-text")

    for m in re.finditer(r'\b(title|placeholder|aria-label|alt|aria-description)="([^"]+)"', html):
        if not inside(m.start()):
            offer(m.group(2), m.start(2), m.end(2), f"html-attr:{m.group(1)}")

    for m in re.finditer(r'content\s*:\s*"([^"]{3,})"', html):
        offer(m.group(1), m.start(1), m.end(1), "css-content")

    if args.all:
        # Runtime strings: template prose, and text nodes of markup built as a string.
        for body_start, body in blocks:
            for lit in jsscan.scan(body):
                text, offsets = jsscan.unescape_map(lit.text)
                base = body_start + lit.start
                segments: list[tuple[str, int]] = []
                if lit.template:
                    segments += [(text[p.start:p.end], p.start)
                                 for p in jsscan.template_parts(text)]
                segments.append((text, 0))
                for segment, origin in segments:
                    cursor = 0
                    for piece in re.split(r"(<[^>]*>)", segment):
                        start = cursor
                        cursor += len(piece)
                        if piece.startswith("<") or not piece.strip():
                            continue
                        lead = len(piece) - len(piece.lstrip())
                        stop = len(piece.rstrip())
                        offer(piece,
                              base + offsets[origin + start + lead],
                              base + offsets[origin + start + stop],
                              "script")

    rows = sorted(found.items(), key=lambda kv: (-len(kv[0]), kv[0]))
    OUT.write_text("\n".join(json.dumps({"k": kind, "s": text}, ensure_ascii=False)
                             for text, kind in rows) + "\n", encoding="utf-8")
    print(f"vocabulary {len(vocabulary)} words")
    print(f"{len(rows)} untranslated strings ({sum(len(t) for t, _ in rows)} chars) -> {OUT}")
    for text, kind in rows[:60]:
        print(f"  [{kind}] {text[:110]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
