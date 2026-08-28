/**
 * Deterministic, synchronous anti-loop key for proposed actions. This is a
 * loop-prevention key, not a security primitive — cryptographic hashing for
 * the audit ledger and approval scopes lives in packages/protocol (SHA-256).
 */

/** Stable stringify: object keys sorted recursively so equal payloads hash equally. */
export function canonicalize(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalize).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
	return `{${entries.join(",")}}`;
}

/** FNV-1a 64-bit over UTF-16 code units, hex-encoded. */
export function fnv1a64Hex(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;
	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}

export function actionDedupeHash(
	actionType: string,
	payload: Record<string, unknown>,
	pageStateHash: string | undefined,
): string {
	return fnv1a64Hex(`${actionType}|${canonicalize(payload)}|${pageStateHash ?? "no-page-state"}`);
}
