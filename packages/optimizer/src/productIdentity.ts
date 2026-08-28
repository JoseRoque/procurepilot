import type { ParsedSize, ProductIdentity } from "../../domain/src";
import { parseSize } from "./units";

/**
 * Deriving a stable product identity from what a page or an export shows.
 *
 * This is the hardest part of the whole system. "Barilla Spaghetti 16 oz" at
 * one merchant and "Barilla Pasta, Spaghetti — 1 lb" at another are the same
 * product, and nothing in the strings says so. We take a deliberately
 * conservative position:
 *
 *   - A visible GTIN/UPC is authoritative and enables cross-merchant claims.
 *   - Without one we build a composite key and mark it NON-authoritative, so
 *     the engine will use it for personal history but will not assert
 *     "cheaper at merchant X" on its strength alone.
 *
 * Being wrong here means telling someone a different product is cheaper, which
 * is worse than saying nothing. Hence: no fuzzy matching, no similarity scores.
 */

/** Marketing noise that varies between merchants for the identical product. */
const NOISE_PATTERNS: RegExp[] = [
	/\b(new|sale|clearance|rollback|limited time|best seller|bestseller)\b/gi,
	/\b(free shipping|ships free|online only|exclusive)\b/gi,
	/\b(pack of \d+)\b/gi,
	/[®™©]/g,
	/\s*[-–—|,]\s*$/g,
];

/** GTIN-8/12/13/14 — a run of digits of a valid barcode length. */
const GTIN_PATTERN = /\b(\d{8}|\d{12}|\d{13}|\d{14})\b/;

export function normalizeProductName(displayName: string): string {
	let text = String(displayName ?? "").toLowerCase();
	for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, " ");
	return text
		.replace(/[^a-z0-9%.\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Validates a GTIN by its mod-10 check digit. A string of the right length is
 * not enough — plenty of SKUs and model numbers are 12 digits — so an invalid
 * check digit means we fall back to the composite key rather than assert a
 * cross-merchant identity we cannot support.
 */
export function isValidGtin(candidate: string): boolean {
	if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(candidate)) return false;
	const digits = candidate.split("").map(Number);
	const check = digits.pop() as number;
	let sum = 0;
	// Weights alternate 3/1 from the rightmost body digit leftward.
	for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
		sum += (digits[i] as number) * weight;
	}
	return (10 - (sum % 10)) % 10 === check;
}

export function extractGtin(...candidates: Array<string | undefined>): string | undefined {
	for (const candidate of candidates) {
		if (!candidate) continue;
		const direct = candidate.replace(/[\s-]/g, "");
		if (isValidGtin(direct)) return direct;
		const match = GTIN_PATTERN.exec(candidate);
		if (match?.[1] && isValidGtin(match[1])) return match[1];
	}
	return undefined;
}

function sizeKeyPart(size: ParsedSize | undefined): string {
	if (!size) return "nosize";
	return `${size.totalBaseUnits}${size.baseUnit}x${size.packCount}`;
}

export type IdentityInput = {
	displayName: string;
	brand?: string;
	gtin?: string;
	merchantSku?: string;
	/** Any extra strings that might carry a barcode (structured data, URLs). */
	gtinCandidates?: Array<string | undefined>;
};

export function deriveProductIdentity(input: IdentityInput): ProductIdentity {
	const displayName = String(input.displayName ?? "").trim();
	const normalizedName = normalizeProductName(displayName);
	const size = parseSize(displayName);
	const gtin = extractGtin(input.gtin, ...(input.gtinCandidates ?? []));
	const brand = input.brand?.trim() || undefined;

	if (gtin) {
		return {
			key: `gtin:${gtin}`,
			gtin,
			brand,
			normalizedName,
			displayName,
			size,
			merchantSku: input.merchantSku,
			authoritative: true,
		};
	}

	const key = [
		"bn",
		brand ? normalizeProductName(brand) : "nobrand",
		normalizedName || "unnamed",
		sizeKeyPart(size),
	].join("|");

	return {
		key,
		brand,
		normalizedName,
		displayName,
		size,
		merchantSku: input.merchantSku,
		authoritative: false,
	};
}

/**
 * Whether two identities may be compared ACROSS merchants.
 * Only GTIN-backed matches qualify. Composite keys are trustworthy within a
 * merchant (naming is consistent there) but not between them.
 */
export function canCompareAcrossMerchants(a: ProductIdentity, b: ProductIdentity): boolean {
	if (!a.authoritative || !b.authoritative) return false;
	return a.key === b.key;
}
