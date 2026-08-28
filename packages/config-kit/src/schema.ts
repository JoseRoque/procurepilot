import { z } from "zod";
import { SUPPORTED_PLATFORMS } from "../../protocol/src/schemas";
import { PACK_CONFIGURABLE_ACTIONS } from "./types";

const boundedSelectorSchema = z.strictObject({
	css: z
		.string()
		.min(1)
		.max(200)
		// querySelectorAll input only; forbid characters that could smuggle
		// markup or javascript: URLs through downstream string handling.
		.regex(/^[^<>{}`]+$/, "Selector contains forbidden characters."),
	maxMatches: z.number().int().min(1).max(5),
	requiresVisibleText: z.string().min(1).max(100).optional(),
});

const actionSelectorsSchema = z
	.strictObject(
		Object.fromEntries(
			PACK_CONFIGURABLE_ACTIONS.map((action) => [action, boundedSelectorSchema.optional()]),
		) as Record<(typeof PACK_CONFIGURABLE_ACTIONS)[number], z.ZodOptional<typeof boundedSelectorSchema>>,
	)
	.optional();

const adapterConfigSchema = z.strictObject({
	adapterId: z.enum(SUPPORTED_PLATFORMS),
	adapterVersion: z.string().min(1).max(32),
	enabled: z.boolean(),
	detection: z.strictObject({
		hostnamePattern: z.string().max(200).optional(),
		pathPattern: z.string().max(200).optional(),
	}),
	confidenceThreshold: z.enum(["high", "medium", "low"]).optional(),
	extractionPatterns: z
		.strictObject({
			subtotal: z.string().max(200).optional(),
			discounts: z.string().max(200).optional(),
			deliveryFee: z.string().max(200).optional(),
			serviceFee: z.string().max(200).optional(),
			tax: z.string().max(200).optional(),
			credits: z.string().max(200).optional(),
			total: z.string().max(200).optional(),
		})
		.optional(),
	sensitiveRoutePatterns: z.array(z.string().max(200)).max(20).optional(),
	maxActionBudget: z.number().int().min(0).max(3).optional(),
	actionSelectors: actionSelectorsSchema,
});

const policyDefaultsSchema = z
	.strictObject({
		optimizationGoal: z
			.enum([
				"lowest_final_total",
				"lowest_immediate_payment",
				"fewest_merchants",
				"fastest_fulfillment",
			])
			.optional(),
		thresholdFillerPolicy: z.enum(["household_essentials", "pantry_staples", "none"]).optional(),
		substitutionTolerance: z
			.enum(["exact_only", "brand_preferred", "equivalent_allowed"])
			.optional(),
		maxActionsPerPlan: z.number().int().min(0).max(3).optional(),
		maxSingleAddCents: z.number().int().min(0).max(100_000).optional(),
		localOnly: z.literal(true).optional(),
		demoModeEnabled: z.boolean().optional(),
	})
	.optional();

/**
 * strictObject throughout: a pack containing ANY field outside this shape —
 * script bodies, extra action types, permission grants, whatever — fails
 * validation outright.
 */
export const configurationPackSchema = z.strictObject({
	packId: z.string().min(1).max(64),
	version: z.string().min(1).max(32),
	issuedAt: z.iso.datetime(),
	expiresAt: z.iso.datetime().optional(),
	minimumExtensionVersion: z.string().max(32).optional(),
	minimumSidecarVersion: z.string().max(32).optional(),
	rolloutStage: z.enum(["local_dev", "private_alpha", "canary", "disabled"]),
	adapterConfigs: z.array(adapterConfigSchema).max(20),
	policyDefaults: policyDefaultsSchema,
	fixtures: z
		.array(
			z.strictObject({
				fixtureId: z.string().min(1).max(64),
				description: z.string().max(300),
				sha256: z.string().length(64),
			}),
		)
		.max(20)
		.optional(),
	changelog: z.array(z.string().max(500)).max(50),
	signature: z.string().min(1).max(200),
	keyId: z.string().min(1).max(64),
});
