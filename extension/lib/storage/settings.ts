import { DEFAULT_PREFERENCES, type ShoppingPreferences } from "../types";

const PREFERENCES_KEY = "pi_preferences";
const INSTALL_METADATA_KEY = "pi_install_metadata";
const LATEST_SCAN_KEY = "pi_latest_scan";

export type InstallMetadata = {
	installedAt: string;
	extensionVersion: string;
};

/**
 * chrome.storage.local wrapper for small, non-structured state: user
 * preferences, install metadata, and the most recent (possibly unsaved) scan
 * result. Large/structured records (saved cart snapshots) live in IndexedDB
 * instead — see storage/db.ts.
 */

export async function getPreferences(): Promise<ShoppingPreferences> {
	const result = await chrome.storage.local.get(PREFERENCES_KEY);
	const stored = result[PREFERENCES_KEY] as Partial<ShoppingPreferences> | undefined;
	return { ...DEFAULT_PREFERENCES, ...stored, localOnly: true };
}

export async function setPreferences(preferences: ShoppingPreferences): Promise<void> {
	// localOnly is locked on in this release regardless of what's passed in.
	await chrome.storage.local.set({
		[PREFERENCES_KEY]: { ...preferences, localOnly: true },
	});
}

export async function getInstallMetadata(): Promise<InstallMetadata | undefined> {
	const result = await chrome.storage.local.get(INSTALL_METADATA_KEY);
	return result[INSTALL_METADATA_KEY] as InstallMetadata | undefined;
}

export async function setInstallMetadata(metadata: InstallMetadata): Promise<void> {
	await chrome.storage.local.set({ [INSTALL_METADATA_KEY]: metadata });
}

/**
 * The most recently completed scan (snapshot + recommendation), kept small
 * and JSON-serializable so it survives a service worker restart. This is
 * *not* the saved-comparisons list — saving is a separate, explicit action.
 */
export async function getLatestScan<T>(): Promise<T | undefined> {
	const result = await chrome.storage.local.get(LATEST_SCAN_KEY);
	return result[LATEST_SCAN_KEY] as T | undefined;
}

export async function setLatestScan<T>(value: T): Promise<void> {
	await chrome.storage.local.set({ [LATEST_SCAN_KEY]: value });
}

export async function clearLatestScan(): Promise<void> {
	await chrome.storage.local.remove(LATEST_SCAN_KEY);
}
