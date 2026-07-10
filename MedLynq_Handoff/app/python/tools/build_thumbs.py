"""Rasterise page 1 of every PDF in the corpus to a small PNG thumbnail.

Output:  app/public/_thumbs/{stem}.png
Reads:   PatientLog/Approved/corpus/batch_01..N/case_XX/*.pdf
         (configurable scope — defaults to batch_01 only for speed)

Result: DocumentTile in the UI checks /api/thumb?file={filename} and
shows a real preview instead of the red 'PDF' placeholder.

Re-run anytime — idempotent. Skips files already thumbnailed (delta only)
unless --force is passed.

Usage:
    python python/tools/build_thumbs.py            # batch_01 only
    python python/tools/build_thumbs.py --all      # every batch
    python python/tools/build_thumbs.py --force    # rebuild all
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("missing dep: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[3]   # MedLynq/
CORPUS = ROOT / "PatientLog" / "Approved" / "corpus"
OUT_DIR = ROOT / "app" / "public" / "_thumbs"

DPI = 110          # small but legible
WIDTH_CAP = 320    # px wide; height scales


def rasterise(pdf_path: Path, out_png: Path, force: bool) -> str:
    if out_png.exists() and not force:
        return "skip"
    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            doc.close()
            return "empty"
        page = doc[0]
        zoom = DPI / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        # downscale if wider than cap
        if pix.width > WIDTH_CAP:
            scale = WIDTH_CAP / pix.width
            mat2 = fitz.Matrix(zoom * scale, zoom * scale)
            pix = page.get_pixmap(matrix=mat2, alpha=False)
        out_png.parent.mkdir(parents=True, exist_ok=True)
        pix.save(out_png)
        doc.close()
        return "ok"
    except Exception as e:
        return f"err:{e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="process every batch_NN, not just batch_01")
    ap.add_argument("--force", action="store_true", help="rebuild thumbnails even if present")
    args = ap.parse_args()

    if not CORPUS.exists():
        print(f"corpus not found: {CORPUS}", file=sys.stderr)
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    batches = sorted([p for p in CORPUS.iterdir() if p.is_dir() and p.name.startswith("batch_")])
    if not args.all:
        batches = [b for b in batches if b.name == "batch_01"]

    if not batches:
        print("no batches found", file=sys.stderr)
        sys.exit(1)

    counts = {"ok": 0, "skip": 0, "empty": 0, "err": 0}
    for batch in batches:
        cases = sorted([p for p in batch.iterdir() if p.is_dir()])
        for case in cases:
            pdfs = list(case.glob("*.pdf"))
            for pdf in pdfs:
                out = OUT_DIR / (pdf.stem + ".png")
                result = rasterise(pdf, out, args.force)
                key = result.split(":")[0]
                counts[key] = counts.get(key, 0) + 1
        print(f"  {batch.name}: {sum(1 for _ in batch.rglob('*.pdf'))} PDFs scanned")

    print()
    print("done")
    for k, v in counts.items():
        if v: print(f"  {k:>5}: {v}")
    print(f"  thumbs written to: {OUT_DIR}")


if __name__ == "__main__":
    main()
