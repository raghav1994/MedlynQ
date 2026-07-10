"""Rasterises page 1 of a single landed PDF to a small PNG thumbnail, so
/api/thumb can serve a real preview instead of 404ing (which was showing as
a broken-image icon on every real uploaded document — build_thumbs.py only
ever covered the old demo corpus, never anything actually landed by a MEDCO).

Usage: python gen_thumb.py <pdf_path> <out_png_path>
Silently no-ops (exit 0) for non-PDFs or unreadable files — a missing
thumbnail is a cosmetic fallback, never a reason to fail the upload.
"""

from __future__ import annotations

import sys
from pathlib import Path

DPI = 110
WIDTH_CAP = 320


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: gen_thumb.py <pdf_path> <out_png_path>", file=sys.stderr)
        return 0
    pdf_path, out_png = Path(sys.argv[1]), Path(sys.argv[2])
    if pdf_path.suffix.lower() != ".pdf" or not pdf_path.is_file():
        return 0
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            doc.close()
            return 0
        page = doc[0]
        zoom = DPI / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        if pix.width > WIDTH_CAP:
            scale = WIDTH_CAP / pix.width
            mat2 = fitz.Matrix(zoom * scale, zoom * scale)
            pix = page.get_pixmap(matrix=mat2, alpha=False)
        out_png.parent.mkdir(parents=True, exist_ok=True)
        pix.save(out_png)
        doc.close()
    except Exception as e:
        print(f"thumb generation failed (non-fatal): {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
