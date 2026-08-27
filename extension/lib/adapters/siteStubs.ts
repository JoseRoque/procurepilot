import type { SupportedPlatform } from "../types";
import type { CommercePageAdapter, CartSnapshotDraft } from "./types";

/**
 * These are intentionally NOT real integrations. Building durable extraction
 * for a live commerce site requires ongoing verification against that site's
 * actual markup, which changes without notice — hardcoding selectors here
 * without that verification would be exactly the "fragile or deceptive
 * selectors... as if they are durable production integrations" this project
 * was asked not to ship. Each stub only identifies the platform by hostname
 * (a stable, public signal) and is honest about not extracting anything yet.
 * The generic adapter remains available on these sites as a fallback.
 */
function createExperimentalStub(
	id: SupportedPlatform,
	label: string,
	hostnamePattern: RegExp,
): CommercePageAdapter {
	return {
		id,
		label,
		matches(url: URL): boolean {
			return hostnamePattern.test(url.hostname);
		},
		getDetectionStatus(): "experimental" {
			return "experimental";
		},
		async extract(_document: Document, url: URL): Promise<CartSnapshotDraft> {
			return {
				platform: id,
				platformLabel: label,
				detectionStatus: "experimental",
				pageUrlOrigin: url.origin,
				pagePathHint: url.pathname,
				items: [],
				visibleOffers: [],
				confidence: "low",
				extractionNotes: [
					`Site-specific extraction for ${label} is experimental and not yet implemented in this Bronze release.`,
					"Use the generic detector's results (if any) and review the page manually.",
				],
			};
		},
	};
}

export const doordashStub = createExperimentalStub("doordash", "DoorDash", /(^|\.)doordash\.com$/i);
export const ubereatsStub = createExperimentalStub("ubereats", "Uber Eats", /(^|\.)ubereats\.com$/i);
export const instacartStub = createExperimentalStub("instacart", "Instacart", /(^|\.)instacart\.com$/i);
export const targetStub = createExperimentalStub("target", "Target", /(^|\.)target\.com$/i);
export const walmartStub = createExperimentalStub("walmart", "Walmart", /(^|\.)walmart\.com$/i);

export const experimentalSiteStubs: CommercePageAdapter[] = [
	doordashStub,
	ubereatsStub,
	instacartStub,
	targetStub,
	walmartStub,
];
