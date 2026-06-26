// Drug Master — fuzzy lookup of brand/generic names against the local CSV.
//
// Source: app/data/drug_master.csv (built by python/tools/build_drug_master.py)
// Loaded server-side, cached in memory after first read.
//
// Use:  await matchDrug("Trastuzumab") → { generic, brands, oncology, mrp_min, mrp_max, score }

import { readFile } from "fs/promises";
import path from "path";

export type DrugEntry = {
  generic: string;
  brand_names: string[];
  manufacturers: string[];
  pack_size: string[];
  type: string[];
  mrp_min: number | null;
  mrp_max: number | null;
  oncology: boolean;
  n_skus: number;
};

export type DrugMatch = {
  entry: DrugEntry;
  score: number;       // 0..1
  matched_on: "generic" | "brand";
  matched_text: string;
};

let CACHE: DrugEntry[] | null = null;

function parseCSV(text: string): DrugEntry[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const out: DrugEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 9) continue;
    const [generic, brands, mfg, pack, typ, mrpMin, mrpMax, onco, nskus] = cols;
    out.push({
      generic,
      brand_names: brands ? brands.split(" | ").filter(Boolean) : [],
      manufacturers: mfg ? mfg.split(" | ").filter(Boolean) : [],
      pack_size: pack ? pack.split(" | ").filter(Boolean) : [],
      type: typ ? typ.split(" | ").filter(Boolean) : [],
      mrp_min: mrpMin ? Number(mrpMin) : null,
      mrp_max: mrpMax ? Number(mrpMax) : null,
      oncology: onco === "1",
      n_skus: Number(nskus) || 0,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadMaster(): Promise<DrugEntry[]> {
  if (CACHE) return CACHE;
  try {
    const p = path.resolve(process.cwd(), "data", "drug_master.csv");
    const raw = await readFile(p, "utf8");
    CACHE = parseCSV(raw);
  } catch {
    CACHE = [];
  }
  return CACHE;
}

// Simple bag-of-tokens similarity good enough for short drug names.
function tokenSim(a: string, b: string): number {
  const ta = a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const tb = b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return shared / Math.max(ta.length, tb.length);
}

function contains(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

export async function matchDrug(query: string): Promise<DrugMatch | null> {
  const q = query.trim();
  if (!q) return null;
  const master = await loadMaster();
  let best: DrugMatch | null = null;
  for (const e of master) {
    // generic substring match wins
    if (contains(e.generic, q) || contains(q, e.generic)) {
      const score = Math.max(tokenSim(e.generic, q), 0.8);
      if (!best || score > best.score) best = { entry: e, score, matched_on: "generic", matched_text: e.generic };
      continue;
    }
    for (const b of e.brand_names) {
      if (contains(b, q) || contains(q, b)) {
        const score = Math.max(tokenSim(b, q), 0.85);
        if (!best || score > best.score) best = { entry: e, score, matched_on: "brand", matched_text: b };
        break;
      }
    }
  }
  return best;
}

export async function matchDrugs(queries: string[]): Promise<Array<{ query: string; match: DrugMatch | null }>> {
  return Promise.all(queries.map(async (q) => ({ query: q, match: await matchDrug(q) })));
}

export async function oncologyMaster(): Promise<DrugEntry[]> {
  const m = await loadMaster();
  return m.filter((e) => e.oncology);
}
