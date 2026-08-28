import { z } from "zod";
import type {
	ActionResultInput,
	CartSnapshot,
	CartSnapshotDraft,
	ShoppingItemInput,
	ShoppingPreferences,
} from "../../domain/src";

export const SUPPORTED_PLATFORMS = [
	"generic",
	"demo_store",
	"doordash",
	"ubereats",
	"instacart",
	"target",
	"walmart",
	"unknown",
] as const;

export const DETECTION_STATUSES = [
	"supported",
	"experimental",
	"not_detected",
	"scan_unavailable",
] as const;

export const CONFIDENCE = ["high", "medium", "low"] as const;

export const ACTION_TYPES = [
	"scan_page",
	"open_visible_offers",
	"search_exact_item",
	"add_exact_approved_item",
	"adjust_quantity",
	"remove_optional_item",
	"rescan_cart",
] as const;

export const moneyFactSchema = z.object({
	currency: z.literal("USD"),
	cents: z.number().int(),
	rawText: z.string().max(200).optional(),
});

export const visibleOfferSchema = z.object({
	title: z.string().max(120),
	rawText: z.string().max(400),
	offerType: z.enum([
		"order_discount",
		"item_discount",
		"threshold_discount",
		"free_delivery",
		"credit",
		"rebate",
		"unknown",
	]),
	minimumSpendCents: z.number().int().optional(),
	discountCents: z.number().int().optional(),
	discountPercent: z.number().optional(),
	maximumDiscountCents: z.number().int().optional(),
	status: z.enum(["visible", "appears_applied", "unknown"]),
	confidence: z.enum(CONFIDENCE),
});

export const cartLineItemSchema = z.object({
	displayName: z.string().max(300),
	quantity: z.number().optional(),
	unitPriceCents: z.number().int().optional(),
	lineTotalCents: z.number().int().optional(),
	categoryHint: z.string().max(100).optional(),
	availability: z.enum(["in_stock", "unavailable", "unknown"]).optional(),
	rawText: z.string().max(400).optional(),
});

export const cartSnapshotDraftSchema = z.object({
	platform: z.enum(SUPPORTED_PLATFORMS),
	platformLabel: z.string().max(100),
	detectionStatus: z.enum(DETECTION_STATUSES),
	pageUrlOrigin: z.string().max(200),
	pagePathHint: z.string().max(200).optional(),
	cartItemCount: z.number().int().optional(),
	items: z.array(cartLineItemSchema).max(200),
	subtotal: moneyFactSchema.optional(),
	discounts: moneyFactSchema.optional(),
	deliveryFee: moneyFactSchema.optional(),
	serviceFee: moneyFactSchema.optional(),
	tax: moneyFactSchema.optional(),
	visibleCredits: moneyFactSchema.optional(),
	displayedFinalTotal: moneyFactSchema.optional(),
	visibleOffers: z.array(visibleOfferSchema).max(50),
	confidence: z.enum(CONFIDENCE),
	extractionNotes: z.array(z.string().max(300)).max(50),
	adapterVersion: z.string().max(50).optional(),
}) satisfies z.ZodType<CartSnapshotDraft>;

/**
 * The privacy attestation is literal-typed: a snapshot claiming rawHtmlStored
 * or cookiesRead is rejected at every boundary that parses it.
 */
export const cartSnapshotSchema = cartSnapshotDraftSchema.extend({
	id: z.string().min(1).max(64),
	createdAt: z.string().min(1).max(40),
	privacy: z.object({
		localOnly: z.literal(true),
		piiRedacted: z.literal(true),
		rawHtmlStored: z.literal(false),
		cookiesRead: z.literal(false),
	}),
}) satisfies z.ZodType<CartSnapshot>;

export const shoppingPreferencesSchema = z.object({
	optimizationGoal: z.enum([
		"lowest_final_total",
		"lowest_immediate_payment",
		"fewest_merchants",
		"fastest_fulfillment",
	]),
	thresholdFillerPolicy: z.enum(["household_essentials", "pantry_staples", "none"]),
	substitutionTolerance: z.enum(["exact_only", "brand_preferred", "equivalent_allowed"]),
	maxActionsPerPlan: z.number().int().min(0).max(3),
	maxSingleAddCents: z.number().int().min(0).max(100_000),
	localOnly: z.boolean(),
	demoModeEnabled: z.boolean(),
}) satisfies z.ZodType<ShoppingPreferences>;

export const shoppingItemInputSchema = z.object({
	id: z.string().max(64).optional(),
	name: z.string().min(1).max(200),
	urgency: z.enum(["immediate", "this_week", "stock_up", "watch_only"]),
	targetQuantity: z.number().int().min(1).max(99),
	acceptableSubstitution: z.enum(["exact_only", "brand_preferred", "equivalent_allowed"]),
	maxUnitPriceCents: z.number().int().min(0).max(1_000_000).optional(),
	preferredBrand: z.string().max(100).optional(),
	categoryHint: z.string().max(100).optional(),
	active: z.boolean(),
}) satisfies z.ZodType<ShoppingItemInput>;

/**
 * Per-action-type payload restriction: an action payload may only contain
 * the allowed fields for its type. Anything else is rejected.
 */
export const actionPayloadSchemas: Record<(typeof ACTION_TYPES)[number], z.ZodType> = {
	scan_page: z.strictObject({}),
	open_visible_offers: z.strictObject({}),
	search_exact_item: z.strictObject({ itemName: z.string().min(1).max(200) }),
	add_exact_approved_item: z.strictObject({
		itemName: z.string().min(1).max(200),
		quantity: z.number().int().min(1).max(10),
		maxUnitPriceCents: z.number().int().min(0).max(1_000_000).nullable(),
	}),
	adjust_quantity: z.strictObject({
		itemName: z.string().min(1).max(200),
		fromQuantity: z.number().int().min(0).max(99),
		toQuantity: z.number().int().min(0).max(99),
	}),
	remove_optional_item: z.strictObject({ itemName: z.string().min(1).max(200) }),
	rescan_cart: z.strictObject({}),
};

export const actionResultInputSchema = z.object({
	actionId: z.string().min(1).max(64),
	outcome: z.enum(["succeeded", "failed", "preconditions_failed", "stopped_for_review"]),
	resultSummary: z.string().max(500),
	postActionSnapshotId: z.string().max(64).optional(),
	stopReason: z.string().max(300).optional(),
	evidenceHash: z.string().max(128).optional(),
}) satisfies z.ZodType<ActionResultInput>;
