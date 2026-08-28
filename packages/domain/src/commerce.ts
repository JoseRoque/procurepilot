/**
 * Canonical commerce observation types, shared by extension, sidecar, optimizer,
 * and (in redacted form only) telemetry. No prohibited data (cookies, credentials,
 * payment data, addresses) may ever appear in these shapes — see
 * docs/privacy/data-classification.md.
 */

export type SupportedPlatform =
	| "generic"
	| "demo_store"
	| "doordash"
	| "ubereats"
	| "instacart"
	| "target"
	| "walmart"
	| "unknown";

export type DetectionStatus =
	| "supported"
	| "experimental"
	| "not_detected"
	| "scan_unavailable";

export type ScanConfidence = "high" | "medium" | "low";

export type MoneyFact = {
	currency: "USD";
	cents: number;
	rawText?: string;
};

export type VisibleOfferStatus = "visible" | "appears_applied" | "unknown";

export type VisibleOfferType =
	| "order_discount"
	| "item_discount"
	| "threshold_discount"
	| "free_delivery"
	| "credit"
	| "rebate"
	| "unknown";

export type VisibleOffer = {
	title: string;
	rawText: string;
	offerType: VisibleOfferType;
	minimumSpendCents?: number;
	discountCents?: number;
	discountPercent?: number;
	maximumDiscountCents?: number;
	status: VisibleOfferStatus;
	confidence: ScanConfidence;
};

export type ItemAvailability = "in_stock" | "unavailable" | "unknown";

export type CartLineItem = {
	displayName: string;
	quantity?: number;
	unitPriceCents?: number;
	lineTotalCents?: number;
	categoryHint?: string;
	availability?: ItemAvailability;
	rawText?: string;
};

export type CartSnapshotPrivacy = {
	localOnly: true;
	piiRedacted: true;
	rawHtmlStored: false;
	cookiesRead: false;
};

export type CartSnapshot = {
	id: string;
	createdAt: string;
	platform: SupportedPlatform;
	platformLabel: string;
	detectionStatus: DetectionStatus;
	pageUrlOrigin: string;
	pagePathHint?: string;
	cartItemCount?: number;
	items: CartLineItem[];
	subtotal?: MoneyFact;
	discounts?: MoneyFact;
	deliveryFee?: MoneyFact;
	serviceFee?: MoneyFact;
	tax?: MoneyFact;
	visibleCredits?: MoneyFact;
	displayedFinalTotal?: MoneyFact;
	visibleOffers: VisibleOffer[];
	confidence: ScanConfidence;
	extractionNotes: string[];
	adapterVersion?: string;
	privacy: CartSnapshotPrivacy;
};

/** Adapter output before generated fields and the privacy attestation are stamped. */
export type CartSnapshotDraft = Omit<CartSnapshot, "id" | "createdAt" | "privacy">;

export const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
	generic: "Generic commerce page",
	demo_store: "Demo store (fixture)",
	doordash: "DoorDash",
	ubereats: "Uber Eats",
	instacart: "Instacart",
	target: "Target",
	walmart: "Walmart",
	unknown: "Unrecognized page",
};

export const MAX_STORED_SNAPSHOTS = 20;
