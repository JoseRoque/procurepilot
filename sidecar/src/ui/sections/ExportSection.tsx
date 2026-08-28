import { useState } from "react";
import type { Ctx } from "../App";

const RETAINED_AFTER_CLEAR_ALL = [
	"Install metadata (device id, schema version) — required for the app to function.",
	"The active consent receipt — the record of your own current privacy choice.",
	"Signed public configuration packs — public artifacts, not personal data.",
];

export function ExportSection({ ctx }: { ctx: Ctx }) {
	const [status, setStatus] = useState("");
	const [confirming, setConfirming] = useState<string>();

	async function run(label: string, task: () => Promise<unknown>) {
		try {
			const result = await task();
			setStatus(typeof result === "string" ? result : `${label} complete.`);
		} catch (error) {
			setStatus(String(error instanceof Error ? error.message : error));
		}
		setConfirming(undefined);
		ctx.refresh();
	}

	function ConfirmButtons({ id, label, danger, onConfirm }: { id: string; label: string; danger?: boolean; onConfirm: () => void }) {
		if (confirming === id) {
			return (
				<span className="row">
					<span className="muted">Are you sure?</span>
					<button className="danger" type="button" onClick={onConfirm}>Yes, {label.toLowerCase()}</button>
					<button className="secondary" type="button" onClick={() => setConfirming(undefined)}>Cancel</button>
				</span>
			);
		}
		return (
			<button className={danger ? "danger" : "secondary"} type="button" onClick={() => setConfirming(id)}>
				{label}
			</button>
		);
	}

	return (
		<div>
			<h2>Export / Delete local data</h2>
			<p className="subtitle">User-controlled tools. Nothing here uploads anything.</p>

			<div className="card">
				<h3>Export</h3>
				<div className="notice warn">
					The export contains sensitive local purchasing information (your shopping list, exact cart
					lines, plans, and ledger). It is written to a local file only and is never uploaded or shared
					automatically.
				</div>
				<button className="primary" type="button" onClick={() => run("Export", async () => `Exported to: ${await ctx.exporter.exportAll()}`)}>
					Export local data (JSON)
				</button>
			</div>

			<div className="card">
				<h3>Clear data</h3>
				<div className="row" style={{ gap: 12 }}>
					<ConfirmButtons id="snaps" label="Clear cart snapshots" onConfirm={() => run("Clear snapshots", () => ctx.exporter.clearSnapshots())} />
					<ConfirmButtons id="plans" label="Clear plan history" onConfirm={() => run("Clear plans", () => ctx.exporter.clearPlans())} />
					<ConfirmButtons id="ledger" label="Clear action ledger" onConfirm={() => run("Clear ledger", () => ctx.exporter.clearLedger())} />
					<ConfirmButtons id="all" label="Clear ALL local private data" danger onConfirm={() => run("Full wipe", () => ctx.exporter.clearAllPrivateData())} />
				</div>
				<div className="muted" style={{ marginTop: 10 }}>
					After "Clear ALL", the following minimum records are retained, and nothing else:
					<ul className="plain">
						{RETAINED_AFTER_CLEAR_ALL.map((line) => <li key={line}>{line}</li>)}
					</ul>
					Clearing the ledger discards its verification history (the hash chain restarts).
				</div>
				<div className="statusline">{status}</div>
			</div>
		</div>
	);
}
