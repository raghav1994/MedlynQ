// Loads and queries scheme_pre_auth_master.csv.
// Per (scheme + variant + entry_mode) returns the exact pre-auth doc list
// with alt-groups marked. The "*" variant matches everything.

import { readFile } from "fs/promises";
import path from "path";
import type { Scheme, SchemeVariant, EntryMode } from "./types";

export type SchemeRule = {
  scheme: string;
  variant: string;       // "*" or specific
  entry_mode: string;    // "checkup" or "emergency"
  doc_type: string;
  is_required: boolean;
  alt_group?: string;
  notes?: string;
};

let CACHE: SchemeRule[] | null = null;

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

async function load(): Promise<SchemeRule[]> {
  if (CACHE) return CACHE;
  try {
    const p = path.resolve(process.cwd(), "data", "scheme_pre_auth_master.csv");
    const raw = await readFile(p, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const out: SchemeRule[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [scheme, variant, entry_mode, doc_type, is_required, alt_group, notes] = parseLine(lines[i]);
      if (!scheme || !doc_type) continue;
      out.push({
        scheme: scheme.trim(),
        variant: (variant || "*").trim(),
        entry_mode: (entry_mode || "checkup").trim(),
        doc_type: doc_type.trim(),
        is_required: is_required === "1" || is_required?.toLowerCase() === "true",
        alt_group: alt_group?.trim() || undefined,
        notes: notes?.trim() || undefined,
      });
    }
    CACHE = out;
  } catch {
    CACHE = [];
  }
  return CACHE;
}

// Pre-auth checklist for (scheme + variant + entry_mode).
// Variant "*" rules apply across all variants of that scheme.
// Specific variant rules apply only when the case matches.
export async function preAuthDocsFor(
  scheme: Scheme,
  variant?: SchemeVariant | null,
  entryMode: EntryMode = "checkup",
): Promise<SchemeRule[]> {
  const rules = await load();
  return rules.filter((r) => {
    if (r.scheme !== scheme) return false;
    if (r.entry_mode !== entryMode) return false;
    if (r.variant === "*") return true;
    return variant ? r.variant === variant : false;
  });
}

// All schemes that appear in the master. Sorted.
export async function listSchemes(): Promise<string[]> {
  const rules = await load();
  return Array.from(new Set(rules.map((r) => r.scheme))).sort();
}

export async function totalRules(): Promise<number> {
  return (await load()).length;
}
