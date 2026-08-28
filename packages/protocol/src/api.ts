import { z } from "zod";
import { redactedOutcomeEventSchema } from "./telemetry";

/**
 * Cloudflare API v1 request schemas (workers/lib/pi). Personal/device/consent
 * endpoints always return Cache-Control: no-store. No endpoint accepts or
 * stores raw cart data.
 */

export const deviceRegisterRequestSchema = z.strictObject({
	/** Sidecar-generated pseudonymous id — NEVER an email or account identity. */
	pseudonymousDeviceId: z.string().min(8).max(64),
	appVersion: z.string().min(1).max(32),
	platform: z.enum(["macos", "windows", "linux"]),
});

export type DeviceRegisterResponse = {
	ok: true;
	data: { deviceId: string; deviceToken: string; issuedAt: string };
};

export const consentReceiptUploadSchema = z.strictObject({
	receiptId: z.string().min(1).max(64),
	privacyMode: z.enum([
		"local_only",
		"private_backup_disabled",
		"contribute_redacted_outcomes",
	]),
	consentVersion: z.string().min(1).max(32),
	grantedAt: z.iso.datetime(),
	revokedAt: z.iso.datetime().optional(),
	scopeText: z.string().min(1).max(2000),
	appVersion: z.string().min(1).max(32),
	extensionVersion: z.string().max(32).optional(),
});

export const redactedEventUploadSchema = z.strictObject({
	events: z.array(redactedOutcomeEventSchema).min(1).max(20),
});

export const deletionRequestSchema = z.strictObject({
	reason: z.string().max(500).optional(),
});

export type PiApiError = {
	ok: false;
	error: { code: string; message: string };
};

export type ConfigPackIndexEntry = {
	packId: string;
	version: string;
	issuedAt: string;
	expiresAt?: string;
	rolloutStage: "local_dev" | "private_alpha" | "canary" | "disabled";
	minimumExtensionVersion?: string;
	minimumSidecarVersion?: string;
	changelogSummary?: string;
};
