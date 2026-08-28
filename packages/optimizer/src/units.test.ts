import { describe, expect, it } from "vitest";
import {
	compareUnitPrice,
	parseSize,
	sizesAreComparable,
	unitPriceForDisplay,
} from "./units";

describe("parseSize", () => {
	it("parses metric volume", () => {
		expect(parseSize("Olive oil 500ml")).toMatchObject({
			dimension: "volume",
			baseUnitsPerItem: 500,
			packCount: 1,
			totalBaseUnits: 500,
			baseUnit: "ml",
			confidence: "high",
		});
		expect(parseSize("Sparkling water 1.5 L")?.totalBaseUnits).toBe(1500);
		expect(parseSize("Cola 2L")?.totalBaseUnits).toBe(2000);
	});

	it("parses metric weight", () => {
		expect(parseSize("Flour 1kg")?.totalBaseUnits).toBe(1000);
		expect(parseSize("Coffee beans 340g")?.totalBaseUnits).toBe(340);
	});

	it("converts US customary units to base units", () => {
		// 16.9 fl oz ≈ 499.79 ml → 500
		expect(parseSize("Water bottle 16.9 fl oz")?.totalBaseUnits).toBe(500);
		// 12 oz (weight) ≈ 340.19 g → 340
		expect(parseSize("Coffee 12 oz")?.totalBaseUnits).toBe(340);
		// 1 lb ≈ 453.59 g → 454
		expect(parseSize("Butter 1 lb")?.totalBaseUnits).toBe(454);
		expect(parseSize("Milk 1 gallon")?.totalBaseUnits).toBe(3785);
	});

	it("distinguishes fluid ounces from weight ounces", () => {
		expect(parseSize("Juice 32 fl oz")?.dimension).toBe("volume");
		expect(parseSize("Cheese 32 oz")?.dimension).toBe("weight");
	});

	it("flags bare ounces as low confidence (genuinely ambiguous)", () => {
		expect(parseSize("Cheese 32 oz")?.confidence).toBe("low");
		expect(parseSize("Juice 32 fl oz")?.confidence).toBe("high");
	});

	it("parses multipacks with a per-item size", () => {
		expect(parseSize("Cola 2 x 1L")).toMatchObject({
			baseUnitsPerItem: 1000,
			packCount: 2,
			totalBaseUnits: 2000,
		});
		expect(parseSize("Seltzer 6 × 12 fl oz")).toMatchObject({
			packCount: 6,
			totalBaseUnits: 2130, // 6 × 355
		});
	});

	it("combines a separate count with a per-item size", () => {
		expect(parseSize("Sparkling water 12-pack 12 fl oz")).toMatchObject({
			packCount: 12,
			baseUnitsPerItem: 355,
			totalBaseUnits: 4260,
		});
	});

	it("parses count-only packs", () => {
		expect(parseSize("Paper towels 6-pack")).toMatchObject({
			dimension: "count",
			packCount: 6,
			totalBaseUnits: 6,
			baseUnit: "each",
		});
		expect(parseSize("Yogurt cups 12 ct")?.totalBaseUnits).toBe(12);
	});

	it("parses word sizes", () => {
		expect(parseSize("Milk half gallon")?.totalBaseUnits).toBe(1893);
		expect(parseSize("Eggs, dozen")).toMatchObject({ dimension: "count", totalBaseUnits: 12 });
	});

	it("returns undefined rather than guessing when nothing parses", () => {
		expect(parseSize("Fixture mystery item")).toBeUndefined();
		expect(parseSize("")).toBeUndefined();
		expect(parseSize("Organic bananas")).toBeUndefined();
	});
});

describe("compareUnitPrice", () => {
	it("catches the case sticker price gets backwards", () => {
		// $4.99/500ml = 0.998¢/ml   vs   $7.99/1000ml = 0.799¢/ml
		// The BIGGER sticker price is the better unit price.
		const small = { pricePaidCents: 499, totalBaseUnits: 500 };
		const large = { pricePaidCents: 799, totalBaseUnits: 1000 };
		expect(compareUnitPrice(small, large)).toBeGreaterThan(0); // small is worse
		expect(compareUnitPrice(large, small)).toBeLessThan(0); // large is better
	});

	it("reports equality exactly", () => {
		expect(
			compareUnitPrice(
				{ pricePaidCents: 200, totalBaseUnits: 100 },
				{ pricePaidCents: 400, totalBaseUnits: 200 },
			),
		).toBe(0);
	});

	it("stays exact where float division would drift", () => {
		// 1/3 vs 1/3 expressed differently — float division can disagree here.
		const a = { pricePaidCents: 1, totalBaseUnits: 3 };
		const b = { pricePaidCents: 7, totalBaseUnits: 21 };
		expect(compareUnitPrice(a, b)).toBe(0);
	});

	it("never divides (integer-only inputs give integer-only intermediates)", () => {
		const a = { pricePaidCents: 12345, totalBaseUnits: 6789 };
		const b = { pricePaidCents: 999, totalBaseUnits: 1000 };
		const result = compareUnitPrice(a, b);
		expect(Number.isInteger(result)).toBe(true);
	});
});

describe("unitPriceForDisplay", () => {
	it("renders per-100 for volume and weight", () => {
		const size = parseSize("Olive oil 500ml")!;
		expect(unitPriceForDisplay(499, size)).toEqual({ cents: 100, label: "per 100ml" });
	});

	it("renders per-each for counts", () => {
		const size = parseSize("Paper towels 6-pack")!;
		expect(unitPriceForDisplay(1200, size)).toEqual({ cents: 200, label: "each" });
	});
});

describe("sizesAreComparable", () => {
	it("refuses across dimensions", () => {
		expect(sizesAreComparable(parseSize("Oil 500ml")!, parseSize("Flour 500g")!)).toBe(false);
	});

	it("refuses when either side is an ambiguous ounce", () => {
		expect(sizesAreComparable(parseSize("Cheese 8 oz")!, parseSize("Cheese 500g")!)).toBe(false);
	});

	it("allows same-dimension confident sizes", () => {
		expect(sizesAreComparable(parseSize("Oil 500ml")!, parseSize("Oil 1L")!)).toBe(true);
	});
});
