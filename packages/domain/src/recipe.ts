/**
 * Deal recipes — shareable, deliberately-authored cart setups.
 *
 * A recipe is what someone posts in a couponing group, made structured: the
 * items, the conditions the deal depends on, and the order of operations that
 * makes it work.
 *
 * PRIVACY NOTE. This is the one place item lists are shared, and it does not
 * contradict the rule against storing basket co-occurrence. That rule concerns
 * *observed* purchases, where what a person bought together is close to a
 * fingerprint. A recipe is authored for publication: the author chose every
 * item in it precisely so others would reproduce it. Nothing here is derived
 * from anyone's purchase history, and a recipe must never be generated from
 * one automatically.
 *
 * Recipes carry no delivery address, contact detail, payment instrument, or
 * account identity — the same intake rules apply as everywhere else.
 */

/**
 * A condition the deal depends on.
 *
 * Structured rather than prose so a modified cart can be checked against it.
 * "Customize a little while still adhering to the terms" is only a real
 * guarantee if the terms are machine-evaluable; otherwise the user is guessing
 * and the product is implying a certainty it does not have.
 */
export type DealTerm =
	/** Basket must reach a spend floor, e.g. "$50+ for free shipping". */
	| { kind: "min_spend"; cents: number; note?: string }
	/** N qualifying items required, e.g. "buy 3 participating items". */
	| { kind: "buy_n_of"; n: number; productKeys: string[]; label: string; note?: string }
	/** A coupon must be clipped on the site before checkout. Not auto-clipped. */
	| { kind: "requires_coupon_clip"; label: string; note?: string }
	/** Deal requires a store membership or loyalty account the user must already have. */
	| { kind: "member_only"; programName: string; note?: string }
	/** Merchant-imposed cap; recorded so the UI can warn rather than encourage breaching it. */
	| { kind: "limit_per_customer"; n: number; note?: string }
	/** Deal is only valid within a date window. */
	| { kind: "date_window"; from?: string; until?: string; note?: string }
	/**
	 * A condition that could not be structured. Carried verbatim and always
	 * surfaced as needing human judgement — never silently treated as met.
	 */
	| { kind: "manual_review"; text: string };

export type RecipeItem = {
	/** As written by the author; shown to the user verbatim. */
	name: string;
	quantity: number;
	/** Stable identity when known, so matching survives a renamed listing. */
	gtin?: string;
	merchantSku?: string;
	productKey?: string;
	/** When true, a substitution breaks the deal (e.g. a specific participating SKU). */
	requiredExact: boolean;
	/** Author's expected price, used to flag drift — never presented as current. */
	expectedUnitPriceCents?: number;
};

/** How the recipe entered this device. Provenance is never inferred. */
export type RecipeSource =
	| { kind: "authored_locally" }
	| { kind: "imported_file"; importedAt: string }
	| { kind: "parsed_from_text"; importedAt: string; reviewedByUser: boolean }
	| { kind: "shared_feed"; importedAt: string; feedId: string };

export type DealRecipe = {
	recipeId: string;
	/** Schema version, so an older client can refuse a recipe it cannot evaluate. */
	formatVersion: 1;
	merchantId: string;
	title: string;
	items: RecipeItem[];
	terms: DealTerm[];
	/** Ordered operations that matter, e.g. clip before adding. */
	steps: string[];
	/** Author's figures. Always labelled as the author's claim, never verified. */
	expectedSubtotalCents?: number;
	expectedSavingsCents?: number;
	validFrom?: string;
	validUntil?: string;
	createdAt: string;
	source: RecipeSource;
	/** Pseudonymous. Never a name, handle, or contact detail. */
	authorDeviceId?: string;
};

/* ------------------------------------------------------------------ *
 * Evaluation results
 * ------------------------------------------------------------------ */

export type TermStatus = "met" | "not_met" | "unknown" | "needs_user_action";

export type TermEvaluation = {
	term: DealTerm;
	status: TermStatus;
	/** Plain-language statement of what was checked and what was found. */
	explanation: string;
};

export type RecipeItemMatch = {
	item: RecipeItem;
	/** Present when the cart contains something that matches. */
	matchedLineName?: string;
	matchedQuantity?: number;
	status: "present" | "insufficient_quantity" | "missing" | "substituted";
	explanation: string;
};

export type RecipeEvaluation = {
	recipeId: string;
	items: RecipeItemMatch[];
	terms: TermEvaluation[];
	/**
	 * True only when every term is "met". Any unknown or needs_user_action
	 * keeps this false — an unverifiable condition is never counted as passing.
	 */
	allTermsMet: boolean;
	/** Terms the user must act on themselves (clipping, membership). */
	requiresUserAction: TermEvaluation[];
	warnings: string[];
	explanation: string[];
};
