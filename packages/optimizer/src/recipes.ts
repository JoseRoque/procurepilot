import type {
	DealRecipe,
	DealTerm,
	RecipeEvaluation,
	RecipeItem,
	RecipeItemMatch,
	TermEvaluation,
} from "../../domain/src";

/**
 * Evaluates a deal recipe against the cart actually on the page.
 *
 * The product promise is that you can customize a shared cart and still be
 * told whether the deal still holds. That is only honest if the check is
 * deterministic and complete, so this module never guesses:
 *
 *   - A term it cannot verify from cart facts is "unknown", never "met".
 *   - A term the user must satisfy off-cart (clipping a coupon, holding a
 *     membership) is "needs_user_action" — the system cannot see either, and
 *     claiming otherwise would be the exact false confidence the engine
 *     elsewhere refuses.
 *   - allTermsMet is true only when every term is met. One unknown is enough
 *     to withhold it.
 *
 * All money is integer cents.
 */

export type CartLineFact = {
	displayName: string;
	quantity?: number;
	unitPriceCents?: number;
	lineTotalCents?: number;
	gtin?: string;
	merchantSku?: string;
	productKey?: string;
};

export type CartFacts = {
	merchantId: string;
	lines: CartLineFact[];
	subtotalCents?: number;
};

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function formatCentsLocal(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Matches a recipe item to a cart line.
 *
 * Identity beats text: a GTIN or SKU match is authoritative, so a renamed
 * listing still matches. Name matching is a deliberate fallback and is only
 * accepted when the recipe does not require an exact item — for a
 * "participating SKU" deal, a lookalike name is not good enough.
 */
function matchItem(item: RecipeItem, lines: CartLineFact[]): RecipeItemMatch {
	const byIdentity = lines.find(
		(line) =>
			(item.gtin && line.gtin === item.gtin) ||
			(item.merchantSku && line.merchantSku === item.merchantSku) ||
			(item.productKey && line.productKey === item.productKey),
	);

	const wanted = normalize(item.name);
	const byName = byIdentity
		? undefined
		: lines.find((line) => {
				const actual = normalize(line.displayName);
				return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
			});

	const matched = byIdentity ?? byName;

	if (!matched) {
		return {
			item,
			status: "missing",
			explanation: `"${item.name}" is not in the cart.`,
		};
	}

	// A name-only match cannot satisfy a term that depends on a specific item.
	if (!byIdentity && item.requiredExact) {
		return {
			item,
			matchedLineName: matched.displayName,
			matchedQuantity: matched.quantity,
			status: "substituted",
			explanation: `"${matched.displayName}" looks like "${item.name}", but this deal requires that exact item and the cart does not confirm it by product code. Verify it yourself before relying on the deal.`,
		};
	}

	const have = matched.quantity ?? 1;
	if (have < item.quantity) {
		return {
			item,
			matchedLineName: matched.displayName,
			matchedQuantity: have,
			status: "insufficient_quantity",
			explanation: `"${matched.displayName}" is in the cart ${have}×, but the recipe calls for ${item.quantity}×.`,
		};
	}

	return {
		item,
		matchedLineName: matched.displayName,
		matchedQuantity: have,
		status: "present",
		explanation: `"${matched.displayName}" is in the cart ${have}×.`,
	};
}

/**
 * Every identity form a cart line could be referred to by.
 *
 * A recipe stores canonical keys (`gtin:0012345600012`, matching
 * deriveProductIdentity), while a scanned line carries a bare GTIN or SKU.
 * Comparing the two forms directly silently counts zero qualifying items and
 * reports a deal as not met when it is.
 */
function identityCandidates(line: CartLineFact): string[] {
	const candidates: string[] = [];
	if (line.productKey) candidates.push(line.productKey);
	if (line.gtin) candidates.push(line.gtin, `gtin:${line.gtin}`);
	if (line.merchantSku) candidates.push(line.merchantSku, `sku:${line.merchantSku}`);
	return candidates;
}

/** Counts qualifying units in the cart for a buy_n_of term. */
function countQualifying(productKeys: string[], lines: CartLineFact[]): number {
	const keys = new Set(productKeys);
	return lines.reduce((total, line) => {
		const qualifies = identityCandidates(line).some((candidate) => keys.has(candidate));
		return qualifies ? total + (line.quantity ?? 1) : total;
	}, 0);
}

function evaluateTerm(term: DealTerm, cart: CartFacts, now: string): TermEvaluation {
	switch (term.kind) {
		case "min_spend": {
			if (cart.subtotalCents === undefined) {
				return {
					term,
					status: "unknown",
					explanation: `This deal needs a subtotal of at least ${formatCentsLocal(term.cents)}, but no subtotal was detected on the page.`,
				};
			}
			const met = cart.subtotalCents >= term.cents;
			const gap = term.cents - cart.subtotalCents;
			return {
				term,
				status: met ? "met" : "not_met",
				explanation: met
					? `Subtotal ${formatCentsLocal(cart.subtotalCents)} meets the ${formatCentsLocal(term.cents)} minimum.`
					: `Subtotal ${formatCentsLocal(cart.subtotalCents)} is ${formatCentsLocal(gap)} short of the ${formatCentsLocal(term.cents)} minimum.`,
			};
		}

		case "buy_n_of": {
			// Without product identities on the cart lines this cannot be
			// counted reliably, and guessing by name would silently mis-state
			// whether the deal qualifies.
			const identified = cart.lines.filter(
				(line) => identityCandidates(line).length > 0,
			).length;
			if (identified === 0) {
				return {
					term,
					status: "unknown",
					explanation: `This deal needs ${term.n} × ${term.label}, but no cart item could be identified by product code, so qualifying items cannot be counted.`,
				};
			}
			const have = countQualifying(term.productKeys, cart.lines);
			return {
				term,
				status: have >= term.n ? "met" : "not_met",
				explanation:
					have >= term.n
						? `${have} qualifying ${term.label} in the cart; ${term.n} required.`
						: `${have} qualifying ${term.label} in the cart; ${term.n} required (${term.n - have} more).`,
			};
		}

		case "requires_coupon_clip":
			// Coupon state lives in the user's merchant account, which is
			// private browser state this product does not read.
			return {
				term,
				status: "needs_user_action",
				explanation: `You need to clip "${term.label}" on the merchant's site yourself. This app cannot see or clip coupons.`,
			};

		case "member_only":
			return {
				term,
				status: "needs_user_action",
				explanation: `This deal requires ${term.programName}. This app cannot check your membership — confirm it yourself.`,
			};

		case "limit_per_customer": {
			const total = cart.lines.reduce((sum, line) => sum + (line.quantity ?? 1), 0);
			const over = total > term.n;
			return {
				term,
				status: over ? "not_met" : "met",
				explanation: over
					? `The merchant limits this to ${term.n} per customer, and the cart holds ${total} items. Ordering more than the limit may void the deal.`
					: `Within the merchant's limit of ${term.n} per customer.`,
			};
		}

		case "date_window": {
			const startsOk = !term.from || now >= term.from;
			const endsOk = !term.until || now <= term.until;
			if (startsOk && endsOk) {
				return {
					term,
					status: "met",
					explanation: term.until
						? `Within the deal's validity window (until ${term.until.slice(0, 10)}).`
						: "Within the deal's validity window.",
				};
			}
			return {
				term,
				status: "not_met",
				explanation: !startsOk
					? `This deal does not start until ${term.from?.slice(0, 10)}.`
					: `This deal expired on ${term.until?.slice(0, 10)}.`,
			};
		}

		case "manual_review":
			return {
				term,
				status: "needs_user_action",
				explanation: `Condition to check yourself: "${term.text}"`,
			};
	}
}

export function evaluateRecipe(
	recipe: DealRecipe,
	cart: CartFacts,
	now: string = new Date().toISOString(),
): RecipeEvaluation {
	const warnings: string[] = [];

	if (recipe.merchantId !== cart.merchantId) {
		warnings.push(
			`This recipe was written for ${recipe.merchantId}, but the cart is at ${cart.merchantId}. Prices and terms are unlikely to carry over.`,
		);
	}
	if (recipe.validUntil && now > recipe.validUntil) {
		warnings.push(`This recipe expired on ${recipe.validUntil.slice(0, 10)}.`);
	}
	if (recipe.source.kind === "parsed_from_text" && !recipe.source.reviewedByUser) {
		warnings.push(
			"This recipe was parsed from text and has not been reviewed yet. Check the items and conditions before relying on it.",
		);
	}

	const items = recipe.items.map((item) => matchItem(item, cart.lines));
	const terms = recipe.terms.map((term) => evaluateTerm(term, cart, now));

	const allTermsMet = terms.length > 0 && terms.every((entry) => entry.status === "met");
	const requiresUserAction = terms.filter((entry) => entry.status === "needs_user_action");

	const missing = items.filter((entry) => entry.status !== "present");
	const explanation: string[] = [];

	if (missing.length === 0) {
		explanation.push("Every item in this recipe is in the cart.");
	} else {
		explanation.push(
			`${items.length - missing.length} of ${items.length} recipe items are in the cart as specified.`,
		);
	}

	const notMet = terms.filter((entry) => entry.status === "not_met");
	const unknown = terms.filter((entry) => entry.status === "unknown");

	if (allTermsMet) {
		explanation.push("Every condition this app can check is currently met.");
	} else {
		if (notMet.length > 0) {
			explanation.push(`${notMet.length} condition(s) are not met.`);
		}
		if (unknown.length > 0) {
			explanation.push(
				`${unknown.length} condition(s) could not be checked from this page, so the deal is not confirmed.`,
			);
		}
		if (requiresUserAction.length > 0) {
			explanation.push(
				`${requiresUserAction.length} condition(s) need you to act or confirm — this app cannot verify them.`,
			);
		}
	}

	if (recipe.expectedSavingsCents !== undefined) {
		explanation.push(
			`The author reported saving ${formatCentsLocal(recipe.expectedSavingsCents)}. That is their claim about their own order, not a verified or guaranteed figure.`,
		);
	}

	return {
		recipeId: recipe.recipeId,
		items,
		terms,
		allTermsMet,
		requiresUserAction,
		warnings,
		explanation,
	};
}

/**
 * Describes what a swap does to the deal, for the "customize a little" flow.
 *
 * Reports only the difference in evaluated terms; it does not advise whether
 * the swap is worthwhile, which depends on preferences this module cannot see.
 */
export function compareRecipeEvaluations(
	before: RecipeEvaluation,
	after: RecipeEvaluation,
): { brokenTerms: TermEvaluation[]; fixedTerms: TermEvaluation[]; stillSafe: boolean } {
	const statusFor = (evaluation: RecipeEvaluation, index: number) => evaluation.terms[index]?.status;

	const brokenTerms: TermEvaluation[] = [];
	const fixedTerms: TermEvaluation[] = [];

	after.terms.forEach((term, index) => {
		const was = statusFor(before, index);
		if (was === "met" && term.status !== "met") brokenTerms.push(term);
		if (was !== "met" && term.status === "met") fixedTerms.push(term);
	});

	return { brokenTerms, fixedTerms, stillSafe: brokenTerms.length === 0 };
}
