// ICD-10 resolution for the NHCX Condition resource.
//
// Trust order: an already-coded diagnosis string (hospital/HIS embedded the
// code themselves, e.g. "C50.9 Breast malignant neoplasm") > the curated
// static lookup table (data/icd10_lookup.csv) > an LLM guess (Sarvam) as the
// last resort. Only the first two are ever marked verified:true. An
// LLM-guessed code is a starting point for staff to confirm, never something
// that should go to a real payer unreviewed.
//
// NOTE: an earlier version of this file also queried NIH's free public
// ICD-10-CM search API as a mid-tier guess. That was removed — NIH only
// serves ICD-10-CM, the US clinical-modification variant (extra digits for
// laterality, different official wording), not the plain WHO ICD-10 that
// India's NHCX expects. A code from that source could pass MedLynq's own
// review screen and still get bounced back as a payer query, because the
// reviewer on the other end just sees "code doesn't match" and flags it —
// they don't reason about which country's coding system produced it.
//
// Replaced with data/icd10_who_full.csv — the actual WHO ICD-10 (2019)
// catalog (10,673 codes), crawled once from icd.who.int's own public
// browser JSON (scripts/fetch_who_icd10.mjs, no API key needed, no
// live dependency at request time). Every code in that file is a real WHO
// code in the exact format NHCX expects, so unlike the NIH tier, a bad
// text-match here can only produce an imprecise *guess*, never a
// wrong-country code — the syntactic-mismatch failure mode is gone.

import { readFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { readIcd10Overrides } from "@/lib/icd10Catalog";

export type Icd10Result = {
  code: string;
  display: string;
  source: "embedded" | "lookup" | "llm" | "manual";
  verified: boolean;
};

// A staff member typed/confirmed this code directly on the pre-send NHCX
// review screen (see NHCXBridge.tsx + /api/cases/[id] PATCH) — that human
// action IS the verification, always trusted over an auto-resolved guess.
export function manualIcd10(code: string, display: string): Icd10Result {
  return { code, display, source: "manual", verified: true };
}

const LOOKUP_FILE = path.resolve(process.cwd(), "data", "icd10_lookup.csv");
const WHO_FULL_FILE = path.resolve(process.cwd(), "data", "icd10_who_full.csv");
const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const LLM_SCRIPT = path.resolve(process.cwd(), "python", "icd10_llm.py");

// e.g. "C50.9 Breast malignant neoplasm" -> code "C50.9", display the rest.
// ICD-10 codes are a letter (not U) + 2 digits, optionally .1-4 more chars.
const EMBEDDED_RE = /^([A-TV-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?)\s+(.+)$/;

export function parseEmbeddedIcd10(diagnosisText: string): Icd10Result | null {
  const m = diagnosisText.trim().match(EMBEDDED_RE);
  if (!m) return null;
  return { code: m[1], display: m[2].trim(), source: "embedded", verified: true };
}

let lookupCache: Array<{ keyword: string; code: string; display: string }> | null = null;

async function loadLookup() {
  if (lookupCache) return lookupCache;
  try {
    const raw = await readFile(LOOKUP_FILE, "utf8");
    const lines = raw.split("\n").slice(1).filter((l) => l.trim());
    lookupCache = lines.map((line) => {
      const [keyword, code, ...rest] = line.split(",");
      return { keyword: keyword.trim().toLowerCase(), code: code.trim(), display: rest.join(",").trim() };
    });
  } catch {
    lookupCache = [];
  }
  return lookupCache;
}

export async function lookupIcd10(diagnosisText: string): Promise<Icd10Result | null> {
  const table = await loadLookup();
  const lower = diagnosisText.toLowerCase();
  // Longest keyword wins first — "atherosclerotic heart" should match before
  // a shorter, more generic entry also present in the text.
  const sorted = [...table].sort((a, b) => b.keyword.length - a.keyword.length);
  const hit = sorted.find((row) => lower.includes(row.keyword));
  if (!hit) return null;
  return { code: hit.code, display: hit.display, source: "lookup", verified: true };
}

let whoBaseCache: Array<{ code: string; display: string }> | null = null;

// data/icd10_who_full.csv rows are always `CODE,"display text"` (written
// that way by scripts/fetch_who_icd10.mjs) — a plain split(",") would break
// on displays containing a comma (e.g. "Pregnancy, childbirth..."), so this
// only trusts the quoted-second-field shape rather than doing general CSV.
function parseWhoFullLine(line: string): { code: string; display: string } | null {
  const m = line.match(/^([^,]+),"((?:[^"]|"")*)"$/);
  if (!m) return null;
  return { code: m[1].trim(), display: m[2].replace(/""/g, '"').trim() };
}

// The bulk crawled file (10,673 rows) — cached in memory, never mutated.
// Admin add/edit/delete goes through db/icd10_overrides.json instead (see
// src/lib/icd10Catalog.ts + the /backend-admin/icd10 screen), so a bad edit
// can never corrupt the actual WHO import.
async function loadWhoBase() {
  if (whoBaseCache) return whoBaseCache;
  try {
    const raw = await readFile(WHO_FULL_FILE, "utf8");
    const lines = raw.split("\n").slice(1).filter((l) => l.trim());
    whoBaseCache = lines.map(parseWhoFullLine).filter((r): r is { code: string; display: string } => r !== null);
  } catch {
    whoBaseCache = [];
  }
  return whoBaseCache;
}

// Base WHO catalog with admin overrides layered on top — upserts
// added/replace entries, deletions hide them. Overrides are re-read fresh
// every call (the file is tiny) so an admin edit takes effect immediately,
// no cache to invalidate.
async function loadWhoFull(): Promise<Array<{ code: string; display: string }>> {
  const base = await loadWhoBase();
  const overrides = await readIcd10Overrides();
  const deleted = new Set(overrides.deleted.map((c) => c.toUpperCase()));
  const merged = base.filter((row) => !deleted.has(row.code.toUpperCase()));
  for (const [code, display] of Object.entries(overrides.upserts)) {
    const idx = merged.findIndex((r) => r.code.toUpperCase() === code.toUpperCase());
    if (idx >= 0) merged[idx] = { code, display };
    else merged.push({ code, display });
  }
  return merged;
}

// For the backend-admin ICD-10 catalog screen — is this code part of the
// original WHO crawl, or purely an admin addition? Determines whether
// "delete" should offer a "restore to WHO's original wording" affordance.
export async function findBaseWhoCode(code: string): Promise<{ code: string; display: string } | null> {
  const table = await loadWhoBase();
  const trimmed = code.trim().toUpperCase();
  return table.find((r) => r.code.toUpperCase() === trimmed) ?? null;
}

// Live type-ahead for the NHCX review screen's edit form — a MEDCO typing
// "diabetes" or a partial code gets a short list of real WHO ICD-10 matches
// to pick from. Fully local (the WHO catalog is on disk), so no network
// round-trip and no risk of ever surfacing a wrong-country code.
export async function searchWhoIcd10Suggestions(
  text: string,
  limit = 8,
): Promise<Array<{ code: string; display: string }>> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return [];
  const table = await loadWhoFull();
  const queryWords = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const codeQuery = trimmed.toUpperCase();

  const scored = table
    .map((row) => {
      const text = row.display.toLowerCase();
      const matchedWords = queryWords.filter((w) => text.includes(w)).length;
      const codeMatch = row.code.toUpperCase().startsWith(codeQuery) ? 5 : 0;
      const wordCount = text.split(/\s+/).length;
      return { code: row.code, display: row.display, score: matchedWords * 10 + codeMatch, wordCount };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.wordCount - b.wordCount);

  return scored.slice(0, limit).map(({ code, display }) => ({ code, display }));
}

type LlmGuess = { icd10_code?: string; icd10_display?: string } | null;

function runLlmLookup(diagnosisText: string): Promise<LlmGuess> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [LLM_SCRIPT, diagnosisText], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
        resolve(parsed.icd10_code ? parsed : null);
      } catch {
        resolve(null);
      }
    });
  });
}

// llmLookup is injectable so tests can exercise the "nothing matched, fall
// back to LLM" branch deterministically without spawning a real process or
// hitting Sarvam's API.
export async function resolveIcd10(
  diagnosisText: string,
  llmLookup: (text: string) => Promise<LlmGuess> = runLlmLookup,
): Promise<Icd10Result | null> {
  const trimmed = (diagnosisText ?? "").trim();
  if (!trimmed) return null;

  const embedded = parseEmbeddedIcd10(trimmed);
  if (embedded) return embedded;

  const looked = await lookupIcd10(trimmed);
  if (looked) return looked;

  const llm = await llmLookup(trimmed);
  if (llm?.icd10_code) {
    return {
      code: llm.icd10_code,
      display: llm.icd10_display || trimmed,
      source: "llm",
      verified: false,
    };
  }
  return null;
}

// Resolves the FULL list of diagnosis codes for a case — a real claim can
// carry more than one (a primary cancer diagnosis plus a comorbidity, say).
// When a human has added/edited entries via the NHCX review screen
// (case.icd10_codes_override), that list is the whole truth and completely
// replaces the single auto-guess — including an explicit empty array, which
// means "reviewed, deliberately zero codes" rather than "not looked at yet".
export async function resolveIcd10Codes(
  diagnosisText: string,
  override: Array<{ code: string; display: string }> | undefined,
): Promise<Icd10Result[]> {
  if (override) {
    return override
      .filter((e) => e.code.trim())
      .map((e) => manualIcd10(e.code.trim(), e.display.trim() || e.code.trim()));
  }
  const guess = await resolveIcd10(diagnosisText);
  return guess ? [guess] : [];
}

// Reverse lookup for the "type a code you already know, auto-fill its
// description" button on the NHCX review screen's edit form — curated CSV
// first (free, matches by code not keyword), then the full WHO ICD-10
// catalog (also local, also free, ~10,700x more coverage), Sarvam as the
// last resort for anything not in WHO's own list at all.
export async function lookupDisplayForCode(code: string): Promise<string | null> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;

  const table = await loadLookup();
  const hit = table.find((row) => row.code.toUpperCase() === trimmed);
  if (hit) return hit.display;

  const whoTable = await loadWhoFull();
  const whoHit = whoTable.find((row) => row.code.toUpperCase() === trimmed);
  if (whoHit) return whoHit.display;

  return new Promise((resolve) => {
    const child = spawn(PYTHON, [LLM_SCRIPT, "--describe", trimmed], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
        resolve(parsed.icd10_display || null);
      } catch {
        resolve(null);
      }
    });
  });
}
