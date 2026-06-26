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
};

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

async function load(): Promise<Package[]> {
  if (CACHE) return CACHE;
  try {
    const p = path.resolve(process.cwd(), "data", "package_master.csv");
    const raw = await readFile(p, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const out: Package[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [code, name, specialty, schemes, cap, los, notes] = parseLine(lines[i]);
      if (!code) continue;
      out.push({
        code: code.trim(),
        name: name.trim(),
        specialty: specialty.trim(),
        schemes: schemes.split("|").map((s) => s.trim()).filter(Boolean),
        cap_inr: Number(cap) || 0,
        length_of_stay_days: Number(los) || 0,
        notes: (notes || "").trim(),
      });
    }
    CACHE = out;
  } catch {
    CACHE = [];
  }
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
