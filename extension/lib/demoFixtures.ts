import type { CartSnapshotDraft } from "./types";

export type DemoFixtureKey = "below_threshold" | "discount_and_credit" | "inconsistent_total";

export const DEMO_FIXTURE_LABELS: Record<DemoFixtureKey, string> = {
	below_threshold: "Cart below a spending threshold",
	discount_and_credit: "Cart with a visible discount and credit",
	inconsistent_total: "Cart with a mismatched displayed total",
};

/**
 * Cart #1: subtotal is below a visible "30% off $35+" threshold. Demonstrates
 * the threshold-gap warning and the "review, don't assume" behavior for
 * percent-based offers (the discount cap makes the exact benefit uncertain).
 */
const belowThreshold: CartSnapshotDraft = {
	platform: "generic",
	platformLabel: "Demo storefront",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo.purchasing-intelligence.local",
	pagePathHint: "/cart",
	cartItemCount: 4,
	items: [
		{ displayName: "Demo item A", quantity: 1, lineTotalCents: 1842, rawText: "Demo item A  $18.42" },
		{ displayName: "Demo item B", quantity: 2, lineTotalCents: 1300, rawText: "Demo item B x2  $13.00" },
	],
	subtotal: { currency: "USD", cents: 3142, rawText: "Subtotal $31.42" },
	discounts: undefined,
	deliveryFee: { currency: "USD", cents: 199, rawText: "Delivery fee $1.99" },
	serviceFee: { currency: "USD", cents: 356, rawText: "Service fee $3.56" },
	tax: { currency: "USD", cents: 291, rawText: "Tax $2.91" },
	visibleCredits: undefined,
	displayedFinalTotal: { currency: "USD", cents: 3988, rawText: "Total $39.88" },
	visibleOffers: [
		{
			title: "30% off orders $35+",
			rawText: "30% off orders $35+, up to $12",
			offerType: "threshold_discount",
			minimumSpendCents: 3500,
			discountPercent: 30,
			maximumDiscountCents: 1200,
			status: "visible",
			confidence: "high",
		},
	],
	confidence: "high",
	extractionNotes: [],
};

/**
 * Cart #2: a visible discount and a visible credit, with fees/tax chosen so
 * the displayed total reconciles exactly with the visible line items —
 * demonstrating grounded, non-discrepant savings math.
 */
const discountAndCredit: CartSnapshotDraft = {
	platform: "generic",
	platformLabel: "Demo storefront",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo.purchasing-intelligence.local",
	pagePathHint: "/cart",
	cartItemCount: 6,
	items: [
		{ displayName: "Demo item C", quantity: 3, lineTotalCents: 2700, rawText: "Demo item C x3  $27.00" },
		{ displayName: "Demo item D", quantity: 1, lineTotalCents: 1500, rawText: "Demo item D  $15.00" },
	],
	subtotal: { currency: "USD", cents: 4200, rawText: "Subtotal $42.00" },
	discounts: { currency: "USD", cents: 1200, rawText: "Discount -$12.00" },
	deliveryFee: { currency: "USD", cents: 0, rawText: "Delivery fee $0.00 (free delivery applied)" },
	serviceFee: { currency: "USD", cents: 0, rawText: "Service fee $0.00" },
	tax: { currency: "USD", cents: 0, rawText: "Tax $0.00 (included)" },
	visibleCredits: { currency: "USD", cents: 1000, rawText: "Credit applied -$10.00" },
	// Computed to match: 4200 - 1200 + 0 + 0 + 0 - 1000 = 2000
	displayedFinalTotal: { currency: "USD", cents: 2000, rawText: "Total $20.00" },
	visibleOffers: [
		{
			title: "Free delivery applied",
			rawText: "Free delivery applied",
			offerType: "free_delivery",
			status: "appears_applied",
			confidence: "high",
		},
		{
			title: "$10 credit applied",
			rawText: "$10 credit applied to this order",
			offerType: "credit",
			discountCents: 1000,
			status: "appears_applied",
			confidence: "high",
		},
	],
	confidence: "high",
	extractionNotes: [],
};

/**
 * Cart #3: the displayed total does not match what the visible line items
 * add up to. Demonstrates the discrepancy warning and low-confidence
 * "recommend review" behavior instead of asserting an answer.
 */
const inconsistentTotal: CartSnapshotDraft = {
	platform: "generic",
	platformLabel: "Demo storefront",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo.purchasing-intelligence.local",
	pagePathHint: "/cart",
	cartItemCount: 3,
	items: [{ displayName: "Demo item E", quantity: 1, lineTotalCents: 5000, rawText: "Demo item E  $50.00" }],
	subtotal: { currency: "USD", cents: 5000, rawText: "Subtotal $50.00" },
	discounts: undefined,
	deliveryFee: { currency: "USD", cents: 299, rawText: "Delivery fee $2.99" },
	serviceFee: undefined,
	tax: { currency: "USD", cents: 400, rawText: "Tax $4.00" },
	visibleCredits: undefined,
	// Computed from visible facts: 5000 + 299 + 400 = 5699. Page displays $80.00
	// instead — a $23.01 gap the extraction cannot explain from visible facts.
	displayedFinalTotal: { currency: "USD", cents: 8000, rawText: "Total $80.00" },
	visibleOffers: [],
	confidence: "medium",
	extractionNotes: [
		"A service fee row could not be located; it may not be reflected in the displayed total.",
	],
};

export const DEMO_FIXTURES: Record<DemoFixtureKey, CartSnapshotDraft> = {
	below_threshold: belowThreshold,
	discount_and_credit: discountAndCredit,
	inconsistent_total: inconsistentTotal,
};
