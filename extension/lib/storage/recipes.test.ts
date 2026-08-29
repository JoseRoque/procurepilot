import { describe, expect, it } from "vitest";
import { exportRecipe, parseImportedRecipe } from "./recipes";
import type { DealRecipe } from "../../../packages/domain/src";

const VALID = {
	recipeId: "r1",
	formatVersion: 1,
	merchantId: "examplemart",
	title: "$50 spend deal",
	items: [{ name: "Cereal", quantity: 2, requiredExact: false }],
	terms: [{ kind: "min_spend", cents: 5000 }],
	steps: ["Clip the coupon first"],
	createdAt: "2026-06-01T00:00:00.000Z",
};

describe("parseImportedRecipe", () => {
	it("accepts a well-formed recipe", () => {
		const result = parseImportedRecipe(JSON.stringify(VALID));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.recipe.title).toBe("$50 spend deal");
	});

	it("records provenance itself so an import cannot claim to be locally authored", () => {
		const spoofed = { ...VALID, source: { kind: "authored_locally" } };
		const result = parseImportedRecipe(JSON.stringify(spoofed));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.recipe.source.kind).toBe("imported_file");
	});

	it("rejects an unknown condition rather than ignoring it", () => {
		// Silently dropping a condition would let a recipe appear to qualify
		// on terms this version never checked.
		const result = parseImportedRecipe(
			JSON.stringify({ ...VALID, terms: [{ kind: "requires_secret_handshake" }] }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/does not understand/i);
	});

	it("rejects a future format version instead of guessing at it", () => {
		const result = parseImportedRecipe(JSON.stringify({ ...VALID, formatVersion: 2 }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/unsupported format version/i);
	});

	it("rejects non-integer or negative money", () => {
		for (const cents of [12.5, -100, "50", null]) {
			const result = parseImportedRecipe(
				JSON.stringify({ ...VALID, terms: [{ kind: "min_spend", cents }] }),
			);
			expect(result.ok, String(cents)).toBe(false);
		}
	});

	it("rejects an invalid quantity", () => {
		for (const quantity of [0, -1, 1.5, "2"]) {
			const result = parseImportedRecipe(
				JSON.stringify({ ...VALID, items: [{ name: "Cereal", quantity, requiredExact: false }] }),
			);
			expect(result.ok, String(quantity)).toBe(false);
		}
	});

	it("rejects malformed JSON without throwing", () => {
		const result = parseImportedRecipe("{not json");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/not valid recipe JSON/i);
	});

	it("rejects a recipe with no merchant", () => {
		const result = parseImportedRecipe(JSON.stringify({ ...VALID, merchantId: "  " }));
		expect(result.ok).toBe(false);
	});

	it("rejects an oversized blob before parsing it", () => {
		const result = parseImportedRecipe("x".repeat(200_000));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/too large/i);
	});

	it("drops non-string steps rather than rendering them", () => {
		const result = parseImportedRecipe(
			JSON.stringify({ ...VALID, steps: ["ok", 42, { a: 1 }, "also ok"] }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.recipe.steps).toEqual(["ok", "also ok"]);
	});
});

describe("exportRecipe", () => {
	it("strips the device id and local provenance before sharing", () => {
		const recipe = {
			...VALID,
			authorDeviceId: "device-abc123",
			source: { kind: "authored_locally" },
		} as unknown as DealRecipe;
		const exported = exportRecipe(recipe);
		expect(exported).not.toMatch(/device-abc123/);
		expect(exported).not.toMatch(/authorDeviceId/);
		expect(exported).not.toMatch(/authored_locally/);
		expect(exported).toMatch(/examplemart/);
	});

	it("round-trips back through the importer", () => {
		const exported = exportRecipe(VALID as unknown as DealRecipe);
		const result = parseImportedRecipe(exported);
		expect(result.ok).toBe(true);
	});
});
