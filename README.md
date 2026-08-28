# Hono + React Router + Vite + ShadCN UI on Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/react-router-hono-fullstack-template)
![Build modern full-stack apps with Hono, React Router, and ShadCN UI on Cloudflare Workers](https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/24c5a7dd-e1e3-43a9-b912-d78d9a4293bc/public)

<!-- dash-content-start -->

A modern full-stack template powered by [Cloudflare Workers](https://workers.cloudflare.com/), using [Hono](https://hono.dev/) for backend APIs, [React Router](https://reactrouter.com/) for frontend routing, and [shadcn/ui](https://ui.shadcn.com/) for beautiful, accessible components styled with [Tailwind CSS](https://tailwindcss.com/).

Built with the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) for optimized static asset delivery and seamless local development. React is configured in single-page app (SPA) mode via Workers.

A perfect starting point for building interactive, styled, and edge-deployed SPAs with minimal configuration.

## Features

- ⚡ Full-stack app on Cloudflare Workers
- 🔁 Hono for backend API endpoints
- 🧭 React Router for client-side routing
- 🎨 ShadCN UI with Tailwind CSS for components and styling
- 🧱 File-based route separation
- 🚀 Zero-config Vite build for Workers
- 🛠️ Automatically deploys with Wrangler
- 🔎 Built-in Observability to monitor your Worker
<!-- dash-content-end -->

## Tech Stack

- **Frontend**: React + React Router + ShadCN UI
  - SPA architecture powered by React Router
  - Includes accessible, themeable UI from ShadCN
  - Styled with utility-first Tailwind CSS
  - Built and optimized with Vite

- **Backend**: Hono on Cloudflare Workers
  - API routes defined and handled via Hono in `/api/*`
  - Supports REST-like endpoints, CORS, and middleware

- **Deployment**: Cloudflare Workers via Wrangler
  - Vite plugin auto-bundles frontend and backend together
  - Deployed worldwide on Cloudflare’s edge network

## Purchasing Intelligence — local-first alpha

A private, single-user alpha that turns a shopping list, purchasing preferences, and
**user-initiated** scans of visible cart pages into an explainable purchase plan — and can
execute a small set of **explicitly approved, reversible** browser actions. It never
automates checkout, never touches payment or login, and never reads cookies.

> **Collective intelligence is intentionally inactive.** With one user there is no valid
> crowd signal, so nothing in the product claims, computes, or displays community,
> regional, or "verified deal" intelligence.

### Repository layout

| Path | What it is |
| --- | --- |
| repo root (`app/`, `workers/`) | Cloudflare React Router + Hono web app (landing pages, early-access API, PI API) |
| `extension/` | Chrome MV3 extension (scan, side panel, action harness) — own `package.json` |
| `sidecar/` | Tauri 2 desktop companion: SQLite, keychain-backed encryption, planner, ledger |
| `packages/domain` | Shared domain models |
| `packages/protocol` | Zod schemas + hashing for every trust boundary |
| `packages/optimizer` | Pure deterministic planning engine (no Chrome/DOM/Tauri/Cloudflare imports) |
| `packages/config-kit` | Signed, data-only configuration packs (Ed25519) |
| `packages/test-fixtures` | Sanitized commerce fixtures + the demo store page |
| `migrations/` | D1 migrations |
| `docs/` | Architecture, privacy, threat model, adapter contract, runbooks |

This is **not** an npm-workspace monorepo. The root `package.json` *is* the web app; the
extension and sidecar have their own. Packages are consumed as source-only TypeScript via
relative paths. See `docs/architecture/overview.md` for why that trade-off was made.

### Run it

```bash
# 1. Web app + API  (repo root)
npm install
npm run dev                      # http://localhost:5173

# 2. Sidecar (separate terminal) — requires Rust: https://rustup.rs
cd sidecar && npm install
npm run tauri dev                # opens the desktop app; bridge on 127.0.0.1:43180

# 3. Extension (separate terminal)
cd extension && npm install
npm run build                    # → extension/.output/chrome-mv3
```

Load the extension: `chrome://extensions` → enable **Developer mode** → **Load unpacked**
→ select `extension/.output/chrome-mv3`. (Chrome now ignores `--load-extension` on the
command line, so this one step must be done by hand.)

**Pair the extension with the sidecar:** sidecar → *Privacy & sync* → copy the pairing
token → extension side panel → *Planner* tab → enable "Use local sidecar" → paste the
token → **Pair**. Chrome will prompt for the `http://127.0.0.1/*` optional permission.

### Try it without visiting a store

- **Sidecar demo fixtures**: enable *Demo mode* in Preferences, then load a fixture cart in
  *Cart snapshots* and create a plan from it.
- **Demo store page**: open `packages/test-fixtures/pages/demo-store.html` in Chrome, then
  scan it from the side panel. To exercise approved actions, first load the dev
  configuration pack in the sidecar (*Configuration packs* → "Load local dev pack").
- **Extension demo tab**: static fixtures for the Bronze recommendation UI.

### Tests

```bash
npm test                    # root: packages, workers, sidecar core (136 tests)
cd extension && npm test    # extension (88 tests)

npm run typecheck                       # root + packages
cd extension && npm run compile         # extension
cd sidecar && npm run build             # sidecar tsc + vite
cd sidecar/src-tauri && cargo check      # sidecar Rust core
```

### D1 (provisioned and live)

D1 database `procurement-leads` is created, bound as `DB` in `wrangler.jsonc`, and both
migrations are applied to the deployed environment. Early-access leads and all
`/api/v1/*` data persist durably.

Applying migrations (needed for a fresh local DB, or when adding a new migration):

```bash
npx wrangler d1 execute procurement-leads --local  --file=migrations/0001_procurement_early_access.sql
npx wrangler d1 execute procurement-leads --local  --file=migrations/0002_purchasing_intelligence.sql
# swap --local for --remote to apply to the deployed database
```

Required Worker secrets (set via `npx wrangler secret put <NAME>`; mirror them into a
gitignored `.dev.vars` for local dev): `ADMIN_API_TOKEN`, `LEAD_HASH_SALT`,
`CONFIG_PACK_PUBLIC_KEY`.

Without the `DB` binding the leads API silently degrades to a **non-durable in-memory
store** and `/api/v1/*` returns 503 — so keep the binding in place.

Publishing a configuration pack:

```bash
node scripts/sign-config-pack.mjs pack.json --key <hex> --out signed.json
# then insert into configuration_packs + configuration_pack_versions (see migration 0002)
```

### API endpoints (v1)

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/devices/register` | none (mints a device token) |
| POST | `/api/v1/consent/receipts` | device bearer token |
| POST | `/api/v1/events/redacted` | device bearer token |
| GET | `/api/v1/config-packs/index` | none (public signed artifacts) |
| GET | `/api/v1/config-packs/:packId/:version` | none |
| POST | `/api/v1/privacy/deletion-request` | device bearer token |

Identity is a sidecar-generated **pseudonymous device id** — never an email. The server
stores only a SHA-256 hash of the device token. All personal endpoints send
`Cache-Control: no-store`.

```bash
curl -X POST http://localhost:5173/api/v1/devices/register \
  -H "Content-Type: application/json" \
  -d '{"pseudonymousDeviceId":"dev-example12345","appVersion":"0.1.0","platform":"macos"}'
```

### Environment variables

See `.dev.vars.example` (web/worker) and `sidecar/.env.example` (sidecar). Placeholders
only — no real secrets are committed.

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONFIG_PACK_PUBLIC_KEY` | worker / sidecar | Ed25519 public key for verifying config packs |
| `LOCAL_BRIDGE_PORT` | sidecar | Loopback bridge port (default 43180) |
| `VITE_PI_API_BASE` | sidecar | Cloudflare API base for optional sync |
| `ADMIN_API_TOKEN`, `LEAD_HASH_SALT` | worker | Existing early-access API (unchanged) |

The bridge pairing token is **not** an env var: the sidecar generates a random one per
install and stores it locally. Configuration packs are signed with a private key that must
never enter this repo — `packages/test-fixtures/src/devKeys.ts` holds a clearly-labeled
**non-production** dev key so signing/verification can be developed offline.

Sign a pack: `node scripts/sign-config-pack.mjs pack.json --key <hex> --out signed.json`

### Safety boundary

**Never implemented, anywhere in this codebase:** checkout, "place order", pay, or submit;
payment/card/CVV/bank handling; gift-card or loyalty redemption; address editing; login,
password, MFA/OTP, or CAPTCHA handling; cookie/token/header access; background or repeated
scanning; hidden page interaction; anti-bot evasion; promo-code brute forcing; raw
full-page HTML or screenshot capture; any LLM/AI model call.

The extension requests exactly four permissions — `storage`, `activeTab`, `scripting`,
`sidePanel` — plus **optional** `http://127.0.0.1/*`, granted only when you pair with the
sidecar. There is no static `content_scripts` entry and no host permissions: the content
script is injected only in direct response to your click.

**The six actions that can ever run**, each requiring individual approval that binds to the
exact payload and page state and expires in 5 minutes: `open_visible_offers`,
`search_exact_item`, `add_exact_approved_item`, `adjust_quantity`,
`remove_optional_item`, `rescan_cart`. Hard caps: ≤3 executed actions per plan, ≤1 retry,
duplicate-action blocking, and immediate stop on origin change, page-state change,
sensitive-page detection, low adapter confidence, or a missing element.

### Data locality

Local by default and in practice: the shopping list, snapshots, plans, action ledger, and
consent receipts live in the sidecar's SQLite database, with sensitive text fields
encrypted at rest (AES-256-GCM, key in the OS keychain — the UI states plainly when the
keychain is unavailable and encryption is therefore off).

Nothing syncs automatically. Redacted outcome events can only be *queued* after you
explicitly opt in, and only *uploaded* when you press "Flush outbox". Those events carry
bucketed and typed values only — never cart contents, offer text, URLs, addresses, or
identity. See `docs/privacy/data-classification.md`.

### Known alpha limitations

- **Bridge availability**: the loopback bridge answers only while the sidecar window is
  running (requests round-trip through the webview). Native Messaging is the hardened
  successor and is deferred.
- **Ledger is tamper-evident, not immutable**: an attacker with full local write access can
  rewrite the whole chain. "Verify local ledger" detects accidental or partial tampering.
- **Site adapters**: only the bundled demo-store fixture has action capabilities. The five
  named storefront stubs (DoorDash, Uber Eats, Instacart, Target, Walmart) are
  hostname-detection-only and scan-only, and are honest about it — no fragile selectors are
  shipped as if they were durable integrations.
- **Rate limiting** (both the API and the extension's Bronze limiter) is a best-effort
  single-isolate counter, not a distributed guarantee.
- **Cloud deletion** is queued for operator processing; the UI does not claim instant
  deletion because that is not implemented.
- **No private encrypted backup** — the mode is shown as unavailable, with no implementation.

### Deliberately deferred

Durable Objects (no active sync coordination is needed for one device), Cloudflare Queues
and Workflows, R2 (packs are small enough to serve inline from D1), Browser Rendering,
multi-tenant access control, and any AI/LLM integration.

## Procurement early-access backend

Backend for the `/procurement` landing page's early-access form. This is intake and lead-management infrastructure only — no purchasing automation, browser extension, supplier integrations, or AI features are implemented here.

**Endpoints**

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/procurement-early-access` | none (public) | Submit the early-access form |
| GET | `/api/admin/procurement-early-access` | Bearer token | List leads (`?status=`, `?limit=`, `?cursor=`) |
| GET | `/api/admin/procurement-early-access/export.csv` | Bearer token | CSV export of all leads |
| PATCH | `/api/admin/procurement-early-access/:id` | Bearer token | Update a lead's status |

All admin responses are sent with `Cache-Control: no-store` and never include `ipHash`/`userAgentHash`.

**Run locally**

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in real random values
npm run dev
```

**Configure `.dev.vars`**

```text
ADMIN_API_TOKEN=replace-with-a-long-random-token   # openssl rand -hex 32
LEAD_HASH_SALT=replace-with-a-long-random-secret   # openssl rand -hex 32
```

Without `.dev.vars`, the public form endpoint still works (falling back to an insecure dev-only hash salt, logged loudly as a warning), but every `/api/admin/*` route returns `503` until `ADMIN_API_TOKEN` is set — there is no "open" fallback mode.

**D1 migration (optional — falls back to in-memory without it)**

The project runs without a database: with no `DB` binding, leads are kept in an **in-memory, per-isolate store that is lost on every restart/redeploy**. This is fine for local development only. To persist leads durably:

```bash
npx wrangler d1 create procurement-leads
# paste the returned database_id into the commented [[d1_databases]] block in wrangler.jsonc, then uncomment it

npx wrangler d1 execute procurement-leads --local  --file=migrations/0001_procurement_early_access.sql
npx wrangler d1 execute procurement-leads --remote --file=migrations/0001_procurement_early_access.sql
```

Once `env.DB` is bound, the D1-backed repository is used automatically — no code changes required.

**Test the public form API**

```bash
curl -X POST http://localhost:5173/api/procurement-early-access \
  -H "Content-Type: application/json" \
  -d '{
    "workEmail": "name@company.example",
    "fullName": "Example Name",
    "companyName": "Example Company",
    "jobTitle": "Procurement Director",
    "companySize": "201-1000",
    "biggestChallenge": "Low contract utilization",
    "primaryCategories": ["Facilities and office supplies"],
    "purchasingChannels": ["ERP / P2P system"],
    "pilotInterest": true
  }'
```

A second submission with the same (case-insensitive) email returns `200` with a neutral "already on the list" message instead of creating a duplicate row.

**Use the admin endpoints**

```bash
curl http://localhost:5173/api/admin/procurement-early-access \
  -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN"

curl http://localhost:5173/api/admin/procurement-early-access/export.csv \
  -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN" -o leads.csv

curl -X PATCH http://localhost:5173/api/admin/procurement-early-access/LEAD_ID \
  -H "Authorization: Bearer YOUR_ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "qualified"}'
```

**Run tests**

```bash
npm test
```

**MVP limitations (deliberate, documented tradeoffs)**

- **Admin auth** is a single shared bearer token with no per-user identity, roles, or audit trail — an internal-operator guard appropriate for one or two trusted operators at this stage, not multi-user production administration. Replace with Cloudflare Access, SSO, or real user auth before that changes.
- **Rate limiting** is a best-effort, single-isolate in-memory counter (~5 submissions/hour/fingerprint, tunable via `LEAD_RATE_LIMIT_MAX_PER_HOUR`). It is not durable or distributed — a determined abuser spread across many Cloudflare colos/isolates can exceed it. Back this with a Durable Object or atomic KV/D1 counter for real abuse protection.
- **In-memory repository** (used whenever `DB` isn't bound) loses all data on every Worker restart. Never rely on it beyond local development.
- **Early-access intake must never be used to collect confidential procurement, supplier, payment, contract, or account data.** The form and its privacy microcopy say so explicitly; nothing server-side redacts free-text fields beyond basic sanitization, so this is a policy boundary, not a technical one.

## Resources

- 🧩 [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- 📦 [Vite Plugin for Cloudflare](https://developers.cloudflare.com/workers/vite-plugin/)
- 🛠 [Wrangler CLI reference](https://developers.cloudflare.com/workers/wrangler/)
- 🎨 [shadcn/ui](https://ui.shadcn.com)
- 💨 [Tailwind CSS Documentation](https://tailwindcss.com/)
- 🔀 [React Router Docs](https://reactrouter.com/)
