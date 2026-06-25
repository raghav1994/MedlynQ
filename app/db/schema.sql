-- MedLynq MVP — Postgres schema (oncology-first)
-- Run against Supabase (it provides pgvector + pgcrypto by default).
-- Multi-tenant by hospital_id. RLS to be added in a follow-up.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------- TENANT + USERS ----------
create table if not exists hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nha_facility_id text,
  city text,
  state text,
  plan_tier text default 'pilot',
  created_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  email text unique not null,
  name text,
  role text not null check (role in ('doctor','nurse','tpa','cfo','admin')),
  created_at timestamptz default now()
);

-- ---------- CLINICAL ----------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  mrn text not null,
  name text not null,
  dob date,
  gender text check (gender in ('M','F','O')),
  state text,
  district text,
  phone_e164 text,
  created_at timestamptz default now(),
  unique (hospital_id, mrn)
);

create table if not exists patient_folders (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  folder_key text not null,
  scheme text,
  payer text,
  admission_date date,
  discharge_date date,
  status text default 'open',
  created_at timestamptz default now()
);

-- ---------- DOCUMENTS + INDEX ----------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references patient_folders(id) on delete cascade,
  doc_type text,
  ai_tag_confidence real,
  source text check (source in ('mobile','his','pharmacy','pacs','manual_upload')),
  original_filename text,
  ai_filename text,
  storage_path_original text,
  storage_path_compressed text,
  size_bytes_orig int,
  size_bytes_compressed int,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now()
);

create table if not exists evidence_index (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  folder_id uuid not null references patient_folders(id) on delete cascade,
  page_number int not null,
  extracted_text text,
  extracted_fields jsonb,
  embedding vector(1536),
  indexed_at timestamptz default now()
);
create index if not exists evidence_index_text_idx
  on evidence_index using gin (to_tsvector('english', coalesce(extracted_text,'')));
create index if not exists evidence_index_embed_idx
  on evidence_index using ivfflat (embedding vector_cosine_ops);

-- ---------- WORKFLOW ----------
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references patient_folders(id) on delete cascade,
  registration_id text,
  reference_no text,
  scheme text,
  payer text,
  procedure_codes jsonb,
  icd_code text,
  claimed_amount numeric(12,2),
  approved_amount numeric(12,2),
  final_status text default 'submitted'
    check (final_status in ('preauth','submitted','pending','query','rejected','approved','paid')),
  submitted_at timestamptz,
  settled_at timestamptz,
  tat_days int generated always as (
    case when settled_at is not null and submitted_at is not null
         then (extract(epoch from (settled_at - submitted_at))/86400)::int
         else null end
  ) stored
);

create table if not exists queries (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(id) on delete cascade,
  raw_query_text text not null,
  raised_by text,
  raised_at timestamptz,
  status text default 'open' check (status in ('open','responded','resolved')),
  source text default 'portal'
);

create table if not exists query_responses (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references queries(id) on delete cascade,
  draft_text text,
  final_text text,
  drafted_by text,
  signed_by uuid references users(id),
  signed_at timestamptz,
  sent_at timestamptz
);

create table if not exists packet_builds (
  id uuid primary key default gen_random_uuid(),
  query_id uuid references queries(id) on delete cascade,
  response_id uuid references query_responses(id) on delete cascade,
  cover_page_path text,
  merged_pdf_path text,
  filename text,
  total_pages int,
  built_at timestamptz default now()
);

-- ---------- AI predictions log ----------
create table if not exists ai_predictions (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  model_name text not null,
  model_version text,
  prediction jsonb,
  confidence real,
  predicted_at timestamptz default now()
);
