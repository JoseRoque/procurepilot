import { validateProcurementEarlyAccessInput } from "~/lib/validation/procurementEarlyAccess";
import { buildProcurementLeadsCsv } from "./csv";
import { InMemoryProcurementLeadRepository } from "./inMemoryRepository";
import { D1ProcurementLeadRepository } from "./d1Repository";
import { NoopLeadNotificationService, type LeadNotificationService } from "./notifications";
import {
	checkRateLimit,
	hashFingerprint,
	pruneRateLimitBuckets,
	resolveHashSalt,
	resolveRateLimitMax,
	__resetRateLimitStateForTests,
} from "./rateLimit";
import {
	PROCUREMENT_LEAD_STATUSES,
	type ProcurementLeadListQuery,
	type ProcurementLeadListResult,
	type ProcurementLeadRepository,
	type ProcurementLeadStatus,
	type StoredProcurementEarlyAccessSubmission,
} from "./types";
import type { ProcurementEarlyAccessFieldErrors } from "~/types/procurement";

const FORM_VERSION = "v1";

export type ProcurementServiceEnv = {
	DB?: D1Database;
	LEAD_HASH_SALT?: string;
	LEAD_RATE_LIMIT_MAX_PER_HOUR?: string;
};

let sharedInMemoryRepository: InMemoryProcurementLeadRepository | undefined;

function getRepository(env: ProcurementServiceEnv): ProcurementLeadRepository {
	if (env.DB) return new D1ProcurementLeadRepository(env.DB);
	if (!sharedInMemoryRepository) {
		console.warn(
			"[procurement] env.DB is not bound; using the in-memory repository. " +
				"Data will be lost on restart and MUST NOT be relied on in production.",
		);
		sharedInMemoryRepository = new InMemoryProcurementLeadRepository();
	}
	return sharedInMemoryRepository;
}

function normalizeEmailKey(email: string): string {
	return email.trim().toLowerCase();
}

export type SubmitLeadResult =
	| { kind: "created"; lead: StoredProcurementEarlyAccessSubmission }
	| { kind: "duplicate" }
	| { kind: "validation_error"; fields: ProcurementEarlyAccessFieldErrors }
	| { kind: "rate_limited"; retryAfterSeconds: number };

export async function submitProcurementEarlyAccessLead(
	env: ProcurementServiceEnv,
	rawInput: unknown,
	requestMeta: { ip?: string; userAgent?: string },
	notifier: LeadNotificationService = new NoopLeadNotificationService(),
): Promise<SubmitLeadResult> {
	const validation = validateProcurementEarlyAccessInput(rawInput);
	if (!validation.success) {
		return { kind: "validation_error", fields: validation.fields };
	}

	const salt = resolveHashSalt(env);
	pruneRateLimitBuckets();
	const fingerprintSource = requestMeta.ip ?? "unknown";
	const fingerprintHash = await hashFingerprint(fingerprintSource, salt);
	const rateLimitMax = resolveRateLimitMax(env);
	const rate = checkRateLimit(fingerprintHash, rateLimitMax);
	if (!rate.allowed) {
		return { kind: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds };
	}

	const repository = getRepository(env);
	const normalizedEmail = normalizeEmailKey(validation.data.workEmail);
	const existing = await repository.findByNormalizedEmail(normalizedEmail);
	if (existing) {
		return { kind: "duplicate" };
	}

	const ipHash = requestMeta.ip ? fingerprintHash : undefined;
	const userAgentHash = requestMeta.userAgent
		? await hashFingerprint(requestMeta.userAgent, salt)
		: undefined;

	const lead = await repository.create({
		submission: validation.data,
		normalizedEmail,
		formVersion: FORM_VERSION,
		ipHash,
		userAgentHash,
	});

	try {
		await notifier.notifyNewLead(lead);
	} catch {
		// Notification is best-effort and must never fail the submission itself.
		console.warn(
			JSON.stringify({ event: "procurement_lead_notify_failed", leadId: lead.id }),
		);
	}

	return { kind: "created", lead };
}

export async function listProcurementLeads(
	env: ProcurementServiceEnv,
	query: ProcurementLeadListQuery,
): Promise<ProcurementLeadListResult> {
	return getRepository(env).list(query);
}

export async function updateProcurementLeadStatus(
	env: ProcurementServiceEnv,
	id: string,
	status: ProcurementLeadStatus,
): Promise<StoredProcurementEarlyAccessSubmission | null> {
	return getRepository(env).updateStatus(id, status);
}

export async function exportProcurementLeadsCsv(
	env: ProcurementServiceEnv,
): Promise<string> {
	const rows = await getRepository(env).listAllForExport();
	return buildProcurementLeadsCsv(rows);
}

export { PROCUREMENT_LEAD_STATUSES };

/** Test-only: resets module-level singletons (in-memory repo, rate-limit buckets). */
export function __resetProcurementServiceStateForTests(): void {
	sharedInMemoryRepository = undefined;
	__resetRateLimitStateForTests();
}
