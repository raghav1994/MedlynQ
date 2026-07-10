# MedLynq — Handoff for Deployment Partner

This is a claims-intelligence dashboard for Indian government health insurance schemes (PM-JAY, CGHS, SHA, Railway UMID, ECHS, and more), used by a hospital's insurance/claims team ("MEDCOs") to track patient documents, catch missing-doc risk before a claim is queried, manage payer queries against 15-day deadlines, and route claims through pre-auth → mid-way → discharge → approval.

Your job: get this running reliably on Azure, connected to a real Postgres database, with each hospital ("tenant") isolated in its own container + database.

---

## 1. Quick start (local, to confirm it runs before touching Azure)

```bash
cd app
npm install
cp .env.example .env.local   # then fill in real values, see section 5

# Python sidecar (OCR pipeline)
python -m venv .venv
# Windows: .venv\Scripts\activate | Mac/Linux: source .venv/bin/activate
pip install -r python/requirements.txt

npm run dev
# http://localhost:3000
```

Demo logins are in `db/users.json` (password for all: check with the owner — not included in this doc for obvious reasons). Two demo tenants ship in `db/tenants/`: `HOSP-BLR-49` (Action Cancer Hospital) and `HOSP-DEL-77` (Fortis).

---

## 2. What's actually built

This is a working product, not a mockup — most of what follows is real, tested logic over real data structures, verified in-browser. A few specific widgets are clearly-labeled illustrative placeholders (flagged below); everything else described here is functioning code.

**Core claims workflow**
- Patient intake, document upload (drag-drop, multi-file, auto-grouped by detected patient)
- OCR pipeline: PDF/image → text extraction → PII redaction → AI classification → structured field extraction → auto-rename
- Document checklist engine — stage-aware (OPD → pre-auth → mid-way → discharge), treatment-aware (chemo/surgery/radiation/medicine), specialty-aware (oncology/cardiac/ortho/dialysis/ICU/maternity), with alternate-document groups (e.g. any one of Histopathology/Biopsy/PET-CT satisfies a requirement)
- Query management — multi-round query history, 15-day deadline countdown, real "resolve" action that persists and feeds dashboard stats
- Pre-auth, approval-flow (Ayushman/FCI), rejection-handling with 3-option resolution paths, 45-day auto-close/reopen for stale claims
- NHCX (National Health Claims Exchange) integration — FHIR R4 bundle builder, signed outbound submission, mock endpoint for local testing, real state-machine transitions on approve/reject/query

**Document intelligence (Python sidecar)**
- Dual-engine OCR (RapidOCR + OnnxTR) for local PII detection/redaction — nothing leaves the machine unredacted
- Sarvam AI vision API for scanned-document text extraction, called only on the redacted copy
- Content-based document classifier (not just filename) — trained/tuned against a 6,500+ real-document corpus
- Identity extraction (patient name/MRN/age/gender) with fuzzy matching, multi-format fallbacks, table/prose parsing
- Persistent worker pool — keeps ML models warm across requests instead of reloading per file (major latency win)
- Prescription/drug decoder against a real drug master + package-code CSVs

**Auth & multi-tenancy**
- Custom session auth (iron-session, httpOnly cookies, bcrypt), 4 roles (ADMIN/MEDCO/CFO/DOCTOR)
- Per-hospital tenant config (branding colors, logo, feature flags, enabled schemes) — see section 4
- Per-hospital data scoping (a Fortis user never sees Action's patients)
- Rate limiting + zod input validation on API routes

**Dashboard**
- Live-computed action tiles (queries due, pre-auths pending, aging cases, missing docs, etc.) — all real, from actual case data
- Rule-based "Lynq" nudges (approval expiring, SLA overdue, missing-doc clusters)
- Personal scoreboard, activity stream, compliance %, and "yesterday's wins" — **real once there's event history, fall back to a clearly-labeled "(illustrative)" placeholder for a brand-new tenant with no activity yet.** Two Compliance Health rows (empanelment renewal, audit trail completeness) and two Yesterday's Wins bullets (underpayment disputes, docs auto-renamed) have **no backing feature at all** — they stay illustrative permanently until someone builds the underlying tracking (there's no dispute-filing feature or renamer-event-logging in the app today).

**Other integrations**
- HL7v2 parser + webhook for hospital HIS system admission feeds
- WhatsApp share links for patient updates
- Admin audit log (every redact/purge/routing decision), with purge tooling for PII retention compliance
- Team performance scoreboard, benchmarking view for CFO role

---

## 3. Architecture

```
app/
├── src/app/          Next.js 14 App Router pages + API routes
├── src/components/    React UI
├── src/lib/           Business logic, types, tenant/auth/data-scoping
│   ├── db/            Postgres access layer (pool.ts, patientsCases.ts)
│   ├── auth/          Session, guards, rate limiting
│   └── tenant/         Tenant config resolution
├── python/            OCR sidecar — spawned as persistent subprocesses by
│                       src/lib/pythonWorker.ts, talks over stdin/stdout JSON
├── db/                 schema_v2.sql + tenant configs + seed users
├── data/               Reference CSVs (drug master, package codes, scheme rules)
└── Dockerfile
```

**The one thing to understand before deploying:** the Python OCR pipeline is not a separate microservice. Node spawns and keeps warm a pool of Python child processes directly (`src/lib/pythonWorker.ts`), which is why the Dockerfile installs both Node and Python into one image. This works and is simpler to deploy, but it does mean the container needs enough RAM for both the Node process and however many Python workers you configure (`MEDLYNQ_WORKER_POOL_SIZE` — each worker holds PaddleOCR/RapidOCR/OnnxTR models resident, roughly 1-2GB each).

If you later want to scale the OCR pipeline independently of the web app, that's a real rewrite (split into two deployed services, rewrite `pythonWorker.ts` to call the Python service over HTTP instead of stdio) — not something to do casually. Ship the one-container version first.

---

## 4. Database — Supabase removed, now plain Postgres

The app originally used Supabase, but only as a hosted Postgres database (via `@supabase/supabase-js`'s `.from(table).select()` calls) — **no Supabase Auth, no Supabase Storage, no Realtime, no Row Level Security policies were ever used.** That dependency has been removed entirely. The app now talks to Postgres directly via the `pg` package (`src/lib/db/pool.ts`), which works against:

- Supabase's own Postgres endpoint (still fine to use as a plain Postgres host — get the connection string from Supabase's dashboard: **Settings → Database → Connection string**, not the REST URL/service-role key)
- **Azure Database for PostgreSQL (Flexible Server)** — recommended, since you're deploying on Azure anyway
- Any other Postgres 13+

**Update (2026-07-10): fully migrated off Supabase's hosted Postgres to Azure.** Provisioned
`medlynq-pg` (Azure Database for PostgreSQL Flexible Server, Burstable B1ms, Central India,
`medlynq-rg`), and moved to the per-tenant-database model one server ahead of schedule:
- `hosp_blr_49` — `HOSP-BLR-49`'s database. All real data migrated and row-count-verified:
  1 hospital, 4 users, 19 patients, 19 cases, 29 documents, 437 audit-log rows.
- `hosp_del_77` — `HOSP-DEL-77`'s database. Migrated its 1 hospital row + 3 users; it had no
  patients/cases/documents in Supabase either, so there was nothing else to bring over.
- `pgcrypto` had to be allow-listed via `az postgres flexible-server parameter set --name
  azure.extensions --value PGCRYPTO` before `schema_v2.sql` would apply — Azure Flexible Server
  blocks unlisted extensions by default.
- Firewall: a rule allows Azure services (`0.0.0.0`) for future app connectivity, plus the
  provisioning machine's IP. Add each deployment host's IP (or switch to VNet integration) before
  going further than local testing.
- The Supabase project itself was **not** deleted — connection info is preserved in
  `.env.local` (commented) purely as a rollback record, but the app no longer reads it.
- Credentials live only in local `.env.local` / `.env.HOSP-DEL-77.local` files (gitignored) —
  not committed, not in this doc. Reset via `az postgres flexible-server update -n medlynq-pg
  -g medlynq-rg -p <new-password>` if lost.

**To point at a new database:** run `db/schema_v2.sql` against it, set `DATABASE_URL` in `.env.local` (or the container's env), done. No code changes needed for a different Postgres host.

**Important, pre-existing limitation to know about:** the schema has no Row Level Security and the app queries every table without a `hospital_id` filter at the SQL level — tenant isolation happens only in application code (`src/lib/dataScope.ts`), after the full table is fetched into memory. This was an acceptable shortcut for a 2-tenant demo; **for the per-tenant-container model you're building (one database per hospital), this stops being a risk automatically** since each container's database only ever contains one hospital's data. If you ever go back to one shared database serving multiple tenants, add real `hospital_id` filtering or RLS first.

Runtime state (resolved queries, activity events, patient overrides, etc.) currently also has a JSON-file-on-disk fallback layer under `db/*.json` for when the DB call fails or during local dev — this is intentional defense-in-depth, not a bug, but it does mean container filesystems should be treated as ephemeral scratch space, not the source of truth. The Postgres database is the source of truth.

---

## 5. Environment variables

Copy `app/.env.example` to `app/.env.local` and fill in:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection string (see section 4) |
| `IRON_SESSION_SECRET` | ≥32 chars, session cookie encryption. Generate: `openssl rand -base64 32` |
| `MEDLYNQ_INTERNAL_SECRET` | Shared secret for server-to-server calls (NHCX send → mock endpoint) |
| `MEDLYNQ_PYTHON` | Path to the Python executable inside `.venv` — the Dockerfile sets this automatically |
| `MEDLYNQ_WORKER_POOL_SIZE` | How many warm Python OCR workers to keep (default 2; size to RAM) |
| `MEDLYNQ_REDACTED_RETENTION_DAYS` | PII retention window before auto-purge (default 30) |
| `SARVAM_API_KEY`, `SARVAM_CHAT_MODEL` | Sarvam AI — used for OCR on scanned documents and identity fallback |
| `NHCX_ENDPOINT` | Claims submission gateway — defaults to the app's own mock for local/demo |
| `MEDLYNQ_TENANT_ID` | **Set this for a per-tenant container deployment** — see section 6 |
| `NODE_ENV` | `production` in Azure |

---

## 6. Multi-tenancy — the model you're deploying

Each hospital is a "tenant." Config lives at `db/tenants/{hospital_id}.json` — branding (colors, logo initial, tagline), which government schemes are enabled, and per-tenant feature flags. Two demo tenants ship as examples: `HOSP-BLR-49.json` and `HOSP-DEL-77.json`.

**You chose per-tenant containers** (one isolated container + one isolated database per hospital), not a shared multi-tenant deployment. For that:

1. `MEDLYNQ_TENANT_ID` (added specifically for this) hard-locks a container to one tenant — set it to the hospital's id (e.g. `HOSP-BLR-49`) and tenant/branding resolution stops looking at subdomain or session entirely, so there's no possible cross-tenant leak in branding/config even if something else misbehaves. See `src/lib/tenant/loader.ts` for exactly how this is wired in — it's the highest-priority resolution step.
2. **Give each tenant its own database**, not just its own container sharing one DB — this is what actually delivers real data isolation for hospital data, rather than relying on application code getting the filtering right every time (see the RLS caveat in section 4).

**Onboarding a new hospital, step by step:**
1. Provision a new Postgres database (Azure Database for PostgreSQL), run `db/schema_v2.sql` against it.
2. Add a row to that database's `hospitals` table, and add a matching `db/tenants/{hospital_id}.json` file to the deployed code (branding, schemes enabled, feature flags — copy an existing one as a template).
3. Seed at least one user for that hospital (insert into `users` table — see `db/users.json` for the shape, though that file itself is only the local-dev fallback).
4. Build/deploy a new container instance with that tenant's env vars: `MEDLYNQ_TENANT_ID`, `DATABASE_URL` (pointing at its own database), and the rest of the checklist in section 5.
5. Point `{hospital-subdomain}.yourdomain.com` at that container.

The same Docker image works for every tenant — only the env vars differ per deployment.

---

## 7. Deployment checklist for Azure

- [x] Provision Azure Database for PostgreSQL (Flexible Server) per tenant — `medlynq-pg`, done 2026-07-10, see §4
- [x] Run `db/schema_v2.sql` against each tenant's database — applied to `hosp_blr_49` and `hosp_del_77`
- [x] Build the Docker image — via GitHub Actions to ACR (`app-image.yml`), not locally, since no local Docker/ACR Tasks. Several real build bugs found and fixed along the way, see §7a.
- [x] Deploy to Azure App Service (Container) — `medlynq-app` for `HOSP-BLR-49`, done 2026-07-11. `HOSP-DEL-77` still needs its own instance — see §7a.
- [x] Set env vars per instance per the checklist in section 5, plus `MEDLYNQ_TENANT_ID` — done for `medlynq-app`/`HOSP-BLR-49`
- [x] Size the instance's memory for `MEDLYNQ_WORKER_POOL_SIZE` × ~1.5GB per OCR worker, plus Node's own footprint — set to 1 to fit the B2 plan's 3.5GB; raise the plan tier before raising this
- [ ] Point each tenant's subdomain/custom domain at its container — `medlynq-app.azurewebsites.net` is being used directly for now, no custom domain/subdomain-per-tenant routing set up
- [x] Confirm `IRON_SESSION_SECRET` is unique per environment — freshly generated for `medlynq-app`, not the shared dev one
- [ ] Get a real `SARVAM_API_KEY` for production volume — still using the dev key carried over from `.env.local`, may be rate-limited/low-quota

---

## 7a. Current live Azure resources (updated 2026-07-11)

**Update (2026-07-11): `medlynq-app` now runs THIS app** (the one this handoff package
describes — multi-tenant, NHCX, HL7, Postgres-backed), not the older Blob-storage build. It's a
container deployment (not source/Oryx), locked to the `HOSP-BLR-49` tenant, pointed at the
`hosp_blr_49` Azure Postgres database from §4. Verified end-to-end: `/api/ping` returns 200, the
login page renders the correct tenant branding ("Action Cancer Hospital"), and a bogus-credential
login attempt returns a clean `401 Invalid email or password` (proving the DB query path works,
not just static assets). `HOSP-DEL-77` has no deployed instance yet — see the per-tenant
onboarding steps in §6 to stand one up pointed at the `hosp_del_77` database.

- **Resource group:** `medlynq-rg` (`centralindia`)
- **App Service plan:** `medlynq-plan` (Linux B2 — 2 vCore/3.5GB. `MEDLYNQ_WORKER_POOL_SIZE=1`
  to stay within that RAM budget; each OCR worker holds ~1-2GB of models resident, so raise the
  plan tier before raising the pool size)
- **`medlynq-app`** — Running — https://medlynq-app.azurewebsites.net
  - Container deploy: `medlynqacr.azurecr.io/medlynq-app:v1`, built via GitHub Actions
    (`.github/workflows/app-image.yml`) on push to `main` touching `MedLynq_Handoff/app/**`,
    since ACR Tasks/local Docker aren't available (same reasoning as the OCR image below).
    Bump the tag (v1 → v2 → ...) to force a clean pull after a rebuild.
  - The OLD source/Oryx deploy workflow (`deploy.yml`) is disabled (`workflow_dispatch` only) —
    it targeted the top-level `app/` folder, which no longer matches what's live.
  - App settings: `DATABASE_URL` (→ `hosp_blr_49`), `MEDLYNQ_TENANT_ID=HOSP-BLR-49`,
    `IRON_SESSION_SECRET`/`MEDLYNQ_INTERNAL_SECRET` (freshly generated, not the dev defaults),
    `SARVAM_API_KEY`/`SARVAM_VISION_ENDPOINT`, `MEDLYNQ_WORKER_POOL_SIZE=1`,
    `MEDLYNQ_REDACTED_RETENTION_DAYS=30`, `WEBSITES_PORT=3000`. The old Blob-storage-era
    settings (`AZURE_STORAGE_CONNECTION_STRING`, `AZURE_CONTAINER_*`, `OCR_SERVICE_URL`,
    Oryx build flags) were removed — this app doesn't use Azure Blob at all.
  - **Real bugs found and fixed getting this to build** (none were deploy-config issues — all
    were in the app source, meaning this codebase had never actually been built before):
    Dockerfile had `--no-install-recursive` (not a real apt-get flag, should be
    `--no-install-recommends`); `requirements.txt` pinned `scipy==1.18.0` which needs Python
    3.12, but only 3.11 is available via apt on Debian bookworm; `next.config.mjs` tried to
    exclude `pg` from the client bundle via `resolve.fallback`, which only no-ops Node CORE
    modules, not real packages — needed `resolve.alias` instead; `zip-batch`/`download-batch`/
    `thumb` routes needed the same `Buffer as unknown as BodyInit` cast already applied
    elsewhere (newer `@types/node`); `StatusBadge` was missing 6 of 17 `ClaimStatus` colors;
    `hl7Mapper` normalized to `"Railway"`, not the real `Scheme` value `"Railway_UMID"`;
    `types.ts` had a dead `'SHA'` key that was never a valid `Scheme`; `mockData.ts`'s 6 seed
    cases predated `hospital_id` becoming required; `/intake` used `useSearchParams()` without
    the Suspense boundary Next 14's App Router requires for static generation. Also: `next
    build`'s page-data-collection step imports every route, including ones that intentionally
    throw at import time if secrets are missing — needed placeholder `ENV` values in the
    Dockerfile for the build step only (real values come from App Service settings at runtime).
- **`medlynq-rx`** — Rx prescription-decoder service, Running — https://medlynq-rx.azurewebsites.net
  - Deployed from the v1 plain-JS `medlynq-rx/` via `deploy/deploy-rx.sh` — that script expects
    a `medlynq-rx/` folder at repo root, which was **never actually committed here** (past
    deploys ran from an untracked local copy). It's now preserved at `MedLynq_Handoff/rx-legacy/`.
  - **Has zero app settings configured** — no `OPENAI_API_KEY` set, so decode calls will fail until that's added (`az webapp config appsettings set --name medlynq-rx -g medlynq-rg --settings OPENAI_API_KEY=...`)
  - A TypeScript rewrite (v2) is included in this handoff package at `MedLynq_Handoff/rx/` — see its README for what it would take to cut this App Service over to it
- **`medlynq-ocr`** — Container App running the Python OCR/redact sidecar (FastAPI), 2cpu/4Gi, min-replicas 1
  - Image: `medlynqacr.azurecr.io/medlynq-ocr:v3`, built via GitHub Actions (`.github/workflows/ocr-image.yml`) since ACR Tasks/local Docker aren't available
  - FQDN: `medlynq-ocr.calmforest-2412fe32.centralindia.azurecontainerapps.io`
  - Not currently used by `medlynq-app` (this app's OCR pipeline runs in-container per §3, not
    via this separate service) — kept running for `medlynq-rx`/legacy use, not wired to anything
    in this handoff package
- **Storage account:** `medlynqstorage` — containers `medlynq-redacted`/`medlynq-extracted`,
  unused by this app (see §4/§3 — no Azure Blob dependency here at all)
- **GitHub repo:** `https://github.com/raghav1994/MedlynQ` (private) — pushes to `main` touching
  `MedLynq_Handoff/app/**` rebuild+redeploy `medlynq-app`'s image automatically; `medlynq-rx`
  deploys only via manual `./deploy/deploy-rx.sh` run

**Gotcha carried over from this deployment:** App Service serves stale code/env after any deploy or
app-setting change until an explicit restart — always `az webapp restart --name <app> -g medlynq-rg`
after changing anything, and re-test before assuming a deploy failed.

`HOSP-DEL-77` still needs its own instance (App Service or Container App) with
`MEDLYNQ_TENANT_ID=HOSP-DEL-77` and `DATABASE_URL` pointed at `hosp_del_77` to be reachable —
see §6 for the onboarding steps.

---

## 8. What's intentionally NOT included in this handoff

To keep this package small and free of test/demo clutter:
- The 6,500+ file real document corpus used during development (`PatientLog/` at the project root) — not needed to run the app, and it's real (anonymized) hospital document scans, not something to ship around casually.
- Accumulated runtime state from development/testing (`db/*.json` runtime stores were reset — only the schema, seed users, and tenant configs are included).
- `node_modules/`, `.venv/`, `.next/` build artifacts — regenerate with `npm install` / `pip install` / `npm run build`.
- Strategy decks, wireframes, pitch materials — not code, ask the owner directly if you need those for context.
- Real secrets (`.env.local`) — you'll need the owner to hand you a `SARVAM_API_KEY` and set up your own `DATABASE_URL`/`IRON_SESSION_SECRET`.

---

## 9. Who to ask

The product owner. This handoff aims to be self-contained for deployment, but product/business logic questions (why a rule exists, what a scheme's rules should be, roadmap priorities) should go to them, not guessed at.
