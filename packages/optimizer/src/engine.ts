import type {
	CartSnapshot,
	ComparisonResult,
	CostBreakdown,
	Evaluation,
	PlannedItem,
	PurchasePlan,
	Recommendation,
	ScanConfidence,
	ShoppingItem,
	ShoppingPreferences,
	ThresholdOpportunity,
	VisibleOffer,
} from "../../domain/src";
import { POLICY_VERSION } from "../../domain/src";
import { evaluateRequiredItemCoverage, mapShoppingItems } from "./coverage";
import { addCents, formatCents } from "./money";

/** Totals within this tolerance are treated as matching (rounding noise). */
export const DISCREPANCY_TOLERANCE_CENTS = 100;
/** A flat-dollar filler suggestion must beat the gap by at least this margin. */
export const FILLER_SAFETY_MARGIN_CENTS = 50;
/** Fees at or above this share of the subtotal flag a fee-heavy cart. */
export const FEE_HEAVY_PERCENT = 15;
export const FEE_HEAVY_MINIMUM_CENTS = 300;

const FILLER_CATEGORY_LABEL: Record<
	ShoppingPreferences["thresholdFillerPolicy"],
	string | undefined
> = {
	household_essentials: "household essentials",
	pantry_staples: "pantry staples",
	none: undefined,
};

export function calculateObservedTotal(snapshot: CartSnapshot): number | undefined {
	if (snapshot.subtotal === undefined) return undefined;
	return addCents(
		snapshot.subtotal.cents,
		snapshot.deliveryFee?.cents,
		snapshot.serviceFee?.cents,
		snapshot.tax?.cents,
		snapshot.discounts ? -snapshot.discounts.cents : undefined,
		snapshot.visibleCredits ? -snapshot.visibleCredits.cents : undefined,
	);
}

export function buildCostBreakdown(snapshot: CartSnapshot): CostBreakdown {
	const calculated = calculateObservedTotal(snapshot);
	// Displayed final total is preferred when visibly detected; a derived total
	// is only a fallback computed from available parts.
	const basis =
		snapshot.displayedFinalTotal !== undefined
			? "displayed_total"
			: calculated !== undefined
				? "calculated_total"
				: "unknown";
	return {
		subtotalCents: snapshot.subtotal?.cents,
		discountsCents: snapshot.discounts?.cents,
		deliveryFeeCents: snapshot.deliveryFee?.cents,
		serviceFeeCents: snapshot.serviceFee?.cents,
		taxCents: snapshot.tax?.cents,
		visibleCreditsCents: snapshot.visibleCredits?.cents,
		displayedFinalTotalCents: snapshot.displayedFinalTotal?.cents,
		calculatedTotalCents: calculated,
		basis,
	};
}

export function authoritativeTotalCents(snapshot: CartSnapshot): number | undefined {
	return snapshot.displayedFinalTotal?.cents ?? calculateObservedTotal(snapshot);
}

export function detectTotalDiscrepancy(snapshot: CartSnapshot): Recommendation | null {
	const displayed = snapshot.displayedFinalTotal?.cents;
	const calculated = calculateObservedTotal(snapshot);
	if (displayed === undefined || calculated === undefined) return null;
	const difference = displayed - calculated;
	if (Math.abs(difference) <= DISCREPANCY_TOLERANCE_CENTS) return null;
	return {
		kind: "total_discrepancy",
		headline: "The displayed total doesn't match what the visible line items add up to.",
		evidence: [
			`Displayed final total: ${formatCents(displayed)}.`,
			`Calculated from visible subtotal, fees, tax, discounts, and credits: ${formatCents(calculated)}.`,
		],
		assumptions: ["All cost components that affect the total were visible and captured."],
		arithmetic: [
			`${formatCents(displayed)} (displayed) − ${formatCents(calculated)} (calculated) = ${formatCents(difference)}.`,
		],
		warnings: [
			"A fee, discount, or credit may not have been visible or captured. Review the checkout screen directly before relying on either number.",
		],
		nextSafeUserAction: "Re-scan the cart, or review the merchant's own totals before deciding.",
		estimatedImpactCents: Math.abs(difference),
		confidence: "low",
	};
}

export function detectFeeHeavyCart(snapshot: CartSnapshot): Recommendation | null {
	const subtotal = snapshot.subtotal?.cents;
	if (subtotal === undefined || subtotal <= 0) return null;
	const fees = addCents(snapshot.deliveryFee?.cents, snapshot.serviceFee?.cents);
	// Integer comparison: fees/subtotal >= FEE_HEAVY_PERCENT/100.
	if (fees < FEE_HEAVY_MINIMUM_CENTS || fees * 100 < subtotal * FEE_HEAVY_PERCENT) return null;
	return {
		kind: "fee_heavy_cart",
		headline: `Visible fees are ${formatCents(fees)} on a ${formatCents(subtotal)} subtotal.`,
		evidence: [
			snapshot.deliveryFee ? `Delivery fee: ${formatCents(snapshot.deliveryFee.cents)}.` : "",
			snapshot.serviceFee ? `Service fee: ${formatCents(snapshot.serviceFee.cents)}.` : "",
		].filter(Boolean),
		assumptions: ["Only fees visible on this page are counted."],
		arithmetic: [
			`${formatCents(fees)} in fees ÷ ${formatCents(subtotal)} subtotal ≥ ${FEE_HEAVY_PERCENT}%.`,
		],
		warnings: [],
		nextSafeUserAction:
			"Consider whether a different fulfillment option or consolidated order reduces fees. No cross-merchant pricing is known to this tool.",
		confidence: snapshot.confidence,
	};
}

export function evaluateThresholdOpportunity(
	snapshot: CartSnapshot,
	preferences: ShoppingPreferences,
	shoppingItems: ShoppingItem[] = [],
): ThresholdOpportunity | null {
	const offer = snapshot.visibleOffers.find(
		(candidate) =>
			candidate.offerType === "threshold_discount" &&
			candidate.status !== "appears_applied" &&
			candidate.minimumSpendCents !== undefined,
	);
	if (!offer || offer.minimumSpendCents === undefined) return null;

	const baseline = snapshot.subtotal?.cents ?? calculateObservedTotal(snapshot);
	if (baseline === undefined) return null;

	const gapCents = offer.minimumSpendCents - baseline;
	if (gapCents <= 0) return null;

	const explanation: string[] = [
		`Current visible subtotal is ${formatCents(baseline)}.`,
		`A visible "${offer.title}" offer may be relevant, but it does not appear applied.`,
		`You are ${formatCents(gapCents)} below the stated threshold of ${formatCents(offer.minimumSpendCents)}.`,
	];

	// Only a flat-dollar discount has a known, fixed benefit. A percent discount's
	// dollar value depends on the final subtotal and any unseen cap, so it never
	// justifies recommending an addition on its own.
	const isFlatDollar = offer.discountCents !== undefined && offer.discountPercent === undefined;
	const fillerCategory = FILLER_CATEGORY_LABEL[preferences.thresholdFillerPolicy];
	const conservativeBenefitClearsGap =
		isFlatDollar &&
		offer.discountCents !== undefined &&
		offer.discountCents >= gapCents + FILLER_SAFETY_MARGIN_CENTS;

	// An exact, pre-approved shopping-list item may fill the gap: it must be
	// active, purchasable-urgency, not already in the cart, within the user's
	// own per-item price limit, within the single-add ceiling, and its price
	// ceiling must be able to cover the gap.
	const inCartIds = new Set(
		mapShoppingItems(shoppingItems, snapshot.items)
			.filter((planned) => planned.status === "in_cart" || planned.status === "needs_review")
			.map((planned) => planned.shoppingItemId),
	);
	const exactCandidate = shoppingItems.find(
		(item) =>
			item.active &&
			item.urgency !== "watch_only" &&
			!inCartIds.has(item.id) &&
			item.maxUnitPriceCents !== undefined &&
			item.maxUnitPriceCents >= gapCents &&
			item.maxUnitPriceCents <= preferences.maxSingleAddCents,
	);

	if (exactCandidate) {
		explanation.push(
			`Your shopping list already includes "${exactCandidate.name}" (price limit ${formatCents(exactCandidate.maxUnitPriceCents ?? 0)}), which could close the gap with an item you intended to buy anyway.`,
		);
	} else if (conservativeBenefitClearsGap && fillerCategory) {
		explanation.push(
			`The stated discount (${formatCents(offer.discountCents ?? 0)}) exceeds the gap by at least ${formatCents(FILLER_SAFETY_MARGIN_CENTS)}, so adding ~${formatCents(gapCents)} of ${fillerCategory} could come out ahead — if the offer's terms actually apply.`,
		);
	} else {
		explanation.push(
			"Because the visible discount cap and eligibility are uncertain, review the offer terms before adding anything.",
		);
	}

	return {
		offerTitle: offer.title,
		minimumSpendCents: offer.minimumSpendCents,
		gapCents,
		discountCents: offer.discountCents,
		discountPercent: offer.discountPercent,
		maximumDiscountCents: offer.maximumDiscountCents,
		fillerRecommended: Boolean(exactCandidate) || (conservativeBenefitClearsGap && !!fillerCategory),
		suggestedFillerCategory: exactCandidate ? undefined : fillerCategory,
		exactItemCandidateId: exactCandidate?.id,
		explanation,
		confidence: exactCandidate || conservativeBenefitClearsGap ? offer.confidence : "low",
	};
}

export function compareCartSnapshots(
	current: CartSnapshot,
	priorSnapshots: CartSnapshot[],
): ComparisonResult | null {
	const currentTotal = authoritativeTotalCents(current);
	if (currentTotal === undefined) return null;

	const comparable = priorSnapshots
		.filter((prior) => prior.id !== current.id && authoritativeTotalCents(prior) !== undefined)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
	if (!comparable) return null;

	const comparedTotal = authoritativeTotalCents(comparable);
	if (comparedTotal === undefined) return null;

	const differenceCents = comparedTotal - currentTotal;
	const basis = current.displayedFinalTotal !== undefined ? "displayed_total" : "calculated_total";
	const direction =
		differenceCents > 0 ? "lower than" : differenceCents < 0 ? "higher than" : "equal to";

	return {
		comparedSnapshotId: comparable.id,
		comparedSnapshotCreatedAt: comparable.createdAt,
		comparedTotalCents: comparedTotal,
		currentTotalCents: currentTotal,
		differenceCents,
		basis,
		explanation: [
			`Current ${basis === "displayed_total" ? "displayed" : "estimated"} total: ${formatCents(currentTotal)}.`,
			`Saved comparison from ${comparable.createdAt}: ${formatCents(comparedTotal)}.`,
			`This cart is ${formatCents(Math.abs(differenceCents))} ${direction} the saved comparison.`,
		],
	};
}

export function evaluateCartSnapshot(
	snapshot: CartSnapshot,
	preferences: ShoppingPreferences,
): Evaluation {
	const recommendations: Recommendation[] = [];
	const warnings: string[] = [];

	const discrepancy = detectTotalDiscrepancy(snapshot);
	if (discrepancy) {
		recommendations.push(discrepancy);
		warnings.push(...discrepancy.warnings);
	}
	const feeHeavy = detectFeeHeavyCart(snapshot);
	if (feeHeavy) recommendations.push(feeHeavy);

	if (snapshot.confidence === "low") {
		recommendations.push({
			kind: "review_required",
			headline: "This page's details weren't clear enough to evaluate confidently.",
			evidence: snapshot.extractionNotes,
			assumptions: [],
			arithmetic: [],
			warnings: ["Review the cart directly before making a decision."],
			nextSafeUserAction: "Re-scan the page or review the cart manually.",
			confidence: "low",
		});
		warnings.push("Extraction confidence is low.");
	}

	const opportunity = evaluateThresholdOpportunity(snapshot, preferences);
	if (opportunity) {
		recommendations.push(thresholdRecommendation(opportunity));
	}

	return {
		observedCost: buildCostBreakdown(snapshot),
		visibleOffers: snapshot.visibleOffers,
		recommendations,
		warnings,
		confidence: snapshot.confidence,
	};
}

function thresholdRecommendation(opportunity: ThresholdOpportunity): Recommendation {
	const kind = opportunity.fillerRecommended ? "threshold_filler_category" : "threshold_gap";
	// Three distinct headlines, because the certainty behind each differs:
	// a flat-dollar benefit is arithmetic; an item already on the user's list
	// is a convenience observation, NOT a claim the discount is worth it; and
	// everything else is an explicit "review".
	const headline = !opportunity.fillerRecommended
		? `You're ${formatCents(opportunity.gapCents)} from a stated threshold — review before adding anything.`
		: opportunity.exactItemCandidateId
			? `You're ${formatCents(opportunity.gapCents)} from a stated threshold, and an item already on your list would close it.`
			: `You're ${formatCents(opportunity.gapCents)} from a stated threshold, and the stated discount exceeds the gap.`;
	return {
		kind,
		headline,
		evidence: [
			`Visible offer: "${opportunity.offerTitle}".`,
			`Stated minimum spend: ${formatCents(opportunity.minimumSpendCents)}.`,
		],
		assumptions: ["Visible offer text is a claim by the page, not verified eligibility."],
		arithmetic: opportunity.explanation.filter((line) => /\$/.test(line)),
		warnings: opportunity.exactItemCandidateId
			? [
					"This does not establish that the discount is worth it — only that an item you already wanted would reach the threshold. Confirm the offer's terms on the merchant's page.",
				]
			: opportunity.fillerRecommended
				? ["Confirm the offer's eligibility and terms on the merchant's page before adding anything."]
				: ["The exact discount amount is not guaranteed from visible details alone."],
		nextSafeUserAction: opportunity.exactItemCandidateId
			? "Review the proposed addition from your own shopping list, then approve or decline it."
			: opportunity.suggestedFillerCategory
				? `If the terms check out, consider ~${formatCents(opportunity.gapCents)} of ${opportunity.suggestedFillerCategory} you already need.`
				: "Review the offer terms on the merchant's page.",
		estimatedImpactCents: opportunity.discountCents,
		confidence: opportunity.confidence,
	};
}

export type CreatePlanArgs = {
	snapshot: CartSnapshot;
	preferences: ShoppingPreferences;
	shoppingItems: ShoppingItem[];
	priorSnapshots: CartSnapshot[];
	policyVersion?: string;
	configPackVersion?: string;
	now?: () => string;
	generateId?: () => string;
};

export function createPurchasePlan(args: CreatePlanArgs): PurchasePlan {
	const {
		snapshot,
		preferences,
		shoppingItems,
		priorSnapshots,
		policyVersion = POLICY_VERSION,
		configPackVersion,
		now = () => new Date().toISOString(),
		generateId = () => globalThis.crypto.randomUUID(),
	} = args;

	const timestamp = now();
	const observedCost = buildCostBreakdown(snapshot);
	const plannedItems = mapShoppingItems(shoppingItems, snapshot.items);
	const requiredItems = plannedItems.filter((item) => item.required);
	const optionalItems = plannedItems.filter((item) => !item.required);
	const coverage = evaluateRequiredItemCoverage(shoppingItems, snapshot.items);
	const comparison = compareCartSnapshots(snapshot, priorSnapshots) ?? undefined;
	const opportunity =
		evaluateThresholdOpportunity(snapshot, preferences, shoppingItems) ?? undefined;

	const recommendations: Recommendation[] = [];
	const warnings: string[] = [];
	const assumptions: string[] = [
		"Only facts visible on the scanned page were used; nothing was fetched from the merchant.",
		observedCost.basis === "displayed_total"
			? "The page's displayed final total is treated as authoritative."
			: observedCost.basis === "calculated_total"
				? "No displayed total was detected; the total is estimated from visible parts only."
				: "Neither a displayed nor a computable total was detected.",
	];

	const discrepancy = detectTotalDiscrepancy(snapshot);
	if (discrepancy) {
		recommendations.push(discrepancy);
		warnings.push("Displayed and calculated totals disagree materially.");
	}

	if (snapshot.confidence === "low") {
		recommendations.push({
			kind: "review_required",
			headline: "Extraction confidence is low — review required.",
			evidence: snapshot.extractionNotes,
			assumptions: [],
			arithmetic: [],
			warnings: ["Numbers on this plan may be incomplete."],
			nextSafeUserAction: "Re-scan the cart or review it manually before acting.",
			confidence: "low",
		});
		warnings.push("Extraction confidence is low.");
	}

	for (const missing of coverage.missingRequired) {
		recommendations.push({
			kind: "required_item_missing",
			headline: `Required item "${missing.displayName}" is not in this cart.`,
			evidence: [`No visible cart line matched "${missing.displayName}".`],
			assumptions: ["Cart line extraction captured every visible line."],
			arithmetic: [],
			warnings: snapshot.items.length === 0 ? ["No cart lines were extracted, so this is absence of evidence."] : [],
			nextSafeUserAction: "Approve a search for the exact item, or add it manually.",
			confidence: snapshot.items.length === 0 ? "low" : snapshot.confidence,
		});
	}
	for (const unavailable of coverage.unavailableRequired) {
		recommendations.push({
			kind: "required_item_unavailable",
			headline: `Required item "${unavailable.displayName}" appears unavailable.`,
			evidence: unavailable.notes,
			assumptions: [],
			arithmetic: [],
			warnings: ["Availability text is the page's claim at scan time."],
			nextSafeUserAction:
				unavailable.notes.length > 0
					? "Decide on a substitution within your tolerance, or wait."
					: "Review the item on the merchant page.",
			confidence: snapshot.confidence,
		});
	}

	const policyConflicts = plannedItems.filter(
		(item) => item.status === "needs_review" && item.notes.some((n) => /limit|brand/i.test(n)),
	);
	for (const conflict of policyConflicts) {
		recommendations.push({
			kind: "policy_conflict",
			headline: `"${conflict.displayName}" conflicts with your stated preferences.`,
			evidence: conflict.notes,
			assumptions: [],
			arithmetic: [],
			warnings: [],
			nextSafeUserAction: "Review the matched cart line and adjust the cart or your preferences.",
			confidence: snapshot.confidence,
		});
		warnings.push(`Preference conflict on "${conflict.displayName}".`);
	}

	if (opportunity) recommendations.push(thresholdRecommendation(opportunity));

	const feeHeavy = detectFeeHeavyCart(snapshot);
	if (feeHeavy) recommendations.push(feeHeavy);

	if (comparison && Math.abs(comparison.differenceCents) > DISCREPANCY_TOLERANCE_CENTS) {
		const cheaper = comparison.differenceCents > 0;
		recommendations.push({
			kind: cheaper ? "lower_observed_total" : "review_required",
			headline: cheaper
				? `This cart is ${formatCents(comparison.differenceCents)} lower than your saved comparison.`
				: `This cart is ${formatCents(Math.abs(comparison.differenceCents))} higher than your saved comparison.`,
			evidence: comparison.explanation,
			assumptions: ["Both snapshots reflect the carts as visibly displayed at their scan times."],
			arithmetic: [
				`${formatCents(comparison.comparedTotalCents)} − ${formatCents(comparison.currentTotalCents)} = ${formatCents(comparison.differenceCents)}.`,
			],
			warnings: ["Review the merchant's checkout screen before purchasing."],
			nextSafeUserAction: cheaper
				? "Review the checkout screen before purchasing."
				: "Compare both carts before deciding where to purchase.",
			estimatedImpactCents: cheaper ? comparison.differenceCents : undefined,
			confidence: snapshot.confidence,
		});
	}

	if (recommendations.length === 0) {
		recommendations.push({
			kind: "no_action",
			headline: "This cart's visible details look consistent.",
			evidence: [
				observedCost.displayedFinalTotalCents !== undefined
					? `Displayed total: ${formatCents(observedCost.displayedFinalTotalCents)}.`
					: observedCost.calculatedTotalCents !== undefined
						? `Estimated total: ${formatCents(observedCost.calculatedTotalCents)}.`
						: "No total detected.",
			],
			assumptions: [],
			arithmetic: [],
			warnings: [],
			nextSafeUserAction: "Nothing further from this tool; review the checkout screen when ready.",
			confidence: snapshot.confidence,
		});
	}

	const needsReview =
		discrepancy !== null ||
		snapshot.confidence === "low" ||
		coverage.unavailableRequired.length > 0;

	return {
		id: generateId(),
		createdAt: timestamp,
		updatedAt: timestamp,
		status: needsReview ? "needs_review" : "draft",
		sourceSnapshotId: snapshot.id,
		optimizationGoal: preferences.optimizationGoal,
		requiredItems,
		optionalItems,
		observedCost,
		thresholdOpportunity: opportunity,
		comparison,
		recommendations,
		proposedActions: [],
		assumptions,
		warnings,
		confidence: snapshot.confidence,
		policyVersion,
		adapterVersion: snapshot.adapterVersion,
		configPackVersion,
	};
}

/** Re-exports so the whole engine is importable from one module. */
export { evaluateRequiredItemCoverage, mapShoppingItems } from "./coverage";
export type { VisibleOffer };
export type { ScanConfidence };
export type { PlannedItem };
