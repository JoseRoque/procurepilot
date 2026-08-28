import { describe, expect, it } from "vitest";
import {
	assessPrice,
	buildImportPreview,
	buildPriceBenchmark,
	canCompareAcrossMerchants,
	deriveConsumptionInterval,
	deriveProductIdentity,
	evaluateRepurchase,
	extractGtin,
	isValidGtin,
	normalizeProductName,
	parseCsv,
	suggestMapping,
} from "./index";

describe("parseCsv", () => {
	it("handles quoted fields with embedded commas — real product names have them", () => {
		const csv = 'Title,Qty\n"Barilla Spaghetti, 16 oz",2\nPlain Item,1\n';
		const parsed = parseCsv(csv);
		expect(parsed.headers).toEqual(["Title", "Qty"]);
		expect(parsed.rows[0]).toEqual({ Title: "Barilla Spaghetti, 16 oz", Qty: "2" });
		expect(parsed.rows[1]).toEqual({ Title: "Plain Item", Qty: "1" });
	});

	it("handles doubled quotes and embedded newlines", () => {
		const csv = 'Title\n"He said ""hi"""\n"Line one\nLine two"\n';
		const parsed = parseCsv(csv);
		expect(parsed.rows[0]?.Title).toBe('He said "hi"');
		expect(parsed.rows[1]?.Title).toBe("Line one\nLine two");
	});

	it("strips a UTF-8 BOM (exports routinely have one)", () => {
		const parsed = parseCsv("﻿Title,Qty\nThing,1\n");
		expect(parsed.headers[0]).toBe("Title");
	});

	it("returns empty structure for empty input", () => {
		expect(parseCsv("")).toEqual({ headers: [], rows: [] });
	});
});

describe("suggestMapping", () => {
	it("recognizes an Amazon-style export", () => {
		const mapping = suggestMapping([
			"Order Date",
			"Order ID",
			"Title",
			"ASIN",
			"Quantity",
			"Unit Price",
			"Total Owed",
		]);
		expect(mapping).toMatchObject({
			orderDate: "Order Date",
			orderId: "Order ID",
			itemName: "Title",
			merchantSku: "ASIN",
			quantity: "Quantity",
			unitPrice: "Unit Price",
			lineTotal: "Total Owed",
		});
	});

	it("leaves fields unmapped rather than guessing wrongly", () => {
		const mapping = suggestMapping(["colA", "colB"]);
		expect(mapping.itemName).toBeUndefined();
		expect(mapping.unitPrice).toBeUndefined();
	});
});

describe("buildImportPreview", () => {
	const csv = parseCsv(
		[
			"Order Date,Order ID,Title,ASIN,Quantity,Unit Price,Total Owed",
			'2026-01-05,111-A,"Barilla Spaghetti, 16 oz",B001,2,$1.99,$3.98',
			'2026-01-05,111-A,"Olive oil 500ml",B002,1,$8.49,$8.49',
			'2026-02-10,222-B,"Barilla Spaghetti, 16 oz",B001,1,$2.29,$2.29',
			'2026-03-01,333-C,,B003,1,$5.00,$5.00',
			'not-a-date,444-D,"Something",B004,1,$1.00,$1.00',
			'2026-03-05,555-E,"Refunded thing",B005,1,-$4.00,-$4.00',
		].join("\n"),
	);
	const mapping = suggestMapping(csv.headers);

	const preview = buildImportPreview({
		csv,
		mapping,
		defaultMerchantId: "amazon",
		batchLabel: "amazon-order-history",
	});

	it("groups multi-line orders into one purchase event", () => {
		const jan = preview.events.find((e) => e.event.occurredAt.startsWith("2026-01-05"));
		expect(jan?.lines).toHaveLength(2);
		expect(jan?.event.subtotalCents).toBe(398 + 849);
	});

	it("skips unusable rows with a stated reason instead of guessing", () => {
		const reasons = preview.skipped.map((s) => s.reason).join(" ");
		expect(preview.skipped).toHaveLength(3);
		expect(reasons).toMatch(/No product name/i);
		expect(reasons).toMatch(/Unrecognized date/i);
		expect(reasons).toMatch(/Negative price/i);
	});

	it("produces price observations with integer cents", () => {
		const spaghetti = preview.observations.filter((o) =>
			o.identity.displayName.includes("Barilla"),
		);
		expect(spaghetti).toHaveLength(2);
		expect(spaghetti.map((o) => o.pricePaidCents).sort()).toEqual([199, 229]);
		expect(spaghetti.every((o) => Number.isInteger(o.pricePaidCents))).toBe(true);
		expect(spaghetti.every((o) => o.source === "seed_import")).toBe(true);
	});

	it("parses size from the imported title", () => {
		const oil = preview.observations.find((o) => o.identity.displayName.includes("Olive"));
		expect(oil?.identity.size).toMatchObject({ totalBaseUnits: 500, baseUnit: "ml" });
	});

	it("warns when required columns are missing rather than failing silently", () => {
		const bare = parseCsv("colA,colB\n1,2\n");
		const result = buildImportPreview({
			csv: bare,
			mapping: suggestMapping(bare.headers),
			defaultMerchantId: "unknown",
			batchLabel: "mystery",
		});
		expect(result.warnings.join(" ")).toMatch(/no product-name column/i);
		expect(result.observations).toHaveLength(0);
	});

	it("derives unit price from line total when unit price is absent", () => {
		const noUnit = parseCsv('Date,Title,Quantity,Item Total\n2026-01-01,Thing 500ml,4,$10.00\n');
		const result = buildImportPreview({
			csv: noUnit,
			mapping: suggestMapping(noUnit.headers),
			defaultMerchantId: "store",
			batchLabel: "b",
		});
		expect(result.observations[0]?.pricePaidCents).toBe(250);
	});
});

describe("product identity", () => {
	it("validates GTIN check digits rather than trusting digit count", () => {
		expect(isValidGtin("0012345600012")).toBe(true); // valid EAN-13
		expect(isValidGtin("0012345600013")).toBe(false); // bad check digit
		expect(isValidGtin("12345")).toBe(false);
	});

	it("uses a GTIN as an authoritative key when present and valid", () => {
		const identity = deriveProductIdentity({
			displayName: "Some Product 500ml",
			gtin: "0012345600012",
		});
		expect(identity.key).toBe("gtin:0012345600012");
		expect(identity.authoritative).toBe(true);
	});

	it("falls back to a non-authoritative composite key when the GTIN is invalid", () => {
		const identity = deriveProductIdentity({
			displayName: "Some Product 500ml",
			brand: "Acme",
			gtin: "0012345600013",
		});
		expect(identity.key.startsWith("bn|acme|")).toBe(true);
		expect(identity.authoritative).toBe(false);
	});

	it("strips merchant marketing noise so keys match across listings", () => {
		expect(normalizeProductName("NEW! Acme Pasta® — Best Seller")).toBe("acme pasta");
	});

	it("gives the same composite key to the same product listed differently", () => {
		const a = deriveProductIdentity({ displayName: "NEW! Acme Pasta 500g", brand: "Acme" });
		const b = deriveProductIdentity({ displayName: "Acme Pasta 500g (Best Seller)", brand: "acme" });
		expect(a.key).toBe(b.key);
	});

	it("refuses cross-merchant comparison without GTIN backing", () => {
		const a = deriveProductIdentity({ displayName: "Acme Pasta 500g", brand: "Acme" });
		const b = deriveProductIdentity({ displayName: "Acme Pasta 500g", brand: "Acme" });
		expect(a.key).toBe(b.key); // same key — fine for personal history
		expect(canCompareAcrossMerchants(a, b)).toBe(false); // but not for cross-merchant claims
	});

	it("allows cross-merchant comparison for matching GTINs", () => {
		const a = deriveProductIdentity({ displayName: "Pasta", gtin: "0012345600012" });
		const b = deriveProductIdentity({ displayName: "Pasta 1lb", gtin: "0012345600012" });
		expect(canCompareAcrossMerchants(a, b)).toBe(true);
	});

	it("finds a GTIN embedded in another string", () => {
		expect(extractGtin(undefined, "product/0012345600012/detail")).toBe("0012345600012");
	});
});

describe("price benchmarking", () => {
	const points = [
		{ observedAt: "2026-01-01T00:00:00Z", merchantId: "a", pricePaidCents: 199, source: "seed_import" as const },
		{ observedAt: "2026-02-01T00:00:00Z", merchantId: "a", pricePaidCents: 229, source: "seed_import" as const },
		{ observedAt: "2026-03-01T00:00:00Z", merchantId: "b", pricePaidCents: 249, source: "cart_scan" as const },
	];

	it("refuses a verdict below the evidence threshold", () => {
		const thin = buildPriceBenchmark("k", points.slice(0, 2));
		const assessment = assessPrice(199, thin);
		expect(assessment.verdict).toBe("insufficient_history");
		expect(assessment.explanation.join(" ")).toMatch(/not enough/i);
	});

	it("identifies the best price seen", () => {
		const benchmark = buildPriceBenchmark("k", points);
		const assessment = assessPrice(189, benchmark);
		expect(assessment.verdict).toBe("best_seen");
		expect(assessment.explanation.join(" ")).toMatch(/lowest price you have recorded/i);
	});

	it("identifies an above-typical price with the arithmetic shown", () => {
		const benchmark = buildPriceBenchmark("k", points);
		const assessment = assessPrice(299, benchmark);
		expect(assessment.verdict).toBe("worst_seen");
		expect(assessment.explanation.join(" ")).toContain("$2.29"); // median
	});

	it("calls a near-median price typical", () => {
		const benchmark = buildPriceBenchmark("k", points);
		expect(assessPrice(230, benchmark).verdict).toBe("typical");
	});

	it("warns when all history comes from one merchant", () => {
		const single = buildPriceBenchmark("k", points.slice(0, 2).concat({
			observedAt: "2026-03-01T00:00:00Z", merchantId: "a", pricePaidCents: 219, source: "cart_scan" as const,
		}));
		const assessment = assessPrice(219, single);
		expect(assessment.explanation.join(" ")).toMatch(/single merchant/i);
	});

	it("picks the best UNIT price, not the lowest sticker price", () => {
		const benchmark = buildPriceBenchmark("k", [
			{ observedAt: "2026-01-01T00:00:00Z", merchantId: "small", pricePaidCents: 499, totalBaseUnits: 500, source: "cart_scan" },
			{ observedAt: "2026-01-02T00:00:00Z", merchantId: "large", pricePaidCents: 799, totalBaseUnits: 1000, source: "cart_scan" },
		]);
		expect(benchmark?.bestUnitPrice?.merchantId).toBe("large"); // higher sticker, better value
	});
});

describe("consumption cadence", () => {
	it("will not claim a cadence from a single interval", () => {
		const interval = deriveConsumptionInterval("k", [
			"2026-01-01T00:00:00Z",
			"2026-01-29T00:00:00Z",
		]);
		expect(interval?.reliable).toBe(false);
		expect(evaluateRepurchase(interval!, "2026-03-01T00:00:00Z").likelyDue).toBe(false);
	});

	it("derives a median interval and flags a due repurchase", () => {
		const interval = deriveConsumptionInterval("k", [
			"2026-01-01T00:00:00Z",
			"2026-01-29T00:00:00Z",
			"2026-02-26T00:00:00Z",
		]);
		expect(interval?.medianDaysBetween).toBe(28);
		expect(interval?.reliable).toBe(true);
		const signal = evaluateRepurchase(interval!, "2026-03-26T00:00:00Z");
		expect(signal.likelyDue).toBe(true);
		expect(signal.explanation).toMatch(/every 28 days/);
	});

	it("returns undefined with fewer than two purchases", () => {
		expect(deriveConsumptionInterval("k", ["2026-01-01T00:00:00Z"])).toBeUndefined();
	});
});
