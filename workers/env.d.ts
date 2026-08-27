// Extends the wrangler-generated `Env` (worker-configuration.d.ts) with
// bindings/secrets that aren't declared in wrangler.jsonc yet: D1 is
// optional until provisioned (see migrations/0001_procurement_early_access.sql
// and the README), and secrets are intentionally never written in plaintext
// to wrangler.jsonc — they're set via `wrangler secret put` / `.dev.vars`.
declare global {
	interface Env {
		DB?: D1Database;
		ADMIN_API_TOKEN?: string;
		LEAD_HASH_SALT?: string;
		LEAD_RATE_LIMIT_MAX_PER_HOUR?: string;
	}
}

export {};
