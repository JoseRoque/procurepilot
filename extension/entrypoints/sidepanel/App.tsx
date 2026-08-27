import { useEffect, useState } from "react";
import { usePreferences } from "./hooks/usePreferences";
import { useSavedSnapshots } from "./hooks/useSavedSnapshots";
import { useScanState } from "./hooks/useScanState";
import { CurrentPage } from "./views/CurrentPage";
import { Demo } from "./views/Demo";
import { Preferences } from "./views/Preferences";
import { Recommendation } from "./views/Recommendation";
import { SavedComparisons } from "./views/SavedComparisons";
import { ScanResult } from "./views/ScanResult";
import { Welcome } from "./views/Welcome";

type Tab = "home" | "saved" | "preferences" | "demo";

const TABS: { id: Tab; label: string }[] = [
	{ id: "home", label: "Home" },
	{ id: "saved", label: "Saved" },
	{ id: "preferences", label: "Preferences" },
	{ id: "demo", label: "Demo" },
];

const WELCOME_DISMISSED_KEY = "pi_welcome_dismissed";

export function App() {
	const [activeTab, setActiveTab] = useState<Tab>("home");
	const [showWelcome, setShowWelcome] = useState(false);

	const { state: scanState, startScan } = useScanState();
	const { preferences, updatePreferences } = usePreferences();
	const savedSnapshots = useSavedSnapshots();
	const [saveConfirmation, setSaveConfirmation] = useState<string | undefined>();

	useEffect(() => {
		chrome.storage.local.get(WELCOME_DISMISSED_KEY).then((result) => {
			setShowWelcome(!result[WELCOME_DISMISSED_KEY]);
		});
	}, []);

	function dismissWelcome() {
		chrome.storage.local.set({ [WELCOME_DISMISSED_KEY]: true }).catch(() => {});
		setShowWelcome(false);
	}

	async function handleSave() {
		if (scanState.phase !== "complete") return;
		const ok = await savedSnapshots.save(scanState.snapshot);
		setSaveConfirmation(ok ? "Scan saved locally." : "Could not save this scan.");
		setTimeout(() => setSaveConfirmation(undefined), 3000);
	}

	return (
		<div className="flex h-screen flex-col bg-slate-50">
			<header className="border-b border-slate-200 bg-white px-4 py-3">
				<h1 className="text-sm font-semibold text-slate-900">Purchasing Intelligence</h1>
				<p className="text-xs text-slate-500">Local-first purchase recommendations</p>
			</header>

			<nav className="flex border-b border-slate-200 bg-white px-2" aria-label="Sections">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						aria-current={activeTab === tab.id ? "page" : undefined}
						className={`px-3 py-2.5 text-xs font-medium ${
							activeTab === tab.id
								? "border-b-2 border-slate-900 text-slate-900"
								: "text-slate-500 hover:text-slate-800"
						}`}
					>
						{tab.label}
					</button>
				))}
			</nav>

			<main className="flex-1 space-y-4 overflow-y-auto p-4">
				{showWelcome ? <Welcome onDismiss={dismissWelcome} /> : null}

				{activeTab === "home" ? (
					<>
						<CurrentPage scanState={scanState} onScan={startScan} />

						{scanState.phase === "failed" ? (
							<div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
								{scanState.reason}
							</div>
						) : null}

						{scanState.phase === "complete" ? (
							<>
								<ScanResult snapshot={scanState.snapshot} />
								<Recommendation recommendation={scanState.recommendation} />
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={handleSave}
										className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
									>
										Save scan
									</button>
									{saveConfirmation ? <span className="text-xs text-slate-500">{saveConfirmation}</span> : null}
								</div>
							</>
						) : null}
					</>
				) : null}

				{activeTab === "saved" ? (
					<SavedComparisons
						snapshots={savedSnapshots.snapshots}
						loading={savedSnapshots.loading}
						error={savedSnapshots.error}
						onDelete={savedSnapshots.remove}
						onClearAll={savedSnapshots.clearAll}
					/>
				) : null}

				{activeTab === "preferences" ? (
					<Preferences preferences={preferences} onChange={updatePreferences} />
				) : null}

				{activeTab === "demo" ? <Demo preferences={preferences} /> : null}
			</main>
		</div>
	);
}
