import { useEffect, useState } from "react";
import type { LedgerEntry, LedgerVerification } from "../../core/ledger";
import type { Ctx } from "../App";

export function LedgerSection({ ctx }: { ctx: Ctx }) {
	const [entries, setEntries] = useState<LedgerEntry[]>([]);
	const [verification, setVerification] = useState<LedgerVerification>();

	useEffect(() => {
		ctx.core.ledger.list(200).then(setEntries);
	}, [ctx.refreshKey]);

	return (
		<div>
			<h2>Action ledger</h2>
			<p className="subtitle">
				Append-only, hash-chained record of every notable local event. Tamper-evident, not immutable:
				an attacker with full control of this device could rewrite it. It never leaves this device.
			</p>

			<div className="card">
				<div className="row">
					<button className="primary" type="button" onClick={async () => setVerification(await ctx.core.ledger.verify())}>
						Verify local ledger
					</button>
					{verification && (
						verification.valid ? (
							<span className="badge green">Chain valid — {verification.entries} entries</span>
						) : (
							<span className="badge red">
								Chain BROKEN at seq {verification.firstInvalidSeq}: {verification.reason}
							</span>
						)
					)}
				</div>
			</div>

			<div className="card">
				<table>
					<thead><tr><th>Seq</th><th>When</th><th>Event</th><th>Entity</th><th>Hash</th></tr></thead>
					<tbody>
						{entries.map((entry) => (
							<tr key={entry.id}>
								<td>{entry.seq}</td>
								<td>{new Date(entry.occurredAt).toLocaleString()}</td>
								<td>{entry.eventType}</td>
								<td className="muted">{entry.entityType} · {entry.entityId.slice(0, 8)}</td>
								<td className="mono">{entry.eventHash.slice(0, 16)}…</td>
							</tr>
						))}
						{entries.length === 0 && <tr><td colSpan={5} className="muted">Empty ledger.</td></tr>}
					</tbody>
				</table>
			</div>
		</div>
	);
}
