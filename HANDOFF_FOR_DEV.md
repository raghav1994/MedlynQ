# MedLynq — Developer Handoff

This document is for the human developer picking up the project. The matching `HANDOFF_FOR_CLAUDE.md` is for AI assistants. Read both.

---

## 1. What you're inheriting

MedLynq is a **claims intelligence dashboard for Indian government health insurance** (PM-JAY, CGHS, SHA, Railway UMID, ECHS), focused on **oncology** (chemo, surgery, radiation). The user is a hospital MEDCO (medical co-ordinator) who processes 20+ docs per claim between hospital staff and payer portals.

The product's job: **OCR + redact + classify + auto-rename hospital docs, track 15-day query deadlines, and score how query-proof a claim is before submission.**

Built so far: **D-1 through D-6**, end-to-end demo-able on mock data, OCR pipeline scaffolded but not yet exercised live.

---

## 2. Project layout (TL;DR)

```
MedLynq/
├── app/                ← the Next.js product (this is where you'll live 90%)
│   ├── src/app/        ← Next.js App Router pages
│   ├── src/components/ ← React components (most under patient/)
│   ├── src/lib/        ← TS data + business logic (mocks today)
│   ├── python/         ← OCR sidecar (PaddleOCR + OpenCV + Sarvam)
│   ├── public/, db/
│   └── .env.local      ← API keys (DO NOT commit, DO NOT share)
├── PatientLog/Approved/corpus/  ← real anonymized hospital docs (6,565 files)
├── Indian Medicine database/    ← drug CSV (254k rows)
├── pmjay_jumper/                ← Chrome extension (separate concern)
├── Paddle_OCR_Local/            ← reference download (not used at runtime)
└── *.svg, *.docx, *.pdf         ← strategy / wireframe references
```

---

## 3. Quick start

### 3.1 Next.js app
```bash
cd app
npm install
npm run dev
# open http://localhost:3000
```

### 3.2 Python sidecar (for OCR pipeline)
```bash
cd app
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r python/requirements.txt
```

This pulls **PaddleOCR, PaddlePaddle, OpenCV, PyMuPDF, Pillow, requests, python-dotenv**. PaddlePaddle download is ~300 MB — first run is slow.

### 3.3 API keys
Create `app/.env.local` (already gitignored):
```env
SARVAM_API_KEY=<get from owner — DO NOT commit>
SARVAM_VISION_ENDPOINT=https://api.sarvam.ai/v1/vision/extract
```

### 3.4 Smoke test the pipeline
```bash
cd app
python python/pipeline.py "../PatientLog/Approved/corpus/batch_01/case_01/<any-pdf>" "TEST_MRN" "../PatientLog"
```
Output: a JSON manifest to stdout, plus files under `PatientLog/TEST_MRN/{originals,redacted,extracted}/`.

---

## 4. What's built (chunk-by-chunk)

| Chunk | Delivered |
|---|---|
| **D-1** | Project scaffold, Tailwind theme (ink/bone/accent/good/warn/bad), AppShell, navigation, ComingSoon stubs |
| **D-2** | Dashboard (morning view), Patient List, Patient Detail (Visily page-7 layout), Document Intake |
| **D-3** | Python sidecar: compressor (PyMuPDF + Pillow), rule-based classifier, auto-rename `{MRN}_{snake_doc_type}_{YYYYMMDD}.ext` |
| **D-4** | Classifier trained on real 6,565-doc corpus → **95.2% hit rate**. Stage-aware + treatment-aware checklist engine. |
| **D-5** | Query Board v2 — multi-round query history + 15-day deadline countdown for post-op HPE queries. Dashboard tile + Lynq nudge. `DeadlineCountdown` component (green > 7d, amber 4-7d, red ≤3d, pulsing red OVERDUE). |
| **D-6** | **OCR + redaction pipeline** (Paddle + OpenCV + Sarvam). **Two-track storage** (originals/ for clerk, redacted/ for cloud). **CaseSynopsis** box (case-level paragraph + diagnosis/stage/alignment pills + drug & procedure chips). **DocSynopsis** box (per-doc fields). **QueryProofBadge** (0-100% safe-to-submit score with issue list). |

### Demo cases to look at
- **Vikram Singh** — `/patient/P0008?case=2026051410041450` — canonical happy-path demo, Round 3 post-op HPE query at Day 14/15 (1 day left).
- **Mohan Lal** — `/patient/P0011?case=2026051810066828` — Day 8/15 (amber).
- **Rajkumari** — Day 4/15 consent query.

---

## 5. The OCR pipeline (read this carefully)

The single hardest design decision in MedLynq is **DPDP compliance**. The pipeline enforces it.

### Flow per upload
1. **Compress original** → `PatientLog/{MRN}/originals/` (clerk sees this, uploads to payer portal manually).
2. **Classify** doc_type via filename + first-page text (the 95.2% classifier).
3. **Rasterize page 1** to PNG at 200 DPI.
4. **PaddleOCR** detects bounding boxes for: Aadhaar (12-digit regex), PAN, 10-digit phone, DOB lines, address blocks (after S/o, D/o, W/o), faces (Haar cascade).
5. **OpenCV burns** solid black rectangles over those boxes → `redacted/{stem}_redacted.png`. **Irreversible.**
6. **Sarvam Vision** receives ONLY the redacted PNG. Returns structured JSON.
7. **Normalize** to a per-doc-type schema (HPE, Discharge, Bill, Chemo Chart, OT Notes, Lab, Patient ID, generic).
8. **Cross-check** classifier vs Sarvam doc_type → bump confidence or flag mismatch.
9. **Rename + save** manifest JSON to `extracted/`.

### Storage layout (per patient)
```
PatientLog/{MRN}/
├── originals/   ← compressed full docs (clerk-facing, never to cloud)
├── redacted/    ← burned copies (only thing Sarvam sees, 30-day retention)
└── extracted/   ← Sarvam JSON manifests (drives UI synopsis boxes)
```

### Doc types that bypass Sarvam entirely
Patient ID, Aadhaar, PAN, Voter ID, Ration, Ayushman, Family ID, Health Card. Hard-coded in `pipeline.LOCAL_ONLY_DOC_TYPES`.

### Files involved
| File | Job |
|---|---|
| `app/python/compressor.py` | PDF + image compression (existing) |
| `app/python/extractor.py` | Rule-based classifier `classify_doc(filename, text)` |
| `app/python/redact.py` | Paddle detect + OpenCV burn → JSON log |
| `app/python/sarvam_vision.py` | Sarvam API client, reads key from `.env.local` |
| `app/python/synopsis_schemas.py` | Per-doc-type field schemas + normalize() |
| `app/python/pipeline.py` | End-to-end orchestrator |

---

## 6. UI components map (the ones that matter)

```
src/app/patient/[id]/page.tsx
├── PatientHeader (top — name, reg ID, scheme, payment)
├── Aside (left column)
│   ├── PatientIdentity   (name, MRN, DOB, hospital)
│   ├── ClinicalVitals    (temp, pulse, height, weight)
│   ├── ActionButtons     (Request Missing, Mark Reviewed, Add Entry)
│   ├── QueryProofBadge   ← D-6 score 0-100% + issue list
│   └── CaseTimeline      (TAT, stage progress)
└── Main (right column)
    ├── CaseSynopsis      ← D-6 paragraph + chips
    └── Tabs
        ├── DocumentsGrid → DocumentTile × N
        ├── FinancialsTab
        └── QueryBoard → QueryTimeline → DeadlineCountdown
```

```
src/app/page.tsx (dashboard)
├── 6 action tiles (Queries due, Post-op HPE, Pre-auths, Discharges, Aging, Missing)
├── LynqNudges (rule-based recommendations)
└── Work queue table
```

---

## 7. Mock data → real data migration

Today, all UI runs on TypeScript mocks. The plan is to flip them one at a time as the pipeline produces real output.

| Mock | Replace with | When |
|---|---|---|
| `lib/synopsis.ts` | Read `PatientLog/{MRN}/extracted/*.json` | Next chunk |
| `lib/mockDocuments.ts` | Read `PatientLog/{MRN}/originals/*` directory listing | After pipeline runs on corpus |
| `lib/mockQueries.ts` | Supabase `queries` table | Supabase chunk |
| `lib/mockData.ts` (patients/cases) | Supabase `patients`, `cases` tables | Supabase chunk |

Keep mocks alive as **seed data** even after Supabase — they're useful for fresh installs and demos.

---

## 8. Conventions

- **Renames:** `{MRN}_{snake_doc_type}_{YYYYMMDD}.{ext}` — deterministic.
- **Confidence:** ≥0.90 = auto-rename. <0.90 = flag for clerk. Sarvam agreement bumps +0.3.
- **Tailwind tokens:** Use semantic colors only — `ink-100/200/300`, `bone-0/100/200/300`, `accent`, `good`, `warn`, `bad`, and their `-soft` variants. Don't hardcode hex.
- **Tone bands (deadlines, scores):** `good ≥ 8d / 90%`, `warn 4-7d / 70-89%`, `bad ≤ 3d / <70%`.
- **Files are referenced by markdown links** in responses (e.g. `app/src/lib/checklist.ts:42`).
- **Always ask before adding new dependencies.** Owner pays per credit and wants tight control.

---

## 9. Hard rules from the owner (do not violate)

1. **No cloud backups.** All data lives on the user's Desktop / local disk.
2. **Only Sarvam Vision is allowed for cloud calls** — and only with redacted docs.
3. **No Practo scraping** (ToS).
4. **No Tesseract** (decided against — keep stack tight).
5. **Keep responses short.** Owner will ask for elaboration if needed.
6. **Confirm before big changes.** Small contained edits OK, structural changes need a "go ahead".

---

## 10. Next chunks queued (in priority order)

The owner will pick one; ask before starting.

1. **Wire pipeline output → UI** — replace `lib/synopsis.ts` mock with real `extracted/*.json` reads. Highest leverage.
2. **Drug Master build** — `tools/build_drug_master.py` from local CSV + corpus mentions + OpenFDA. Add rapidfuzz matcher.
3. **Per-doc synopsis on hover** — wire `synopsisFor(filename)` into `DocumentTile`.
4. **Backend Panel + OPD Registration screens** — new routes `/backend`, `/opd`.
5. **Real Batch_01 thumbnails** in DocumentsGrid (replace mock PDF icons).
6. **Supabase hookup** — schema in `db/`.
7. **30-day auto-purge** of `redacted/` folders.
8. **Agentic OCR fallback** for low-confidence Sarvam responses (DeepSeek vs Claude bake-off — pending decision).

---

## 11. Strategy references in the zip

- `01_architecture.svg` — overall system
- `05_ai_architecture.svg` — OCR + LLM stack
- `09_mvp_scope.svg` — what's in/out of MVP
- `medlynq_workflow_v3.svg` — clinical workflow
- `MedOverwatch_Integrated_Blueprint_v2.docx` — full vision deck
- `visily-multiscreens.pdf` — wireframes (page 7 is patient detail)

---

## 12. Who to ask

The owner (paying per credit). When in doubt, ask. Default to small reversible edits and short answers.
