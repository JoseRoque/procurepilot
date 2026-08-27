import { normalizeMoney } from "./money";
import type { ScanConfidence, VisibleOffer, VisibleOfferStatus, VisibleOfferType } from "./types";

const PERCENT_OFF_PATTERN = /(\d{1,3})\s*%\s*off/i;
const DOLLAR_OFF_PATTERN = /\$\s*(\d+(?:\.\d{1,2})?)\s*off\b/i;
const CREDIT_PATTERN = /\bcredit\b/i;
const REBATE_PATTERN = /\brebate\b|\bcash\s*back\b/i;
const FREE_DELIVERY_PATTERN = /free\s+(delivery|shipping)/i;
const APPLIED_PATTERN = /\b(applied|activated|already\s+used|in\s+effect)\b/i;
const MIN_SPEND_PLUS_PATTERN = /\$\s*(\d+(?:\.\d{1,2})?)\s*\+/;
const MIN_SPEND_PHRASE_PATTERN =
	/(?:orders?|purchases?|carts?|spend)[^$]{0,12}\$\s*(\d+(?:\.\d{1,2})?)/i;
const MAX_DISCOUNT_CAP_PATTERN = /up\s*to\s*\$\s*(\d+(?:\.\d{1,2})?)/i;

function toCents(text: string): number | undefined {
	return normalizeMoney(`$${text}`)?.cents;
}

function detectOfferType(rawText: string): VisibleOfferType {
	if (FREE_DELIVERY_PATTERN.test(rawText)) return "free_delivery";
	if (CREDIT_PATTERN.test(rawText)) return "credit";
	if (REBATE_PATTERN.test(rawText)) return "rebate";
	const hasThreshold =
		MIN_SPEND_PLUS_PATTERN.test(rawText) || MIN_SPEND_PHRASE_PATTERN.test(rawText);
	if (hasThreshold && (PERCENT_OFF_PATTERN.test(rawText) || DOLLAR_OFF_PATTERN.test(rawText))) {
		return "threshold_discount";
	}
	if (PERCENT_OFF_PATTERN.test(rawText) || DOLLAR_OFF_PATTERN.test(rawText)) {
		return "order_discount";
	}
	return "unknown";
}

function detectStatus(rawText: string): VisibleOfferStatus {
	if (APPLIED_PATTERN.test(rawText)) return "appears_applied";
	return "visible";
}

/**
 * Parses a single line of visible offer/promo text into a structured
 * VisibleOffer. This is intentionally conservative: when the wording is
 * ambiguous, offerType falls back to "unknown" and confidence to "low"
 * rather than guessing.
 */
export function parseVisibleOffer(rawText: string): VisibleOffer {
	const trimmed = rawText.trim();
	const offerType = detectOfferType(trimmed);
	const status = detectStatus(trimmed);

	const percentMatch = PERCENT_OFF_PATTERN.exec(trimmed);
	const dollarMatch = DOLLAR_OFF_PATTERN.exec(trimmed);
	const minSpendPlusMatch = MIN_SPEND_PLUS_PATTERN.exec(trimmed);
	const minSpendPhraseMatch = MIN_SPEND_PHRASE_PATTERN.exec(trimmed);
	const maxCapMatch = MAX_DISCOUNT_CAP_PATTERN.exec(trimmed);

	const discountPercent = percentMatch ? Number.parseInt(percentMatch[1] ?? "", 10) : undefined;
	// "$X off" wording covers order/item discounts; credits and rebates are
	// usually phrased as "$X credit"/"$X cash back" without the word "off",
	// so fall back to the first plain dollar amount in the text for those.
	const genericAmountCents =
		offerType === "credit" || offerType === "rebate" ? normalizeMoney(trimmed)?.cents : undefined;
	const discountCents = dollarMatch ? toCents(dollarMatch[1] ?? "") : genericAmountCents;
	const minimumSpendCents = minSpendPlusMatch
		? toCents(minSpendPlusMatch[1] ?? "")
		: minSpendPhraseMatch
			? toCents(minSpendPhraseMatch[1] ?? "")
			: undefined;
	const maximumDiscountCents = maxCapMatch ? toCents(maxCapMatch[1] ?? "") : undefined;

	let confidence: ScanConfidence = "low";
	if (offerType !== "unknown" && (discountPercent !== undefined || discountCents !== undefined)) {
		confidence = minimumSpendCents !== undefined || offerType === "free_delivery" ? "high" : "medium";
	} else if (offerType !== "unknown") {
		confidence = "medium";
	}

	return {
		title: trimmed.slice(0, 80),
		rawText: trimmed,
		offerType,
		minimumSpendCents,
		discountCents,
		discountPercent,
		maximumDiscountCents,
		status,
		confidence,
	};
}
