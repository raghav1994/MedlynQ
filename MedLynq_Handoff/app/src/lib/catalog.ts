// Global Document Catalog — the ONE shared master list of document
// definitions (label, classifier anchors, category) that every hospital
// draws from. Not hardcoded: stored in db/document_catalog.json and edited by
// the owner account in the internal backend admin.
//
// Relationship to per-hospital data:
//   - A hospital's document_library entry with catalog_linked:true is a LIVE
//     copy of a catalog entry — editing the catalog re-syncs it (see
//     tenant/admin.ts propagateCatalogChange). Once a hospital edits the
//     label/anchors locally, it detaches and central edits stop touching it.
//   - document_requirements (which dept/stage/scheme needs a doc) stays fully
//     per-hospital — that genuinely varies and the catalog never dictates it.
//
// This module is definitions-only; propagation into tenants lives in
// tenant/admin.ts to avoid a circular import (admin.ts already owns the
// tenant read/write + document_profiles re-flatten).

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export type CatalogEntry = {
  doc_type: string;                // slug, unique — the join key across the system
  label: string;
  anchors: string[];               // classifier hints — become Lynq rules per hospital
  extraction_keys?: string[];
  category: string;                // for grouping in the picker (e.g. "Labs", "Surgery")
};

const CATALOG_FILE = path.resolve(process.cwd(), "db", "document_catalog.json");

export async function listCatalog(): Promise<CatalogEntry[]> {
  try {
    const raw = await readFile(CATALOG_FILE, "utf8");
    return JSON.parse(raw) as CatalogEntry[];
  } catch {
    return [];
  }
}

async function saveCatalog(entries: CatalogEntry[]): Promise<void> {
  await mkdir(path.dirname(CATALOG_FILE), { recursive: true });
  await writeFile(CATALOG_FILE, JSON.stringify(entries, null, 2));
}

export async function addCatalogEntry(entry: CatalogEntry): Promise<CatalogEntry[]> {
  const all = await listCatalog();
  if (all.some((e) => e.doc_type === entry.doc_type)) {
    throw new Error(`Document type ${entry.doc_type} already exists in the catalog`);
  }
  const next = [...all, entry];
  await saveCatalog(next);
  return next;
}

// Returns the updated catalog AND the original doc_type so the caller can
// propagate a rename (doc_type change) into tenant data too.
export async function updateCatalogEntry(
  originalDocType: string,
  entry: CatalogEntry,
): Promise<CatalogEntry[]> {
  const all = await listCatalog();
  if (!all.some((e) => e.doc_type === originalDocType)) {
    throw new Error(`Document type ${originalDocType} not found in the catalog`);
  }
  if (entry.doc_type !== originalDocType && all.some((e) => e.doc_type === entry.doc_type)) {
    throw new Error(`Document type ${entry.doc_type} already exists in the catalog`);
  }
  const next = all.map((e) => (e.doc_type === originalDocType ? entry : e));
  await saveCatalog(next);
  return next;
}

export async function removeCatalogEntry(doc_type: string): Promise<CatalogEntry[]> {
  const all = await listCatalog();
  const next = all.filter((e) => e.doc_type !== doc_type);
  await saveCatalog(next);
  return next;
}
