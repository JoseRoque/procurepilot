import { addCents, formatCents } from "./money";
import type {
	CartRecommendation,
	CartSnapshot,
	ShoppingPreferences,
	VisibleOffer,
} from "./types";

export { normalizeMoney } from "./money";
export { parseVisibleOffer } from "./offers";

/** Amounts within this tolerance are treated as "matching" (rounding noise). */
const DISCREPANCY_TOLERANCE_CENTS = 100;

/** A flat-dollar threshold filler suggestion must clear the gap by this much. */
const FILLER_SAFETY_MARGIN_CENTS = 50;

const FILLER_CATEGORY_LABEL: Record<ShoppingPreferences["thresholdFillerPolicy"], string | undefined> = {
	household_essentials: "household essentials",
	pantry_staples: "pantry staples",
	none: undefined,
};

/**
 * Sums the visible line items into a single total, using only what was
 * actually captured. Returns undefined when there's nothing to compute from
 * (no subtotal captured at all) rather than pretending a $0 total.
 */
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

function findUnappliedThresholdOffer(offers: VisibleOffer[]): VisibleOffer | undefined {
	return offers.find(
		(offer) =>
			offer.offerType === "threshold_discount" &&
			offer.status !== "appears_applied" &&
			offer.minimumSpendCents !== undefined,
	);
}

/**
 * Looks for a visible "spend $X more to unlock a discount" opportunity and
 * decides whether it's safe to suggest closing the gap.
 *
 * Percent-based discounts are never turned into an "add a filler" suggestion
 * — the eventual dollar benefit depends on the final subtotal and any unseen
 * cap, so recommending review is the honest answer. Flat-dollar discounts
 * have a known, fixed benefit, so they can clear the bar when the benefit
 * comfortably exceeds the gap.
 */
export function evaluateThresholdOpportunity(
	snapshot: CartSnapshot,
	preferences: ShoppingPreferences,
): CartRecommendation | undefined {
	const offer = findUnappliedThresholdOffer(snapshot.visibleOffers);
	if (!offer || offer.minimumSpendCents === undefined) return undefined;

	const baselineCents = snapshot.subtotal?.cents ?? calculateObservedTotal(snapshot);
	if (baselineCents === undefined) return undefined;

	const gapCents = offer.minimumSpendCents - baselineCents;
	if (gapCents <= 0) return undefined; // threshold already met; nothing to flag here

	const generatedAt = new Date().toISOString();
	const rationale = [
		`Current visible subtotal is ${formatCents(baselineCents)}.`,
		`A visible "${offer.title}" offer may be relevant, but it does not appear applied.`,
		`You are ${formatCents(gapCents)} below the stated threshold of ${formatCents(offer.minimumSpendCents)}.`,
	];

	const isFlatDollarOffer =
		offer.discountCents !== undefined && offer.discountPercent === undefined;

	if (
		isFlatDollarOffer &&
		offer.discountCents !== undefined &&
		preferences.thresholdFillerPolicy !== "none" &&
		offer.discountCents >= gapCents + FILLER_SAFETY_MARGIN_CENTS
	) {
		const fillerCategory = FILLER_CATEGORY_LABEL[preferences.thresholdFillerPolicy];
		rationale.push(
			`The visible discount (${formatCents(offer.discountCents)}) comfortably exceeds the gap, even after accounting for the added item's own cost.`,
		);
		return {
			snapshotId: snapshot.id,
			generatedAt,
			action: "add_threshold_filler",
			headline: `Adding ~${formatCents(gapCents)} of ${fillerCategory} could unlock ${formatCents(offer.discountCents)} off.`,
			rationale,
			estimatedSavingsCents: offer.discountCents,
			thresholdGapCents: gapCents,
			suggestedFillerCategory: fillerCategory,
			warnings: [
				"Confirm the offer's eligibility and terms on the merchant's page before adding anything.",
			],
			confidence: offer.confidence,
		};
	}

	rationale.push(
		"Because the visible discount cap and eligibility are uncertain, review the offer terms before adding anything.",
	);
	return {
		snapshotId: snapshot.id,
		generatedAt,
		action: "review_before_checkout",
		headline: `You're ${formatCents(gapCents)} away from a visible threshold offer — review before adding items.`,
		rationale,
		thresholdGapCents: gapCents,
		suggestedFillerCategory:
			preferences.thresholdFillerPolicy !== "none"
				? FILLER_CATEGORY_LABEL[preferences.thresholdFillerPolicy]
				: undefined,
		warnings: [
			"The exact discount amount is not guaranteed from visible details alone.",
		],
		confidence: "low",
	};
}

function findMostRecentComparableSnapshot(
	priorSnapshots: CartSnapshot[],
): CartSnapshot | undefined {
	return [...priorSnapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function snapshotComparisonTotal(snapshot: CartSnapshot): number | undefined {
	return snapshot.displayedFinalTotal?.cents ?? calculateObservedTotal(snapshot);
}

/**
 * The single entry point the side panel/background call after a scan. Runs a
 * fixed priority of checks — data-quality problems always take precedence
 * over optimization suggestions.
 */
export function createCartRecommendation(
	snapshot: CartSnapshot,
	preferences: ShoppingPreferences,
	priorSnapshots: CartSnapshot[],
): CartRecommendation {
	const generatedAt = new Date().toISOString();
	const observedTotal = calculateObservedTotal(snapshot);
	const warnings: string[] = [];

	// 1. Discrepancy between displayed total and what we can compute.
	if (
		snapshot.displayedFinalTotal !== undefined &&
		observedTotal !== undefined &&
		Math.abs(snapshot.displayedFinalTotal.cents - observedTotal) > DISCREPANCY_TOLERANCE_CENTS
	) {
		return {
			snapshotId: snapshot.id,
			generatedAt,
			action: "review_before_checkout",
			headline: "The displayed total doesn't match what we can calculate from visible line items.",
			rationale: [
				`Displayed final total: ${formatCents(snapshot.displayedFinalTotal.cents)}.`,
				`Calculated from visible subtotal, fees, tax, discounts, and credits: ${formatCents(observedTotal)}.`,
				"This gap may mean a fee, discount, or credit wasn't visible or wasn't captured correctly.",
			],
			warnings: [
				"Review the checkout screen directly before purchasing — this scan's numbers may be incomplete.",
			],
			confidence: "low",
		};
	}

	// 2. Low-confidence extraction — don't assert an answer.
	if (snapshot.confidence === "low") {
		return {
			snapshotId: snapshot.id,
			generatedAt,
			action: "wait_for_more_information",
			headline: "This page's details weren't clear enough to extract confidently.",
			rationale: [
				"Some amounts on this page could not be read with confidence.",
				...snapshot.extractionNotes,
			],
			warnings: ["Review the cart directly before making a decision."],
			confidence: "low",
		};
	}

	// 3. A visible, not-yet-met spending threshold.
	const thresholdRecommendation = evaluateThresholdOpportunity(snapshot, preferences);
	if (thresholdRecommendation) return thresholdRecommendation;

	// 4. Compare with the most recent saved local scan.
	const comparison = findMostRecentComparableSnapshot(priorSnapshots);
	const comparisonTotal = comparison ? snapshotComparisonTotal(comparison) : undefined;
	const currentTotal = snapshot.displayedFinalTotal?.cents ?? observedTotal;

	if (comparison && comparisonTotal !== undefined && currentTotal !== undefined) {
		const differenceCents = comparisonTotal - currentTotal;
		if (differenceCents > DISCREPANCY_TOLERANCE_CENTS) {
			const totalDescription = snapshot.displayedFinalTotal
				? `a final total of ${formatCents(currentTotal)}`
				: `an estimated total of ${formatCents(currentTotal)}`;
			return {
				snapshotId: snapshot.id,
				generatedAt,
				action: "no_action",
				headline: `This cart is ${formatCents(differenceCents)} lower than your last saved comparison.`,
				rationale: [
					`The cart displays ${totalDescription}.`,
					`This is ${formatCents(differenceCents)} lower than your saved comparison cart from ${new Date(comparison.createdAt).toLocaleDateString()}.`,
				],
				estimatedSavingsCents: differenceCents,
				warnings: ["Review the merchant's checkout screen before purchasing."],
				confidence: snapshot.confidence,
			};
		}
		if (differenceCents < -DISCREPANCY_TOLERANCE_CENTS) {
			return {
				snapshotId: snapshot.id,
				generatedAt,
				action: "compare_saved_carts",
				headline: `This cart is ${formatCents(Math.abs(differenceCents))} higher than a saved comparison.`,
				rationale: [
					`Your saved comparison cart from ${new Date(comparison.createdAt).toLocaleDateString()} totaled ${formatCents(comparisonTotal)}.`,
					`This cart is currently ${formatCents(Math.abs(differenceCents))} more.`,
				],
				warnings: ["Review both carts before deciding where to purchase."],
				confidence: snapshot.confidence,
			};
		}
	}

	// 5. Nothing more to say. Everything reconciled and there's no comparison
	// or opportunity to flag, so there's genuinely no action to recommend.
	const summaryTotal = currentTotal !== undefined ? formatCents(currentTotal) : "not available";
	return {
		snapshotId: snapshot.id,
		generatedAt,
		action: "no_action",
		headline: "This cart's visible details look consistent.",
		rationale: [`Current total: ${summaryTotal}.`, "No additional visible offers or comparisons changed this recommendation."],
		warnings,
		confidence: snapshot.confidence,
	};
}
