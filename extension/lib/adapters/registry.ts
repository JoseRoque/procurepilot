import type { DetectionStatus, SupportedPlatform } from "../types";
import { demoStoreAdapter } from "./demoStore";
import { genericAdapter } from "./generic";
import { mockAdapter } from "./mock";
import { experimentalSiteStubs } from "./siteStubs";
import type { CommercePageAdapter } from "./types";

/**
 * Checked in order. The mock adapter, demo-store fixture adapter, and site
 * stubs only match narrow, explicit signals (a query param, the fixture's
 * own markers, or a known hostname); the generic adapter always matches
 * last as the universal fallback.
 */
const ADAPTERS: CommercePageAdapter[] = [
	mockAdapter,
	demoStoreAdapter,
	...experimentalSiteStubs,
	genericAdapter,
];

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
