import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LocalBridgeResponse } from "../../../packages/protocol/src";
import { parseBridgeRequest } from "../../../packages/protocol/src";
import { BridgeError, type SidecarCore } from "./services";
import type { SyncService } from "./sync";

/**
 * Sidecar side of the extension bridge: the Rust listener forwards each
 * authenticated HTTP request as a "bridge-request" event; this handler
 * validates, dispatches to the core, and answers via bridge_respond.
 * Every request AND response shape is schema-constrained.
 */
export function startBridgeHandler(
	core: SidecarCore,
	sync: SyncService,
	onActivity?: (summary: string) => void,
): Promise<() => void> {
	return listen<{ id: string; body: string }>("bridge-request", async (event) => {
		const { id, body } = event.payload;
		let response: LocalBridgeResponse;
		try {
			response = await handle(core, sync, body);
			onActivity?.(describe(body));
		} catch (error) {
			if (error instanceof BridgeError) {
				response = { ok: false, error: { code: error.code, message: error.message } };
			} else {
				console.error("[bridge] handler failure", error);
				response = {
					ok: false,
					error: { code: "INTERNAL_ERROR", message: "The sidecar hit an internal error." },
				};
			}
		}
		await invoke("bridge_respond", { id, response: JSON.stringify(response) }).catch(() => {});
	});
}

function describe(body: string): string {
	try {
		return `Bridge: ${(JSON.parse(body) as { type?: string }).type ?? "unknown request"}`;
	} catch {
		return "Bridge: malformed request";
	}
}

async function handle(
	core: SidecarCore,
	sync: SyncService,
	body: string,
): Promise<LocalBridgeResponse> {
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		return { ok: false, error: { code: "INVALID_JSON", message: "Request body must be JSON." } };
	}
	const request = parseBridgeRequest(raw);
	if (!request) {
		return {
			ok: false,
			error: { code: "INVALID_REQUEST", message: "Request failed bridge schema validation." },
		};
	}

	switch (request.type) {
		case "GET_SIDECAR_STATUS": {
			const activePack = await core.packs.activePack();
			return {
				ok: true,
				type: "SIDECAR_STATUS",
				payload: {
					connected: true,
					sidecarVersion: core.config.appVersion,
					schemaVersion: await core.schemaVersion(),
					privacyMode: await core.privacyMode(),
					activeConfigPackVersion: activePack?.version,
				},
			};
		}
		case "UPSERT_PREFERENCES": {
			await core.profile.setPreferences(request.payload);
			// Ledger entries record only non-sensitive metadata, never values.
			await core.ledger.append("preferences_saved", "local_profile", "profile", {
				via: "bridge",
				optimizationGoal: request.payload.optimizationGoal,
				maxActionsPerPlan: request.payload.maxActionsPerPlan,
			});
			return { ok: true, type: "PREFERENCES_SAVED" };
		}
		case "CREATE_OR_UPDATE_SHOPPING_ITEM": {
			const item = await core.items.upsert(request.payload);
			await core.ledger.append("shopping_item_saved", "shopping_item", item.id, {
				via: "bridge",
				urgency: item.urgency,
			});
			return { ok: true, type: "SHOPPING_ITEM_SAVED", payload: item };
		}
		case "LIST_SHOPPING_ITEMS": {
			return { ok: true, type: "SHOPPING_ITEMS", payload: await core.items.list() };
		}
		case "CREATE_CART_SNAPSHOT": {
			await core.saveSnapshot(request.payload);
			return { ok: true, type: "CART_SNAPSHOT_SAVED", payload: { snapshotId: request.payload.id } };
		}
		case "CREATE_PURCHASE_PLAN": {
			const plan = await core.createPlan(request.payload.snapshotId, request.payload.preferences);
			return { ok: true, type: "PURCHASE_PLAN", payload: plan };
		}
		case "GET_PURCHASE_PLAN": {
			return {
				ok: true,
				type: "PURCHASE_PLAN",
				payload: await core.getPlanWithActions(request.payload.planId),
			};
		}
		case "PROPOSE_ACTION": {
			const action = await core.proposeAction(request.payload);
			return { ok: true, type: "ACTION_PROPOSED", payload: action };
		}
		case "RECORD_ACTION_APPROVAL": {
			const outcome = await core.recordApproval(request.payload);
			return { ok: true, type: "ACTION_APPROVAL_RECORDED", payload: outcome };
		}
		case "RECORD_ACTION_RESULT": {
			await core.recordActionResult(request.payload);
			return { ok: true, type: "ACTION_RESULT_RECORDED" };
		}
		case "GET_SYNC_STATUS": {
			return { ok: true, type: "SYNC_STATUS", payload: await sync.status() };
		}
		case "QUEUE_REDACTED_EVENT": {
			const queuedEvents = await core.queueRedactedEvent(request.payload);
			return { ok: true, type: "REDACTED_EVENT_QUEUED", payload: { queuedEvents } };
		}
		case "LIST_CONFIG_PACKS": {
			return { ok: true, type: "CONFIG_PACKS", payload: await core.packs.summaries() };
		}
		case "GET_ACTIVE_ADAPTER_CONFIG": {
			const pack = await core.packs.activePack();
			const adapter = pack?.adapterConfigs.find(
				(config) => config.adapterId === request.payload.adapterId && config.enabled,
			);
			return {
				ok: true,
				type: "ACTIVE_ADAPTER_CONFIG",
				payload: adapter
					? {
							adapterId: adapter.adapterId,
							adapterVersion: adapter.adapterVersion,
							packVersion: pack?.version,
							maxActionBudget: adapter.maxActionBudget,
							actionSelectors: adapter.actionSelectors as Record<
								string,
								{ css: string; maxMatches: number; requiresVisibleText?: string }
							>,
							sensitiveRoutePatterns: adapter.sensitiveRoutePatterns,
						}
					: null,
			};
		}
	}
}
