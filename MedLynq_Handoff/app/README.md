# MedLynq Pulse — MVP Dashboard

Web app for the MedLynq MVP: clerk dashboard, patient folders, document repository,
evidence locator, packet builder. Oncology-first.

## What's in this scaffold (Week 1)

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- One working screen: **dashboard** (`/`) with KPI tiles + patient list
- Mock data seeded from your extracted Batch_01 (10 cases, 8 patients)
- Postgres schema in `db/schema.sql` ready to run on Supabase
- Not yet wired to Supabase — that's next turn

## Run it locally

Requires Node.js 18+ (20+ recommended).

```bash
cd C:\Users\asus\Desktop\MedLynq\app
npm install
npm run dev
```

Open http://localhost:3000 — you should see the dashboard.

## What you'll see

- Top bar: hospital name + search bar
- Left sidebar: filter panel (Scheme / Status / TAT / Missing docs)
- 4 KPI tiles: Total cases · Pending · Approved % · Avg TAT
- Patient admissions table: registration ID, patient_MRN, scheme, procedure, status, ₹ claimed/approved, TAT pill, flags
- Patient names + MRNs are real values from the Batch_01 HAR you extracted

## Project layout

```
app/
├── src/
│   ├── app/
│   │   ├── layout.tsx       root layout
│   │   ├── page.tsx         dashboard page
│   │   └── globals.css      tailwind globals
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── KpiTile.tsx
│   │   ├── PatientTable.tsx
│   │   ├── StatusBadge.tsx
│   │   └── AgingPill.tsx
│   └── lib/
│       ├── types.ts         TypeScript types
│       └── mockData.ts      seed data
├── db/
│   └── schema.sql           Postgres schema (Supabase-ready)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
└── next.config.mjs
```

## Next iterations (planned)

| Week | Goal |
|---|---|
| 2 | Wire to Supabase. Replace mock data with real DB queries. Add file upload. |
| 3–4 | OCR pipeline + evidence index. Background worker for indexing. |
| 5–6 | Document Evidence Locator + response drafter. |
| 7–8 | Query Packet Builder + PDF merge. |
| 9–10 | Polish, DPDP audit, pilot onboarding. |

## Notes

- Patient cross-reference works via `MRN` — same patient across cases (chemo cycles, radiation) appears under one `patient_id`.
- Folder naming follows the spec: `PATIENTNAME_MRN` (e.g. `CHINTA_DEVI_PYZBP2Z4P`).
- No mobile app in MVP — only web dashboard.
