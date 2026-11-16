#!/usr/bin/env python3
"""
Merges reviewed translations into a review store without ever truncating it.

The review stores (`tools/i18n/parts/pass*.en.jsonl`) are append-mostly: a batch that only
knows about the strings it translated must not drop the rows earlier batches added. This
tool reads a JSON object of `{indonesian: english}` pairs and upserts it into a store,
taking each row's kind from the current extracted batch (`pass4.jsonl`) when the source is
still listed there, and defaulting to `script`.

    python3 tools/i18n/add-translations.py map.json                    # -> pass4.en.jsonl
    python3 tools/i18n/add-translations.py map.json --store pass3.en.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

PARTS = Path(__file__).resolve().parent / "parts"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("map", type=Path, help="JSON object {indonesian: english}")
    parser.add_argument("--store", default="pass4.en.jsonl", help="store file inside parts/")
    parser.add_argument("--batch", default="pass4.jsonl", help="extracted batch, for kinds")
    args = parser.parse_args()

    additions = json.loads(args.map.read_text(encoding="utf-8"))
    batch = PARTS / args.batch
    kinds = {}
    if batch.exists():
        for line in batch.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                kinds[row["s"]] = row["k"]

    # Rows are keyed by (kind, source): the same text can legitimately be both a text node
    # and an attribute value, and those live in different lookups downstream.
    store = PARTS / args.store
    rows: dict[tuple[str, str], dict] = {}
    if store.exists():
        for line in store.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                rows[(row["k"], row["s"])] = row

    # `template-fragment` is a *script* row: its text lives inside a runtime literal.
    markup_kinds = {source: kind for source, kind in kinds.items()
                    if kind in ("html-text", "css-content") or kind.startswith("html-attr:")}
    added = updated = 0
    for source, english in additions.items():
        kind = markup_kinds.get(source, "script")
        key = (kind, source)
        if key in rows:
            if rows[key]["en"] != english:
                updated += 1
            rows[key]["en"] = english
        else:
            rows[key] = {"k": kind, "s": source, "en": english}
            added += 1

    store.write_text(
        "".join(json.dumps(rows[key], ensure_ascii=False) + "\n"
                for key in sorted(rows, key=lambda kv: (kv[0], -len(kv[1]), kv[1]))),
        encoding="utf-8",
    )
    print(f"{store.name}: {added} added, {updated} updated, {len(rows)} rows total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
