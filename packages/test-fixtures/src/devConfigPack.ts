import type { ConfigurationPack } from "../../config-kit/src/types";
import { DEV_CONFIG_KEY_ID } from "./devKeys";

/**
 * Unsigned development configuration pack. Sign with the dev key via
 * scripts/sign-config-pack.mjs or signConfigurationPack() in tests.
 * The demo_store adapter is the ONLY adapter with action capabilities in the
 * alpha; the generic adapter stays scan-only; named storefront stubs stay
 * experimental and disabled for actions.
 */
export function buildDevConfigPack(
	overrides: Partial<Omit<ConfigurationPack, "signature">> = {},
): Omit<ConfigurationPack, "signature"> {
	return {
		packId: "pi-alpha-adapters",
		version: "1.0.0",
		issuedAt: "2026-08-28T00:00:00.000Z",
		expiresAt: "2027-08-28T00:00:00.000Z",
		minimumExtensionVersion: "0.1.0",
		minimumSidecarVersion: "0.1.0",
		rolloutStage: "local_dev",
		adapterConfigs: [
			{
				adapterId: "demo_store",
				adapterVersion: "demo-1.0.0",
				enabled: true,
				detection: { hostnamePattern: "demo-store\\.fixture\\.local|localhost|127\\.0\\.0\\.1" },
				confidenceThreshold: "medium",
				sensitiveRoutePatterns: ["/login", "/checkout/payment", "/verify-otp"],
				maxActionBudget: 3,
				actionSelectors: {
					open_visible_offers: { css: "#demo-offers-toggle", maxMatches: 1, requiresVisibleText: "offers" },
					search_exact_item: { css: "#demo-search-input", maxMatches: 1 },
					add_exact_approved_item: { css: "#demo-search-results .demo-add-button", maxMatches: 1 },
					adjust_quantity: { css: ".cart-line .demo-qty-increase", maxMatches: 5 },
					remove_optional_item: { css: ".cart-line .demo-remove-button", maxMatches: 5 },
					rescan_cart: { css: "body", maxMatches: 1 },
				},
			},
			{
				adapterId: "generic",
				adapterVersion: "generic-1.1.0",
				enabled: true,
				detection: {},
				confidenceThreshold: "medium",
				// Scan-only: no actionSelectors on purpose.
			},
		],
		changelog: [
			"Initial alpha pack: demo_store adapter with reversible-action selectors; generic adapter scan-only.",
		],
		keyId: DEV_CONFIG_KEY_ID,
		...overrides,
	};
}
