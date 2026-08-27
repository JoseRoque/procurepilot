import type { CompanySize } from "~/types/procurement";
import { decodeCursor, encodeCursor } from "./cursor";
import {
	toLeadListItem,
	type CreateProcurementLeadInput,
	type ProcurementLeadListQuery,
	type ProcurementLeadListResult,
	type ProcurementLeadRepository,
	type ProcurementLeadStatus,
	type StoredProcurementEarlyAccessSubmission,
} from "./types";

type ProcurementLeadRow = {
	id: string;
	work_email: string;
	work_email_normalized: string;
	full_name: string;
	company_name: string;
	job_title: string;
	company_size: string;
	annual_addressable_spend: string | null;
	procurement_maturity: string | null;
	primary_categories_json: string | null;
	purchasing_channels_json: string | null;
	biggest_challenge: string;
	current_systems: string | null;
	browser_extension_interest: number;
	pilot_interest: number;
	notes: string | null;
	status: string;
	source: string;
	form_version: string;
	ip_hash: string | null;
	user_agent_hash: string | null;
	created_at: string;
	updated_at: string;
};

function fromRow(row: ProcurementLeadRow): StoredProcurementEarlyAccessSubmission {
	return {
		workEmail: row.work_email,
		fullName: row.full_name,
		companyName: row.company_name,
		jobTitle: row.job_title,
		companySize: row.company_size as CompanySize,
		annualAddressableSpend: row.annual_addressable_spend ?? undefined,
		procurementMaturity: row.procurement_maturity ?? undefined,
		primaryCategories: row.primary_categories_json
			? JSON.parse(row.primary_categories_json)
			: undefined,
		purchasingChannels: row.purchasing_channels_json
			? JSON.parse(row.purchasing_channels_json)
			: undefined,
		biggestChallenge: row.biggest_challenge,
		currentSystems: row.current_systems ?? undefined,
		browserExtensionInterest: Boolean(row.browser_extension_interest),
		pilotInterest: Boolean(row.pilot_interest),
		notes: row.notes ?? undefined,
		id: row.id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		status: row.status as ProcurementLeadStatus,
		source: "procurement_landing_page",
		formVersion: row.form_version,
		ipHash: row.ip_hash ?? undefined,
		userAgentHash: row.user_agent_hash ?? undefined,
	};
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/** D1-backed repository. Used whenever `env.DB` is bound. */
export class D1ProcurementLeadRepository implements ProcurementLeadRepository {
	constructor(private readonly db: D1Database) {}

	async findByNormalizedEmail(normalizedEmail: string) {
		const row = await this.db
			.prepare(
				"SELECT * FROM procurement_early_access_submissions WHERE work_email_normalized = ? LIMIT 1",
			)
			.bind(normalizedEmail)
			.first<ProcurementLeadRow>();
		return row ? fromRow(row) : null;
	}

	async create(
		input: CreateProcurementLeadInput,
	): Promise<StoredProcurementEarlyAccessSubmission> {
		const { submission } = input;
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		try {
			await this.db
				.prepare(
					`INSERT INTO procurement_early_access_submissions (
						id, work_email, work_email_normalized, full_name, company_name, job_title, company_size,
						annual_addressable_spend, procurement_maturity, primary_categories_json, purchasing_channels_json,
						biggest_challenge, current_systems, browser_extension_interest, pilot_interest, notes,
						status, source, form_version, ip_hash, user_agent_hash, created_at, updated_at
					) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				)
				.bind(
					id,
					submission.workEmail,
					input.normalizedEmail,
					submission.fullName,
					submission.companyName,
					submission.jobTitle,
					submission.companySize,
					submission.annualAddressableSpend ?? null,
					submission.procurementMaturity ?? null,
					submission.primaryCategories
						? JSON.stringify(submission.primaryCategories)
						: null,
					submission.purchasingChannels
						? JSON.stringify(submission.purchasingChannels)
						: null,
					submission.biggestChallenge,
					submission.currentSystems ?? null,
					submission.browserExtensionInterest ? 1 : 0,
					submission.pilotInterest ? 1 : 0,
					submission.notes ?? null,
					"new",
					"procurement_landing_page",
					input.formVersion,
					input.ipHash ?? null,
					input.userAgentHash ?? null,
					now,
					now,
				)
				.run();
		} catch (error) {
			// Defense-in-depth against a race between the service's
			// find-then-create dedupe check and a concurrent insert: the unique
			// index on work_email_normalized is the real guarantee. If we lose
			// that race, return the row that won instead of surfacing a 500.
			if (isUniqueConstraintError(error)) {
				const existing = await this.findByNormalizedEmail(input.normalizedEmail);
				if (existing) return existing;
			}
			throw error;
		}

		const created = await this.getById(id);
		if (!created) {
			throw new Error("Failed to read back newly created procurement lead.");
		}
		return created;
	}

	async getById(id: string) {
		const row = await this.db
			.prepare("SELECT * FROM procurement_early_access_submissions WHERE id = ?")
			.bind(id)
			.first<ProcurementLeadRow>();
		return row ? fromRow(row) : null;
	}

	async updateStatus(id: string, status: ProcurementLeadStatus) {
		const now = new Date().toISOString();
		const result = await this.db
			.prepare(
				"UPDATE procurement_early_access_submissions SET status = ?, updated_at = ? WHERE id = ?",
			)
			.bind(status, now, id)
			.run();
		if (!result.meta.changes) return null;
		return this.getById(id);
	}

	async list(
		query: ProcurementLeadListQuery,
	): Promise<ProcurementLeadListResult> {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (query.status) {
			conditions.push("status = ?");
			params.push(query.status);
		}

		if (query.cursor) {
			const decoded = decodeCursor(query.cursor);
			if (decoded) {
				conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
				params.push(decoded.createdAt, decoded.createdAt, decoded.id);
			}
		}

		const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		const limitPlusOne = query.limit + 1;

		const { results } = await this.db
			.prepare(
				`SELECT * FROM procurement_early_access_submissions ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
			)
			.bind(...params, limitPlusOne)
			.all<ProcurementLeadRow>();

		const hasMore = results.length > query.limit;
		const page = (hasMore ? results.slice(0, query.limit) : results).map(fromRow);
		const last = page[page.length - 1];

		return {
			items: page.map(toLeadListItem),
			nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : undefined,
		};
	}

	async listAllForExport() {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM procurement_early_access_submissions ORDER BY created_at DESC",
			)
			.all<ProcurementLeadRow>();
		return results.map(fromRow);
	}
}
