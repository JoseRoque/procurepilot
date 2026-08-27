import { useCallback, useEffect, useState } from "react";
import { parseExtensionMessage } from "@/lib/messages";
import { getLatestScan } from "@/lib/storage/settings";
import type { CartRecommendation, CartSnapshot, DetectionStatus, SupportedPlatform } from "@/lib/types";

export type ScanUiState =
	| { phase: "idle" }
	| { phase: "scanning"; platform?: SupportedPlatform; detectionStatus?: DetectionStatus }
	| { phase: "complete"; snapshot: CartSnapshot; recommendation: CartRecommendation }
	| { phase: "failed"; reason: string };

type LatestScanRecord = { snapshot: CartSnapshot; recommendation: CartRecommendation };

export function useScanState() {
	const [state, setState] = useState<ScanUiState>({ phase: "idle" });

	useEffect(() => {
		let cancelled = false;
		getLatestScan<LatestScanRecord>().then((latest) => {
			if (!cancelled && latest) {
				setState({ phase: "complete", snapshot: latest.snapshot, recommendation: latest.recommendation });
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		function onMessage(raw: unknown) {
			const message = parseExtensionMessage(raw);
			if (!message) return;

			switch (message.type) {
				case "PAGE_DETECTION_RESULT":
					setState({
						phase: "scanning",
						platform: message.payload.platform,
						detectionStatus: message.payload.detectionStatus,
					});
					break;
				case "CART_SCAN_COMPLETE":
					setState({
						phase: "complete",
						snapshot: message.payload.snapshot,
						recommendation: message.payload.recommendation,
					});
					break;
				case "CART_SCAN_FAILED":
					setState({ phase: "failed", reason: message.payload.reason });
					break;
				default:
					break;
			}
		}

		chrome.runtime.onMessage.addListener(onMessage);
		return () => chrome.runtime.onMessage.removeListener(onMessage);
	}, []);

	const startScan = useCallback(() => {
		setState({ phase: "scanning" });
		chrome.runtime.sendMessage({ type: "SCAN_CURRENT_PAGE", payload: {} }).catch(() => {
			setState({ phase: "failed", reason: "Could not reach the extension's background service. Try again." });
		});
	}, []);

	const clearScan = useCallback(() => {
		setState({ phase: "idle" });
	}, []);

	return { state, startScan, clearScan, setState };
}
