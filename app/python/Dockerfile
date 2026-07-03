# MedLynq OCR/compress/redact service — PaddleOCR + OpenCV + PyMuPDF.
# The Node App Service container cannot run these; this runs as a separate
# Azure Container App that Node calls over HTTP.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# System libs paddle/opencv need at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-service.txt .
RUN pip install --no-cache-dir -r requirements-service.txt

# Bake the PaddleOCR detection/recognition models into the image so the first
# request doesn't have to download them (faster, works if egress is locked down).
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en')" || true

COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn service:app --host 0.0.0.0 --port ${PORT}"]
