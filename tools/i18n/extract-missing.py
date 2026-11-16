#!/usr/bin/env python3
"""
Third translation pass: strings the first two passes never picked up.

Passes 1 and 2 were built from `tools/i18n/extract.py`, whose quoted-literal regex stops at
400 characters and skips literals that look like code. That left a tail of short runtime
labels (`'Hapus font lokal'`, `'Di bawah sumber'`, `'Ketuk untuk memilih'`) and a handful of
markup fragments untranslated.

This script applies the *current* edit list to the vendored document, scans the result for
text that still reads Indonesian, and writes the leftovers as a batch in the same shape as
the earlier passes, so they can be translated and loaded by `build-edits.py`:

    tools/i18n/parts/pass3.jsonl        {"k": kind, "s": indonesian}
    tools/i18n/parts/pass3.en.jsonl     {"s": english}            (written by hand, same order)

`k` is `script` for runtime literals (loaded into the dictionary), `html-text` for markup
text nodes and `html-attr:<name>` for attributes.

Run with: python3 tools/i18n/extract-missing.py
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
DOC = ROOT / "web" / "index.html"
# When the built bundle exists it is scanned instead: it already has every earlier pass
# applied, so only genuinely new leftovers show up.
BUILT = ROOT / "app" / "src" / "main" / "assets" / "www" / "index.html"
OUT = PARTS / "pass3.jsonl"

STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
TEXT_NODE = re.compile(r">([^<>]+)<")
ATTR = re.compile(r'\b(title|placeholder|aria-label|alt|aria-description)="([^"]+)"')

# Same word list as extract.py, plus the vocabulary the later surfaces introduced.
ID_WORDS = (
    "yang|dan|tidak|dengan|atau|untuk|dari|ini|itu|akan|sudah|belum|bisa|boleh|pada|jika|kalau"
    "|hanya|juga|lebih|sedang|saja|lagi|semua|setiap|saat|ketika|karena|namun|tetapi|tapi|adalah"
    "|telah|masih|dapat|apakah|bagaimana|silakan|mohon|gagal|berhasil|hapus|simpan|batal|tutup|buka"
    "|proyek|lapisan|berkas|pengaturan|tambahkan|pilih|ekspor|impor|putar|durasi|warna|teks|gambar"
    "|suara|kamera|efek|tampilan|pratinjau|unduh|bagikan|bahasa|nama|ukuran|kecepatan|mulai|kembali"
    "|ubah|atur|salin|tempel|baru|kosong|aktif|siap|selesai|memuat|mengambil|membuat|menyimpan"
    "|menghapus|mengubah|menambah|memilih|menampilkan|memproses|mendukung|tersedia|diperlukan"
    "|dibutuhkan|terpilih|terkunci|terakhir|pertama|kedua|sebelum|sesudah|selama|hingga|sampai"
    "|tanpa|mungkin|pasti|harus|ingin|perlu|sangat|paling|sedikit|banyak|kecil|besar|cepat|lambat"
    "|mudah|sulit|benar|salah|masuk|keluar|atas|bawah|kiri|kanan|depan|belakang|tengah|sekarang"
    "|nanti|tadi|besok|hari|bulan|tahun|waktu|menit|detik|jumlah|bagian|daftar|isi|hasil|contoh"
    "|perintah|pesan|pemberitahuan|kesalahan|peringatan|informasi|coba|ulang|lanjut|hentikan"
    "|tunggu|segera|otomatis|manual|asli|salinan|sama|berbeda|lain|sendiri|umum|khusus|utama"
    "|tambahan|opsional|wajib|gratis|berbayar|aman|berbahaya|penting|maksimal|minimal|antara|serta"
    "|bahwa|supaya|agar|seperti|misalnya|contohnya|tersebut|inilah|itulah|begitu|demikian|secara"
    "|terus|dulu|kapan|dimana|kemana|mengapa|siapa|berapa|sedangkan|selain|bahkan|hampir|seluruh"
    "|pengguna|perangkat|layar|tombol|menu|jendela|panel|bilah|garis|titik|sudut|bentuk|objek"
    "|posisi|rotasi|skala|opasitas|kunci|kuncian|tanda|penanda|bingkai|kompatibilitas|struktur"
    "|ditulis|ekstensi|kenapa|tertarik|memakai|direncanakan|menjadi|sebuah|mengenai|fitur"
    "|bahagian|ialah|berasaskan|tersimpan|halaman|dimaksud|terbuka|mengikuti|digunakan|terhadap"
    "|teruji|terlalu|dalam|letakkan|diikat|terikat|lensa|optik|mundur|maju|memperoleh|stabil"
    "|presisi|dibatalkan|didekode|dirender|penyesuaian|dinonactivekan|berkeyframe|ber-keyframe"
    "|kirim|dikirim|terverifikasi|terkonfirmasi|diperpanjang|dipindahkan|dihapus|disimpan"
    "|diterapkan|dibuat|diubah|dijalankan|diproses|dipakai|diganti|ditolak|dibatasi|dipilih"
    "|tercatat|dicatat|dihitung|ditampilkan|dipetakan|mengatur|mengendalikan|membina|dibangunkan"
    "|memerlukan|membutuhkan|berubah|berputar|mengikuti|menemukan|menemukannya|mengonfirmasi"
    "|menempatkan|mengecilkan|memperbesar|menggeser|menekan|menyentuh|membuka|menutup"
)
ID_RE = re.compile(r"\b(?:" + ID_WORDS + r")\b", re.I)
# Code/CSS/shader markers. Deliberately narrow: a template literal that merely embeds
# `${...}` expressions is UI copy, not code, so `${` must not disqualify a string.
CODEY = re.compile(r"(^//|^/\*|\*/$|=>|;\s*$|\}\s*;|\{;|\bconst\b|\bfunction\b|--oms-|\[data-)")
# Shader source and markup-only fragments are code, not UI copy.
SHADER = re.compile(r"(\buniform\s+\w+\s|#define\s|\bgl_[A-Za-z]|\bvec[234]\s+\w+\s*[;=])")


def load_known() -> set[str]:
    """Every source string (and every English string) already covered."""
    known: set[str] = set()
    for path in sorted(PARTS.iterdir()):
        if path.suffix not in {".jsonl", ".json"} or not path.is_file():
            continue
        if path.name == "pass3.jsonl":
            continue  # this script's own output (the list of leftovers)
        if path.name == "chunks.json":
            known.update(json.loads(path.read_text(encoding="utf-8"))[i]["s"]
                         for i in range(len(json.loads(path.read_text(encoding="utf-8")))))
            continue
        if path.suffix == ".json":
            try:
                batch = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            items = batch.get("items", {}) if isinstance(batch, dict) else {}
            known.update(str(v) for v in items.values())
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if "s" in row:
                known.add(row["s"])
    return known


def interesting(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 3:
        return False
    if CODEY.search(stripped):
        return False
    if not ID_RE.search(stripped):
        return False
    if SHADER.search(stripped):
        return False
    return True


def main() -> int:
    raw = (BUILT if BUILT.exists() else DOC).read_text(encoding="utf-8")
    edits = json.loads((PARTS.parent / "edits.json").read_text(encoding="utf-8"))["edits"]
    known = load_known()

    found: dict[str, str] = {}

    # ---------------------------------------------------------------- markup
    styles = [(m.start(1), m.end(1)) for m in STYLE_BLOCK.finditer(raw)]
    blocks = jsscan.script_blocks(raw)
    spans = [(a, a + len(b)) for a, b in blocks] + styles

    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in spans)

    for m in ATTR.finditer(raw):
        if inside(m.start()):
            continue
        text = m.group(2)
        if text not in known and interesting(text):
            found.setdefault(text, f"html-attr:{m.group(1)}")
    for m in TEXT_NODE.finditer(raw):
        if inside(m.start()):
            continue
        if raw[max(0, m.start() - 60):m.start()].lower().endswith("base64,"):
            continue
        text = m.group(1)
        if text not in known and interesting(text):
            found.setdefault(text, "html-text")

    # ------------------------------------------------------- runtime literals
    for _, body in blocks:
        for lit in jsscan.scan(body):
            text = jsscan.unescape(lit.text)
            if text in known or not interesting(text):
                continue
            if not lit.template:
                found.setdefault(text, "script")
                continue
            # Template literals: report the prose between `${...}` holes and tags.
            for part in jsscan.template_parts(text):
                for piece in re.split(r"<[^>]*>", text[part.start:part.end]):
                    piece = piece.strip()
                    if piece and piece not in known and interesting(piece):
                        found.setdefault(piece, "script-template")

    rows = sorted(found.items(), key=lambda kv: (-len(kv[0]), kv[0]))
    OUT.write_text("\n".join(json.dumps({"k": k, "s": s}, ensure_ascii=False)
                             for s, k in rows) + "\n", encoding="utf-8")
    print(f"{len(rows)} strings, {sum(len(s) for s, _ in rows)} chars -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
