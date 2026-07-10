// Server-only Postgres pool. Works against ANY Postgres — Supabase's own
// Postgres endpoint (Settings -> Database -> Connection string, NOT the
// REST URL/service-role key), Azure Database for PostgreSQL, or plain
// self-hosted Postgres. Swapped in from @supabase/supabase-js's REST client
// specifically so this app isn't tied to Supabase's hosting — the schema
// (db/schema_v2.sql) is vanilla SQL with no Supabase-specific features
// (no RLS policies, no Supabase Auth/Storage/Realtime usage anywhere in this
// codebase), so any Postgres 13+ works as a drop-in replacement.
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL missing from .env.local — e.g. postgresql://user:pass@host:5432/dbname. " +
    "For Supabase, use the Postgres connection string from Settings > Database > Connection string, " +
    "NOT the SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pair those were used with previously."
  );
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});
