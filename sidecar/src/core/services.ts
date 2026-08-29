import type {
	ActionResultInput,
	ActionType,
	CartSnapshot,
	ConsentReceipt,
	PrivacyMode,
	ProposedAction,
	PurchasePlan,
	ShoppingPreferences,
} from "../../../packages/domain/src";
import {
	CONSENT_SCOPE_LINES,
	CONSENT_VERSION,
	MAX_ACTIONS_PER_PLAN,
} from "../../../packages/domain/src";
import {
	actionDedupeHash,
	canTransition,
	createPurchasePlan,
} from "../../../packages/optimizer/src";
import { approvalScopeHash, eventIntegrityHash } from "../../../packages/protocol/src/hashing";
import {
	actionPayloadSchemas,
	validateRedactedEvent,
} from "../../../packages/protocol/src";
import type { RedactedOutcomeEvent } from "../../../packages/protocol/src";
import { verifyConfigurationPack } from "../../../packages/config-kit/src";
import type { ConfigurationPack } from "../../../packages/config-kit/src/types";
import type { Db, FieldCrypto } from "./db";
import { Ledger } from "./ledger";
import {
	ActionsRepo,
	ConfigPacksRepo,
	ConsentRepo,
	OutboxRepo,
	PlansRepo,
	ProfileRepo,
	ShoppingItemsRepo,
	SnapshotsRepo,
} from "./repos";
import { ImportRepo, ProductRepo, PurchaseRepo } from "./productRepos";

export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export type SidecarConfig = {
	appVersion: string;
	apiBaseUrl: string;
	configPackPublicKeyHex: string;
	configPackKeyId: string;
};

export class SidecarCore {
	readonly profile: ProfileRepo;
	readonly items: ShoppingItemsRepo;
	readonly snapshots: SnapshotsRepo;
	readonly plans: PlansRepo;
	readonly actions: ActionsRepo;
	readonly consent: ConsentRepo;
	readonly outbox: OutboxRepo;
	readonly packs: ConfigPacksRepo;
	readonly products: ProductRepo;
	readonly purchases: PurchaseRepo;
	readonly imports: ImportRepo;
	readonly ledger: Ledger;

	constructor(
		readonly db: Db,
		readonly crypto: FieldCrypto,
		readonly config: SidecarConfig,
	) {
		this.profile = new ProfileRepo(db);
		this.items = new ShoppingItemsRepo(db, crypto);
		this.snapshots = new SnapshotsRepo(db, crypto);
		this.plans = new PlansRepo(db, crypto);
		this.actions = new ActionsRepo(db, crypto);
		this.consent = new ConsentRepo(db);
		this.outbox = new OutboxRepo(db);
		this.packs = new ConfigPacksRepo(db);
		this.products = new ProductRepo(db, crypto);
		this.purchases = new PurchaseRepo(db, crypto);
		this.imports = new ImportRepo(db);
		this.ledger = new Ledger(db);
	}

	/**
	 * The applied local schema version, read from the database rather than
	 * assumed. The migration runner keeps this in step with PRAGMA
	 * user_version; reporting a constant here would misstate compatibility to
	 * anything that gates on it.
	 */
	async schemaVersion(): Promise<number> {
		const rows = await this.db.query("SELECT schema_version FROM local_profile LIMIT 1");
		const value = rows[0]?.schema_version;
		return typeof value === "number" ? value : Number(value ?? 0);
	}

	// ------------------------------------------------------------- consent

	async privacyMode(): Promise<PrivacyMode> {
		return (await this.consent.active())?.privacyMode ?? "local_only";
	}

	async setPrivacyMode(mode: PrivacyMode, extensionVersion?: string): Promise<ConsentReceipt> {
		const receipt: ConsentReceipt = {
			id: crypto.randomUUID(),
			privacyMode: mode,
			consentVersion: CONSENT_VERSION,
			grantedAt: new Date().toISOString(),
			scopeText: CONSENT_SCOPE_LINES[mode].join(" "),
			appVersion: this.config.appVersion,
			extensionVersion,
		};
		await this.consent.grant(receipt);
		await this.ledger.append("consent_changed", "consent_receipt", receipt.id, {
			privacyMode: mode,
			consentVersion: CONSENT_VERSION,
		});
		return receipt;
	}

	// ------------------------------------------------------------ snapshots

	async saveSnapshot(snapshot: CartSnapshot): Promise<void> {
		await this.snapshots.save(snapshot, await this.privacyMode());
		await this.ledger.append("snapshot_saved", "cart_snapshot", snapshot.id, {
			platform: snapshot.platform,
			confidence: snapshot.confidence,
			subtotalCents: snapshot.subtotal?.cents ?? null,
			displayedFinalTotalCents: snapshot.displayedFinalTotal?.cents ?? null,
		});
	}

	// ---------------------------------------------------------------- plans

	async createPlan(snapshotId: string, preferences: ShoppingPreferences): Promise<PurchasePlan> {
		const snapshot = await this.snapshots.get(snapshotId);
		if (!snapshot) throw new BridgeError("SNAPSHOT_NOT_FOUND", "No such snapshot.");
		await this.profile.setPreferences(preferences);
		const shoppingItems = await this.items.list();
		const priorSnapshots = (await this.snapshots.list(10)).filter((s) => s.id !== snapshotId);
		const activePack = await this.packs.activePack();
		const plan = createPurchasePlan({
			snapshot,
			preferences,
			shoppingItems,
			priorSnapshots,
			configPackVersion: activePack?.version,
		});
		await this.plans.save(plan);
		await this.ledger.append("plan_created", "purchase_plan", plan.id, {
			snapshotId,
			status: plan.status,
			recommendationKinds: plan.recommendations.map((r) => r.kind),
			confidence: plan.confidence,
		});
		return plan;
	}

	async getPlanWithActions(planId: string): Promise<PurchasePlan> {
		const plan = await this.plans.get(planId);
		if (!plan) throw new BridgeError("PLAN_NOT_FOUND", "No such plan.");
		plan.proposedActions = await this.actions.listForPlan(planId);
		return plan;
	}

	// -------------------------------------------------------------- actions

	async proposeAction(input: {
		planId: string;
		actionType: ActionType;
		actionPayload: Record<string, unknown>;
		currentPageStateHash: string;
		pageOrigin: string;
		adapterId: string;
		adapterVersion?: string;
	}): Promise<ProposedAction> {
		const plan = await this.plans.get(input.planId);
		if (!plan) throw new BridgeError("PLAN_NOT_FOUND", "No such plan.");

		const payloadSchema = actionPayloadSchemas[input.actionType];
		const parsedPayload = payloadSchema.safeParse(input.actionPayload);
		if (!parsedPayload.success) {
			throw new BridgeError(
				"INVALID_ACTION_PAYLOAD",
				"Action payload contains fields not allowed for this action type.",
			);
		}

		const preferences = (await this.profile.get()).preferences;
		const executed = await this.actions.executedCountForPlan(input.planId);
		const budget = Math.min(preferences.maxActionsPerPlan, MAX_ACTIONS_PER_PLAN);
		if (executed >= budget) {
			throw new BridgeError("ACTION_BUDGET_EXHAUSTED", "The action budget for this plan is exhausted.");
		}

		const payload = parsedPayload.data as Record<string, unknown>;
		const action: ProposedAction = {
			id: crypto.randomUUID(),
			planId: input.planId,
			actionType: input.actionType,
			payload,
			userVisibleSummary: summarizeAction(input.actionType, payload),
			pageOrigin: input.pageOrigin,
			expectedPageStateHash: input.currentPageStateHash,
			adapterId: input.adapterId,
			adapterVersion: input.adapterVersion,
			preconditions: [
				"page origin unchanged",
				"page state hash unchanged",
				"explicit unexpired approval matching this exact payload",
				"action budget remaining",
				"not a sensitive page",
			],
			actionSequence: executed + 1,
			status: "proposed",
			dedupeHash: actionDedupeHash(input.actionType, payload, input.currentPageStateHash),
			createdAt: new Date().toISOString(),
		};
		await this.actions.save(action);
		await this.ledger.append("action_proposed", "plan_action", action.id, {
			planId: input.planId,
			actionType: input.actionType,
			dedupeHash: action.dedupeHash,
			sequence: action.actionSequence,
		});
		return action;
	}

	async recordApproval(input: {
		actionId: string;
		approved: boolean;
		approvalScopeHash: string;
	}): Promise<{ actionId: string; approved: boolean; expiresAt?: string }> {
		const action = await this.actions.get(input.actionId);
		if (!action) throw new BridgeError("ACTION_NOT_FOUND", "No such action.");
		const target = input.approved ? "approved" : "declined";
		if (!canTransition(action.status, target)) {
			throw new BridgeError(
				"INVALID_TRANSITION",
				`Cannot ${target} an action in status "${action.status}".`,
			);
		}

		// The approval must bind to the exact payload + page state the user saw.
		const expectedScope = await approvalScopeHash({
			actionId: action.id,
			actionType: action.actionType,
			payload: action.payload,
			pageOrigin: action.pageOrigin,
			pageStateHash: action.expectedPageStateHash,
		});
		if (input.approvalScopeHash !== expectedScope) {
			throw new BridgeError(
				"APPROVAL_SCOPE_MISMATCH",
				"The approval scope does not match this action's recorded payload and page state.",
			);
		}

		const approvedAt = new Date().toISOString();
		const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
		await this.actions.saveApproval({
			id: crypto.randomUUID(),
			actionId: action.id,
			approved: input.approved,
			approvedAt,
			expiresAt,
			approvalScopeHash: input.approvalScopeHash,
			userVisibleSummary: action.userVisibleSummary,
		});
		await this.actions.setStatus(action.id, target);
		await this.ledger.append(
			input.approved ? "action_approved" : "action_declined",
			"plan_action",
			action.id,
			{ approvalScopeHash: input.approvalScopeHash, expiresAt: input.approved ? expiresAt : undefined },
		);
		return { actionId: action.id, approved: input.approved, expiresAt: input.approved ? expiresAt : undefined };
	}

	async recordActionResult(input: ActionResultInput): Promise<void> {
		const action = await this.actions.get(input.actionId);
		if (!action) throw new BridgeError("ACTION_NOT_FOUND", "No such action.");

		const approval = await this.actions.latestApproval(input.actionId);
		if (input.outcome === "succeeded" || input.outcome === "failed") {
			if (!approval?.approved) {
				throw new BridgeError("NO_APPROVAL", "No approval is recorded for this action.");
			}
			if (approval.expiresAt <= new Date().toISOString()) {
				// Result arriving after expiry is recorded, but flagged for review.
				input = {
					...input,
					outcome: "stopped_for_review",
					stopReason: input.stopReason ?? "Result reported after the approval expired.",
				};
			}
		}

		const statusByOutcome: Record<ActionResultInput["outcome"], ProposedAction["status"]> = {
			succeeded: "succeeded",
			failed: "failed",
			preconditions_failed: "preconditions_failed",
			stopped_for_review: "stopped_for_review",
		};
		const nextStatus = statusByOutcome[input.outcome];
		// approved → (implicit started) → terminal; enforce the machine.
		if (action.status === "approved" || action.status === "started") {
			if (action.status === "approved" && !canTransition("approved", nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "stopped_for_review" ? "started" : nextStatus)) {
				throw new BridgeError("INVALID_TRANSITION", `Cannot record ${input.outcome} from "${action.status}".`);
			}
		} else {
			throw new BridgeError(
				"INVALID_TRANSITION",
				`Cannot record a result for an action in status "${action.status}".`,
			);
		}

		await this.actions.saveResult(input);
		await this.actions.setStatus(action.id, nextStatus);
		await this.ledger.append("action_result", "plan_action", action.id, {
			outcome: input.outcome,
			stopReason: input.stopReason ?? null,
			postActionSnapshotId: input.postActionSnapshotId ?? null,
		});

		if (input.outcome === "stopped_for_review" || input.outcome === "failed") {
			await this.plans.updateStatus(action.planId, "needs_review");
		}
	}

	// ------------------------------------------------------------ telemetry

	async queueRedactedEvent(event: RedactedOutcomeEvent): Promise<number> {
		const receipt = await this.consent.active();
		if (!receipt || receipt.privacyMode !== "contribute_redacted_outcomes" || receipt.revokedAt) {
			throw new BridgeError(
				"CONSENT_REQUIRED",
				"Redacted contribution is disabled. Enable it in Privacy settings first.",
			);
		}
		// The sidecar is authoritative for identity fields: it stamps the real
		// pseudonymous device id and consent receipt id, then recomputes the
		// integrity hash and re-runs the full redaction validation.
		const profile = await this.profile.get();
		const stamped: Record<string, unknown> = {
			...event,
			pseudonymousDeviceId: profile.pseudonymousDeviceId,
			consentReceiptId: receipt.id,
		};
		stamped.eventIntegrityHash = await eventIntegrityHash(stamped);
		const validation = validateRedactedEvent(stamped);
		if (!validation.ok) {
			throw new BridgeError("REDACTION_FAILED", validation.reason);
		}
		const queued = await this.outbox.queue(JSON.stringify(validation.event), receipt.id);
		await this.ledger.append("redacted_event_queued", "sync_outbox", validation.event.eventId, {
			eventType: validation.event.eventType,
			platform: validation.event.platform,
		});
		return queued;
	}

	// ----------------------------------------------------------- config packs

	async verifyAndStorePack(packValue: unknown): Promise<{ active: boolean; reason?: string }> {
		const result = await verifyConfigurationPack(packValue, {
			publicKeyHex: this.config.configPackPublicKeyHex,
			expectedKeyId: this.config.configPackKeyId,
			sidecarVersion: this.config.appVersion,
		});
		if (!result.ok) {
			await this.ledger.append("config_pack_rejected", "configuration_pack", "unknown", {
				reason: result.reason,
			});
			return { active: false, reason: result.reason };
		}
		await this.packs.store(result.pack, true, result.active, result.inactiveReason);
		await this.ledger.append("config_pack_stored", "configuration_pack", `${result.pack.packId}@${result.pack.version}`, {
			active: result.active,
			rolloutStage: result.pack.rolloutStage,
			inactiveReason: result.inactiveReason ?? null,
		});
		return { active: result.active, reason: result.inactiveReason };
	}

	async activeAdapterConfig(adapterId: string): Promise<ConfigurationPack["adapterConfigs"][number] | undefined> {
		const pack = await this.packs.activePack();
		return pack?.adapterConfigs.find((config) => config.adapterId === adapterId && config.enabled);
	}
}

export class BridgeError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

function summarizeAction(actionType: ActionType, payload: Record<string, unknown>): string {
	switch (actionType) {
		case "open_visible_offers":
			return "Open the page's visible offers section so its terms can be read.";
		case "search_exact_item":
			return `Search this store for "${payload.itemName}". No item will be added by this action.`;
		case "add_exact_approved_item":
			return `Add ${payload.quantity} × "${payload.itemName}" to the cart (price limit ${
				payload.maxUnitPriceCents == null ? "not set" : `$${((payload.maxUnitPriceCents as number) / 100).toFixed(2)}`
			}).`;
		case "adjust_quantity":
			return `Change quantity of "${payload.itemName}" from ${payload.fromQuantity} to ${payload.toQuantity}.`;
		case "remove_optional_item":
			return `Remove the optional item "${payload.itemName}" from the cart.`;
		case "rescan_cart":
			return "Re-scan the cart to confirm its current state.";
		case "scan_page":
			return "Scan the current page.";
	}
}
