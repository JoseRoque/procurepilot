# Runbook: Local Data Deletion and Export

## Export (user-initiated)

Sidecar → **Export / Delete local data** → "Export local data (JSON)".

- Includes: local profile, shopping items and preferences, cart snapshots, purchase plans,
  action ledger, consent receipts, config-pack status.
- The UI warns before export: the file contains sensitive local purchasing information.
- Nothing is uploaded; the export is a local file download only.

## Clearing local data (user-initiated, confirmed)

Available granular actions, each behind a confirmation dialog:

1. Clear cart snapshots — deletes `cart_snapshots`, `visible_offers`.
2. Clear plan history — deletes `purchase_plans`, `purchase_plan_items`, `plan_actions`,
   `action_approvals`, `action_results`.
3. Clear action ledger — deletes `local_events` (the hash chain restarts; the UI states
   that verification history is gone).
4. Clear ALL local private data — all of the above plus `shopping_items`,
   `item_preferences`, `merchant_profiles`, `sync_outbox`.

What is retained after "clear all", and why:

- `local_profile` install id + schema version (needed for the app to function),
- active `consent_receipts` row (legal record of the current mode; cleared receipts would
  erase evidence of the user's own choices),
- `configuration_packs` (signed public artifacts, not personal data).

The retention list is displayed verbatim in the confirmation dialog.

## Cloud deletion request

Sidecar → Privacy → "Request cloud deletion". This calls
`POST /api/v1/privacy/deletion-request` with the pseudonymous device id.

- Targets: the device row, stored consent receipt copies, and stored redacted event
  receipts for that device id.
- Processing is recorded as a `privacy_deletion_requests` row and processed by the
  operator; the UI says "queued for deletion" — it does **not** claim instantaneous
  deletion, because that is not implemented.
- Aggregate statistics are not implemented in the alpha, so there is no derived data to
  address beyond stored event records and metadata; the UI explains this.

## Verifying the wipe

After "clear all", run **Verify local ledger** (expected: "empty ledger") and inspect
Export output (expected: only retained records listed above). SQLite file location is
shown in Privacy & sync status for manual inspection.
