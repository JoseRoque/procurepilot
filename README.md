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
