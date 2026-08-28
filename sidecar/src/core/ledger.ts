import { chainEventHash } from "../../../packages/protocol/src/hashing";
import type { Db } from "./db";

export type LedgerEntry = {
	id: string;
	occurredAt: string;
	eventType: string;
	entityType: string;
	entityId: string;
	previousHash: string | null;
	eventHash: string;
	payload: unknown;
	seq: number;
};

export type LedgerVerification =
	| { valid: true; entries: number }
	| { valid: false; entries: number; firstInvalidSeq: number; reason: string };

/**
 * Append-only, hash-chained local audit ledger.
 * event_hash = SHA-256(previous_hash + canonical_payload + timestamp + event_id).
 * Tamper-EVIDENT, not immutable — a fully compromised local device can
 * rewrite the chain (documented in the threat model and shown in the UI).
 */
export class Ledger {
	constructor(private readonly db: Db) {}

	async append(
		eventType: string,
		entityType: string,
		entityId: string,
		payload: unknown,
	): Promise<LedgerEntry> {
		const last = await this.db.query(
			"SELECT event_hash, seq FROM local_events ORDER BY seq DESC LIMIT 1",
		);
		const previousHash = (last[0]?.event_hash as string | undefined) ?? null;
		const seq = ((last[0]?.seq as number | undefined) ?? 0) + 1;
		const id = crypto.randomUUID();
		const occurredAt = new Date().toISOString();
		const eventHash = await chainEventHash({ previousHash, payload, occurredAt, eventId: id });
		await this.db.execute(
			`INSERT INTO local_events (id, occurred_at, event_type, entity_type, entity_id, previous_hash, event_hash, payload_json, seq)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, occurredAt, eventType, entityType, entityId, previousHash, eventHash, JSON.stringify(payload ?? null), seq],
		);
		return { id, occurredAt, eventType, entityType, entityId, previousHash, eventHash, payload, seq };
	}

	async list(limit = 200): Promise<LedgerEntry[]> {
		const rows = await this.db.query(
			"SELECT * FROM local_events ORDER BY seq DESC LIMIT ?",
			[limit],
		);
		return rows.map((row) => ({
			id: row.id as string,
			occurredAt: row.occurred_at as string,
			eventType: row.event_type as string,
			entityType: row.entity_type as string,
			entityId: row.entity_id as string,
			previousHash: (row.previous_hash as string | null) ?? null,
			eventHash: row.event_hash as string,
			payload: JSON.parse((row.payload_json as string) || "null"),
			seq: row.seq as number,
		}));
	}

	/** Recomputes the whole chain; reports the first broken record if any. */
	async verify(): Promise<LedgerVerification> {
		const rows = await this.db.query("SELECT * FROM local_events ORDER BY seq ASC");
		let previousHash: string | null = null;
		for (const row of rows) {
			const seq = row.seq as number;
			if ((row.previous_hash ?? null) !== previousHash) {
				return {
					valid: false,
					entries: rows.length,
					firstInvalidSeq: seq,
					reason: "previous_hash does not match the prior record",
				};
			}
			const expected = await chainEventHash({
				previousHash,
				payload: JSON.parse((row.payload_json as string) || "null"),
				occurredAt: row.occurred_at as string,
				eventId: row.id as string,
			});
			if (expected !== row.event_hash) {
				return {
					valid: false,
					entries: rows.length,
					firstInvalidSeq: seq,
					reason: "event_hash does not match recomputed hash",
				};
			}
			previousHash = row.event_hash as string;
		}
		return { valid: true, entries: rows.length };
	}
}
