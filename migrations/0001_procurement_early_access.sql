-- Procurement early-access lead capture.
--
-- Apply locally:   npx wrangler d1 execute <DATABASE_NAME> --local --file=migrations/0001_procurement_early_access.sql
-- Apply remotely:  npx wrangler d1 execute <DATABASE_NAME> --remote --file=migrations/0001_procurement_early_access.sql
--
-- primary_categories_json / purchasing_channels_json store JSON-encoded
-- string arrays. This is intentionally denormalized (no join tables) since
-- the option sets are small and fixed at this stage.

CREATE TABLE IF NOT EXISTS procurement_early_access_submissions (
  id TEXT PRIMARY KEY,
  work_email TEXT NOT NULL,
  work_email_normalized TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company_size TEXT NOT NULL,
  annual_addressable_spend TEXT,
  procurement_maturity TEXT,
  primary_categories_json TEXT,
  purchasing_channels_json TEXT,
  biggest_challenge TEXT NOT NULL,
  current_systems TEXT,
  browser_extension_interest INTEGER NOT NULL DEFAULT 0,
  pilot_interest INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'procurement_landing_page',
  form_version TEXT NOT NULL DEFAULT 'v1',
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_procurement_early_access_email
  ON procurement_early_access_submissions(work_email_normalized);

CREATE INDEX IF NOT EXISTS idx_procurement_early_access_status_created
  ON procurement_early_access_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_procurement_early_access_created
  ON procurement_early_access_submissions(created_at DESC);
