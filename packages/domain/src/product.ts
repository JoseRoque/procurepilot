/**
 * Product identity and price-history models.
 *
 * These exist so the system can answer "is this price good?" and "is this the
 * same product I bought before / can buy elsewhere?" — questions the Bronze
 * cart-line model (name + price) cannot answer.
 *
 * PRIVACY: everything here is Layer 1 (local, source of truth). The shared
 * layer derives product/merchant facts from these — never a person, never a
 * basket. See docs/privacy/data-classification.md.
 */

/** Base units all sizes normalize to, so cross-brand comparison is possible. */
export type BaseUnit = "ml" | "g" | "each";

export type UnitDimension = "volume" | "weight" | "count";

export const BASE_UNIT_FOR_DIMENSION: Record<UnitDimension, BaseUnit> = {
	volume: "ml",
	weight: "g",
	count: "each",
};

export type ParsedSize = {
	dimension: UnitDimension;
	/** Size of ONE unit in base units (e.g. 500 for "500ml"). Integer. */
	baseUnitsPerItem: number;
	/** Multi-pack count ("12-pack" → 12, "2 x 1L" → 2). Defaults to 1. */
	packCount: number;
	/** packCount × baseUnitsPerItem. The denominator for unit pricing. Integer. */
	totalBaseUnits: number;
	baseUnit: BaseUnit;
	/** The substring the size was parsed from, for auditability. */
	matchedText: string;
	/**
	 * "oz" is ambiguous (weight vs fluid). Low confidence marks a guess so the
	 * UI can label it and the engine can decline to compare on it.
	 */
	confidence: "high" | "low";
};

/**
 * Stable identity for a product across merchants and time.
 *
 * `key` is what price history is grouped by:
 *   - `gtin:<digits>` when a real barcode is visible (authoritative)
 *   - `bn:<brand>|<name>|<size>|<pack>` otherwise (best-effort)
 * Merchant SKU is kept separately: it gives perfect continuity *within* a
 * merchant but is useless across them.
 */
export type ProductIdentity = {
	key: string;
	gtin?: string;
	brand?: string;
	normalizedName: string;
	displayName: string;
	size?: ParsedSize;
	merchantSku?: string;
	/** True when the key is GTIN-backed; cross-merchant claims require this. */
	authoritative: boolean;
};

export type ObservationSource =
	| "cart_scan"
	| "search_result"
	| "product_page"
	| "seed_import"
	| "receipt_import";

export type ProductObservation = {
	id: string;
	observedAt: string;
	merchantId: string;
	identity: ProductIdentity;
	/** Shelf/list price before promotions, when distinguishable. */
	listPriceCents?: number;
	/** Price actually shown as payable for one item. */
	pricePaidCents?: number;
	quantity?: number;
	availability?: "in_stock" | "unavailable" | "unknown";
	source: ObservationSource;
	adapterId?: string;
	adapterVersion?: string;
	confidence: "high" | "medium" | "low";
	/** Free-form provenance for imports, e.g. "amazon-order-history". */
	importBatchId?: string;
};

/**
 * Ground truth: what was actually bought, for how much. This is the highest-value
 * signal in the system — it closes the loop on whether a recommendation was
 * right — and it is exactly what a cart scan alone can never tell you.
 */
export type PurchaseEvent = {
	id: string;
	occurredAt: string;
	merchantId: string;
	source: "user_confirmed" | "order_history_import" | "receipt_import";
	subtotalCents?: number;
	feesCents?: number;
	taxCents?: number;
	totalCents?: number;
	fulfillmentType?: "delivery" | "pickup" | "in_store" | "shipped" | "unknown";
	importBatchId?: string;
};

export type PurchaseEventLine = {
	id: string;
	purchaseEventId: string;
	identity: ProductIdentity;
	quantity: number;
	paidUnitPriceCents?: number;
	lineTotalCents?: number;
};

export type ImportBatch = {
	id: string;
	importedAt: string;
	sourceLabel: string;
	/** Rows the user chose to import (after preview), not rows in the file. */
	rowsImported: number;
	rowsSkipped: number;
	notes: string[];
};

/** A price point for one product identity, used for history and benchmarking. */
export type PricePoint = {
	observedAt: string;
	merchantId: string;
	pricePaidCents: number;
	totalBaseUnits?: number;
	source: ObservationSource;
};

export type PriceBenchmark = {
	productKey: string;
	/** Observations backing this benchmark. Small n ⇒ weak claim; UI must say so. */
	observationCount: number;
	distinctMerchants: number;
	lowestCents: number;
	highestCents: number;
	medianCents: number;
	mostRecentCents: number;
	mostRecentAt: string;
	/** Cheapest observed unit price, when sizes were parseable. */
	bestUnitPrice?: { pricePaidCents: number; totalBaseUnits: number; merchantId: string };
};

export type PriceVerdict =
	| "best_seen"
	| "below_typical"
	| "typical"
	| "above_typical"
	| "worst_seen"
	| "insufficient_history";

export type PriceAssessment = {
	verdict: PriceVerdict;
	/** Plain-language sentences the UI renders verbatim. Never a bare number. */
	explanation: string[];
	benchmark?: PriceBenchmark;
	differenceFromMedianCents?: number;
};

/** Personal repurchase cadence, derived from purchase ground truth. */
export type ConsumptionInterval = {
	productKey: string;
	medianDaysBetween: number;
	purchaseCount: number;
	lastPurchasedAt: string;
	/** Only meaningful with ≥3 purchases; below that the UI must not predict. */
	reliable: boolean;
};

/** Minimum purchases before we will claim a repurchase cadence at all. */
export const MIN_PURCHASES_FOR_CADENCE = 3;
/** Minimum price observations before we will call a price "good" or "bad". */
export const MIN_OBSERVATIONS_FOR_BENCHMARK = 3;
