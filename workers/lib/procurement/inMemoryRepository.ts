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

/**
 * Development-only in-memory repository.
 *
 * IMPORTANT: this data lives only in the current Worker isolate's memory.
 * It is lost whenever the isolate restarts — on every deploy, on `wrangler
 * dev` reload, and whenever Cloudflare evicts an idle isolate. This must
 * NEVER be treated as production persistence. Configure a D1 binding (see
 * migrations/0001_procurement_early_access.sql and the README) for any real
 * deployment that needs durable lead capture.
 */
export class InMemoryProcurementLeadRepository
	implements ProcurementLeadRepository
{
	private byId = new Map<string, StoredProcurementEarlyAccessSubmission>();
	private idByNormalizedEmail = new Map<string, string>();

	async findByNormalizedEmail(normalizedEmail: string) {
		const id = this.idByNormalizedEmail.get(normalizedEmail);
		return id ? (this.byId.get(id) ?? null) : null;
	}

	async create(
		input: CreateProcurementLeadInput,
	): Promise<StoredProcurementEarlyAccessSubmission> {
		const now = new Date().toISOString();
		const record: StoredProcurementEarlyAccessSubmission = {
			...input.submission,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
			status: "new",
			source: "procurement_landing_page",
			formVersion: input.formVersion,
			ipHash: input.ipHash,
			userAgentHash: input.userAgentHash,
		};
		this.byId.set(record.id, record);
		this.idByNormalizedEmail.set(input.normalizedEmail, record.id);
		return record;
	}

	async getById(id: string) {
		return this.byId.get(id) ?? null;
	}

	async updateStatus(id: string, status: ProcurementLeadStatus) {
		const existing = this.byId.get(id);
		if (!existing) return null;
		const updated: StoredProcurementEarlyAccessSubmission = {
			...existing,
			status,
			updatedAt: new Date().toISOString(),
		};
		this.byId.set(id, updated);
		return updated;
	}

	async list(
		query: ProcurementLeadListQuery,
	): Promise<ProcurementLeadListResult> {
		let rows = Array.from(this.byId.values());
		if (query.status) {
			rows = rows.filter((row) => row.status === query.status);
		}
		rows.sort((a, b) => {
			if (a.createdAt === b.createdAt) return b.id.localeCompare(a.id);
			return b.createdAt.localeCompare(a.createdAt);
		});

		let startIndex = 0;
		if (query.cursor) {
			const decoded = decodeCursor(query.cursor);
			if (decoded) {
				const foundAt = rows.findIndex(
					(row) => row.createdAt === decoded.createdAt && row.id === decoded.id,
				);
				startIndex = foundAt === -1 ? 0 : foundAt + 1;
			}
		}

		const page = rows.slice(startIndex, startIndex + query.limit);
		const nextRow = rows[startIndex + query.limit];
		return {
			items: page.map(toLeadListItem),
			nextCursor: nextRow
				? encodeCursor(nextRow.createdAt, nextRow.id)
				: undefined,
		};
	}

	async listAllForExport() {
		return Array.from(this.byId.values()).sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt),
		);
	}

	/** Test-only: clears all state. Never called from production code paths. */
	__resetForTests() {
		this.byId.clear();
		this.idByNormalizedEmail.clear();
	}
}
