import { describe, expect, it } from "vitest";
import type { ShoppingItem, ShoppingPreferences } from "../../domain/src";
import { DEFAULT_PREFERENCES, normalizeItemName } from "../../domain/src";
import {
	appliedDiscountAndCreditDraft,
	belowThresholdDraft,
	completeFixtureSnapshot,
	flatDollarThresholdDraft,
	inconsistentTotalDraft,
	itemUnavailableDraft,
	staleAdapterFailureDraft,
} from "../../test-fixtures/src";
import {
	addCents,
	calculateObservedTotal,
	compareCartSnapshots,
	createPurchasePlan,
	detectFeeHeavyCart,
	detectTotalDiscrepancy,
	evaluateRequiredItemCoverage,
	evaluateThresholdOpportunity,
	formatCents,
	normalizeMoney,
	parseVisibleOffer,
	percentOfCentsFloor,
} from "./index";

function makeShoppingItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
	const name = overrides.name ?? "Fixture olive oil 500ml";
	return {
		id: overrides.id ?? "item-1",
		name,
		urgency: "immediate",
		targetQuantity: 1,
		acceptableSubstitution: "equivalent_allowed",
		active: true,
		createdAt: "2026-08-28T00:00:00.000Z",
		updatedAt: "2026-08-28T00:00:00.000Z",
		...overrides,
		normalizedName: normalizeItemName(name),
	};
}

const prefs: ShoppingPreferences = { ...DEFAULT_PREFERENCES };

describe("money", () => {
	it("parses and formats integer cents", () => {
		expect(normalizeMoney("$1,234.56")?.cents).toBe(123456);
		expect(normalizeMoney("-$3.50")?.cents).toBe(-350);
		expect(normalizeMoney("no money here")).toBeUndefined();
		expect(formatCents(3988)).toBe("$39.88");
	});

	it("sums integer cents without floating point", () => {
		expect(addCents(3142, 199, 356, 291)).toBe(3988);
		expect(Number.isInteger(addCents(1, 2, undefined, 3))).toBe(true);
	});

	it("rounds percent benefits DOWN (conservative)", () => {
		expect(percentOfCentsFloor(3599, 30)).toBe(1079); // 1079.7 floors to 1079
	});
});

describe("offer parsing", () => {
	it("never marks an offer applied without explicit wording", () => {
		expect(parseVisibleOffer("30% off orders $35+").status).toBe("visible");
		expect(parseVisibleOffer("30% off orders $35+ (applied)").status).toBe("appears_applied");
	});

	it("parses explicit threshold terms", () => {
		const offer = parseVisibleOffer("30% off orders $35+, up to $12");
		expect(offer.offerType).toBe("threshold_discount");
		expect(offer.minimumSpendCents).toBe(3500);
		expect(offer.maximumDiscountCents).toBe(1200);
	});
});

describe("totals and discrepancy", () => {
	it("computes the observed total from visible parts", () => {
		const snapshot = completeFixtureSnapshot(appliedDiscountAndCreditDraft, "s-applied");
		expect(calculateObservedTotal(snapshot)).toBe(2000); // 4200-1200+0+0+0-1000
	});

	it("flags a material displayed-vs-calculated discrepancy", () => {
		const snapshot = completeFixtureSnapshot(inconsistentTotalDraft, "s-bad");
		const warning = detectTotalDiscrepancy(snapshot);
		expect(warning?.kind).toBe("total_discrepancy");
		expect(warning?.arithmetic.join(" ")).toContain("$80.00");
		expect(warning?.arithmetic.join(" ")).toContain("$56.99");
	});

	it("does not flag reconciling totals", () => {
		const snapshot = completeFixtureSnapshot(appliedDiscountAndCreditDraft, "s-ok");
		expect(detectTotalDiscrepancy(snapshot)).toBeNull();
	});

	it("flags a fee-heavy cart at ≥15% fees", () => {
		const snapshot = completeFixtureSnapshot(belowThresholdDraft, "s-fees");
		// fees 199+356=555 on 3142 subtotal ≈ 17.7%
		expect(detectFeeHeavyCart(snapshot)?.kind).toBe("fee_heavy_cart");
	});
});

describe("threshold opportunity", () => {
	it("computes the gap and refuses a filler for percent offers", () => {
		const snapshot = completeFixtureSnapshot(belowThresholdDraft, "s-thresh");
		const result = evaluateThresholdOpportunity(snapshot, {
			...prefs,
			thresholdFillerPolicy: "household_essentials",
		});
		expect(result?.gapCents).toBe(358);
		expect(result?.fillerRecommended).toBe(false);
		expect(result?.explanation.join(" ")).toMatch(/review the offer terms/i);
	});

	it("recommends a filler category only when a flat-dollar benefit clears the gap conservatively", () => {
		const snapshot = completeFixtureSnapshot(flatDollarThresholdDraft, "s-flat");
		const result = evaluateThresholdOpportunity(snapshot, {
			...prefs,
			thresholdFillerPolicy: "pantry_staples",
		});
		expect(result?.gapCents).toBe(500);
		expect(result?.fillerRecommended).toBe(true); // $10 ≥ $5 gap + $0.50 margin
		expect(result?.suggestedFillerCategory).toBe("pantry staples");
	});

	it("prefers an exact pre-approved shopping item over a category", () => {
		const snapshot = completeFixtureSnapshot(flatDollarThresholdDraft, "s-exact");
		const listItem = makeShoppingItem({
			id: "item-choc",
			name: "Fixture dark chocolate bar",
			urgency: "stock_up",
			maxUnitPriceCents: 600,
		});
		const result = evaluateThresholdOpportunity(snapshot, prefs, [listItem]);
		expect(result?.exactItemCandidateId).toBe("item-choc");
		expect(result?.suggestedFillerCategory).toBeUndefined();
	});

	it("ignores exact candidates that exceed the single-add ceiling", () => {
		const snapshot = completeFixtureSnapshot(flatDollarThresholdDraft, "s-cap");
		const expensive = makeShoppingItem({
			id: "item-exp",
			name: "Fixture stand mixer",
			maxUnitPriceCents: 5_000,
		});
		const result = evaluateThresholdOpportunity(
			snapshot,
			{ ...prefs, maxSingleAddCents: 2_000 },
			[expensive],
		);
		expect(result?.exactItemCandidateId).toBeUndefined();
	});

	it("returns null when the threshold is already met or the offer appears applied", () => {
		const met = completeFixtureSnapshot(
			{ ...belowThresholdDraft, subtotal: { currency: "USD", cents: 3600 } },
			"s-met",
		);
		expect(evaluateThresholdOpportunity(met, prefs)).toBeNull();
	});
});

describe("required item coverage", () => {
	it("reports covered, missing, and unavailable required items", () => {
		const snapshot = completeFixtureSnapshot(itemUnavailableDraft, "s-un");
		const items = [
			makeShoppingItem({ id: "milk", name: "Fixture whole milk 1gal" }),
			makeShoppingItem({ id: "bread", name: "Fixture sourdough loaf" }),
			makeShoppingItem({ id: "eggs", name: "Fixture free-range eggs" }),
		];
		const coverage = evaluateRequiredItemCoverage(items, snapshot.items);
		expect(coverage.requiredTotal).toBe(3);
		expect(coverage.unavailableRequired.map((i) => i.displayName)).toEqual([
			"Fixture whole milk 1gal",
		]);
		expect(coverage.missingRequired.map((i) => i.displayName)).toEqual([
			"Fixture free-range eggs",
		]);
	});

	it("exact_only tolerance requires an exact normalized name", () => {
		const snapshot = completeFixtureSnapshot(itemUnavailableDraft, "s-exactonly");
		const item = makeShoppingItem({
			name: "Sourdough loaf",
			acceptableSubstitution: "exact_only",
		});
		const coverage = evaluateRequiredItemCoverage([item], snapshot.items);
		expect(coverage.missingRequired).toHaveLength(1); // "Fixture sourdough loaf" ≠ "Sourdough loaf"
	});
});

describe("snapshot comparison", () => {
	it("compares against the most recent comparable snapshot", () => {
		const current = completeFixtureSnapshot(
			appliedDiscountAndCreditDraft,
			"s-now",
			"2026-08-28T12:00:00.000Z",
		);
		const prior = completeFixtureSnapshot(
			{ ...appliedDiscountAndCreditDraft, displayedFinalTotal: { currency: "USD", cents: 2620 } },
			"s-before",
			"2026-08-28T09:00:00.000Z",
		);
		const result = compareCartSnapshots(current, [prior]);
		expect(result?.differenceCents).toBe(620);
		expect(result?.basis).toBe("displayed_total");
	});
});

describe("createPurchasePlan", () => {
	it("builds an explainable plan with evidence, assumptions, arithmetic, and warnings", () => {
		const snapshot = completeFixtureSnapshot(belowThresholdDraft, "s-plan");
		const plan = createPurchasePlan({
			snapshot,
			preferences: prefs,
			shoppingItems: [makeShoppingItem()],
			priorSnapshots: [],
			now: () => "2026-08-28T12:00:00.000Z",
			generateId: () => "plan-1",
		});
		expect(plan.id).toBe("plan-1");
		expect(plan.observedCost.basis).toBe("displayed_total");
		expect(plan.observedCost.displayedFinalTotalCents).toBe(3988);
		expect(plan.assumptions.length).toBeGreaterThan(0);
		const threshold = plan.recommendations.find((r) => r.kind === "threshold_gap");
		expect(threshold?.evidence.join(" ")).toContain("30% off orders $35+");
		expect(plan.recommendations.every((r) => r.nextSafeUserAction.length > 0)).toBe(true);
	});

	it("marks a discrepant plan needs_review", () => {
		const snapshot = completeFixtureSnapshot(inconsistentTotalDraft, "s-plan-bad");
		const plan = createPurchasePlan({
			snapshot,
			preferences: prefs,
			shoppingItems: [],
			priorSnapshots: [],
		});
		expect(plan.status).toBe("needs_review");
		expect(plan.recommendations.some((r) => r.kind === "total_discrepancy")).toBe(true);
	});

	it("says review rather than fabricating on a stale-adapter failure", () => {
		const snapshot = completeFixtureSnapshot(staleAdapterFailureDraft, "s-plan-stale");
		const plan = createPurchasePlan({
			snapshot,
			preferences: prefs,
			shoppingItems: [],
			priorSnapshots: [],
		});
		expect(plan.status).toBe("needs_review");
		expect(plan.observedCost.basis).toBe("unknown");
		expect(plan.recommendations.some((r) => r.kind === "review_required")).toBe(true);
	});

	it("surfaces preference/policy conflicts", () => {
		const snapshot = completeFixtureSnapshot(belowThresholdDraft, "s-policy");
		const capped = makeShoppingItem({
			name: "Fixture olive oil 500ml",
			maxUnitPriceCents: 500, // visible price is 1043
		});
		const plan = createPurchasePlan({
			snapshot,
			preferences: prefs,
			shoppingItems: [capped],
			priorSnapshots: [],
		});
		expect(plan.recommendations.some((r) => r.kind === "policy_conflict")).toBe(true);
	});
});

describe("threshold headline precision", () => {
	function planWith(items: ShoppingItem[], draft = flatDollarThresholdDraft) {
		return createPurchasePlan({
			snapshot: completeFixtureSnapshot(draft, "s-headline"),
			preferences: { ...prefs, thresholdFillerPolicy: "pantry_staples" },
			shoppingItems: items,
			priorSnapshots: [],
		});
	}

	it("never claims worthwhileness when the driver is an item already on the list", () => {
		const listItem = makeShoppingItem({
			id: "item-choc",
			name: "Fixture dark chocolate bar",
			urgency: "stock_up",
			maxUnitPriceCents: 600,
		});
		// A PERCENT offer + an exact list item: the gap is real, but the
		// benefit is not established, so the copy must not imply it is.
		const plan = planWith([listItem], belowThresholdDraft);
		const rec = plan.recommendations.find((r) => r.kind === "threshold_filler_category");
		expect(rec?.headline).toMatch(/already on your list/i);
		expect(rec?.headline).not.toMatch(/worthwhile|worth it|save/i);
		expect(rec?.warnings.join(" ")).toMatch(/does not establish that the discount is worth it/i);
	});

	it("states the arithmetic plainly for a flat-dollar benefit", () => {
		const plan = planWith([]);
		const rec = plan.recommendations.find((r) => r.kind === "threshold_filler_category");
		expect(rec?.headline).toMatch(/stated discount exceeds the gap/i);
	});

	it("says 'review' when nothing justifies an addition", () => {
		const plan = createPurchasePlan({
			snapshot: completeFixtureSnapshot(belowThresholdDraft, "s-review"),
			preferences: { ...prefs, thresholdFillerPolicy: "none" },
			shoppingItems: [],
			priorSnapshots: [],
		});
		const rec = plan.recommendations.find((r) => r.kind === "threshold_gap");
		expect(rec?.headline).toMatch(/review before adding anything/i);
	});
});
