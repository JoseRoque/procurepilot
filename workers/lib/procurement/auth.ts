/**
 * MVP internal-operator guard: a single shared bearer token compared against
 * `env.ADMIN_API_TOKEN`. This is intentionally minimal for an early-stage
 * internal tool — it has no per-user identity, roles, or audit trail beyond
 * request logging. Replace or supplement with proper SSO/RBAC (e.g.
 * Cloudflare Access, or real user auth) before more than one trusted
 * operator needs access, or before this handles anything more sensitive
 * than early-access marketing leads.
 */

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/** Constant-time-ish string compare (Workers has no Node crypto.timingSafeEqual). */
function constantTimeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	const length = Math.max(aBytes.length, bBytes.length);
	let diff = aBytes.length ^ bBytes.length;
	for (let i = 0; i < length; i++) {
		diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
	}
	return diff === 0;
}

export type AdminAuthResult =
	| { ok: true }
	| { ok: false; status: 401 | 503; message: string };

export function requireAdmin(
	request: Request,
	env: { ADMIN_API_TOKEN?: string },
): AdminAuthResult {
	const configuredToken = env.ADMIN_API_TOKEN;
	if (!configuredToken) {
		return {
			ok: false,
			status: 503,
			message:
				"Admin API is not configured on this environment (ADMIN_API_TOKEN is unset).",
		};
	}

	const header = request.headers.get("authorization") ?? "";
	const match = BEARER_PATTERN.exec(header);
	const provided = match?.[1]?.trim();

	if (!provided || !constantTimeEqual(provided, configuredToken)) {
		return {
			ok: false,
			status: 401,
			message: "Invalid or missing admin credentials.",
		};
	}

	return { ok: true };
}
