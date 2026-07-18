// Global API/integration settings — the credentials MedLynq calls out with
// (Sarvam AI, the NHCX gateway). Owner-editable from Backend Admin instead of
// hand-editing .env.local. Stored at db/api_settings.json; any field left
// blank here falls back to its .env.local default, so this file only needs
// to hold the values someone actually wants to override at runtime.
//
// Read by: src/app/api/nhcx/send/route.ts + src/app/api/nhcx/mock/route.ts
// (TS side) and python/api_settings.py (Python side, for Sarvam calls) —
// keep both readers in sync with this shape if it changes.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export type ApiSettings = {
  sarvam_api_key?: string;
  sarvam_chat_model?: string;
  sarvam_doc_lang?: string;
  sarvam_doc_format?: string;
  nhcx_endpoint?: string;
  nhcx_internal_secret?: string;
};

const SETTINGS_FILE = path.resolve(process.cwd(), "db", "api_settings.json");

const SECRET_FIELDS = new Set<keyof ApiSettings>(["sarvam_api_key", "nhcx_internal_secret"]);

export async function readApiSettings(): Promise<ApiSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(raw) as ApiSettings;
  } catch {
    return {};
  }
}

export async function writeApiSettings(patch: ApiSettings): Promise<ApiSettings> {
  const existing = await readApiSettings();
  // Blank string in the patch means "leave the existing value alone" (the UI
  // never re-displays a saved secret, so it can't send back what it can't
  // see) — only a genuinely provided non-empty value overwrites.
  const next: ApiSettings = { ...existing };
  for (const [k, v] of Object.entries(patch) as [keyof ApiSettings, string | undefined][]) {
    if (v !== undefined && v.trim() !== "") next[k] = v.trim();
  }
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// Masked view for the settings UI — never sends a real secret back to the
// browser once saved, only whether it's configured and its last 4 chars so
// an admin can sanity-check "is this the key I think it is" without seeing
// the whole thing.
export function maskForDisplay(settings: ApiSettings) {
  const out: Record<string, { configured: boolean; hint?: string; value?: string }> = {};
  for (const key of Object.keys(settings) as (keyof ApiSettings)[]) {
    const v = settings[key];
    if (!v) continue;
    if (SECRET_FIELDS.has(key)) {
      out[key] = { configured: true, hint: v.length > 4 ? `••••${v.slice(-4)}` : "••••" };
    } else {
      out[key] = { configured: true, value: v };
    }
  }
  return out;
}

// Server-side resolution: settings-store value wins, else the env default.
// Only for TS callers — Python has its own copy in python/api_settings.py
// (a Python process can't import this TS module).
export async function resolveApiSetting(key: keyof ApiSettings, envDefault: string): Promise<string> {
  const settings = await readApiSettings();
  return settings[key] || envDefault;
}
