import { DEMO_FIXTURES, type DemoFixtureKey } from "../demoFixtures";
import type { CommercePageAdapter, CartSnapshotDraft } from "./types";

const DEMO_QUERY_PARAM = "pi_demo";
const VALID_KEYS: DemoFixtureKey[] = ["below_threshold", "discount_and_credit", "inconsistent_total"];

function isDemoFixtureKey(value: string | null): value is DemoFixtureKey {
	return value !== null && (VALID_KEYS as string[]).includes(value);
}

/**
 * Lets the full content-script → background → side panel pipeline be
 * exercised on any page by appending `?pi_demo=<fixtureKey>` to the URL —
 * useful for manual QA without needing a real merchant site. Never matches
 * without that explicit query param.
 */
export const mockAdapter: CommercePageAdapter = {
	id: "generic",
	label: "Demo fixture",

	matches(url: URL): boolean {
		return url.searchParams.has(DEMO_QUERY_PARAM);
	},

	getDetectionStatus(): "supported" {
		return "supported";
	},

	async extract(_document: Document, url: URL): Promise<CartSnapshotDraft> {
		const requested = url.searchParams.get(DEMO_QUERY_PARAM);
		const key = isDemoFixtureKey(requested) ? requested : "below_threshold";
		return { ...DEMO_FIXTURES[key] };
	},
};
