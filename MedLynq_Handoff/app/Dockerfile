# MedLynq — single-container image (Next.js + Python OCR sidecar).
#
# The Python OCR pipeline (PaddleOCR/RapidOCR/OnnxTR) is NOT a separate
# service — Node spawns and keeps warm a pool of long-lived Python
# subprocesses (see src/lib/pythonWorker.ts) over stdin/stdout. That means
# this container needs BOTH runtimes installed together; it can't be split
# into "a Node image" + "a Python image" without rewriting pythonWorker.ts
# to call out over HTTP instead. See HANDOFF.md section 6 for that tradeoff
# if you want to split it later.
#
# Build:  docker build -t medlynq .
# Run:    docker run -p 3000:3000 --env-file .env.local medlynq

FROM node:20-bookworm AS base

# ---- system deps for the Python ML stack (opencv, paddle) ----
RUN apt-get update && apt-get install -y --no-install-recursive \
    python3.11 python3.11-venv python3-pip \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Python deps (heavy — layer-cache this separately from app code) ----
COPY python/requirements.txt python/requirements.txt
RUN python3.11 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir -r python/requirements.txt

# ---- Node deps ----
COPY package.json package-lock.json ./
RUN npm ci

# ---- app code ----
COPY . .

# The venv's python executable — same value MEDLYNQ_PYTHON needs in .env.local
ENV MEDLYNQ_PYTHON=/app/.venv/bin/python
ENV NODE_ENV=production

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
