import { useEffect, useState } from "react";
import type { ShoppingItem, ShoppingItemInput } from "../../../../packages/domain/src";
import { formatCents, normalizeMoney } from "../../../../packages/optimizer/src";
import type { Ctx } from "../App";

const EMPTY: ShoppingItemInput = {
	name: "",
	urgency: "this_week",
	targetQuantity: 1,
	acceptableSubstitution: "equivalent_allowed",
	active: true,
};

export function ShoppingListSection({ ctx }: { ctx: Ctx }) {
	const [items, setItems] = useState<ShoppingItem[]>([]);
	const [draft, setDraft] = useState<ShoppingItemInput>(EMPTY);
	const [maxPriceText, setMaxPriceText] = useState("");
	const [status, setStatus] = useState("");

	const reload = () => ctx.core.items.list().then(setItems);
	useEffect(() => {
		reload();
	}, [ctx.refreshKey]);

	async function save() {
		if (!draft.name.trim()) return setStatus("Name is required.");
		const maxUnitPriceCents = maxPriceText.trim() ? normalizeMoney(maxPriceText)?.cents : undefined;
		if (maxPriceText.trim() && maxUnitPriceCents === undefined) {
			return setStatus("Price limit must look like $4.50.");
		}
		await ctx.core.items.upsert({ ...draft, maxUnitPriceCents });
		await ctx.core.ledger.append("shopping_item_saved", "shopping_item", draft.id ?? "new", {
			urgency: draft.urgency,
		});
		setDraft(EMPTY);
		setMaxPriceText("");
		setStatus("Saved.");
		reload();
	}

	function edit(item: ShoppingItem) {
		setDraft({ ...item });
		setMaxPriceText(item.maxUnitPriceCents !== undefined ? formatCents(item.maxUnitPriceCents) : "");
	}

	return (
		<div>
			<h2>Shopping list</h2>
			<p className="subtitle">Private on this device. Item names are encrypted at rest when the OS keychain is available.</p>

			<div className="card">
				<h3>{draft.id ? "Edit item" : "Add item"}</h3>
				<div className="row">
					<label>Name
						<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Fixture dark chocolate bar" />
					</label>
					<label>Urgency
						<select value={draft.urgency} onChange={(e) => setDraft({ ...draft, urgency: e.target.value as ShoppingItemInput["urgency"] })}>
							<option value="immediate">Immediate</option>
							<option value="this_week">This week</option>
							<option value="stock_up">Stock up</option>
							<option value="watch_only">Watch only</option>
						</select>
					</label>
					<label>Quantity
						<input type="number" min={1} max={99} value={draft.targetQuantity} onChange={(e) => setDraft({ ...draft, targetQuantity: Number(e.target.value) || 1 })} style={{ width: 70 }} />
					</label>
					<label>Substitution
						<select value={draft.acceptableSubstitution} onChange={(e) => setDraft({ ...draft, acceptableSubstitution: e.target.value as ShoppingItemInput["acceptableSubstitution"] })}>
							<option value="exact_only">Exact only</option>
							<option value="brand_preferred">Brand preferred</option>
							<option value="equivalent_allowed">Equivalent allowed</option>
						</select>
					</label>
					<label>Max unit price
						<input value={maxPriceText} onChange={(e) => setMaxPriceText(e.target.value)} placeholder="$6.00" style={{ width: 90 }} />
					</label>
					<label>Preferred brand
						<input value={draft.preferredBrand ?? ""} onChange={(e) => setDraft({ ...draft, preferredBrand: e.target.value || undefined })} />
					</label>
					<label>Active
						<input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
					</label>
				</div>
				<div className="row" style={{ marginTop: 10 }}>
					<button className="primary" type="button" onClick={save}>{draft.id ? "Save changes" : "Add to list"}</button>
					{draft.id && <button className="secondary" type="button" onClick={() => { setDraft(EMPTY); setMaxPriceText(""); }}>Cancel</button>}
				</div>
				<div className="statusline">{status}</div>
			</div>

			<div className="card">
				<h3>Items ({items.length})</h3>
				<table>
					<thead><tr><th>Name</th><th>Urgency</th><th>Qty</th><th>Substitution</th><th>Price limit</th><th>Active</th><th /></tr></thead>
					<tbody>
						{items.map((item) => (
							<tr key={item.id}>
								<td>{item.name}{item.preferredBrand ? <div className="muted">prefers {item.preferredBrand}</div> : null}</td>
								<td>{item.urgency.replaceAll("_", " ")}</td>
								<td>{item.targetQuantity}</td>
								<td>{item.acceptableSubstitution.replaceAll("_", " ")}</td>
								<td>{item.maxUnitPriceCents !== undefined ? formatCents(item.maxUnitPriceCents) : "—"}</td>
								<td>{item.active ? "Yes" : "No"}</td>
								<td className="row">
									<button className="secondary" type="button" onClick={() => edit(item)}>Edit</button>
									<button className="danger" type="button" onClick={async () => { await ctx.core.items.remove(item.id); reload(); }}>Delete</button>
								</td>
							</tr>
						))}
						{items.length === 0 && <tr><td colSpan={7} className="muted">Nothing on the list yet.</td></tr>}
					</tbody>
				</table>
			</div>
		</div>
	);
}
