import { useCallback, useEffect, useState } from "react";
import type {
	ProposedAction,
	PurchasePlan,
	ShoppingPreferences as DomainPreferences,
} from "../../../../packages/domain/src";
import { formatCents } from "../../../../packages/optimizer/src/money";
import { approvalScopeHash } from "../../../../packages/protocol/src/hashing";
import {
	bucketSubtotal,
	type ActiveAdapterConfigPayload,
	type SyncStatus,
} from "../../../../packages/protocol/src";
import type { ActionSelectorMap } from "@/lib/actions/executor";
import type { ContentToPanelResponse, PanelToContentMessage } from "@/lib/messagesPanel";
import {
	bridgeRequest,
	clearConnection,
	DEFAULT_BRIDGE_PORT,
	getConnection,
	getSidecarEnabled,
	probeStatus,
	requestBridgePermission,
	saveConnection,
	setSidecarEnabled,
	type SidecarUiStatus,
} from "@/lib/sidecar/client";
import type { CartSnapshot, ShoppingPreferences } from "@/lib/types";
import { Badge } from "../components/Badge";
import { Section } from "../components/Section";

const STATUS_LABEL: Record<SidecarUiStatus, string> = {
	connected: "Connected",
	unavailable: "Unavailable",
	pairing_required: "Pairing required",
	local_only_fallback: "Local-only fallback",
};

function toDomainPreferences(prefs: ShoppingPreferences): DomainPreferences {
	return {
		optimizationGoal:
			prefs.optimizationGoal === "lowest_total" ? "lowest_final_total" : prefs.optimizationGoal,
		thresholdFillerPolicy: prefs.thresholdFillerPolicy,
		substitutionTolerance: prefs.substitutionTolerance,
		maxActionsPerPlan: 3,
		maxSingleAddCents: 2_000,
		localOnly: true,
		demoModeEnabled: prefs.demoModeEnabled,
	};
}

async function messageActiveTab(message: PanelToContentMessage): Promise<ContentToPanelResponse | undefined> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id === undefined) return undefined;
	try {
		return (await chrome.tabs.sendMessage(tab.id, message)) as ContentToPanelResponse;
	} catch {
		return undefined;
	}
}

export function PlannerTab({
	snapshot,
	preferences,
	onRescan,
}: {
	snapshot?: CartSnapshot;
	preferences: ShoppingPreferences;
	onRescan: () => void;
}) {
	const [status, setStatus] = useState<SidecarUiStatus>("local_only_fallback");
	const [enabled, setEnabled] = useState(false);
	const [packVersion, setPackVersion] = useState<string>();
	const [syncStatus, setSyncStatus] = useState<SyncStatus>();
	const [plan, setPlan] = useState<PurchasePlan>();
	const [proposed, setProposed] = useState<ProposedAction>();
	const [adapterConfig, setAdapterConfig] = useState<ActiveAdapterConfigPayload | null>(null);
	const [flash, setFlash] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [rescanPrompt, setRescanPrompt] = useState(false);

	// Pairing form state
	const [tokenInput, setTokenInput] = useState("");
	const [portInput, setPortInput] = useState(String(DEFAULT_BRIDGE_PORT));

	const refreshStatus = useCallback(async () => {
		setEnabled(await getSidecarEnabled());
		const probed = await probeStatus();
		setStatus(probed);
		if (probed === "connected") {
			const statusResponse = await bridgeRequest({ type: "GET_SIDECAR_STATUS" });
			if (statusResponse.ok && statusResponse.type === "SIDECAR_STATUS") {
				setPackVersion(statusResponse.payload.activeConfigPackVersion);
			}
			const sync = await bridgeRequest({ type: "GET_SYNC_STATUS" });
			if (sync.ok && sync.type === "SYNC_STATUS") setSyncStatus(sync.payload);
		}
	}, []);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	async function toggleEnabled(next: boolean) {
		await setSidecarEnabled(next);
		await refreshStatus();
	}

	async function pair() {
		const port = Number.parseInt(portInput, 10) || DEFAULT_BRIDGE_PORT;
		const granted = await requestBridgePermission(port);
		if (!granted) {
			setFlash("Loopback permission was not granted; pairing cancelled.");
			return;
		}
		await saveConnection({ port, pairingToken: tokenInput.trim() });
		setTokenInput("");
		await refreshStatus();
	}

	async function createPlan() {
		if (!snapshot) return;
		setBusy(true);
		setFlash(undefined);
		try {
			const saveResponse = await bridgeRequest({ type: "CREATE_CART_SNAPSHOT", payload: snapshot });
			if (!saveResponse.ok) throw new Error(saveResponse.error.message);
			const planResponse = await bridgeRequest({
				type: "CREATE_PURCHASE_PLAN",
				payload: { snapshotId: snapshot.id, preferences: toDomainPreferences(preferences) },
			});
			if (!planResponse.ok || planResponse.type !== "PURCHASE_PLAN") {
				throw new Error(planResponse.ok ? "Unexpected response." : planResponse.error.message);
			}
			setPlan(planResponse.payload);
			const config = await bridgeRequest({
				type: "GET_ACTIVE_ADAPTER_CONFIG",
				payload: { adapterId: snapshot.platform },
			});
			setAdapterConfig(config.ok && config.type === "ACTIVE_ADAPTER_CONFIG" ? config.payload : null);
			setFlash("Plan created and saved locally in the sidecar.");
		} catch (error) {
			setFlash(String(error instanceof Error ? error.message : error));
		} finally {
			setBusy(false);
		}
	}

	async function proposeRescanOrAction(actionType: ProposedAction["actionType"], payload: Record<string, unknown>) {
		if (!plan) return;
		setBusy(true);
		setFlash(undefined);
		try {
			const pageState = await messageActiveTab({ type: "GET_PAGE_STATE" });
			if (!pageState || pageState.type !== "PAGE_STATE") {
				throw new Error("Could not read the current page state. Scan the page first.");
			}
			if (pageState.payload.sensitivePage) {
				throw new Error("This page looks sensitive (login/payment/security); actions are blocked.");
			}
			const supportedActions = adapterConfig?.actionSelectors
				? (Object.keys(adapterConfig.actionSelectors) as ProposedAction["actionType"][])
				: [];
			if (!supportedActions.includes(actionType)) {
				throw new Error(
					"No verified configuration pack enables this action for this site — staying scan-only.",
				);
			}
			const response = await bridgeRequest({
				type: "PROPOSE_ACTION",
				payload: {
					planId: plan.id,
					actionType,
					actionPayload: payload,
					currentPageStateHash: pageState.payload.pageStateHash,
					pageOrigin: pageState.payload.pageOrigin,
					adapterId: adapterConfig?.adapterId ?? snapshot?.platform ?? "generic",
					adapterVersion: adapterConfig?.adapterVersion,
					supportedActions,
					adapterConfidence: snapshot?.confidence ?? "low",
				},
			});
			if (!response.ok || response.type !== "ACTION_PROPOSED") {
				throw new Error(response.ok ? "Unexpected response." : response.error.message);
			}
			setProposed(response.payload);
		} catch (error) {
			setFlash(String(error instanceof Error ? error.message : error));
		} finally {
			setBusy(false);
		}
	}

	async function decide(action: ProposedAction, approved: boolean) {
		setBusy(true);
		setFlash(undefined);
		try {
			const scopeHash = await approvalScopeHash({
				actionId: action.id,
				actionType: action.actionType,
				payload: action.payload,
				pageOrigin: action.pageOrigin,
				pageStateHash: action.expectedPageStateHash,
			});
			const approvalResponse = await bridgeRequest({
				type: "RECORD_ACTION_APPROVAL",
				payload: { actionId: action.id, approved, approvalScopeHash: scopeHash },
			});
			if (!approvalResponse.ok) throw new Error(approvalResponse.error.message);
			if (!approved) {
				setProposed(undefined);
				setFlash("Action declined. Nothing was done.");
				return;
			}

			const execution = await messageActiveTab({
				type: "EXECUTE_ACTION",
				payload: {
					actionId: action.id,
					actionType: action.actionType,
					actionPayload: action.payload,
					expectedPageOrigin: action.pageOrigin,
					expectedPageStateHash: action.expectedPageStateHash,
					selectors: (adapterConfig?.actionSelectors ?? {}) as ActionSelectorMap,
				},
			});
			if (!execution || execution.type !== "EXECUTE_RESULT") {
				throw new Error("The page did not respond; the action was not executed.");
			}
			await bridgeRequest({
				type: "RECORD_ACTION_RESULT",
				payload: {
					actionId: action.id,
					outcome: execution.payload.outcome,
					resultSummary: execution.payload.summary,
					stopReason: execution.payload.stopReason,
					evidenceHash: execution.payload.postActionPageStateHash,
				},
			});
			setProposed(undefined);
			setRescanPrompt(true);
			setFlash(
				execution.payload.outcome === "succeeded"
					? `Done: ${execution.payload.summary} Re-scan the cart to confirm the result.`
					: `${execution.payload.summary} ${execution.payload.stopReason ?? ""}`,
			);
			if (plan) {
				const refreshed = await bridgeRequest({ type: "GET_PURCHASE_PLAN", payload: { planId: plan.id } });
				if (refreshed.ok && refreshed.type === "PURCHASE_PLAN") setPlan(refreshed.payload);
			}
		} catch (error) {
			setFlash(String(error instanceof Error ? error.message : error));
		} finally {
			setBusy(false);
		}
	}

	async function queueTestEvent() {
		if (!snapshot) return;
		setBusy(true);
		try {
			const response = await bridgeRequest({
				type: "QUEUE_REDACTED_EVENT",
				payload: {
					schemaVersion: 1,
					eventId: crypto.randomUUID(),
					pseudonymousDeviceId: "stamped-by-sidecar",
					consentReceiptId: "stamped-by-sidecar",
					consentVersion: "consent-v1",
					contributionMode: "contribute_redacted_outcomes",
					eventType: "adapter_scan_outcome",
					platform: snapshot.platform,
					adapterId: snapshot.platform,
					adapterVersion: "bronze-1.1.0",
					occurredAt: new Date().toISOString(),
					subtotalBucket: snapshot.subtotal ? bucketSubtotal(snapshot.subtotal.cents) : undefined,
					outcome: "observed",
					confidence: snapshot.confidence,
					eventIntegrityHash: "0".repeat(64),
				},
			});
			setFlash(
				response.ok && response.type === "REDACTED_EVENT_QUEUED"
					? `Redacted test event queued (${response.payload.queuedEvents} in outbox). Flush it from the sidecar's Privacy & sync screen.`
					: response.ok
						? "Unexpected response."
						: response.error.message,
			);
			await refreshStatus();
		} finally {
			setBusy(false);
		}
	}

	// ---------------------------------------------------------------- render

	return (
		<div className="space-y-4">
			<Section title="Local planner (sidecar)">
				<div className="flex items-center justify-between">
					<label className="flex items-center gap-2 text-sm text-slate-700">
						<input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} className="h-3.5 w-3.5" />
						Use local sidecar
					</label>
					<Badge tone={status === "connected" ? "success" : status === "pairing_required" ? "warning" : "neutral"}>
						{STATUS_LABEL[status]}
					</Badge>
				</div>

				{enabled && status === "pairing_required" && (
					<div className="mt-3 space-y-2">
						<p className="text-xs text-slate-500">
							Open the sidecar app → Privacy & sync → copy the pairing token. Pairing grants the
							extension access to 127.0.0.1 only (a Chrome permission prompt will confirm).
						</p>
						<input
							value={tokenInput}
							onChange={(e) => setTokenInput(e.target.value)}
							placeholder="Pairing token from the sidecar"
							className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
						/>
						<div className="flex items-center gap-2">
							<input
								value={portInput}
								onChange={(e) => setPortInput(e.target.value)}
								className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
								aria-label="Bridge port"
							/>
							<button
								type="button"
								onClick={pair}
								disabled={!tokenInput.trim()}
								className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
							>
								Pair with sidecar
							</button>
						</div>
					</div>
				)}
				{enabled && status === "connected" && (
					<div className="mt-2 flex items-center justify-between text-xs text-slate-500">
						<span>
							Configuration update: {packVersion ? `pack ${packVersion} active` : "no active pack — scan-only"}
						</span>
						<button type="button" className="underline" onClick={async () => { await clearConnection(); await refreshStatus(); }}>
							Unpair
						</button>
					</div>
				)}
				{enabled && status === "unavailable" && (
					<p className="mt-2 text-xs text-slate-500">
						The sidecar app isn't reachable. Launch it, keep its window open, then reopen this panel.
						Scanning still works — results simply stay in this extension (local-only fallback).
					</p>
				)}
			</Section>

			{status === "connected" && (
				<>
					<Section title="Purchase plan">
						{!snapshot ? (
							<p className="text-sm text-slate-500">Scan a cart first (Home tab), then create a plan from it here.</p>
						) : (
							<button
								type="button"
								onClick={createPlan}
								disabled={busy}
								className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
							>
								{busy ? "Working…" : plan ? "Re-create purchase plan from current scan" : "Send to local planner & create purchase plan"}
							</button>
						)}

						{plan && (
							<div className="mt-3 space-y-2 text-sm">
								<div className="flex items-center justify-between">
									<span className="font-medium text-slate-800">Status: {plan.status.replaceAll("_", " ")}</span>
									<Badge tone={plan.confidence === "high" ? "success" : plan.confidence === "medium" ? "warning" : "neutral"}>
										{plan.confidence} confidence
									</Badge>
								</div>
								<div className="rounded-md bg-slate-50 p-2.5">
									<div>Observed total: {plan.observedCost.displayedFinalTotalCents !== undefined ? `${formatCents(plan.observedCost.displayedFinalTotalCents)} (visible on page)` : plan.observedCost.calculatedTotalCents !== undefined ? `${formatCents(plan.observedCost.calculatedTotalCents)} (estimated from visible details)` : "Not detected"}</div>
									<div className="text-xs text-slate-500">
										Required items: {plan.requiredItems.filter((i) => i.status === "in_cart").length}/{plan.requiredItems.length} in cart · Optional: {plan.optionalItems.length}
									</div>
								</div>
								{plan.recommendations.slice(0, 3).map((rec, index) => (
									<div key={index} className="rounded-md border border-slate-200 p-2.5">
										<p className="font-medium text-slate-800">{rec.headline}</p>
										{rec.evidence.slice(0, 2).map((line, i) => (
											<p key={i} className="text-xs text-slate-500">• {line}</p>
										))}
										<p className="mt-1 text-xs text-slate-600">Next safe step: {rec.nextSafeUserAction}</p>
									</div>
								))}
								{plan.warnings.length > 0 && (
									<div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{plan.warnings.join(" · ")}</div>
								)}
								<p className="text-[11px] text-slate-400">
									Private on this device — this plan is stored only in your local sidecar. Full detail in the sidecar app.
								</p>
							</div>
						)}
					</Section>

					{plan && (
						<Section title="Approved reversible actions">
							{adapterConfig?.actionSelectors ? (
								<div className="space-y-2">
									<p className="text-xs text-slate-500">
										Adapter {adapterConfig.adapterId} ({adapterConfig.adapterVersion}) supports actions via
										verified pack {adapterConfig.packVersion}. Every action requires your approval and stops
										before anything irreversible. No checkout automation.
									</p>
									<div className="flex flex-wrap gap-2">
										<button type="button" disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" onClick={() => proposeRescanOrAction("open_visible_offers", {})}>
											Propose: open offers
										</button>
										<button type="button" disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" onClick={() => proposeRescanOrAction("rescan_cart", {})}>
											Propose: re-scan cart
										</button>
										{plan.thresholdOpportunity?.exactItemCandidateId && (() => {
											const candidate = [...plan.requiredItems, ...plan.optionalItems].find(
												(item) => item.shoppingItemId === plan.thresholdOpportunity?.exactItemCandidateId,
											);
											return candidate ? (
												<button type="button" disabled={busy} className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800" onClick={() => proposeRescanOrAction("search_exact_item", { itemName: candidate.displayName })}>
													Propose: search "{candidate.displayName}"
												</button>
											) : null;
										})()}
										{plan.requiredItems.filter((item) => item.status === "missing_from_cart").slice(0, 1).map((item) => (
											<button key={item.displayName} type="button" disabled={busy} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" onClick={() => proposeRescanOrAction("search_exact_item", { itemName: item.displayName })}>
												Propose: search "{item.displayName}"
											</button>
										))}
									</div>
								</div>
							) : (
								<p className="text-xs text-slate-500">
									No verified configuration pack enables actions for this site — scan-only. (Load the dev
									pack in the sidecar's Configuration packs screen to try actions on the demo store.)
								</p>
							)}

							{proposed && (
								<div className="mt-3 rounded-md border-2 border-slate-900 p-3">
									<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action requires approval</p>
									<p className="mt-1 text-sm font-medium text-slate-900">{proposed.userVisibleSummary}</p>
									<ul className="mt-1 space-y-0.5 text-xs text-slate-500">
										{proposed.preconditions.map((condition, index) => (
											<li key={index}>· {condition}</li>
										))}
									</ul>
									<div className="mt-2 flex gap-2">
										<button type="button" disabled={busy} onClick={() => decide(proposed, true)} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
											Approve & run once
										</button>
										<button type="button" disabled={busy} onClick={() => decide(proposed, false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
											Decline
										</button>
									</div>
									<p className="mt-1 text-[11px] text-slate-400">Approval expires in 5 minutes and only covers exactly this action on this page state.</p>
								</div>
							)}

							{rescanPrompt && (
								<button
									type="button"
									className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium"
									onClick={() => { setRescanPrompt(false); onRescan(); }}
								>
									Re-scan cart now to verify the result (recommended)
								</button>
							)}
						</Section>
					)}

					<Section title="Data locality & sync">
						<div className="space-y-1 text-xs text-slate-600">
							<p>Scan data and plans: <Badge tone="success">Private on this device</Badge></p>
							<p>
								Redacted outcomes:{" "}
								{syncStatus?.privacyMode === "contribute_redacted_outcomes" ? (
									<Badge tone="warning">Redacted contribution enabled</Badge>
								) : (
									<Badge tone="neutral">Contribution disabled</Badge>
								)}
							</p>
							{syncStatus && (
								<p>
									Outbox: {syncStatus.queuedEvents} queued · {syncStatus.syncedEvents} synced
									{syncStatus.lastSyncedAt ? ` · last ${new Date(syncStatus.lastSyncedAt).toLocaleString()}` : ""}
								</p>
							)}
						</div>
						{syncStatus?.privacyMode === "contribute_redacted_outcomes" && snapshot && (
							<button type="button" disabled={busy} onClick={queueTestEvent} className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs">
								Queue one redacted test event from this scan
							</button>
						)}
					</Section>
				</>
			)}

			{flash && <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">{flash}</div>}
		</div>
	);
}
