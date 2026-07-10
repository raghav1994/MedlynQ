// Per-case "not needed" overrides for missing checklist docs.
// MEDCO can cross out a missing doc they know doesn't apply — the query-risk
// % recomputes as if it were present. Persisted so it survives reloads.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const FILE = path.resolve(process.cwd(), "db", "checklist_skips.json");

async function readAll(): Promise<Record<string, string[]>> {
  try { return JSON.parse(await readFile(FILE, "utf8")); } catch { return {}; }
}
async function writeAll(v: Record<string, string[]>) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(v, null, 2));
}

export async function getSkippedDocTypes(case_id: string): Promise<string[]> {
  const all = await readAll();
  return all[case_id] ?? [];
}

export async function toggleSkippedDocType(case_id: string, doc_type: string, skip: boolean): Promise<string[]> {
  const all = await readAll();
  const current = new Set(all[case_id] ?? []);
  if (skip) current.add(doc_type); else current.delete(doc_type);
  all[case_id] = Array.from(current);
  await writeAll(all);
  return all[case_id];
}
