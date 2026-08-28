import { useEffect, useMemo, useRef, useState } from "react";
import {
	DEV_CONFIG_KEY_ID,
	DEV_CONFIG_SIGNING_PUBLIC_KEY_HEX,
} from "../../../packages/test-fixtures/src";
import { getRuntimeInfo, tauriCrypto, tauriDb, type RuntimeInfo } from "../core/db";
import { startBridgeHandler } from "../core/bridgeHandler";
import { SidecarCore } from "../core/services";
import { ExportService, SyncService } from "../core/sync";
import { ConfigPacksSection } from "./sections/ConfigPacksSection";
import { ExportSection } from "./sections/ExportSection";
import { LedgerSection } from "./sections/LedgerSection";
import { PlanHistorySection, TodaysPlanSection } from "./sections/PlanSections";
import { PreferencesSection } from "./sections/PreferencesSection";
import { PrivacySection } from "./sections/PrivacySection";
import { ShoppingListSection } from "./sections/ShoppingListSection";
import { SnapshotsSection } from "./sections/SnapshotsSection";

const SECTIONS = [
	{ id: "today", label: "Today's plan" },
	{ id: "shopping", label: "Shopping list" },
	{ id: "preferences", label: "Preferences & limits" },
	{ id: "snapshots", label: "Cart snapshots" },
	{ id: "history", label: "Plan history" },
	{ id: "ledger", label: "Action ledger" },
	{ id: "privacy", label: "Privacy & sync" },
	{ id: "packs", label: "Configuration packs" },
	{ id: "data", label: "Export / Delete data" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export type Ctx = {
	core: SidecarCore;
	sync: SyncService;
	exporter: ExportService;
	runtime: RuntimeInfo;
	refreshKey: number;
	refresh: () => void;
};

function apiBaseUrl(): string {
	return (
		localStorage.getItem("pi_api_base") ??
		(import.meta.env.VITE_PI_API_BASE as string | undefined) ??
		"http://localhost:8787"
	);
}

export function App() {
	const [ctx, setCtx] = useState<Ctx>();
	const [initError, setInitError] = useState<string>();
	const [section, setSection] = useState<SectionId>("today");
	const [refreshKey, setRefreshKey] = useState(0);
	const startedRef = useRef(false);

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		(async () => {
			try {
				const runtime = await getRuntimeInfo();
				const core = new SidecarCore(tauriDb, tauriCrypto, {
					appVersion: runtime.version,
					apiBaseUrl: apiBaseUrl(),
					configPackPublicKeyHex:
						(import.meta.env.VITE_CONFIG_PACK_PUBLIC_KEY as string | undefined) ??
						DEV_CONFIG_SIGNING_PUBLIC_KEY_HEX,
					configPackKeyId:
						(import.meta.env.VITE_CONFIG_PACK_KEY_ID as string | undefined) ?? DEV_CONFIG_KEY_ID,
				});
				const sync = new SyncService(core);
				const exporter = new ExportService(core);
				await startBridgeHandler(core, sync, () => setRefreshKey((key) => key + 1));
				setCtx({
					core,
					sync,
					exporter,
					runtime,
					refreshKey: 0,
					refresh: () => setRefreshKey((key) => key + 1),
				});
			} catch (error) {
				setInitError(String(error));
			}
		})();
	}, []);

	const liveCtx = useMemo(
		() => (ctx ? { ...ctx, refreshKey, refresh: () => setRefreshKey((key) => key + 1) } : undefined),
		[ctx, refreshKey],
	);

	if (initError) {
		return <div style={{ padding: 32 }}>Sidecar failed to initialize: {initError}</div>;
	}
	if (!liveCtx) {
		return <div style={{ padding: 32 }}>Starting local sidecar…</div>;
	}

	return (
		<div className="app">
			<nav className="nav">
				<h1>Purchasing Intelligence</h1>
				<div className="tagline">Private on this device · No checkout automation</div>
				{SECTIONS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						className={section === entry.id ? "active" : ""}
						onClick={() => setSection(entry.id)}
					>
						{entry.label}
					</button>
				))}
			</nav>
			<main className="content">
				{section === "today" && <TodaysPlanSection ctx={liveCtx} />}
				{section === "shopping" && <ShoppingListSection ctx={liveCtx} />}
				{section === "preferences" && <PreferencesSection ctx={liveCtx} />}
				{section === "snapshots" && <SnapshotsSection ctx={liveCtx} />}
				{section === "history" && <PlanHistorySection ctx={liveCtx} />}
				{section === "ledger" && <LedgerSection ctx={liveCtx} />}
				{section === "privacy" && <PrivacySection ctx={liveCtx} />}
				{section === "packs" && <ConfigPacksSection ctx={liveCtx} />}
				{section === "data" && <ExportSection ctx={liveCtx} />}
			</main>
		</div>
	);
}
