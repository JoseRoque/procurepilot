import type { ProcurementEarlyAccessSubmission } from "~/types/procurement";

export type StoredProcurementEarlyAccessSubmission =
	ProcurementEarlyAccessSubmission & {
		id: string;
		createdAt: string;
	};

/**
 * Persistence boundary for early-access submissions. Swapping to D1 (or any
 * other store) later only requires a new class implementing this interface —
 * the Hono handler and validation layer never need to change.
 */
export interface ProcurementEarlyAccessStore {
	save(
		submission: ProcurementEarlyAccessSubmission,
	): Promise<StoredProcurementEarlyAccessSubmission>;
}

/**
 * Typed in-memory stub used until a real database (e.g. D1) is wired up.
 * Workers isolates are ephemeral and may be recycled between requests, so
 * this does NOT provide durable storage — it exists only to keep the
 * request/response contract real while persistence is unconfigured.
 */
class InMemoryProcurementEarlyAccessStore implements ProcurementEarlyAccessStore {
	private submissions: StoredProcurementEarlyAccessSubmission[] = [];

	async save(
		submission: ProcurementEarlyAccessSubmission,
	): Promise<StoredProcurementEarlyAccessSubmission> {
		const stored: StoredProcurementEarlyAccessSubmission = {
			...submission,
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
		};
		this.submissions.push(stored);
		return stored;
	}
}

let inMemoryStore: InMemoryProcurementEarlyAccessStore | undefined;

/**
 * Resolves the active store. When a D1 binding (e.g. `env.DB`) is added to
 * wrangler.jsonc in the future, branch here and return a D1-backed
 * implementation instead — the rest of the codebase is already isolated from
 * this decision.
 */
export function getProcurementEarlyAccessStore(
	_env: Env,
): ProcurementEarlyAccessStore {
	if (!inMemoryStore) {
		inMemoryStore = new InMemoryProcurementEarlyAccessStore();
	}
	return inMemoryStore;
}
