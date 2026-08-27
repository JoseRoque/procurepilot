import { describe, expect, it } from "vitest";
import { parseContentScriptMessage, parseExtensionMessage } from "./messages";

describe("parseExtensionMessage", () => {
	it("accepts a valid SCAN_CURRENT_PAGE message", () => {
		const result = parseExtensionMessage({ type: "SCAN_CURRENT_PAGE", payload: { tabId: 5 } });
		expect(result?.type).toBe("SCAN_CURRENT_PAGE");
	});

	it("accepts SCAN_CURRENT_PAGE without a tabId", () => {
		const result = parseExtensionMessage({ type: "SCAN_CURRENT_PAGE", payload: {} });
		expect(result?.type).toBe("SCAN_CURRENT_PAGE");
	});

	it("rejects an unknown message type", () => {
		expect(parseExtensionMessage({ type: "DO_SOMETHING_MALICIOUS", payload: {} })).toBeUndefined();
	});

	it("rejects a message with a malformed payload", () => {
		expect(
			parseExtensionMessage({ type: "PAGE_DETECTION_RESULT", payload: { tabId: "not-a-number" } }),
		).toBeUndefined();
	});

	it("rejects null, undefined, and non-object input", () => {
		expect(parseExtensionMessage(null)).toBeUndefined();
		expect(parseExtensionMessage(undefined)).toBeUndefined();
		expect(parseExtensionMessage("just a string")).toBeUndefined();
		expect(parseExtensionMessage(42)).toBeUndefined();
	});

	it("rejects a CART_SCAN_COMPLETE message with an invalid snapshot", () => {
		const result = parseExtensionMessage({
			type: "CART_SCAN_COMPLETE",
			payload: { tabId: 1, snapshot: { id: "x" }, recommendation: {} },
		});
		expect(result).toBeUndefined();
	});

	it("rejects a snapshot claiming false privacy attestations", () => {
		const result = parseExtensionMessage({
			type: "CART_SCAN_COMPLETE",
			payload: {
				tabId: 1,
				snapshot: {
					id: "x",
					createdAt: "2026-01-01T00:00:00.000Z",
					platform: "generic",
					platformLabel: "Generic",
					detectionStatus: "supported",
					pageUrlOrigin: "https://example.test",
					items: [],
					visibleOffers: [],
					confidence: "high",
					extractionNotes: [],
					privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: true, cookiesRead: false },
				},
				recommendation: {
					snapshotId: "x",
					generatedAt: "2026-01-01T00:00:00.000Z",
					action: "no_action",
					headline: "x",
					rationale: [],
					warnings: [],
					confidence: "high",
				},
			},
		});
		expect(result).toBeUndefined();
	});
});

describe("parseContentScriptMessage", () => {
	it("accepts a valid PAGE_DETECTION_RESULT without a tabId (content scripts can't know their own tabId)", () => {
		const result = parseContentScriptMessage({
			type: "PAGE_DETECTION_RESULT",
			payload: { platform: "generic", detectionStatus: "supported" },
		});
		expect(result?.type).toBe("PAGE_DETECTION_RESULT");
	});

	it("ignores any tabId a content script tries to claim", () => {
		const result = parseContentScriptMessage({
			type: "PAGE_DETECTION_RESULT",
			payload: { tabId: 999, platform: "generic", detectionStatus: "supported" },
		});
		// tabId is not part of the content-script schema; zod strips unknown keys.
		expect(result && "tabId" in result.payload).toBe(false);
	});

	it("rejects a SCAN_CURRENT_PAGE claim from a content script", () => {
		expect(parseContentScriptMessage({ type: "SCAN_CURRENT_PAGE", payload: {} })).toBeUndefined();
	});

	it("rejects malformed CART_SNAPSHOT_EXTRACTED payloads", () => {
		expect(
			parseContentScriptMessage({ type: "CART_SNAPSHOT_EXTRACTED", payload: { draft: { items: "not-an-array" } } }),
		).toBeUndefined();
	});
});
