"""Persistent document-landing worker — keeps PaddleOCR's model loaded in
memory for the life of the process, instead of every file paying the cold
model-load cost (several seconds) that a fresh `python land_document.py`
subprocess incurs each time.

Protocol: newline-delimited JSON over stdin/stdout. Node spawns this ONE
process and keeps it alive (see src/lib/pythonWorker.ts) instead of
spawning-and-killing a new Python process per file.

Request  (one line):  {"_id": "17", "path": "...", "doc_type_hint": "..."}
Response (one line):  {"_id": "17", ...land_file() result...}

Requests are processed one at a time, in the order received — PaddleOCR
itself isn't safe to call concurrently from multiple threads in one
process, and the actual win here is skipping the reload, not parallelism
(Node can still have several requests in flight; they just queue here).

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
from land_document import land_file  # noqa: E402


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
            result = land_file(
                Path(req["path"]),
                req.get("doc_type_hint", "Unknown Document"),
                force_doc_type=req.get("force_doc_type"),
            )
        except Exception as e:
            result = {"error": str(e)}
        result["_id"] = req_id
        print(json.dumps(result, ensure_ascii=False), flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
