import type { DealRecipe } from "../../../packages/domain/src";

/**
 * Local recipe storage.
 *
 * Recipes live in the extension rather than the sidecar so the couponing
 * flow works without the desktop app installed — requiring a desktop
 * download before someone can try a shared deal would kill the use case.
 * Nothing here is synced; a recipe leaves this device only when the user
 * exports one.
 *
 * Imported recipes are untrusted input. They arrive as text a stranger
 * wrote, so everything is validated before storage and no field is used to
 * decide anything without the checks in packages/optimizer.
 */

const RECIPES_KEY = "pi_deal_recipes";
const MAX_RECIPES = 200;

/** Guards against a pasted blob that would fill the storage quota. */
const MAX_IMPORT_BYTES = 128 * 1024;

export type RecipeImportResult =
	| { ok: true; recipe: DealRecipe }
	| { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TERM_KINDS = new Set([
	"min_spend",
	"buy_n_of",
	"requires_coupon_clip",
	"member_only",
	"limit_per_customer",
	"date_window",
	"manual_review",
]);

/**
 * Validates an imported recipe.
 *
 * Deliberately strict about money and quantities: a non-integer or negative
 * cents value would flow straight into the deterministic evaluator and make
 * its arithmetic meaningless, which is worse than refusing the import.
 */
export function parseImportedRecipe(raw: string): RecipeImportResult {
	if (raw.length > MAX_IMPORT_BYTES) {
		return { ok: false, reason: "That recipe is too large to import." };
	}

	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "That is not valid recipe JSON." };
	}
	if (!isRecord(value)) {
		return { ok: false, reason: "A recipe must be a JSON object." };
	}
	if (value.formatVersion !== 1) {
		return {
			ok: false,
			reason: "This recipe uses an unsupported format version. Update the extension, or ask for a v1 recipe.",
		};
	}
	if (typeof value.merchantId !== "string" || !value.merchantId.trim()) {
		return { ok: false, reason: "The recipe does not say which merchant it is for." };
	}
	if (typeof value.title !== "string" || !value.title.trim()) {
		return { ok: false, reason: "The recipe has no title." };
	}
	if (!Array.isArray(value.items) || !Array.isArray(value.terms)) {
		return { ok: false, reason: "The recipe is missing its items or conditions." };
	}

	for (const item of value.items) {
		if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) {
			return { ok: false, reason: "One of the recipe's items has no name." };
		}
		if (!Number.isInteger(item.quantity) || (item.quantity as number) < 1) {
			return { ok: false, reason: `Item "${item.name}" has an invalid quantity.` };
		}
		if (
			item.expectedUnitPriceCents !== undefined &&
			(!Number.isInteger(item.expectedUnitPriceCents) || (item.expectedUnitPriceCents as number) < 0)
		) {
			return { ok: false, reason: `Item "${item.name}" has an invalid price.` };
		}
	}

	for (const term of value.terms) {
		if (!isRecord(term) || typeof term.kind !== "string" || !TERM_KINDS.has(term.kind)) {
			return {
				ok: false,
				reason: "The recipe contains a condition this version does not understand, so it cannot be checked safely.",
			};
		}
		if (term.kind === "min_spend" && (!Number.isInteger(term.cents) || (term.cents as number) < 0)) {
			return { ok: false, reason: "The recipe's spend condition is not a valid amount." };
		}
		if (term.kind === "buy_n_of" && (!Number.isInteger(term.n) || (term.n as number) < 1)) {
			return { ok: false, reason: "The recipe's quantity condition is not a valid number." };
		}
	}

	const recipe = value as unknown as DealRecipe;
	return {
		ok: true,
		recipe: {
			...recipe,
			// Provenance is recorded here, never taken from the file — an
			// imported recipe must not be able to claim it was authored locally.
			source: { kind: "imported_file", importedAt: new Date().toISOString() },
			steps: Array.isArray(recipe.steps) ? recipe.steps.filter((s) => typeof s === "string") : [],
		},
	};
}

export async function listRecipes(): Promise<DealRecipe[]> {
	const stored = await chrome.storage.local.get(RECIPES_KEY);
	const value = stored[RECIPES_KEY];
	return Array.isArray(value) ? (value as DealRecipe[]) : [];
}

export async function recipesForMerchant(merchantId: string): Promise<DealRecipe[]> {
	const all = await listRecipes();
	const wanted = merchantId.toLowerCase();
	return all.filter((recipe) => recipe.merchantId.toLowerCase() === wanted);
}

export async function saveRecipe(recipe: DealRecipe): Promise<void> {
	const all = await listRecipes();
	const without = all.filter((entry) => entry.recipeId !== recipe.recipeId);
	const next = [recipe, ...without].slice(0, MAX_RECIPES);
	await chrome.storage.local.set({ [RECIPES_KEY]: next });
}

export async function deleteRecipe(recipeId: string): Promise<void> {
	const all = await listRecipes();
	await chrome.storage.local.set({ [RECIPES_KEY]: all.filter((r) => r.recipeId !== recipeId) });
}

export async function clearRecipes(): Promise<void> {
	await chrome.storage.local.remove(RECIPES_KEY);
}

/** Serializes a recipe for sharing. Carries no device or personal fields. */
export function exportRecipe(recipe: DealRecipe): string {
	const { authorDeviceId: _authorDeviceId, source: _source, ...shareable } = recipe;
	return JSON.stringify(shareable, null, 2);
}

/* ------------------------------------------------------------------ *
 * Memberships
 * ------------------------------------------------------------------ */

const MEMBERSHIPS_KEY = "pi_memberships";

/**
 * Loyalty programs the user has told us they hold.
 *
 * Stated by the user, never detected. Membership status lives in the
 * merchant session, which is private browser state this product does not
 * read — so the only honest source is the user saying so.
 *
 * Kept in extension storage rather than added to ShoppingPreferences so the
 * deals flow does not require the desktop sidecar or a bridge round-trip.
 */
export async function getMemberships(): Promise<string[]> {
	const stored = await chrome.storage.local.get(MEMBERSHIPS_KEY);
	const value = stored[MEMBERSHIPS_KEY];
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function setMemberships(memberships: string[]): Promise<void> {
	const cleaned = [...new Set(memberships.map((name) => name.trim()).filter(Boolean))].slice(0, 50);
	await chrome.storage.local.set({ [MEMBERSHIPS_KEY]: cleaned });
}
