import initSqlJs, { type Database } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { approvalScopeHash } from "../../../packages/protocol/src/hashing";
import { completeFixtureSnapshot, belowThresholdDraft } from "../../../packages/test-fixtures/src";
import { DEFAULT_PREFERENCES } from "../../../packages/domain/src";
import type { Db, FieldCrypto } from "./db";
import { BridgeError, SidecarCore } from "./services";

/**
 * Runs the real sidecar core against a real SQLite engine (sql.js) using the
 * real migration file — so schema constraints, repositories, consent gating,
 * the approval state machine, and the hash-chained ledger are all exercised
 * exactly as they run in the app.
 */

const MIGRATION = readFileSync(
	join(__dirname, "../../src-tauri/migrations/0001_init.sql"),
	"utf8",
);

function createDb(sqlite: Database): Db {
	return {
		async query(sql, params = []) {
			const stmt = sqlite.prepare(sql);
			stmt.bind(params as never[]);
			const rows: Record<string, unknown>[] = [];
			while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
			stmt.free();
			return rows;
		},
		async execute(sql, params = []) {
			sqlite.run(sql, params as never[]);
			return { changes: sqlite.getRowsModified(), lastInsertRowid: 0 };
		},
	};
}

/** Mirrors the Rust "plain:" fallback path (keychain unavailable). */
const passthroughCrypto: FieldCrypto = {
	async encrypt(plain) {
		return `plain:${plain}`;
	},
	async decrypt(value) {
		return value.startsWith("plain:") ? value.slice(6) : value;
	},
};

async function makeCore(): Promise<{ core: SidecarCore; sqlite: Database }> {
	const SQL = await initSqlJs();
	const sqlite = new SQL.Database();
	sqlite.run(MIGRATION);
	sqlite.run(
		`INSERT INTO local_profile (id, pseudonymous_device_id, pairing_token, schema_version, app_version, preferences_json, created_at, updated_at)
		 VALUES ('profile','dev-test12345678','token',1,'0.1.0','{}','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')`,
	);
	const core = new SidecarCore(createDb(sqlite), passthroughCrypto, {
		appVersion: "0.1.0",
		apiBaseUrl: "http://localhost:8787",
		configPackPublicKeyHex: "00",
		configPackKeyId: "test",
	});
	return { core, sqlite };
}

const snapshot = completeFixtureSnapshot(belowThresholdDraft, "snap-1");

describe("sidecar core", () => {
	let core: SidecarCore;
	let sqlite: Database;

	beforeEach(async () => {
		({ core, sqlite } = await makeCore());
	});

	describe("snapshots and plans", () => {
		it("persists a snapshot and creates an explainable plan", async () => {
			await core.saveSnapshot(snapshot);
			const plan = await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			expect(plan.sourceSnapshotId).toBe("snap-1");
			expect(plan.observedCost.displayedFinalTotalCents).toBe(3988);
			expect(plan.recommendations.length).toBeGreaterThan(0);
			expect(plan.recommendations.every((r) => r.nextSafeUserAction.length > 0)).toBe(true);
		});

		it("enforces the schema's raw-HTML/cookie attestation columns", () => {
			expect(() =>
				sqlite.run(
					`INSERT INTO cart_snapshots (id, created_at, platform, platform_label, page_url_origin, items_json, confidence, extraction_notes_json, privacy_mode, raw_html_stored)
					 VALUES ('x','t','generic','G','o','[]','high','[]','local_only', 1)`,
				),
			).toThrow(/CHECK constraint/i);
		});
	});

	describe("consent gating", () => {
		const event = {
			schemaVersion: 1 as const,
			eventId: "3f1f2a44-9e1b-4c5a-8f5e-2b7c9d0e1a2b",
			pseudonymousDeviceId: "placeholder",
			consentReceiptId: "placeholder",
			consentVersion: "consent-v1",
			contributionMode: "contribute_redacted_outcomes" as const,
			eventType: "adapter_scan_outcome" as const,
			platform: "demo_store" as const,
			adapterId: "demo_store",
			adapterVersion: "demo-1.0.0",
			occurredAt: "2026-08-28T12:00:00.000Z",
			outcome: "observed" as const,
			confidence: "high" as const,
			eventIntegrityHash: "0".repeat(64),
		};

		it("refuses to queue a redacted event in local-only mode", async () => {
			await expect(core.queueRedactedEvent(event)).rejects.toThrow(/disabled/i);
		});

		it("queues after explicit opt-in, stamping identity fields itself", async () => {
			await core.setPrivacyMode("contribute_redacted_outcomes");
			const queued = await core.queueRedactedEvent(event);
			expect(queued).toBe(1);
			const rows = await core.db.query("SELECT event_json FROM sync_outbox");
			const stored = JSON.parse(rows[0].event_json as string);
			// The sidecar overwrites client-supplied identity with the real values.
			expect(stored.pseudonymousDeviceId).toBe("dev-test12345678");
			expect(stored.consentReceiptId).not.toBe("placeholder");
			expect(stored.eventIntegrityHash).not.toBe("0".repeat(64));
		});

		it("blocks new queueing immediately after revocation", async () => {
			await core.setPrivacyMode("contribute_redacted_outcomes");
			await core.queueRedactedEvent(event);
			await core.setPrivacyMode("local_only");
			await expect(core.queueRedactedEvent(event)).rejects.toThrow(/disabled/i);
			const rows = await core.db.query("SELECT COUNT(*) AS n FROM sync_outbox");
			expect(rows[0].n).toBe(1); // the pre-revocation event is untouched
		});
	});

	describe("action approval", () => {
		async function proposeAction() {
			await core.saveSnapshot(snapshot);
			const plan = await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			const action = await core.proposeAction({
				planId: plan.id,
				actionType: "search_exact_item",
				actionPayload: { itemName: "Fixture dark chocolate bar" },
				currentPageStateHash: "hash-1",
				pageOrigin: "https://demo-store.fixture.local",
				adapterId: "demo_store",
				adapterVersion: "demo-1.0.0",
			});
			return { plan, action };
		}

		it("rejects an action payload containing fields outside its allowlist", async () => {
			await core.saveSnapshot(snapshot);
			const plan = await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			await expect(
				core.proposeAction({
					planId: plan.id,
					actionType: "search_exact_item",
					actionPayload: { itemName: "ok", checkout: true },
					currentPageStateHash: "hash-1",
					pageOrigin: "https://demo-store.fixture.local",
					adapterId: "demo_store",
				}),
			).rejects.toThrow(BridgeError);
		});

		it("refuses to record a result without an approval", async () => {
			const { action } = await proposeAction();
			await expect(
				core.recordActionResult({
					actionId: action.id,
					outcome: "succeeded",
					resultSummary: "did the thing",
				}),
			).rejects.toThrow(/no approval is recorded/i);
		});

		it("rejects an approval whose scope hash does not match the action", async () => {
			const { action } = await proposeAction();
			await expect(
				core.recordApproval({
					actionId: action.id,
					approved: true,
					approvalScopeHash: "not-the-right-hash",
				}),
			).rejects.toThrow(/scope/i);
		});

		it("accepts a correctly scoped approval and then a result", async () => {
			const { action } = await proposeAction();
			const scope = await approvalScopeHash({
				actionId: action.id,
				actionType: action.actionType,
				payload: action.payload,
				pageOrigin: action.pageOrigin,
				pageStateHash: action.expectedPageStateHash,
			});
			const outcome = await core.recordApproval({
				actionId: action.id,
				approved: true,
				approvalScopeHash: scope,
			});
			expect(outcome.approved).toBe(true);
			expect(outcome.expiresAt).toBeDefined();

			await core.recordActionResult({
				actionId: action.id,
				outcome: "succeeded",
				resultSummary: "Searched for the item.",
			});
			const stored = await core.actions.get(action.id);
			expect(stored?.status).toBe("succeeded");
		});

		it("routes a stopped action back to needs_review on the plan", async () => {
			const { plan, action } = await proposeAction();
			const scope = await approvalScopeHash({
				actionId: action.id,
				actionType: action.actionType,
				payload: action.payload,
				pageOrigin: action.pageOrigin,
				pageStateHash: action.expectedPageStateHash,
			});
			await core.recordApproval({ actionId: action.id, approved: true, approvalScopeHash: scope });
			await core.recordActionResult({
				actionId: action.id,
				outcome: "stopped_for_review",
				resultSummary: "Stopped.",
				stopReason: "Page state changed.",
			});
			const refreshed = await core.plans.get(plan.id);
			expect(refreshed?.status).toBe("needs_review");
		});

		it("enforces the plan action budget", async () => {
			await core.saveSnapshot(snapshot);
			const plan = await core.createPlan("snap-1", { ...DEFAULT_PREFERENCES, maxActionsPerPlan: 0 });
			await expect(
				core.proposeAction({
					planId: plan.id,
					actionType: "rescan_cart",
					actionPayload: {},
					currentPageStateHash: "hash-1",
					pageOrigin: "https://demo-store.fixture.local",
					adapterId: "demo_store",
				}),
			).rejects.toThrow(/budget/i);
		});
	});

	describe("audit ledger", () => {
		it("chains events and verifies clean", async () => {
			await core.saveSnapshot(snapshot);
			await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			const verification = await core.ledger.verify();
			expect(verification.valid).toBe(true);
			if (verification.valid) expect(verification.entries).toBeGreaterThanOrEqual(2);
		});

		it("detects tampering with a stored payload", async () => {
			await core.saveSnapshot(snapshot);
			await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			sqlite.run("UPDATE local_events SET payload_json = '{\"tampered\":true}' WHERE seq = 1");
			const verification = await core.ledger.verify();
			expect(verification.valid).toBe(false);
			if (!verification.valid) expect(verification.firstInvalidSeq).toBe(1);
		});

		it("detects a broken previous-hash link", async () => {
			await core.saveSnapshot(snapshot);
			await core.createPlan("snap-1", DEFAULT_PREFERENCES);
			sqlite.run(`UPDATE local_events SET previous_hash = '${"0".repeat(64)}' WHERE seq = 2`);
			const verification = await core.ledger.verify();
			expect(verification.valid).toBe(false);
		});
	});
});
