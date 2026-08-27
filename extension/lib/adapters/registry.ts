import type { DetectionStatus, SupportedPlatform } from "../types";
import { genericAdapter } from "./generic";
import { mockAdapter } from "./mock";
import { experimentalSiteStubs } from "./siteStubs";
import type { CommercePageAdapter } from "./types";

/**
 * Checked in order. The mock adapter and site stubs only match narrow,
 * explicit signals (a query param, or a known hostname); the generic
 * adapter always matches last as the universal fallback.
 */
const ADAPTERS: CommercePageAdapter[] = [mockAdapter, ...experimentalSiteStubs, genericAdapter];

export function resolveAdapter(url: URL, document: Document): CommercePageAdapter | undefined {
	return ADAPTERS.find((adapter) => adapter.matches(url, document));
}

export function detectPage(
	url: URL,
	document: Document,
): { platform: SupportedPlatform; detectionStatus: DetectionStatus; adapter?: CommercePageAdapter } {
	const adapter = resolveAdapter(url, document);
	if (!adapter) {
		return { platform: "unknown", detectionStatus: "not_detected" };
	}
	return {
		platform: adapter.id,
		detectionStatus: adapter.getDetectionStatus(url, document),
		adapter,
	};
}
