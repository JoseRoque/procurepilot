import { z } from "zod";
import type { ScanConfidence, SupportedPlatform, VisibleOffer } from "../../domain/src";
import { CONFIDENCE, SUPPORTED_PLATFORMS } from "./schemas";

export type SubtotalBucket =
	| "under_25"
	| "25_35"
	| "35_50"
	| "50_75"
	| "75_100"
	| "100_plus";

export type RedactedOutcomeEvent = {
	schemaVersion: 1;
	eventId: string;
	pseudonymousDeviceId: string;
	consentReceiptId: string;
	consentVersion: string;
	contributionMode: "contribute_redacted_outcomes";
	eventType:
		| "adapter_scan_outcome"
		| "visible_offer_outcome"
		| "approved_action_outcome"
		| "configuration_pack_feedback";
	platform: SupportedPlatform;
	adapterId: string;
	adapterVersion: string;
	occurredAt: string;
	regionBucket?: string;
	categoryBuckets?: string[];
	subtotalBucket?: SubtotalBucket;
	offerType?: VisibleOffer["offerType"];
	offerTerms?: {
		hasMinimumSpend?: boolean;
		minimumSpendCents?: number;
		discountPercent?: number;
		discountCents?: number;
		maximumDiscountCents?: number;
	};
	outcome:
		| "observed"
		| "appeared_applied"
		| "not_applied"
		| "action_succeeded"
		| "action_failed"
		| "unknown";
	confidence: ScanConfidence;
	configPackVersion?: string;
	eventIntegrityHash: string;
};

/**
 * STRICT allowlist schema. `strictObject` rejects any extra key, so a raw
 * cart line, email, URL path, or any other private/prohibited field can never
 * ride along — this is the redaction boundary, and it is tested.
 */
export const redactedOutcomeEventSchema = z.strictObject({
	schemaVersion: z.literal(1),
	eventId: z.uuid(),
	pseudonymousDeviceId: z.string().min(8).max(64),
	consentReceiptId: z.string().min(1).max(64),
	consentVersion: z.string().min(1).max(32),
	contributionMode: z.literal("contribute_redacted_outcomes"),
	eventType: z.enum([
		"adapter_scan_outcome",
		"visible_offer_outcome",
		"approved_action_outcome",
		"configuration_pack_feedback",
	]),
	platform: z.enum(SUPPORTED_PLATFORMS),
	adapterId: z.string().min(1).max(64),
	adapterVersion: z.string().min(1).max(32),
	occurredAt: z.iso.datetime(),
	regionBucket: z.string().max(32).optional(),
	categoryBuckets: z.array(z.string().max(48)).max(8).optional(),
	subtotalBucket: z
		.enum(["under_25", "25_35", "35_50", "50_75", "75_100", "100_plus"])
		.optional(),
	offerType: z
		.enum([
			"order_discount",
			"item_discount",
			"threshold_discount",
			"free_delivery",
			"credit",
			"rebate",
			"unknown",
		])
		.optional(),
	offerTerms: z
		.strictObject({
			hasMinimumSpend: z.boolean().optional(),
			minimumSpendCents: z.number().int().optional(),
			discountPercent: z.number().optional(),
			discountCents: z.number().int().optional(),
			maximumDiscountCents: z.number().int().optional(),
		})
		.optional(),
	outcome: z.enum([
		"observed",
		"appeared_applied",
		"not_applied",
		"action_succeeded",
		"action_failed",
		"unknown",
	]),
	confidence: z.enum(CONFIDENCE),
	configPackVersion: z.string().max(32).optional(),
	eventIntegrityHash: z.string().length(64),
}) satisfies z.ZodType<RedactedOutcomeEvent>;

export function bucketSubtotal(subtotalCents: number): SubtotalBucket {
	if (subtotalCents < 2_500) return "under_25";
	if (subtotalCents < 3_500) return "25_35";
	if (subtotalCents < 5_000) return "35_50";
	if (subtotalCents < 7_500) return "50_75";
	if (subtotalCents < 10_000) return "75_100";
	return "100_plus";
}

/**
 * Belt-and-braces free-text guard: any string field that survives the
 * allowlist is additionally scanned for patterns that must never appear in
 * telemetry. Defense-in-depth on top of the strict schema.
 */
const FORBIDDEN_TELEMETRY_PATTERNS: RegExp[] = [
	/@/, // email-like
	/https?:\/\//i, // URLs
	/[?&][a-z0-9_]+=/i, // query strings
	/\b\d{13,19}\b/, // card-number-length digit runs
	/\bcookie\b/i,
	/\bpassword\b/i,
	/\btoken\b/i,
];

export function validateRedactedEvent(
	value: unknown,
): { ok: true; event: RedactedOutcomeEvent } | { ok: false; reason: string } {
	const parsed = redactedOutcomeEventSchema.safeParse(value);
	if (!parsed.success) {
		return { ok: false, reason: "Event failed the redacted-schema allowlist." };
	}
	const flatStrings = JSON.stringify(parsed.data);
	for (const pattern of FORBIDDEN_TELEMETRY_PATTERNS) {
		if (pattern.test(flatStrings)) {
			return { ok: false, reason: `Event contains forbidden content (${pattern}).` };
		}
	}
	return { ok: true, event: parsed.data as RedactedOutcomeEvent };
}
