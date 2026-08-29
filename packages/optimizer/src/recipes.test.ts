import { describe, expect, it } from "vitest";
import type { DealRecipe, DealTerm, RecipeItem } from "../../domain/src";
import { compareRecipeEvaluations, evaluateRecipe, type CartFacts } from "./recipes";

const NOW = "2026-06-15T12:00:00.000Z";

function recipe(overrides: Partial<DealRecipe> = {}): DealRecipe {
	return {
		recipeId: "r1",
		formatVersion: 1,
		merchantId: "examplemart",
		title: "$50 spend deal",
		items: [{ name: "Cereal 12oz", quantity: 2, requiredExact: false }],
		terms: [{ kind: "min_spend", cents: 5000 }],
		steps: [],
		createdAt: NOW,
		source: { kind: "authored_locally" },
		...overrides,
	};
}

function cart(overrides: Partial<CartFacts> = {}): CartFacts {
	return {
		merchantId: "examplemart",
		lines: [{ displayName: "Cereal 12oz", quantity: 2 }],
		subtotalCents: 5200,
		...overrides,
	};
}

describe("item matching", () => {
	it("matches by product identity even when the listing was renamed", () => {
		const result = evaluateRecipe(
			recipe({ items: [{ name: "Old Name", quantity: 1, gtin: "0012345600012", requiredExact: true }] }),
			cart({ lines: [{ displayName: "Totally Different Name", quantity: 1, gtin: "0012345600012" }] }),
			NOW,
		);
		expect(result.items[0]?.status).toBe("present");
	});

	it("reports a name-only match as substituted when the deal needs that exact item", () => {
		const item: RecipeItem = { name: "Brand X Cereal", quantity: 1, requiredExact: true };
		const result = evaluateRecipe(
			recipe({ items: [item] }),
			cart({ lines: [{ displayName: "Brand X Cereal Family Size", quantity: 1 }] }),
			NOW,
		);
		expect(result.items[0]?.status).toBe("substituted");
		expect(result.items[0]?.explanation).toMatch(/requires that exact item/i);
	});

	it("accepts a name match when the recipe does not require an exact item", () => {
		const result = evaluateRecipe(recipe(), cart(), NOW);
		expect(result.items[0]?.status).toBe("present");
	});

	it("flags insufficient quantity rather than calling it present", () => {
		const result = evaluateRecipe(
			recipe({ items: [{ name: "Cereal 12oz", quantity: 3, requiredExact: false }] }),
			cart(),
			NOW,
		);
		expect(result.items[0]?.status).toBe("insufficient_quantity");
		expect(result.items[0]?.explanation).toMatch(/2×.*3×/);
	});

	it("reports a missing item", () => {
		const result = evaluateRecipe(recipe(), cart({ lines: [] }), NOW);
		expect(result.items[0]?.status).toBe("missing");
	});
});

describe("term evaluation", () => {
	it("computes the gap to a spend minimum", () => {
		const result = evaluateRecipe(recipe(), cart({ subtotalCents: 4250 }), NOW);
		expect(result.terms[0]?.status).toBe("not_met");
		expect(result.terms[0]?.explanation).toMatch(/\$7\.50 short/);
	});

	it("returns unknown, never met, when the subtotal was not detected", () => {
		const result = evaluateRecipe(recipe(), cart({ subtotalCents: undefined }), NOW);
		expect(result.terms[0]?.status).toBe("unknown");
		expect(result.allTermsMet).toBe(false);
	});

	it("treats coupon clipping as the user's action, since coupon state is private", () => {
		const term: DealTerm = { kind: "requires_coupon_clip", label: "$5 off cereal" };
		const result = evaluateRecipe(recipe({ terms: [term] }), cart(), NOW);
		expect(result.terms[0]?.status).toBe("needs_user_action");
		expect(result.terms[0]?.explanation).toMatch(/cannot see or clip coupons/i);
		expect(result.allTermsMet).toBe(false);
	});

	it("treats membership as unverifiable rather than assuming it", () => {
		const result = evaluateRecipe(
			recipe({ terms: [{ kind: "member_only", programName: "Store Plus" }] }),
			cart(),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("needs_user_action");
	});

	it("cannot count qualifying items without product identities", () => {
		const term: DealTerm = {
			kind: "buy_n_of",
			n: 3,
			productKeys: ["gtin:0012345600012"],
			label: "participating items",
		};
		const result = evaluateRecipe(recipe({ terms: [term] }), cart(), NOW);
		expect(result.terms[0]?.status).toBe("unknown");
		expect(result.terms[0]?.explanation).toMatch(/no cart item could be identified/i);
	});

	it("counts qualifying units across lines when identities are present", () => {
		const term: DealTerm = {
			kind: "buy_n_of",
			n: 3,
			productKeys: ["gtin:1", "gtin:2"],
			label: "participating items",
		};
		const result = evaluateRecipe(
			recipe({ terms: [term] }),
			cart({
				lines: [
					{ displayName: "A", quantity: 2, gtin: "1" },
					{ displayName: "B", quantity: 1, gtin: "2" },
					{ displayName: "C", quantity: 5, gtin: "999" },
				],
			}),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("met");
	});

	it("warns rather than encourages when a per-customer limit is exceeded", () => {
		const result = evaluateRecipe(
			recipe({ terms: [{ kind: "limit_per_customer", n: 4 }] }),
			cart({ lines: [{ displayName: "Cereal", quantity: 6 }] }),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("not_met");
		expect(result.terms[0]?.explanation).toMatch(/may void the deal/i);
	});

	it("detects an expired date window", () => {
		const result = evaluateRecipe(
			recipe({ terms: [{ kind: "date_window", until: "2026-01-01T00:00:00.000Z" }] }),
			cart(),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("not_met");
		expect(result.terms[0]?.explanation).toMatch(/expired/i);
	});

	it("surfaces an unstructured condition verbatim for the user to judge", () => {
		const result = evaluateRecipe(
			recipe({ terms: [{ kind: "manual_review", text: "must use the in-store pickup option" }] }),
			cart(),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("needs_user_action");
		expect(result.terms[0]?.explanation).toContain("must use the in-store pickup option");
	});
});

describe("overall verdict", () => {
	it("withholds allTermsMet when any single term is unknown", () => {
		const result = evaluateRecipe(
			recipe({
				terms: [
					{ kind: "min_spend", cents: 1000 },
					{ kind: "buy_n_of", n: 1, productKeys: ["gtin:1"], label: "items" },
				],
			}),
			cart(),
			NOW,
		);
		expect(result.terms[0]?.status).toBe("met");
		expect(result.terms[1]?.status).toBe("unknown");
		expect(result.allTermsMet).toBe(false);
	});

	it("confirms only when every checkable term is met", () => {
		const result = evaluateRecipe(recipe(), cart(), NOW);
		expect(result.allTermsMet).toBe(true);
		expect(result.explanation.join(" ")).toMatch(/Every condition this app can check/);
	});

	it("labels the author's savings as a claim, not a verified figure", () => {
		const result = evaluateRecipe(recipe({ expectedSavingsCents: 2300 }), cart(), NOW);
		expect(result.explanation.join(" ")).toMatch(/their claim about their own order, not a verified/i);
	});

	it("warns when the recipe belongs to a different merchant", () => {
		const result = evaluateRecipe(recipe(), cart({ merchantId: "othermart" }), NOW);
		expect(result.warnings.join(" ")).toMatch(/written for examplemart.*cart is at othermart/i);
	});

	it("warns that an unreviewed parsed recipe is not yet trustworthy", () => {
		const result = evaluateRecipe(
			recipe({ source: { kind: "parsed_from_text", importedAt: NOW, reviewedByUser: false } }),
			cart(),
			NOW,
		);
		expect(result.warnings.join(" ")).toMatch(/parsed from text and has not been reviewed/i);
	});
});

describe("customization impact", () => {
	it("names the term a swap broke", () => {
		const before = evaluateRecipe(recipe(), cart({ subtotalCents: 5200 }), NOW);
		const after = evaluateRecipe(recipe(), cart({ subtotalCents: 4100 }), NOW);
		const diff = compareRecipeEvaluations(before, after);
		expect(diff.stillSafe).toBe(false);
		expect(diff.brokenTerms).toHaveLength(1);
		expect(diff.brokenTerms[0]?.explanation).toMatch(/short of/);
	});

	it("reports a customization that keeps every term intact", () => {
		const before = evaluateRecipe(recipe(), cart({ subtotalCents: 5200 }), NOW);
		const after = evaluateRecipe(recipe(), cart({ subtotalCents: 6100 }), NOW);
		expect(compareRecipeEvaluations(before, after).stillSafe).toBe(true);
	});

	it("reports a term that a change fixed", () => {
		const before = evaluateRecipe(recipe(), cart({ subtotalCents: 4000 }), NOW);
		const after = evaluateRecipe(recipe(), cart({ subtotalCents: 5500 }), NOW);
		const diff = compareRecipeEvaluations(before, after);
		expect(diff.fixedTerms).toHaveLength(1);
		expect(diff.stillSafe).toBe(true);
	});
});
