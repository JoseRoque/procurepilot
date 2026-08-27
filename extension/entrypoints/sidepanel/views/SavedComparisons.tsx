import { useState } from "react";
import { calculateObservedTotal } from "@/lib/engine";
import { formatCents } from "@/lib/money";
import type { CartSnapshot } from "@/lib/types";
import { Section } from "../components/Section";

function snapshotTotal(snapshot: CartSnapshot): number | undefined {
	return snapshot.displayedFinalTotal?.cents ?? calculateObservedTotal(snapshot);
}

function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export function SavedComparisons({
	snapshots,
	loading,
	error,
	onDelete,
	onClearAll,
}: {
	snapshots: CartSnapshot[];
	loading: boolean;
	error?: string;
	onDelete: (id: string) => void;
	onClearAll: () => void;
}) {
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [confirmingClear, setConfirmingClear] = useState(false);

	const selected = snapshots.find((snapshot) => snapshot.id === selectedId);

	return (
		<Section title="Saved comparisons">
			{error ? <p className="text-sm text-red-600">{error}</p> : null}
			{loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

			{!loading && snapshots.length === 0 ? (
				<p className="text-sm text-slate-500">No scans saved yet. Save a scan to compare it later.</p>
			) : null}

			<ul className="space-y-2">
				{snapshots.slice(0, 20).map((snapshot) => {
					const total = snapshotTotal(snapshot);
					return (
						<li
							key={snapshot.id}
							className={`rounded-md border p-2.5 text-sm ${
								selectedId === snapshot.id ? "border-slate-900" : "border-slate-200"
							}`}
						>
							<div className="flex items-center justify-between gap-2">
								<button
									type="button"
									onClick={() => setSelectedId(snapshot.id === selectedId ? undefined : snapshot.id)}
									className="text-left font-medium text-slate-800 hover:underline"
								>
									{snapshot.platformLabel} — {new Date(snapshot.createdAt).toLocaleString()}
								</button>
								<button
									type="button"
									onClick={() => onDelete(snapshot.id)}
									aria-label={`Delete scan from ${new Date(snapshot.createdAt).toLocaleString()}`}
									className="text-xs text-slate-400 hover:text-red-600"
								>
									Delete
								</button>
							</div>
							<p className="mt-1 text-xs text-slate-500">
								{total !== undefined ? `Total: ${formatCents(total)}` : "Total not available"}
							</p>
						</li>
					);
				})}
			</ul>

			{selected ? (
				<div className="mt-3 rounded-md bg-slate-50 p-2.5 text-xs text-slate-600">
					<p className="font-medium text-slate-800">Raw structured facts</p>
					<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">
						{JSON.stringify(selected, null, 2)}
					</pre>
				</div>
			) : null}

			{snapshots.length > 0 ? (
				<div className="mt-4 flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => downloadJson(`purchasing-intelligence-scans-${Date.now()}.json`, snapshots)}
						className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
					>
						Export as JSON
					</button>
					{confirmingClear ? (
						<>
							<span className="text-xs text-slate-600">Delete all {snapshots.length} saved scans?</span>
							<button
								type="button"
								onClick={() => {
									onClearAll();
									setConfirmingClear(false);
								}}
								className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
							>
								Confirm delete all
							</button>
							<button
								type="button"
								onClick={() => setConfirmingClear(false)}
								className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
							>
								Cancel
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setConfirmingClear(true)}
							className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
						>
							Clear all
						</button>
					)}
				</div>
			) : null}
		</Section>
	);
}
