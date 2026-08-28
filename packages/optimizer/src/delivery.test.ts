import { describe, expect, it } from "vitest";
import {
	assessMembership,
	comparePlatformsForMerchant,
	platformFeesCents,
	summarizeDeliveryCost,
	type DeliveryOrder,
} from "./delivery";

function order(partial: Partial<DeliveryOrder> = {}): DeliveryOrder {
	return {
		orderedAt: "2026-01-01T12:00:00.000Z",
		platformId: "doordash",
		merchantId: "thai-place",
		subtotalCents: 2000,
		deliveryFeeCents: 299,
		serviceFeeCents: 400,
		taxCents: 180,
		tipCents: 400,
		...partial,
	};
}

describe("platformFeesCents", () => {
	it("counts platform fees but excludes tax and tip", () => {
		expect(platformFeesCents(order())).toBe(699);
	});

	it("treats missing fee components as zero rather than unknown-propagating", () => {
		expect(platformFeesCents(order({ serviceFeeCents: undefined }))).toBe(299);
	});
});

describe("summarizeDeliveryCost", () => {
	it("reports the fee rate on top of food, not of the grand total", () => {
		const summary = summarizeDeliveryCost([order(), order()]);
		expect(summary.subtotalCents).toBe(4000);
		expect(summary.platformFeesCents).toBe(1398);
		expect(summary.feeRatePercent).toBe(35); // 1398/4000
		expect(summary.explanation.join(" ")).toMatch(/35% on top of the food subtotal/);
	});

	it("states that tips are excluded from the rate", () => {
		const summary = summarizeDeliveryCost([order()]);
		expect(summary.tipCents).toBe(400);
		expect(summary.explanation.join(" ")).toMatch(/Tips .* are excluded/);
	});

	it("handles an empty history without dividing by zero", () => {
		const summary = summarizeDeliveryCost([]);
		expect(summary.feeRatePercent).toBeUndefined();
		expect(summary.explanation.join(" ")).toMatch(/No delivery orders/);
	});
});

describe("comparePlatformsForMerchant", () => {
	const cheap = Array.from({ length: 3 }, () =>
		order({ platformId: "ubereats", deliveryFeeCents: 99, serviceFeeCents: 200 }),
	);
	const pricey = Array.from({ length: 3 }, () =>
		order({ platformId: "doordash", deliveryFeeCents: 299, serviceFeeCents: 400 }),
	);

	it("names the cheaper platform for the same merchant", () => {
		const result = comparePlatformsForMerchant("thai-place", [...cheap, ...pricey]);
		expect(result.comparable).toBe(true);
		expect(result.cheaperPlatformId).toBe("ubereats");
	});

	it("compares fee rate rather than total paid, so basket size does not decide it", () => {
		// ubereats orders are much larger, so their absolute fees are higher…
		const bigCheap = Array.from({ length: 3 }, () =>
			order({ platformId: "ubereats", subtotalCents: 10000, deliveryFeeCents: 99, serviceFeeCents: 900 }),
		);
		const result = comparePlatformsForMerchant("thai-place", [...bigCheap, ...pricey]);
		const uber = result.platforms.find((p) => p.platformId === "ubereats")!;
		const dd = result.platforms.find((p) => p.platformId === "doordash")!;
		expect(uber.feesCents).toBeGreaterThan(dd.feesCents);
		// …yet the lower rate still wins.
		expect(result.cheaperPlatformId).toBe("ubereats");
	});

	it("refuses to name a winner on thin evidence", () => {
		const result = comparePlatformsForMerchant("thai-place", [...pricey, cheap[0]]);
		expect(result.comparable).toBe(false);
		expect(result.cheaperPlatformId).toBeUndefined();
		expect(result.explanation.join(" ")).toMatch(/Not enough orders/);
	});

	it("refuses when only one platform has orders", () => {
		const result = comparePlatformsForMerchant("thai-place", pricey);
		expect(result.comparable).toBe(false);
		expect(result.explanation.join(" ")).toMatch(/nothing to compare/);
	});

	it("ignores orders from other merchants", () => {
		const other = order({ merchantId: "pizza-place", platformId: "ubereats" });
		const result = comparePlatformsForMerchant("thai-place", [...pricey, ...cheap, other]);
		const total = result.platforms.reduce((sum, p) => sum + p.orderCount, 0);
		expect(total).toBe(6);
	});

	it("says neither is cheaper when the rates tie", () => {
		const a = Array.from({ length: 3 }, () => order({ platformId: "a" }));
		const b = Array.from({ length: 3 }, () => order({ platformId: "b" }));
		const result = comparePlatformsForMerchant("thai-place", [...a, ...b]);
		expect(result.cheaperPlatformId).toBeUndefined();
		expect(result.explanation.join(" ")).toMatch(/neither platform is cheaper/);
	});

	it("caveats that menu prices may differ per platform", () => {
		const result = comparePlatformsForMerchant("thai-place", [...cheap, ...pricey]);
		expect(result.explanation.join(" ")).toMatch(/Menu prices are often set differently/);
	});
});

describe("assessMembership", () => {
	it("admits the counterfactual is unknown when every order is a member order", () => {
		const orders = Array.from({ length: 10 }, () =>
			order({ membershipActive: true, deliveryFeeCents: 0 }),
		);
		const result = assessMembership(orders, 999, 30);
		expect(result.verdict).toBe("counterfactual_unknown");
		expect(result.explanation.join(" ")).toMatch(/cannot be confirmed/);
	});

	it("inverts the question into the one the data can answer", () => {
		const orders = Array.from({ length: 10 }, () => order({ membershipActive: true }));
		const result = assessMembership(orders, 1000, 30);
		expect(result.costPerOrderCents).toBe(100);
		expect(result.explanation.join(" ")).toMatch(/must save you more than \$1\.00 in fees/);
	});

	it("returns a verdict when history contains both member and non-member orders", () => {
		const member = Array.from({ length: 5 }, () =>
			order({ membershipActive: true, deliveryFeeCents: 0, serviceFeeCents: 200 }),
		);
		const nonMember = Array.from({ length: 5 }, () =>
			order({ membershipActive: false, deliveryFeeCents: 499, serviceFeeCents: 400 }),
		);
		const result = assessMembership([...member, ...nonMember], 999, 30);
		expect(result.verdict).toBe("pays_off");
		expect(result.observedFeeRateMember).toBeLessThan(result.observedFeeRateNonMember!);
		expect(result.estimatedSavingsCents).toBeGreaterThan(999);
	});

	it("reports when the membership does not pay off", () => {
		const member = Array.from({ length: 5 }, () =>
			order({ membershipActive: true, deliveryFeeCents: 199, serviceFeeCents: 400 }),
		);
		const nonMember = Array.from({ length: 5 }, () =>
			order({ membershipActive: false, deliveryFeeCents: 299, serviceFeeCents: 400 }),
		);
		const result = assessMembership([...member, ...nonMember], 9999, 30);
		expect(result.verdict).toBe("does_not_pay_off");
		expect(result.explanation.join(" ")).toMatch(/came up short/);
	});

	it("labels the estimate as an estimate", () => {
		const member = Array.from({ length: 5 }, () => order({ membershipActive: true, deliveryFeeCents: 0 }));
		const nonMember = Array.from({ length: 5 }, () => order({ membershipActive: false }));
		const result = assessMembership([...member, ...nonMember], 999, 30);
		expect(result.explanation.join(" ")).toMatch(/estimate from your own order history, not a quoted figure/);
	});

	it("reports insufficient_history rather than dividing by zero", () => {
		const result = assessMembership([], 999, 30);
		expect(result.verdict).toBe("insufficient_history");
	});
});
