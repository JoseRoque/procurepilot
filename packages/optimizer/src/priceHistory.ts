import {
	MIN_OBSERVATIONS_FOR_BENCHMARK,
	MIN_PURCHASES_FOR_CADENCE,
	type ConsumptionInterval,
	type PriceAssessment,
	type PriceBenchmark,
	type PricePoint,
	type PriceVerdict,
} from "../../domain/src";
import { formatCents } from "./money";
import { compareUnitPrice } from "./units";

/**
 * Personal price benchmarking and repurchase cadence.
 *
 * This is the layer that needs exactly ONE user to be valuable, which is why
 * it is built first: your own purchase history answers "is this a good price?"
 * and "do I need this yet?" without any collective data at all.
 *
 * Discipline carried over from the planner: below the evidence threshold the
 * verdict is "insufficient_history" — never a softened guess.
 */

/** Median of integers, averaging the middle pair on even counts (floored). */
export function medianCents(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] as number;
	return Math.floor(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export function buildPriceBenchmark(
	productKey: string,
	points: PricePoint[],
): PriceBenchmark | undefined {
	const usable = points.filter((point) => Number.isFinite(point.pricePaidCents));
	if (usable.length === 0) return undefined;

	const prices = usable.map((point) => point.pricePaidCents);
	const sortedByDate = [...usable].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
	const mostRecent = sortedByDate[sortedByDate.length - 1] as PricePoint;

	// Best unit price only considers points where a size was actually parsed.
	let bestUnitPrice: PriceBenchmark["bestUnitPrice"];
	for (const point of usable) {
		if (!point.totalBaseUnits || point.totalBaseUnits <= 0) continue;
		const candidate = {
			pricePaidCents: point.pricePaidCents,
			totalBaseUnits: point.totalBaseUnits,
			merchantId: point.merchantId,
		};
		if (!bestUnitPrice || compareUnitPrice(candidate, bestUnitPrice) < 0) {
			bestUnitPrice = candidate;
		}
	}

	return {
		productKey,
		observationCount: usable.length,
		distinctMerchants: new Set(usable.map((point) => point.merchantId)).size,
		lowestCents: Math.min(...prices),
		highestCents: Math.max(...prices),
		medianCents: medianCents(prices),
		mostRecentCents: mostRecent.pricePaidCents,
		mostRecentAt: mostRecent.observedAt,
		bestUnitPrice,
	};
}

/** Within this band of the median, a price is "typical" rather than notable. */
export const TYPICAL_BAND_PERCENT = 5;

/**
 * Assesses an observed price against personal history.
 * Every verdict carries plain-language reasoning built from the actual numbers
 * — the UI renders these sentences rather than inventing its own.
 */
export function assessPrice(
	currentCents: number,
	benchmark: PriceBenchmark | undefined,
): PriceAssessment {
	if (!benchmark || benchmark.observationCount < MIN_OBSERVATIONS_FOR_BENCHMARK) {
		const seen = benchmark?.observationCount ?? 0;
		return {
			verdict: "insufficient_history",
			explanation: [
				`Only ${seen} previous price ${seen === 1 ? "observation" : "observations"} for this product — not enough to say whether ${formatCents(currentCents)} is a good price.`,
				`A benchmark needs at least ${MIN_OBSERVATIONS_FOR_BENCHMARK}.`,
			],
			benchmark,
		};
	}

	const difference = currentCents - benchmark.medianCents;
	// Integer band check: |difference| * 100 <= median * BAND
	const withinTypical =
		Math.abs(difference) * 100 <= benchmark.medianCents * TYPICAL_BAND_PERCENT;

	let verdict: PriceVerdict;
	if (currentCents <= benchmark.lowestCents) verdict = "best_seen";
	else if (currentCents >= benchmark.highestCents) verdict = "worst_seen";
	else if (withinTypical) verdict = "typical";
	else verdict = difference < 0 ? "below_typical" : "above_typical";

	const explanation: string[] = [
		`Current price ${formatCents(currentCents)}.`,
		`Across ${benchmark.observationCount} observations at ${benchmark.distinctMerchants} ${benchmark.distinctMerchants === 1 ? "merchant" : "merchants"}, you have seen ${formatCents(benchmark.lowestCents)}–${formatCents(benchmark.highestCents)}, median ${formatCents(benchmark.medianCents)}.`,
	];

	if (verdict === "best_seen") {
		explanation.push(`This is the lowest price you have recorded for it.`);
	} else if (verdict === "worst_seen") {
		explanation.push(`This is the highest price you have recorded for it.`);
	} else if (verdict === "typical") {
		explanation.push(`That is within ${TYPICAL_BAND_PERCENT}% of your median — an ordinary price.`);
	} else {
		explanation.push(
			`That is ${formatCents(Math.abs(difference))} ${difference < 0 ? "below" : "above"} your median.`,
		);
	}

	if (benchmark.distinctMerchants === 1) {
		explanation.push(
			`All observations come from a single merchant, so this says nothing about prices elsewhere.`,
		);
	}

	return { verdict, explanation, benchmark, differenceFromMedianCents: difference };
}

/**
 * Repurchase cadence from purchase ground truth. Requires
 * MIN_PURCHASES_FOR_CADENCE before it will claim anything, because two
 * purchases give one interval and one interval is not a pattern.
 */
export function deriveConsumptionInterval(
	productKey: string,
	purchaseDatesIso: string[],
): ConsumptionInterval | undefined {
	const sorted = [...new Set(purchaseDatesIso)].sort();
	if (sorted.length < 2) return undefined;

	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const days = Math.round(
			(Date.parse(sorted[i] as string) - Date.parse(sorted[i - 1] as string)) / 86_400_000,
		);
		if (Number.isFinite(days) && days > 0) gaps.push(days);
	}
	if (gaps.length === 0) return undefined;

	return {
		productKey,
		medianDaysBetween: medianCents(gaps),
		purchaseCount: sorted.length,
		lastPurchasedAt: sorted[sorted.length - 1] as string,
		reliable: sorted.length >= MIN_PURCHASES_FOR_CADENCE,
	};
}

export type RepurchaseSignal = {
	productKey: string;
	daysSinceLast: number;
	medianDaysBetween: number;
	/** True only when the cadence is reliable AND we are at/past the interval. */
	likelyDue: boolean;
	explanation: string;
};

export function evaluateRepurchase(
	interval: ConsumptionInterval,
	asOfIso: string,
): RepurchaseSignal {
	const daysSinceLast = Math.max(
		0,
		Math.round((Date.parse(asOfIso) - Date.parse(interval.lastPurchasedAt)) / 86_400_000),
	);
	const likelyDue = interval.reliable && daysSinceLast >= interval.medianDaysBetween;

	const explanation = interval.reliable
		? likelyDue
			? `You have bought this ${interval.purchaseCount} times, typically every ${interval.medianDaysBetween} days. It has been ${daysSinceLast} days.`
			: `You typically rebuy this every ${interval.medianDaysBetween} days; it has been ${daysSinceLast}.`
		: `Only ${interval.purchaseCount} purchases recorded — not enough to predict a cadence yet.`;

	return {
		productKey: interval.productKey,
		daysSinceLast,
		medianDaysBetween: interval.medianDaysBetween,
		likelyDue,
		explanation,
	};
}
