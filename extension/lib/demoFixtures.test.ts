import { describe, expect, it } from "vitest";
import { DEMO_FIXTURES } from "./demoFixtures";
import { createCartRecommendation } from "./engine";
import { completeCartSnapshot } from "./snapshotFactory";
import { DEFAULT_PREFERENCES } from "./types";

describe("demo fixtures", () => {
	it("below_threshold: recommends review with a grounded threshold gap", () => {
		const snapshot = completeCartSnapshot(DEMO_FIXTURES.below_threshold);
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.action).toBe("review_before_checkout");
		expect(recommendation.thresholdGapCents).toBe(358); // 3500 - 3142
		expect(recommendation.warnings.length).toBeGreaterThan(0);
	});

	it("discount_and_credit: reconciles cleanly with no discrepancy warning", () => {
		const snapshot = completeCartSnapshot(DEMO_FIXTURES.discount_and_credit);
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.action).not.toBe("review_before_checkout");
		expect(recommendation.rationale.join(" ")).not.toMatch(/doesn't match|discrepanc/i);
	});

	it("inconsistent_total: flags the mismatch and recommends review", () => {
		const snapshot = completeCartSnapshot(DEMO_FIXTURES.inconsistent_total);
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.action).toBe("review_before_checkout");
		expect(recommendation.warnings.join(" ")).toMatch(/review/i);
	});

	it("all fixtures produce a snapshotId matching the generated snapshot", () => {
		for (const fixture of Object.values(DEMO_FIXTURES)) {
			const snapshot = completeCartSnapshot(fixture);
			const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
			expect(recommendation.snapshotId).toBe(snapshot.id);
		}
	});
});
