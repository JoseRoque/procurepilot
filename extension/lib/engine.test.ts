import { describe, expect, it } from "vitest";
import {
	calculateObservedTotal,
	createCartRecommendation,
	evaluateThresholdOpportunity,
} from "./engine";
import { DEFAULT_PREFERENCES } from "./types";
import type { CartSnapshot } from "./types";

function baseSnapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
	return {
		id: "snap-1",
		createdAt: "2026-01-01T00:00:00.000Z",
		platform: "generic",
		platformLabel: "Demo storefront",
		detectionStatus: "supported",
		pageUrlOrigin: "https://example.test",
		items: [],
		visibleOffers: [],
		confidence: "high",
		extractionNotes: [],
		privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: false, cookiesRead: false },
		...overrides,
	};
}

describe("calculateObservedTotal", () => {
	it("sums subtotal, fees, and tax, subtracting discounts and credits", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 4200 },
			discounts: { currency: "USD", cents: 1200 },
			deliveryFee: { currency: "USD", cents: 0 },
			serviceFee: { currency: "USD", cents: 0 },
			tax: { currency: "USD", cents: 0 },
			visibleCredits: { currency: "USD", cents: 1000 },
		});
		expect(calculateObservedTotal(snapshot)).toBe(2000);
	});

	it("returns undefined when no subtotal was captured", () => {
		expect(calculateObservedTotal(baseSnapshot())).toBeUndefined();
	});

	it("uses only integer cents (no floating point)", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 3142 },
			deliveryFee: { currency: "USD", cents: 199 },
			serviceFee: { currency: "USD", cents: 356 },
			tax: { currency: "USD", cents: 291 },
		});
		expect(calculateObservedTotal(snapshot)).toBe(3988);
		expect(Number.isInteger(calculateObservedTotal(snapshot))).toBe(true);
	});
});

describe("evaluateThresholdOpportunity", () => {
	it("computes the gap to a visible, unmet spending threshold", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 3142 },
			visibleOffers: [
				{
					title: "30% off orders $35+",
					rawText: "30% off orders $35+",
					offerType: "threshold_discount",
					minimumSpendCents: 3500,
					discountPercent: 30,
					status: "visible",
					confidence: "high",
				},
			],
		});
		const result = evaluateThresholdOpportunity(snapshot, DEFAULT_PREFERENCES);
		expect(result?.thresholdGapCents).toBe(358);
	});

	it("recommends review (not adding a filler) for percent-based offers with unknown cap", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 3142 },
			visibleOffers: [
				{
					title: "30% off orders $35+",
					rawText: "30% off orders $35+",
					offerType: "threshold_discount",
					minimumSpendCents: 3500,
					discountPercent: 30,
					status: "visible",
					confidence: "high",
				},
			],
		});
		const result = evaluateThresholdOpportunity(snapshot, DEFAULT_PREFERENCES);
		expect(result?.action).toBe("review_before_checkout");
	});

	it("recommends a filler category when a flat-dollar discount comfortably exceeds the gap", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 4000 },
			visibleOffers: [
				{
					title: "$10 off orders $45+",
					rawText: "$10 off orders $45+",
					offerType: "threshold_discount",
					minimumSpendCents: 4500,
					discountCents: 1000,
					status: "visible",
					confidence: "high",
				},
			],
		});
		const result = evaluateThresholdOpportunity(
			snapshot,
			{ ...DEFAULT_PREFERENCES, thresholdFillerPolicy: "household_essentials" },
		);
		expect(result?.action).toBe("add_threshold_filler");
		expect(result?.suggestedFillerCategory).toBe("household essentials");
	});

	it("returns undefined when the threshold is already met", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 4000 },
			visibleOffers: [
				{
					title: "10% off orders $35+",
					rawText: "10% off orders $35+",
					offerType: "threshold_discount",
					minimumSpendCents: 3500,
					discountPercent: 10,
					status: "visible",
					confidence: "high",
				},
			],
		});
		expect(evaluateThresholdOpportunity(snapshot, DEFAULT_PREFERENCES)).toBeUndefined();
	});

	it("returns undefined when the offer already appears applied", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 3000 },
			visibleOffers: [
				{
					title: "10% off orders $35+",
					rawText: "10% off orders $35+ (applied)",
					offerType: "threshold_discount",
					minimumSpendCents: 3500,
					discountPercent: 10,
					status: "appears_applied",
					confidence: "high",
				},
			],
		});
		expect(evaluateThresholdOpportunity(snapshot, DEFAULT_PREFERENCES)).toBeUndefined();
	});

	it("respects thresholdFillerPolicy 'none' by not suggesting a filler", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 4000 },
			visibleOffers: [
				{
					title: "$10 off orders $45+",
					rawText: "$10 off orders $45+",
					offerType: "threshold_discount",
					minimumSpendCents: 4500,
					discountCents: 1000,
					status: "visible",
					confidence: "high",
				},
			],
		});
		const result = evaluateThresholdOpportunity(snapshot, { ...DEFAULT_PREFERENCES, thresholdFillerPolicy: "none" });
		expect(result?.action).toBe("review_before_checkout");
	});
});

describe("createCartRecommendation", () => {
	it("flags a discrepancy between displayed and computed totals", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 5000 },
			deliveryFee: { currency: "USD", cents: 299 },
			tax: { currency: "USD", cents: 400 },
			displayedFinalTotal: { currency: "USD", cents: 8000 },
			confidence: "medium",
		});
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.action).toBe("review_before_checkout");
		expect(recommendation.warnings.length).toBeGreaterThan(0);
		expect(recommendation.rationale.join(" ")).toMatch(/does not match|calculated/i);
	});

	it("recommends review instead of asserting an answer when confidence is low", () => {
		const snapshot = baseSnapshot({ confidence: "low", extractionNotes: ["Ambiguous subtotal row."] });
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.action).toBe("wait_for_more_information");
		expect(recommendation.confidence).toBe("low");
	});

	it("reports savings versus the most recent prior snapshot when consistent and lower", () => {
		const prior = baseSnapshot({
			id: "snap-0",
			createdAt: "2025-12-31T00:00:00.000Z",
			displayedFinalTotal: { currency: "USD", cents: 2620 },
		});
		const current = baseSnapshot({
			subtotal: { currency: "USD", cents: 4200 },
			discounts: { currency: "USD", cents: 1200 },
			visibleCredits: { currency: "USD", cents: 1000 },
			deliveryFee: { currency: "USD", cents: 0 },
			serviceFee: { currency: "USD", cents: 0 },
			tax: { currency: "USD", cents: 0 },
			displayedFinalTotal: { currency: "USD", cents: 2000 },
		});
		const recommendation = createCartRecommendation(current, DEFAULT_PREFERENCES, [prior]);
		expect(recommendation.action).toBe("no_action");
		expect(recommendation.estimatedSavingsCents).toBe(620);
	});

	it("never claims a discount is applied unless the snapshot itself says so", () => {
		const snapshot = baseSnapshot({
			subtotal: { currency: "USD", cents: 3142 },
			visibleOffers: [
				{
					title: "30% off orders $35+",
					rawText: "30% off orders $35+",
					offerType: "threshold_discount",
					minimumSpendCents: 3500,
					discountPercent: 30,
					status: "visible",
					confidence: "high",
				},
			],
		});
		const recommendation = createCartRecommendation(snapshot, DEFAULT_PREFERENCES, []);
		expect(recommendation.rationale.join(" ")).not.toMatch(/will apply|is applied/i);
	});
});
