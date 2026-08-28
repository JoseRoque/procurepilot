import type { CartSnapshot, CartSnapshotDraft } from "../../domain/src";

/**
 * Sanitized static commerce fixtures. Every number is internally consistent
 * unless the fixture is explicitly about inconsistency; nothing here derives
 * from a real merchant or a real person.
 */

export function completeFixtureSnapshot(
	draft: CartSnapshotDraft,
	id: string,
	createdAt = "2026-08-28T10:00:00.000Z",
): CartSnapshot {
	return {
		...draft,
		id,
		createdAt,
		privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: false, cookiesRead: false },
	};
}

/** Cart below a stated "30% off $35+" threshold; totals reconcile. */
export const belowThresholdDraft: CartSnapshotDraft = {
	platform: "demo_store",
	platformLabel: "Demo store (fixture)",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo-store.fixture.local",
	pagePathHint: "/cart",
	cartItemCount: 3,
	items: [
		{ displayName: "Fixture paper towels 6-pack", quantity: 1, unitPriceCents: 1299, lineTotalCents: 1299, availability: "in_stock" },
		{ displayName: "Fixture olive oil 500ml", quantity: 1, unitPriceCents: 1043, lineTotalCents: 1043, availability: "in_stock" },
		{ displayName: "Fixture oat cereal", quantity: 2, unitPriceCents: 400, lineTotalCents: 800, availability: "in_stock" },
	],
	subtotal: { currency: "USD", cents: 3142, rawText: "Subtotal $31.42" },
	deliveryFee: { currency: "USD", cents: 199, rawText: "Delivery fee $1.99" },
	serviceFee: { currency: "USD", cents: 356, rawText: "Service fee $3.56" },
	tax: { currency: "USD", cents: 291, rawText: "Tax $2.91" },
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
	adapterVersion: "demo-1.0.0",
};

/** Flat-dollar threshold variant (benefit is fixed, so a filler can be justified). */
export const flatDollarThresholdDraft: CartSnapshotDraft = {
	...belowThresholdDraft,
	subtotal: { currency: "USD", cents: 4000, rawText: "Subtotal $40.00" },
	displayedFinalTotal: { currency: "USD", cents: 4846, rawText: "Total $48.46" },
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
};

/** Cart with a visibly applied discount and credit; totals reconcile exactly. */
export const appliedDiscountAndCreditDraft: CartSnapshotDraft = {
	platform: "demo_store",
	platformLabel: "Demo store (fixture)",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo-store.fixture.local",
	pagePathHint: "/cart",
	cartItemCount: 4,
	items: [
		{ displayName: "Fixture coffee beans 1lb", quantity: 3, unitPriceCents: 900, lineTotalCents: 2700, availability: "in_stock" },
		{ displayName: "Fixture dish soap", quantity: 1, unitPriceCents: 1500, lineTotalCents: 1500, availability: "in_stock" },
	],
	subtotal: { currency: "USD", cents: 4200, rawText: "Subtotal $42.00" },
	discounts: { currency: "USD", cents: 1200, rawText: "Discount applied -$12.00" },
	deliveryFee: { currency: "USD", cents: 0, rawText: "Delivery fee $0.00 (free delivery applied)" },
	serviceFee: { currency: "USD", cents: 0, rawText: "Service fee $0.00" },
	tax: { currency: "USD", cents: 0, rawText: "Tax $0.00 (included)" },
	visibleCredits: { currency: "USD", cents: 1000, rawText: "Credit applied -$10.00" },
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
	adapterVersion: "demo-1.0.0",
};

/** Displayed total disagrees with the visible parts by $23.01. */
export const inconsistentTotalDraft: CartSnapshotDraft = {
	platform: "demo_store",
	platformLabel: "Demo store (fixture)",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo-store.fixture.local",
	pagePathHint: "/cart",
	cartItemCount: 1,
	items: [
		{ displayName: "Fixture stand mixer", quantity: 1, unitPriceCents: 5000, lineTotalCents: 5000, availability: "in_stock" },
	],
	subtotal: { currency: "USD", cents: 5000, rawText: "Subtotal $50.00" },
	deliveryFee: { currency: "USD", cents: 299, rawText: "Delivery fee $2.99" },
	tax: { currency: "USD", cents: 400, rawText: "Tax $4.00" },
	displayedFinalTotal: { currency: "USD", cents: 8000, rawText: "Total $80.00" },
	visibleOffers: [],
	confidence: "medium",
	extractionNotes: ["A service fee row could not be located; it may not be reflected in the displayed total."],
	adapterVersion: "demo-1.0.0",
};

/** A required item shows as unavailable on the page. */
export const itemUnavailableDraft: CartSnapshotDraft = {
	platform: "demo_store",
	platformLabel: "Demo store (fixture)",
	detectionStatus: "supported",
	pageUrlOrigin: "https://demo-store.fixture.local",
	pagePathHint: "/cart",
	cartItemCount: 2,
	items: [
		{ displayName: "Fixture whole milk 1gal", quantity: 1, unitPriceCents: 449, lineTotalCents: 449, availability: "unavailable", rawText: "Fixture whole milk 1gal — Currently unavailable" },
		{ displayName: "Fixture sourdough loaf", quantity: 1, unitPriceCents: 599, lineTotalCents: 599, availability: "in_stock" },
	],
	subtotal: { currency: "USD", cents: 1048, rawText: "Subtotal $10.48" },
	tax: { currency: "USD", cents: 84, rawText: "Tax $0.84" },
	displayedFinalTotal: { currency: "USD", cents: 1132, rawText: "Total $11.32" },
	visibleOffers: [],
	confidence: "high",
	extractionNotes: [],
	adapterVersion: "demo-1.0.0",
};

/** Stale-selector adapter failure: nothing extractable, honest low-confidence output. */
export const staleAdapterFailureDraft: CartSnapshotDraft = {
	platform: "demo_store",
	platformLabel: "Demo store (fixture)",
	detectionStatus: "scan_unavailable",
	pageUrlOrigin: "https://demo-store.fixture.local",
	pagePathHint: "/cart",
	items: [],
	visibleOffers: [],
	confidence: "low",
	extractionNotes: [
		"Configured selectors matched nothing on this page — the adapter configuration may be stale.",
	],
	adapterVersion: "demo-0.9.0",
};

/** Sensitive routes that must block chip injection and any action execution. */
export const SENSITIVE_FIXTURE_URLS = [
	"https://demo-store.fixture.local/login",
	"https://demo-store.fixture.local/checkout/payment",
	"https://demo-store.fixture.local/account/verify-otp",
] as const;
