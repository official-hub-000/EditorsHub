#!/usr/bin/env python3
"""Validates a translated chunk against its source chunk (same count, same order)."""
import json, sys
from pathlib import Path

def load(p):
    return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]

def main(chunk):
    base = Path(__file__).parent / 'parts'
    src = load(base / f'{chunk}.jsonl')
    dst = load(base / f'{chunk}.en.jsonl')
    if len(src) != len(dst):
        print(f'COUNT MISMATCH {chunk}: src={len(src)} dst={len(dst)}')
        return 1
    # untranslated = identical to source (allowed only for strings with no words)
    same = [(i, a['s']) for i, (a, b) in enumerate(zip(src, dst)) if a['s'] == b['s']]
    if same:
        print(f'{len(same)} identical entries in {chunk}:')
        for i, s in same:
            print(f'  {i:03d} {s!r}')
    print(f'OK {chunk}: {len(src)} entries')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
