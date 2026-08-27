import { normalizeMoney } from "../money";
import { parseVisibleOffer } from "../offers";
import { hasSensitiveInputFields, isSensitivePage } from "../sensitivePages";
import type { CartLineItem, MoneyFact, ScanConfidence, VisibleOffer } from "../types";
import type { CommercePageAdapter, CartSnapshotDraft } from "./types";

/** Extraction budget: keep this adapter cheap, bounded, and non-invasive. */
const MAX_CONTAINERS = 6;
const MAX_ROWS_SCANNED = 300;
const MAX_INSPECTED_TEXT_LENGTH = 20_000;
const MAX_OFFERS_CAPTURED = 10;
const MAX_ROW_TEXT_LENGTH = 160;

const CONTAINER_SELECTOR =
	'[class*="cart" i], [class*="checkout" i], [class*="order-summary" i], [id*="cart" i], [id*="checkout" i], [id*="order-summary" i], [data-testid*="cart" i], [data-testid*="checkout" i]';

const ROW_SELECTOR = "tr, li, dt, dd, div, span, p";

type CategoryKey =
	| "subtotal"
	| "discounts"
	| "deliveryFee"
	| "serviceFee"
	| "tax"
	| "visibleCredits"
	| "displayedFinalTotal";

const CATEGORY_PATTERNS: Record<CategoryKey, RegExp> = {
	subtotal: /\bsub[-\s]?total\b/i,
	discounts: /\bdiscounts?\b|\bsavings?\b|\bpromo(?:tion)?\s*applied\b/i,
	deliveryFee: /\bdelivery\s*fee\b|\bshipping\s*fee\b/i,
	serviceFee: /\bservice\s*fee\b/i,
	tax: /\btax(?:es)?\b/i,
	visibleCredits: /\bcredit\b/i,
	displayedFinalTotal: /\b(order\s+)?total\b|\bestimated\s+total\b|\bamount\s+due\b/i,
};

const OFFER_ROW_PATTERN = /\bpromo\b|\boffer\b|\bcoupon\b|% off\b|\$\s*\d+(?:\.\d{1,2})?\s*off\b|free\s+delivery/i;

const ITEM_COUNT_PATTERN = /(\d+)\s*items?\b/i;

function isElementVisible(element: Element): boolean {
	if (!(element instanceof HTMLElement)) return true;
	const rects = element.getClientRects?.();
	const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
	if (style && (style.display === "none" || style.visibility === "hidden")) return false;
	// jsdom returns an empty rect list for most elements; only treat an
	// explicit zero-size *with* inline hidden styling as invisible so tests
	// using jsdom (which has no real layout) still work.
	if (rects && rects.length === 0 && element.hidden) return false;
	return true;
}

function collectCandidateContainers(document: Document): Element[] {
	const found = Array.from(document.querySelectorAll(CONTAINER_SELECTOR)).filter(isElementVisible);
	if (found.length > 0) return found.slice(0, MAX_CONTAINERS);
	// Fall back to <main> (never the full body) if nothing more specific exists.
	const main = document.querySelector("main, [role='main']");
	return main ? [main] : [];
}

function collectRowTexts(containers: Element[], notes: string[]): string[] {
	const rows: string[] = [];
	const seen = new Set<string>();
	let inspectedLength = 0;
	let scanned = 0;

	outer: for (const container of containers) {
		const candidates = container.querySelectorAll(ROW_SELECTOR);
		for (const candidate of candidates) {
			if (scanned >= MAX_ROWS_SCANNED) {
				notes.push("Row scan budget reached; some page content was not inspected.");
				break outer;
			}
			scanned++;

			const text = (candidate.textContent ?? "").replace(/\s+/g, " ").trim();
			if (!text || text.length > MAX_ROW_TEXT_LENGTH) continue;
			if (seen.has(text)) continue;

			inspectedLength += text.length;
			if (inspectedLength > MAX_INSPECTED_TEXT_LENGTH) {
				notes.push("Text inspection budget reached; extraction stopped early.");
				break outer;
			}

			seen.add(text);
			rows.push(text);
		}
	}
	return rows;
}

function extractCategory(
	rows: string[],
	pattern: RegExp,
	notes: string[],
	label: string,
): { fact: MoneyFact | undefined; confidence: ScanConfidence } {
	const matches = rows.filter((row) => pattern.test(row));
	const withMoney = matches
		.map((row) => normalizeMoney(row))
		.filter((fact): fact is MoneyFact => fact !== undefined);

	if (withMoney.length === 0) {
		return { fact: undefined, confidence: "low" };
	}
	if (withMoney.length > 1) {
		const distinctValues = new Set(withMoney.map((fact) => fact.cents));
		if (distinctValues.size > 1) {
			notes.push(`Multiple differing "${label}" values found on page; used the first visible one.`);
			return { fact: withMoney[0], confidence: "medium" };
		}
	}
	return { fact: withMoney[0], confidence: "high" };
}

function extractOffers(rows: string[]): VisibleOffer[] {
	const offerRows = rows.filter((row) => OFFER_ROW_PATTERN.test(row)).slice(0, MAX_OFFERS_CAPTURED);
	return offerRows.map((row) => parseVisibleOffer(row));
}

function extractItemCount(rows: string[]): number | undefined {
	for (const row of rows) {
		const match = ITEM_COUNT_PATTERN.exec(row);
		if (match) {
			const value = Number.parseInt(match[1] ?? "", 10);
			if (Number.isFinite(value)) return value;
		}
	}
	return undefined;
}

/** Cheap heuristic: does the currently visible text look like a cart/checkout page at all? */
function looksLikeCommercePage(url: URL, document: Document): boolean {
	if (/\b(cart|checkout|bag|basket|order-review|order-summary)\b/i.test(url.pathname)) {
		return true;
	}
	const bodyExcerpt = (document.body?.textContent ?? "").slice(0, 4000);
	return /subtotal|shopping\s+cart|your\s+cart|order\s+summary|checkout/i.test(bodyExcerpt);
}

export const genericAdapter: CommercePageAdapter = {
	id: "generic",
	label: "Generic commerce page",

	matches(): boolean {
		// The generic adapter is always the universal fallback; its own
		// detection status decides whether a scan is actually worthwhile.
		return true;
	},

	getDetectionStatus(url, document) {
		const bodyExcerpt = (document.body?.textContent ?? "").slice(0, 2000);
		if (isSensitivePage(url, `${document.title} ${bodyExcerpt}`) || hasSensitiveInputFields(document)) {
			return "scan_unavailable";
		}
		if (!looksLikeCommercePage(url, document)) {
			return "scan_unavailable";
		}
		const containers = collectCandidateContainers(document);
		if (containers.length === 0) return "scan_unavailable";

		const notes: string[] = [];
		const rows = collectRowTexts(containers, notes);
		const hasSubtotal = rows.some((row) => CATEGORY_PATTERNS.subtotal.test(row));
		const hasTotal = rows.some((row) => CATEGORY_PATTERNS.displayedFinalTotal.test(row));
		return hasSubtotal || hasTotal ? "supported" : "scan_unavailable";
	},

	async extract(document: Document, url: URL): Promise<CartSnapshotDraft> {
		const notes: string[] = [];
		const bodyExcerpt = (document.body?.textContent ?? "").slice(0, 2000);

		if (isSensitivePage(url, `${document.title} ${bodyExcerpt}`) || hasSensitiveInputFields(document)) {
			return {
				platform: "generic",
				platformLabel: "Generic commerce page",
				detectionStatus: "scan_unavailable",
				pageUrlOrigin: url.origin,
				pagePathHint: url.pathname,
				items: [],
				visibleOffers: [],
				confidence: "low",
				extractionNotes: [
					"This page appears to involve login, payment entry, or account security. Scanning was skipped for safety.",
				],
			};
		}

		// extract() must be safe to call on its own (as this adapter's public
		// interface allows), not just when a caller already checked
		// getDetectionStatus() first — so re-verify independently here.
		if (!looksLikeCommercePage(url, document)) {
			return {
				platform: "generic",
				platformLabel: "Generic commerce page",
				detectionStatus: "scan_unavailable",
				pageUrlOrigin: url.origin,
				pagePathHint: url.pathname,
				items: [],
				visibleOffers: [],
				confidence: "low",
				extractionNotes: ["This page doesn't look like a cart or checkout page."],
			};
		}

		const containers = collectCandidateContainers(document);
		if (containers.length === 0) {
			return {
				platform: "generic",
				platformLabel: "Generic commerce page",
				detectionStatus: "scan_unavailable",
				pageUrlOrigin: url.origin,
				pagePathHint: url.pathname,
				items: [],
				visibleOffers: [],
				confidence: "low",
				extractionNotes: ["No recognizable cart or checkout container was found on this page."],
			};
		}

		const rows = collectRowTexts(containers, notes);

		const subtotal = extractCategory(rows, CATEGORY_PATTERNS.subtotal, notes, "subtotal");
		const discounts = extractCategory(rows, CATEGORY_PATTERNS.discounts, notes, "discounts");
		const deliveryFee = extractCategory(rows, CATEGORY_PATTERNS.deliveryFee, notes, "delivery fee");
		const serviceFee = extractCategory(rows, CATEGORY_PATTERNS.serviceFee, notes, "service fee");
		const tax = extractCategory(rows, CATEGORY_PATTERNS.tax, notes, "tax");
		const visibleCredits = extractCategory(rows, CATEGORY_PATTERNS.visibleCredits, notes, "credit");
		const displayedFinalTotal = extractCategory(
			rows,
			CATEGORY_PATTERNS.displayedFinalTotal,
			notes,
			"total",
		);

		const visibleOffers = extractOffers(rows);
		const cartItemCount = extractItemCount(rows);
		const items: CartLineItem[] = [];

		if (subtotal.fact === undefined && displayedFinalTotal.fact === undefined) {
			notes.push("Neither a subtotal nor a total could be confidently identified.");
		}

		const confidences = [
			subtotal.fact ? subtotal.confidence : undefined,
			displayedFinalTotal.fact ? displayedFinalTotal.confidence : undefined,
		].filter((value): value is ScanConfidence => value !== undefined);

		let confidence: ScanConfidence = "low";
		if (confidences.length > 0) {
			confidence = confidences.every((value) => value === "high") ? "high" : "medium";
		}
		if (subtotal.fact === undefined && displayedFinalTotal.fact === undefined) {
			confidence = "low";
		}

		return {
			platform: "generic",
			platformLabel: "Generic commerce page",
			detectionStatus: "supported",
			pageUrlOrigin: url.origin,
			pagePathHint: url.pathname,
			cartItemCount,
			items,
			subtotal: subtotal.fact,
			discounts: discounts.fact,
			deliveryFee: deliveryFee.fact,
			serviceFee: serviceFee.fact,
			tax: tax.fact,
			visibleCredits: visibleCredits.fact,
			displayedFinalTotal: displayedFinalTotal.fact,
			visibleOffers,
			confidence,
			extractionNotes: notes,
		};
	},
};
