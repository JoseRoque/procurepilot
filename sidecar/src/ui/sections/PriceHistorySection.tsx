import { useEffect, useState } from "react";
import type { ConsumptionInterval, PriceAssessment } from "../../../../packages/domain/src";
import { evaluateRepurchase, formatCents, unitPriceForDisplay } from "../../../../packages/optimizer/src";
import type { Ctx } from "../App";

type ProductRow = Awaited<ReturnType<Ctx["core"]["products"]["listProducts"]>>[number];

const VERDICT_TONE: Record<string, string> = {
	best_seen: "green",
	below_typical: "green",
	typical: "gray",
	above_typical: "amber",
	worst_seen: "red",
	insufficient_history: "gray",
};

export function PriceHistorySection({ ctx }: { ctx: Ctx }) {
	const [products, setProducts] = useState<ProductRow[]>([]);
	const [selected, setSelected] = useState<ProductRow>();
	const [assessment, setAssessment] = useState<PriceAssessment>();
	const [interval, setInterval] = useState<ConsumptionInterval>();
	const [points, setPoints] = useState<Awaited<ReturnType<Ctx["core"]["products"]["pricePoints"]>>>([]);
	const [filter, setFilter] = useState("");

	useEffect(() => {
		ctx.core.products.listProducts(300).then(setProducts);
	}, [ctx.refreshKey]);

	async function inspect(product: ProductRow) {
		setSelected(product);
		const history = await ctx.core.products.pricePoints(product.productKey);
		setPoints(history);
		setAssessment(
			product.lastPriceCents !== undefined
				? await ctx.core.products.assessCurrentPrice(product.productKey, product.lastPriceCents)
				: undefined,
		);
		setInterval(await ctx.core.purchases.consumptionInterval(product.productKey));
	}

	const visible = products.filter((product) =>
		filter.trim() ? product.displayName.toLowerCase().includes(filter.toLowerCase()) : true,
	);

	const repurchase = interval ? evaluateRepurchase(interval, new Date().toISOString()) : undefined;

	return (
		<div>
			<h2>Price history</h2>
			<p className="subtitle">
				Built from your own scans and imports. This needs exactly one user to be useful — no
				collective data is involved.
			</p>

			<div className="card">
				<div className="row" style={{ justifyContent: "space-between" }}>
					<h3>Products seen ({products.length})</h3>
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter by name"
						style={{ width: 220 }}
					/>
				</div>
				<table>
					<thead>
						<tr><th>Product</th><th>Observations</th><th>Last seen</th><th>Last price</th><th /></tr>
					</thead>
					<tbody>
						{visible.slice(0, 60).map((product) => (
							<tr key={product.productKey}>
								<td>
									{product.displayName}
									{product.authoritative && (
										<span className="badge green" style={{ marginLeft: 6 }}>UPC</span>
									)}
								</td>
								<td>{product.observationCount}</td>
								<td>{product.lastObservedAt.slice(0, 10)}</td>
								<td>
									{product.lastPriceCents !== undefined
										? formatCents(product.lastPriceCents)
										: "—"}
								</td>
								<td>
									<button className="secondary" type="button" onClick={() => inspect(product)}>
										Inspect
									</button>
								</td>
							</tr>
						))}
						{visible.length === 0 && (
							<tr>
								<td colSpan={5} className="muted">
									No products yet. Import a retailer export, or scan a cart from the extension.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{selected && (
				<div className="card">
					<h3>{selected.displayName}</h3>
					<p className="muted">
						{selected.authoritative
							? "Identified by UPC/GTIN — comparable across merchants."
							: "Identified by brand + name + size. Reliable within a merchant; not used to claim a product is cheaper elsewhere."}
					</p>

					{assessment && (
						<div className="notice" style={{ marginTop: 8 }}>
							<span className={`badge ${VERDICT_TONE[assessment.verdict] ?? "gray"}`}>
								{assessment.verdict.replaceAll("_", " ")}
							</span>
							<ul className="plain" style={{ marginTop: 6 }}>
								{assessment.explanation.map((line, index) => (
									<li key={index}>{line}</li>
								))}
							</ul>
						</div>
					)}

					{repurchase && (
						<div className={`notice ${repurchase.likelyDue ? "warn" : ""}`}>
							{repurchase.explanation}
							{repurchase.likelyDue && <strong> You may be due to rebuy this.</strong>}
						</div>
					)}

					{assessment?.benchmark?.bestUnitPrice && (
						<p className="muted">
							Best unit price seen:{" "}
							{(() => {
								const best = assessment.benchmark.bestUnitPrice;
								const display = unitPriceForDisplay(best.pricePaidCents, {
									dimension: "volume",
									baseUnitsPerItem: best.totalBaseUnits,
									packCount: 1,
									totalBaseUnits: best.totalBaseUnits,
									baseUnit: "ml",
									matchedText: "",
									confidence: "high",
								});
								return display
									? `${formatCents(display.cents)} ${display.label} at ${best.merchantId}`
									: "not computable";
							})()}
						</p>
					)}

					<h3 style={{ marginTop: 14 }}>Observations</h3>
					<table>
						<thead><tr><th>Date</th><th>Merchant</th><th>Price</th><th>Source</th></tr></thead>
						<tbody>
							{[...points].reverse().slice(0, 40).map((point, index) => (
								<tr key={index}>
									<td>{point.observedAt.slice(0, 10)}</td>
									<td>{point.merchantId}</td>
									<td>{formatCents(point.pricePaidCents)}</td>
									<td className="muted">{point.source.replaceAll("_", " ")}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
