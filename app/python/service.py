"""
MedLynq OCR/compress/redact HTTP service.

Wraps the local Python pipeline (compress + classify + extract + PII-burn) as a
FastAPI service so the Node app on Azure App Service can call it. Runs in a
container that HAS PaddleOCR + OpenCV + PyMuPDF (which the Node container cannot).

DPDP: this service only ever RETURNS a redacted (PII-burned) copy. The Node app
is responsible for deciding what may leave for Azure Blob (isLocalOnly guard).

Endpoints:
  GET  /health   -> {"ok": true}
  POST /process  -> multipart 'file' -> JSON with redacted+compressed file (base64)
                    plus doc_type / fields / ai_filename / sizes / burn log.
"""

from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
import traceback

from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fitz  # PyMuPDF
from PIL import Image

from compressor import compress_standalone_image
from extractor import (
    classify_doc,
    extract_fields,
    extract_pdf_text,
    make_ai_filename,
)
from redact import redact_image

app = FastAPI(title="MedLynq OCR/Redact Service")

MAX_PDF_PAGES = 15  # bound runtime; identity/first pages are what matter for PII
RASTER_DPI = 150


@app.get("/health")
def health():
    return {"ok": True, "service": "medlynq-ocr", "paddle": True}


def _redact_image_file(in_path: str, out_jpg: str) -> dict:
    """Burn PII on an image, then compress. Returns the redact log."""
    red_png = out_jpg + ".red.png"
    log = redact_image(in_path, red_png, keep_signature=True)
    # Compress the redacted image to a smaller JPEG
    compress_standalone_image(red_png, out_jpg)
    try:
        os.remove(red_png)
    except OSError:
        pass
    return log


def _redact_pdf_file(in_path: str, out_pdf: str) -> dict:
    """Rasterize each page, burn PII, reassemble a compressed redacted PDF."""
    doc = fitz.open(in_path)
    page_count = doc.page_count
    pages_to_do = min(page_count, MAX_PDF_PAGES)
    redacted_imgs = []
    total_burned = 0
    all_boxes = []

    with tempfile.TemporaryDirectory() as td:
        for i in range(pages_to_do):
            page = doc.load_page(i)
            pix = page.get_pixmap(dpi=RASTER_DPI)
            raw_png = os.path.join(td, f"p{i}.png")
            pix.save(raw_png)
            red_png = os.path.join(td, f"p{i}_red.png")
            log = redact_image(raw_png, red_png, keep_signature=True)
            total_burned += log.get("burned_count", 0)
            all_boxes.extend(log.get("boxes", []))
            img = Image.open(red_png).convert("RGB")
            redacted_imgs.append(img)

        if redacted_imgs:
            redacted_imgs[0].save(
                out_pdf,
                save_all=True,
                append_images=redacted_imgs[1:],
                format="PDF",
                resolution=RASTER_DPI,
            )
    doc.close()
    return {
        "burned_count": total_burned,
        "boxes": all_boxes,
        "page_count": page_count,
        "pages_redacted": pages_to_do,
    }


@app.post("/process")
async def process(file: UploadFile = File(...)):
    try:
        name = file.filename or "upload"
        ext = os.path.splitext(name)[-1].lower()
        allowed = {".pdf", ".jpg", ".jpeg", ".png"}
        if ext not in allowed:
            return JSONResponse({"ok": False, "error": f"unsupported ext: {ext}"}, status_code=400)

        data = await file.read()
        orig_size = len(data)

        with tempfile.TemporaryDirectory() as td:
            in_path = os.path.join(td, name)
            with open(in_path, "wb") as f:
                f.write(data)

            # ---- metadata: text (PDF), fields, doc classification ----
            extracted_text, page_count, fields = "", 0, {}
            if ext == ".pdf":
                extracted_text, page_count = extract_pdf_text(in_path)
                fields = extract_fields(extracted_text)
            doc_type, doc_conf, doc_src = classify_doc(name, extracted_text)

            ai_filename = None
            if doc_type != "Unclassified" and doc_conf >= 0.75:
                mrn = fields.get("mrn")
                date_str = (
                    fields.get("admission_date")
                    or fields.get("discharge_date")
                    or fields.get("dob")
                )
                # redacted output is always an image/pdf; keep pdf ext for pdf, jpg for images
                out_ext = ".pdf" if ext == ".pdf" else ".jpg"
                ai_filename = make_ai_filename(mrn, doc_type, date_str, out_ext)

            # ---- redaction + compression (produces the ONLY copy allowed out) ----
            redaction_ok = True
            redact_err = None
            try:
                if ext == ".pdf":
                    out_path = os.path.join(td, "redacted.pdf")
                    out_ct = "application/pdf"
                    log = _redact_pdf_file(in_path, out_path)
                    page_count = log.get("page_count", page_count)
                else:
                    out_path = os.path.join(td, "redacted.jpg")
                    out_ct = "image/jpeg"
                    log = _redact_image_file(in_path, out_path)
            except Exception as re:  # redaction failed -> do NOT allow anything out
                redaction_ok = False
                redact_err = str(re)
                log = {"burned_count": 0, "boxes": []}
                out_path, out_ct = None, None

            redacted_b64, comp_size = None, 0
            if redaction_ok and out_path and os.path.isfile(out_path):
                comp_size = os.path.getsize(out_path)
                with open(out_path, "rb") as f:
                    redacted_b64 = base64.b64encode(f.read()).decode("ascii")

            reduction = round((1 - comp_size / orig_size) * 100, 1) if orig_size and comp_size else 0

            return {
                "ok": True,
                "redaction_ok": redaction_ok,
                "redact_error": redact_err,
                "doc_type": doc_type,
                "doc_type_confidence": doc_conf,
                "doc_type_source": doc_src,
                "fields": fields,
                "ai_filename": ai_filename,
                "original_filename": name,
                "input_size": orig_size,
                "output_size": comp_size,
                "reduction_pct": reduction,
                "page_count": page_count,
                "burned_count": log.get("burned_count", 0),
                "burn_boxes": log.get("boxes", []),
                "extracted_text": (extracted_text or "")[:600],
                "redacted_content_type": out_ct,
                "redacted_b64": redacted_b64,
            }
    except Exception as e:
        return JSONResponse(
            {"ok": False, "error": str(e), "trace": traceback.format_exc()},
            status_code=500,
        )
