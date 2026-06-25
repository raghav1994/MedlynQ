# MedLynq — Handoff Prompt for Claude Code

> **READ THIS FIRST.** Paste this entire file into Claude Code (or open it in Claude Code) as the very first message. It tells you exactly what MedLynq is, what's built, where to look, and what to do next — without you having to re-explore the codebase from scratch.

---

## 1. What MedLynq is

MedLynq is an **AI-driven claims intelligence platform** for Indian government health insurance schemes — **PM-JAY / Ayushman, CGHS, SHA, Railway UMID, ECHS** — focused on **oncology workflows** (chemo, surgery, radiation).

**Real user:** A medical co-ordinator (MEDCO) at a hospital who processes claim paperwork between hospital staff and payer portals. Today they juggle 20+ docs per claim, copy MRN/amounts by hand, miss the 15-day query response window, and lose lakhs to rejected claims. MedLynq does the OCR, doc-type classification, query-deadline tracking, and "is this claim query-proof?" check for them.

**Hard rules (DO NOT VIOLATE):**
- **All sensitive data stays local on the user's machine.** Only burned/redacted copies of docs are allowed to leave for cloud OCR.
- **Sarvam Vision is the only approved cloud call.** API key lives in `app/.env.local` (gitignored). Never echo it to chat. Never commit it.
- **DPDP / privacy first.** Aadhaar, PAN, phone, DOB, faces, signatures → burned with OpenCV black rectangles BEFORE any cloud call.
- **Practo scraping is forbidden** (ToS violation). Drug Master uses local corpus + OpenFDA only.
- **Be terse.** The owner pays per-response. Short answers. Ask before doing anything that isn't a small contained edit.

---

## 2. Tech stack (already installed)

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind. Lives in `app/`.
- **Python sidecar:** PyMuPDF, Pillow, PaddleOCR, OpenCV, requests, python-dotenv. Lives in `app/python/`. Invoked from Next.js API routes via `child_process.spawn`.
- **OCR:** Sarvam Vision (cloud, redacted docs only) + PaddleOCR (local, for PII detection + redaction). **No Tesseract.** **No Surya** (VRAM too high).
- **Data:** Local CSVs + mock TS modules today. Supabase planned but NOT wired yet.
- **Browser extension (separate):** `pmjay_jumper/` — Chrome MV3 extension that skips PMJAY portal pagination clicks. Already working.

---

## 3. Directory map (the things that matter)

```
MedLynq/
├── app/                              ← Next.js app (the product)
│   ├── src/
│   │   ├── app/                      ← Next.js routes (App Router)
│   │   │   ├── page.tsx              ← Dashboard (morning view + Lynq nudges)
│   │   │   ├── patients/page.tsx     ← Patient List table
│   │   │   ├── patient/[id]/page.tsx ← Patient Detail (Visily pg-7 layout)
│   │   │   ├── intake/page.tsx       ← Document Intake (upload)
│   │   │   └── queries|reports|audit|admin/page.tsx ← Coming-soon stubs
│   │   ├── components/
│   │   │   ├── AppShell.tsx, LynqNudges.tsx, ComingSoon.tsx, …
│   │   │   └── patient/
│   │   │       ├── PatientHeader, PatientIdentity, ClinicalVitals
│   │   │       ├── CaseTimeline, ActionButtons, Tabs
│   │   │       ├── DocumentsGrid, DocumentTile, ChecklistValidation
│   │   │       ├── FinancialsTab, QueryBoard, QueryTimeline
│   │   │       ├── DeadlineCountdown    ← D-5 (15-day post-op HPE countdown)
│   │   │       ├── CaseSynopsis         ← D-6 (case-level paragraph + chips)
│   │   │       ├── DocSynopsis          ← D-6 (per-doc fields + suggests)
│   │   │       └── QueryProofBadge      ← D-6 (0–100% safe-to-submit score)
│   │   └── lib/
│   │       ├── types.ts, mockData.ts, mockDocuments.ts
│   │       ├── checklist.ts           ← stage+treatment aware required-doc rules
│   │       ├── mockQueries.ts         ← multi-round query history + deadlines
│   │       ├── synopsis.ts            ← mock synopsis data (replace w/ extracted JSON)
│   │       ├── queryProof.ts          ← scoring heuristics → QueryProofScore
│   │       └── risk.ts
│   ├── python/                       ← Sidecar OCR + redaction pipeline
│   │   ├── compressor.py             ← PDF + image compression (existing)
│   │   ├── extractor.py              ← Rule-based classifier (95.2% on corpus)
│   │   ├── merger.py                 ← PDF merging helper
│   │   ├── redact.py                 ← NEW: PaddleOCR detect → OpenCV burn PII
│   │   ├── sarvam_vision.py          ← NEW: Sarvam Vision API client
│   │   ├── synopsis_schemas.py       ← NEW: per-doc-type field schemas
│   │   ├── pipeline.py               ← NEW: end-to-end orchestrator
│   │   └── requirements.txt
│   ├── public/, db/, node_modules/, package.json, tailwind.config.ts
│   └── .env.local                    ← API keys (gitignored, DO NOT commit)
│
├── PatientLog/
│   └── Approved/corpus/
│       ├── master_cases.csv           (488 rows)
│       ├── master_queries.csv         (1,625 rows — training set for classifier)
│       ├── master_patients.csv        (209 patients)
│       ├── master_documents.csv       (6,565 docs)
│       ├── master_documents_classified.csv  (with doc_type + confidence)
│       ├── master_summary.txt
│       └── batch_01..39/case_XX/...   ← real anonymized PMJAY-extracted docs
│
├── Indian Medicine database/
│   └── A_Z_medicines_dataset_of_India.csv  (254k rows; 704 oncology hits)
│
├── pmjay_jumper/                     ← Chrome MV3 extension (separate concern)
│
├── Paddle_OCR_Local/PaddleOCR-main/  ← reference Paddle source (not used at runtime)
│
├── 01_architecture.svg … 09_mvp_scope.svg  ← strategy diagrams
├── medlynq_full_vision_v3.svg, medlynq_workflow_v3.svg
├── HANDOFF_FOR_CLAUDE.md             ← this file
└── HANDOFF_FOR_DEV.md                ← human-readable companion
```

---

## 4. The pipeline (server-side, runs on each upload)

```
raw upload → compressor.compress_*()              → app/PatientLog/{MRN}/originals/
                            ↓
              extractor.classify_doc(filename, text)  → {doc_type, confidence, source}
                            ↓
              fitz rasterize page 1 (200 DPI)         → .../redacted/{stem}_p1.png
                            ↓
              redact.redact_image()                    → .../redacted/{stem}_redacted.png
              (PaddleOCR detects: Aadhaar 12-digit, PAN, 10-digit phone,
               DOB lines, address blocks, Haar-cascade faces;
               OpenCV cv2.rectangle(..., (0,0,0), -1) burns solid black)
                            ↓
              sarvam_vision.extract(redacted_png, doc_type_slug)
              (POST to api.sarvam.ai/v1/vision/extract with Bearer key)
                            ↓
              synopsis_schemas.normalize(doc_type, sarvam_json)
                            ↓
              cross-check classifier vs Sarvam doc_type → confidence boost or flag
                            ↓
              rename → MRN_snake_doc_type_YYYYMMDD.ext (moves in originals/)
                            ↓
              save extracted/{rename}.json (the manifest, used by UI)
```

**Two-track storage rule:**
- `originals/` → compressed full doc with Aadhaar etc. intact. **Clerk sees this. Uploaded to payer portal manually.**
- `redacted/` → burned copy. **Only thing Sarvam ever sees.** Kept for 30-day audit then auto-purge (not yet implemented).
- `extracted/` → Sarvam JSON manifest → drives the UI synopsis boxes + query-proof score.

**Doc types that NEVER leave the machine** (hard-coded in `pipeline.LOCAL_ONLY_DOC_TYPES`): Patient ID Proof, Aadhaar Card, PAN Card, Voter ID, Ration Card, Ayushman Card, Family ID, Health Card. These skip Sarvam entirely.

---

## 5. Build chunks completed (chronological)

| Chunk | What landed |
|---|---|
| D-1..D-3 | Next.js app scaffold, dashboard, patient list, patient detail (Visily pg-7 layout), document intake, ComingSoon stubs for queries/reports/audit/admin |
| D-3 | Python sidecar: compressor + extractor. Auto-rename to `{MRN}_{snake_doc_type}_{YYYYMMDD}.ext` |
| D-4 | Rule-based classifier trained on real 6,565-doc corpus → **95.2% hit rate**. CLASSIFIER_RULES list with ~30 doc types including oncology-specific (Tumor Board Cert, Beneficiary Verification Slip, PET-CT, Chemo Chart, Discharge Photo). Whole-token match for ≤3-char keywords; MRN-heuristic fallback. |
| D-4 | Stage-aware (pre_auth / mid_way / discharge) + treatment-aware (chemo / surgery / radiation / medicine) checklist engine in `lib/checklist.ts` |
| D-5 | **Query Board v2** with multi-round history + **15-day deadline countdown** for post-op HPE queries triggered by query raise date (NOT discharge — the doc only arrives 7-10 days after lab processing). Dashboard tile + Lynq nudge. |
| D-6 | **OCR + redaction pipeline** (`redact.py`, `sarvam_vision.py`, `synopsis_schemas.py`, `pipeline.py`). **Two-track storage.** UI: `CaseSynopsis` (top of patient main panel) + `DocSynopsis` (per-doc) + `QueryProofBadge` (left sidebar, 0-100% safe-to-submit score with issue list). |

---

## 6. What is mock vs real today

| Subsystem | Status |
|---|---|
| Patient list, cases, mock docs | **Mock** in `mockData.ts`, `mockDocuments.ts` |
| Query rounds + deadlines | **Mock** in `mockQueries.ts` (Vikram Day 14/15, Mohan Day 8/15, Rajkumari Day 4/15) |
| Doc & case synopsis | **Mock** in `lib/synopsis.ts`. Pipeline output (`PatientLog/{MRN}/extracted/*.json`) is intended to populate this. NOT YET WIRED. |
| Classifier rules | **Real** — trained on real corpus, runs in production |
| Compression + rasterization | **Real** |
| Redaction (Paddle+OpenCV) | **Real code, not yet exercised end-to-end** — needs Paddle install + a smoke test on a corpus sample |
| Sarvam Vision call | **Real code, not yet exercised** — needs `.env.local` + first live call |
| Drug Master | **Not built yet.** `Indian Medicine database/A_Z_medicines_dataset_of_India.csv` is the source. Plan: corpus drug names + OpenFDA → `drug_master.csv` with rapidfuzz fuzzy match. |
| Supabase | **Not wired.** Everything is in-memory mock data. |

---

## 7. How to verify the app works on your machine

```bash
cd app
npm install
npm run dev
# open http://localhost:3000
```

**Smoke check pages:**
- `/` — Dashboard with 6 action tiles (incl. "Post-op HPE queries"), Lynq nudges card, work queue
- `/patients` — Patient list table
- `/patient/P0008?case=2026051410041450` — Vikram Singh, the canonical demo case. Should show: case synopsis box, QueryProofBadge 83% MOSTLY READY, Query Board with Round 3 showing red "1d left" countdown
- `/patient/P0011?case=2026051810066828` — Mohan Lal, 8d into 15-day countdown (amber)
- `/intake` — Document upload

**Python sidecar smoke test** (once Paddle is installed):
```bash
cd app
pip install -r python/requirements.txt
python python/pipeline.py "<path/to/any/PDF>" "TEST_MRN" "../PatientLog"
# Should output a manifest JSON to stdout and create:
#   ../PatientLog/TEST_MRN/originals/<renamed>.pdf
#   ../PatientLog/TEST_MRN/redacted/<stem>_redacted.png
#   ../PatientLog/TEST_MRN/extracted/<renamed>.pdf.json
```
If Sarvam fails (no key, no internet), the manifest will still be produced — Sarvam fields will be empty and `flags: ["sarvam_failed"]` will be set. That's intentional: the local part must work standalone.

---

## 8. What to build next (queue, in priority order)

The owner has agreed to these but not yet committed which to start. Ask before starting.

1. **Wire pipeline output to UI** — replace `lib/synopsis.ts` mock with file-read of `PatientLog/{MRN}/extracted/*.json`. This is the highest-leverage next step because everything else (Drug Master, scoring) gets more accurate once real Sarvam data flows.
2. **Drug Master build** — `tools/build_drug_master.py` that ingests `Indian Medicine database/*.csv` + corpus drug mentions + OpenFDA → emit `drug_master.csv` with brand→generic, oncology flag, MRP band. Add rapidfuzz matcher in `lib/drugs.ts`.
3. **Per-doc synopsis on hover** — wire `synopsisFor(filename)` into `DocumentTile` so hover shows the `DocSynopsis` card.
4. **Backend Panel + OPD Registration screens** — front desk → panel verification → OPD doctor consult capture. New routes `/backend`, `/opd`.
5. **Real Batch_01 thumbnails** — replace mock PDF icons with actual page-1 thumbnails of `PatientLog/Approved/corpus/batch_01/case_XX/*.pdf`.
6. **Supabase hookup** — schema in `db/`. Move mockData → Postgres. Keep mock as seed.
7. **30-day auto-purge** of `redacted/` folders. Cron or scheduled task.
8. **Agentic OCR fallback** for low-confidence Sarvam responses (planned: DeepSeek V3.2 vs Claude Sonnet vs Haiku 4.5 — bake-off pending, NOT decided yet).

---

## 9. Conventions / gotchas the owner cares about

- **Renames are deterministic:** `{MRN}_{snake_doc_type}_{YYYYMMDD}.{ext}`. Clerk only sees the renamed compressed original. The Sarvam JSON is the source of truth for `doc_type` confidence and `doc_date`.
- **Classifier confidence ≥0.90 = auto-lock rename. <0.90 = flag for clerk review.** Sarvam agreement bumps confidence +0.3.
- **Stage transitions:** `preauth_pending → pending → query → responded → submitted → discharged → settled`. `stageOf(status)` in `types.ts` maps these to `pre_auth | mid_way | discharge`.
- **Treatment types:** `chemo | surgery | radiation | medicine` — drives which docs are "required" in the checklist.
- **Query types:** `missing_doc | code_mismatch | clinical_elab | date_inconsist | post_op_hpe`. Only `post_op_hpe` currently has the 15-day deadline UI but the data model supports any deadline.
- **Windows-specific:** Owner's machine. Python invoked with `PYTHONIOENCODING=utf-8 python3 -X utf8` to avoid cp1252 crashes on `→` arrows in console output.
- **Chrome extension lives in `pmjay_jumper/`** — uses `world: "MAIN"` content_script at `document_start` and `CustomEvent` on `document` for cross-world messaging (Brave-compatible). Don't touch unless asked.
- **"ultrareview"** is the user-triggered cloud review command — you cannot launch it yourself.

---

## 10. Where to go for fuller context (if owner asks)

- Strategy diagrams: `01_architecture.svg`, `05_ai_architecture.svg`, `09_mvp_scope.svg`
- Vision deck: `MedOverwatch_Integrated_Blueprint_v2.docx`
- Wireframes: `03_wireframes.svg`, `visily-multiscreens.pdf`
- Real query corpus (1,625 rows of payer queries): `PatientLog/Approved/corpus/master_queries.csv`

When in doubt, **ask the owner before changing things**. They pay per response. Default to terse confirmations and small contained edits.

---

## 11. First thing to say to the owner

> "I've read the handoff. App is at D-6 (OCR pipeline + case synopsis + query-proof score). What chunk should I pick up — wire-pipeline-to-UI, Drug Master, or something else?"
