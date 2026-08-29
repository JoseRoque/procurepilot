import type {
	DealRecipe,
	DealTerm,
	RecipeApplicability,
	RecipeEvaluation,
	RecipeItem,
	RecipeItemMatch,
	TermEvaluation,
	UserDealContext,
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

/* ------------------------------------------------------------------ *
 * Applicability pre-screen
 * ------------------------------------------------------------------ */

const MS_PER_DAY = 86_400_000;

/**
 * Answers "is this deal even for me?" before any cart exists.
 *
 * Written because the common complaint is discovering a deal does not apply
 * *after* assembling the cart — at checkout, having done all the work. Almost
 * everything that disqualifies a person is knowable up front.
 *
 * The distinction that matters is between conditions that are **impossible**
 * and conditions that are merely **unmet so far**. A spend floor is not a
 * blocker — it is the shape of the work. An expired deal or a membership the
 * user has said they do not hold is a blocker, and nothing about the cart can
 * change that. Collapsing the two would either hide usable deals or waste the
 * user's time on unusable ones.
 *
 * Unknown membership is never assumed in either direction: it returns
 * needs_info so the user is asked, rather than being shown a deal that will
 * fail or having a usable one hidden.
 */
export function assessApplicability(
	recipe: DealRecipe,
	context: UserDealContext,
	now: string = new Date().toISOString(),
): RecipeApplicability {
	const blockers: TermEvaluation[] = [];
	const requiresConfirmation: TermEvaluation[] = [];
	const requirements: TermEvaluation[] = [];
	const explanation: string[] = [];

	const held = new Set(context.memberships.map((name) => name.toLowerCase()));
	const notHeld = new Set((context.excludedMemberships ?? []).map((name) => name.toLowerCase()));

	for (const term of recipe.terms) {
		switch (term.kind) {
			case "date_window": {
				if (term.until && now > term.until) {
					blockers.push({
						term,
						status: "not_met",
						explanation: `This deal expired on ${term.until.slice(0, 10)}.`,
					});
				} else if (term.from && now < term.from) {
					requiresConfirmation.push({
						term,
						status: "not_met",
						explanation: `This deal does not start until ${term.from.slice(0, 10)}.`,
					});
				}
				break;
			}

			case "member_only": {
				const program = term.programName.toLowerCase();
				if (notHeld.has(program)) {
					blockers.push({
						term,
						status: "not_met",
						explanation: `This deal requires ${term.programName}, which you have said you do not have.`,
					});
				} else if (held.has(program)) {
					requirements.push({
						term,
						status: "met",
						explanation: `Requires ${term.programName}, which you have said you hold.`,
					});
				} else {
					requiresConfirmation.push({
						term,
						status: "unknown",
						explanation: `This deal requires ${term.programName}. Confirm whether you have it — this app cannot check.`,
					});
				}
				break;
			}

			case "min_spend": {
				const overBudget =
					context.maxSpendCents !== undefined && term.cents > context.maxSpendCents;
				requirements.push({
					term,
					status: "not_met",
					explanation: overBudget
						? `Needs a subtotal of ${formatCentsLocal(term.cents)}, which is above the ${formatCentsLocal(context.maxSpendCents!)} limit you set.`
						: `Needs a subtotal of at least ${formatCentsLocal(term.cents)}.`,
				});
				break;
			}

			case "buy_n_of":
				requirements.push({
					term,
					status: "not_met",
					explanation: `Needs ${term.n} × ${term.label}.`,
				});
				break;

			case "requires_coupon_clip":
				requiresConfirmation.push({
					term,
					status: "needs_user_action",
					explanation: `You will need to clip "${term.label}" on the merchant's site yourself.`,
				});
				break;

			case "limit_per_customer":
				requirements.push({
					term,
					status: "met",
					explanation: `The merchant limits this to ${term.n} per customer.`,
				});
				break;

			case "manual_review":
				requiresConfirmation.push({
					term,
					status: "needs_user_action",
					explanation: `Check this yourself: "${term.text}"`,
				});
				break;
		}
	}

	// Recipe-level expiry is a blocker on the same footing as an expired term.
	if (recipe.validUntil && now > recipe.validUntil) {
		blockers.push({
			term: { kind: "date_window", until: recipe.validUntil },
			status: "not_met",
			explanation: `This recipe expired on ${recipe.validUntil.slice(0, 10)}.`,
		});
	}

	let expiresInDays: number | undefined;
	const deadline =
		recipe.validUntil ??
		recipe.terms.find((term): term is Extract<DealTerm, { kind: "date_window" }> =>
			term.kind === "date_window" && Boolean(term.until),
		)?.until;
	if (deadline && now <= deadline) {
		expiresInDays = Math.floor((Date.parse(deadline) - Date.parse(now)) / MS_PER_DAY);
	}

	const verdict: RecipeApplicability["verdict"] =
		blockers.length > 0
			? "not_applicable"
			: requiresConfirmation.length > 0
				? "needs_info"
				: "likely_applicable";

	if (verdict === "not_applicable") {
		explanation.push("This deal cannot work for you as things stand.");
		for (const blocker of blockers) explanation.push(blocker.explanation);
	} else if (verdict === "needs_info") {
		explanation.push(
			`Nothing rules this out, but ${requiresConfirmation.length} thing(s) need you to confirm or act.`,
		);
	} else {
		explanation.push("Nothing known rules this out. What remains is building the cart.");
	}

	if (requirements.length > 0 && verdict !== "not_applicable") {
		explanation.push(`To qualify: ${requirements.map((entry) => entry.explanation).join(" ")}`);
	}
	if (expiresInDays !== undefined && expiresInDays <= 3) {
		explanation.push(
			expiresInDays === 0
				? "This is the last day of the deal."
				: `Only ${expiresInDays} day(s) left on this deal.`,
		);
	}

	return {
		recipeId: recipe.recipeId,
		verdict,
		blockers,
		requiresConfirmation,
		requirements,
		expiresInDays,
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
