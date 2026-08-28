import { signAsync, verifyAsync } from "@noble/ed25519";
import { canonicalJson } from "../../protocol/src/hashing";
import { configurationPackSchema } from "./schema";
import type { ConfigurationPack, PackVerification } from "./types";

function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
		throw new Error("Invalid hex input.");
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** The signed material is the canonical JSON of the pack without its signature. */
export function packSigningPayload(pack: Omit<ConfigurationPack, "signature">): string {
	const { ...rest } = pack;
	return canonicalJson(rest);
}

/** Numeric dotted-version compare: returns negative/zero/positive like a comparator. */
export function compareVersions(a: string, b: string): number {
	const partsA = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const partsB = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const length = Math.max(partsA.length, partsB.length);
	for (let i = 0; i < length; i++) {
		const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export type VerifyOptions = {
	publicKeyHex: string;
	expectedKeyId?: string;
	nowIso?: string;
	extensionVersion?: string;
	sidecarVersion?: string;
};

/**
 * Full verification pipeline: structural allowlist schema → key id → Ed25519
 * signature → expiry → version constraints → rollout stage. A pack that
 * verifies but is disabled/stage-blocked returns ok with active:false — the
 * caller MUST fall back to generic scan-only behavior in that case (this is
 * the kill switch).
 */
export async function verifyConfigurationPack(
	value: unknown,
	options: VerifyOptions,
): Promise<PackVerification> {
	const parsed = configurationPackSchema.safeParse(value);
	if (!parsed.success) {
		return { ok: false, reason: "Pack failed structural validation (unknown or invalid fields)." };
	}
	const pack = parsed.data as ConfigurationPack;

	if (options.expectedKeyId && pack.keyId !== options.expectedKeyId) {
		return { ok: false, reason: `Pack is signed with unexpected key id "${pack.keyId}".` };
	}

	let signatureValid = false;
	try {
		const { signature, ...unsigned } = pack;
		const message = new TextEncoder().encode(packSigningPayload(unsigned));
		signatureValid = await verifyAsync(
			hexToBytes(signature),
			message,
			hexToBytes(options.publicKeyHex),
		);
	} catch {
		signatureValid = false;
	}
	if (!signatureValid) {
		return { ok: false, reason: "Pack signature is invalid." };
	}

	const nowIso = options.nowIso ?? new Date().toISOString();
	if (pack.expiresAt && pack.expiresAt <= nowIso) {
		return { ok: false, reason: `Pack expired at ${pack.expiresAt}.` };
	}

	if (
		pack.minimumExtensionVersion &&
		options.extensionVersion &&
		compareVersions(options.extensionVersion, pack.minimumExtensionVersion) < 0
	) {
		return {
			ok: true,
			pack,
			active: false,
			inactiveReason: `Requires extension ≥ ${pack.minimumExtensionVersion}.`,
		};
	}
	if (
		pack.minimumSidecarVersion &&
		options.sidecarVersion &&
		compareVersions(options.sidecarVersion, pack.minimumSidecarVersion) < 0
	) {
		return {
			ok: true,
			pack,
			active: false,
			inactiveReason: `Requires sidecar ≥ ${pack.minimumSidecarVersion}.`,
		};
	}

	if (pack.rolloutStage === "disabled") {
		return { ok: true, pack, active: false, inactiveReason: "Pack rollout stage is disabled." };
	}

	return { ok: true, pack, active: true };
}

/**
 * DEVELOPMENT-ONLY signing helper, used by scripts/sign-config-pack.mjs and
 * tests. The production private key must never enter this repository; the
 * dev key fixture is clearly labeled non-production.
 */
export async function signConfigurationPack(
	unsigned: Omit<ConfigurationPack, "signature">,
	privateKeyHex: string,
): Promise<ConfigurationPack> {
	const message = new TextEncoder().encode(packSigningPayload(unsigned));
	const signature = await signAsync(message, hexToBytes(privateKeyHex));
	return { ...unsigned, signature: bytesToHex(signature) };
}
