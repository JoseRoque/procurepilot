import { Hono } from "hono";
import {
	consentReceiptUploadSchema,
	deletionRequestSchema,
	deviceRegisterRequestSchema,
	redactedEventUploadSchema,
	validateRedactedEvent,
} from "../../../packages/protocol/src";
import { generateDeviceToken, requireDevice, sha256Hex } from "./deviceAuth";

/**
 * Purchasing Intelligence API v1.
 *
 * Scope is deliberately tiny: device registration, consent receipts, redacted
 * test-event receipts, signed config-pack distribution, and deletion requests.
 * There is no login, no dashboard, no raw cart storage, and no aggregation —
 * with one user there is no valid collective insight to compute or publish.
 */

const MAX_BODY_BYTES = 64_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

type PiBindings = {
	DB?: D1Database;
	CONFIG_PACK_PUBLIC_KEY?: string;
};

/**
 * Best-effort, single-isolate rate limit. Cloudflare may route requests
 * across isolates, so this is a speed bump, not a durable guarantee — a
 * Durable Object or atomic KV counter is the real fix and is deferred
 * (documented in docs/architecture/overview.md).
 */
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function rateLimited(key: string, now = Date.now()): boolean {
	const bucket = rateBuckets.get(key);
	if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
		rateBuckets.set(key, { count: 1, windowStart: now });
		return false;
	}
	if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) return true;
	bucket.count += 1;
	return false;
}

function nowIso(): string {
	return new Date().toISOString();
}

function apiError(code: string, message: string) {
	return { ok: false as const, error: { code, message } };
}

export const piRoutes = new Hono<{ Bindings: PiBindings }>();

// Personal/device/consent data is never cacheable.
piRoutes.use("*", async (c, next) => {
	const fingerprint = c.req.header("cf-connecting-ip") ?? "local";
	if (rateLimited(`${fingerprint}:${new URL(c.req.url).pathname}`)) {
		return c.json(apiError("RATE_LIMITED", "Too many requests. Try again shortly."), 429);
	}
	await next();
	c.header("Cache-Control", "no-store");
});

async function readJson(c: {
	req: { header: (name: string) => string | undefined; text: () => Promise<string> };
}): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
	if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
		return { ok: false, code: "INVALID_JSON", message: "Content-Type must be application/json." };
	}
	const text = await c.req.text();
	if (text.length > MAX_BODY_BYTES) {
		return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." };
	}
	try {
		return { ok: true, value: text.length > 0 ? JSON.parse(text) : {} };
	} catch {
		return { ok: false, code: "INVALID_JSON", message: "Request body must be valid JSON." };
	}
}

/**
 * Guards every route that needs D1. Returns a typed result rather than
 * throwing, so a missing binding is a clean 503 instead of an unhandled
 * error surfacing as a 500.
 */
function requireDb(
	db: D1Database | undefined,
): { ok: true; db: D1Database } | { ok: false } {
	return db ? { ok: true, db } : { ok: false };
}

const DB_UNAVAILABLE = apiError(
	"SERVICE_UNAVAILABLE",
	"The API database (D1) is not configured on this environment.",
);

// ------------------------------------------------------ device registration

piRoutes.post("/v1/devices/register", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const body = await readJson(c);
	if (!body.ok) return c.json(apiError(body.code, body.message), 400);

	const parsed = deviceRegisterRequestSchema.safeParse(body.value);
	if (!parsed.success) {
		return c.json(apiError("VALIDATION_ERROR", "Invalid device registration payload."), 400);
	}

	const token = generateDeviceToken();
	const tokenHash = await sha256Hex(token);
	const timestamp = nowIso();

	const existing = await db
		.prepare("SELECT id FROM devices WHERE pseudonymous_device_id = ? LIMIT 1")
		.bind(parsed.data.pseudonymousDeviceId)
		.first<{ id: string }>();

	// Re-registration rotates the token rather than creating a duplicate device.
	const deviceId = existing?.id ?? crypto.randomUUID();
	if (existing) {
		await db
			.prepare(
				"UPDATE devices SET device_token_hash = ?, app_version = ?, platform = ?, last_seen_at = ?, deleted_at = NULL WHERE id = ?",
			)
			.bind(tokenHash, parsed.data.appVersion, parsed.data.platform, timestamp, deviceId)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO devices (id, pseudonymous_device_id, device_token_hash, app_version, platform, created_at, last_seen_at)
				 VALUES (?,?,?,?,?,?,?)`,
			)
			.bind(
				deviceId,
				parsed.data.pseudonymousDeviceId,
				tokenHash,
				parsed.data.appVersion,
				parsed.data.platform,
				timestamp,
				timestamp,
			)
			.run();
	}

	console.log(JSON.stringify({ scope: "pi_api", route: "devices/register", status: 201 }));
	return c.json({ ok: true, data: { deviceId, deviceToken: token, issuedAt: timestamp } }, 201);
});

// ---------------------------------------------------------- consent receipts

piRoutes.post("/v1/consent/receipts", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const auth = await requireDevice(c.req.raw, db);
	if (!auth.ok) return c.json(apiError("UNAUTHORIZED", auth.message), auth.status);

	const body = await readJson(c);
	if (!body.ok) return c.json(apiError(body.code, body.message), 400);
	const parsed = consentReceiptUploadSchema.safeParse(body.value);
	if (!parsed.success) {
		return c.json(apiError("VALIDATION_ERROR", "Invalid consent receipt payload."), 400);
	}

	await db
		.prepare(
			`INSERT OR REPLACE INTO consent_receipts
			 (id, device_id, privacy_mode, consent_version, granted_at, revoked_at, scope_text, app_version, extension_version, received_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		)
		.bind(
			parsed.data.receiptId,
			auth.device.id,
			parsed.data.privacyMode,
			parsed.data.consentVersion,
			parsed.data.grantedAt,
			parsed.data.revokedAt ?? null,
			parsed.data.scopeText,
			parsed.data.appVersion,
			parsed.data.extensionVersion ?? null,
			nowIso(),
		)
		.run();

	console.log(JSON.stringify({ scope: "pi_api", route: "consent/receipts", status: 201 }));
	return c.json({ ok: true, data: { receiptId: parsed.data.receiptId } }, 201);
});

// --------------------------------------------------------- redacted events

piRoutes.post("/v1/events/redacted", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const auth = await requireDevice(c.req.raw, db);
	if (!auth.ok) return c.json(apiError("UNAUTHORIZED", auth.message), auth.status);

	const body = await readJson(c);
	if (!body.ok) return c.json(apiError(body.code, body.message), 400);
	const parsed = redactedEventUploadSchema.safeParse(body.value);
	if (!parsed.success) {
		return c.json(apiError("VALIDATION_ERROR", "Invalid redacted event batch."), 400);
	}

	const receipts: Array<{ eventId: string; receiptId: string }> = [];
	const rejected: Array<{ eventId: string; reason: string }> = [];

	for (const event of parsed.data.events) {
		// Re-run the full redaction allowlist server-side; never trust the client.
		const validation = validateRedactedEvent(event);
		if (!validation.ok) {
			rejected.push({ eventId: event.eventId, reason: validation.reason });
			continue;
		}
		if (event.pseudonymousDeviceId !== auth.device.pseudonymousDeviceId) {
			rejected.push({ eventId: event.eventId, reason: "Device id does not match the caller." });
			continue;
		}
		// The consent receipt must exist for this device and be unrevoked.
		const consent = await db
			.prepare(
				"SELECT id, revoked_at FROM consent_receipts WHERE id = ? AND device_id = ? LIMIT 1",
			)
			.bind(event.consentReceiptId, auth.device.id)
			.first<{ id: string; revoked_at: string | null }>();
		if (!consent || consent.revoked_at) {
			rejected.push({
				eventId: event.eventId,
				reason: "No active consent receipt is registered for this event.",
			});
			continue;
		}

		const receiptId = crypto.randomUUID();
		await db
			.prepare(
				`INSERT OR IGNORE INTO redacted_event_receipts
				 (id, event_id, device_id, consent_receipt_id, event_type, platform, adapter_id, adapter_version,
				  outcome, confidence, subtotal_bucket, offer_type, config_pack_version, occurred_at, received_at, event_integrity_hash)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			)
			.bind(
				receiptId,
				event.eventId,
				auth.device.id,
				event.consentReceiptId,
				event.eventType,
				event.platform,
				event.adapterId,
				event.adapterVersion,
				event.outcome,
				event.confidence,
				event.subtotalBucket ?? null,
				event.offerType ?? null,
				event.configPackVersion ?? null,
				event.occurredAt,
				nowIso(),
				event.eventIntegrityHash,
			)
			.run();
		receipts.push({ eventId: event.eventId, receiptId });
	}

	// Log counts only — never event contents.
	console.log(
		JSON.stringify({
			scope: "pi_api",
			route: "events/redacted",
			status: 201,
			accepted: receipts.length,
			rejected: rejected.length,
		}),
	);
	return c.json({ ok: true, data: { receipts, rejected } }, 201);
});

// ------------------------------------------------------------- config packs

piRoutes.get("/v1/config-packs/index", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const { results } = await db
		.prepare(
			`SELECT pack_id, version, issued_at, expires_at, rollout_stage,
			        minimum_extension_version, minimum_sidecar_version, changelog_summary
			 FROM configuration_pack_versions
			 WHERE rollout_stage != 'disabled'
			 ORDER BY issued_at DESC LIMIT 50`,
		)
		.all<{
			pack_id: string;
			version: string;
			issued_at: string;
			expires_at: string | null;
			rollout_stage: string;
			minimum_extension_version: string | null;
			minimum_sidecar_version: string | null;
			changelog_summary: string | null;
		}>();

	return c.json({
		ok: true,
		data: {
			packs: results.map((row) => ({
				packId: row.pack_id,
				version: row.version,
				issuedAt: row.issued_at,
				expiresAt: row.expires_at ?? undefined,
				rolloutStage: row.rollout_stage,
				minimumExtensionVersion: row.minimum_extension_version ?? undefined,
				minimumSidecarVersion: row.minimum_sidecar_version ?? undefined,
				changelogSummary: row.changelog_summary ?? undefined,
			})),
		},
	});
});

piRoutes.get("/v1/config-packs/:packId/:version", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const row = await db
		.prepare("SELECT pack_json FROM configuration_pack_versions WHERE id = ? LIMIT 1")
		.bind(`${c.req.param("packId")}@${c.req.param("version")}`)
		.first<{ pack_json: string }>();
	if (!row) {
		return c.json(apiError("NOT_FOUND", "No such configuration pack version."), 404);
	}
	// The pack is a signed public artifact; the client verifies the signature
	// before use, so serving it does not require authentication.
	return c.json({ ok: true, data: { pack: JSON.parse(row.pack_json) } });
});

// -------------------------------------------------------- deletion requests

piRoutes.post("/v1/privacy/deletion-request", async (c) => {
	const dbResult = requireDb(c.env.DB);
	if (!dbResult.ok) return c.json(DB_UNAVAILABLE, 503);
	const db = dbResult.db;
	const auth = await requireDevice(c.req.raw, db);
	if (!auth.ok) return c.json(apiError("UNAUTHORIZED", auth.message), auth.status);

	const body = await readJson(c);
	if (!body.ok) return c.json(apiError(body.code, body.message), 400);
	const parsed = deletionRequestSchema.safeParse(body.value);
	if (!parsed.success) {
		return c.json(apiError("VALIDATION_ERROR", "Invalid deletion request payload."), 400);
	}

	const requestId = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO privacy_deletion_requests (id, device_id, pseudonymous_device_id, reason, status, requested_at)
			 VALUES (?,?,?,?, 'queued', ?)`,
		)
		.bind(
			requestId,
			auth.device.id,
			auth.device.pseudonymousDeviceId,
			parsed.data.reason ?? null,
			nowIso(),
		)
		.run();

	console.log(JSON.stringify({ scope: "pi_api", route: "privacy/deletion-request", status: 202 }));
	return c.json(
		{
			ok: true,
			data: {
				requestId,
				status: "queued",
				message:
					"Deletion request queued. Stored event receipts and device metadata for this device will be removed. Aggregate statistics are not implemented in this alpha, so there is no derived data to address.",
			},
		},
		202,
	);
});
