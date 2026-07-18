// Real, timestamped, actor-attributed event log for dashboard widgets
// (Scoreboard / Activity Stream / Yesterday's Wins) that need "who did what
// when" — the two existing audit systems don't cover this: the JSONL redact
// audit log has no actor field, and the doc-routing audit JSON only covers
// doc_applied/doc_undone/doc_routed/patient_renamed, not queries or claims.
//
// Same additive JSON-file pattern as db/patient_overrides.json — append-only,
// read-merge-write, no external DB needed for an MVP-scale event volume.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const EVENTS_FILE = path.resolve(process.cwd(), "db", "events.json");

export type EventKind = "query_resolved" | "claim_approved" | "claim_rejected" | "query_raised";

export type AppEvent = {
  id: string;
  ts: string; // ISO
  kind: EventKind;
  actor_id?: string;
  actor_name?: string;
  hospital_id?: string;
  case_id?: string;
  patient_id?: string;
  amount?: number;
  minutes_to_resolve?: number;
  text: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

function readAll(): AppEvent[] {
  try {
    return JSON.parse(readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(events: AppEvent[]) {
  mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

export function appendEvent(e: Omit<AppEvent, "id" | "ts">): AppEvent {
  const full: AppEvent = { ...e, id: randomUUID(), ts: new Date().toISOString() };
  const events = readAll();
  events.push(full);
  // Keep the file bounded — dashboard only ever needs recent history.
  const trimmed = events.slice(-2000);
  writeAll(trimmed);
  return full;
}

export function readEvents(hospital_id?: string): AppEvent[] {
  if (!existsSync(EVENTS_FILE)) return [];
  const events = readAll();
  const scoped = hospital_id ? events.filter((e) => e.hospital_id === hospital_id) : events;
  return scoped.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
}

export function eventsInRange(events: AppEvent[], startISO: string, endISO: string): AppEvent[] {
  return events.filter((e) => e.ts >= startISO && e.ts < endISO);
}

// [start, end) window for "yesterday" in local server time.
export function yesterdayRange(): { start: string; end: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  return { start: startOfYesterday.toISOString(), end: startOfToday.toISOString() };
}

export function todayRange(): { start: string; end: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  return { start: startOfToday.toISOString(), end: startOfTomorrow.toISOString() };
}

// Local calendar-day key (not UTC) — e.ts is a UTC instant, but "same day"
// has to be judged in server-local wall-clock time or a day boundary near
// midnight UTC (common for IST, UTC+5:30) puts an event's UTC date one day
// off from the local date the range functions above bucket it into.
function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Consecutive-day streak (including today if it has an event) walking
// backward from today, for one actor.
export function computeStreakDays(actorEvents: AppEvent[]): number {
  if (actorEvents.length === 0) return 0;
  const days = new Set(actorEvents.map((e) => localDayKey(e.ts)));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const cursorKey = () => `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
  // If nothing happened today yet, the streak still counts through yesterday.
  if (!days.has(cursorKey())) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(cursorKey())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
