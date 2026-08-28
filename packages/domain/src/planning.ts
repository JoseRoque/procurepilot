import type { CartSnapshot, ScanConfidence, VisibleOffer } from "./commerce";
import type { OptimizationGoal, ShoppingItem } from "./preferences";

export type PlanStatus =
	| "draft"
	| "needs_review"
	| "ready_for_approved_actions"
	| "paused"
	| "completed_manually"
	| "abandoned";

export type ActionType =
	| "scan_page"
	| "open_visible_offers"
	| "search_exact_item"
	| "add_exact_approved_item"
	| "adjust_quantity"
	| "remove_optional_item"
	| "rescan_cart";

export type ActionStatus =
	| "proposed"
	| "approved"
	| "declined"
	| "preconditions_failed"
	| "started"
	| "succeeded"
	| "failed"
	| "stopped_for_review";

/** Every money figure is integer cents. There is no floating-point currency anywhere. */
export type CostBreakdown = {
	subtotalCents?: number;
	discountsCents?: number;
	deliveryFeeCents?: number;
	serviceFeeCents?: number;
	taxCents?: number;
	visibleCreditsCents?: number;
	displayedFinalTotalCents?: number;
	calculatedTotalCents?: number;
	/** Which figure the engine treats as authoritative, and why. */
	basis: "displayed_total" | "calculated_total" | "unknown";
};

export type PlannedItemStatus =
	| "in_cart"
	| "missing_from_cart"
	| "unavailable"
	| "needs_review";

export type PlannedItem = {
	shoppingItemId?: string;
	displayName: string;
	required: boolean;
	status: PlannedItemStatus;
	matchedCartLine?: string;
	quantityInCart?: number;
	targetQuantity?: number;
	unitPriceCents?: number;
	notes: string[];
};

export type ThresholdOpportunity = {
	offerTitle: string;
	minimumSpendCents: number;
	gapCents: number;
	discountCents?: number;
	discountPercent?: number;
	maximumDiscountCents?: number;
	/** True only when a flat-dollar benefit conservatively clears the gap. */
	fillerRecommended: boolean;
	suggestedFillerCategory?: string;
	/** An exact, pre-approved shopping-list item that would fill the gap, if one exists. */
	exactItemCandidateId?: string;
	explanation: string[];
	confidence: ScanConfidence;
};

export type ComparisonResult = {
	comparedSnapshotId: string;
	comparedSnapshotCreatedAt: string;
	comparedTotalCents: number;
	currentTotalCents: number;
	/** Positive means the current cart is cheaper. */
	differenceCents: number;
	basis: "displayed_total" | "calculated_total";
	explanation: string[];
};

export type CoverageResult = {
	requiredCovered: number;
	requiredTotal: number;
	missingRequired: PlannedItem[];
	unavailableRequired: PlannedItem[];
	explanation: string[];
};

export type RecommendationKind =
	| "lower_observed_total"
	| "threshold_gap"
	| "threshold_filler_category"
	| "fee_heavy_cart"
	| "total_discrepancy"
	| "required_item_unavailable"
	| "required_item_missing"
	| "policy_conflict"
	| "review_required"
	| "no_action";

export type Recommendation = {
	kind: RecommendationKind;
	headline: string;
	evidence: string[];
	assumptions: string[];
	arithmetic: string[];
	warnings: string[];
	nextSafeUserAction: string;
	estimatedImpactCents?: number;
	confidence: ScanConfidence;
};

export type ProposedAction = {
	id: string;
	planId: string;
	actionType: ActionType;
	/** Restricted to the allowed fields for the action type; schema-enforced. */
	payload: Record<string, unknown>;
	userVisibleSummary: string;
	pageOrigin: string;
	expectedPageStateHash?: string;
	adapterId: string;
	adapterVersion?: string;
	preconditions: string[];
	actionSequence: number;
	status: ActionStatus;
	/** SHA-256 of type+payload+pageState — the dedupe/anti-loop key. */
	dedupeHash: string;
	createdAt: string;
};

export type ActionApproval = {
	id: string;
	actionId: string;
	approved: boolean;
	approvedAt: string;
	expiresAt: string;
	/** Binds the approval to the exact payload+page state it was shown for. */
	approvalScopeHash: string;
	userVisibleSummary: string;
};

export type ActionResultOutcome =
	| "succeeded"
	| "failed"
	| "preconditions_failed"
	| "stopped_for_review";

export type ActionResultInput = {
	actionId: string;
	outcome: ActionResultOutcome;
	resultSummary: string;
	postActionSnapshotId?: string;
	stopReason?: string;
	evidenceHash?: string;
};

export type PurchasePlan = {
	id: string;
	createdAt: string;
	updatedAt: string;
	status: PlanStatus;
	sourceSnapshotId?: string;
	optimizationGoal: OptimizationGoal;
	requiredItems: PlannedItem[];
	optionalItems: PlannedItem[];
	observedCost: CostBreakdown;
	estimatedPlanCost?: CostBreakdown;
	thresholdOpportunity?: ThresholdOpportunity;
	comparison?: ComparisonResult;
	recommendations: Recommendation[];
	proposedActions: ProposedAction[];
	assumptions: string[];
	warnings: string[];
	confidence: ScanConfidence;
	policyVersion: string;
	adapterVersion?: string;
	configPackVersion?: string;
};

export type Evaluation = {
	observedCost: CostBreakdown;
	visibleOffers: VisibleOffer[];
	recommendations: Recommendation[];
	warnings: string[];
	confidence: ScanConfidence;
};

export type PlanInput = {
	snapshot: CartSnapshot;
	shoppingItems: ShoppingItem[];
	priorSnapshots: CartSnapshot[];
	policyVersion: string;
	configPackVersion?: string;
};

export const POLICY_VERSION = "policy-v1";
