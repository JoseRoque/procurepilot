import type { CartSnapshotDraft, SupportedPlatform } from "../types";

export type { CartSnapshotDraft };

/**
 * A CommercePageAdapter knows how to recognize one storefront/checkout
 * pattern and extract only visible, non-sensitive cart facts from it.
 * Adapters never read cookies, storage, or anything outside `document`.
 */
export interface CommercePageAdapter {
	id: SupportedPlatform;
	label: string;
	/** Cheap, synchronous check: does this adapter apply to this page at all? */
	matches(url: URL, document: Document): boolean;
	/** Assuming matches() is true, how confidently can we extract here? */
	getDetectionStatus(url: URL, document: Document): "supported" | "experimental" | "scan_unavailable";
	extract(document: Document, url: URL): Promise<CartSnapshotDraft>;
}
