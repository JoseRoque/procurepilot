import { useEffect, useState } from "react";
import { CONSENT_SCOPE_LINES } from "../../../../packages/domain/src";
import type { ConsentReceipt, PrivacyMode } from "../../../../packages/domain/src";
import type { SyncStatus } from "../../../../packages/protocol/src";
import type { Ctx } from "../App";

export function PrivacySection({ ctx }: { ctx: Ctx }) {
	const [receipt, setReceipt] = useState<ConsentReceipt>();
	const [syncStatus, setSyncStatus] = useState<SyncStatus>();
	const [status, setStatus] = useState("");
	const [statusIsError, setStatusIsError] = useState(false);
	const [apiBase, setApiBase] = useState(localStorage.getItem("pi_api_base") ?? "http://localhost:8787");

	const reload = () => {
		ctx.core.consent.active().then(setReceipt);
		ctx.sync.status().then(setSyncStatus);
	};
	useEffect(reload, [ctx.refreshKey]);

	async function run(label: string, task: () => Promise<unknown>) {
		try {
			setStatusIsError(false);
			const result = await task();
			setStatus(typeof result === "string" ? result : `${label} done.`);
		} catch (error) {
			setStatusIsError(true);
			setStatus(String(error instanceof Error ? error.message : error));
		}
		reload();
	}

	async function setMode(mode: PrivacyMode) {
		await run("Consent updated", () => ctx.core.setPrivacyMode(mode));
	}

	const mode = receipt?.privacyMode ?? "local_only";

	return (
		<div>
			<h2>Privacy & sync</h2>
			<p className="subtitle">Exactly what is local, what is eligible for sync, and what has been synced.</p>

			<div className="card">
				<h3>Data locality</h3>
				<table>
					<tbody>
						<tr><td>Shopping list, preferences, snapshots, plans, actions, ledger</td><td><span className="badge green">Local only — this device</span></td></tr>
						<tr><td>Private encrypted backup</td><td><span className="badge gray">Not available in this version</span></td></tr>
						<tr><td>Redacted outcome events</td><td>{mode === "contribute_redacted_outcomes" ? <span className="badge amber">Eligible for sync after explicit flush</span> : <span className="badge gray">Contribution disabled</span>}</td></tr>
						<tr><td>Queued / synced events</td><td>{syncStatus ? `${syncStatus.queuedEvents} queued · ${syncStatus.syncedEvents} synced${syncStatus.lastSyncedAt ? ` · last ${new Date(syncStatus.lastSyncedAt).toLocaleString()}` : ""}` : "…"}</td></tr>
					</tbody>
				</table>
				<div className="muted">
					Local database: <span className="mono">{ctx.runtime.dbPath}</span> · field encryption:{" "}
					{ctx.runtime.encryptionAvailable ? (
						<span className="badge green">keychain-backed AES-256-GCM</span>
					) : (
						<span className="badge red">UNAVAILABLE — OS keychain not accessible; sensitive fields are stored unencrypted</span>
					)}
				</div>
			</div>

			<div className="card">
				<h3>Privacy mode</h3>
				<p>
					Current mode: <strong>{mode === "contribute_redacted_outcomes" ? "Redacted contribution enabled" : mode === "local_only" ? "Local-only" : mode}</strong>
					{receipt && <span className="muted"> · consent {receipt.consentVersion}, granted {new Date(receipt.grantedAt).toLocaleString()}</span>}
				</p>
				<ul className="plain">
					{CONSENT_SCOPE_LINES.local_only.map((line) => <li key={line}>{line}</li>)}
				</ul>
				{mode !== "contribute_redacted_outcomes" ? (
					<div>
						<div className="notice">
							Enabling redacted contribution means:
							<ul className="plain">
								{CONSENT_SCOPE_LINES.contribute_redacted_outcomes.map((line) => <li key={line}>{line}</li>)}
							</ul>
						</div>
						<button className="primary" type="button" onClick={() => setMode("contribute_redacted_outcomes")}>
							Enable redacted contribution (opt in)
						</button>
					</div>
				) : (
					<button className="danger" type="button" onClick={() => setMode("local_only")}>
						Revoke — return to local-only
					</button>
				)}
				<div className="muted" style={{ marginTop: 8 }}>
					Private backup: not available in this version. No backup implementation exists.
				</div>
			</div>

			<div className="card">
				<h3>Extension pairing</h3>
				<p className="muted">
					The extension connects via a loopback bridge (127.0.0.1:{ctx.runtime.bridgePort}, this device only).
					Paste this pairing token into the extension's side panel once:
				</p>
				<div className="mono" style={{ padding: 8, background: "#f4f5f7", borderRadius: 6 }}>{ctx.runtime.pairingToken}</div>
			</div>

			<div className="card">
				<h3>Cloud sync (explicit, user-initiated only)</h3>
				<label>Cloudflare API base URL
					<input value={apiBase} onChange={(e) => { setApiBase(e.target.value); localStorage.setItem("pi_api_base", e.target.value); }} style={{ width: 360 }} />
				</label>
				<div className="muted">Change requires app restart to take effect.</div>
				<div className="row" style={{ marginTop: 10 }}>
					<button className="secondary" type="button" onClick={() => run("Device registered", () => ctx.sync.registerDevice())} disabled={syncStatus?.deviceRegistered}>
						{syncStatus?.deviceRegistered ? "Device registered" : "Register pseudonymous device"}
					</button>
					<button className="secondary" type="button" onClick={() => run("Consent uploaded", () => ctx.sync.uploadConsentReceipt())}>
						Upload consent receipt
					</button>
					<button className="primary" type="button" onClick={() => run("Flush", async () => {
						const result = await ctx.sync.flushOutbox();
						return `Flushed: ${result.synced} synced, ${result.rejected} rejected.`;
					})}>
						Flush outbox now
					</button>
					<button className="danger" type="button" onClick={() => run("Deletion", () => ctx.sync.requestCloudDeletion())}>
						Request cloud deletion
					</button>
				</div>
				<div className={`statusline ${statusIsError ? "error" : ""}`}>{status}</div>
				<div className="muted">
					Nothing syncs automatically. With one user, uploaded events do not create shared deal intelligence.
				</div>
			</div>
		</div>
	);
}
