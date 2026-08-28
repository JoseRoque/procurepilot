import { describe, expect, it } from "vitest";
import {
	buildDevConfigPack,
	DEV_CONFIG_KEY_ID,
	DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
	DEV_CONFIG_SIGNING_PUBLIC_KEY_HEX,
} from "../../test-fixtures/src";
import { signConfigurationPack, verifyConfigurationPack, compareVersions } from "./verify";

const verifyOptions = {
	publicKeyHex: DEV_CONFIG_SIGNING_PUBLIC_KEY_HEX,
	expectedKeyId: DEV_CONFIG_KEY_ID,
	nowIso: "2026-08-28T12:00:00.000Z",
	extensionVersion: "0.2.0",
	sidecarVersion: "0.1.0",
};

describe("configuration pack verification", () => {
	it("accepts a validly signed dev pack as active", async () => {
		const pack = await signConfigurationPack(buildDevConfigPack(), DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({ ok: true, active: true });
	});

	it("rejects an invalid signature", async () => {
		const pack = await signConfigurationPack(buildDevConfigPack(), DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX);
		const tampered = { ...pack, version: "6.6.6" };
		const result = await verifyConfigurationPack(tampered, verifyOptions);
		expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/signature/i) });
	});

	it("rejects an expired pack", async () => {
		const pack = await signConfigurationPack(
			buildDevConfigPack({ expiresAt: "2026-01-01T00:00:00.000Z" }),
			DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
		);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/i) });
	});

	it("verifies but deactivates a disabled pack (kill switch)", async () => {
		const pack = await signConfigurationPack(
			buildDevConfigPack({ rolloutStage: "disabled" }),
			DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
		);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({
			ok: true,
			active: false,
			inactiveReason: expect.stringMatching(/disabled/i),
		});
	});

	it("deactivates a pack requiring a newer sidecar", async () => {
		const pack = await signConfigurationPack(
			buildDevConfigPack({ minimumSidecarVersion: "9.9.9" }),
			DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
		);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({ ok: true, active: false });
	});

	it("rejects a pack with unknown/extra fields (no code smuggling)", async () => {
		const unsigned = buildDevConfigPack();
		const withScript = { ...unsigned, script: "alert(1)", signature: "00" };
		const result = await verifyConfigurationPack(withScript, verifyOptions);
		expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/structural/i) });
	});

	it("rejects a selector containing forbidden characters", async () => {
		const unsigned = buildDevConfigPack();
		unsigned.adapterConfigs[0]!.actionSelectors!.rescan_cart = {
			css: "body<script>",
			maxMatches: 1,
		};
		const pack = await signConfigurationPack(unsigned, DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({ ok: false });
	});

	it("rejects a wrong key id", async () => {
		const pack = await signConfigurationPack(
			buildDevConfigPack({ keyId: "unexpected-key" }),
			DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX,
		);
		const result = await verifyConfigurationPack(pack, verifyOptions);
		expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/key id/i) });
	});
});

describe("compareVersions", () => {
	it("compares dotted numeric versions", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
		expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
		expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
	});
});
