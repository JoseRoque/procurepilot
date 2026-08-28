import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, normalizeItemName, type ShoppingItem } from "../../domain/src";
import {
	belowThresholdDraft,
	completeFixtureSnapshot,
	flatDollarThresholdDraft,
} from "../../test-fixtures/src";
import {
	canTransition,
	createPurchasePlan,
	evaluateActionPreconditions,
	isTerminal,
	proposeAllowedActions,
	type PageContext,
	type PreconditionInput,
} from "./index";

const page: PageContext = {
	pageOrigin: "https://demo-store.fixture.local",
	pageStateHash: "hash-1",
	adapterId: "demo_store",
	adapterVersion: "demo-1.0.0",
	adapterConfidence: "high",
	supportedActions: [
		"open_visible_offers",
		"search_exact_item",
		"add_exact_approved_item",
		"adjust_quantity",
		"remove_optional_item",
		"rescan_cart",
	],
	sensitivePage: false,
};

function preconditionInput(overrides: Partial<PreconditionInput> = {}): PreconditionInput {
	return {
		action: {
			actionType: "search_exact_item",
			pageOrigin: page.pageOrigin,
			expectedPageStateHash: "hash-1",
			dedupeHash: "dedupe-1",
		},
		page,
		approval: {
			approved: true,
			expiresAt: "2026-08-28T13:00:00.000Z",
			approvalScopeHash: "scope-1",
		},
		expectedApprovalScopeHash: "scope-1",
		nowIso: "2026-08-28T12:00:00.000Z",
		actionsUsedInPlan: 0,
		maxActionsPerPlan: 3,
		priorDedupeHashes: [],
		retriesUsedForAction: 0,
		...overrides,
	};
}

describe("action state machine", () => {
	it("allows only the documented transitions", () => {
		expect(canTransition("proposed", "approved")).toBe(true);
		expect(canTransition("proposed", "declined")).toBe(true);
		expect(canTransition("approved", "started")).toBe(true);
		expect(canTransition("approved", "preconditions_failed")).toBe(true);
		expect(canTransition("started", "succeeded")).toBe(true);
		expect(canTransition("started", "stopped_for_review")).toBe(true);
		// Never legal:
		expect(canTransition("proposed", "started")).toBe(false);
		expect(canTransition("declined", "started")).toBe(false);
		expect(canTransition("succeeded", "started")).toBe(false);
	});

	it("treats declined/failed/succeeded/stopped as terminal", () => {
		expect(isTerminal("declined")).toBe(true);
		expect(isTerminal("failed")).toBe(true);
		expect(isTerminal("succeeded")).toBe(true);
		expect(isTerminal("stopped_for_review")).toBe(true);
		expect(isTerminal("approved")).toBe(false);
	});
});

describe("evaluateActionPreconditions", () => {
	it("passes when everything matches", () => {
		expect(evaluateActionPreconditions(preconditionInput())).toEqual({ ok: true });
	});

	it("requires an explicit approval", () => {
		const result = evaluateActionPreconditions(preconditionInput({ approval: undefined }));
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/approval/i) });
	});

	it("rejects an expired approval", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({
				approval: { approved: true, expiresAt: "2026-08-28T11:00:00.000Z", approvalScopeHash: "scope-1" },
			}),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/expired/i) });
	});

	it("rejects an approval whose scope hash does not match the exact payload", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ expectedApprovalScopeHash: "different-scope" }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/match/i) });
	});

	it("stops on a page-state mismatch", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ page: { ...page, pageStateHash: "hash-CHANGED" } }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/page state/i) });
	});

	it("stops on an origin change", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ page: { ...page, pageOrigin: "https://evil.example" } }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/origin/i) });
	});

	it("stops on a sensitive page", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ page: { ...page, sensitivePage: true } }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/safety/i) });
	});

	it("enforces the plan action budget (max 3)", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ actionsUsedInPlan: 3, maxActionsPerPlan: 99 }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/budget/i) });
	});

	it("blocks a duplicate action against the same page state", () => {
		const result = evaluateActionPreconditions(
			preconditionInput({ priorDedupeHashes: ["dedupe-1"] }),
		);
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/identical/i) });
	});

	it("blocks past the single-retry limit", () => {
		const result = evaluateActionPreconditions(preconditionInput({ retriesUsedForAction: 2 }));
		expect(result).toMatchObject({ ok: false, stopReason: expect.stringMatching(/retry/i) });
	});

	it("allows only rescan when adapter confidence is low", () => {
		const lowPage = { ...page, adapterConfidence: "low" as const };
		expect(
			evaluateActionPreconditions(preconditionInput({ page: lowPage })),
		).toMatchObject({ ok: false });
		expect(
			evaluateActionPreconditions(
				preconditionInput({
					page: lowPage,
					action: {
						actionType: "rescan_cart",
						pageOrigin: page.pageOrigin,
						expectedPageStateHash: "hash-1",
						dedupeHash: "dedupe-rescan",
					},
				}),
			),
		).toEqual({ ok: true });
	});
});

describe("proposeAllowedActions", () => {
	function planFor(draft: typeof belowThresholdDraft, items: ShoppingItem[] = []) {
		return createPurchasePlan({
			snapshot: completeFixtureSnapshot(draft, "s-prop"),
			preferences: DEFAULT_PREFERENCES,
			shoppingItems: items,
			priorSnapshots: [],
			generateId: () => "plan-prop",
		});
	}

	it("proposes at most the remaining budget", () => {
		const plan = planFor(belowThresholdDraft);
		const proposals = proposeAllowedActions(plan, {
			page,
			actionsAlreadyUsed: 2,
			maxActionsPerPlan: 3,
			generateId: () => "a",
			now: () => "2026-08-28T12:00:00.000Z",
		});
		expect(proposals.length).toBeLessThanOrEqual(1);
	});

	it("proposes nothing when the budget is exhausted", () => {
		const plan = planFor(belowThresholdDraft);
		expect(
			proposeAllowedActions(plan, { page, actionsAlreadyUsed: 3, maxActionsPerPlan: 3 }),
		).toEqual([]);
	});

	it("only proposes a re-scan for a needs_review plan", () => {
		const plan = { ...planFor(belowThresholdDraft), status: "needs_review" as const };
		const proposals = proposeAllowedActions(plan, {
			page,
			actionsAlreadyUsed: 0,
			maxActionsPerPlan: 3,
		});
		expect(proposals.map((p) => p.actionType)).toEqual(["rescan_cart"]);
	});

	it("proposes adding an exact pre-approved item that fills a threshold gap", () => {
		const listItem: ShoppingItem = {
			id: "item-choc",
			name: "Fixture dark chocolate bar",
			normalizedName: normalizeItemName("Fixture dark chocolate bar"),
			urgency: "stock_up",
			targetQuantity: 1,
			acceptableSubstitution: "equivalent_allowed",
			maxUnitPriceCents: 600,
			active: true,
			createdAt: "2026-08-28T00:00:00.000Z",
			updatedAt: "2026-08-28T00:00:00.000Z",
		};
		const plan = planFor(flatDollarThresholdDraft, [listItem]);
		const proposals = proposeAllowedActions(plan, {
			page,
			actionsAlreadyUsed: 0,
			maxActionsPerPlan: 3,
		});
		const add = proposals.find((p) => p.actionType === "add_exact_approved_item");
		expect(add?.payload).toMatchObject({ itemName: "Fixture dark chocolate bar", quantity: 1 });
		expect(add?.status).toBe("proposed");
		expect(add?.userVisibleSummary).toContain("Fixture dark chocolate bar");
	});

	it("never proposes an action type the adapter does not support", () => {
		const plan = planFor(belowThresholdDraft);
		const scanOnlyPage: PageContext = { ...page, supportedActions: ["rescan_cart"] };
		const proposals = proposeAllowedActions(plan, {
			page: scanOnlyPage,
			actionsAlreadyUsed: 0,
			maxActionsPerPlan: 3,
		});
		expect(proposals.every((p) => p.actionType === "rescan_cart")).toBe(true);
	});
});
