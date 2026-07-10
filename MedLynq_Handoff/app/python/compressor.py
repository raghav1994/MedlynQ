"""
MedLynq compressor CLI — wraps user's test_compressor.py logic.

Usage:
    python compressor.py <input_file> <output_file>

Output: JSON to stdout on success, e.g.
    {"ok": true, "input_size": 12345, "output_size": 5678, "reduction_pct": 54.0}
On failure: {"ok": false, "error": "..."}.
"""

import os, io, sys, json, traceback
import fitz  # PyMuPDF
from PIL import Image


def compress_pdf_safe(input_path, output_path):
    try:
        orig_size = os.path.getsize(input_path)
        target_size = orig_size * 0.25  # ~75% reduction target

        # Detect complex / glitch-prone PDF layers
        doc_test = fitz.open(input_path)
        has_complex_masks = False
        for page in doc_test:
            images = page.get_images(full=True)
            if len(images) > 0:
                for img in images:
                    if img != 0 or "/Mask" in str(img):
                        has_complex_masks = True
                        break
        doc_test.close()

        # Strategy A: Standard Internal Replacement
        if not has_complex_masks:
            doc = fitz.open(input_path)
            for page_num in range(len(doc)):
                page = doc[page_num]
                for img_info in page.get_images(full=True):
                    xref = img_info
                    try:
                        base_image = doc.extract_image(xref)
                        img = Image.open(io.BytesIO(base_image["image"]))
                        if img.mode != "RGB":
                            img = img.convert("RGB")
                        if img.width > 1600:
                            img = img.resize(
                                (1200, int((1200 / img.width) * img.height)),
                                Image.Resampling.LANCZOS,
                            )
                        output_bytes = io.BytesIO()
                        img.save(output_bytes, format="JPEG", optimize=True, quality=75, subsampling=1)
                        doc.replace_image(xref, stream=output_bytes.getvalue())
                    except Exception:
                        continue
            try:
                doc.save(output_path, garbage=4, deflate=True, linear=True)
            except Exception:
                doc.save(output_path, garbage=4, deflate=True, linear=False)
            doc.close()
            return True

        # Strategy B: Dynamic Canvas Scaling for Complex / Glitchy PDFs
        for render_scale in (2.2, 1.8, 1.4):
            doc = fitz.open(input_path)
            new_doc = fitz.open()
            for page_num in range(len(doc)):
                page = doc[page_num]
                matrix = fitz.Matrix(render_scale, render_scale)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes("jpeg")))
                output_bytes = io.BytesIO()
                img.save(output_bytes, format="JPEG", optimize=True, quality=72, subsampling=1)
                new_page = new_doc.new_page(width=page.rect.width, height=page.rect.height)
                new_page.insert_image(new_page.rect, stream=output_bytes.getvalue())
            try:
                new_doc.save(output_path, garbage=4, deflate=True, linear=True)
            except Exception:
                new_doc.save(output_path, garbage=4, deflate=True, linear=False)
            new_doc.close()
            doc.close()
            current_size = os.path.getsize(output_path)
            if current_size <= target_size or render_scale == 1.4:
                break
        return True

    except Exception as e:
        print(json.dumps({"ok": False, "error": f"pdf: {e}"}))
        return False


def compress_standalone_image(input_path, output_path):
    try:
        ext = os.path.splitext(input_path)[-1].lower()
        img = Image.open(input_path)

        if ext == ".png":
            if img.mode != "RGBA":
                img = img.convert("P", palette=Image.ADAPTIVE, colors=256)
            img.save(output_path, format="PNG", optimize=True)
            return True

        if img.mode != "RGB":
            img = img.convert("RGB")
        orig_size = os.path.getsize(input_path)
        target_size = orig_size * 0.22

        for scale_width in (3200, 2400, 1800, 1400):
            if img.width > scale_width:
                new_width = scale_width
                new_height = int((new_width / img.width) * img.height)
                processed_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            else:
                processed_img = img
            processed_img.save(output_path, format="JPEG", optimize=True, quality=82, subsampling=1)
            if os.path.getsize(output_path) <= target_size or scale_width == 1400:
                break
        return True
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"image: {e}"}))
        return False


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: compressor.py <input> <output>"}))
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]
    ext = os.path.splitext(input_path)[-1].lower()

    if not os.path.isfile(input_path):
        print(json.dumps({"ok": False, "error": f"input not found: {input_path}"}))
        sys.exit(1)

    try:
        if ext == ".pdf":
            ok = compress_pdf_safe(input_path, output_path)
        elif ext in (".jpg", ".jpeg", ".png"):
            ok = compress_standalone_image(input_path, output_path)
        else:
            print(json.dumps({"ok": False, "error": f"unsupported ext: {ext}"}))
            sys.exit(1)

        if not ok or not os.path.isfile(output_path):
            print(json.dumps({"ok": False, "error": "compression failed"}))
            sys.exit(1)

        orig = os.path.getsize(input_path)
        new = os.path.getsize(output_path)
        reduction = round((1 - new / orig) * 100, 1) if orig else 0
        print(json.dumps({
            "ok": True,
            "input_size": orig,
            "output_size": new,
            "reduction_pct": reduction,
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)


if __name__ == "__main__":
    main()
