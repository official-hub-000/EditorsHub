#!/usr/bin/env python3
"""
Extracts the untranslated prose *chunks* left inside large runtime templates.

Most leftover text in the vendored document is not a standalone string: the editor
renders big HTML templates (drawers, dialogs, panels) as template literals, so the prose
is trapped between tags inside multi-kilobyte strings. Translating those blobs whole is
error-prone; instead each blob is split into the prose that sits between tags (plus the
attributes inside it) and only those chunks are translated. The patcher then substitutes
chunks inside the literal, so `${...}` expressions, tags and code stay untouched.

Output
    tools/i18n/parts/chunks.json   ordered list of {s: chunk, ctx: text|attr}
    tools/i18n/parts/chunk-NN.json {"start": n, "items": {"<index>": "<english>"}}

Chunks are matched as exact substrings of the decoded literal text, so leading and
trailing spaces matter and are preserved (they separate grouped words).

Run with: python3 tools/i18n/extract-chunks.py
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
OUT = PARTS / "chunks.json"

TAG = re.compile(r"<[^>]*>")
ATTR = re.compile(r'\b(title|placeholder|aria-label|alt|aria-description)="([^"]*)"')
# Indonesian (plus the Malay/Tetum variants shipped in the same document) markers.
PROSE = re.compile(
    r"\b(?:yang|dan|tidak|dengan|atau|untuk|dari|ini|itu|akan|sudah|belum|bisa|pada|jika|hanya"
    r"|juga|lebih|semua|saat|adalah|telah|masih|dapat|gagal|berhasil|hapus|simpan|batal|tutup"
    r"|buka|proyek|projek|lapisan|berkas|pengaturan|tambahkan|pilih|ekspor|impor|putar|durasi"
    r"|warna|teks|gambar|suara|kamera|efek|kesan|tampilan|pratinjau|unduh|bagikan|bahasa|nama"
    r"|ukuran|kecepatan|mulai|kembali|ubah|atur|salin|tempel|baru|kosong|aktif|siap|selesai"
    r"|memuat|membuat|menyimpan|menghapus|mengubah|menambah|memilih|menampilkan|memproses"
    r"|mendukung|tersedia|diperlukan|terpilih|terkunci|terakhir|pertama|kedua|sebelum|selama"
    r"|hingga|sampai|tanpa|mungkin|harus|perlu|sangat|paling|kecil|besar|cepat|lambat|masuk"
    r"|keluar|atas|bawah|kiri|kanan|tengah|sekarang|waktu|detik|jumlah|bagian|daftar|isi|hasil"
    r"|contoh|pesan|kesalahan|peringatan|coba|ulang|tunggu|otomatis|manual|asli|salinan|sama"
    r"|berbeda|lain|sendiri|umum|khusus|utama|tambahan|wajib|maksimal|minimal|antara|serta"
    r"|seperti|misalnya|tersebut|begitu|secara|terus|dulu|seluruh|pengguna|perangkat|layar"
    r"|tombol|menu|panel|bilah|garis|titik|sudut|bentuk|objek|posisi|rotasi|skala|opasitas"
    r"|kunci|tanda|penanda|bingkai|lacak|geser|ketuk|tekan|di|ke|no|sei|husi|bele|ita|ne'eb"
    r"|ba|iha|la'os|deit|apropriadu|dezenvolve|dezenvolvimentu)\b",
    re.I,
)
# Chunks that are code, CSS or shader source rather than UI prose.
CODEY = re.compile(r"(//|/\*|\bvar\(--|\bconst |\blet |function\s*\(|=>|\buniform\b|\bvec[234]\b"
                   r"|\breturn\b|\bprecision\b|\bglsl\b|\[data-)", re.I)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_dictionary() -> set[str]:
    """Everything already translated, so new batches stay focused."""
    known: set[str] = set()
    for n in range(15):
        path = PARTS / f"script-{n:02d}.jsonl"
        if path.exists():
            known.update(row["s"] for row in load_jsonl(path))
    for path in PARTS.glob("chunk-*.json"):
        if path.name == "chunks.json":
            continue
        known.update(key for key in json.loads(path.read_text(encoding="utf-8"))["items"].values())
    return known


def collect(known: set[str]) -> list[dict]:
    raw = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    seen: dict[str, str] = {}
    for _, body in jsscan.script_blocks(raw):
        for lit in jsscan.scan(body):
            if not lit.template:
                continue
            text = jsscan.unescape(lit.text)
            for start, end in [(p.start, p.end) for p in jsscan.template_parts(text)]:
                segment = text[start:end]
                cursor = 0
                for m in TAG.finditer(segment):
                    _add(seen, known, segment[cursor:m.start()], "text")
                    cursor = m.end()
                _add(seen, known, segment[cursor:], "text")
                for m in ATTR.finditer(segment):
                    _add(seen, known, m.group(2), "attr")
    return [{"s": text, "ctx": ctx} for text, ctx in seen.items()]


def _add(seen: dict[str, str], known: set[str], text: str, ctx: str) -> None:
    if not text or not text.strip():
        return
    if TAG.search(text) or CODEY.search(text) or not PROSE.search(text):
        return
    if text in known:
        return
    seen.setdefault(text, ctx)


def main() -> int:
    chunks = collect(load_dictionary())
    # Chunks are matched greedily by length at patch time, so a fixed order is all the
    # batches need; keep indices stable across runs.
    chunks.sort(key=lambda c: (-len(c["s"]), c["s"]))
    OUT.write_text(json.dumps(chunks, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"wrote {len(chunks)} chunks ({sum(len(c['s']) for c in chunks)} chars) to "
          f"{OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
