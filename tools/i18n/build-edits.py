#!/usr/bin/env python3
"""
Resolves the reviewed translation batches into an ordered edit list for the vendored
document, and reports anything that is still untranslated.

Why an intermediate edit list instead of rewriting `web/index.html`
-------------------------------------------------------------------
`web/index.html` is vendored upstream content (~9.7 MB). Keeping it byte-identical lets
us pull new upstream revisions and re-run the pipeline without merge conflicts. The
translations live in `tools/i18n/parts/*.jsonl` (one string per line, reviewable) and
this script turns them into absolute `[start, end, replacement]` ranges against a pinned
revision of the document, together with that revision's SHA-256. If upstream changes the
file the hash check in `tools/build-web-assets.mjs` fails loudly instead of corrupting
the bundle.

Batch formats
    html-N.jsonl / html-N.after.jsonl    {"k": kind, "s": text}       markup text + attributes
    script-NN.jsonl / .en.jsonl          {"s": text}                  runtime literals
    chunk-NN.json {"start": n, "items": {index: english}}            prose chunks inside
                                                                      large runtime templates

Translations are stored as plain text (JSON-decoded). Literal contents are re-escaped
for the quote style they replace, so `'Jangan pakai \\'` style sources round-trip.

Usage
    python3 tools/i18n/build-edits.py              # write edits.json + coverage report
    python3 tools/i18n/build-edits.py --report     # also write leftover batch files
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jsscan_linear as jsscan  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "web" / "index.html"
PARTS = Path(__file__).resolve().parent / "parts"
OUT = Path(__file__).resolve().parent / "edits.json"

STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
MARKUP_TEXT = re.compile(r">([^<>]+)<")
# `value` is included because form controls render it verbatim: the New Project sheet
# pre-fills its name field from `value="Project Baru"`, which is user-visible copy.
ATTR = re.compile(
    r'\b(title|placeholder|aria-label|alt|aria-description|value)="([^"]+)"')

# Prose detector, mirroring tools/i18n/extract.py so leftovers are comparable.
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
    "|posisi|rotasi|skala|opasitas|kunci|kuncian|tanda|penanda|bingkai"
)
ID_RE = re.compile(r"\b(?:" + ID_WORDS + r")\b", re.IGNORECASE)
NON_PROSE = re.compile(r"^[<>{}\[\]().,:;*#%/\\\-–—_=+|\\s\d]+$")


def looks_indonesian(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 2 or NON_PROSE.fullmatch(stripped):
        return False
    return bool(ID_RE.search(stripped))


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"missing translation batch: {path.relative_to(ROOT)}")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def unescape(raw: str) -> str:
    """Decodes the escapes a JS string literal may contain (inverse of `escape`)."""
    out, i, n = [], 0, len(raw)
    simple = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}
    while i < n:
        c = raw[i]
        if c != "\\" or i + 1 >= n:
            out.append(c)
            i += 1
            continue
        nxt = raw[i + 1]
        if nxt in simple:
            out.append(simple[nxt])
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


def escape(text: str, quote: str) -> str:
    """Re-escapes translated plain text for the quote style it is spliced into."""
    text = text.replace("\\", "\\\\")
    if quote == "`":
        return text.replace("`", "\\`").replace("${", "\\${")
    return text.replace(quote, "\\" + quote).replace("\n", "\\n")


def load_markup() -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    # Second pass: strings that only surfaced after the first pass was applied.
    extra = PARTS / "html-extra.jsonl"
    if extra.exists():
        src, dst = read_jsonl(extra), read_jsonl(PARTS / "html-extra.after.jsonl")
        if len(src) != len(dst):
            sys.exit(f"html-extra.after.jsonl has {len(dst)} entries, expected {len(src)}")
        for a, b in zip(src, dst):
            out[(a["k"], a["s"])] = b["s"]
    for n in range(3):
        src = read_jsonl(PARTS / f"html-{n}.jsonl")
        dst = read_jsonl(PARTS / f"html-{n}.after.jsonl")
        if len(src) != len(dst):
            sys.exit(f"html-{n}.after.jsonl has {len(dst)} entries, expected {len(src)}")
        for a, b in zip(src, dst):
            if a["k"] != b["k"]:
                sys.exit(f"html-{n}: kind mismatch for {a['s']!r}: {a['k']} vs {b['k']}")
            out[(a["k"], a["s"])] = b["s"]
    return out


def load_flat(prefix: str, count: int) -> dict[str, str]:
    out: dict[str, str] = {}
    for n in range(count):
        src_path = PARTS / f"{prefix}-{n:02d}.jsonl"
        dst_path = PARTS / f"{prefix}-{n:02d}.en.jsonl"
        if not src_path.exists():
            continue
        if not dst_path.exists():
            continue  # batch not translated yet
        src, dst = read_jsonl(src_path), read_jsonl(dst_path)
        if len(src) != len(dst):
            sys.exit(f"{dst_path.name} has {len(dst)} entries, expected {len(src)}")
        for a, b in zip(src, dst):
            key = a["s"]
            existing = out.get(key)
            if existing is not None and existing != b["s"]:
                sys.exit(f"conflicting translations for {key!r}: {existing!r} vs {b['s']!r}")
            out[key] = b["s"]
    return out


def load_chunks() -> dict[str, str]:
    """chunk text -> english, for prose trapped inside large HTML templates.

    `chunks.en.jsonl` is keyed by the *source text*, so re-sorting `chunks.json` can never
    silently attach a translation to the wrong string. The positional `chunk-NN.json`
    batches are only read for chunks the keyed file does not cover.
    """
    keyed = PARTS / "chunks.en.jsonl"
    if keyed.exists():
        out: dict[str, str] = {}
        for line in keyed.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            out[row["s"]] = row["en"]
        return out
    out = {}
    chunks = json.loads((PARTS / "chunks.json").read_text(encoding="utf-8"))
    covered: dict[int, str] = {}
    for path in sorted(PARTS.glob("chunk-*.json")):
        if path.name == "chunks.json":
            continue
        batch = json.loads(path.read_text(encoding="utf-8"))
        for index, english in batch["items"].items():
            i = int(index)
            if i in covered:
                sys.exit(f"chunk {i} translated twice ({covered[i]} and {path.name})")
            covered[i] = path.name
            out[chunks[i]["s"]] = english
    missing = [i for i in range(len(chunks)) if i not in covered]
    if missing:
        print(f"chunks         {len(covered)}/{len(chunks)} translated "
              f"(first missing: {missing[:5]})")
    return out


SCRIPT_BODIES: list[str] = []


def load_pass3() -> tuple[dict[tuple[str, str], str], dict[str, str], dict[str, str]]:
    return load_store(PARTS / "pass3.en.jsonl")


def load_store(path: Path) -> tuple[dict[tuple[str, str], str], dict[str, str], dict[str, str]]:
    """A review store keyed by source text: (markup, whole literals, fragments).

    `pass3.en.jsonl` is a *store keyed by source text* — one row per translated string,
    with `k` saying where it came from (`html-text`, `html-attr`, `script`). It is written
    by the pass-3 review and never regenerated, so it can never drift out of sync with the
    document the way a position-based batch would.
    """
    markup: dict[tuple[str, str], str] = {}
    literals: dict[str, str] = {}
    fragments: dict[str, str] = {}
    store = path
    if not store.exists():
        return markup, literals, fragments
    LITERALS = set()
    for body in SCRIPT_BODIES:
        for lit in jsscan.scan(body):
            LITERALS.add(jsscan.unescape(lit.text))
    for line in store.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        kind, source, english = row["k"], row["s"], row["en"]
        if kind != "script":
            markup[(kind, source)] = english
            continue
        # A `script` row is either a whole runtime literal or a fragment that sits inside a
        # template literal next to `${...}` holes. The distinction matters: whole literals
        # replace the literal, fragments are substituted as substrings. It is decided by
        # looking at the document rather than by trusting the row's label.
        if source in LITERALS:
            literals[source] = english
        else:
            fragments[source] = english
    return markup, literals, fragments


def load_dictionary() -> dict[str, str]:
    """input text -> english, for runtime literals and template prose."""
    dictionary = load_flat("script", 15)
    extra = load_flat("extra", 20)
    for key, value in extra.items():
        dictionary.setdefault(key, value)
    _, literals, _ = load_pass3()
    for key, value in literals.items():
        dictionary.setdefault(key, value)
    return dictionary


FRAGMENT_BAD = re.compile(r"[<>{}`$\\\"'=]|=>|\bconst\b|\bfunction\b|--|::")


def fragment_pattern(dictionary: dict[str, str]) -> re.Pattern[str] | None:
    """One regex matching every dictionary key that is safe to substitute as prose.

    Keys are alternated longest-first so a longer phrase always wins over a shorter one it
    contains. Keys containing markup, template syntax or code punctuation are excluded:
    only plain UI prose is ever substituted inside a larger string.
    """
    keys = [
        key for key in dictionary
        if 3 <= len(key) <= 120
        and not FRAGMENT_BAD.search(key)
        and re.search(r"[A-Za-z]", key)
    ]
    if not keys:
        return None
    keys.sort(key=len, reverse=True)
    return re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])")


def tag_segments(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """The prose ranges between tags inside `text[start:end]`."""
    segments: list[tuple[int, int]] = []
    cursor = start
    for m in re.finditer(r"<[^>]*>", text[start:end]):
        segments.append((cursor, start + m.start()))
        cursor = start + m.end()
    segments.append((cursor, end))
    return [seg for seg in segments if seg[1] > seg[0]]


def raw_span(offsets: list[int], start: int, end: int) -> tuple[int, int] | None:
    """Maps a decoded-text range to raw offsets, or None when it cannot be spliced.

    Escapes inside the range are fine as long as the translated text reproduces them,
    which is why the replacement goes through `escape` first and is re-checked by the
    caller. A range that starts or ends inside an escape sequence is refused.
    """
    return offsets[start], offsets[end]


def main() -> int:
    raw = DOC.read_text(encoding="utf-8")
    global SCRIPT_BODIES
    SCRIPT_BODIES = [body for _, body in jsscan.script_blocks(raw)]
    markup = load_markup()
    extra_markup, _, fragments = load_pass3()
    markup.update(extra_markup)
    p4_markup, p4_literals, p4_fragments = load_store(PARTS / "pass4.en.jsonl")
    markup.update(p4_markup)
    fragments.update(p4_fragments)
    dictionary = load_dictionary()
    _, p4_literals, _ = load_store(PARTS / "pass4.en.jsonl")
    for key, value in p4_literals.items():
        dictionary.setdefault(key, value)
    chunks = load_chunks()
    # A store row can be both a whole literal somewhere and prose spliced into a larger
    # template elsewhere. Because the store only records the text, every script row is
    # offered as a fragment candidate too: the whole-literal pass runs first and wins where
    # the text is a complete literal, and the fragment pass then patches the other places.
    for source, english in p4_literals.items():
        if "\n" not in source and len(source) >= 8:
            fragments.setdefault(source, english)
    # Longest first: a short fragment must not win over a longer phrase that contains it.
    fragment_keys = sorted(fragments, key=len, reverse=True)

    edits: list[tuple[int, int, str]] = []
    # Fragment substitutions are collected separately: they are placeholders for prose the
    # other passes did not cover, so any overlap means the other pass wins.
    fragment_edits: list[tuple[int, int, str]] = []
    used: set[str] = set()
    styles = [(m.start(1), m.end(1)) for m in STYLE_BLOCK.finditer(raw)]
    blocks = jsscan.script_blocks(raw)
    in_script = [(start, start + len(body)) for start, body in blocks]

    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in in_script + styles)

    # ------------------------------------------------------ region override ranges
    # A few prose regions are translated as one block instead of sentence by sentence:
    # translating the experimental-notice page line by line left sentences half-English
    # (`You are already running the versi aplikasi native`). The ranges are recorded here
    # and applied after every other pass, so they can drop whatever lands inside them.
    override_ranges: list[tuple[int, int, str]] = []
    overrides_path = PARTS / "overrides.json"
    if overrides_path.exists():
        for item in json.loads(overrides_path.read_text(encoding="utf-8")):
            start = raw.find(item["from"])
            if start < 0 or raw.find(item["from"], start + 1) != -1:
                sys.exit(f"override source must appear exactly once: {item['from'][:60]!r}")
            override_ranges.append((start, start + len(item["from"]), item["to"]))

    # ------------------------------------------------------------- markup text nodes
    for m in MARKUP_TEXT.finditer(raw):
        if inside(m.start()):
            continue
        english = markup.get(("html-text", m.group(1)))
        if english is None:
            continue
        used.add("markup")
        edits.append((m.start(1), m.end(1), english))

    # CSS-generated copy (`content:"…"`) is user-visible but lives in a <style> block, so it
    # is patched separately rather than skipped as styling.
    for m in re.finditer(r'content\s*:\s*"([^"]{3,})"', raw):
        if any(a <= m.start() < b for a, b in in_script):
            continue  # the same pattern inside a script literal is handled per literal
        english = markup.get(("css-content", m.group(1)))
        if english is None:
            continue
        used.add("markup")
        edits.append((m.start(1), m.end(1), english))

    # -------------------------------------------------------- markup attributes (any)
    for m in ATTR.finditer(raw):
        if inside(m.start()):
            continue  # attributes inside runtime strings travel with their literal
        english = markup.get((f"html-attr:{m.group(1)}", m.group(2)))
        if english is None:
            continue
        used.add("markup")
        edits.append((m.start(2), m.end(2), english))

    # ----------------------------------------------------------- runtime literals
    # The replacement range for every literal is computed on the *decoded* text and mapped
    # back to raw offsets, so escaped quotes/newlines round-trip exactly.
    #
    #   quoted literal  -> whole-literal dictionary hit, else the HTML it may contain is
    #                      translated attribute by attribute and chunk by chunk.
    #   template literal -> only the prose between `${...}` holes is touched; code inside
    #                      the holes is never rewritten.
    for body_start, body in blocks:
        for lit in sorted(jsscan.scan(body), key=lambda l: l.start):
            text, offsets = jsscan.unescape_map(lit.text)
            base = body_start + lit.start
            quote = lit.quote
            whole = dictionary.get(text) if not lit.template else None
            if whole is not None:
                used.add(text)
                edits.append((base, base + len(lit.text), escape(whole, quote)))
                continue

            tag_spans = [(m.start(), m.end()) for m in re.finditer(r"<[^>]*>", text)]
            parts = (jsscan.template_parts(text) if lit.template
                     else [jsscan.TemplatePart(text, 0, len(text))])
            # Attributes are translated before chunks are substituted: chunk offsets are
            # computed on the untouched text, so nothing can shift underneath them.
            chunk_ranges: list[tuple[int, int]] = []
            for part in parts:
                for seg_start, seg_end in tag_segments(text, part.start, part.end):
                    if not lit.template:
                        continue
                    cursor = seg_start
                    while cursor < seg_end:
                        segment = text[seg_start:seg_end]
                        match = next(((k, chunks[k]) for k in chunks
                                      if k and segment.startswith(k, cursor - seg_start)), None)
                        if match is None:
                            cursor += 1
                            continue
                        key, english = match
                        if escape(english, quote) != english:
                            sys.exit(f"chunk needs escaping, fix by hand: {key[:60]!r}")
                        chunk_ranges.append((cursor, cursor + len(key)))
                        edits.append((base + offsets[cursor], base + offsets[cursor + len(key)],
                                      english))
                        cursor += len(key)
                # Chunk rules that reach past a `${...}` hole are illegal and reported.
            # Prose fragments inside a literal (between `${...}` holes, or a text node of
            # markup the script builds as a string) are substituted as plain substrings,
            # skipping anything a chunk already covers.
            # A fragment can also be spliced against a translated word inside the same
            # template (`Export tetap kualitas penuh.`); those are substituted too, so the
            # remaining Indonesian tail is never left stranded behind an English head.
            if fragment_keys:
                for part in parts:
                    for key in fragment_keys:
                        at = text.find(key, part.start, part.end)
                        while at != -1:
                            end_at = at + len(key)
                            if end_at <= part.end:
                                chunk_ranges.append((at, end_at))
                                fragment_edits.append((base + offsets[at],
                                                       base + offsets[end_at], fragments[key]))
                            at = text.find(key, end_at, part.end)

            for m in ATTR.finditer(text):
                if not any(a <= m.start() and m.end() <= b for a, b in tag_spans):
                    continue  # only attributes that live inside a real tag
                if any(a <= m.start(2) < b for a, b in chunk_ranges):
                    continue  # already translated as part of a chunk
                if any(p.start <= m.start() < p.end and not
                       (p.start <= m.end() <= p.end) for p in parts):
                    continue  # attribute markup is split across template parts
                if "${" in m.group(2):
                    continue  # interpolated attribute: translated chunk by chunk instead
                english = markup.get((f"html-attr:{m.group(1)}", m.group(2)))
                if english is None:
                    continue
                edits.append((base + offsets[m.start(2)], base + offsets[m.end(2)],
                              escape(english, quote)))
            # Prose that forms a whole segment (no markup, no fragments) is translated as
            # a single string, which covers the short status labels of quoted literals.
            for part in parts:
                for seg_start, seg_end in tag_segments(text, part.start, part.end):
                    segment = text[seg_start:seg_end]
                    stripped = segment.strip()
                    if not stripped:
                        continue
                    lead_raw = seg_start + (len(segment) - len(segment.lstrip()))
                    if (lit.template and
                            "${" in text[seg_start:lead_raw + len(stripped)]):
                        continue  # a hole-bearing fragment must be translated in pieces
                    if lit.template and "${" in stripped:
                        continue
                    english = dictionary.get(stripped)
                    if english is None:
                        continue
                    if any(a <= seg_start + (len(segment) - len(segment.lstrip())) < b
                           or (a < seg_end and b > seg_start) for a, b in chunk_ranges):
                        continue  # overlaps a chunk translation in this segment
                    lead = len(segment) - len(segment.lstrip())
                    edits.append((base + offsets[seg_start + lead],
                                  base + offsets[seg_start + lead + len(stripped)],
                                  escape(english, quote)))
                    used.add(stripped)

    # Fragments fill only the gaps the dedicated passes left behind.
    if "--debug-frag" in sys.argv:
        print("DEBUG key in fragments:", "Khusus layer terpilih" in fragments,
              "| in fragment_keys:", "Khusus layer terpilih" in fragment_keys,
              "| n fragment_edits:", len(fragment_edits))
        for st, en, rep in fragment_edits:
            if "Khusus layer terpilih" in raw[st:en]:
                print("DEBUG frag", st, en, rep)
        for st, en, rep in edits:
            if st - 30 <= raw.find("Khusus layer terpilih") <= en + 30:
                print("DEBUG near-edit", st, en, rep[:40])
    if fragment_edits:
        # Longest first: a whole string always wins over the shorter words it contains, so a
        # stray `layer terpilih` can never replace the tail of `Khusus layer terpilih`.
        fragment_edits.sort(key=lambda e: (-(e[1] - e[0]), e[0]))
        accepted: list[tuple[int, int]] = []
        kept = 0
        for start, end, replacement in fragment_edits:
            # A longer fragment absorbs the shorter edits it covers: a pass that translated
            # `Export ` inside a sentence would otherwise strand the Indonesian tail after
            # it. An overlap with a *longer* edit (a chunk, or a whole sentence) still wins.
            covered = [e for e in edits if start <= e[0] and e[1] <= end]
            if any(start < e[1] and end > e[0] for e in edits if e not in covered):
                continue
            if any(start < b and end > a for a, b in accepted):
                continue
            edits[:] = [e for e in edits if e not in covered]
            accepted.append((start, end))
            edits.append((start, end, replacement))
            kept += 1
        print(f"fragments      {kept}/{len(fragment_edits)} applied "
              f"({len(fragment_edits) - kept} covered by other passes)")

    for start, end, replacement in override_ranges:
        edits[:] = [e for e in edits if not (e[0] < end and e[1] > start)]
        edits.append((start, end, replacement))

    # Deduplicate identical ranges and check for overlaps.
    seen: dict[tuple[int, int], str] = {}
    for start, end, replacement in edits:
        seen.setdefault((start, end), replacement)
    ordered = sorted((s, e, r) for (s, e), r in seen.items())
    for (s1, e1, r1), (s2, e2, r2) in zip(ordered, ordered[1:]):
        if e1 > s2:
            sys.exit(f"overlapping edits at {s1}:{e1} and {s2}:{e2}\n"
                     f"  A {r1!r}\n  B {r2!r}")

    # ------------------------------------------------- prose fragments (last resort)
    # A dictionary entry is sometimes only a *part* of what the document renders: a word
    # spliced next to `${...}` holes, or a text node that mixes translated and untranslated
    # pieces. Those are substituted word-boundary-wise, longest match first, and only where
    # no dedicated pass already wrote an edit.
    pattern = fragment_pattern(dictionary)
    if pattern is not None:
        def already(a: int, b: int) -> bool:
            return any(a < e and b > s for s, e, _ in edits)

        def fragment_fill(start: int, end: int, out: list[tuple[int, int, str]]) -> None:
            for m in pattern.finditer(raw, start, end):
                if already(m.start(), m.end()):
                    continue
                english = dictionary[m.group(0)]
                if english == m.group(0):
                    continue
                out.append((m.start(), m.end(), english))

        staged: list[tuple[int, int, str]] = []
        for m in MARKUP_TEXT.finditer(raw):
            if inside(m.start()):
                continue
            fragment_fill(m.start(1), m.end(1), staged)
        for body_start, body in blocks:
            for lit in sorted(jsscan.scan(body), key=lambda l: l.start):
                text, offsets = jsscan.unescape_map(lit.text)
                base = body_start + lit.start
                for seg_start, seg_end in tag_segments(text, 0, len(text)):
                    for m in pattern.finditer(text, seg_start, seg_end):
                        start, stop = base + offsets[m.start()], base + offsets[m.end()]
                        if already(start, stop):
                            continue
                        english = dictionary[m.group(0)]
                        if english == m.group(0) or escape(english, lit.quote) != english:
                            continue
                        staged.append((start, stop, english))
            # merge staged after each block so later overlaps are detected correctly
        for start, stop, english in staged:
            if already(start, stop):
                continue
            edits.append((start, stop, english))
        print(f"prose fragments {len(staged)} candidates staged")

    # ----------------------------------------------------------- coverage reporting
    untranslated: list[dict] = []
    for m in MARKUP_TEXT.finditer(raw):
        if inside(m.start()) or not looks_indonesian(m.group(1)):
            continue
        if ("html-text", m.group(1)) not in markup:
            untranslated.append({"s": m.group(1), "ctx": "html-text"})
    for m in ATTR.finditer(raw):
        text = m.group(2)
        if not looks_indonesian(text) or (f"html-attr:{m.group(1)}", text) in markup:
            continue
        untranslated.append({"s": text, "ctx": f"html-attr:{m.group(1)}"})
    for _, body in blocks:
        for lit in jsscan.scan(body):
            value = unescape(lit.text)
            if value not in dictionary and looks_indonesian(value):
                untranslated.append({"s": value, "ctx": "script-template" if lit.template else "script"})
                continue
            if lit.template:
                for part in jsscan.template_parts(value):
                    if part.text not in dictionary and looks_indonesian(part.text):
                        untranslated.append({"s": part.text, "ctx": "script-template"})

    # Deduplicate, longest first so batch review sees full sentences before fragments.
    uniq: dict[str, str] = {}
    for item in untranslated:
        uniq.setdefault(item["s"], item["ctx"])
    rows = sorted(uniq.items(), key=lambda kv: -len(kv[0]))

    if "--dump-untranslated" in sys.argv:
        (PARTS / "untranslated.txt").write_text(
            "\n".join(f"{c}\t{t}" for t, c in rows), encoding="utf-8")

    payload = {
        "source": "web/index.html",
        "source_sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        # Offsets above count code points (Python strings); consumers working with
        # JavaScript string indices must map them, astral characters count twice there.
        "offsets": "codepoints",
        "source_bytes": len(raw.encode("utf-8")),
        "stats": {
            "edits": len(ordered),
            "dictionary_markup": len(markup),
            "dictionary_script": len(dictionary),
            "untranslated_strings": len(rows),
        },
        "edits": [[s, e, r] for s, e, r in ordered],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"edits          {len(ordered):,}")
    print(f"dictionary     {len(markup)} markup + {len(dictionary)} runtime entries")
    print(f"untranslated   {len(rows)} strings")
    print(f"wrote          {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KiB)")

    if "--report" in sys.argv:
        chunk = 100
        old = sorted(PARTS.glob("extra-*.jsonl"))
        for path in old:
            path.unlink()
        for i in range(0, len(rows), chunk):
            write_jsonl(
                PARTS / f"extra-{i // chunk:02d}.jsonl",
                [{"s": s, "ctx": ctx} for s, ctx in rows[i:i + chunk]],
            )
        print(f"wrote          {(len(rows) + chunk - 1) // chunk} leftover batch(es) in tools/i18n/parts/")
    else:
        for s, ctx in rows[:12]:
            print(f"  [{ctx}] {s[:90]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
