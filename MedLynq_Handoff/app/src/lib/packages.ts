// Package master loader — reads app/data/package_master.csv.
// Source of truth for "is this code covered by this scheme + what is the cap".

import { readFile } from "fs/promises";
import path from "path";

export type Package = {
  code: string;
  name: string;
  specialty: string;
  schemes: string[];
  cap_inr: number;
  length_of_stay_days: number;
  notes: string;
  source?: string;       // K4: origin tag — seed_v1 / pmjay_hbp_2.2_seed / cghs / echs / esic / railway_umid
};

export type SourceCount = { source: string; count: number };

let CACHE: Package[] | null = null;

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Load one CSV into a Package[] keyed by code. Defensive — bad lines are skipped.
async function loadOne(filename: string, defaultSource: string): Promise<Map<string, Package>> {
  const out = new Map<string, Package>();
  try {
    const p = path.resolve(process.cwd(), "data", filename);
    const raw = await readFile(p, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const [code, name, specialty, schemes, cap, los, notes, source] = parseLine(lines[i]);
      if (!code) continue;
      const c = code.trim().toUpperCase();
      out.set(c, {
        code: c,
        name: name.trim(),
        specialty: specialty.trim(),
        schemes: schemes.split("|").map((s) => s.trim()).filter(Boolean),
        cap_inr: Number(cap) || 0,
        length_of_stay_days: Number(los) || 0,
        notes: (notes || "").trim(),
        source: (source || defaultSource).trim(),
      });
    }
  } catch {
    // ignore — empty map
  }
  return out;
}

// Loader: merges official PMJAY HBP 2022 file (authoritative on collision)
// + the curated seed (for non-PMJAY schemes + extras).
async function load(): Promise<Package[]> {
  if (CACHE) return CACHE;
  const seed = await loadOne("package_master.csv", "seed_v1");
  const hbp = await loadOne("package_master_hbp_2022.csv", "pmjay_hbp_2022");
  const merged = new Map<string, Package>(seed);
  // HBP 2022 wins on collision because it's the official source of truth.
  for (const [code, pkg] of hbp.entries()) merged.set(code, pkg);
  CACHE = [...merged.values()];
  return CACHE;
}

export async function findPackage(code: string): Promise<Package | null> {
  const list = await load();
  const u = code.trim().toUpperCase();
  return list.find((p) => p.code.toUpperCase() === u) ?? null;
}

export type PackageCheck = {
  status: "covered" | "not_in_scheme" | "unknown_code";
  package: Package | null;
  scheme: string;
  message: string;
};

export async function checkPackageForScheme(code: string, scheme: string): Promise<PackageCheck> {
  const pkg = await findPackage(code);
  if (!pkg) return { status: "unknown_code", package: null, scheme, message: `Code "${code}" not found in package master.` };
  if (!pkg.schemes.includes(scheme)) return {
    status: "not_in_scheme", package: pkg, scheme,
    message: `${pkg.name} is not covered under ${scheme}. Available on: ${pkg.schemes.join(", ")}.`,
  };
  return {
    status: "covered", package: pkg, scheme,
    message: `${pkg.name} · cap ₹${pkg.cap_inr.toLocaleString("en-IN")} · ${pkg.length_of_stay_days} day${pkg.length_of_stay_days === 1 ? "" : "s"} LOS.`,
  };
}

export async function totalCount(): Promise<number> {
  return (await load()).length;
}

// K4 — return counts grouped by source (for Admin / scheme master visibility).
export async function countsBySource(): Promise<SourceCount[]> {
  const list = await load();
  const counts: Record<string, number> = {};
  for (const p of list) {
    const s = p.source || "seed_v1";
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

// K4 — distinct schemes covered + how many codes each scheme has.
export async function schemeCoverage(): Promise<Array<{ scheme: string; count: number }>> {
  const list = await load();
  const counts: Record<string, number> = {};
  for (const p of list) {
    for (const s of p.schemes) counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([scheme, count]) => ({ scheme, count }))
    .sort((a, b) => b.count - a.count);
}
