/**
 * Device-scoped bearer authentication for the Purchasing Intelligence API.
 *
 * The sidecar holds a random device token; the server stores only its
 * SHA-256 hash, so a database read never yields a usable credential. This is
 * a single-user alpha mechanism: there is no user identity, no login, and no
 * email anywhere in this path — the only identifier is the sidecar-generated
 * pseudonymous device id.
 */

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function generateDeviceToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export type AuthedDevice = {
	id: string;
	pseudonymousDeviceId: string;
};

export type DeviceAuthResult =
	| { ok: true; device: AuthedDevice }
	| { ok: false; status: 401; message: string };

export async function requireDevice(
	request: Request,
	db: D1Database,
): Promise<DeviceAuthResult> {
	const header = request.headers.get("authorization") ?? "";
	const token = BEARER_PATTERN.exec(header)?.[1]?.trim();
	if (!token) {
		return { ok: false, status: 401, message: "Missing device credentials." };
	}
	// Look the device up BY HASH — the raw token is never stored or compared
	// as a string, so there is nothing to leak or timing-compare here.
	const row = await db
		.prepare(
			"SELECT id, pseudonymous_device_id FROM devices WHERE device_token_hash = ? AND deleted_at IS NULL LIMIT 1",
		)
		.bind(await sha256Hex(token))
		.first<{ id: string; pseudonymous_device_id: string }>();
	if (!row) {
		return { ok: false, status: 401, message: "Invalid device credentials." };
	}
	return {
		ok: true,
		device: { id: row.id, pseudonymousDeviceId: row.pseudonymous_device_id },
	};
}
