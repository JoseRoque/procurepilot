import { signConfigurationPack } from "../../../packages/config-kit/src";
import {
	buildDevConfigPack,
	DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
} from "../../../packages/test-fixtures/src";
import type { SyncStatus } from "../../../packages/protocol/src";
import { writeExport } from "./db";
import type { SidecarCore } from "./services";

/**
 * Explicit, user-initiated Cloudflare interactions. Nothing here runs on a
 * timer — every network call is a button press in the UI, and telemetry
 * export additionally requires the contribute_redacted_outcomes consent.
 */
export class SyncService {
	constructor(private readonly core: SidecarCore) {}

	private get apiBase(): string {
		return this.core.config.apiBaseUrl.replace(/\/$/, "");
	}

	async status(): Promise<SyncStatus> {
		const profile = await this.core.profile.get();
		return {
			privacyMode: await this.core.privacyMode(),
			queuedEvents: await this.core.outbox.queuedCount(),
			syncedEvents: await this.core.outbox.syncedCount(),
			lastSyncedAt: await this.core.outbox.lastSyncedAt(),
			deviceRegistered: Boolean(profile.deviceToken),
		};
	}

	/** Registers the pseudonymous device and stores the device-scoped token. */
	async registerDevice(): Promise<void> {
		const profile = await this.core.profile.get();
		const response = await fetch(`${this.apiBase}/api/v1/devices/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pseudonymousDeviceId: profile.pseudonymousDeviceId,
				appVersion: this.core.config.appVersion,
				platform: platformName(),
			}),
		});
		const body = (await response.json()) as {
			ok: boolean;
			data?: { deviceToken: string };
			error?: { message: string };
		};
		if (!response.ok || !body.ok || !body.data) {
			throw new Error(body.error?.message ?? `Device registration failed (${response.status}).`);
		}
		await this.core.profile.setDeviceToken(body.data.deviceToken);
		await this.core.ledger.append("device_registered", "device", profile.pseudonymousDeviceId, {});
	}

	/** Uploads the active consent receipt (required before event upload). */
	async uploadConsentReceipt(): Promise<void> {
		const receipt = await this.core.consent.active();
		if (!receipt) throw new Error("No active consent receipt.");
		const profile = await this.core.profile.get();
		if (!profile.deviceToken) throw new Error("Register the device first.");
		const response = await fetch(`${this.apiBase}/api/v1/consent/receipts`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${profile.deviceToken}`,
			},
			body: JSON.stringify({
				receiptId: receipt.id,
				privacyMode: receipt.privacyMode,
				consentVersion: receipt.consentVersion,
				grantedAt: receipt.grantedAt,
				revokedAt: receipt.revokedAt,
				scopeText: receipt.scopeText,
				appVersion: receipt.appVersion,
				extensionVersion: receipt.extensionVersion,
			}),
		});
		if (!response.ok) {
			const body = (await response.json().catch(() => undefined)) as
				| { error?: { message: string } }
				| undefined;
			throw new Error(body?.error?.message ?? `Consent upload failed (${response.status}).`);
		}
	}

	/** Flushes queued redacted events. Consent is re-checked at flush time. */
	async flushOutbox(): Promise<{ synced: number; rejected: number }> {
		const mode = await this.core.privacyMode();
		if (mode !== "contribute_redacted_outcomes") {
			throw new Error("Redacted contribution is disabled; nothing will be uploaded.");
		}
		const profile = await this.core.profile.get();
		if (!profile.deviceToken) throw new Error("Register the device first.");

		const queued = await this.core.outbox.takeQueued(20);
		if (queued.length === 0) return { synced: 0, rejected: 0 };

		const events = queued.map((entry) => JSON.parse(entry.eventJson));
		const response = await fetch(`${this.apiBase}/api/v1/events/redacted`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${profile.deviceToken}`,
			},
			body: JSON.stringify({ events }),
		});
		const body = (await response.json()) as {
			ok: boolean;
			data?: { receipts: Array<{ eventId: string; receiptId: string }> };
			error?: { message: string };
		};
		if (!response.ok || !body.ok || !body.data) {
			throw new Error(body.error?.message ?? `Event upload failed (${response.status}).`);
		}
		let synced = 0;
		let rejected = 0;
		for (const entry of queued) {
			const event = JSON.parse(entry.eventJson) as { eventId: string };
			const receipt = body.data.receipts.find((r) => r.eventId === event.eventId);
			if (receipt) {
				await this.core.outbox.markSynced(entry.id, receipt.receiptId);
				synced++;
			} else {
				await this.core.outbox.markRejected(entry.id);
				rejected++;
			}
		}
		await this.core.ledger.append("outbox_flushed", "sync_outbox", "flush", { synced, rejected });
		return { synced, rejected };
	}

	/** User-initiated config pack update check against the Cloudflare index. */
	async checkForConfigPacks(): Promise<string> {
		const response = await fetch(`${this.apiBase}/api/v1/config-packs/index`);
		if (!response.ok) throw new Error(`Config pack index unavailable (${response.status}).`);
		const body = (await response.json()) as {
			ok: boolean;
			data?: { packs: Array<{ packId: string; version: string }> };
		};
		if (!body.ok || !body.data || body.data.packs.length === 0) {
			return "No configuration packs are published.";
		}
		const results: string[] = [];
		for (const entry of body.data.packs) {
			const packResponse = await fetch(
				`${this.apiBase}/api/v1/config-packs/${encodeURIComponent(entry.packId)}/${encodeURIComponent(entry.version)}`,
			);
			if (!packResponse.ok) {
				results.push(`${entry.packId}@${entry.version}: download failed`);
				continue;
			}
			const packBody = (await packResponse.json()) as { ok: boolean; data?: { pack: unknown } };
			const outcome = await this.core.verifyAndStorePack(packBody.data?.pack);
			results.push(
				`${entry.packId}@${entry.version}: ${outcome.active ? "verified and active" : `not active (${outcome.reason ?? "unverified"})`}`,
			);
		}
		return results.join("; ");
	}

	/** Loads the clearly-labeled local development pack (no network). */
	async loadLocalDevPack(): Promise<string> {
		const pack = await signConfigurationPack(buildDevConfigPack(), DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX);
		const outcome = await this.core.verifyAndStorePack(pack);
		return outcome.active
			? `Loaded local dev pack ${pack.packId}@${pack.version} (NON-PRODUCTION signing key).`
			: `Dev pack stored but inactive: ${outcome.reason}`;
	}

	/** Submits a cloud deletion request for this device's stored metadata/events. */
	async requestCloudDeletion(): Promise<string> {
		const profile = await this.core.profile.get();
		if (!profile.deviceToken) throw new Error("This device was never registered; nothing to delete.");
		const response = await fetch(`${this.apiBase}/api/v1/privacy/deletion-request`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${profile.deviceToken}`,
			},
			body: JSON.stringify({}),
		});
		const body = (await response.json()) as { ok: boolean; data?: { requestId: string } };
		if (!response.ok || !body.ok) throw new Error(`Deletion request failed (${response.status}).`);
		await this.core.ledger.append("cloud_deletion_requested", "device", profile.pseudonymousDeviceId, {
			requestId: body.data?.requestId ?? null,
		});
		return "Deletion request queued. Stored event records and device metadata will be removed by the operator; this is not instantaneous.";
	}
}

function platformName(): "macos" | "windows" | "linux" {
	const ua = navigator.userAgent.toLowerCase();
	if (ua.includes("mac")) return "macos";
	if (ua.includes("win")) return "windows";
	return "linux";
}

// ------------------------------------------------------------ export/delete

export class ExportService {
	constructor(private readonly core: SidecarCore) {}

	async exportAll(): Promise<string> {
		const payload = {
			exportedAt: new Date().toISOString(),
			warning:
				"This export contains sensitive local purchasing information. It was written locally and has not been uploaded anywhere.",
			profile: await this.core.profile.get(),
			shoppingItems: await this.core.items.list(),
			snapshots: await this.core.snapshots.list(50),
			plans: await this.core.plans.list(100),
			ledger: await this.core.ledger.list(1000),
			consentReceipts: await this.core.consent.listAll(),
			configPacks: await this.core.packs.summaries(),
		};
		const path = await writeExport(JSON.stringify(payload, null, 2));
		await this.core.ledger.append("data_exported", "local_profile", "profile", { path });
		return path;
	}

	async clearSnapshots(): Promise<void> {
		await this.core.db.execute("DELETE FROM visible_offers");
		await this.core.db.execute("DELETE FROM cart_snapshots");
		await this.core.ledger.append("data_cleared", "cart_snapshot", "all", {});
	}

	async clearPlans(): Promise<void> {
		await this.core.db.execute("DELETE FROM action_results");
		await this.core.db.execute("DELETE FROM action_approvals");
		await this.core.db.execute("DELETE FROM plan_actions");
		await this.core.db.execute("DELETE FROM purchase_plan_items");
		await this.core.db.execute("DELETE FROM purchase_plans");
		await this.core.ledger.append("data_cleared", "purchase_plan", "all", {});
	}

	async clearLedger(): Promise<void> {
		await this.core.db.execute("DELETE FROM local_events");
	}

	/** Full wipe per docs/runbooks/local-data-deletion.md. */
	async clearAllPrivateData(): Promise<void> {
		await this.clearPlans();
		await this.clearSnapshots();
		await this.core.db.execute("DELETE FROM item_preferences");
		await this.core.db.execute("DELETE FROM shopping_items");
		await this.core.db.execute("DELETE FROM merchant_profiles");
		await this.core.db.execute("DELETE FROM sync_outbox");
		await this.clearLedger();
		// Retained by design: local_profile install metadata, the active consent
		// receipt, and signed public config packs (see runbook).
	}
}
