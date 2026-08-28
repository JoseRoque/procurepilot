# Purchasing Intelligence — Platinum-Ready Alpha Architecture

Status: single-user private alpha. Local-first. No collective intelligence is generated or
displayed — with one user there is no valid crowd signal, and the UI must never imply one.

## Repository layout (actual)

This repo predates the monorepo proposal. To avoid destabilizing the working web app and
extension, we kept the existing conventions and added siblings instead of moving projects
under `apps/`:

| Suggested tree            | Actual location            | Notes |
| ---                       | ---                        | --- |
| `apps/web`                | repo root (`app/`, `workers/`) | Existing React Router + Hono Cloudflare app |
| `apps/extension`          | `extension/`               | Existing Bronze MV3 extension, own package.json |
| `apps/sidecar`            | `sidecar/`                 | New Tauri 2 desktop companion |
| `packages/domain`         | `packages/domain`          | Shared domain models (source-only TS) |
| `packages/protocol`       | `packages/protocol`        | Zod schemas: bridge + telemetry + API envelopes |
| `packages/optimizer`      | `packages/optimizer`       | Pure deterministic planning engine |
| `packages/config-kit`     | `packages/config-kit`      | Signed config-pack models + Ed25519 verification |
| `packages/test-fixtures`  | `packages/test-fixtures`   | Sanitized commerce fixtures + demo store page |
| `infra/cloudflare/migrations` | `migrations/`          | Existing D1 migrations dir, extended |
| `docs/*`                  | `docs/*`                   | As proposed |

Packages are **source-only TypeScript** consumed via the `@pi/*` path alias from the web
worker, the extension, the sidecar frontend, and every vitest config. No npm-workspace
migration was performed: the root package.json *is* the web app, and changing hoisting
would risk the wrangler/vite toolchain for zero functional gain at this stage. This is the
documented "least invasive" choice the plan allows.

## System data flow

```
SUPPORTED COMMERCE PAGE
  ↓ user clicks scan / approves an action (never automatic)
CONTENT SCRIPT (extension/entrypoints/injected-content-script.ts)
  reads narrow visible facts · executes only approved+bounded actions · refuses sensitive pages
  ↓ typed, Zod-validated runtime messages (tabId always taken from sender.tab.id)
MV3 SERVICE WORKER (extension/entrypoints/background.ts)
  routes messages · persists nothing durable in module memory
  ↓ loopback HTTP bridge — 127.0.0.1 only, per-install pairing token (alpha bridge)
TAURI SIDECAR (sidecar/)
  SQLite persistence · OS-keychain master key · deterministic optimizer (@pi/optimizer)
  plan manager · approval engine · hash-chained audit ledger · sync outbox · pack verifier
  ↓ explicit, consent-gated, redacted, schema-validated export only
CLOUDFLARE HONO API (workers/lib/pi/)
  device registration · consent receipts · redacted test-event receipt
  signed config-pack index/serving · deletion requests · NO raw cart storage
```

## Core rule

KNOWN FACTS + DETERMINISTIC POLICY + INTEGER-CENT MATH = DEFAULT DECISION ENGINE.

`@pi/optimizer` is pure: no Chrome, DOM, Tauri, or Cloudflare imports (enforced by a
purity test in `packages/optimizer/src/purity.test.ts`). It receives normalized facts and
preferences and returns explainable plan objects. When facts are missing it says
"unknown" / "not detected" / "review required" — it never fabricates confidence. No LLM,
embedding, or agent runtime exists anywhere in this build.

## Sidecar internal architecture

The Rust core owns everything that must outlive a webview: the SQLite database, the
OS-keychain master key, field encryption (AES-256-GCM), and the loopback bridge listener.
Business logic (repositories, optimizer invocation, ledger hashing, redaction, consent)
runs in the TypeScript frontend, which is the single implementation shared with the
extension's local fallback. Bridge requests are forwarded from Rust to the frontend via a
Tauri event + oneshot-channel round trip; this means **the bridge only answers while the
sidecar window is running** — an accepted, documented alpha limitation (Native Messaging
is the hardened successor, deferred).

## What is intentionally NOT here

- Checkout / payment / login / address / gift-card automation of any kind.
- Cookie, token, credential, or header access (no `cookies`, `webRequest`, `debugger`,
  `history`, or `nativeMessaging` permissions).
- Background or repeated scanning.
- Any AI/LLM/model call, local or remote.
- Cross-user aggregation, community insight, or claims of one.
- Cloudflare Browser Rendering for authenticated shopping flows.
- Durable Objects — no active sync coordination exists in the alpha (one device, one
  explicit outbox flush); deferred until multi-device sync is a real requirement.
