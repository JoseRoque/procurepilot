# Consent Model

## Privacy modes

| Mode | Default | Meaning |
| --- | --- | --- |
| `local_only` | **on** | All private shopping data stays on this device. Nothing is queued or sent. |
| `private_backup_disabled` | visible, unavailable | Placeholder for a future encrypted backup. No implementation in this build; the UI says so plainly. |
| `contribute_redacted_outcomes` | off, explicit opt-in | Redacted, schema-validated outcome events may be queued to the sync outbox and exported to Cloudflare when the user flushes the outbox. |

## Consent receipts

Every mode change writes a `consent_receipts` row in the sidecar:

- `id` (receipt ID, referenced by every uploaded event)
- `privacy_mode`
- `consent_version` (the version of the consent copy shown)
- `granted_at`, `revoked_at` (nullable)
- `scope_text` — the exact human-readable scope the user saw
- `app_version` / `extension_version`

Receipts are append-only: revocation writes `revoked_at` on the old receipt and creates a
new `local_only` receipt. A copy of each receipt is also (only under
`contribute_redacted_outcomes`) registered with the Cloudflare API so uploaded events can
be tied to a verifiable consent record.

## Enforcement points (tested)

1. `QUEUE_REDACTED_EVENT` is rejected by the sidecar unless the active receipt is
   `contribute_redacted_outcomes` and unrevoked (`consent.test.ts`).
2. Revocation immediately blocks new queueing and new outbox flushes; already-uploaded
   events are handled via the deletion-request endpoint, not silently.
3. The redacted event schema hard-fails on any prohibited or local-private field
   (`redaction.test.ts`).
4. The Cloudflare `/api/v1/events/redacted` endpoint re-validates the envelope and rejects
   events whose consent receipt is unknown or revoked.

## Required UI copy (verbatim, shown at opt-in)

- "Local-only means your private shopping data stays on this device."
- "Redacted outcomes may include technical adapter version, offer category, bucketed cart
  amount, confidence, and whether a visible offer appeared to apply."
- "It does not include cookies, credentials, payment data, raw cart contents, addresses,
  or full browsing history."
- "With one user, this data does not create shared deal intelligence."
