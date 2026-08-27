import type { CartSnapshot, CartSnapshotDraft } from "./types";

/**
 * Stamps a draft (produced by an adapter) with generated fields and the
 * fixed privacy attestation. This is the only place these fields are set —
 * adapters never claim them themselves.
 */
export function completeCartSnapshot(draft: CartSnapshotDraft): CartSnapshot {
	return {
		...draft,
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		privacy: {
			localOnly: true,
			piiRedacted: true,
			rawHtmlStored: false,
			cookiesRead: false,
		},
	};
}
