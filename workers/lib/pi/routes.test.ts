import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIntegrityHash } from "../../../packages/protocol/src/hashing";
import { piRoutes } from "./routes";

/**
 * In-memory D1 stand-in. Only the handful of statements these routes issue
 * are supported; anything unexpected throws loudly rather than silently
 * passing a test.
 */
type Row = Record<string, unknown>;

function createFakeD1() {
	const tables: Record<string, Row[]> = {
		devices: [],
		consent_receipts: [],
		redacted_event_receipts: [],
		configuration_pack_versions: [],
		privacy_deletion_requests: [],
	};

	function run(sql: string, params: unknown[]) {
		const normalized = sql.replace(/\s+/g, " ").trim();

		if (normalized.startsWith("SELECT id, pseudonymous_device_id FROM devices")) {
			const row = tables.devices.find(
				(device) => device.device_token_hash === params[0] && device.deleted_at == null,
			);
			return { first: row ?? null, results: row ? [row] : [] };
		}
		if (normalized.startsWith("SELECT id FROM devices")) {
			const row = tables.devices.find((device) => device.pseudonymous_device_id === params[0]);
			return { first: row ?? null, results: row ? [row] : [] };
		}
		if (normalized.startsWith("UPDATE devices SET device_token_hash")) {
			const device = tables.devices.find((candidate) => candidate.id === params[4]);
			if (device) {
				device.device_token_hash = params[0];
				device.deleted_at = null;
			}
			return { first: null, results: [] };
		}
		if (normalized.startsWith("INSERT INTO devices")) {
			tables.devices.push({
				id: params[0],
				pseudonymous_device_id: params[1],
				device_token_hash: params[2],
				app_version: params[3],
				platform: params[4],
				created_at: params[5],
				last_seen_at: params[6],
				deleted_at: null,
			});
			return { first: null, results: [] };
		}
		if (normalized.startsWith("INSERT OR REPLACE INTO consent_receipts")) {
			const existing = tables.consent_receipts.findIndex((row) => row.id === params[0]);
			const row = {
				id: params[0],
				device_id: params[1],
				privacy_mode: params[2],
				consent_version: params[3],
				granted_at: params[4],
				revoked_at: params[5],
				scope_text: params[6],
			};
			if (existing >= 0) tables.consent_receipts[existing] = row;
			else tables.consent_receipts.push(row);
			return { first: null, results: [] };
		}
		if (normalized.startsWith("SELECT id, revoked_at FROM consent_receipts")) {
			const row = tables.consent_receipts.find(
				(candidate) => candidate.id === params[0] && candidate.device_id === params[1],
			);
			return { first: row ?? null, results: row ? [row] : [] };
		}
		if (normalized.startsWith("INSERT OR IGNORE INTO redacted_event_receipts")) {
			if (!tables.redacted_event_receipts.some((row) => row.event_id === params[1])) {
				tables.redacted_event_receipts.push({ id: params[0], event_id: params[1], device_id: params[2] });
			}
			return { first: null, results: [] };
		}
		if (normalized.startsWith("SELECT pack_id, version, issued_at")) {
			return { first: null, results: tables.configuration_pack_versions };
		}
		if (normalized.startsWith("SELECT pack_json FROM configuration_pack_versions")) {
			const row = tables.configuration_pack_versions.find((candidate) => candidate.id === params[0]);
			return { first: row ?? null, results: [] };
		}
		if (normalized.startsWith("INSERT INTO privacy_deletion_requests")) {
			tables.privacy_deletion_requests.push({ id: params[0], device_id: params[1] });
			return { first: null, results: [] };
		}
		throw new Error(`Unhandled SQL in fake D1: ${normalized}`);
	}

	const db = {
		prepare(sql: string) {
			let bound: unknown[] = [];
			const statement = {
				bind(...params: unknown[]) {
					bound = params;
					return statement;
				},
				async first<T>() {
					return run(sql, bound).first as T | null;
				},
				async all<T>() {
					return { results: run(sql, bound).results as T[] };
				},
				async run() {
					run(sql, bound);
					return { meta: { changes: 1 } };
				},
			};
			return statement;
		},
	} as unknown as D1Database;

	return { db, tables };
}

function buildApp(db?: D1Database) {
	const app = new Hono();
	app.route("/api", piRoutes);
	return {
		request: (path: string, init?: RequestInit) =>
			app.request(`/api${path}`, init, { DB: db } as Record<string, unknown>),
	};
}

async function registerDevice(app: ReturnType<typeof buildApp>, deviceId = "dev-abcdef012345") {
	const response = await app.request("/v1/devices/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			pseudonymousDeviceId: deviceId,
			appVersion: "0.1.0",
			platform: "macos",
		}),
	});
	const body = (await response.json()) as { data: { deviceToken: string } };
	return body.data.deviceToken;
}

async function makeEvent(overrides: Record<string, unknown> = {}) {
	const base = {
		schemaVersion: 1,
		eventId: crypto.randomUUID(),
		pseudonymousDeviceId: "dev-abcdef012345",
		consentReceiptId: "receipt-1",
		consentVersion: "consent-v1",
		contributionMode: "contribute_redacted_outcomes",
		eventType: "adapter_scan_outcome",
		platform: "demo_store",
		adapterId: "demo_store",
		adapterVersion: "demo-1.0.0",
		occurredAt: "2026-08-28T12:00:00.000Z",
		subtotalBucket: "25_35",
		outcome: "observed",
		confidence: "high",
		...overrides,
	};
	return { ...base, eventIntegrityHash: await eventIntegrityHash(base) };
}

async function uploadConsent(app: ReturnType<typeof buildApp>, token: string, revokedAt?: string) {
	return app.request("/v1/consent/receipts", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			receiptId: "receipt-1",
			privacyMode: "contribute_redacted_outcomes",
			consentVersion: "consent-v1",
			grantedAt: "2026-08-28T11:00:00.000Z",
			revokedAt,
			scopeText: "Redacted outcomes only.",
			appVersion: "0.1.0",
		}),
	});
}

describe("Purchasing Intelligence API", () => {
	let fake: ReturnType<typeof createFakeD1>;
	let app: ReturnType<typeof buildApp>;

	beforeEach(() => {
		fake = createFakeD1();
		app = buildApp(fake.db);
	});

	it("returns 503 when D1 is not configured", async () => {
		const unconfigured = buildApp(undefined);
		const response = await unconfigured.request("/v1/config-packs/index");
		expect(response.status).toBe(503);
	});

	it("registers a device and returns a token, storing only its hash", async () => {
		const token = await registerDevice(app);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		const stored = fake.tables.devices[0];
		expect(stored.device_token_hash).not.toBe(token);
		// No email or account identity anywhere on the device row.
		expect(JSON.stringify(stored)).not.toMatch(/@/);
	});

	it("rejects an invalid registration payload", async () => {
		const response = await app.request("/v1/devices/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pseudonymousDeviceId: "short" }),
		});
		expect(response.status).toBe(400);
	});

	it("requires a device token on consent upload", async () => {
		const response = await app.request("/v1/consent/receipts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(401);
	});

	it("rejects an invalid device token", async () => {
		await registerDevice(app);
		const response = await app.request("/v1/consent/receipts", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(401);
	});

	it("accepts a valid redacted event and returns a receipt", async () => {
		const token = await registerDevice(app);
		await uploadConsent(app, token);
		const response = await app.request("/v1/events/redacted", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ events: [await makeEvent()] }),
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as { data: { receipts: unknown[]; rejected: unknown[] } };
		expect(body.data.receipts).toHaveLength(1);
		expect(body.data.rejected).toHaveLength(0);
	});

	it("rejects an event carrying prohibited extra fields", async () => {
		const token = await registerDevice(app);
		await uploadConsent(app, token);
		const polluted = { ...(await makeEvent()), cartLines: ["Organic milk"] };
		const response = await app.request("/v1/events/redacted", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ events: [polluted] }),
		});
		// The batch schema itself rejects unknown keys before any storage.
		expect(response.status).toBe(400);
		expect(fake.tables.redacted_event_receipts).toHaveLength(0);
	});

	it("rejects an event whose consent receipt was revoked", async () => {
		const token = await registerDevice(app);
		await uploadConsent(app, token, "2026-08-28T11:30:00.000Z");
		const response = await app.request("/v1/events/redacted", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ events: [await makeEvent()] }),
		});
		const body = (await response.json()) as { data: { receipts: unknown[]; rejected: unknown[] } };
		expect(body.data.receipts).toHaveLength(0);
		expect(body.data.rejected).toHaveLength(1);
		expect(fake.tables.redacted_event_receipts).toHaveLength(0);
	});

	it("rejects an event claiming a different device id", async () => {
		const token = await registerDevice(app);
		await uploadConsent(app, token);
		const response = await app.request("/v1/events/redacted", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ events: [await makeEvent({ pseudonymousDeviceId: "dev-someoneelse1" })] }),
		});
		const body = (await response.json()) as { data: { rejected: Array<{ reason: string }> } };
		expect(body.data.rejected[0].reason).toMatch(/does not match/i);
	});

	it("queues a deletion request without claiming instant deletion", async () => {
		const token = await registerDevice(app);
		const response = await app.request("/v1/privacy/deletion-request", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(202);
		const body = (await response.json()) as { data: { status: string; message: string } };
		expect(body.data.status).toBe("queued");
		expect(body.data.message).not.toMatch(/immediat|instant/i);
	});

	it("sets Cache-Control: no-store on personal endpoints", async () => {
		const token = await registerDevice(app);
		const response = await app.request("/v1/privacy/deletion-request", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({}),
		});
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("returns 404 for an unknown config pack version", async () => {
		const response = await app.request("/v1/config-packs/nope/1.0.0");
		expect(response.status).toBe(404);
	});

	describe("logging safety", () => {
		let logSpy: ReturnType<typeof vi.spyOn>;
		beforeEach(() => {
			logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		});
		afterEach(() => logSpy.mockRestore());

		it("never logs raw tokens or event payloads", async () => {
			const token = await registerDevice(app);
			await uploadConsent(app, token);
			await app.request("/v1/events/redacted", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ events: [await makeEvent()] }),
			});
			const logged = logSpy.mock.calls.flat().map(String).join("\n");
			expect(logged).not.toContain(token);
			expect(logged).not.toContain("dev-abcdef012345");
			expect(logged).not.toContain("receipt-1");
		});
	});
});
