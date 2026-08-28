import type {
	ConsumptionInterval,
	ImportBatch,
	PriceAssessment,
	PricePoint,
	ProductIdentity,
	ProductObservation,
	PurchaseEvent,
	PurchaseEventLine,
} from "../../../packages/domain/src";
import {
	assessPrice,
	buildPriceBenchmark,
	deriveConsumptionInterval,
} from "../../../packages/optimizer/src";
import type { Db, FieldCrypto } from "./db";

const nowIso = () => new Date().toISOString();

/**
 * Persistence for product observations, purchase ground truth, and the
 * personal price/cadence intelligence derived from them.
 *
 * Encryption boundary: product_key, gtin, merchant, prices, and sizes are
 * stored in the clear because they are what queries group and range over.
 * The human-readable strings (display name, brand) are encrypted — those are
 * the fields that make a leaked database read like someone's shopping life.
 */
export class ProductRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async recordObservations(
		observations: Array<Omit<ProductObservation, "id">>,
	): Promise<number> {
		let written = 0;
		for (const observation of observations) {
			const { identity, ...rest } = observation;
			await this.db.execute(
				`INSERT INTO product_observations (
					id, observed_at, merchant_id, product_key, gtin, brand, normalized_name, display_name,
					merchant_sku, authoritative, size_dimension, size_base_units_per_item, size_pack_count,
					size_total_base_units, size_base_unit, size_confidence, list_price_cents, price_paid_cents,
					quantity, availability, source, adapter_id, adapter_version, confidence, import_batch_id
				) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
				[
					crypto.randomUUID(),
					rest.observedAt,
					rest.merchantId,
					identity.key,
					identity.gtin ?? null,
					identity.brand ? await this.crypto.encrypt(identity.brand) : null,
					await this.crypto.encrypt(identity.normalizedName),
					await this.crypto.encrypt(identity.displayName),
					identity.merchantSku ?? null,
					identity.authoritative ? 1 : 0,
					identity.size?.dimension ?? null,
					identity.size?.baseUnitsPerItem ?? null,
					identity.size?.packCount ?? null,
					identity.size?.totalBaseUnits ?? null,
					identity.size?.baseUnit ?? null,
					identity.size?.confidence ?? null,
					rest.listPriceCents ?? null,
					rest.pricePaidCents ?? null,
					rest.quantity ?? null,
					rest.availability ?? null,
					rest.source,
					rest.adapterId ?? null,
					rest.adapterVersion ?? null,
					rest.confidence,
					rest.importBatchId ?? null,
				],
			);
			written++;
		}
		return written;
	}

	/** Price points for one product, newest last. Drives benchmarking. */
	async pricePoints(productKey: string, limit = 200): Promise<PricePoint[]> {
		const rows = await this.db.query(
			`SELECT observed_at, merchant_id, price_paid_cents, size_total_base_units, source
			 FROM product_observations
			 WHERE product_key = ? AND price_paid_cents IS NOT NULL
			 ORDER BY observed_at ASC LIMIT ?`,
			[productKey, limit],
		);
		return rows.map((row) => ({
			observedAt: row.observed_at as string,
			merchantId: row.merchant_id as string,
			pricePaidCents: row.price_paid_cents as number,
			totalBaseUnits: (row.size_total_base_units as number | null) ?? undefined,
			source: row.source as PricePoint["source"],
		}));
	}

	async assessCurrentPrice(productKey: string, currentCents: number): Promise<PriceAssessment> {
		const points = await this.pricePoints(productKey);
		return assessPrice(currentCents, buildPriceBenchmark(productKey, points));
	}

	/** Distinct products seen, most recently observed first. */
	async listProducts(limit = 200): Promise<
		Array<{
			productKey: string;
			displayName: string;
			observationCount: number;
			lastObservedAt: string;
			lastPriceCents?: number;
			authoritative: boolean;
		}>
	> {
		const rows = await this.db.query(
			`SELECT product_key, COUNT(*) AS n, MAX(observed_at) AS last_at, MAX(authoritative) AS auth
			 FROM product_observations GROUP BY product_key
			 ORDER BY last_at DESC LIMIT ?`,
			[limit],
		);
		const out = [];
		for (const row of rows) {
			const latest = await this.db.query(
				`SELECT display_name, price_paid_cents FROM product_observations
				 WHERE product_key = ? ORDER BY observed_at DESC LIMIT 1`,
				[row.product_key],
			);
			out.push({
				productKey: row.product_key as string,
				displayName: latest[0]
					? await this.crypto.decrypt(latest[0].display_name as string)
					: "(unknown)",
				observationCount: row.n as number,
				lastObservedAt: row.last_at as string,
				lastPriceCents: (latest[0]?.price_paid_cents as number | null) ?? undefined,
				authoritative: (row.auth as number) === 1,
			});
		}
		return out;
	}
}

export class PurchaseRepo {
	constructor(
		private readonly db: Db,
		private readonly crypto: FieldCrypto,
	) {}

	async recordPurchase(
		event: Omit<PurchaseEvent, "id">,
		lines: Array<Omit<PurchaseEventLine, "id" | "purchaseEventId">>,
	): Promise<string> {
		const eventId = crypto.randomUUID();
		await this.db.execute(
			`INSERT INTO purchase_events (id, occurred_at, merchant_id, source, subtotal_cents,
			 fees_cents, tax_cents, total_cents, fulfillment_type, import_batch_id)
			 VALUES (?,?,?,?,?,?,?,?,?,?)`,
			[
				eventId,
				event.occurredAt,
				event.merchantId,
				event.source,
				event.subtotalCents ?? null,
				event.feesCents ?? null,
				event.taxCents ?? null,
				event.totalCents ?? null,
				event.fulfillmentType ?? null,
				event.importBatchId ?? null,
			],
		);
		for (const line of lines) {
			await this.db.execute(
				`INSERT INTO purchase_event_lines (id, purchase_event_id, product_key, display_name, gtin,
				 quantity, paid_unit_price_cents, line_total_cents, size_total_base_units, size_base_unit)
				 VALUES (?,?,?,?,?,?,?,?,?,?)`,
				[
					crypto.randomUUID(),
					eventId,
					line.identity.key,
					await this.crypto.encrypt(line.identity.displayName),
					line.identity.gtin ?? null,
					line.quantity,
					line.paidUnitPriceCents ?? null,
					line.lineTotalCents ?? null,
					line.identity.size?.totalBaseUnits ?? null,
					line.identity.size?.baseUnit ?? null,
				],
			);
		}
		return eventId;
	}

	/** Repurchase cadence for one product, from purchase ground truth. */
	async consumptionInterval(productKey: string): Promise<ConsumptionInterval | undefined> {
		const rows = await this.db.query(
			`SELECT e.occurred_at AS occurred_at FROM purchase_event_lines l
			 JOIN purchase_events e ON e.id = l.purchase_event_id
			 WHERE l.product_key = ? ORDER BY e.occurred_at ASC`,
			[productKey],
		);
		return deriveConsumptionInterval(
			productKey,
			rows.map((row) => row.occurred_at as string),
		);
	}

	async stats(): Promise<{ events: number; lines: number; merchants: number }> {
		const events = await this.db.query("SELECT COUNT(*) AS n FROM purchase_events");
		const lines = await this.db.query("SELECT COUNT(*) AS n FROM purchase_event_lines");
		const merchants = await this.db.query(
			"SELECT COUNT(DISTINCT merchant_id) AS n FROM purchase_events",
		);
		return {
			events: (events[0]?.n as number) ?? 0,
			lines: (lines[0]?.n as number) ?? 0,
			merchants: (merchants[0]?.n as number) ?? 0,
		};
	}
}

export class ImportRepo {
	constructor(private readonly db: Db) {}

	async createBatch(batch: Omit<ImportBatch, "id">): Promise<string> {
		const id = crypto.randomUUID();
		await this.db.execute(
			`INSERT INTO import_batches (id, imported_at, source_label, rows_imported, rows_skipped, notes_json)
			 VALUES (?,?,?,?,?,?)`,
			[
				id,
				batch.importedAt,
				batch.sourceLabel,
				batch.rowsImported,
				batch.rowsSkipped,
				JSON.stringify(batch.notes),
			],
		);
		return id;
	}

	async list(): Promise<ImportBatch[]> {
		const rows = await this.db.query(
			"SELECT * FROM import_batches ORDER BY imported_at DESC LIMIT 50",
		);
		return rows.map((row) => ({
			id: row.id as string,
			importedAt: row.imported_at as string,
			sourceLabel: row.source_label as string,
			rowsImported: row.rows_imported as number,
			rowsSkipped: row.rows_skipped as number,
			notes: JSON.parse((row.notes_json as string) || "[]"),
		}));
	}

	/** Undo an import wholesale — imports are the one bulk write worth reversing. */
	async deleteBatch(batchId: string): Promise<void> {
		await this.db.execute(
			`DELETE FROM purchase_event_lines WHERE purchase_event_id IN
			 (SELECT id FROM purchase_events WHERE import_batch_id = ?)`,
			[batchId],
		);
		await this.db.execute("DELETE FROM purchase_events WHERE import_batch_id = ?", [batchId]);
		await this.db.execute("DELETE FROM product_observations WHERE import_batch_id = ?", [batchId]);
		await this.db.execute("DELETE FROM import_batches WHERE id = ?", [batchId]);
	}
}

export type IdentityForKey = Pick<ProductIdentity, "key" | "displayName">;
export { nowIso };
