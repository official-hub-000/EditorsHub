#!/usr/bin/env python3
"""
Locates the string literals of the vendored editor document.

The editor is a single ~9.7 MB HTML file whose inline scripts add up to ~9 MB, which
rules out regular expressions (a lazy quoted-literal pattern backtracks for minutes on
that input). This is a linear character scanner covering the states that matter for
translation: string literals, template literal prose, line/block comments and regular
expression literals (the last one is why a naive scanner desyncs — `/'/` would otherwise
look like the start of a string).

Usage
    python3 tools/i18n/jsscan_linear.py            # summary per script block
    python3 tools/i18n/jsscan_linear.py --check    # also verify dictionary coverage
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "web" / "index.html"
PARTS = Path(__file__).resolve().parent / "parts"

SCRIPT_BLOCK = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
# Block types whose contents are not JavaScript (embedded payloads, licences, ...).
NON_JS_TYPE = re.compile(r'type\s*=\s*"(?:text/plain|application/(?:json|octet-stream))"', re.I)
# A `/` directly after one of these is a regex literal, not division.
REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>")
REGEX_KEYWORDS = (
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case",
    "do", "else", "yield", "await", "throw",
)


@dataclass
class Literal:
    text: str     # literal contents exactly as written (escapes not decoded)
    start: int    # offset of first content character in the scanned body
    end: int
    quote: str    # ' " or `
    template: bool


@dataclass
class TemplatePart:
    text: str
    start: int
    end: int


def _ident_before(body: str, i: int) -> str:
    j = i
    while j > 0 and (body[j - 1].isalnum() or body[j - 1] in "_$"):
        j -= 1
    return body[j:i]


def _prev_significant(body: str, i: int) -> str:
    j = i - 1
    while j >= 0 and body[j] in " \t\r\n":
        j -= 1
    return body[j] if j >= 0 else ""


def _skip_regex(body: str, i: int) -> int:
    """Skips a regex literal starting at `i`; returns the index after its flags."""
    n = len(body)
    j = i + 1
    in_class = False
    while j < n:
        c = body[j]
        if c == "\\":
            j += 2
            continue
        if c == "\n":
            return j  # not a regex after all
        if in_class:
            if c == "]":
                in_class = False
        elif c == "[":
            in_class = True
        elif c == "/":
            j += 1
            while j < n and body[j].isalpha():
                j += 1
            return j
        j += 1
    return n


def scan(body: str) -> list[Literal]:
    out: list[Literal] = []
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if c == "/":
            nxt = body[i + 1] if i + 1 < n else ""
            if nxt == "/":
                nl = body.find("\n", i)
                i = n if nl == -1 else nl + 1
                continue
            if nxt == "*":
                close = body.find("*/", i + 2)
                i = n if close == -1 else close + 2
                continue
            prev = _prev_significant(body, i)
            word = _ident_before(body, i)
            if prev and (prev in REGEX_PRECEDERS or word in REGEX_KEYWORDS):
                i = _skip_regex(body, i)
                continue
            i += 1
            continue
        if c in "'\"":
            j = i + 1
            while j < n:
                d = body[j]
                if d == "\\":
                    j += 2
                    continue
                if d == c:
                    out.append(Literal(body[i + 1:j], i + 1, j, c, False))
                    i = j + 1
                    break
                if d == "\n":
                    i = j
                    break
                j += 1
            else:
                i = n
            continue
        if c == "`":
            i = _scan_template(body, i, out)
            continue
        i += 1
    return out


def _scan_template(body: str, i: int, out: list[Literal]) -> int:
    n = len(body)
    start = i + 1
    j = start
    while j < n:
        c = body[j]
        if c == "\\":
            j += 2
            continue
        if c == "`":
            out.append(Literal(body[start:j], start, j, "`", True))
            return j + 1
        if c == "$" and j + 1 < n and body[j + 1] == "{":
            j = _scan_hole(body, j + 2, out)
            continue
        j += 1
    return n


def _scan_hole(body: str, i: int, out: list[Literal]) -> int:
    """Skips a `${...}` hole while scanning any literals inside it."""
    n = len(body)
    depth = 1
    while i < n:
        c = body[i]
        if c in "'\"":
            j = i + 1
            while j < n:
                d = body[j]
                if d == "\\":
                    j += 2
                    continue
                if d == c:
                    out.append(Literal(body[i + 1:j], i + 1, j, c, False))
                    i = j + 1
                    break
                if d == "\n":
                    i = j
                    break
                j += 1
            else:
                return n
            continue
        if c == "`":
            i = _scan_template(body, i, out)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


def unescape(raw: str) -> str:
    """Decodes the escapes a JS string/template literal may contain."""
    out: list[str] = []
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        nxt = raw[i + 1]
        if nxt in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[nxt])
            i += 2
        elif nxt == "u" and i + 5 < n:
            out.append(chr(int(raw[i + 2:i + 6], 16)))
            i += 6
        elif nxt == "x" and i + 3 < n:
            out.append(chr(int(raw[i + 2:i + 4], 16)))
            i += 4
        elif nxt == "\n":
            i += 2  # line continuation
        else:
            out.append(nxt)
            i += 2
    return "".join(out)


def unescape_map(raw: str) -> tuple[str, list[int]]:
    """Decodes `raw` and returns the decoded text plus a raw-offset map.

    `offsets[i]` is the index in `raw` where decoded character `i` starts, and
    `offsets[len(text)]` is `len(raw)`. It lets the patcher translate offsets inside the
    decoded text (where prose is easy to find) back to real document positions.
    """
    out: list[str] = []
    offsets: list[int] = []
    i, n = 0, len(raw)
    while i < n:
        c = raw[i]
        offsets.append(i)
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        nxt = raw[i + 1]
        if nxt in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[nxt])
            i += 2
        elif nxt == "u" and i + 5 < n:
            out.append(chr(int(raw[i + 2:i + 6], 16)))
            i += 6
        elif nxt == "x" and i + 3 < n:
            out.append(chr(int(raw[i + 2:i + 4], 16)))
            i += 4
        elif nxt == "\n":
            i += 2
        else:
            out.append(nxt)
            i += 2
    offsets.append(n)
    return "".join(out), offsets


def escape(text: str, quote: str) -> str:
    """Re-escapes plain text for the literal style it is spliced into."""
    text = text.replace("\\", "\\\\")
    if quote == "`":
        return text.replace("`", "\\`").replace("${", "\\${")
    return text.replace(quote, "\\" + quote).replace("\n", "\\n")


def template_parts(text: str) -> list[TemplatePart]:
    """The prose segments of a template literal (text between `${...}` holes)."""
    parts: list[TemplatePart] = []
    cursor, depth, i, n = 0, 0, 0, len(text)
    while i < n:
        c = text[i]
        if c == "$" and i + 1 < n and text[i + 1] == "{" and depth == 0:
            if i > cursor:
                parts.append(TemplatePart(text[cursor:i], cursor, i))
            depth = 1
            i += 2
            continue
        if depth:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    cursor = i + 1
        i += 1
    if cursor < n:
        parts.append(TemplatePart(text[cursor:n], cursor, n))
    return parts


def script_blocks(raw: str) -> list[tuple[int, str]]:
    """(body_start, body) for every JavaScript block, in document order."""
    return [
        (m.start(2), m.group(2))
        for m in SCRIPT_BLOCK.finditer(raw)
        if not NON_JS_TYPE.search(m.group(1))
    ]


def main() -> int:
    raw = DOC.read_text(encoding="utf-8")
    blocks = script_blocks(raw)
    total = 0
    for idx, (_, body) in enumerate(blocks):
        lits = scan(body)
        total += len(lits)
        print(f"  block {idx:2d}  {len(body):>8,} chars  {len(lits):>6} literals")
    print(f"scanned {len(blocks)} JavaScript blocks, {total} literals")

    if "--check" in sys.argv:
        dictionary = set()
        for n in range(15):
            for line in (PARTS / f"script-{n:02d}.jsonl").read_text(encoding="utf-8").splitlines():
                if line.strip():
                    dictionary.add(json.loads(line)["s"])
        found = set()
        for _, body in blocks:
            for lit in scan(body):
                if lit.text in dictionary:
                    found.add(lit.text)
                if lit.template:
                    for part in template_parts(lit.text):
                        if part.text in dictionary:
                            found.add(part.text)
        missing = sorted(dictionary - found, key=len, reverse=True)
        print(f"dictionary coverage: {len(found)}/{len(dictionary)} script entries found")
        for m in missing[:15]:
            print(f"  missing {m[:80]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
