import type {
	ImportBatch,
	ProductObservation,
	PurchaseEvent,
	PurchaseEventLine,
} from "../../domain/src";
import { normalizeMoney } from "./money";
import { deriveProductIdentity } from "./productIdentity";

/**
 * Retailer order-history importer.
 *
 * Deliberately generic with column MAPPING rather than one parser per retailer:
 * export formats change without notice, and a mapping the user confirms in a
 * preview never silently misreads a column. Known layouts are auto-detected as
 * a convenience, but the user always sees and can correct the mapping.
 *
 * Pure: parses text in, returns records out. No file or database access.
 */

export type ImportField =
	| "orderDate"
	| "itemName"
	| "brand"
	| "gtin"
	| "merchantSku"
	| "quantity"
	| "unitPrice"
	| "lineTotal"
	| "merchant"
	| "orderId";

export type ColumnMapping = Partial<Record<ImportField, string>>;

export type ParsedCsv = { headers: string[]; rows: Array<Record<string, string>> };

/**
 * RFC4180-ish CSV parser: handles quoted fields, embedded commas/newlines, and
 * doubled quotes. Retailer exports routinely contain product names with commas,
 * so a naive split() corrupts real data.
 */
export function parseCsv(text: string): ParsedCsv {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	const input = text.replace(/^﻿/, ""); // strip BOM

	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (inQuotes) {
			if (char === '"') {
				if (input[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
			continue;
		}
		if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (char !== "\r") {
			field += char;
		}
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	const nonEmpty = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
	if (nonEmpty.length === 0) return { headers: [], rows: [] };

	const headers = (nonEmpty[0] as string[]).map((header) => header.trim());
	const dataRows = nonEmpty.slice(1).map((cells) => {
		const record: Record<string, string> = {};
		headers.forEach((header, index) => {
			record[header] = (cells[index] ?? "").trim();
		});
		return record;
	});
	return { headers, rows: dataRows };
}

/** Header aliases seen across common retailer exports, lowercased. */
const FIELD_ALIASES: Record<ImportField, string[]> = {
	orderDate: ["order date", "date", "order placed", "purchase date", "ship date", "transaction date"],
	itemName: ["title", "product name", "item name", "description", "product title", "item"],
	brand: ["brand", "manufacturer", "seller"],
	gtin: ["upc", "gtin", "ean", "barcode"],
	merchantSku: ["asin", "sku", "item number", "product id", "item id"],
	quantity: ["quantity", "qty", "item quantity"],
	unitPrice: ["unit price", "price", "item price", "purchase price per unit", "list price per unit"],
	lineTotal: ["total owed", "item total", "line total", "total", "item subtotal"],
	merchant: ["merchant", "retailer", "store", "website", "sold by"],
	orderId: ["order id", "order number", "order #"],
};

/** Suggests a mapping from headers. Always presented to the user for confirmation. */
export function suggestMapping(headers: string[]): ColumnMapping {
	const mapping: ColumnMapping = {};
	const lowered = headers.map((header) => ({ raw: header, low: header.toLowerCase().trim() }));

	for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ImportField, string[]]>) {
		// Exact alias match first; fall back to containment.
		const exact = lowered.find((header) => aliases.includes(header.low));
		if (exact) {
			mapping[field] = exact.raw;
			continue;
		}
		const partial = lowered.find((header) => aliases.some((alias) => header.low.includes(alias)));
		if (partial) mapping[field] = partial.raw;
	}
	return mapping;
}

export type ImportRowIssue = {
	rowNumber: number;
	reason: string;
};

export type ImportPreview = {
	batchLabel: string;
	mapping: ColumnMapping;
	/** Records that would be created, for user review BEFORE anything is written. */
	events: Array<{
		event: Omit<PurchaseEvent, "id" | "importBatchId">;
		lines: Array<Omit<PurchaseEventLine, "id" | "purchaseEventId">>;
	}>;
	observations: Array<Omit<ProductObservation, "id" | "importBatchId">>;
	skipped: ImportRowIssue[];
	warnings: string[];
};

function parseDateIso(raw: string): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	// Prefer unambiguous ISO; otherwise fall back to Date parsing.
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) return undefined;
	return new Date(parsed).toISOString();
}

function parseQuantity(raw: string | undefined): number {
	const value = Number.parseInt((raw ?? "1").replace(/[^\d-]/g, ""), 10);
	return Number.isFinite(value) && value > 0 ? value : 1;
}

export type BuildPreviewOptions = {
	csv: ParsedCsv;
	mapping: ColumnMapping;
	/** Used when the file has no merchant column. */
	defaultMerchantId: string;
	batchLabel: string;
	maxRows?: number;
};

/**
 * Builds an import preview. Rows that cannot be understood are SKIPPED with a
 * reason rather than imported with guessed values — a wrong price silently
 * entering price history would corrupt every later benchmark.
 */
export function buildImportPreview(options: BuildPreviewOptions): ImportPreview {
	const { csv, mapping, defaultMerchantId, batchLabel } = options;
	const maxRows = options.maxRows ?? 5000;
	const skipped: ImportRowIssue[] = [];
	const warnings: string[] = [];

	if (!mapping.itemName) {
		warnings.push("No product-name column is mapped; nothing can be imported.");
	}
	if (!mapping.orderDate) {
		warnings.push("No date column is mapped; price history cannot be ordered over time.");
	}
	if (!mapping.unitPrice && !mapping.lineTotal) {
		warnings.push("No price column is mapped; observations will carry no price.");
	}

	// Group rows into orders so multi-line orders become one purchase event.
	const grouped = new Map<
		string,
		{ occurredAt: string; merchantId: string; lines: Array<Omit<PurchaseEventLine, "id" | "purchaseEventId">>; observations: Array<Omit<ProductObservation, "id" | "importBatchId">> }
	>();

	const rows = csv.rows.slice(0, maxRows);
	if (csv.rows.length > maxRows) {
		warnings.push(`File has ${csv.rows.length} rows; previewing the first ${maxRows}.`);
	}

	rows.forEach((row, index) => {
		const rowNumber = index + 2; // +1 for header, +1 for 1-based
		const name = mapping.itemName ? row[mapping.itemName] : undefined;
		if (!name) {
			skipped.push({ rowNumber, reason: "No product name in the mapped column." });
			return;
		}

		const occurredAt = mapping.orderDate ? parseDateIso(row[mapping.orderDate] ?? "") : undefined;
		if (mapping.orderDate && !occurredAt) {
			skipped.push({ rowNumber, reason: `Unrecognized date "${row[mapping.orderDate] ?? ""}".` });
			return;
		}

		const quantity = parseQuantity(mapping.quantity ? row[mapping.quantity] : undefined);
		const unitPrice = mapping.unitPrice ? normalizeMoney(row[mapping.unitPrice] ?? "") : undefined;
		const lineTotal = mapping.lineTotal ? normalizeMoney(row[mapping.lineTotal] ?? "") : undefined;

		// Derive whichever price is missing, but never invent both.
		let unitPriceCents = unitPrice?.cents;
		let lineTotalCents = lineTotal?.cents;
		if (unitPriceCents === undefined && lineTotalCents !== undefined && quantity > 0) {
			unitPriceCents = Math.round(lineTotalCents / quantity);
		}
		if (lineTotalCents === undefined && unitPriceCents !== undefined) {
			lineTotalCents = unitPriceCents * quantity;
		}
		if (unitPriceCents !== undefined && unitPriceCents < 0) {
			skipped.push({ rowNumber, reason: "Negative price (likely a refund row)." });
			return;
		}

		const merchantId =
			(mapping.merchant ? row[mapping.merchant]?.trim() : undefined) || defaultMerchantId;

		const identity = deriveProductIdentity({
			displayName: name,
			brand: mapping.brand ? row[mapping.brand] : undefined,
			gtin: mapping.gtin ? row[mapping.gtin] : undefined,
			merchantSku: mapping.merchantSku ? row[mapping.merchantSku] : undefined,
		});

		const orderKey =
			(mapping.orderId ? row[mapping.orderId] : undefined) ||
			`${merchantId}|${occurredAt ?? "undated"}`;

		const observedAt = occurredAt ?? new Date().toISOString();
		const bucket = grouped.get(orderKey) ?? {
			occurredAt: observedAt,
			merchantId,
			lines: [],
			observations: [],
		};

		bucket.lines.push({ identity, quantity, paidUnitPriceCents: unitPriceCents, lineTotalCents });
		bucket.observations.push({
			observedAt,
			merchantId,
			identity,
			pricePaidCents: unitPriceCents,
			quantity,
			availability: "unknown",
			source: "seed_import",
			// Imported history is self-reported ground truth: trustworthy for what
			// was paid, but not a live page reading.
			confidence: unitPriceCents === undefined ? "low" : "high",
		});
		grouped.set(orderKey, bucket);
	});

	const events = Array.from(grouped.values()).map((bucket) => ({
		event: {
			occurredAt: bucket.occurredAt,
			merchantId: bucket.merchantId,
			source: "order_history_import" as const,
			subtotalCents: bucket.lines.every((line) => line.lineTotalCents !== undefined)
				? bucket.lines.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0)
				: undefined,
			fulfillmentType: "unknown" as const,
		},
		lines: bucket.lines,
	}));

	const observations = Array.from(grouped.values()).flatMap((bucket) => bucket.observations);

	return { batchLabel, mapping, events, observations, skipped, warnings };
}

export function summarizeImport(preview: ImportPreview): ImportBatch {
	return {
		id: "preview",
		importedAt: new Date().toISOString(),
		sourceLabel: preview.batchLabel,
		rowsImported: preview.observations.length,
		rowsSkipped: preview.skipped.length,
		notes: preview.warnings,
	};
}
