/**
 * Default per-fingerprint submission cap. Deliberately a plain constant (not
 * an env var) so it can be bumped in code review without touching secrets;
 * override with LEAD_RATE_LIMIT_MAX_PER_HOUR if ops needs to tune it without
 * a code change.
 */
export const DEFAULT_RATE_LIMIT_MAX_PER_HOUR = 5;

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const DEV_FALLBACK_SALT =
	"dev-only-insecure-fallback-salt-do-not-use-in-production";

/**
 * Resolves the salt used to hash IP/user-agent fingerprints. Falls back to a
 * clearly-labeled insecure constant only when LEAD_HASH_SALT is unset, which
 * should only ever happen in local development.
 */
export function resolveHashSalt(env: { LEAD_HASH_SALT?: string }): string {
	if (env.LEAD_HASH_SALT) return env.LEAD_HASH_SALT;
	console.warn(
		"[procurement] LEAD_HASH_SALT is not configured; using an insecure development-only fallback salt. Set LEAD_HASH_SALT (see .dev.vars.example) before deploying.",
	);
	return DEV_FALLBACK_SALT;
}

/** SHA-256 hash of `${salt}:${value}`, hex-encoded. Never store the raw value. */
export async function hashFingerprint(value: string, salt: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${salt}:${value}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function resolveRateLimitMax(env: {
	LEAD_RATE_LIMIT_MAX_PER_HOUR?: string;
}): number {
	const override = Number(env.LEAD_RATE_LIMIT_MAX_PER_HOUR);
	return Number.isFinite(override) && override > 0
		? Math.trunc(override)
		: DEFAULT_RATE_LIMIT_MAX_PER_HOUR;
}

type RateLimitBucket = { count: number; windowStart: number };

/**
 * Best-effort, single-isolate fixed-window rate limiter.
 *
 * LIMITATION: this Map lives in one Worker isolate's memory only. Cloudflare
 * may route a client's requests across many isolates/colos, and any isolate
 * can be evicted and recreated at any time, so this is only a soft speed
 * bump against naive repeated form posts from a single client — it is NOT a
 * durable or distributed rate limiter. For real abuse protection, back this
 * with a Durable Object or an atomic KV/D1 counter.
 */
const buckets = new Map<string, RateLimitBucket>();

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(
	fingerprintHash: string,
	maxPerWindow: number,
	now: number = Date.now(),
): RateLimitCheck {
	const bucket = buckets.get(fingerprintHash);
	if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
		buckets.set(fingerprintHash, { count: 1, windowStart: now });
		return { allowed: true };
	}
	if (bucket.count >= maxPerWindow) {
		const retryAfterSeconds = Math.max(
			1,
			Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
		);
		return { allowed: false, retryAfterSeconds };
	}
	bucket.count += 1;
	return { allowed: true };
}

/** Drops expired buckets so long-lived isolates don't grow this Map unbounded. */
export function pruneRateLimitBuckets(now: number = Date.now()): void {
	for (const [key, bucket] of buckets) {
		if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
			buckets.delete(key);
		}
	}
}

/** Test-only: clears all rate-limit state between test cases. */
export function __resetRateLimitStateForTests(): void {
	buckets.clear();
}
