/**
 * Shared data models for Purchasing Intelligence (Bronze).
 *
 * These types intentionally exclude anything sensitive: no account IDs,
 * addresses, phone numbers, payment details, cookies, or raw page HTML.
 * See CartSnapshot.privacy for the runtime guarantees these types encode.
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

export type CartLineItem = {
	displayName: string;
	quantity?: number;
	unitPriceCents?: number;
	lineTotalCents?: number;
	categoryHint?: string;
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
	privacy: CartSnapshotPrivacy;
};

/**
 * Everything an adapter produces, before the background script attaches
 * generated fields (id/createdAt) and the fixed privacy attestation.
 */
export type CartSnapshotDraft = Omit<
	CartSnapshot,
	"id" | "createdAt" | "privacy"
>;

export type OptimizationGoal =
	| "lowest_total"
	| "lowest_immediate_payment"
	| "fewest_merchants"
	| "fastest_fulfillment";

export type ThresholdFillerPolicy =
	| "household_essentials"
	| "pantry_staples"
	| "none";

export type SubstitutionTolerance =
	| "exact_only"
	| "brand_preferred"
	| "equivalent_allowed";

export type ShoppingPreferences = {
	optimizationGoal: OptimizationGoal;
	thresholdFillerPolicy: ThresholdFillerPolicy;
	substitutionTolerance: SubstitutionTolerance;
	localOnly: boolean;
	demoModeEnabled: boolean;
};

export const DEFAULT_PREFERENCES: ShoppingPreferences = {
	optimizationGoal: "lowest_total",
	thresholdFillerPolicy: "none",
	substitutionTolerance: "equivalent_allowed",
	localOnly: true,
	demoModeEnabled: false,
};

export type RecommendationAction =
	| "review_before_checkout"
	| "add_threshold_filler"
	| "compare_saved_carts"
	| "wait_for_more_information"
	| "no_action";

export type CartRecommendation = {
	snapshotId: string;
	generatedAt: string;
	action: RecommendationAction;
	headline: string;
	rationale: string[];
	estimatedSavingsCents?: number;
	thresholdGapCents?: number;
	suggestedFillerCategory?: string;
	warnings: string[];
	confidence: ScanConfidence;
};

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
