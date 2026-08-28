import {
	buildImportPreview,
	parseCsv,
	suggestMapping,
	type ColumnMapping,
	type ImportPreview,
	type ParsedCsv,
} from "../../../packages/optimizer/src";
import type { SidecarCore } from "./services";

/**
 * Two-phase import: PREVIEW then COMMIT.
 *
 * Nothing is written until the user has seen exactly what would be created and
 * which rows were skipped. A bad price silently entering history would corrupt
 * every later benchmark, and unlike a scan there is no page to re-read.
 */
export class ImportService {
	constructor(private readonly core: SidecarCore) {}

	parse(text: string): { csv: ParsedCsv; mapping: ColumnMapping } {
		const csv = parseCsv(text);
		return { csv, mapping: suggestMapping(csv.headers) };
	}

	preview(
		csv: ParsedCsv,
		mapping: ColumnMapping,
		defaultMerchantId: string,
		batchLabel: string,
	): ImportPreview {
		return buildImportPreview({ csv, mapping, defaultMerchantId, batchLabel });
	}

	/** Writes a previewed import. Returns the batch id so it can be undone whole. */
	async commit(preview: ImportPreview): Promise<{ batchId: string; observations: number; events: number }> {
		const batchId = await this.core.imports.createBatch({
			importedAt: new Date().toISOString(),
			sourceLabel: preview.batchLabel,
			rowsImported: preview.observations.length,
			rowsSkipped: preview.skipped.length,
			notes: preview.warnings,
		});

		for (const { event, lines } of preview.events) {
			await this.core.purchases.recordPurchase({ ...event, importBatchId: batchId }, lines);
		}
		await this.core.products.recordObservations(
			preview.observations.map((observation) => ({ ...observation, importBatchId: batchId })),
		);

		// Ledger records volume and provenance only — never product names.
		await this.core.ledger.append("data_imported", "import_batch", batchId, {
			sourceLabel: preview.batchLabel,
			observations: preview.observations.length,
			events: preview.events.length,
			skipped: preview.skipped.length,
		});

		return {
			batchId,
			observations: preview.observations.length,
			events: preview.events.length,
		};
	}

	async undo(batchId: string): Promise<void> {
		await this.core.imports.deleteBatch(batchId);
		await this.core.ledger.append("import_reverted", "import_batch", batchId, {});
	}
}
