import { Hono } from "hono";
import { apiError, apiSuccess } from "./apiResponse";
import { requireAdmin } from "./auth";
import { csvExportFilename } from "./csv";
import { getOrCreateRequestId, logApiEvent } from "./logging";
import {
	exportProcurementLeadsCsv,
	listProcurementLeads,
	PROCUREMENT_LEAD_STATUSES,
	submitProcurementEarlyAccessLead,
	updateProcurementLeadStatus,
} from "./service";
import type { ProcurementLeadStatus } from "./types";

/** Bounds the request body we'll parse before rejecting as too large. */
const MAX_BODY_BYTES = 20_000;

type ProcurementBindings = {
	DB?: D1Database;
	ADMIN_API_TOKEN?: string;
	LEAD_HASH_SALT?: string;
	LEAD_RATE_LIMIT_MAX_PER_HOUR?: string;
};

const VALID_STATUSES = new Set<string>(PROCUREMENT_LEAD_STATUSES);

function isValidStatus(value: string): value is ProcurementLeadStatus {
	return VALID_STATUSES.has(value);
}

function hasJsonContentType(contentType: string | undefined): boolean {
	return Boolean(contentType?.toLowerCase().includes("application/json"));
}

export const procurementRoutes = new Hono<{ Bindings: ProcurementBindings }>();

// Lead and admin data must never be cached by intermediaries or the browser.
procurementRoutes.use("*", async (c, next) => {
	await next();
	c.header("Cache-Control", "no-store");
});

procurementRoutes.post("/procurement-early-access", async (c) => {
	const requestId = getOrCreateRequestId(c.req.raw);
	const route = "POST /api/procurement-early-access";

	if (!hasJsonContentType(c.req.header("content-type"))) {
		logApiEvent({ requestId, route, status: 400, errorCategory: "invalid_content_type" });
		return c.json(apiError("INVALID_JSON", "Content-Type must be application/json."), 400);
	}

	const contentLength = Number(c.req.header("content-length") ?? "0");
	if (contentLength > MAX_BODY_BYTES) {
		logApiEvent({ requestId, route, status: 413, errorCategory: "payload_too_large" });
		return c.json(apiError("PAYLOAD_TOO_LARGE", "Request body is too large."), 413);
	}

	const rawText = await c.req.text();
	if (rawText.length > MAX_BODY_BYTES) {
		logApiEvent({ requestId, route, status: 413, errorCategory: "payload_too_large" });
		return c.json(apiError("PAYLOAD_TOO_LARGE", "Request body is too large."), 413);
	}

	let parsed: unknown;
	try {
		parsed = rawText.length > 0 ? JSON.parse(rawText) : {};
	} catch {
		logApiEvent({ requestId, route, status: 400, errorCategory: "invalid_json" });
		return c.json(apiError("INVALID_JSON", "Request body must be valid JSON."), 400);
	}

	const ip = c.req.header("cf-connecting-ip") ?? undefined;
	const userAgent = c.req.header("user-agent") ?? undefined;

	let result: Awaited<ReturnType<typeof submitProcurementEarlyAccessLead>>;
	try {
		result = await submitProcurementEarlyAccessLead(c.env, parsed, { ip, userAgent });
	} catch (error) {
		logApiEvent({ requestId, route, status: 500, errorCategory: "internal_error" });
		console.error(
			JSON.stringify({ scope: "procurement_api", requestId, route, errorCategory: "internal_error" }),
		);
		return c.json(apiError("INTERNAL_ERROR", "Something went wrong. Please try again."), 500);
	}

	switch (result.kind) {
		case "validation_error":
			logApiEvent({ requestId, route, status: 400, errorCategory: "validation_error" });
			return c.json(
				apiError("VALIDATION_ERROR", "Please correct the highlighted fields.", result.fields),
				400,
			);
		case "rate_limited": {
			logApiEvent({ requestId, route, status: 429, errorCategory: "rate_limited" });
			return c.json(
				apiError("RATE_LIMITED", "Too many submissions. Please try again later."),
				429,
				{ "Retry-After": String(result.retryAfterSeconds) },
			);
		}
		case "duplicate":
			logApiEvent({ requestId, route, status: 200, errorCategory: "duplicate" });
			return c.json(
				apiSuccess({ message: "You are already on the early-access list." }),
				200,
			);
		case "created":
			logApiEvent({ requestId, route, status: 201, leadId: result.lead.id });
			return c.json(
				apiSuccess({ id: result.lead.id, message: "You're on the early-access list." }),
				201,
			);
	}
});

const adminRoutes = new Hono<{ Bindings: ProcurementBindings }>();

adminRoutes.use("*", async (c, next) => {
	const auth = requireAdmin(c.req.raw, c.env);
	if (!auth.ok) {
		const code = auth.status === 503 ? "SERVICE_UNAVAILABLE" : "UNAUTHORIZED";
		return c.json(apiError(code, auth.message), auth.status);
	}
	await next();
});

adminRoutes.get("/procurement-early-access", async (c) => {
	const requestId = getOrCreateRequestId(c.req.raw);
	const route = "GET /api/admin/procurement-early-access";

	const statusParam = c.req.query("status");
	if (statusParam !== undefined && !isValidStatus(statusParam)) {
		return c.json(
			apiError("VALIDATION_ERROR", "Invalid status filter.", {
				status: [`Must be one of: ${PROCUREMENT_LEAD_STATUSES.join(", ")}`],
			}),
			400,
		);
	}

	const limitParam = Number(c.req.query("limit") ?? "25");
	const limit = Number.isFinite(limitParam)
		? Math.min(Math.max(Math.trunc(limitParam), 1), 100)
		: 25;
	const cursor = c.req.query("cursor") || undefined;

	const result = await listProcurementLeads(c.env, { status: statusParam, limit, cursor });
	logApiEvent({ requestId, route, status: 200 });
	return c.json(apiSuccess(result), 200);
});

adminRoutes.get("/procurement-early-access/export.csv", async (c) => {
	const requestId = getOrCreateRequestId(c.req.raw);
	const csv = await exportProcurementLeadsCsv(c.env);
	logApiEvent({
		requestId,
		route: "GET /api/admin/procurement-early-access/export.csv",
		status: 200,
	});
	return new Response(csv, {
		status: 200,
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${csvExportFilename()}"`,
			"Cache-Control": "no-store",
		},
	});
});

adminRoutes.patch("/procurement-early-access/:id", async (c) => {
	const requestId = getOrCreateRequestId(c.req.raw);
	const route = "PATCH /api/admin/procurement-early-access/:id";

	if (!hasJsonContentType(c.req.header("content-type"))) {
		return c.json(apiError("INVALID_JSON", "Content-Type must be application/json."), 400);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json(apiError("INVALID_JSON", "Request body must be valid JSON."), 400);
	}

	const status = (body as { status?: unknown } | null)?.status;
	if (typeof status !== "string" || !isValidStatus(status)) {
		return c.json(
			apiError("VALIDATION_ERROR", "Invalid status value.", {
				status: [`Must be one of: ${PROCUREMENT_LEAD_STATUSES.join(", ")}`],
			}),
			400,
		);
	}

	const id = c.req.param("id");
	const updated = await updateProcurementLeadStatus(c.env, id, status);
	if (!updated) {
		logApiEvent({ requestId, route, status: 404, errorCategory: "not_found" });
		return c.json(apiError("NOT_FOUND", "Lead not found."), 404);
	}

	logApiEvent({ requestId, route, status: 200, leadId: updated.id });
	return c.json(
		apiSuccess({ id: updated.id, status: updated.status, updatedAt: updated.updatedAt }),
		200,
	);
});

procurementRoutes.route("/admin", adminRoutes);
