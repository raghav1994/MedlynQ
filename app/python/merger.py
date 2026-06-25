"""
MedLynq PDF merger CLI.

Combines multiple PDFs and images into a single PDF.
- PDFs: pages concatenated directly
- Images (jpg/jpeg/png): each becomes one page at native size

Usage:
    python merger.py <output.pdf> <input1> <input2> ...

Output: JSON to stdout
    {"ok": true, "input_count": 3, "page_count": 12, "output_size": 1234567}
"""

import os, sys, json, traceback
import fitz  # PyMuPDF
from PIL import Image


def merge_files(input_paths, output_path):
    merged = fitz.open()
    for path in input_paths:
        ext = os.path.splitext(path)[-1].lower()
        if ext == ".pdf":
            try:
                src = fitz.open(path)
                merged.insert_pdf(src)
                src.close()
            except Exception as e:
                print(json.dumps({"ok": False, "error": f"could not open {path}: {e}"}))
                return False
        elif ext in (".jpg", ".jpeg", ".png"):
            try:
                img = Image.open(path)
                if img.mode != "RGB":
                    img = img.convert("RGB")
                width, height = img.size
                page = merged.new_page(width=width, height=height)
                page.insert_image(page.rect, filename=path)
            except Exception as e:
                print(json.dumps({"ok": False, "error": f"could not add image {path}: {e}"}))
                return False
        else:
            print(json.dumps({"ok": False, "error": f"unsupported file type: {ext}"}))
            return False
    try:
        merged.save(output_path, garbage=4, deflate=True, linear=True)
    except Exception:
        merged.save(output_path, garbage=4, deflate=True, linear=False)
    pages = len(merged)
    merged.close()
    return pages


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: merger.py <output.pdf> <input1> <input2> ..."}))
        sys.exit(1)

    output_path = sys.argv[1]
    inputs = sys.argv[2:]

    for p in inputs:
        if not os.path.isfile(p):
            print(json.dumps({"ok": False, "error": f"input not found: {p}"}))
            sys.exit(1)

    try:
        pages = merge_files(inputs, output_path)
        if pages is False or not os.path.isfile(output_path):
            sys.exit(1)
        print(json.dumps({
            "ok": True,
            "input_count": len(inputs),
            "page_count": pages,
            "output_size": os.path.getsize(output_path),
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)


if __name__ == "__main__":
    main()
