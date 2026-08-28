import type { BaseUnit, ParsedSize, UnitDimension } from "../../domain/src";

/**
 * Size/unit parsing and unit-price math.
 *
 * WHY THIS EXISTS: "$4.99 for 500ml" vs "$7.99 for 1L" — the second is cheaper
 * per unit. Comparing sticker prices gets this backwards. Almost no consumer
 * tool normalizes correctly, so this is where much of the real intelligence is.
 *
 * ROUNDING BOUNDARY: unit conversion is the ONE place floating point is used,
 * and only because the label itself is already a rounded decimal ("16.9 fl oz"
 * is not an exact quantity). We convert once at parse time and immediately
 * round to integer base units. Everything downstream — comparison, ranking,
 * benchmarking — is exact integer arithmetic. Comparisons never divide (see
 * compareUnitPrice), so no precision is lost after parsing.
 */

type UnitSpec = { dimension: UnitDimension; toBase: number; ambiguous?: boolean };

// Longest aliases first so "fl oz" wins over "oz" during matching.
const UNIT_ALIASES: Array<[string, UnitSpec]> = [
	["fluid ounces", { dimension: "volume", toBase: 29.5735295625 }],
	["fluid ounce", { dimension: "volume", toBase: 29.5735295625 }],
	["fl. oz.", { dimension: "volume", toBase: 29.5735295625 }],
	["fl oz", { dimension: "volume", toBase: 29.5735295625 }],
	["floz", { dimension: "volume", toBase: 29.5735295625 }],
	["milliliters", { dimension: "volume", toBase: 1 }],
	["milliliter", { dimension: "volume", toBase: 1 }],
	["millilitres", { dimension: "volume", toBase: 1 }],
	["ml", { dimension: "volume", toBase: 1 }],
	["liters", { dimension: "volume", toBase: 1000 }],
	["liter", { dimension: "volume", toBase: 1000 }],
	["litres", { dimension: "volume", toBase: 1000 }],
	["litre", { dimension: "volume", toBase: 1000 }],
	["gallons", { dimension: "volume", toBase: 3785.411784 }],
	["gallon", { dimension: "volume", toBase: 3785.411784 }],
	["gal", { dimension: "volume", toBase: 3785.411784 }],
	["quarts", { dimension: "volume", toBase: 946.352946 }],
	["quart", { dimension: "volume", toBase: 946.352946 }],
	["qt", { dimension: "volume", toBase: 946.352946 }],
	["pints", { dimension: "volume", toBase: 473.176473 }],
	["pint", { dimension: "volume", toBase: 473.176473 }],
	["pt", { dimension: "volume", toBase: 473.176473 }],
	["l", { dimension: "volume", toBase: 1000 }],

	["kilograms", { dimension: "weight", toBase: 1000 }],
	["kilogram", { dimension: "weight", toBase: 1000 }],
	["kg", { dimension: "weight", toBase: 1000 }],
	["grams", { dimension: "weight", toBase: 1 }],
	["gram", { dimension: "weight", toBase: 1 }],
	["pounds", { dimension: "weight", toBase: 453.59237 }],
	["pound", { dimension: "weight", toBase: 453.59237 }],
	["lbs", { dimension: "weight", toBase: 453.59237 }],
	["lb", { dimension: "weight", toBase: 453.59237 }],
	// Bare "oz" is overwhelmingly weight on food labels, but it IS ambiguous —
	// flagged low confidence so the engine can decline to compare on it.
	["ounces", { dimension: "weight", toBase: 28.349523125, ambiguous: true }],
	["ounce", { dimension: "weight", toBase: 28.349523125, ambiguous: true }],
	["oz", { dimension: "weight", toBase: 28.349523125, ambiguous: true }],
	["g", { dimension: "weight", toBase: 1 }],

	["counts", { dimension: "count", toBase: 1 }],
	["count", { dimension: "count", toBase: 1 }],
	["packs", { dimension: "count", toBase: 1 }],
	["pack", { dimension: "count", toBase: 1 }],
	["pk", { dimension: "count", toBase: 1 }],
	["ct", { dimension: "count", toBase: 1 }],
	["each", { dimension: "count", toBase: 1 }],
	["ea", { dimension: "count", toBase: 1 }],
];

const UNIT_PATTERN = UNIT_ALIASES.map(([alias]) =>
	alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"),
).join("|");

const NUMBER = String.raw`\d+(?:\.\d+)?`;

/** "2 x 1L", "2x1 L", "6 × 12 oz" — multipack with an explicit per-item size. */
const MULTIPACK_WITH_SIZE = new RegExp(
	String.raw`(\d+)\s*[x×]\s*(${NUMBER})\s*(${UNIT_PATTERN})\b`,
	"i",
);

/** "12-pack", "12 ct", "6pk" — a count with no per-item size. */
const COUNT_ONLY = new RegExp(
	String.raw`(\d+)\s*[-\s]?\s*(counts?|packs?|pk|ct|ea|each)\b`,
	"i",
);

/** "500ml", "1.5 L", "16.9 fl oz" — a single size. */
const SINGLE_SIZE = new RegExp(String.raw`(${NUMBER})\s*(${UNIT_PATTERN})\b`, "i");

/** Bare word sizes with no number. */
const WORD_SIZES: Array<[RegExp, { dimension: UnitDimension; base: number }]> = [
	[/\bhalf[-\s]?gallon\b/i, { dimension: "volume", base: 1892.705892 }],
	[/\bgallon\b/i, { dimension: "volume", base: 3785.411784 }],
	[/\bquart\b/i, { dimension: "volume", base: 946.352946 }],
	[/\bpint\b/i, { dimension: "volume", base: 473.176473 }],
	[/\bdozen\b/i, { dimension: "count", base: 12 }],
];

function lookupUnit(raw: string): UnitSpec | undefined {
	const needle = raw.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
	for (const [alias, spec] of UNIT_ALIASES) {
		if (alias === needle || alias.replace(/\s+/g, "") === needle.replace(/\s+/g, "")) {
			return spec;
		}
	}
	return undefined;
}

function baseUnitOf(dimension: UnitDimension): BaseUnit {
	return dimension === "volume" ? "ml" : dimension === "weight" ? "g" : "each";
}

/**
 * Extracts a normalized size from a product title.
 * Returns undefined rather than guessing when nothing parses — an unparsed
 * size means "compare by item only", never a fabricated denominator.
 */
export function parseSize(displayName: string): ParsedSize | undefined {
	if (typeof displayName !== "string" || displayName.trim() === "") return undefined;
	const text = displayName.replace(/\s+/g, " ");

	// 1. Multipack with per-item size: "2 x 1L" → 2 items of 1000ml.
	const multi = MULTIPACK_WITH_SIZE.exec(text);
	if (multi) {
		const spec = lookupUnit(multi[3] ?? "");
		if (spec) {
			const packCount = Number.parseInt(multi[1] ?? "1", 10);
			const perItem = Math.round(Number.parseFloat(multi[2] ?? "0") * spec.toBase);
			if (packCount > 0 && perItem > 0) {
				return {
					dimension: spec.dimension,
					baseUnitsPerItem: perItem,
					packCount,
					totalBaseUnits: perItem * packCount,
					baseUnit: baseUnitOf(spec.dimension),
					matchedText: multi[0] ?? "",
					confidence: spec.ambiguous ? "low" : "high",
				};
			}
		}
	}

	// 2. A size plus a separate count elsewhere in the title:
	//    "Sparkling water 12-pack 12 fl oz".
	const single = SINGLE_SIZE.exec(text);
	const countOnly = COUNT_ONLY.exec(text);

	if (single) {
		const spec = lookupUnit(single[2] ?? "");
		// A "12 ct" match also matches SINGLE_SIZE (ct is a count unit); only
		// treat it as a per-item size when it is a real volume/weight.
		if (spec && spec.dimension !== "count") {
			const perItem = Math.round(Number.parseFloat(single[1] ?? "0") * spec.toBase);
			if (perItem > 0) {
				const packCount =
					countOnly && countOnly.index !== single.index
						? Math.max(1, Number.parseInt(countOnly[1] ?? "1", 10))
						: 1;
				return {
					dimension: spec.dimension,
					baseUnitsPerItem: perItem,
					packCount,
					totalBaseUnits: perItem * packCount,
					baseUnit: baseUnitOf(spec.dimension),
					matchedText: countOnly && packCount > 1 ? `${countOnly[0]} ${single[0]}` : (single[0] ?? ""),
					confidence: spec.ambiguous ? "low" : "high",
				};
			}
		}
	}

	// 3. Word sizes: "half gallon", "dozen".
	for (const [pattern, spec] of WORD_SIZES) {
		const match = pattern.exec(text);
		if (match) {
			const perItem = Math.round(spec.base);
			return {
				dimension: spec.dimension,
				baseUnitsPerItem: perItem,
				packCount: 1,
				totalBaseUnits: perItem,
				baseUnit: baseUnitOf(spec.dimension),
				matchedText: match[0],
				confidence: "high",
			};
		}
	}

	// 4. Count only: "12-pack" with no per-item size.
	if (countOnly) {
		const packCount = Number.parseInt(countOnly[1] ?? "0", 10);
		if (packCount > 0) {
			return {
				dimension: "count",
				baseUnitsPerItem: 1,
				packCount,
				totalBaseUnits: packCount,
				baseUnit: "each",
				matchedText: countOnly[0],
				confidence: "high",
			};
		}
	}

	return undefined;
}

/**
 * Exact unit-price comparison with NO division.
 *
 * a is cheaper per unit iff  priceA/unitsA < priceB/unitsB
 *                       iff  priceA*unitsB < priceB*unitsA   (units > 0)
 *
 * Returns <0 if a is cheaper per unit, 0 if equal, >0 if b is cheaper.
 */
export function compareUnitPrice(
	a: { pricePaidCents: number; totalBaseUnits: number },
	b: { pricePaidCents: number; totalBaseUnits: number },
): number {
	const left = a.pricePaidCents * b.totalBaseUnits;
	const right = b.pricePaidCents * a.totalBaseUnits;
	return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Display-only unit price, rounded to whole cents per 100 base units
 * (per 100ml / per 100g) or per item for counts. Never used for decisions.
 */
export function unitPriceForDisplay(
	pricePaidCents: number,
	size: ParsedSize,
): { cents: number; label: string } | undefined {
	if (size.totalBaseUnits <= 0) return undefined;
	if (size.baseUnit === "each") {
		return {
			cents: Math.round(pricePaidCents / size.totalBaseUnits),
			label: "each",
		};
	}
	return {
		cents: Math.round((pricePaidCents * 100) / size.totalBaseUnits),
		label: `per 100${size.baseUnit}`,
	};
}

/** Two sizes are comparable only within the same dimension and above low confidence. */
export function sizesAreComparable(a: ParsedSize, b: ParsedSize): boolean {
	if (a.dimension !== b.dimension) return false;
	// An ambiguous "oz" could be weight or fluid; refuse rather than mislead.
	if (a.confidence === "low" || b.confidence === "low") return false;
	return true;
}
