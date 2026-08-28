import type { PrivacyMode } from "./preferences";

export type ConsentReceipt = {
	id: string;
	privacyMode: PrivacyMode;
	consentVersion: string;
	grantedAt: string;
	revokedAt?: string;
	/** The exact human-readable scope shown to the user at grant time. */
	scopeText: string;
	appVersion: string;
	extensionVersion?: string;
};

export const CONSENT_VERSION = "consent-v1";

/** Verbatim copy required by docs/privacy/consent-model.md; UI must render these lines. */
export const CONSENT_SCOPE_LINES: Record<PrivacyMode, string[]> = {
	local_only: ["Local-only means your private shopping data stays on this device."],
	private_backup_disabled: [
		"Private backup is not available in this version. No backup implementation exists.",
	],
	contribute_redacted_outcomes: [
		"Redacted outcomes may include technical adapter version, offer category, bucketed cart amount, confidence, and whether a visible offer appeared to apply.",
		"It does not include cookies, credentials, payment data, raw cart contents, addresses, or full browsing history.",
		"With one user, this data does not create shared deal intelligence.",
	],
};
