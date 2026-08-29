import { z } from "zod";
import type { CartRecommendation, CartSnapshot, CartSnapshotDraft, DetectionStatus, SupportedPlatform } from "./types";

export type ScanCurrentPageMessage = {
	type: "SCAN_CURRENT_PAGE";
	payload: { tabId?: number };
};

export type PageDetectionResultMessage = {
	type: "PAGE_DETECTION_RESULT";
	payload: {
		tabId: number;
		platform: SupportedPlatform;
		detectionStatus: DetectionStatus;
	};
};

export type CartSnapshotExtractedMessage = {
	type: "CART_SNAPSHOT_EXTRACTED";
	payload: {
		tabId: number;
		draft: CartSnapshotDraft;
	};
};

export type CartScanCompleteMessage = {
	type: "CART_SCAN_COMPLETE";
	payload: {
		tabId: number;
		snapshot: CartSnapshot;
		recommendation: CartRecommendation;
	};
};

export type CartScanFailedMessage = {
	type: "CART_SCAN_FAILED";
	payload: {
		tabId?: number;
		reason: string;
	};
};

/**
 * The page is scannable, but this origin has not been granted yet. Carries the
 * origin so the side panel can request exactly that one site — the request
 * itself needs a user gesture, which a service worker does not have.
 */
export type CartScanPermissionRequiredMessage = {
	type: "CART_SCAN_PERMISSION_REQUIRED";
	payload: {
		tabId?: number;
		origin: string;
		originPattern: string;
	};
};

export type ExtensionMessage =
	| ScanCurrentPageMessage
	| CartScanPermissionRequiredMessage
	| PageDetectionResultMessage
	| CartSnapshotExtractedMessage
	| CartScanCompleteMessage
	| CartScanFailedMessage;

/**
 * What a content script actually sends. Content scripts have no
 * `chrome.tabs` access and cannot know their own tabId, so it's always
 * omitted here — the background fills it in from `sender.tab.id`, which is
 * the only trustworthy source for it.
 */
export type ContentScriptMessage =
	| { type: "PAGE_DETECTION_RESULT"; payload: { platform: SupportedPlatform; detectionStatus: DetectionStatus } }
	| { type: "CART_SNAPSHOT_EXTRACTED"; payload: { draft: CartSnapshotDraft } }
	| { type: "CART_SCAN_FAILED"; payload: { reason: string } };

const SUPPORTED_PLATFORMS = [
	"generic",
	"demo_store",
	"doordash",
	"ubereats",
	"instacart",
	"target",
	"walmart",
	"unknown",
] as const;

const DETECTION_STATUSES = [
	"supported",
	"experimental",
	"not_detected",
	"scan_unavailable",
] as const;

const CONFIDENCE = ["high", "medium", "low"] as const;

const moneyFactSchema = z.object({
	currency: z.literal("USD"),
	cents: z.number().int(),
	rawText: z.string().optional(),
});

const visibleOfferSchema = z.object({
	title: z.string(),
	rawText: z.string(),
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

const cartLineItemSchema = z.object({
	displayName: z.string(),
	quantity: z.number().optional(),
	unitPriceCents: z.number().int().optional(),
	lineTotalCents: z.number().int().optional(),
	categoryHint: z.string().optional(),
	rawText: z.string().optional(),
});

const cartSnapshotDraftSchema = z.object({
	platform: z.enum(SUPPORTED_PLATFORMS),
	platformLabel: z.string(),
	detectionStatus: z.enum(DETECTION_STATUSES),
	pageUrlOrigin: z.string(),
	pagePathHint: z.string().optional(),
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
	extractionNotes: z.array(z.string()).max(50),
});

const cartSnapshotSchema = cartSnapshotDraftSchema.extend({
	id: z.string().min(1),
	createdAt: z.string().min(1),
	privacy: z.object({
		localOnly: z.literal(true),
		piiRedacted: z.literal(true),
		rawHtmlStored: z.literal(false),
		cookiesRead: z.literal(false),
	}),
});

const cartRecommendationSchema = z.object({
	snapshotId: z.string().min(1),
	generatedAt: z.string().min(1),
	action: z.enum([
		"review_before_checkout",
		"add_threshold_filler",
		"compare_saved_carts",
		"wait_for_more_information",
		"no_action",
	]),
	headline: z.string(),
	rationale: z.array(z.string()).max(20),
	estimatedSavingsCents: z.number().int().optional(),
	thresholdGapCents: z.number().int().optional(),
	suggestedFillerCategory: z.string().optional(),
	warnings: z.array(z.string()).max(20),
	confidence: z.enum(CONFIDENCE),
});

const extensionMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("SCAN_CURRENT_PAGE"),
		payload: z.object({ tabId: z.number().int().optional() }),
	}),
	z.object({
		type: z.literal("PAGE_DETECTION_RESULT"),
		payload: z.object({
			tabId: z.number().int(),
			platform: z.enum(SUPPORTED_PLATFORMS),
			detectionStatus: z.enum(DETECTION_STATUSES),
		}),
	}),
	z.object({
		type: z.literal("CART_SNAPSHOT_EXTRACTED"),
		payload: z.object({
			tabId: z.number().int(),
			draft: cartSnapshotDraftSchema,
		}),
	}),
	z.object({
		type: z.literal("CART_SCAN_COMPLETE"),
		payload: z.object({
			tabId: z.number().int(),
			snapshot: cartSnapshotSchema,
			recommendation: cartRecommendationSchema,
		}),
	}),
	z.object({
		type: z.literal("CART_SCAN_FAILED"),
		payload: z.object({
			tabId: z.number().int().optional(),
			reason: z.string(),
		}),
	}),
	z.object({
		type: z.literal("CART_SCAN_PERMISSION_REQUIRED"),
		payload: z.object({
			tabId: z.number().int().optional(),
			origin: z.string(),
			originPattern: z.string(),
		}),
	}),
]);

const contentScriptMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("PAGE_DETECTION_RESULT"),
		payload: z.object({
			platform: z.enum(SUPPORTED_PLATFORMS),
			detectionStatus: z.enum(DETECTION_STATUSES),
		}),
	}),
	z.object({
		type: z.literal("CART_SNAPSHOT_EXTRACTED"),
		payload: z.object({ draft: cartSnapshotDraftSchema }),
	}),
	z.object({
		type: z.literal("CART_SCAN_FAILED"),
		payload: z.object({ reason: z.string() }),
	}),
]);

/**
 * Validates a value received at a trust boundary (postMessage, runtime
 * messaging) into a known ExtensionMessage shape. Never assume a
 * page/content-script/runtime-provided value is safe without this.
 */
export function parseExtensionMessage(value: unknown): ExtensionMessage | undefined {
	const result = extensionMessageSchema.safeParse(value);
	return result.success ? (result.data as ExtensionMessage) : undefined;
}

/**
 * Validates a message claimed to originate from a content script. Never
 * trusts a tabId from the message itself — callers must fill it in from
 * `sender.tab.id`.
 */
export function parseContentScriptMessage(value: unknown): ContentScriptMessage | undefined {
	const result = contentScriptMessageSchema.safeParse(value);
	return result.success ? (result.data as ContentScriptMessage) : undefined;
}
