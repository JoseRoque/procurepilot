import { useEffect, useState } from "react";
import type { PurchasePlan, Recommendation } from "../../../../packages/domain/src";
import { formatCents } from "../../../../packages/optimizer/src";
import type { Ctx } from "../App";

function money(cents?: number): string {
	return cents === undefined ? "Not detected" : formatCents(cents);
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
	const tone = confidence === "high" ? "green" : confidence === "medium" ? "amber" : "gray";
	return <span className={`badge ${tone}`}>{confidence} confidence</span>;
}

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
	return (
		<div className="card">
			<div className="row" style={{ justifyContent: "space-between" }}>
				<h3>{recommendation.headline}</h3>
				<ConfidenceBadge confidence={recommendation.confidence} />
			</div>
			{recommendation.evidence.length > 0 && (
				<>
					<div className="muted">Observed on this page</div>
					<ul className="plain">{recommendation.evidence.map((line, i) => <li key={i}>{line}</li>)}</ul>
				</>
			)}
			{recommendation.arithmetic.length > 0 && (
				<>
					<div className="muted">Arithmetic</div>
					<ul className="plain">{recommendation.arithmetic.map((line, i) => <li key={i}>{line}</li>)}</ul>
				</>
			)}
			{recommendation.assumptions.length > 0 && (
				<>
					<div className="muted">Assumptions</div>
					<ul className="plain">{recommendation.assumptions.map((line, i) => <li key={i}>{line}</li>)}</ul>
				</>
			)}
			{recommendation.warnings.length > 0 && (
				<div className="notice warn">{recommendation.warnings.join(" ")}</div>
			)}
			<div className="muted">
				Next safe step: <strong>{recommendation.nextSafeUserAction}</strong>
			</div>
		</div>
	);
}

export function PlanView({ plan }: { plan: PurchasePlan }) {
	return (
		<div>
			<div className="card">
				<div className="row" style={{ justifyContent: "space-between" }}>
					<h3>Plan {plan.id.slice(0, 8)} · {plan.status.replaceAll("_", " ")}</h3>
					<ConfidenceBadge confidence={plan.confidence} />
				</div>
				<div className="grid2">
					<div>
						<div className="muted">Observed cost (basis: {plan.observedCost.basis.replaceAll("_", " ")})</div>
						<table>
							<tbody>
								<tr><td>Subtotal</td><td>{money(plan.observedCost.subtotalCents)}</td></tr>
								<tr><td>Discounts</td><td>{money(plan.observedCost.discountsCents)}</td></tr>
								<tr><td>Delivery fee</td><td>{money(plan.observedCost.deliveryFeeCents)}</td></tr>
								<tr><td>Service fee</td><td>{money(plan.observedCost.serviceFeeCents)}</td></tr>
								<tr><td>Tax</td><td>{money(plan.observedCost.taxCents)}</td></tr>
								<tr><td>Credits</td><td>{money(plan.observedCost.visibleCreditsCents)}</td></tr>
								<tr><td><strong>Displayed total</strong></td><td><strong>{money(plan.observedCost.displayedFinalTotalCents)}</strong></td></tr>
								<tr><td>Calculated total</td><td>{money(plan.observedCost.calculatedTotalCents)}</td></tr>
							</tbody>
						</table>
					</div>
					<div>
						<div className="muted">Items</div>
						<table>
							<thead><tr><th>Item</th><th>Required</th><th>Status</th></tr></thead>
							<tbody>
								{[...plan.requiredItems, ...plan.optionalItems].map((item, i) => (
									<tr key={i}>
										<td>{item.displayName}</td>
										<td>{item.required ? "Required" : "Optional"}</td>
										<td>
											<span className={`badge ${item.status === "in_cart" ? "green" : item.status === "unavailable" ? "red" : "amber"}`}>
												{item.status.replaceAll("_", " ")}
											</span>
											{item.notes.length > 0 && <div className="muted">{item.notes.join(" ")}</div>}
										</td>
									</tr>
								))}
								{plan.requiredItems.length + plan.optionalItems.length === 0 && (
									<tr><td colSpan={3} className="muted">No shopping-list items mapped for this plan.</td></tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
				{plan.assumptions.length > 0 && (
					<>
						<div className="muted" style={{ marginTop: 10 }}>Assumptions</div>
						<ul className="plain">{plan.assumptions.map((line, i) => <li key={i}>{line}</li>)}</ul>
					</>
				)}
				{plan.warnings.length > 0 && <div className="notice warn">{plan.warnings.join(" · ")}</div>}
				<div className="muted">
					Policy {plan.policyVersion}
					{plan.configPackVersion ? ` · config pack ${plan.configPackVersion}` : " · no config pack"}
					{plan.adapterVersion ? ` · adapter ${plan.adapterVersion}` : ""}
				</div>
			</div>
			{plan.recommendations.map((recommendation, index) => (
				<RecommendationCard key={index} recommendation={recommendation} />
			))}
			{plan.proposedActions.length > 0 && (
				<div className="card">
					<h3>Actions on this plan</h3>
					<table>
						<thead><tr><th>#</th><th>Action</th><th>Status</th></tr></thead>
						<tbody>
							{plan.proposedActions.map((action) => (
								<tr key={action.id}>
									<td>{action.actionSequence}</td>
									<td>{action.userVisibleSummary}</td>
									<td><span className={`badge ${action.status === "succeeded" ? "green" : action.status === "declined" || action.status === "failed" ? "red" : "gray"}`}>{action.status.replaceAll("_", " ")}</span></td>
								</tr>
							))}
						</tbody>
					</table>
					<div className="muted">Every action requires explicit approval in the extension before it runs. No checkout automation exists.</div>
				</div>
			)}
		</div>
	);
}

export function TodaysPlanSection({ ctx }: { ctx: Ctx }) {
	const [plan, setPlan] = useState<PurchasePlan>();
	useEffect(() => {
		ctx.core.plans.list(1).then(async (plans) => {
			const latest = plans[0];
			if (!latest) return setPlan(undefined);
			setPlan(await ctx.core.getPlanWithActions(latest.id));
		});
	}, [ctx.refreshKey]);

	return (
		<div>
			<h2>Today's plan</h2>
			<p className="subtitle">The most recent purchase plan, built only from facts observed on scanned pages.</p>
			{plan ? (
				<PlanView plan={plan} />
			) : (
				<div className="card">
					<p>No purchase plan yet.</p>
					<p className="muted">
						Scan a supported cart page from the extension and choose "Create purchase plan", or load a
						demo snapshot under Cart snapshots (demo mode) to try the planner without a store.
					</p>
				</div>
			)}
		</div>
	);
}

export function PlanHistorySection({ ctx }: { ctx: Ctx }) {
	const [plans, setPlans] = useState<PurchasePlan[]>([]);
	const [selected, setSelected] = useState<PurchasePlan>();
	useEffect(() => {
		ctx.core.plans.list(50).then(setPlans);
	}, [ctx.refreshKey]);

	return (
		<div>
			<h2>Plan history</h2>
			<p className="subtitle">Every locally saved purchase plan.</p>
			<div className="card">
				<table>
					<thead><tr><th>Created</th><th>Status</th><th>Observed total</th><th>Top recommendation</th><th /></tr></thead>
					<tbody>
						{plans.map((plan) => (
							<tr key={plan.id}>
								<td>{new Date(plan.createdAt).toLocaleString()}</td>
								<td>{plan.status.replaceAll("_", " ")}</td>
								<td>{money(plan.observedCost.displayedFinalTotalCents ?? plan.observedCost.calculatedTotalCents)}</td>
								<td>{plan.recommendations[0]?.headline ?? "—"}</td>
								<td><button className="secondary" type="button" onClick={async () => setSelected(await ctx.core.getPlanWithActions(plan.id))}>View</button></td>
							</tr>
						))}
						{plans.length === 0 && <tr><td colSpan={5} className="muted">No plans saved yet.</td></tr>}
					</tbody>
				</table>
			</div>
			{selected && <PlanView plan={selected} />}
		</div>
	);
}
