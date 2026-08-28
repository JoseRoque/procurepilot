export type PrivacyMode =
	| "local_only"
	| "private_backup_disabled"
	| "contribute_redacted_outcomes";

export type ItemUrgency = "immediate" | "this_week" | "stock_up" | "watch_only";

export type SubstitutionTolerance =
	| "exact_only"
	| "brand_preferred"
	| "equivalent_allowed";

export type OptimizationGoal =
	| "lowest_final_total"
	| "lowest_immediate_payment"
	| "fewest_merchants"
	| "fastest_fulfillment";

export type ThresholdFillerPolicy =
	| "household_essentials"
	| "pantry_staples"
	| "none";

export type ShoppingPreferences = {
	optimizationGoal: OptimizationGoal;
	thresholdFillerPolicy: ThresholdFillerPolicy;
	substitutionTolerance: SubstitutionTolerance;
	/** Hard ceiling on approved actions per plan; the harness clamps to ≤ MAX_ACTIONS_PER_PLAN. */
	maxActionsPerPlan: number;
	/** Ceiling in cents for any single add_exact_approved_item action. */
	maxSingleAddCents: number;
	localOnly: boolean;
	demoModeEnabled: boolean;
};

export const MAX_ACTIONS_PER_PLAN = 3;
export const MAX_RETRIES_PER_ACTION = 1;

export const DEFAULT_PREFERENCES: ShoppingPreferences = {
	optimizationGoal: "lowest_final_total",
	thresholdFillerPolicy: "none",
	substitutionTolerance: "equivalent_allowed",
	maxActionsPerPlan: MAX_ACTIONS_PER_PLAN,
	maxSingleAddCents: 2_000,
	localOnly: true,
	demoModeEnabled: false,
};

export type ShoppingItem = {
	id: string;
	name: string;
	normalizedName: string;
	urgency: ItemUrgency;
	targetQuantity: number;
	acceptableSubstitution: SubstitutionTolerance;
	maxUnitPriceCents?: number;
	preferredBrand?: string;
	categoryHint?: string;
	active: boolean;
	createdAt: string;
	updatedAt: string;
};

export type ShoppingItemInput = Omit<
	ShoppingItem,
	"id" | "normalizedName" | "createdAt" | "updatedAt"
> & { id?: string };

export function normalizeItemName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, " ");
}
