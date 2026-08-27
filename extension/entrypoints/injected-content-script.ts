import { detectPage } from "@/lib/adapters/registry";
import type { ContentScriptMessage } from "@/lib/messages";
import { hasSensitiveInputFields, isSensitivePage } from "@/lib/sensitivePages";
import type { CartSnapshotDraft, DetectionStatus } from "@/lib/types";

type ChipState = "scanning" | "complete" | "unavailable";

const CHIP_HOST_ID = "purchasing-intelligence-chip-host";

const CHIP_STATE_TEXT: Record<ChipState, string> = {
	scanning: "Purchasing Intelligence: Scanning…",
	complete: "Purchasing Intelligence: Scan complete — open side panel",
	unavailable: "Purchasing Intelligence: Scan unavailable on this page",
};

const CHIP_STYLES = `
	:host {
		all: initial;
	}
	.chip-wrapper {
		position: fixed;
		bottom: 16px;
		right: 16px;
		z-index: 2147483000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 320px;
		pointer-events: none;
	}
	.chip-button {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border-radius: 9999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #0f172a;
		color: #ffffff;
		font-size: 13px;
		font-weight: 600;
		line-height: 1.2;
		padding: 10px 14px;
		box-shadow: 0 8px 20px rgba(15, 23, 42, 0.25);
		cursor: pointer;
	}
	.chip-button:focus-visible {
		outline: 2px solid #34d399;
		outline-offset: 2px;
	}
	.chip-button[aria-disabled="true"] {
		cursor: default;
		background: #334155;
	}
	.chip-dismiss {
		pointer-events: auto;
		border: none;
		background: rgba(15, 23, 42, 0.08);
		color: #0f172a;
		border-radius: 9999px;
		width: 22px;
		height: 22px;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
	}
	.chip-dismiss:focus-visible {
		outline: 2px solid #34d399;
		outline-offset: 2px;
	}
`;

function sendToBackground(message: ContentScriptMessage): void {
	chrome.runtime.sendMessage(message).catch(() => {
		// Background may not be ready to receive (e.g. extension reloading);
		// nothing actionable to do from the page side.
	});
}

/**
 * A small, dismissible, Shadow-DOM-isolated status chip. Only ever injected
 * as part of a user-initiated scan (see background.ts) — never a
 * proactive/background presence.
 */
class ScanChip {
	private host: HTMLElement;
	private shadow: ShadowRoot;
	private button: HTMLButtonElement;
	private onActivate?: () => void;

	constructor() {
		const existing = document.getElementById(CHIP_HOST_ID);
		existing?.remove();

		this.host = document.createElement("div");
		this.host.id = CHIP_HOST_ID;
		this.shadow = this.host.attachShadow({ mode: "closed" });

		const style = document.createElement("style");
		style.textContent = CHIP_STYLES;

		const wrapper = document.createElement("div");
		wrapper.className = "chip-wrapper";

		this.button = document.createElement("button");
		this.button.type = "button";
		this.button.className = "chip-button";

		const dismiss = document.createElement("button");
		dismiss.type = "button";
		dismiss.className = "chip-dismiss";
		dismiss.setAttribute("aria-label", "Dismiss Purchasing Intelligence indicator");
		dismiss.textContent = "×";
		dismiss.addEventListener("click", (event) => {
			event.stopPropagation();
			this.remove();
		});

		this.button.addEventListener("click", () => this.onActivate?.());

		wrapper.append(this.button, dismiss);
		this.shadow.append(style, wrapper);
		document.documentElement.append(this.host);
	}

	setState(state: ChipState, options?: { clickable?: boolean; onClick?: () => void }): void {
		this.button.textContent = CHIP_STATE_TEXT[state];
		const clickable = options?.clickable ?? false;
		this.button.setAttribute("aria-disabled", String(!clickable));
		this.button.tabIndex = clickable ? 0 : -1;
		this.onActivate = clickable ? options?.onClick : undefined;
	}

	remove(): void {
		this.host.remove();
	}
}

function toDetectionReason(status: DetectionStatus): string {
	switch (status) {
		case "not_detected":
			return "This page doesn't look like a cart or checkout page, so there's nothing to scan.";
		case "scan_unavailable":
			return "Scanning isn't available on this page (it may involve login, payment, or account security).";
		default:
			return "Scanning isn't available on this page.";
	}
}

async function runScan(url: URL, chip: ScanChip | undefined): Promise<void> {
	const { platform, detectionStatus, adapter } = detectPage(url, document);

	sendToBackground({ type: "PAGE_DETECTION_RESULT", payload: { platform, detectionStatus } });

	if (detectionStatus === "not_detected" || detectionStatus === "scan_unavailable" || !adapter) {
		chip?.setState("unavailable");
		sendToBackground({ type: "CART_SCAN_FAILED", payload: { reason: toDetectionReason(detectionStatus) } });
		return;
	}

	chip?.setState("scanning");

	let draft: CartSnapshotDraft;
	try {
		draft = await adapter.extract(document, url);
	} catch {
		chip?.setState("unavailable");
		sendToBackground({
			type: "CART_SCAN_FAILED",
			payload: { reason: "Something went wrong reading this page. Nothing was saved." },
		});
		return;
	}

	if (draft.detectionStatus === "scan_unavailable") {
		chip?.setState("unavailable");
		sendToBackground({
			type: "CART_SCAN_FAILED",
			payload: { reason: draft.extractionNotes[0] ?? toDetectionReason("scan_unavailable") },
		});
		return;
	}

	sendToBackground({ type: "CART_SNAPSHOT_EXTRACTED", payload: { draft } });
	chip?.setState("complete", { clickable: true, onClick: () => runScan(url, chip) });
}

function isCurrentPageSensitive(): boolean {
	const bodyExcerpt = (document.body?.textContent ?? "").slice(0, 2000);
	return (
		isSensitivePage(new URL(location.href), `${document.title} ${bodyExcerpt}`) ||
		hasSensitiveInputFields(document)
	);
}

export default defineUnlistedScript(() => {
	const url = new URL(location.href);

	// Never inject the chip — or attempt extraction — on a page that looks
	// like login, payment, MFA, or account-security. This check is
	// deliberately independent of (and runs before) any adapter-level logic.
	if (isCurrentPageSensitive()) {
		sendToBackground({
			type: "PAGE_DETECTION_RESULT",
			payload: { platform: "unknown", detectionStatus: "scan_unavailable" },
		});
		sendToBackground({
			type: "CART_SCAN_FAILED",
			payload: {
				reason: "This page appears to involve login, payment, or account security. Scanning was skipped for safety.",
			},
		});
		return;
	}

	const chip = new ScanChip();
	runScan(url, chip).catch(() => {
		chip.setState("unavailable");
	});
});
