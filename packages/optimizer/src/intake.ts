/**
 * Intake quarantine.
 *
 * Retailer and delivery exports carry fields this product must never hold:
 * addresses, gate codes, phone numbers, courier identities, payment
 * instruments. Ignoring an unmapped column is not enough — a column that is
 * merely unmapped can be mapped later by a user who does not know why it was
 * left alone. So toxic columns are classified up front, reported by name, and
 * refused at the mapping boundary.
 *
 * This is deliberately conservative: it quarantines on header *pattern*, so a
 * column named "dropoff_notes" is refused without inspecting its values. The
 * cost of a false positive is one manually-mapped column. The cost of a false
 * negative is a gate code in a database that later syncs.
 */

export type QuarantineCategory =
	| "location"
	| "contact"
	| "payment"
	| "person"
	| "credential"
	| "freeform";

export type QuarantinedHeader = {
	header: string;
	category: QuarantineCategory;
	reason: string;
};

type Rule = { category: QuarantineCategory; reason: string; pattern: RegExp };

/**
 * Reduces a header to space-separated lowercase tokens.
 *
 * This has to happen before matching. Underscore is a word character, so
 * `\baddress\b` does not match "delivery_address" — and snake_case is exactly
 * how real delivery exports name their columns, so matching the raw header
 * would let through the very fields this module exists to stop.
 */
export function normalizeHeader(header: string): string {
	return header
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
		.replace(/[^a-zA-Z0-9]+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Ordered most-specific first: the first match wins, so "delivery_address"
 * reports as location rather than matching a broader rule later.
 *
 * Patterns match against the normalized form, so word separators are always a
 * single space and `\b` behaves as written.
 */
const RULES: Rule[] = [
	{
		category: "location",
		reason: "Contains a delivery address or precise location, which this product never stores.",
		// "state" is deliberately absent: "order state" means status far more
		// often than it means a region.
		pattern:
			/\b(address|addr|street|line ?[12]|apt|apartment|suite|unit no|city|province|zip|zipcode|postal|postcode|country|lat|latitude|lng|lon|long|longitude|geo|geohash|coord|coordinates|place id|pickup location|dropoff location|delivery location)\b/,
	},
	{
		category: "freeform",
		reason:
			"Free-text delivery instructions routinely contain gate codes, buzzer codes, and apartment numbers.",
		pattern:
			/\b(delivery instruction|dropoff (note|instruction|option)|courier note|driver note|gate code|buzzer|access code|handoff instruction|special instruction)/,
	},
	{
		category: "contact",
		reason: "Phone numbers and email addresses are contact identifiers and are never stored.",
		pattern: /\b(phone|mobile|cell|telephone|tel|email|e mail|contact info)\b/,
	},
	{
		category: "payment",
		reason: "Payment instrument data is never captured, in any form, including masked forms.",
		pattern:
			/\b(card|cardholder|last ?4|cvv|cvc|expiry|exp (month|year)|iban|routing|account number|paypal|payment method|payment instrument|wallet)\b/,
	},
	{
		category: "credential",
		reason: "Credentials and session material are never captured.",
		pattern: /\b(cookie|session|token|auth|authorization|bearer|password|passwd|secret|api key|otp|mfa)\b/,
	},
	{
		category: "person",
		reason:
			"Names of people — including couriers and recipients — are personal data unrelated to price intelligence.",
		pattern:
			/\b(dasher|courier|driver|shopper name|customer name|recipient|first name|last name|full name|user name|user id|customer id|account id|profile id)\b/,
	},
	{
		// Guarded separately because a bare "name" column is ambiguous rather
		// than toxic: "merchant name" and "item name" must survive.
		category: "person",
		reason: "An unqualified name column may be a person's name; rename it if it is not.",
		pattern: /^name$/,
	},
];

export function classifyHeader(header: string): QuarantinedHeader | undefined {
	const normalized = normalizeHeader(header);
	for (const rule of RULES) {
		if (rule.pattern.test(normalized)) {
			return { header, category: rule.category, reason: rule.reason };
		}
	}
	return undefined;
}

export type IntakeClassification = {
	/** Headers safe to offer in the mapping UI. */
	safe: string[];
	/** Headers refused, with the reason shown to the user. */
	quarantined: QuarantinedHeader[];
};

export function classifyHeaders(headers: string[]): IntakeClassification {
	const safe: string[] = [];
	const quarantined: QuarantinedHeader[] = [];
	for (const header of headers) {
		const verdict = classifyHeader(header);
		if (verdict) quarantined.push(verdict);
		else safe.push(header);
	}
	return { safe, quarantined };
}

/**
 * Strips quarantined columns from parsed rows entirely, so no downstream code
 * can read them even by direct header access. Returns the stripped headers so
 * the caller can tell the user exactly what was dropped.
 */
export function applyIntakeQuarantine<T extends { headers: string[]; rows: Array<Record<string, string>> }>(
	csv: T,
): { csv: { headers: string[]; rows: Array<Record<string, string>> }; quarantined: QuarantinedHeader[] } {
	const { safe, quarantined } = classifyHeaders(csv.headers);
	if (quarantined.length === 0) {
		return { csv: { headers: csv.headers, rows: csv.rows }, quarantined };
	}
	const drop = new Set(quarantined.map((entry) => entry.header));
	const rows = csv.rows.map((row) => {
		const clean: Record<string, string> = {};
		for (const [key, value] of Object.entries(row)) {
			if (!drop.has(key)) clean[key] = value;
		}
		return clean;
	});
	return { csv: { headers: safe, rows }, quarantined };
}

export function summarizeQuarantine(quarantined: QuarantinedHeader[]): string[] {
	if (quarantined.length === 0) return [];
	const byCategory = new Map<QuarantineCategory, string[]>();
	for (const entry of quarantined) {
		const list = byCategory.get(entry.category) ?? [];
		list.push(entry.header);
		byCategory.set(entry.category, list);
	}
	return [...byCategory.entries()].map(
		([category, headers]) => `${category}: dropped ${headers.length} column(s) — ${headers.join(", ")}`,
	);
}
