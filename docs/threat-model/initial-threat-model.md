# Initial Threat Model (Alpha)

Scope: single developer-user, one device, local-first. This model is honest about what the
alpha does and does not defend against.

## Assets

1. Local private shopping data (SQLite, encrypted fields).
2. The local master encryption key (OS keychain).
3. The bridge pairing token.
4. The device token for Cloudflare API calls.
5. The config-pack verification public key / signed packs.
6. The user's merchant browser session (never touched — remains browser state).

## Adversaries and mitigations

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Malicious web page talks to the bridge | Bridge binds to 127.0.0.1 only; every request requires the per-install pairing token; token lives in extension storage, never in page context; content scripts never hold it | A local process that can read extension storage or the keychain already owns the machine |
| Another local process hits the bridge | Same token requirement; token is random per install | Local malware with user privileges is out of scope (documented) |
| Page injects spoofed extension messages | All runtime messages Zod-validated; `tabId` only ever taken from `sender.tab.id`; content-script messages cannot claim scan-trigger or approval message types | — |
| Merchant page tricks extraction into sensitive data | Sensitive-page heuristics run before chip injection and before extraction; extraction budget bounds text volume; prohibited-field schema rejection at every boundary | Heuristics are conservative but not perfect; scan is user-initiated, which bounds exposure |
| Tampered config pack enables unsafe behavior | Ed25519 signature verified before storage/use; packs are data-only; action types, budgets, and approval requirements are enforced in code, not configurable; expiry + min-version + rollout stage checked; invalid/disabled/expired pack ⇒ generic scan-only fallback | Compromise of the signing private key (kept out of repo; dev key clearly labeled non-production) |
| Telemetry leaks private data | Opt-in consent gate; strict allowlist schema; redaction serialization tests; server re-validates and stores minimal envelope | — |
| Ledger tampering | SHA-256 hash chain, verifiable on demand | The ledger is **tamper-evident, not immutable**: an attacker with full local write access can rewrite the whole chain. Stated in the UI and runbook. |
| Action harness misuse | Only 6 reversible action types exist in code; explicit approval with expiry per action; page-origin + state-hash preconditions; stop conditions; ≤3 actions/plan, ≤1 retry, dedupe hash; checkout/payment/login pages hard-stop | — |
| MV3 service worker state loss | No durable state in worker memory; sidecar SQLite + chrome.storage.local hold everything durable | — |

## Explicit non-goals (alpha)

- Defending against a fully compromised local device or OS.
- Anti-forensics or immutability of local records.
- Network anonymity (Cloudflare sees standard connection metadata for opted-in exports).
- Multi-user isolation (there is one user).
