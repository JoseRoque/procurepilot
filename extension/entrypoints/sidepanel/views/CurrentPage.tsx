import { Badge } from "../components/Badge";
import { Section } from "../components/Section";
import type { ScanUiState } from "../hooks/useScanState";
import { PLATFORM_LABELS, type DetectionStatus } from "@/lib/types";

const STATUS_LABEL: Record<DetectionStatus, string> = {
	supported: "Supported",
	experimental: "Experimental",
	not_detected: "Not detected",
	scan_unavailable: "Scan unavailable on this page",
};

const STATUS_TONE: Record<DetectionStatus, "success" | "warning" | "neutral"> = {
	supported: "success",
	experimental: "warning",
	not_detected: "neutral",
	scan_unavailable: "neutral",
};

export function CurrentPage({ scanState, onScan }: { scanState: ScanUiState; onScan: () => void }) {
	const isScanning = scanState.phase === "scanning" && scanState.detectionStatus === undefined;

	let platformLabel = "Unknown page";
	let detectionStatus: DetectionStatus | undefined;
	let scanTimestamp: string | undefined;

	if (scanState.phase === "scanning" && scanState.platform) {
		platformLabel = PLATFORM_LABELS[scanState.platform];
		detectionStatus = scanState.detectionStatus;
	} else if (scanState.phase === "complete") {
		platformLabel = scanState.snapshot.platformLabel;
		detectionStatus = scanState.snapshot.detectionStatus;
		scanTimestamp = new Date(scanState.snapshot.createdAt).toLocaleString();
	}

	return (
		<Section title="Current page">
			<div className="flex items-center justify-between">
				<span className="text-sm font-medium text-slate-900">{platformLabel}</span>
				{detectionStatus ? <Badge tone={STATUS_TONE[detectionStatus]}>{STATUS_LABEL[detectionStatus]}</Badge> : null}
			</div>

			{scanTimestamp ? <p className="mt-1 text-xs text-slate-500">Last scanned {scanTimestamp}</p> : null}

			<button
				type="button"
				onClick={onScan}
				disabled={isScanning}
				className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{isScanning ? "Scanning…" : "Scan current cart"}
			</button>

			<p className="mt-3 text-xs leading-5 text-slate-500">
				Scanning reads only visible cart and offer text on this page. It never reads payment data,
				passwords, or cookies, and nothing leaves this device.
			</p>
		</Section>
	);
}
