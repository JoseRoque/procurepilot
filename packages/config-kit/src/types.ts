import type { ShoppingPreferences, SupportedPlatform } from "../../domain/src";

/**
 * Configuration packs are DATA ONLY. They carry no executable code, and the
 * schema has no field through which code, checkout behavior, credential
 * access, new action types, or approval bypasses could be expressed. Action
 * budgets and approval requirements are enforced in code and can only be
 * tightened here, never loosened past the hard limits.
 */

/** The only action types a pack may configure selectors for. */
export const PACK_CONFIGURABLE_ACTIONS = [
	"open_visible_offers",
	"search_exact_item",
	"add_exact_approved_item",
	"adjust_quantity",
	"remove_optional_item",
	"rescan_cart",
] as const;

export type PackConfigurableAction = (typeof PACK_CONFIGURABLE_ACTIONS)[number];

export type BoundedSelector = {
	/** Plain CSS selector, bounded length; executed via querySelectorAll only. */
	css: string;
	/** Hard cap on matched elements the executor may consider. */
	maxMatches: number;
	/** If set, a matched element must contain this visible text to be used. */
	requiresVisibleText?: string;
};

export type AdapterConfig = {
	adapterId: SupportedPlatform;
	adapterVersion: string;
	enabled: boolean;
	detection: {
		hostnamePattern?: string;
		pathPattern?: string;
	};
	confidenceThreshold?: "high" | "medium" | "low";
	/** Regex source strings (bounded) for extraction text patterns. */
	extractionPatterns?: Partial<
		Record<
			"subtotal" | "discounts" | "deliveryFee" | "serviceFee" | "tax" | "credits" | "total",
			string
		>
	>;
	/** Extra sensitive-route patterns; these ADD to the built-in list, never replace it. */
	sensitiveRoutePatterns?: string[];
	/** ≤ 3; clamped to the code-level hard maximum regardless of pack contents. */
	maxActionBudget?: number;
	actionSelectors?: Partial<Record<PackConfigurableAction, BoundedSelector>>;
};

export type ConfigFixtureReference = {
	fixtureId: string;
	description: string;
	sha256: string;
};

export type ConfigurationPack = {
	packId: string;
	version: string;
	issuedAt: string;
	expiresAt?: string;
	minimumExtensionVersion?: string;
	minimumSidecarVersion?: string;
	rolloutStage: "local_dev" | "private_alpha" | "canary" | "disabled";
	adapterConfigs: AdapterConfig[];
	policyDefaults?: Partial<ShoppingPreferences>;
	fixtures?: ConfigFixtureReference[];
	changelog: string[];
	/** Ed25519 signature (hex) over the canonical JSON of the pack minus signature. */
	signature: string;
	keyId: string;
};

export type PackVerification =
	| { ok: true; pack: ConfigurationPack; active: boolean; inactiveReason?: string }
	| { ok: false; reason: string };
