-- Purchasing Intelligence sidecar — local private store.
-- PROHIBITED DATA RULE: no table may ever hold cookies, tokens, credentials,
-- payment data, gift-card codes, MFA data, addresses, or raw page HTML.
-- Fields marked (enc) hold values encrypted by the field-encryption service
-- when the OS keychain is available (see docs/privacy/data-classification.md).

CREATE TABLE IF NOT EXISTS local_profile (
  id TEXT PRIMARY KEY,
  pseudonymous_device_id TEXT NOT NULL,
  pairing_token TEXT NOT NULL,
  device_token TEXT,                -- Cloudflare device-scoped token (present only after registration)
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  preferences_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,               -- (enc)
  normalized_name TEXT NOT NULL,    -- (enc)
  urgency TEXT NOT NULL,
  target_quantity INTEGER NOT NULL,
  acceptable_substitution TEXT NOT NULL,
  max_unit_price_cents INTEGER,
  preferred_brand TEXT,             -- (enc)
  category_hint TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_preferences (
  id TEXT PRIMARY KEY,
  shopping_item_id TEXT NOT NULL REFERENCES shopping_items(id),
  preference_key TEXT NOT NULL,
  preference_value TEXT NOT NULL,   -- (enc)
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_profiles (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_label TEXT NOT NULL,
  page_url_origin TEXT NOT NULL,
  notes TEXT,                       -- (enc)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_label TEXT NOT NULL,
  page_url_origin TEXT NOT NULL,
  page_path_hint TEXT,
  item_count INTEGER,
  items_json TEXT NOT NULL,         -- (enc) exact cart lines
  subtotal_cents INTEGER,
  discounts_cents INTEGER,
  delivery_fee_cents INTEGER,
  service_fee_cents INTEGER,
  tax_cents INTEGER,
  visible_credits_cents INTEGER,
  displayed_final_total_cents INTEGER,
  calculated_total_cents INTEGER,
  confidence TEXT NOT NULL,
  extraction_notes_json TEXT NOT NULL,
  adapter_version TEXT,
  privacy_mode TEXT NOT NULL,
  raw_html_stored INTEGER NOT NULL DEFAULT 0 CHECK (raw_html_stored = 0),
  cookies_read INTEGER NOT NULL DEFAULT 0 CHECK (cookies_read = 0)
);

CREATE INDEX IF NOT EXISTS idx_cart_snapshots_created ON cart_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS visible_offers (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES cart_snapshots(id),
  title TEXT NOT NULL,
  raw_text TEXT NOT NULL,           -- (enc) visible raw offer text
  offer_type TEXT NOT NULL,
  minimum_spend_cents INTEGER,
  discount_cents INTEGER,
  discount_percent REAL,
  maximum_discount_cents INTEGER,
  status TEXT NOT NULL,
  confidence TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_plans (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  optimization_goal TEXT NOT NULL,
  current_snapshot_id TEXT,
  recommended_path TEXT,
  estimated_final_total_cents INTEGER,
  observed_final_total_cents INTEGER,
  plan_json TEXT NOT NULL,          -- (enc) full explainable PurchasePlan object
  explanation_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  config_pack_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_plans_created ON purchase_plans(created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES purchase_plans(id),
  shopping_item_id TEXT,
  display_name TEXT NOT NULL,       -- (enc)
  required INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_actions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES purchase_plans(id),
  action_type TEXT NOT NULL,
  proposed_payload_json TEXT NOT NULL,   -- (enc)
  expected_page_state_hash TEXT,
  page_origin TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT,
  preconditions_json TEXT NOT NULL,
  user_visible_summary TEXT NOT NULL,
  dedupe_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  action_sequence INTEGER NOT NULL,
  initiated_by_user INTEGER NOT NULL DEFAULT 1,
  retries_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_actions_plan ON plan_actions(plan_id);

CREATE TABLE IF NOT EXISTS action_approvals (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES plan_actions(id),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approval_scope_hash TEXT NOT NULL,
  approved INTEGER NOT NULL,
  user_visible_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_results (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES plan_actions(id),
  observed_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  post_action_snapshot_id TEXT,
  stop_reason TEXT,
  evidence_hash TEXT
);

CREATE TABLE IF NOT EXISTS local_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_events_seq ON local_events(seq);

CREATE TABLE IF NOT EXISTS consent_receipts (
  id TEXT PRIMARY KEY,
  privacy_mode TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  scope_text TEXT NOT NULL,
  app_version TEXT NOT NULL,
  extension_version TEXT,
  uploaded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_json TEXT NOT NULL,         -- validated RedactedOutcomeEvent envelope only
  consent_receipt_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | synced | rejected
  synced_at TEXT,
  server_receipt_id TEXT
);

CREATE TABLE IF NOT EXISTS configuration_packs (
  id TEXT PRIMARY KEY,              -- packId@version
  pack_id TEXT NOT NULL,
  version TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  rollout_stage TEXT NOT NULL,
  pack_json TEXT NOT NULL,          -- full signed pack (public artifact, not encrypted)
  key_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuration_pack_status (
  pack_id TEXT PRIMARY KEY,
  active_version TEXT,
  previous_version TEXT,            -- rollback history
  verified INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  inactive_reason TEXT,
  updated_at TEXT NOT NULL
);
