/**
 * Delivery-order intelligence.
 *
 * Delivery data differs from grocery data in a way that changes the whole
 * analysis: the interesting money is not in the item price, it is in the
 * spread between the basket subtotal and what actually left your account.
 * Fees, not menu prices, are where the recoverable cost sits.
 *
 * Two rules shape everything here:
 *
 *   1. A restaurant item has no GTIN and no cross-merchant equivalent. A
 *      burrito at one restaurant is not comparable to a burrito at another,
 *      so item identity stays merchant-scoped and is never authoritative.
 *
 *   2. Platform and merchant are different axes. The same restaurant on two
 *      platforms is the one genuinely comparable pair in this data, and it is
 *      the comparison worth making.
 *
 * All arithmetic is integer cents.
 */

export type DeliveryPlatform = string;

export type DeliveryOrder = {
	orderedAt: string;
	/** The delivery platform: doordash, ubereats, direct, … */
	platformId: DeliveryPlatform;
	/** The restaurant or store fulfilling the order. */
	merchantId: string;
	subtotalCents: number;
	deliveryFeeCents?: number;
	serviceFeeCents?: number;
	smallOrderFeeCents?: number;
	taxCents?: number;
	tipCents?: number;
	totalCents?: number;
	membershipActive?: boolean;
};

/** Fees charged by the platform. Excludes tax (not the platform's) and tip (yours). */
export function platformFeesCents(order: DeliveryOrder): number {
	return (
		(order.deliveryFeeCents ?? 0) +
		(order.serviceFeeCents ?? 0) +
		(order.smallOrderFeeCents ?? 0)
	);
}

export type CostSummary = {
	orderCount: number;
	subtotalCents: number;
	platformFeesCents: number;
	taxCents: number;
	tipCents: number;
	/** Fees as a percentage of subtotal, rounded to one decimal. */
	feeRatePercent: number | undefined;
	explanation: string[];
};

function pctOf(part: number, whole: number): number | undefined {
	if (whole <= 0) return undefined;
	return Math.round((part * 1000) / whole) / 10;
}

export function summarizeDeliveryCost(orders: DeliveryOrder[]): CostSummary {
	const subtotal = orders.reduce((sum, order) => sum + order.subtotalCents, 0);
	const fees = orders.reduce((sum, order) => sum + platformFeesCents(order), 0);
	const tax = orders.reduce((sum, order) => sum + (order.taxCents ?? 0), 0);
	const tip = orders.reduce((sum, order) => sum + (order.tipCents ?? 0), 0);
	const feeRate = pctOf(fees, subtotal);

	const explanation: string[] = [];
	if (orders.length === 0) {
		explanation.push("No delivery orders recorded.");
	} else {
		explanation.push(
			`${orders.length} orders, ${formatCentsLocal(subtotal)} of food, ${formatCentsLocal(fees)} of platform fees.`,
		);
		if (feeRate !== undefined) {
			explanation.push(`Platform fees added ${feeRate}% on top of the food subtotal.`);
		}
		if (tip > 0) {
			explanation.push(`Tips of ${formatCentsLocal(tip)} are excluded from that rate — they are yours, not the platform's.`);
		}
	}
	return {
		orderCount: orders.length,
		subtotalCents: subtotal,
		platformFeesCents: fees,
		taxCents: tax,
		tipCents: tip,
		feeRatePercent: feeRate,
		explanation,
	};
}

function formatCentsLocal(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Platform comparison — the one valid cross-source comparison here.
 * ------------------------------------------------------------------ */

export type PlatformComparison = {
	merchantId: string;
	platforms: Array<{
		platformId: string;
		orderCount: number;
		subtotalCents: number;
		feesCents: number;
		feeRatePercent: number | undefined;
	}>;
	/** Set only when the evidence actually supports naming one. */
	cheaperPlatformId?: string;
	comparable: boolean;
	explanation: string[];
};

/** Below this, a per-merchant platform split is an anecdote, not a pattern. */
export const MIN_ORDERS_PER_PLATFORM_FOR_COMPARISON = 3;

/**
 * Compares fee burden for the same merchant across platforms.
 *
 * Deliberately compares *fee rate*, not total paid: baskets differ in size
 * between platforms, so comparing totals would mostly measure how hungry you
 * were. It also refuses to name a winner on thin evidence, because menu
 * prices themselves often differ between platforms in ways this data cannot
 * separate from fees.
 */
export function comparePlatformsForMerchant(
	merchantId: string,
	orders: DeliveryOrder[],
): PlatformComparison {
	const byPlatform = new Map<string, DeliveryOrder[]>();
	for (const order of orders) {
		if (order.merchantId !== merchantId) continue;
		const list = byPlatform.get(order.platformId) ?? [];
		list.push(order);
		byPlatform.set(order.platformId, list);
	}

	const platforms = [...byPlatform.entries()].map(([platformId, list]) => {
		const subtotal = list.reduce((sum, order) => sum + order.subtotalCents, 0);
		const fees = list.reduce((sum, order) => sum + platformFeesCents(order), 0);
		return {
			platformId,
			orderCount: list.length,
			subtotalCents: subtotal,
			feesCents: fees,
			feeRatePercent: pctOf(fees, subtotal),
		};
	});
	platforms.sort((a, b) => a.platformId.localeCompare(b.platformId));

	const explanation: string[] = [];
	if (platforms.length < 2) {
		explanation.push(
			`Only ${platforms.length === 1 ? `"${platforms[0]?.platformId}"` : "one platform or fewer"} has orders for this merchant, so there is nothing to compare.`,
		);
		return { merchantId, platforms, comparable: false, explanation };
	}

	const thin = platforms.filter(
		(entry) => entry.orderCount < MIN_ORDERS_PER_PLATFORM_FOR_COMPARISON,
	);
	if (thin.length > 0) {
		explanation.push(
			`Not enough orders to compare: ${thin
				.map((entry) => `${entry.platformId} has ${entry.orderCount}`)
				.join(", ")}, and ${MIN_ORDERS_PER_PLATFORM_FOR_COMPARISON} are needed on each side.`,
		);
		return { merchantId, platforms, comparable: false, explanation };
	}

	const rated = platforms.filter(
		(entry): entry is typeof entry & { feeRatePercent: number } => entry.feeRatePercent !== undefined,
	);
	if (rated.length < 2) {
		explanation.push("Fee rates could not be computed on both sides.");
		return { merchantId, platforms, comparable: false, explanation };
	}

	const sorted = [...rated].sort((a, b) => a.feeRatePercent - b.feeRatePercent);
	const best = sorted.at(0);
	const worst = sorted.at(-1);
	if (!best || !worst) {
		explanation.push("Fee rates could not be computed on both sides.");
		return { merchantId, platforms, comparable: false, explanation };
	}

	for (const entry of platforms) {
		explanation.push(
			`${entry.platformId}: ${entry.orderCount} orders, ${formatCentsLocal(entry.feesCents)} fees on ${formatCentsLocal(entry.subtotalCents)} of food (${entry.feeRatePercent ?? "?"}%).`,
		);
	}

	if (best.feeRatePercent === worst.feeRatePercent) {
		explanation.push("Fee rates are the same, so neither platform is cheaper on fees.");
		return { merchantId, platforms, comparable: true, explanation };
	}

	explanation.push(
		`${best.platformId} charged the lower fee rate on this merchant, by ${Math.round((worst.feeRatePercent - best.feeRatePercent) * 10) / 10} points.`,
	);
	explanation.push(
		"This compares fees only. Menu prices are often set differently per platform, and that difference is not visible in this data.",
	);
	return {
		merchantId,
		platforms,
		cheaperPlatformId: best.platformId,
		comparable: true,
		explanation,
	};
}

/* ------------------------------------------------------------------ *
 * Membership breakeven
 * ------------------------------------------------------------------ */

export type MembershipAssessment = {
	verdict: "pays_off" | "does_not_pay_off" | "counterfactual_unknown" | "insufficient_history";
	orderCount: number;
	membershipCostCents: number;
	/** What the membership costs per order, over the period analysed. */
	costPerOrderCents?: number;
	/** Only computable when the history contains both member and non-member orders. */
	observedFeeRateMember?: number;
	observedFeeRateNonMember?: number;
	estimatedSavingsCents?: number;
	explanation: string[];
};

/**
 * Assesses whether a delivery membership pays for itself.
 *
 * The honest difficulty is the counterfactual: while a membership is active
 * you observe the discounted fee, never what you would have paid without it.
 * So this reports a real verdict only when the history contains orders from
 * both states. Otherwise it inverts the question into one the data *can*
 * answer — how much the membership must save per order to break even — and
 * says plainly that it cannot confirm whether it does.
 */
export function assessMembership(
	orders: DeliveryOrder[],
	membershipCostCents: number,
	periodDays: number,
): MembershipAssessment {
	const withFlag = orders.filter((order) => order.membershipActive !== undefined);
	if (orders.length === 0) {
		return {
			verdict: "insufficient_history",
			orderCount: 0,
			membershipCostCents,
			explanation: ["No delivery orders recorded in this period."],
		};
	}

	const costPerOrder = Math.round(membershipCostCents / orders.length);
	const member = withFlag.filter((order) => order.membershipActive === true);
	const nonMember = withFlag.filter((order) => order.membershipActive === false);

	const memberSubtotal = member.reduce((sum, order) => sum + order.subtotalCents, 0);
	const memberFees = member.reduce((sum, order) => sum + platformFeesCents(order), 0);
	const nonMemberSubtotal = nonMember.reduce((sum, order) => sum + order.subtotalCents, 0);
	const nonMemberFees = nonMember.reduce((sum, order) => sum + platformFeesCents(order), 0);

	const memberRate = pctOf(memberFees, memberSubtotal);
	const nonMemberRate = pctOf(nonMemberFees, nonMemberSubtotal);

	// Not enough of both states to establish the counterfactual.
	if (
		member.length < MIN_ORDERS_PER_PLATFORM_FOR_COMPARISON ||
		nonMember.length < MIN_ORDERS_PER_PLATFORM_FOR_COMPARISON ||
		memberRate === undefined ||
		nonMemberRate === undefined
	) {
		return {
			verdict: "counterfactual_unknown",
			orderCount: orders.length,
			membershipCostCents,
			costPerOrderCents: costPerOrder,
			observedFeeRateMember: memberRate,
			observedFeeRateNonMember: nonMemberRate,
			explanation: [
				`Over ${periodDays} days you placed ${orders.length} orders, so the membership cost ${formatCentsLocal(costPerOrder)} per order.`,
				`For it to pay for itself it must save you more than ${formatCentsLocal(costPerOrder)} in fees on a typical order.`,
				"Whether it does cannot be confirmed from this history: while the membership is active the waived fee is never shown, so there is no record of what you would otherwise have paid.",
			],
		};
	}

	// Both states present: estimate what member orders would have cost at the
	// non-member fee rate, and compare the difference to the membership price.
	const avoidedFees = Math.round((memberSubtotal * (nonMemberRate - memberRate)) / 100);
	const net = avoidedFees - membershipCostCents;
	const explanation = [
		`With the membership you paid a ${memberRate}% fee rate across ${member.length} orders; without it, ${nonMemberRate}% across ${nonMember.length}.`,
		`Applying the non-member rate to your member orders suggests roughly ${formatCentsLocal(avoidedFees)} of fees avoided, against a membership cost of ${formatCentsLocal(membershipCostCents)}.`,
	];
	if (net >= 0) {
		explanation.push(`On that basis it came out ahead by about ${formatCentsLocal(net)}.`);
	} else {
		explanation.push(`On that basis it came up short by about ${formatCentsLocal(-net)}.`);
	}
	explanation.push(
		"This is an estimate from your own order history, not a quoted figure. Fee rates also move with basket size and promotions.",
	);

	return {
		verdict: net >= 0 ? "pays_off" : "does_not_pay_off",
		orderCount: orders.length,
		membershipCostCents,
		costPerOrderCents: costPerOrder,
		observedFeeRateMember: memberRate,
		observedFeeRateNonMember: nonMemberRate,
		estimatedSavingsCents: avoidedFees,
		explanation,
	};
}
