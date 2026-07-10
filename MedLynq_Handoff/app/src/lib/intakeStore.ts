"use client";

// Module-level store for the Document Intake page. Lives outside the React
// component tree so it survives client-side (Next Link) navigation away from
// /intake and back — a plain useState in page.tsx gets wiped every time the
// page component unmounts on route change. Only a hard reload / closed tab
// resets this.

import { useSyncExternalStore } from "react";

export type DetectedFile = {
  filename: string;
  doc_type: string;
  hints: { mrn?: string; name?: string; age?: number; gender?: string };
  needs_ocr: boolean;
  ext: string;
  sarvam_done?: boolean;
  preview?: string;
};

export type DetectedGroup = {
  identity: { mrn?: string; name?: string; age?: number; gender?: string; mrnConflict?: boolean; altMrn?: string };
  files: DetectedFile[];
};

export type DetectResult = {
  ok: true;
  total_files: number;
  detected_patient_count: number;
  groups: DetectedGroup[];
  unassigned: DetectedFile[];
  stats: { pdfs_with_identity: number; pdfs_needing_ocr: number; images_needing_ocr: number; sarvam_processed_now?: number; visual_only_skipped?: number };
};

export type CommitStatus = "idle" | "burning" | "sarvam" | "routing" | "done" | "error";

export type CommittedGroup = {
  group_idx: number;
  patient_name: string;
  status: CommitStatus;
  detail?: string;
  patient_href?: string;
  burned_count?: number;
  sarvam_files?: number;
  needs_ocr?: boolean;
};

export type IntakeState = {
  busy: boolean;
  progress: { done: number; total: number } | null;
  detected: DetectResult | null;
  editableGroups: DetectedGroup[];
  manualGroups: DetectedGroup[];
  unassignedTargets: Record<string, number | null>;
  selectedUnassigned: Set<string>;
  commit: CommittedGroup[] | null;
  rawFiles: File[];
  error: string | null;
  // Display-only rename overrides, keyed by the original filename — never
  // touches the underlying File object or backend doc_type, just what's
  // shown in the review UI so a badly-OCR'd or generic filename can be
  // fixed by eye before confirming.
  filenameOverrides: Record<string, string>;
};

const initialState: IntakeState = {
  busy: false,
  progress: null,
  detected: null,
  editableGroups: [],
  manualGroups: [],
  unassignedTargets: {},
  selectedUnassigned: new Set(),
  commit: null,
  rawFiles: [],
  error: null,
  filenameOverrides: {},
};

let state: IntakeState = initialState;
const listeners = new Set<() => void>();

export function setIntakeState(
  patch: Partial<IntakeState> | ((s: IntakeState) => Partial<IntakeState>)
) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function getIntakeState(): IntakeState {
  return state;
}

export function resetIntakeState() {
  state = { ...initialState, selectedUnassigned: new Set(), unassignedTargets: {} };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useIntakeState(): IntakeState {
  return useSyncExternalStore(subscribe, getIntakeState, getIntakeState);
}
