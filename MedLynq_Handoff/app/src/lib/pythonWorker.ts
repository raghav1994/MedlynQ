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
const queue: { filePath: string; docTypeHint: string; forceDocType?: string; resolve: (result: any) => void }[] = [];

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
  const line = JSON.stringify({
    _id: id,
    path: job.filePath,
    doc_type_hint: job.docTypeHint,
    force_doc_type: job.forceDocType,
  }) + "\n";
  free.child.stdin.write(line, (err) => {
    if (err) {
      free.busy = false;
      free.pending.delete(id);
      job.resolve({ error: `failed to write to worker: ${err.message}` });
      dispatchNext();
    }
  });
}

/** Runs land_document.py's logic for one file via the worker pool. Same
 * result shape as the old single-worker call — callers don't need to know
 * whether their job ran on worker 1 or worker 3. Resolves with
 * {error: "..."} rather than throwing if something goes wrong, so existing
 * `if (landed.error) retry...` logic in callers keeps working unchanged. */
export function landViaWorker(filePath: string, docTypeHint: string, forceDocType?: string): Promise<any> {
  ensurePool();
  return new Promise((resolve) => {
    queue.push({ filePath, docTypeHint, forceDocType, resolve });
    dispatchNext();
  });
}
