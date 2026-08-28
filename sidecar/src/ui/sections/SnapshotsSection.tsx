import { useEffect, useState } from "react";
import type { CartSnapshot } from "../../../../packages/domain/src";
import { formatCents } from "../../../../packages/optimizer/src";
import {
	appliedDiscountAndCreditDraft,
	belowThresholdDraft,
	completeFixtureSnapshot,
	inconsistentTotalDraft,
	itemUnavailableDraft,
} from "../../../../packages/test-fixtures/src";
import type { Ctx } from "../App";

const DEMO_FIXTURES = [
	{ label: "Below threshold (30% off $35+)", draft: belowThresholdDraft },
	{ label: "Applied discount and credit", draft: appliedDiscountAndCreditDraft },
	{ label: "Inconsistent displayed total", draft: inconsistentTotalDraft },
	{ label: "Required item unavailable", draft: itemUnavailableDraft },
];

export function SnapshotsSection({ ctx }: { ctx: Ctx }) {
	const [snapshots, setSnapshots] = useState<CartSnapshot[]>([]);
	const [demoEnabled, setDemoEnabled] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		ctx.core.snapshots.list(20).then(setSnapshots);
		ctx.core.profile.get().then((profile) => setDemoEnabled(profile.preferences.demoModeEnabled));
	}, [ctx.refreshKey]);

	async function loadFixture(draft: (typeof DEMO_FIXTURES)[number]["draft"], label: string) {
		const snapshot = completeFixtureSnapshot(draft, crypto.randomUUID(), new Date().toISOString());
		await ctx.core.saveSnapshot(snapshot);
		setStatus(`Demo snapshot loaded: ${label}. Create a plan from it below.`);
		ctx.refresh();
	}

	async function createPlan(snapshotId: string) {
		const profile = await ctx.core.profile.get();
		await ctx.core.createPlan(snapshotId, profile.preferences);
		setStatus("Purchase plan created — see Today's plan.");
		ctx.refresh();
	}

	return (
		<div>
			<h2>Cart snapshots</h2>
			<p className="subtitle">
				Sanitized snapshots of visibly displayed cart facts. Exact line names are encrypted at rest;
				no raw page HTML or cookies are ever stored (schema-enforced).
			</p>

			{demoEnabled && (
				<div className="card">
					<h3>Demo fixtures</h3>
					<p className="muted">Sanitized static carts for trying the planner without visiting any store.</p>
					<div className="row">
						{DEMO_FIXTURES.map((fixture) => (
							<button key={fixture.label} className="secondary" type="button" onClick={() => loadFixture(fixture.draft, fixture.label)}>
								{fixture.label}
							</button>
						))}
					</div>
				</div>
			)}

			<div className="card">
				<h3>Saved snapshots ({snapshots.length})</h3>
				<table>
					<thead><tr><th>Captured</th><th>Platform</th><th>Subtotal</th><th>Displayed total</th><th>Confidence</th><th /></tr></thead>
					<tbody>
						{snapshots.map((snapshot) => (
							<tr key={snapshot.id}>
								<td>{new Date(snapshot.createdAt).toLocaleString()}</td>
								<td>{snapshot.platformLabel}</td>
								<td>{snapshot.subtotal ? formatCents(snapshot.subtotal.cents) : "Not detected"}</td>
								<td>{snapshot.displayedFinalTotal ? formatCents(snapshot.displayedFinalTotal.cents) : "Not detected"}</td>
								<td><span className={`badge ${snapshot.confidence === "high" ? "green" : snapshot.confidence === "medium" ? "amber" : "gray"}`}>{snapshot.confidence}</span></td>
								<td><button className="primary" type="button" onClick={() => createPlan(snapshot.id)}>Create purchase plan</button></td>
							</tr>
						))}
						{snapshots.length === 0 && <tr><td colSpan={6} className="muted">No snapshots yet. Scan a cart from the extension{demoEnabled ? " or load a demo fixture above" : " (or enable demo mode in Preferences)"}.</td></tr>}
					</tbody>
				</table>
				<div className="statusline">{status}</div>
			</div>
		</div>
	);
}
