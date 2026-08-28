import type {
	LocalBridgeRequest,
	LocalBridgeResponse,
} from "../../../packages/protocol/src/bridge";

/**
 * Extension side of the loopback bridge (alpha). Talks only to
 * 127.0.0.1:<port> with the per-install pairing token the user copied from
 * the sidecar UI. Native Messaging is the documented hardened successor.
 */

export type SidecarConnection = {
	port: number;
	pairingToken: string;
};

export type SidecarUiStatus =
	| "connected"
	| "unavailable"
	| "pairing_required"
	| "local_only_fallback";

const STORAGE_KEY = "pi_sidecar_connection";
const FLAG_KEY = "pi_sidecar_enabled";
export const DEFAULT_BRIDGE_PORT = 43180;

export async function getSidecarEnabled(): Promise<boolean> {
	const result = await chrome.storage.local.get(FLAG_KEY);
	return Boolean(result[FLAG_KEY]);
}

export async function setSidecarEnabled(enabled: boolean): Promise<void> {
	await chrome.storage.local.set({ [FLAG_KEY]: enabled });
}

export async function getConnection(): Promise<SidecarConnection | undefined> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] as SidecarConnection | undefined;
}

export async function saveConnection(connection: SidecarConnection): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: connection });
}

export async function clearConnection(): Promise<void> {
	await chrome.storage.local.remove(STORAGE_KEY);
}

/** The loopback host permission is optional and requested only at pairing. */
export function bridgeOriginPattern(port: number): string {
	return `http://127.0.0.1:${port}/*`;
}

export async function hasBridgePermission(port: number): Promise<boolean> {
	return chrome.permissions.contains({ origins: [bridgeOriginPattern(port)] });
}

export async function requestBridgePermission(port: number): Promise<boolean> {
	return chrome.permissions.request({ origins: [bridgeOriginPattern(port)] });
}

export async function bridgeRequest(
	request: LocalBridgeRequest,
	connection?: SidecarConnection,
): Promise<LocalBridgeResponse> {
	const conn = connection ?? (await getConnection());
	if (!conn) {
		return { ok: false, error: { code: "NOT_PAIRED", message: "Sidecar is not paired." } };
	}
	try {
		const response = await fetch(`http://127.0.0.1:${conn.port}/bridge`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-PI-Pairing-Token": conn.pairingToken,
			},
			body: JSON.stringify(request),
		});
		return (await response.json()) as LocalBridgeResponse;
	} catch {
		return {
			ok: false,
			error: { code: "SIDECAR_UNAVAILABLE", message: "The local sidecar is not reachable." },
		};
	}
}

export async function probeStatus(): Promise<SidecarUiStatus> {
	if (!(await getSidecarEnabled())) return "local_only_fallback";
	const connection = await getConnection();
	if (!connection) return "pairing_required";
	if (!(await hasBridgePermission(connection.port))) return "pairing_required";
	const response = await bridgeRequest({ type: "GET_SIDECAR_STATUS" }, connection);
	if (response.ok && response.type === "SIDECAR_STATUS") return "connected";
	if (!response.ok && response.error.code === "UNAUTHORIZED") return "pairing_required";
	return "unavailable";
}
