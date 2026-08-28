import { useEffect, useState } from "react";
import type { ConfigPackSummary } from "../../../../packages/protocol/src";
import type { Ctx } from "../App";

export function ConfigPacksSection({ ctx }: { ctx: Ctx }) {
	const [packs, setPacks] = useState<ConfigPackSummary[]>([]);
	const [status, setStatus] = useState("");
	const [statusIsError, setStatusIsError] = useState(false);

	const reload = () => ctx.core.packs.summaries().then(setPacks);
	useEffect(() => {
		reload();
	}, [ctx.refreshKey]);

	async function run(task: () => Promise<string>) {
		try {
			setStatusIsError(false);
			setStatus(await task());
		} catch (error) {
			setStatusIsError(true);
			setStatus(String(error instanceof Error ? error.message : error));
		}
		reload();
	}

	return (
		<div>
			<h2>Configuration packs</h2>
			<p className="subtitle">
				Signed, data-only adapter configuration. Verified with Ed25519 before use; a disabled, expired,
				or unverifiable pack means adapters fall back to generic scan-only behavior. Packs can never
				enable checkout, credential access, new action types, or approval bypasses — those constraints
				live in code, not configuration.
			</p>

			<div className="card">
				<div className="row">
					<button className="primary" type="button" onClick={() => run(() => ctx.sync.checkForConfigPacks())}>
						Check for updates (user-initiated)
					</button>
					<button className="secondary" type="button" onClick={() => run(() => ctx.sync.loadLocalDevPack())}>
						Load local dev pack (NON-PRODUCTION key)
					</button>
				</div>
				<div className={`statusline ${statusIsError ? "error" : ""}`}>{status}</div>
				<div className="muted">There is no background polling; updates only happen when you click.</div>
			</div>

			<div className="card">
				<h3>Stored packs</h3>
				<table>
					<thead><tr><th>Pack</th><th>Version</th><th>Stage</th><th>Issued</th><th>Expires</th><th>State</th><th /></tr></thead>
					<tbody>
						{packs.map((pack) => (
							<tr key={`${pack.packId}@${pack.version}`}>
								<td>{pack.packId}</td>
								<td>{pack.version}</td>
								<td>{pack.rolloutStage}</td>
								<td>{new Date(pack.issuedAt).toLocaleDateString()}</td>
								<td>{pack.expiresAt ? new Date(pack.expiresAt).toLocaleDateString() : "—"}</td>
								<td>
									{pack.active ? <span className="badge green">Active</span> : pack.verified ? <span className="badge gray">Verified, inactive</span> : <span className="badge red">Unverified</span>}
								</td>
								<td className="row">
									{pack.active && (
										<>
											<button className="secondary" type="button" onClick={() => run(async () => {
												await ctx.core.packs.deactivate(pack.packId, "manually disabled by user");
												await ctx.core.ledger.append("config_pack_disabled", "configuration_pack", pack.packId, {});
												return `Disabled ${pack.packId}. Adapters fall back to generic scan-only.`;
											})}>Disable</button>
											<button className="secondary" type="button" onClick={() => run(async () => {
												const previous = await ctx.core.packs.rollback(pack.packId);
												return previous ? `Rolled back to ${previous}.` : "No previous version to roll back to.";
											})}>Roll back</button>
										</>
									)}
								</td>
							</tr>
						))}
						{packs.length === 0 && <tr><td colSpan={7} className="muted">No configuration packs stored. Without one, only generic scan-only behavior is available.</td></tr>}
					</tbody>
				</table>
			</div>
		</div>
	);
}
