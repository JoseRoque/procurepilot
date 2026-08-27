/**
 * Conservative heuristics used to avoid showing the in-page chip or running
 * extraction on pages that look like login, payment, MFA, or account-security
 * flows. These are intentionally broad (favoring false positives — i.e.
 * staying quiet — over false negatives).
 */

const SENSITIVE_URL_PATTERNS: RegExp[] = [
	/\blogin\b/i,
	/\bsign[-_]?in\b/i,
	/\bsignup\b|\bsign[-_]?up\b/i,
	/\bregister\b/i,
	/\bpassword\b/i,
	/\bforgot[-_]?password\b/i,
	/\breset[-_]?password\b/i,
	/\bmfa\b/i,
	/\b2fa\b/i,
	/\botp\b/i,
	/\bverify\b|\bverification\b/i,
	/\bcheckout\/payment\b/i,
	/\bpayment[s]?\b/i,
	/\bbilling\b/i,
	/\bcard[-_]?details\b/i,
	/\baccount[-_]?security\b/i,
	/\bsecurity\/(settings|check)\b/i,
	/\bsso\b/i,
	/\boauth\b/i,
];

const SENSITIVE_DOM_TEXT_PATTERNS: RegExp[] = [
	/one[-\s]?time\s+(passcode|code|password)/i,
	/enter\s+your\s+password/i,
	/enter\s+the\s+code/i,
	/verification\s+code/i,
	/card\s+number/i,
	/cvv|cvc/i,
	/security\s+code/i,
	/two[-\s]?factor/i,
];

/** Checks the URL alone — cheap, no DOM access required. */
export function isSensitiveUrl(url: URL): boolean {
	const target = `${url.hostname}${url.pathname}${url.search}`;
	return SENSITIVE_URL_PATTERNS.some((pattern) => pattern.test(target));
}

/**
 * Checks a small amount of visible page text for sensitive-flow signals.
 * Callers should pass a bounded excerpt (e.g. document.title + a few visible
 * headings), never the full page text.
 */
export function containsSensitiveText(visibleTextExcerpt: string): boolean {
	return SENSITIVE_DOM_TEXT_PATTERNS.some((pattern) => pattern.test(visibleTextExcerpt));
}

export function isSensitivePage(url: URL, visibleTextExcerpt: string): boolean {
	return isSensitiveUrl(url) || containsSensitiveText(visibleTextExcerpt);
}

/** Also treat password/otp input fields as a strong sensitive-page signal. */
export function hasSensitiveInputFields(document: Document): boolean {
	const sensitiveInputSelectors = [
		'input[type="password"]',
		'input[autocomplete="one-time-code"]',
		'input[autocomplete="cc-number"]',
		'input[autocomplete="cc-csc"]',
		'input[name*="otp" i]',
		'input[name*="cvv" i]',
		'input[name*="cvc" i]',
	];
	return sensitiveInputSelectors.some((selector) => document.querySelector(selector) !== null);
}
