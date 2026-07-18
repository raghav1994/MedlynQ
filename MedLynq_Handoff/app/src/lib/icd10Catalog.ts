// Admin-managed additions/edits/deletions layered on top of the crawled WHO
// ICD-10 catalog (data/icd10_who_full.csv, 10,673 codes, see
// scripts/fetch_who_icd10.mjs). The crawled file is never touched directly —
// an owner add/edit/delete only ever writes db/icd10_overrides.json, so a
// bad edit or a future re-crawl can't lose it and can't corrupt the bulk
// import. src/lib/icd10.ts reads this (via readIcd10Overrides) and merges
// it in on every lookup/search — no cache to invalidate, an edit here takes
// effect immediately.
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { findBaseWhoCode } from "@/lib/icd10";

export type Icd10Overrides = {
  upserts: Record<string, string>; // code -> display, for admin-added or admin-edited codes
  deleted: string[]; // codes hidden from the base WHO crawl
};

const OVERRIDES_FILE = path.resolve(process.cwd(), "db", "icd10_overrides.json");

export async function readIcd10Overrides(): Promise<Icd10Overrides> {
  try {
    const raw = await readFile(OVERRIDES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { upserts: parsed.upserts ?? {}, deleted: parsed.deleted ?? [] };
  } catch {
    return { upserts: {}, deleted: [] };
  }
}

async function writeIcd10Overrides(overrides: Icd10Overrides): Promise<void> {
  await mkdir(path.dirname(OVERRIDES_FILE), { recursive: true });
  await writeFile(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
}

export type Icd10CatalogRow = {
  code: string;
  display: string;
  status: "added" | "edited" | "deleted";
  base_display?: string; // what WHO originally had, for an "edited" or "deleted" row
};

// The admin screen's "Your changes" table — every code an owner has
// touched, whether still active (added/edited) or hidden (deleted).
export async function listIcd10Overrides(): Promise<Icd10CatalogRow[]> {
  const overrides = await readIcd10Overrides();
  const rows: Icd10CatalogRow[] = [];

  for (const [code, display] of Object.entries(overrides.upserts)) {
    const base = await findBaseWhoCode(code);
    rows.push({ code, display, status: base ? "edited" : "added", base_display: base?.display });
  }
  for (const code of overrides.deleted) {
    const base = await findBaseWhoCode(code);
    rows.push({ code, display: overrides.upserts[code] ?? base?.display ?? "(not in WHO catalog)", status: "deleted", base_display: base?.display });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

// Add a brand-new code (not in WHO's list) or override an existing WHO
// code's description. Also un-deletes it if it was previously removed —
// editing a deleted code is how an owner brings it back with new wording.
export async function upsertIcd10Code(code: string, display: string): Promise<void> {
  const trimmedCode = code.trim();
  const overrides = await readIcd10Overrides();
  overrides.upserts[trimmedCode] = display.trim();
  overrides.deleted = overrides.deleted.filter((c) => c.toUpperCase() !== trimmedCode.toUpperCase());
  await writeIcd10Overrides(overrides);
}

// Hides a code from lookups/search. If it was purely an admin addition
// (never in WHO's own list), this removes it entirely; if it's a real WHO
// code, it's blacklisted but restorable.
export async function deleteIcd10Code(code: string): Promise<void> {
  const trimmedCode = code.trim();
  const overrides = await readIcd10Overrides();
  delete overrides.upserts[trimmedCode];
  if (!overrides.deleted.some((c) => c.toUpperCase() === trimmedCode.toUpperCase())) {
    overrides.deleted.push(trimmedCode);
  }
  await writeIcd10Overrides(overrides);
}

// Un-hides a previously deleted code — brings back WHO's original wording
// (or removes it entirely if it was never a real WHO code to begin with).
export async function restoreIcd10Code(code: string): Promise<void> {
  const trimmedCode = code.trim();
  const overrides = await readIcd10Overrides();
  overrides.deleted = overrides.deleted.filter((c) => c.toUpperCase() !== trimmedCode.toUpperCase());
  delete overrides.upserts[trimmedCode];
  await writeIcd10Overrides(overrides);
}
