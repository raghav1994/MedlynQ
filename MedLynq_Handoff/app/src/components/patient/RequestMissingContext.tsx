"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Ctx = {
  active: boolean;
  selected: Set<string>;
  sending: boolean;
  refreshToken: number;
  activate: () => void;
  cancel: () => void;
  toggle: (docType: string) => void;
  send: () => Promise<void>;
};

const RequestMissingCtx = createContext<Ctx | null>(null);

export function useRequestMissing() {
  const ctx = useContext(RequestMissingCtx);
  if (!ctx) throw new Error("useRequestMissing must be used within RequestMissingProvider");
  return ctx;
}

// Shared between ActionButtons (sidebar "Request Missing Doc" button) and
// DocumentChecklist (the checklist tiles a MEDCO picks from) — they're
// siblings under the same server-rendered patient page, so the selection
// state has to live above both of them.
export function RequestMissingProvider({
  patientId, caseId, children,
}: { patientId: string; caseId: string; children: ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const activate = useCallback(() => { setActive(true); setSelected(new Set()); }, []);
  const cancel = useCallback(() => { setActive(false); setSelected(new Set()); }, []);
  const toggle = useCallback((docType: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(docType)) next.delete(docType); else next.add(docType);
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    try {
      await Promise.all(Array.from(selected).map((docType) =>
        fetch("/api/document-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_id: patientId, case_id: caseId, doc_type: docType, note: "" }),
        })
      ));
      setActive(false);
      setSelected(new Set());
      setRefreshToken((t) => t + 1);
      router.refresh();
    } finally {
      setSending(false);
    }
  }, [selected, sending, patientId, caseId, router]);

  return (
    <RequestMissingCtx.Provider value={{ active, selected, sending, refreshToken, activate, cancel, toggle, send }}>
      {children}
    </RequestMissingCtx.Provider>
  );
}
