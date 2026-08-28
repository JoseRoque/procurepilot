import { canonicalize } from "../../optimizer/src/dedupe";

/**
 * Cryptographic hashing for the audit ledger, event integrity, and approval
 * scope binding. Uses WebCrypto SHA-256 (available in Chrome, workers, Node
 * 20+, and Tauri webviews).
 */

export async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Stable canonical JSON so equal payloads always hash equally. */
export function canonicalJson(value: unknown): string {
	return canonicalize(value);
}

/**
 * Ledger chaining rule (docs/threat-model):
 *   event_hash = SHA-256(previous_hash + canonical_payload + timestamp + event_id)
 */
export async function chainEventHash(args: {
	previousHash: string | null;
	payload: unknown;
	occurredAt: string;
	eventId: string;
}): Promise<string> {
	return sha256Hex(
		`${args.previousHash ?? "genesis"}|${canonicalJson(args.payload)}|${args.occurredAt}|${args.eventId}`,
	);
}

/** Binds an approval to the exact action payload + page state it was shown for. */
export async function approvalScopeHash(args: {
	actionId: string;
	actionType: string;
	payload: Record<string, unknown>;
	pageOrigin: string;
	pageStateHash?: string;
}): Promise<string> {
	return sha256Hex(
		`${args.actionId}|${args.actionType}|${canonicalJson(args.payload)}|${args.pageOrigin}|${args.pageStateHash ?? "no-page-state"}`,
	);
}

/** Integrity hash for a redacted telemetry event (over everything except the hash itself). */
export async function eventIntegrityHash(event: Record<string, unknown>): Promise<string> {
	const { eventIntegrityHash: _omit, ...rest } = event;
	return sha256Hex(canonicalJson(rest));
}
