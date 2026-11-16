#!/usr/bin/env python3
"""
Finds every string a user can still see in Indonesian once the published passes are applied.

Three passes have already translated the document (`tools/i18n/parts/`): the runtime
dictionary, the markup batches and the pass-3 review store. What remains is a tail of
*visible* copy that none of them classified as a string:

  * words spliced directly against a `${...}` hole in a template literal
    (`Hapus ${n} ...` where only `Hapus ` was never extracted),
  * CSS-generated copy (`content: "Lepaskan media untuk mengimpor"`),
  * short labels that looked like code to the earlier filters (`>Terapkan Orbit`),
  * text nodes of markup a script builds as a string, which are never whole literals.

Review stores are keyed by the *upstream source text*, so this scan runs against
`web/index.html` (never the shipped bundle, which is already rebranded) and drops any
candidate whose span is already fully covered by an edit. Candidates that are only partly
covered stay in the list as their full source, which is exactly the key a translation needs.

Output: `tools/i18n/parts/pass4.jsonl` rows `{"k": kind, "s": indonesian}`. Translate into
`pass4.en.jsonl` with `tools/i18n/add-translations.py`, which merges instead of overwriting.

Run with: python3 tools/i18n/leftovers.py
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
SOURCE = ROOT / "web" / "index.html"
EDITS = Path(__file__).resolve().parent / "edits.json"
OUT = PARTS / "pass4.jsonl"

# Indonesian and Malay function words plus the vocabulary these panels use. Deliberately
# broad and deliberately free of words that are also ordinary English (`panel`, `menu`,
# `manual`, `minimal`, …); this is the last sweep, so a miss costs more than a review line.
WORDS = """
yang dan tidak dengan untuk dari akan sudah belum bisa pada jika kalau hanya juga lebih semua
saat adalah telah masih gagal berhasil hapus simpan batal tutup buka proyek projek lapisan
berkas pengaturan tambahkan pilih ekspor impor putar durasi warna teks gambar suara kamera efek
tampilan pratinjau unduh bagikan bahasa ukuran kecepatan mulai kembali ubah atur salin
tempel kosong aktif siap selesai memuat membuat menyimpan menghapus mengubah menambah
memilih menampilkan memproses mendukung tersedia diperlukan dibutuhkan terpilih terkunci
terakhir pertama sebelum sesudah selama hingga sampai tanpa mungkin harus perlu sangat paling
banyak kecil besar cepat lambat mudah benar salah masuk keluar kiri kanan depan
belakang tengah sekarang waktu detik jumlah daftar hasil pesan kesalahan peringatan coba
ulang lanjut tunggu segera otomatis asli berbeda lain sendiri umum khusus utama
maksimal minimal antara bahwa supaya seperti tersebut demikian secara terus seluruh pengguna
perangkat layar tombol garis sudut posisi rotasi skala tanda
penanda kompatibilitas struktur ditulis ekstensi kenapa tertarik memakai menjadi sebuah
ialah tersimpan digunakan terhadap lewat terlalu letakkan diikat terikat lensa optik
mundur maju memperoleh presisi dibatalkan didekode dirender penyesuaian dikirim terverifikasi
dihapus disimpan diterapkan dibuat diubah diproses dipakai diganti ditolak dipilih tercatat
dicatat dihitung ditampilkan dipetakan mengatur membina memerlukan membutuhkan berubah mengikuti
menempatkan mengecilkan memperbesar menggeser menutup berbasis selain bahkan hampir sedangkan
beberapa bagian bukan lagi nanti tadi besok hari bulan tahun menit lepaskan ikuti lewati
ketuk tekan geser seret masukkan pindah perbarui pulihkan terapkan ganti ulangi buatkan
sembunyikan aturkan orientasi sinkron stabilisasi kemiringan rentang
guncangan pintasan jendela baharu bahagian ditutup dikemas dikembalikan bawaan kepada
persekitaran projek susun anda kekunci papan
""".split()
ID_RE = re.compile(r"\b(?:" + "|".join(WORDS) + r")\b", re.I)
CODEY = re.compile(r"(^//|^/\*|\*/$|^\s*\*|=>|\bconst\b|\bfunction\b|--oms-|\[data-)")


def visible(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 3 or not ID_RE.search(stripped):
        return False
    if CODEY.search(stripped) or re.fullmatch(r"[\W\d_]+", stripped):
        return False
    # Style sheets and shader source are never translated, whatever vocabulary they contain.
    if re.search(r"[{};]", stripped) or re.search(r"^\s*[.#@][\w-]", stripped):
        return False
    return True


def load_spans() -> list[tuple[int, int]]:
    """The source ranges `edits.json` already replaces."""
    if not EDITS.exists():
        return []
    payload = json.loads(EDITS.read_text(encoding="utf-8"))
    return [(int(start), int(end)) for start, end, _ in payload["edits"]]


def main() -> int:
    html = SOURCE.read_text(encoding="utf-8")
    covered = sorted(load_spans())

    def is_covered(start: int, end: int) -> bool:
        return any(a <= start and end <= b for a, b in covered)

    blocks = jsscan.script_blocks(html)
    styles = [(m.start(1), m.end(1)) for m in re.finditer(r"<style\b[^>]*>(.*?)</style>", html, re.S | re.I)]
    spans = [(a, a + len(b)) for a, b in blocks] + styles

    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in spans)

    found: dict[str, str] = {}

    def offer(text: str, start: int, end: int, kind: str) -> None:
        text = text.strip()
        if text and text not in found and visible(text) and not is_covered(start, end):
            found[text] = kind

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

    # Prose inside script literals: text spliced against `${...}` holes, and text nodes of
    # markup a script builds as a string (those literals are never whole dictionary keys).
    for body_start, body in blocks:
        for lit in jsscan.scan(body):
            text, offsets = jsscan.unescape_map(lit.text)
            base = body_start + lit.start
            # (segment text, its offset inside `text`): template prose first, then the whole
            # literal, which also covers the text nodes of markup built as a plain string.
            segments: list[tuple[str, int]] = []
            if lit.template:
                segments += [(text[part.start:part.end], part.start)
                             for part in jsscan.template_parts(text)]
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
                          "template-fragment")

    rows = sorted(found.items(), key=lambda kv: (-len(kv[0]), kv[0]))
    OUT.write_text("\n".join(json.dumps({"k": kind, "s": text}, ensure_ascii=False)
                             for text, kind in rows) + "\n", encoding="utf-8")
    print(f"{len(rows)} visible leftovers ({sum(len(t) for t, _ in rows)} chars) -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
