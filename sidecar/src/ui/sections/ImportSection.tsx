import { useEffect, useRef, useState } from "react";
import { formatCents } from "../../../../packages/optimizer/src";
import type {
	ColumnMapping,
	ImportField,
	ImportPreview,
	ParsedCsv,
} from "../../../../packages/optimizer/src";
import { ImportService } from "../../core/importService";
import type { Ctx } from "../App";

const FIELDS: Array<{ field: ImportField; label: string; required?: boolean }> = [
	{ field: "orderDate", label: "Order date", required: true },
	{ field: "itemName", label: "Product name", required: true },
	{ field: "unitPrice", label: "Unit price" },
	{ field: "lineTotal", label: "Line total" },
	{ field: "quantity", label: "Quantity" },
	{ field: "brand", label: "Brand" },
	{ field: "gtin", label: "UPC / GTIN" },
	{ field: "merchantSku", label: "Merchant SKU / ASIN" },
	{ field: "merchant", label: "Merchant" },
	{ field: "orderId", label: "Order ID" },
];

export function ImportSection({ ctx }: { ctx: Ctx }) {
	const service = useRef(new ImportService(ctx.core)).current;
	const [csv, setCsv] = useState<ParsedCsv>();
	const [mapping, setMapping] = useState<ColumnMapping>({});
	const [merchantId, setMerchantId] = useState("");
	const [label, setLabel] = useState("");
	const [preview, setPreview] = useState<ImportPreview>();
	const [status, setStatus] = useState("");
	const [isError, setIsError] = useState(false);
	const [batches, setBatches] = useState<Awaited<ReturnType<typeof ctx.core.imports.list>>>([]);

	const reloadBatches = () => ctx.core.imports.list().then(setBatches);
	useEffect(() => {
		reloadBatches();
	}, [ctx.refreshKey]);

	async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		const text = await file.text();
		const parsed = service.parse(text);
		setCsv(parsed.csv);
		setMapping(parsed.mapping);
		setLabel(file.name);
		setMerchantId(file.name.toLowerCase().includes("amazon") ? "amazon" : "");
		setPreview(undefined);
		setIsError(false);
		setStatus(
			`Read ${parsed.csv.rows.length} rows and ${parsed.csv.headers.length} columns. Confirm the column mapping below.`,
		);
	}

	function buildPreview() {
		if (!csv) return;
		if (!merchantId.trim()) {
			setIsError(true);
			setStatus("Enter a merchant name so price history can be grouped by store.");
			return;
		}
		const result = service.preview(csv, mapping, merchantId.trim(), label || "import");
		setPreview(result);
		setIsError(false);
		setStatus(
			`Preview ready: ${result.observations.length} price observations across ${result.events.length} orders. Nothing has been saved yet.`,
		);
	}

	async function commit() {
		if (!preview) return;
		try {
			const result = await service.commit(preview);
			setIsError(false);
			setStatus(
				`Imported ${result.observations} observations from ${result.events} orders. You can undo this batch below.`,
			);
			setPreview(undefined);
			setCsv(undefined);
			reloadBatches();
			ctx.refresh();
		} catch (error) {
			setIsError(true);
			setStatus(String(error instanceof Error ? error.message : error));
		}
	}

	return (
		<div>
			<h2>Import purchase history</h2>
			<p className="subtitle">
				Seed your price history from a retailer data export. This runs entirely on this device —
				the file is read locally and nothing is uploaded.
			</p>

			<div className="card">
				<h3>1 · Choose a file</h3>
				<p className="muted">
					A CSV export from a retailer (for example Amazon's "Request My Data" order history).
					Columns are auto-detected and shown for you to confirm.
				</p>
				<input type="file" accept=".csv,text/csv" onChange={onFile} />
			</div>

			{csv && (
				<div className="card">
					<h3>2 · Confirm the column mapping</h3>
					<p className="muted">
						Auto-detected from the headers. Correct anything that looks wrong — a mis-mapped price
						column would corrupt every later price comparison.
					</p>
					<div className="grid2">
						{FIELDS.map(({ field, label: fieldLabel, required }) => (
							<label key={field}>
								{fieldLabel}
								{required ? " *" : ""}
								<select
									value={mapping[field] ?? ""}
									onChange={(e) =>
										setMapping({ ...mapping, [field]: e.target.value || undefined })
									}
								>
									<option value="">— not mapped —</option>
									{csv.headers.map((header) => (
										<option key={header} value={header}>
											{header}
										</option>
									))}
								</select>
							</label>
						))}
						<label>
							Merchant name *
							<input
								value={merchantId}
								onChange={(e) => setMerchantId(e.target.value)}
								placeholder="e.g. amazon"
							/>
						</label>
					</div>
					<button className="primary" type="button" onClick={buildPreview} style={{ marginTop: 12 }}>
						Preview import
					</button>
				</div>
			)}

			{preview && (
				<div className="card">
					<h3>3 · Review before saving</h3>
					{preview.warnings.length > 0 && (
						<div className="notice warn">{preview.warnings.join(" · ")}</div>
					)}
					<div className="row" style={{ gap: 20, marginBottom: 10 }}>
						<span><strong>{preview.observations.length}</strong> price observations</span>
						<span><strong>{preview.events.length}</strong> orders</span>
						<span><strong>{preview.skipped.length}</strong> rows skipped</span>
					</div>

					<table>
						<thead>
							<tr><th>Date</th><th>Product</th><th>Qty</th><th>Unit price</th><th>Size parsed</th></tr>
						</thead>
						<tbody>
							{preview.observations.slice(0, 12).map((observation, index) => (
								<tr key={index}>
									<td>{observation.observedAt.slice(0, 10)}</td>
									<td>{observation.identity.displayName}</td>
									<td>{observation.quantity ?? 1}</td>
									<td>
										{observation.pricePaidCents !== undefined
											? formatCents(observation.pricePaidCents)
											: <span className="muted">not detected</span>}
									</td>
									<td>
										{observation.identity.size ? (
											<span className="muted">
												{observation.identity.size.totalBaseUnits}
												{observation.identity.size.baseUnit}
												{observation.identity.size.confidence === "low" ? " (ambiguous)" : ""}
											</span>
										) : (
											<span className="muted">—</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{preview.observations.length > 12 && (
						<p className="muted">…and {preview.observations.length - 12} more.</p>
					)}

					{preview.skipped.length > 0 && (
						<details style={{ marginTop: 10 }}>
							<summary className="muted">Why {preview.skipped.length} rows were skipped</summary>
							<ul className="plain">
								{preview.skipped.slice(0, 20).map((issue) => (
									<li key={issue.rowNumber}>Row {issue.rowNumber}: {issue.reason}</li>
								))}
							</ul>
						</details>
					)}

					<div className="row" style={{ marginTop: 12 }}>
						<button className="primary" type="button" onClick={commit}>
							Save {preview.observations.length} observations locally
						</button>
						<button className="secondary" type="button" onClick={() => setPreview(undefined)}>
							Cancel
						</button>
					</div>
				</div>
			)}

			<div className={`statusline ${isError ? "error" : ""}`}>{status}</div>

			<div className="card">
				<h3>Previous imports</h3>
				<table>
					<thead><tr><th>When</th><th>Source</th><th>Imported</th><th>Skipped</th><th /></tr></thead>
					<tbody>
						{batches.map((batch) => (
							<tr key={batch.id}>
								<td>{new Date(batch.importedAt).toLocaleString()}</td>
								<td>{batch.sourceLabel}</td>
								<td>{batch.rowsImported}</td>
								<td>{batch.rowsSkipped}</td>
								<td>
									<button
										className="danger"
										type="button"
										onClick={async () => {
											await service.undo(batch.id);
											setStatus(`Reverted import "${batch.sourceLabel}".`);
											reloadBatches();
											ctx.refresh();
										}}
									>
										Undo batch
									</button>
								</td>
							</tr>
						))}
						{batches.length === 0 && (
							<tr><td colSpan={5} className="muted">No imports yet.</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
