-- MedLynq — Supabase/Postgres schema v2
-- Supersedes schema.sql (v1 draft was written before the current data model
-- existed — wrong role/source enums, no 4-stage/ClaimStatus model, premature
-- vector-embedding table). This version maps directly to src/lib/types.ts,
-- mockData.ts, mockQueries.ts, mockDocuments.ts, auditLog.ts and the runtime
-- JSON stores under db/*.json as they exist today.
--
-- SCOPE: structured data only. Actual document BYTES stay on local disk
-- under PatientLog/{mrn}/originals|extracted/ — untouched by this migration.
-- The `documents` table below stores metadata + a relative path, not files.
--
-- ENUM STRATEGY: ClaimStatus, Scheme, Specialty, Treatment, doc source, and
-- role are all still evolving (explicitly: ClaimStatus's 15 values will grow).
-- Postgres native `enum` types require a migration for every new value, which
-- fights that. So these columns are `text` with validation left to the
-- TypeScript union types (already the source of truth) — not `check`
-- constraints — so adding a new ClaimStatus value is a code change only,
-- never a schema migration.

create extension if not exists pgcrypto;

-- ---------- TENANTS ----------
-- id kept as the existing human-readable text id (HOSP-BLR-49) rather than a
-- fresh uuid — every other table/JSON file already references hospital_id
-- this way, so keeping it avoids remapping every foreign key on migration.
create table if not exists hospitals (
  id                 text primary key,
  name               text not null,
  short_name         text,
  subdomain          text unique,
  logo_initial       text,
  primary_color      text,
  accent_color       text,
  city               text,
  district           text,
  vocabulary         jsonb default '{}'::jsonb,
  features           jsonb default '{}'::jsonb,
  schemes_enabled    text[] default '{}',
  his_webhook_secret text,
  tagline            text,
  created_at         timestamptz default now()
);

-- ---------- USERS ----------
create table if not exists users (
  id            text primary key,               -- U001 style, kept as-is
  hospital_id   text not null references hospitals(id) on delete cascade,
  email         text unique not null,
  name          text not null,
  role          text not null,                  -- ADMIN | MEDCO | CFO (see enum strategy note)
  designation   text,
  bis_enabled   boolean default false,
  password_hash text not null,
  created_at    timestamptz default now()
);

-- ---------- PATIENTS ----------
create table if not exists patients (
  id          text primary key,                 -- P0001 / P_AUTO_xxx — kept as-is
  hospital_id text not null references hospitals(id) on delete cascade,
  mrn         text not null,
  name        text not null,
  age         int,
  gender      text check (gender in ('M','F')),
  state       text,
  district    text,
  department  text,
  created_at  timestamptz default now(),
  unique (hospital_id, mrn)
);
create index if not exists patients_hospital_idx on patients(hospital_id);

-- ---------- CASES ----------
-- Unified Case model (no separate patient_folders/claims split — the app
-- never had that split; one Case row IS the claim from OPD through discharge).
create table if not exists cases (
  id               text primary key,             -- registration_id / CASE_AUTO_xxx
  patient_id       text not null references patients(id) on delete cascade,
  hospital_id      text not null references hospitals(id) on delete cascade,
  registration_id  text,
  scheme           text not null,
  scheme_variant   text,
  auth_mode        text,                          -- pre_auth | pre_approval | cash
  entry_mode       text,                          -- checkup | emergency | doc_router_auto (seen in live data)
  payer            text,
  procedure_code   text,
  procedure_name   text,
  diagnosis        text,
  treatment_type   text,                          -- chemo | surgery | radiation | medicine | other
  specialty        text,
  cycle_current    int,
  cycle_total      int,
  admission_date   date,
  discharge_date   date,
  status           text not null,                 -- full ClaimStatus — see enum strategy note, WILL grow
  claimed_amount   numeric(12,2) default 0,
  approved_amount  numeric(12,2),
  tat_days         int default 0,
  age_days         int default 0,
  missing_docs     int default 0,
  open_queries     int default 0,

  -- pre-approval flow (Ayushman / FCI)
  approval_clock_started_at timestamptz,
  approval_received_at      timestamptz,
  approval_valid_till       timestamptz,
  approval_amount_inr       numeric(12,2),
  approval_letter_filename  text,

  -- pre-auth flow (others)
  intimation_due_at timestamptz,

  -- scheme switching after rejection
  scheme_history     jsonb default '[]'::jsonb,   -- Array<{scheme, scheme_variant, attempted_at, outcome, rejection_reason}>
  rejection_rounds    int default 0,
  scheme_contact_person jsonb,                     -- {name, phone, designation}

  -- team assignment
  assigned_medco_id   text references users(id),
  assigned_medco_name text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists cases_patient_idx on cases(patient_id);
create index if not exists cases_hospital_idx on cases(hospital_id);
create index if not exists cases_status_idx on cases(status);

-- Stage is DERIVED from status, never stored redundantly — mirrors
-- stageOf() in src/lib/types.ts exactly. Keeping this as a SQL function
-- (not a generated column) means adding a new ClaimStatus value only
-- requires updating this function + the TS one together, no column rebuild.
create or replace function stage_of(p_status text) returns text as $$
begin
  if p_status = 'opd_done' then return 'opd'; end if;
  if p_status in ('preauth_pending','awaiting_approval','approval_received') then return 'pre_auth'; end if;
  if p_status in ('preauth_approved','admitted') then return 'mid_way'; end if;
  return 'discharge';
end;
$$ language plpgsql immutable;

-- ---------- DOCUMENTS ----------
-- Metadata + path only. Actual bytes stay under
-- PatientLog/{mrn}/originals/{filename} on local disk (unchanged).
create table if not exists documents (
  id                text primary key,             -- {case_id}_{filename} sanitized, kept as-is
  case_id           text references cases(id) on delete cascade,
  patient_id        text not null references patients(id) on delete cascade,
  hospital_id       text not null references hospitals(id) on delete cascade,
  doc_type          text,
  filename          text not null,                -- on-disk filename under originals/
  original_filename text,
  ext               text,                          -- pdf | jpg | jpeg | png
  source            text,                          -- MedCam | HIS | Manual
  size_bytes        bigint,
  confidence        real,
  storage_path       text,                          -- relative path, e.g. PatientLog/{mrn}/originals/{filename}
  extracted          jsonb,                         -- mirrors extracted/{filename}.json manifest (fields/identity/redact/method)
  uploaded_at        timestamptz default now()
);
create index if not exists documents_case_idx on documents(case_id);
create index if not exists documents_patient_idx on documents(patient_id);

-- ---------- QUERIES (multi-round, stage-aware) ----------
create table if not exists queries (
  id                       text primary key,       -- q1/q2/q3 per case today; keep as free text
  case_id                  text not null references cases(id) on delete cascade,
  round                    int not null,
  stage                    text,                    -- pre_auth | approval | mid_way | discharge | claim
  raw_text                 text not null,
  raised_by                text,
  raised_on                text,                    -- kept as display text today ("16 May 2026"); consider date later
  query_type               text,
  amount_at_stake          numeric(12,2),
  status                   text not null default 'open',  -- open | responded | resolved | rejected
  deadline_days_total      int,
  awaiting_doc_type        text,
  response_text            text,
  response_attached_docs   text[],
  response_sent_on         text,
  response_drafted_by      text,
  created_at               timestamptz default now()
);
create index if not exists queries_case_idx on queries(case_id);
create index if not exists queries_status_idx on queries(status) where status = 'open';

-- ---------- AUDIT LOG (append-only) ----------
-- Mirrors PatientLog/_index/audit_log.jsonl exactly, one row per line.
-- The JSONL file can keep being written by the Python side for local
-- debugging; this table becomes the durable, queryable copy the UI reads.
create table if not exists audit_log (
  id           bigserial primary key,
  ts           timestamptz not null default now(),
  kind         text not null,                       -- redact | sarvam_send | identity_llm_send | doc_applied | purge ...
  hospital_id  text references hospitals(id),
  mrn          text,
  file         text,
  sha256_in    text,
  sha256_out   text,
  burned_count int,
  extra        jsonb
);
create index if not exists audit_log_mrn_idx on audit_log(mrn);
create index if not exists audit_log_kind_idx on audit_log(kind);
create index if not exists audit_log_ts_idx on audit_log(ts desc);

-- ---------- CHECKLIST SKIPS ----------
-- Was db/checklist_skips.json: { [case_id]: string[] }
create table if not exists checklist_skips (
  case_id  text not null references cases(id) on delete cascade,
  doc_type text not null,
  skipped_at timestamptz default now(),
  primary key (case_id, doc_type)
);

-- ---------- DOC ROUTER: undo tokens ----------
-- Was db/undo_tokens.json. Short-lived (expires_at), but durable storage
-- means an undo window survives a server restart instead of silently
-- becoming un-undoable.
create table if not exists undo_tokens (
  token             text primary key,
  hospital_id       text references hospitals(id),
  actor_id          text,
  actor_role        text,
  expires_at        timestamptz not null,
  reverse           jsonb not null,                 -- {attach_id, created_patient_id, created_case_id, auto_advance}
  created_at        timestamptz default now()
);
create index if not exists undo_tokens_expires_idx on undo_tokens(expires_at);

-- ---------- DOC ROUTER: attachment log ----------
-- Was db/doc_attachments.json. Records every routing decision applied.
create table if not exists doc_attachments (
  id          text primary key,                    -- ATT_xxx
  ts          timestamptz not null default now(),
  hospital_id text references hospitals(id),
  patient_id  text references patients(id),
  case_id     text references cases(id),
  doc_ids     text[],
  doc_types   text[],
  actor_id    text,
  actor_role  text
);
create index if not exists doc_attachments_patient_idx on doc_attachments(patient_id);
create index if not exists doc_attachments_case_idx on doc_attachments(case_id);
