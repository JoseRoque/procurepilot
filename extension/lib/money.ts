import type { MoneyFact } from "./types";

// Matches "$1,234.56", "$12", "-$3.50", "1234.56", etc. Deliberately narrow:
// we only want to parse text a human would read as a dollar amount.
const MONEY_PATTERN = /(-?)\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/;

/**
 * Parses a dollar amount out of raw visible text into integer cents.
 * Returns undefined (never throws, never guesses) when the text doesn't look
 * like a money value.
 */
export function normalizeMoney(rawText: string): MoneyFact | undefined {
	if (typeof rawText !== "string") return undefined;
	const trimmed = rawText.trim();
	if (!trimmed) return undefined;

	const match = MONEY_PATTERN.exec(trimmed);
	if (!match) return undefined;

	const [, sign, wholePart, fractionPart] = match;
	if (wholePart === undefined) return undefined;
	const digitsOnly = wholePart.replace(/,/g, "");
	if (!/^\d+$/.test(digitsOnly)) return undefined;

	const whole = Number.parseInt(digitsOnly, 10);
	const fraction = fractionPart ? fractionPart.padEnd(2, "0") : "00";
	const fractionCents = Number.parseInt(fraction, 10);

	if (!Number.isFinite(whole) || !Number.isFinite(fractionCents)) {
		return undefined;
	}

	let cents = whole * 100 + fractionCents;
	if (sign === "-") cents = -cents;

	return { currency: "USD", cents, rawText: trimmed };
}

export function formatCents(cents: number): string {
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(Math.trunc(cents));
	const dollars = Math.floor(abs / 100);
	const remainder = String(abs % 100).padStart(2, "0");
	return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

export function addCents(...values: Array<number | undefined>): number {
	return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
