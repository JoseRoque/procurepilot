# Data Classification

Every field the system touches belongs to exactly one class. Code review and the
serialization tests in `packages/protocol` enforce the boundaries marked "tested".

| Class | Examples | Rule |
| --- | --- | --- |
| **Prohibited** | cookies, session tokens, auth headers, passwords, MFA/OTP codes, CAPTCHA data, card numbers/CVV, bank details, gift-card numbers/PINs, delivery addresses, precise location, phone numbers from merchant pages, raw full-page HTML, full-page screenshots | Never read, stored, or transmitted, anywhere. The content script refuses sensitive pages before extraction; no Chrome permission that could reach this data is requested. |
| **Local private** | shopping list, item preferences, exact cart line names, visible raw offer text, user notes, purchase plans, action payloads, action/evidence ledger | Sidecar SQLite only. Sensitive text fields encrypted at rest (AES-256-GCM, key in OS keychain). Never leaves the device. |
| **Private sync (future)** | user-authorized encrypted backup of local private data | **Not active in this build.** Shown in UI as "Private backup — not available in this version". No implementation exists. |
| **Redacted telemetry** | platform family, adapter id/version, offer *type*, bucketed subtotal (`under_25` … `100_plus`), confidence, action outcome, config-pack version | Opt-in only (`contribute_redacted_outcomes`). Schema-validated and redaction-tested (`redaction.test.ts`) before entering the sync outbox. One test export in alpha. |
| **Derived shared insight** | aggregation-ready reliability/confidence statistics | **No insight is generated or published in the single-user alpha.** The schema is versioned so a future multi-user system could aggregate, but nothing does. |

## Field-level notes

- `cart_snapshots.raw_html_stored` and `cookies_read` are hard-coded `false` and
  attestation-checked by the Zod schema — a snapshot claiming otherwise is rejected at
  every boundary.
- Redacted events carry `pageUrlOrigin`-derived platform family only — never a URL path,
  query string, or hostname beyond the adapter's platform id.
- The audit ledger stays local; "Verify local ledger" recomputes the hash chain on-device
  and never uploads it.
- Exports are user-initiated JSON downloads with an explicit warning that they contain
  sensitive local purchasing data. Nothing auto-uploads an export.
