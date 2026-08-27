import { describe, expect, it } from "vitest";
import { addCents, formatCents, normalizeMoney } from "./money";

describe("normalizeMoney", () => {
	it("parses a plain dollar amount", () => {
		expect(normalizeMoney("$31.42")).toEqual({ currency: "USD", cents: 3142, rawText: "$31.42" });
	});

	it("parses amounts with thousands separators", () => {
		expect(normalizeMoney("$1,234.56")).toEqual({ currency: "USD", cents: 123456, rawText: "$1,234.56" });
	});

	it("parses a whole-dollar amount with no cents", () => {
		expect(normalizeMoney("$12")).toEqual({ currency: "USD", cents: 1200, rawText: "$12" });
	});

	it("parses negative amounts", () => {
		expect(normalizeMoney("-$3.50")).toEqual({ currency: "USD", cents: -350, rawText: "-$3.50" });
	});

	it("parses amounts embedded in surrounding label text", () => {
		const fact = normalizeMoney("Subtotal $31.42");
		expect(fact?.cents).toBe(3142);
	});

	it("returns undefined for text with no money value", () => {
		expect(normalizeMoney("Free delivery")).toBeUndefined();
	});

	it("returns undefined for empty or whitespace-only text", () => {
		expect(normalizeMoney("")).toBeUndefined();
		expect(normalizeMoney("   ")).toBeUndefined();
	});
});

describe("formatCents", () => {
	it("formats positive integer cents", () => {
		expect(formatCents(3142)).toBe("$31.42");
	});

	it("formats negative integer cents", () => {
		expect(formatCents(-350)).toBe("-$3.50");
	});

	it("pads single-digit cents", () => {
		expect(formatCents(100)).toBe("$1.00");
	});

	it("adds thousands separators", () => {
		expect(formatCents(123456)).toBe("$1,234.56");
	});
});

describe("addCents", () => {
	it("sums only integer cents, never floating point dollars", () => {
		expect(addCents(3142, 199, 356, 291)).toBe(3988);
	});

	it("treats undefined values as zero", () => {
		expect(addCents(100, undefined, 50, undefined)).toBe(150);
	});

	it("returns 0 for no arguments", () => {
		expect(addCents()).toBe(0);
	});
});
