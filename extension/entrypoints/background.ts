import { createCartRecommendation } from "@/lib/engine";
import {
	parseContentScriptMessage,
	parseExtensionMessage,
	type ExtensionMessage,
} from "@/lib/messages";
import { describeInjectionFailure, evaluateScanEligibility } from "@/lib/scanEligibility";
import { completeCartSnapshot } from "@/lib/snapshotFactory";
import { cartSnapshotRepository } from "@/lib/storage/db";
import { getInstallMetadata, getPreferences, setInstallMetadata, setLatestScan } from "@/lib/storage/settings";
import type { CartSnapshotDraft } from "@/lib/types";

const CONTENT_SCRIPT_FILE = "injected-content-script.js";

/**
 * The service worker never keeps durable state only in memory: install
 * metadata and preferences live in chrome.storage.local, and every completed
 * scan is persisted there too (as "latest scan") before this function
 * returns, so a restart mid-flow never silently drops a result.
 */

async function resolveTabId(explicitTabId?: number): Promise<number | undefined> {
	if (explicitTabId !== undefined) return explicitTabId;
	const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return activeTab?.id;
}

/** Best-effort fan-out to any open side panel(s) listening for these events. */
function broadcast(message: ExtensionMessage): void {
	chrome.runtime.sendMessage(message).catch(() => {
		// No listener currently open (e.g. side panel closed) — safe to ignore.
	});
}

async function handleScanCurrentPage(payload: { tabId?: number }): Promise<void> {
	const tabId = await resolveTabId(payload.tabId);
	if (tabId === undefined) {
		broadcast({ type: "CART_SCAN_FAILED", payload: { reason: "No active tab was found to scan." } });
		return;
	}

	const tab = await chrome.tabs.get(tabId).catch(() => undefined);
	const eligibility = evaluateScanEligibility(tab?.url);
	if (eligibility.kind === "restricted") {
		broadcast({ type: "CART_SCAN_FAILED", payload: { tabId, reason: eligibility.reason } });
		return;
	}

	// Checked before injecting so a missing grant is reported as something the
	// user can fix, with the origin named, rather than as an opaque failure.
	// The request itself must come from the side panel: permissions.request()
	// needs a user gesture, and a service worker has none.
	const granted = await chrome.permissions
		.contains({ origins: [eligibility.originPattern] })
		.catch(() => false);
	if (!granted) {
		broadcast({
			type: "CART_SCAN_PERMISSION_REQUIRED",
			payload: { tabId, origin: eligibility.origin, originPattern: eligibility.originPattern },
		});
		return;
	}

	try {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: [CONTENT_SCRIPT_FILE],
		});
	} catch (error) {
		broadcast({
			type: "CART_SCAN_FAILED",
			payload: { tabId, reason: describeInjectionFailure(error, eligibility.origin) },
		});
	}
}

async function handleSnapshotExtracted(tabId: number, draft: CartSnapshotDraft): Promise<void> {
	const snapshot = completeCartSnapshot(draft);

	try {
		const [preferences, priorSnapshots] = await Promise.all([
			getPreferences(),
			cartSnapshotRepository.listSnapshots(),
		]);
		const recommendation = createCartRecommendation(snapshot, preferences, priorSnapshots);

		await setLatestScan({ snapshot, recommendation });
		broadcast({ type: "CART_SCAN_COMPLETE", payload: { tabId, snapshot, recommendation } });
	} catch {
		broadcast({
			type: "CART_SCAN_FAILED",
			payload: { tabId, reason: "Something went wrong evaluating this scan. Your data was not saved." },
		});
	}
}

function registerMessageRouter(): void {
	chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
		const senderTabId = sender.tab?.id;

		if (senderTabId !== undefined) {
			// Message from a content script. Never trust a tabId it claims —
			// sender.tab.id (set by Chrome itself) is the only trustworthy source.
			const message = parseContentScriptMessage(rawMessage);
			if (!message) return false;

			switch (message.type) {
				case "PAGE_DETECTION_RESULT":
					broadcast({ type: "PAGE_DETECTION_RESULT", payload: { tabId: senderTabId, ...message.payload } });
					sendResponse({ acknowledged: true });
					return false;
				case "CART_SNAPSHOT_EXTRACTED":
					handleSnapshotExtracted(senderTabId, message.payload.draft).finally(() =>
						sendResponse({ acknowledged: true }),
					);
					return true;
				case "CART_SCAN_FAILED":
					broadcast({ type: "CART_SCAN_FAILED", payload: { tabId: senderTabId, reason: message.payload.reason } });
					sendResponse({ acknowledged: true });
					return false;
			}
			return false;
		}

		// Message from the side panel (or another extension page — never a tab).
		const message = parseExtensionMessage(rawMessage);
		if (!message) return false;

		if (message.type === "SCAN_CURRENT_PAGE") {
			handleScanCurrentPage(message.payload).finally(() => sendResponse({ acknowledged: true }));
			return true;
		}
		return false;
	});
}

async function initializeInstallMetadata(): Promise<void> {
	const existing = await getInstallMetadata();
	if (existing) return;
	await setInstallMetadata({
		installedAt: new Date().toISOString(),
		extensionVersion: chrome.runtime.getManifest().version,
	});
}

export default defineBackground(() => {
	// Open the side panel when the user clicks the toolbar icon — no popup.
	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

	chrome.runtime.onInstalled.addListener(() => {
		initializeInstallMetadata().catch(() => {});
	});

	registerMessageRouter();
});
