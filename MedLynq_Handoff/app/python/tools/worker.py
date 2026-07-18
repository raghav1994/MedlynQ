"""Persistent document-landing worker — keeps PaddleOCR's model loaded in
memory for the life of the process, instead of every file paying the cold
model-load cost (several seconds) that a fresh `python land_document.py`
subprocess incurs each time.

Protocol: newline-delimited JSON over stdin/stdout. Node spawns a POOL of
these (see src/lib/pythonWorker.ts) instead of spawning-and-killing a new
Python process per file.

Request  (one line):  {"_id": "17", "cmd": "land", "path": "...", "doc_type_hint": "..."}
Response (one line):  {"_id": "17", ...cmd-specific result...}

cmd defaults to "land" (backward compatible with the original single-command
protocol). Four commands exist:
  land           - full land_file() pipeline, one call, one file. Used for
                   most files — small/single-page ones aren't worth splitting.
  explode        - land_file()'s front half. For a scanned multi-page PDF,
                   stops before OCR and returns rasterized page paths instead
                   of processing them in-process, so Node can fan them out
                   across every worker in the pool. Everything else just
                   runs the normal full pipeline and returns it directly
                   (parallel: false).
  extract_page   - OCRs ONE page image. This is the actual parallelizable
                   unit of work — Node dispatches one of these per page,
                   naturally load-balanced across whichever workers are free.
  finish_parallel- reassembles the extract_page results (gathered by Node,
                   in page order) back into one document result.

Each worker still processes ONE request at a time (PaddleOCR isn't safe to
call concurrently within a single process) — parallelism across a batch or
across a multi-page document's pages comes from Node having several workers
to hand jobs to, not from any one worker doing more than one thing at once.

A crash mid-file prints one error response for that request and keeps the
worker alive for the next one, so one bad file can't take down the whole
batch.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from land_document import land_file, explode_for_pool, extract_page, finish_parallel  # noqa: E402


def handle(req: dict) -> dict:
    cmd = req.get("cmd", "land")

    if cmd == "land":
        return land_file(
            Path(req["path"]),
            req.get("doc_type_hint", "Unknown Document"),
            force_doc_type=req.get("force_doc_type"),
            hospital_id=req.get("hospital_id"),
        )

    if cmd == "explode":
        return explode_for_pool(
            Path(req["path"]),
            req.get("doc_type_hint", "Unknown Document"),
            force_doc_type=req.get("force_doc_type"),
            hospital_id=req.get("hospital_id"),
        )

    if cmd == "extract_page":
        return extract_page(Path(req["path"]))

    if cmd == "finish_parallel":
        return finish_parallel(
            req["page_results"],
            req["page_paths"],
            req["compressed_path"],
            req.get("doc_type_hint", "Unknown Document"),
            req.get("force_doc_type"),
            req.get("hospital_id"),
        )

    return {"error": f"unknown cmd: {cmd}"}


def main() -> int:
    # Signal readiness on stderr (stdout is reserved for JSON responses)
    # so the Node side knows the worker booted before sending anything.
    print("READY", file=sys.stderr, flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("_id")
            result = handle(req)
        except Exception as e:
            result = {"error": str(e)}
        result["_id"] = req_id
        print(json.dumps(result, ensure_ascii=False), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
