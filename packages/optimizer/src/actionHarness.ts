import type {
	ActionStatus,
	ActionType,
	ProposedAction,
	PurchasePlan,
} from "../../domain/src";
import { MAX_ACTIONS_PER_PLAN, MAX_RETRIES_PER_ACTION } from "../../domain/src";
import { actionDedupeHash } from "./dedupe";
import { formatCents } from "./money";

/**
 * The complete, closed set of action types this system can ever execute.
 * Nothing outside this list exists in code, and config packs cannot add to it.
 */
export const ALLOWED_ACTION_TYPES: readonly ActionType[] = [
	"scan_page",
	"open_visible_offers",
	"search_exact_item",
	"add_exact_approved_item",
	"adjust_quantity",
	"remove_optional_item",
	"rescan_cart",
];

/** Persisted-status transitions; anything not listed is an invalid transition. */
const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
	proposed: ["approved", "declined"],
	approved: ["started", "preconditions_failed", "declined"],
	declined: [],
	preconditions_failed: [],
	started: ["succeeded", "failed", "stopped_for_review"],
	succeeded: [],
	failed: [],
	stopped_for_review: [],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
	return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: ActionStatus): boolean {
	return ALLOWED_TRANSITIONS[status].length === 0;
}

export type PageContext = {
	pageOrigin: string;
	pageStateHash?: string;
	adapterId: string;
	adapterVersion?: string;
	adapterConfidence: "high" | "medium" | "low";
	/** Action types the current adapter/config pack actually supports. */
	supportedActions: ActionType[];
	sensitivePage: boolean;
};

export type PreconditionInput = {
	action: Pick<
		ProposedAction,
		"actionType" | "pageOrigin" | "expectedPageStateHash" | "dedupeHash"
	>;
	page: PageContext;
	approval?: {
		approved: boolean;
		expiresAt: string;
		approvalScopeHash: string;
	};
	expectedApprovalScopeHash: string;
	nowIso: string;
	actionsUsedInPlan: number;
	maxActionsPerPlan: number;
	priorDedupeHashes: string[];
	retriesUsedForAction: number;
};

export type PreconditionResult =
	| { ok: true }
	| { ok: false; stopReason: string };

/**
 * Deterministic stop-condition gate. Both the sidecar (before dispatch) and
 * the content script (before touching the page) call this with what each
 * side knows; any failure is terminal for the attempt and user-visible.
 */
export function evaluateActionPreconditions(input: PreconditionInput): PreconditionResult {
	const { action, page, approval } = input;

	if (!ALLOWED_ACTION_TYPES.includes(action.actionType)) {
		return { ok: false, stopReason: "Unknown action type." };
	}
	if (page.sensitivePage) {
		return {
			ok: false,
			stopReason: "A login, payment, or account-security page was detected. Stopped for safety.",
		};
	}
	if (action.pageOrigin !== page.pageOrigin) {
		return { ok: false, stopReason: "The page origin changed since this action was proposed." };
	}
	if (
		action.expectedPageStateHash !== undefined &&
		page.pageStateHash !== undefined &&
		action.expectedPageStateHash !== page.pageStateHash
	) {
		return {
			ok: false,
			stopReason: "The page state changed materially since this action was approved.",
		};
	}
	if (!page.supportedActions.includes(action.actionType)) {
		return { ok: false, stopReason: "The current adapter does not support this action." };
	}
	if (page.adapterConfidence === "low" && action.actionType !== "rescan_cart") {
		return { ok: false, stopReason: "Adapter confidence is low; only re-scanning is allowed." };
	}
	if (!approval || !approval.approved) {
		return { ok: false, stopReason: "This action has no recorded approval." };
	}
	if (approval.expiresAt <= input.nowIso) {
		return { ok: false, stopReason: "The approval for this action has expired." };
	}
	if (approval.approvalScopeHash !== input.expectedApprovalScopeHash) {
		return {
			ok: false,
			stopReason: "The approval does not match this exact action payload and page state.",
		};
	}
	if (input.actionsUsedInPlan >= Math.min(input.maxActionsPerPlan, MAX_ACTIONS_PER_PLAN)) {
		return { ok: false, stopReason: "The action budget for this plan is exhausted." };
	}
	if (input.priorDedupeHashes.includes(action.dedupeHash)) {
		return { ok: false, stopReason: "An identical action already ran against this page state." };
	}
	if (input.retriesUsedForAction > MAX_RETRIES_PER_ACTION) {
		return { ok: false, stopReason: "The retry limit for this action was reached." };
	}
	return { ok: true };
}

export type ProposeActionsContext = {
	page: PageContext;
	actionsAlreadyUsed: number;
	maxActionsPerPlan: number;
	now?: () => string;
	generateId?: () => string;
};

function baseAction(
	plan: PurchasePlan,
	context: ProposeActionsContext,
	sequence: number,
	actionType: ActionType,
	payload: Record<string, unknown>,
	summary: string,
	extraPreconditions: string[],
): ProposedAction {
	const now = context.now ?? (() => new Date().toISOString());
	const generateId = context.generateId ?? (() => globalThis.crypto.randomUUID());
	return {
		id: generateId(),
		planId: plan.id,
		actionType,
		payload,
		userVisibleSummary: summary,
		pageOrigin: context.page.pageOrigin,
		expectedPageStateHash: context.page.pageStateHash,
		adapterId: context.page.adapterId,
		adapterVersion: context.page.adapterVersion,
		preconditions: [
			"page origin unchanged",
			"page state hash unchanged",
			"explicit unexpired approval matching this exact payload",
			"action budget remaining",
			"not a sensitive page",
			...extraPreconditions,
		],
		actionSequence: sequence,
		status: "proposed",
		dedupeHash: actionDedupeHash(actionType, payload, context.page.pageStateHash),
		createdAt: now(),
	};
}

/**
 * Deterministic action proposal. Proposals are suggestions only — nothing
 * runs without an explicit per-action approval recorded through the harness.
 */
export function proposeAllowedActions(
	plan: PurchasePlan,
	context: ProposeActionsContext,
): ProposedAction[] {
	const budget =
		Math.min(context.maxActionsPerPlan, MAX_ACTIONS_PER_PLAN) - context.actionsAlreadyUsed;
	if (budget <= 0) return [];
	const supports = (type: ActionType) => context.page.supportedActions.includes(type);
	const proposals: ProposedAction[] = [];
	let sequence = context.actionsAlreadyUsed + 1;

	// A plan flagged for review only ever gets a re-scan: refresh evidence first.
	if (plan.status === "needs_review") {
		if (supports("rescan_cart")) {
			proposals.push(
				baseAction(
					plan,
					context,
					sequence,
					"rescan_cart",
					{},
					"Re-scan the cart to refresh the evidence behind this plan.",
					[],
				),
			);
		}
		return proposals.slice(0, budget);
	}

	// 1. Exact pre-approved shopping-list item that fills a threshold gap.
	const candidateId = plan.thresholdOpportunity?.exactItemCandidateId;
	if (candidateId && supports("add_exact_approved_item")) {
		const candidate = [...plan.requiredItems, ...plan.optionalItems].find(
			(item) => item.shoppingItemId === candidateId,
		);
		if (candidate && candidate.status === "missing_from_cart") {
			proposals.push(
				baseAction(
					plan,
					context,
					sequence++,
					"add_exact_approved_item",
					{
						itemName: candidate.displayName,
						quantity: 1,
						maxUnitPriceCents: candidate.unitPriceCents ?? null,
					},
					`Add 1 × "${candidate.displayName}" from your shopping list (closes a ${formatCents(plan.thresholdOpportunity?.gapCents ?? 0)} threshold gap).`,
					["exact item visible with a price at or below your stated limit"],
				),
			);
		}
	}

	// 2. Search for a missing required item.
	const missingRequired = plan.requiredItems.find((item) => item.status === "missing_from_cart");
	if (missingRequired && supports("search_exact_item")) {
		proposals.push(
			baseAction(
				plan,
				context,
				sequence++,
				"search_exact_item",
				{ itemName: missingRequired.displayName },
				`Search this store for "${missingRequired.displayName}" (required item not in cart). No item will be added by this action.`,
				["search input visible on page"],
			),
		);
	}

	// 3. Open the visible offers section when unapplied offers are showing.
	const hasUnappliedOffer = plan.thresholdOpportunity !== undefined;
	if (hasUnappliedOffer && supports("open_visible_offers")) {
		proposals.push(
			baseAction(
				plan,
				context,
				sequence++,
				"open_visible_offers",
				{},
				"Open the page's visible offers section so its terms can be read.",
				["offers control visible on page"],
			),
		);
	}

	// 4. Re-scan is always the safe last proposal when budget remains.
	if (supports("rescan_cart") && proposals.length < budget) {
		proposals.push(
			baseAction(
				plan,
				context,
				sequence++,
				"rescan_cart",
				{},
				"Re-scan the cart to confirm its current state.",
				[],
			),
		);
	}

	return proposals.slice(0, budget);
}
