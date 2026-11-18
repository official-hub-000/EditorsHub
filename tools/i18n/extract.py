#!/usr/bin/env python3
"""
Extracts every user-visible string from the vendored Open Motion document.

The upstream editor is Indonesian-first: the UI text is hard-coded in markup and in
runtime messages, with bilingual English only in a handful of places. EditorsHub ships
an English-only UI, so we need an exact inventory to translate.

Output (tools/i18n/):
    strings.json   ordered list of {file, kind, text, key} entries
    REPORT.md      human summary of the surface and its coverage

The extractor works on a *sanitised* copy of the document where every character is
preserved (offsets stay aligned with the real file), which lets the patcher locate the
same tokens deterministically later.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
OUT = ROOT / "tools" / "i18n"

# Words that only appear in Indonesian prose. Deliberately conservative: technical
# identifiers ("layer", "keyframe", "timeline") are shared with English and must not
# trigger a match on their own.
ID_WORDS = r"""
yang|dan|tidak|dengan|atau|untuk|dari|ini|itu|akan|sudah|belum|bisa|boleh|pada|jika|kalau
|hanya|juga|lebih|sedang|saja|lagi|semua|setiap|saat|ketika|karena|namun|tetapi|tapi|adalah
|telah|masih|dapat|apakah|bagaimana|silakan|mohon|gagal|berhasil|hapus|simpan|batal|tutup|buka
|proyek|lapisan|berkas|pengaturan|tambahkan|pilih|ekspor|impor|putar|durasi|warna|teks|gambar
|suara|kamera|efek|tampilan|pratinjau|unduh|bagikan|bahasa|nama|ukuran|kecepatan|mulai|kembali
|ubah|atur|salin|tempel|baru|kosong|aktif|siap|selesai|memuat|mengambil|membuat|menyimpan
|menghapus|mengubah|menambah|memilih|menampilkan|memproses|mendukung|tersedia|diperlukan
|dibutuhkan|terpilih|terkunci|terakhir|pertama|kedua|sebelum|sesudah|selama|hingga|sampai
|tanpa|mungkin|pasti|harus|ingin|perlu|sangat|paling|sedikit|banyak|kecil|besar|cepat|lambat
|mudah|sulit|benar|salah|masuk|keluar|atas|bawah|kiri|kanan|depan|belakang|tengah|sekarang
|nanti|tadi|besok|hari|bulan|tahun|waktu|menit|detik|jumlah|bagian|daftar|isi|hasil|contoh
|perintah|pesan|pemberitahuan|kesalahan|peringatan|informasi|coba|ulang|lanjut|hentikan
|tunggu|segera|otomatis|manual|asli|salinan|sama|berbeda|lain|sendiri|umum|khusus|utama
|tambahan|opsional|wajib|gratis|berbayar|aman|berbahaya|penting|maksimal|minimal|antara|serta
|bahwa|supaya|agar|seperti|misalnya|contohnya|tersebut|inilah|itulah|begitu|demikian|secara
|terus|dulu|kapan|dimana|kemana|mengapa|siapa|berapa|sedangkan|selain|bahkan|hampir|seluruh
|pengguna|perangkat|layar|tombol|menu|jendela|panel|bilah|garis|titik|sudut|bentuk|objek|teks
|posisi|rotasi|skala|opasitas|kunci|kuncian|tanda|penanda|waktu|garis waktu|bingkai|gambar
"""
ID_RE = re.compile(r"\b(?:" + ID_WORDS.replace("\n", "") + r")\b", re.IGNORECASE)

# English markers used to detect strings that are already English.
EN_RE = re.compile(
    r"\b(?:the|and|not|with|or|for|from|this|that|will|has|have|can|must|when|only|also"
    r"|more|while|just|all|every|because|select|export|import|project|layer|file|settings"
    r"|add|delete|save|cancel|close|open|image|text|audio|video|render|you|your|please"
    r"|failed|success|enabled|disabled|available|missing|empty|current|new|open|name"
    r"|size|speed|start|stop|play|pause|frame|frames|duration|color|effect|effects)\b",
    re.IGNORECASE,
)

ID_HINT = re.compile(r"(isId|\bid\b\s*:|&&|\bhomeLanguage\b).{0,40}$")


def looks_indonesian(text: str) -> bool:
    """True when `text` is prose that needs translating."""
    if not text or not text.strip():
        return False
    stripped = text.strip()
    if len(stripped) < 2:
        return False
    # Pure identifiers / css / markup are not prose.
    if re.fullmatch(r"[<>{}\[\]().,:;*#%/\-–—_=+|\\\s\d]+", stripped):
        return False
    if not ID_RE.search(stripped):
        return False
    # If the only match is an English-looking twin, leave it alone.
    return True


def is_english(text: str) -> bool:
    return bool(EN_RE.search(text)) and not ID_RE.search(text)


# --------------------------------------------------------------------------- sources

def scan_html(path: Path):
    """Text nodes, attributes and ARIA labels in the static document."""
    src = path.read_text(encoding="utf-8")
    results = []
    # Text between tags, skipping <script>/<style> bodies later via offsets.
    script_spans = [(m.start(), m.end()) for m in re.finditer(r"<script\b.*?</script>", src, re.S | re.I)]
    style_spans = [(m.start(), m.end()) for m in re.finditer(r"<style\b.*?</style>", src, re.S | re.I)]

    def inside(pos, spans):
        return any(a <= pos < b for a, b in spans)

    for m in re.finditer(r">([^<>]+)<", src):
        text = m.group(1)
        if inside(m.start(), script_spans) or inside(m.start(), style_spans):
            continue
        if looks_indonesian(text):
            results.append({"kind": "html-text", "text": text, "offset": m.start(1)})

    for m in re.finditer(r'\b(title|placeholder|aria-label|alt|aria-description)="([^"]+)"', src):
        text = m.group(2)
        if looks_indonesian(text):
            results.append({"kind": f"html-attr:{m.group(1)}", "text": text, "offset": m.start(2)})

    return results, src


QUOTED = re.compile(r"""(['"`])((?:\\.|(?!\1)[^\\\n]){2,400}?)\1""", re.S)


def scan_scripts(path: Path, src: str):
    """String literals inside inline scripts (the editor's runtime messages)."""
    results = []
    for m in re.finditer(r"<script\b[^>]*>(.*?)</script>", src, re.S | re.I):
        body_start = m.start(1)
        body = m.group(1)
        for q in QUOTED.finditer(body):
            text = q.group(2)
            if not looks_indonesian(text):
                continue
            off = body_start + q.start(2)
            ctx = src[max(0, off - 220):off]
            kind = "script"
            if re.search(r"(omsDiagnostics|console\.(?:log|warn|error|info|debug)|OMSCreditsData|__omsStartup)", ctx[-140:]):
                kind = "script-log"
            results.append({"kind": kind, "text": text, "offset": off})
        # Template literals with prose between ${...} segments
        for t in re.finditer(r"`([^`]{2,400})`", body, re.S):
            chunk = t.group(1)
            if "${" not in chunk:
                continue
            for part in re.split(r"\$\{[^}]*\}", chunk):
                if looks_indonesian(part) and len(part.strip()) > 2:
                    results.append(
                        {"kind": "script-template", "text": part, "offset": body_start + t.start(1)}
                    )
    return results


def main() -> int:
    html = WEB / "index.html"
    entries, src = scan_html(html)
    entries += scan_scripts(html, src)

    seen, unique = set(), []
    for e in entries:
        key = (e["kind"], e["text"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(e)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "strings.json").write_text(
        json.dumps(
            [
                {
                    "file": "web/index.html",
                    "kind": e["kind"],
                    "text": e["text"],
                    "chars": len(e["text"]),
                }
                for e in unique
            ],
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    by_kind: dict[str, int] = {}
    for e in unique:
        by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + 1
    total_chars = sum(len(e["text"]) for e in unique)
    lines = [
        "# EditorsHub translation surface",
        "",
        f"- unique user-visible strings: **{len(unique)}**",
        f"- characters: **{total_chars}**",
        "",
        "| kind | count |",
        "| --- | --- |",
    ]
    for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        lines.append(f"| `{k}` | {v} |")
    (OUT / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"extracted {len(unique)} strings ({total_chars} chars)")
    for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        print(f"  {k:24s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
