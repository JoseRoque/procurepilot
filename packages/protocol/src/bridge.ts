import { z } from "zod";
import type {
	ActionResultInput,
	ActionType,
	CartSnapshot,
	ConsentReceipt,
	ProposedAction,
	PurchasePlan,
	ShoppingItem,
	ShoppingItemInput,
	ShoppingPreferences,
} from "../../domain/src";
import type { RedactedOutcomeEvent } from "./telemetry";
import { redactedOutcomeEventSchema } from "./telemetry";
import {
	ACTION_TYPES,
	actionResultInputSchema,
	cartSnapshotSchema,
	shoppingItemInputSchema,
	shoppingPreferencesSchema,
} from "./schemas";

/**
 * Extension ⇄ sidecar loopback bridge protocol (alpha).
 * Transport: HTTP POST to 127.0.0.1:<port>/bridge with the pairing token in
 * the X-PI-Pairing-Token header. Every request and response is validated at
 * both ends. See docs/architecture/overview.md for bridge limitations.
 */

export type LocalBridgeRequest =
	| { type: "GET_SIDECAR_STATUS" }
	| { type: "UPSERT_PREFERENCES"; payload: ShoppingPreferences }
	| { type: "CREATE_OR_UPDATE_SHOPPING_ITEM"; payload: ShoppingItemInput }
	| { type: "LIST_SHOPPING_ITEMS" }
	| { type: "CREATE_CART_SNAPSHOT"; payload: CartSnapshot }
	| {
			type: "CREATE_PURCHASE_PLAN";
			payload: { snapshotId: string; preferences: ShoppingPreferences };
	  }
	| { type: "GET_PURCHASE_PLAN"; payload: { planId: string } }
	| {
			type: "PROPOSE_ACTION";
			payload: {
				planId: string;
				actionType: ActionType;
				actionPayload: Record<string, unknown>;
				currentPageStateHash: string;
				pageOrigin: string;
				adapterId: string;
				adapterVersion?: string;
				supportedActions: ActionType[];
				adapterConfidence: "high" | "medium" | "low";
			};
	  }
	| {
			type: "RECORD_ACTION_APPROVAL";
			payload: { actionId: string; approved: boolean; approvalScopeHash: string };
	  }
	| { type: "RECORD_ACTION_RESULT"; payload: ActionResultInput }
	| { type: "GET_SYNC_STATUS" }
	| { type: "QUEUE_REDACTED_EVENT"; payload: RedactedOutcomeEvent }
	| { type: "LIST_CONFIG_PACKS" }
	/**
	 * The adapter's action config (bounded selectors, budget) from the ACTIVE
	 * verified pack only. No active pack ⇒ empty response ⇒ the extension
	 * stays scan-only — this is how the pack kill switch reaches the browser.
	 */
	| { type: "GET_ACTIVE_ADAPTER_CONFIG"; payload: { adapterId: string } };

export const localBridgeRequestSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("GET_SIDECAR_STATUS") }),
	z.object({ type: z.literal("UPSERT_PREFERENCES"), payload: shoppingPreferencesSchema }),
	z.object({
		type: z.literal("CREATE_OR_UPDATE_SHOPPING_ITEM"),
		payload: shoppingItemInputSchema,
	}),
	z.object({ type: z.literal("LIST_SHOPPING_ITEMS") }),
	z.object({ type: z.literal("CREATE_CART_SNAPSHOT"), payload: cartSnapshotSchema }),
	z.object({
		type: z.literal("CREATE_PURCHASE_PLAN"),
		payload: z.object({
			snapshotId: z.string().min(1).max(64),
			preferences: shoppingPreferencesSchema,
		}),
	}),
	z.object({
		type: z.literal("GET_PURCHASE_PLAN"),
		payload: z.object({ planId: z.string().min(1).max(64) }),
	}),
	z.object({
		type: z.literal("PROPOSE_ACTION"),
		payload: z.object({
			planId: z.string().min(1).max(64),
			actionType: z.enum(ACTION_TYPES),
			actionPayload: z.record(z.string(), z.unknown()),
			currentPageStateHash: z.string().max(128),
			pageOrigin: z.string().max(200),
			adapterId: z.string().max(64),
			adapterVersion: z.string().max(50).optional(),
			supportedActions: z.array(z.enum(ACTION_TYPES)).max(10),
			adapterConfidence: z.enum(["high", "medium", "low"]),
		}),
	}),
	z.object({
		type: z.literal("RECORD_ACTION_APPROVAL"),
		payload: z.object({
			actionId: z.string().min(1).max(64),
			approved: z.boolean(),
			approvalScopeHash: z.string().min(1).max(128),
		}),
	}),
	z.object({ type: z.literal("RECORD_ACTION_RESULT"), payload: actionResultInputSchema }),
	z.object({ type: z.literal("GET_SYNC_STATUS") }),
	z.object({ type: z.literal("QUEUE_REDACTED_EVENT"), payload: redactedOutcomeEventSchema }),
	z.object({ type: z.literal("LIST_CONFIG_PACKS") }),
	z.object({
		type: z.literal("GET_ACTIVE_ADAPTER_CONFIG"),
		payload: z.object({ adapterId: z.string().min(1).max(64) }),
	}),
]);

export type SidecarStatus = {
	connected: true;
	sidecarVersion: string;
	schemaVersion: number;
	privacyMode: "local_only" | "private_backup_disabled" | "contribute_redacted_outcomes";
	activeConfigPackVersion?: string;
};

export type SyncStatus = {
	privacyMode: SidecarStatus["privacyMode"];
	queuedEvents: number;
	syncedEvents: number;
	lastSyncedAt?: string;
	deviceRegistered: boolean;
};

export type ConfigPackSummary = {
	packId: string;
	version: string;
	rolloutStage: string;
	verified: boolean;
	active: boolean;
	issuedAt: string;
	expiresAt?: string;
};

export type ActiveAdapterConfigPayload = {
	adapterId: string;
	adapterVersion?: string;
	packVersion?: string;
	maxActionBudget?: number;
	actionSelectors?: Record<
		string,
		{ css: string; maxMatches: number; requiresVisibleText?: string }
	>;
	sensitiveRoutePatterns?: string[];
};

export type LocalBridgeResponse =
	| { ok: true; type: "SIDECAR_STATUS"; payload: SidecarStatus }
	| { ok: true; type: "ACTIVE_ADAPTER_CONFIG"; payload: ActiveAdapterConfigPayload | null }
	| { ok: true; type: "PREFERENCES_SAVED" }
	| { ok: true; type: "SHOPPING_ITEM_SAVED"; payload: ShoppingItem }
	| { ok: true; type: "SHOPPING_ITEMS"; payload: ShoppingItem[] }
	| { ok: true; type: "CART_SNAPSHOT_SAVED"; payload: { snapshotId: string } }
	| { ok: true; type: "PURCHASE_PLAN"; payload: PurchasePlan }
	| { ok: true; type: "ACTION_PROPOSED"; payload: ProposedAction }
	| {
			ok: true;
			type: "ACTION_APPROVAL_RECORDED";
			payload: { actionId: string; approved: boolean; expiresAt?: string };
	  }
	| { ok: true; type: "ACTION_RESULT_RECORDED" }
	| { ok: true; type: "SYNC_STATUS"; payload: SyncStatus }
	| { ok: true; type: "REDACTED_EVENT_QUEUED"; payload: { queuedEvents: number } }
	| { ok: true; type: "CONFIG_PACKS"; payload: ConfigPackSummary[] }
	| { ok: false; error: { code: string; message: string } };

export const localBridgeErrorSchema = z.object({
	ok: z.literal(false),
	error: z.object({ code: z.string().max(64), message: z.string().max(500) }),
});

export function parseBridgeRequest(value: unknown): LocalBridgeRequest | undefined {
	const result = localBridgeRequestSchema.safeParse(value);
	return result.success ? (result.data as LocalBridgeRequest) : undefined;
}

export type { ConsentReceipt };
