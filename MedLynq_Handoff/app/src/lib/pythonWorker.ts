// Persistent Python worker POOL — keeps N copies of python/tools/worker.py
// running for the life of the Next.js dev/prod server, instead of spawning a
// fresh Python process per file. Each worker loads PaddleOCR's model once
// and stays warm; jobs are handed to whichever worker is currently free, so
// several documents can genuinely OCR at the same time instead of queueing
// behind a single process.
//
// Why MEDLYNQ_PADDLE_MKLDNN=false is forced here: PaddleOCR's default
// acceleration (Intel oneDNN, "mkldnn") is fine for exactly one process, but
// running 2+ processes with it enabled at the same time crashes reliably
// (RuntimeError: Unknown exception from Paddle's own inference engine —
// confirmed directly via pool_benchmark.py). Disabling it costs each
// individual file some speed (~2.5x slower per file, measured directly),
// but is what makes running N files at once possible at all without
// crashing. Single-file requests (pool naturally idle otherwise) still
// benefit from N being available whenever a real batch comes in.
//
// Requests are sent as one line of JSON on a worker's stdin and matched back
// to their caller by "_id" when a response line comes back on that same
// worker's stdout. If a worker dies mid-job, its in-flight requests are
// rejected so callers' existing retry logic keeps working, and the pool
// tops itself back up to POOL_SIZE on the next call.

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const WORKER_SCRIPT = path.join(process.cwd(), "python", "tools", "worker.py");
const POOL_SIZE = Number(process.env.MEDLYNQ_WORKER_POOL_SIZE) || 3;

interface Slot {
  child: ChildProcessWithoutNullStreams;
  stdoutBuf: string;
  pending: Map<string, (result: any) => void>;
  busy: boolean;
}

let pool: Slot[] = [];
let requestCounter = 0;
// payload is whatever worker.py's handle() expects for its cmd — "land" and
// "explode" both look like {cmd, path, doc_type_hint, force_doc_type,
// hospital_id}; "extract_page" is just {cmd, path}; "finish_parallel" is
// {cmd, page_results, page_paths, compressed_path, doc_type_hint,
// force_doc_type, hospital_id}. Kept as a bag of fields (not a union type)
// since it's serialized straight to JSON either way.
const queue: { payload: Record<string, any>; resolve: (result: any) => void }[] = [];

function spawnSlot(): Slot {
  const child = spawn(PYTHON, [WORKER_SCRIPT], {
    windowsHide: true,
    env: { ...process.env, MEDLYNQ_PADDLE_MKLDNN: "false" },
  });

  const slot: Slot = { child, stdoutBuf: "", pending: new Map(), busy: false };

  child.stdout.on("data", (chunk: Buffer) => {
    slot.stdoutBuf += chunk.toString();
    let idx: number;
    while ((idx = slot.stdoutBuf.indexOf("\n")) >= 0) {
      const line = slot.stdoutBuf.slice(0, idx);
      slot.stdoutBuf = slot.stdoutBuf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // stray native-library log line on stdout — ignore, not a response
      }
      const id = msg?._id != null ? String(msg._id) : undefined;
      const resolve = id ? slot.pending.get(id) : undefined;
      if (resolve) {
        slot.pending.delete(id!);
        slot.busy = false;
        resolve(msg);
        dispatchNext(); // this slot just freed up — hand it the next queued job, if any
      }
    }
  });

  child.on("exit", () => {
    for (const resolve of slot.pending.values()) resolve({ error: "worker process exited" });
    slot.pending.clear();
    pool = pool.filter((s) => s !== slot);
    // Don't respawn eagerly here — a crash-looping worker would otherwise spin
    // up processes as fast as it can kill them. ensurePool() tops the count
    // back up to POOL_SIZE the next time a job actually needs dispatching.
  });
  child.on("error", (err) => {
    for (const resolve of slot.pending.values()) resolve({ error: `worker spawn error: ${err.message}` });
    slot.pending.clear();
  });

  return slot;
}

function ensurePool() {
  while (pool.length < POOL_SIZE) pool.push(spawnSlot());
}

function dispatchNext() {
  if (queue.length === 0) return;
  const free = pool.find((s) => !s.busy);
  if (!free) return;
  const job = queue.shift()!;
  free.busy = true;
  const id = String(++requestCounter);
  free.pending.set(id, job.resolve);
  const line = JSON.stringify({ _id: id, ...job.payload }) + "\n";
  free.child.stdin.write(line, (err) => {
    if (err) {
      free.busy = false;
      free.pending.delete(id);
      job.resolve({ error: `failed to write to worker: ${err.message}` });
      dispatchNext();
    }
  });
}

function runJob(payload: Record<string, any>): Promise<any> {
  ensurePool();
  return new Promise((resolve) => {
    queue.push({ payload, resolve });
    dispatchNext();
  });
}

/** Runs land_document.py's full land_file() pipeline for one file via the
 * worker pool. Same result shape as the old single-worker call — callers
 * don't need to know whether their job ran on worker 1 or worker 3.
 * Resolves with {error: "..."} rather than throwing if something goes
 * wrong, so existing `if (landed.error) retry...` logic keeps working. */
export function landViaWorker(filePath: string, docTypeHint: string, forceDocType?: string, hospitalId?: string): Promise<any> {
  return runJob({ cmd: "land", path: filePath, doc_type_hint: docTypeHint, force_doc_type: forceDocType, hospital_id: hospitalId });
}

/** land_file()'s front half. For a scanned multi-page PDF, returns
 * {parallel: true, page_paths: [...]} with NO OCR done yet, so the caller
 * can fan those pages out across the whole pool via extractPageViaWorker()
 * instead of OCR'ing them one at a time inside a single worker. Every other
 * case (single page, text-PDF, image, visual-only) just runs the full
 * pipeline and returns {parallel: false, ...normal land result}. */
export function explodeViaWorker(filePath: string, docTypeHint: string, forceDocType?: string, hospitalId?: string): Promise<any> {
  return runJob({ cmd: "explode", path: filePath, doc_type_hint: docTypeHint, force_doc_type: forceDocType, hospital_id: hospitalId });
}

/** OCRs one rasterized page image. This is the actual parallelizable unit —
 * call it once per page from explodeViaWorker()'s page_paths and Promise.all
 * them; each call queues independently and gets handed to whichever pool
 * worker frees up next, so up to POOL_SIZE pages genuinely OCR at once. */
export function extractPageViaWorker(pagePath: string): Promise<any> {
  return runJob({ cmd: "extract_page", path: pagePath });
}

/** Reassembles extractPageViaWorker() results (gathered by the caller, in
 * original page order) back into one document result — the parallel-path
 * equivalent of what land_file() does internally for a scanned PDF. */
export function finishParallelViaWorker(
  pageResults: any[], pagePaths: string[], compressedPath: string,
  docTypeHint: string, forceDocType?: string, hospitalId?: string
): Promise<any> {
  return runJob({
    cmd: "finish_parallel",
    page_results: pageResults,
    page_paths: pagePaths,
    compressed_path: compressedPath,
    doc_type_hint: docTypeHint,
    force_doc_type: forceDocType,
    hospital_id: hospitalId,
  });
}
