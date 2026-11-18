#!/usr/bin/env python3
"""
Finds strings that are still not English after the current dictionary is applied.

The translation batches are filled in passes: the first pass covers standalone literals,
markup text and large template prose; later passes pick up fragments that only become
visible once the surrounding text is English (interpolated attribute pieces such as
`' • press and hold to type a value'`, status labels inside `${...}` holes, ...).

Output
    tools/i18n/parts/extra-NN.jsonl   {"s": text, "ctx": kind}      newest leftovers only

Translate each batch into `extra-NN.en.jsonl` (same order, `{"s": english}`) and re-run
`tools/i18n/build-edits.py`; repeat until this script reports nothing new.

Run with: python3 tools/i18n/find-leftovers.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jsscan_linear as jsscan  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PARTS = Path(__file__).resolve().parent / "parts"
PATCHED = Path("/tmp/patched.html")  # written by tools/i18n/preview.py

STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
ATTR = re.compile(r'\b(title|placeholder|aria-label|alt|aria-description)="([^"]+)"')
INDONESIAN = re.compile(
    r"\b(?:yang|dan|tidak|dengan|untuk|proyek|lapisan|berkas|pengaturan|ekspor|impor|simpan"
    r"|batal|tutup|kembali|pilih|nama|ukuran|warna|teks|gambar|kamera|efek|geser|ketuk|tekan"
    r"|kunci|kuncian|hanya|juga|masih|sudah|belum|bisa|dapat|sedang|saat|dari|ke|di|ini|itu"
    r"|terkunci|tersedia|aktif|nonaktif|keyframe|kualitas|jumlah|waktu|detik|frame|layer"
    r"|analisis|parameter|lensa|optik|properti|komposisi|ubah|ujung|awal|akhir|marker"
    r"|preset|kustom|kategori|ekspresi|tema|sampling|memori|diagnostik)\b",
    re.I,
)
CODEY = re.compile(r"(^\s*(?://|/\*|\*)|=>|[{};]\s*$|\bconst\b|\bfunction\b|\[data-|--oms-)")


def load_dictionary() -> set[str]:
    known: set[str] = set()
    for path in PARTS.glob("script-*.jsonl"):
        if path.name.endswith(".en.jsonl"):
            continue
        known.update(json.loads(line)["s"] for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    for path in PARTS.glob("extra-*.jsonl"):
        if path.name.endswith(".en.jsonl"):
            continue
        known.update(json.loads(line)["s"] for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    for path in PARTS.glob("chunk-*.json"):
        if path.name == "chunks.json":
            continue
        for english in json.loads(path.read_text(encoding="utf-8"))["items"].values():
            known.add(english)
    chunks = json.loads((PARTS / "chunks.json").read_text(encoding="utf-8"))
    known.update(chunk["s"] for i, chunk in enumerate(chunks)
                 if any(str(i) in json.loads(p.read_text(encoding="utf-8"))["items"]
                        for p in PARTS.glob("chunk-*.json") if p.name != "chunks.json"))
    return known


def interesting(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 3:
        return False
    if CODEY.search(stripped):
        return False
    if re.fullmatch(r"[\W\d_]+", stripped):
        return False
    return True


def main() -> int:
    source = PATCHED if PATCHED.exists() else ROOT / "web" / "index.html"
    raw = source.read_text(encoding="utf-8")
    known = load_dictionary()

    found: dict[str, str] = {}
    styles = [(m.start(1), m.end(1)) for m in STYLE_BLOCK.finditer(raw)]
    blocks = jsscan.script_blocks(raw)
    spans = [(start, start + len(body)) for start, body in blocks] + styles

    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in spans)

    for m in ATTR.finditer(raw):
        if inside(m.start()):
            continue
        text = m.group(2)
        if text not in known and interesting(text):
            found.setdefault(text, f"html-attr:{m.group(1)}")
    for m in re.finditer(r">([^<>]+)<", raw):
        if inside(m.start()):
            continue
        if raw[max(0, m.start() - 60):m.start()].lower().endswith("base64,"):
            continue  # embedded image payload, not text
        text = m.group(1)
        if text not in known and interesting(text):
            found.setdefault(text, "html-text")

    for _, body in blocks:
        for lit in jsscan.scan(body):
            text = jsscan.unescape(text)
            if text in known:
                continue
            if interesting(text):
                found.setdefault(text, "script-template" if lit.template else "script")
                continue
            # Fragments inside interpolated attributes: check prose around tags.
            if not lit.template:
                continue
            for part in jsscan.template_parts(text):
                segment = text[part.start:part.end]
                for piece in re.split(r"<[^>]*>", segment):
                    if piece not in known and interesting(piece):
                        found.setdefault(piece, "script-template")

    old = sorted(PARTS.glob("extra-*.jsonl"))
    for path in old:
        if not path.name.endswith(".en.jsonl"):
            path.unlink()
    rows = sorted(found.items(), key=lambda kv: -len(kv[0]))
    chunk = 80
    for i in range(0, len(rows), chunk):
        (PARTS / f"extra-{i // chunk:02d}.jsonl").write_text(
            "\n".join(json.dumps({"s": s, "ctx": ctx}, ensure_ascii=False)
                      for s, ctx in rows[i:i + chunk]) + "\n",
            encoding="utf-8",
        )
    print(f"{len(rows)} leftover strings in {(len(rows) + chunk - 1) // chunk} batch(es) "
          f"({sum(len(s) for s, _ in rows)} chars), scanned {source}")
    for s, ctx in rows[:10]:
        print(f"  [{ctx}] {s[:90]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
