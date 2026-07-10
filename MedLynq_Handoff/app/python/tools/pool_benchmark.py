"""Proves the throughput math for running redact_image() across a pool of N
worker processes instead of one at a time — before touching Azure.

This benchmarks the actual CPU-bound bottleneck we measured directly earlier
(PaddleOCR's detection+recognition pass, ~25s/page on this machine) using
real rasterized hospital-document pages, not synthetic images. It calls
redact_image() directly (bypassing extract_hints.py's SHA cache) so every
call does genuine fresh work in both the sequential and parallel runs —
otherwise a cached run would look "fast" for the wrong reason.

Usage:
  python pool_benchmark.py <dir_of_images> [pool_size]

If pool_size is omitted, uses os.cpu_count().
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from multiprocessing import Pool

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_redact = None


def _init_worker():
    """Runs once per pool process — this is where the ~3s trimmed model load
    happens, exactly like our persistent worker.py. Not timed as part of the
    per-file benchmark below, since a real long-lived worker pays this cost
    once at startup, not per document."""
    global _redact
    from redact import redact_image
    _redact = redact_image


def _process_one(paths: tuple[str, str]) -> float:
    in_path, out_path = paths
    t0 = time.time()
    _redact(in_path, out_path)
    return time.time() - t0


def run(files: list[Path], pool_size: int, out_dir: Path) -> float:
    jobs = [(str(f), str(out_dir / f"redacted_{f.name}")) for f in files]
    with Pool(processes=pool_size, initializer=_init_worker) as pool:
        # Warm every worker in the pool BEFORE starting the timer — this
        # matches a real deployment where workers stay alive across many
        # documents, so model-load cost is paid once, not per batch.
        warm_jobs = [jobs[0]] * pool_size
        pool.map(_process_one, warm_jobs)

        t_start = time.time()
        per_file_times = pool.map(_process_one, jobs)
        wall_time = time.time() - t_start

    print(f"  per-file times: {[f'{t:.1f}s' for t in per_file_times]}")
    return wall_time


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: pool_benchmark.py <dir_of_images> [pool_size]")
        return 2

    src_dir = Path(sys.argv[1])
    pool_size = int(sys.argv[2]) if len(sys.argv) > 2 else (os.cpu_count() or 4)
    files = sorted([p for p in src_dir.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg")])
    if not files:
        print(f"no image files found in {src_dir}")
        return 1

    out_dir = src_dir / "_bench_out"
    out_dir.mkdir(exist_ok=True)

    print(f"Benchmarking {len(files)} real document pages from {src_dir}")
    print(f"CPU count on this machine: {os.cpu_count()}\n")

    print("=== SEQUENTIAL (pool_size=1, today's architecture) ===")
    t_seq = run(files, 1, out_dir)
    print(f"  TOTAL wall time: {t_seq:.2f}s\n")

    print(f"=== PARALLEL (pool_size={pool_size}) ===")
    t_par = run(files, pool_size, out_dir)
    print(f"  TOTAL wall time: {t_par:.2f}s\n")

    speedup = t_seq / t_par if t_par > 0 else float("inf")
    print(f"RESULT: {speedup:.2f}x throughput improvement with {pool_size} workers")
    print(f"        ({len(files)} pages: {t_seq:.1f}s sequential -> {t_par:.1f}s parallel)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
