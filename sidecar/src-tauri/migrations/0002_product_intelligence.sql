-- Product identity, price history, and purchase ground truth.
--
-- This is Layer 1 (local, source of truth) per docs/privacy/data-classification.md.
-- Fields marked (enc) are encrypted at rest by the field-encryption service.
--
-- PROHIBITED, as everywhere: no cookies, credentials, payment instruments,
-- addresses, or raw page HTML. Note especially that there is NO table linking
-- products that appeared in the same basket — basket co-occurrence is the
-- single most re-identifying signal in shopping data and is never recorded.

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  source_label TEXT NOT NULL,
  rows_imported INTEGER NOT NULL,
  rows_skipped INTEGER NOT NULL,
  notes_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_observations (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  -- Identity
  product_key TEXT NOT NULL,          -- gtin:… or bn|brand|name|size
  gtin TEXT,
  brand TEXT,                         -- (enc)
  normalized_name TEXT NOT NULL,      -- (enc)
  display_name TEXT NOT NULL,         -- (enc)
  merchant_sku TEXT,
  authoritative INTEGER NOT NULL DEFAULT 0,
  -- Parsed size (normalized to base units so unit price is comparable)
  size_dimension TEXT,                -- volume | weight | count
  size_base_units_per_item INTEGER,
  size_pack_count INTEGER,
  size_total_base_units INTEGER,
  size_base_unit TEXT,                -- ml | g | each
  size_confidence TEXT,
  -- Money (integer cents only)
  list_price_cents INTEGER,
  price_paid_cents INTEGER,
  quantity INTEGER,
  availability TEXT,
  -- Provenance
  source TEXT NOT NULL,               -- cart_scan | search_result | product_page | seed_import | receipt_import
  adapter_id TEXT,
  adapter_version TEXT,
  confidence TEXT NOT NULL,
  import_batch_id TEXT REFERENCES import_batches(id)
);

-- Price history is queried by product over time; this index carries that load.
CREATE INDEX IF NOT EXISTS idx_product_obs_key_date
  ON product_observations(product_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_obs_merchant
  ON product_observations(merchant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_obs_gtin ON product_observations(gtin);

CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- user_confirmed | order_history_import | receipt_import
  subtotal_cents INTEGER,
  fees_cents INTEGER,
  tax_cents INTEGER,
  total_cents INTEGER,
  fulfillment_type TEXT,
  import_batch_id TEXT REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_events_date ON purchase_events(occurred_at DESC);

CREATE TABLE IF NOT EXISTS purchase_event_lines (
  id TEXT PRIMARY KEY,
  purchase_event_id TEXT NOT NULL REFERENCES purchase_events(id),
  product_key TEXT NOT NULL,
  display_name TEXT NOT NULL,         -- (enc)
  gtin TEXT,
  quantity INTEGER NOT NULL,
  paid_unit_price_cents INTEGER,
  line_total_cents INTEGER,
  size_total_base_units INTEGER,
  size_base_unit TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_event ON purchase_event_lines(purchase_event_id);
-- Repurchase cadence is derived by grouping these by product over time.
CREATE INDEX IF NOT EXISTS idx_purchase_lines_key ON purchase_event_lines(product_key);

CREATE TABLE IF NOT EXISTS fee_observations (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  fulfillment_type TEXT,
  basket_subtotal_cents INTEGER,
  delivery_fee_cents INTEGER,
  service_fee_cents INTEGER,
  small_order_fee_cents INTEGER,
  membership_active INTEGER,
  snapshot_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_fee_obs_merchant ON fee_observations(merchant_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS substitution_decisions (
  id TEXT PRIMARY KEY,
  decided_at TEXT NOT NULL,
  wanted_product_key TEXT NOT NULL,
  offered_product_key TEXT NOT NULL,
  offered_display_name TEXT,          -- (enc)
  decision TEXT NOT NULL,             -- accepted | rejected
  reason_hint TEXT
);

CREATE INDEX IF NOT EXISTS idx_substitution_wanted
  ON substitution_decisions(wanted_product_key);
