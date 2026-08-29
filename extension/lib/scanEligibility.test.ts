import { describe, expect, it } from "vitest";
import { describeInjectionFailure, evaluateScanEligibility } from "./scanEligibility";

describe("evaluateScanEligibility", () => {
	it("treats an ordinary shopping page as eligible and derives its origin pattern", () => {
		const result = evaluateScanEligibility("https://www.example-store.com/cart?ref=nav");
		expect(result).toEqual({
			kind: "eligible",
			origin: "https://www.example-store.com",
			originPattern: "https://www.example-store.com/*",
		});
	});

	it("scopes the pattern to the exact origin, not a wildcard domain", () => {
		const result = evaluateScanEligibility("https://shop.example.com:8443/cart");
		expect(result.kind).toBe("eligible");
		if (result.kind !== "eligible") return;
		// Port is part of the origin, and no bare *.example.com is produced.
		expect(result.originPattern).toBe("https://shop.example.com:8443/*");
		expect(result.originPattern).not.toContain("*.");
	});

	it("rejects internal browser pages with a reason that offers no false hope", () => {
		for (const url of [
			"chrome://extensions",
			"chrome-extension://abcdef/panel.html",
			"about:blank",
			"devtools://devtools/bundled/inspector.html",
			"view-source:https://example.com",
		]) {
			const result = evaluateScanEligibility(url);
			expect(result.kind, url).toBe("restricted");
		}
	});

	it("rejects the extension gallery as a browser restriction, not a grantable one", () => {
		const result = evaluateScanEligibility("https://chromewebstore.google.com/detail/xyz");
		expect(result.kind).toBe("restricted");
		if (result.kind !== "restricted") return;
		expect(result.reason).toMatch(/cannot be granted/i);
	});

	it("handles a missing or unparseable url without throwing", () => {
		expect(evaluateScanEligibility(undefined).kind).toBe("restricted");
		expect(evaluateScanEligibility("not a url").kind).toBe("restricted");
	});

	it("explains the file:// case in terms of the setting that fixes it", () => {
		const result = evaluateScanEligibility("file:///Users/someone/cart.html");
		expect(result.kind).toBe("restricted");
		if (result.kind !== "restricted") return;
		expect(result.reason).toMatch(/file URLs/i);
	});
});

describe("describeInjectionFailure", () => {
	it("turns Chrome's manifest wording into something the user can act on", () => {
		const message = describeInjectionFailure(
			new Error(
				"Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
			),
			"https://www.example-store.com",
		);
		expect(message).toMatch(/Grant access to this site/i);
		// The user is never shown the word "manifest" — it implies a broken build.
		expect(message).not.toMatch(/manifest/i);
	});

	it("names the origin so the user knows which site is being asked about", () => {
		const message = describeInjectionFailure(
			new Error("Cannot access contents of the page."),
			"https://www.example-store.com",
		);
		expect(message).toContain("https://www.example-store.com");
	});

	it("distinguishes a closed tab from a permission problem", () => {
		const message = describeInjectionFailure(new Error("No tab with id: 42."));
		expect(message).toMatch(/closed or navigated/i);
		expect(message).not.toMatch(/grant/i);
	});

	it("surfaces Chrome's own text rather than inventing a cause", () => {
		const message = describeInjectionFailure(new Error("Some brand new Chrome error"));
		expect(message).toContain("Some brand new Chrome error");
		// The old code claimed "Chrome Web Store or an internal browser page"
		// for every failure. Nothing may assert a cause it did not observe.
		expect(message).not.toMatch(/Chrome Web Store/i);
	});

	it("does not claim a reason when Chrome gave none", () => {
		expect(describeInjectionFailure(undefined)).toMatch(/gave no reason/i);
	});
});
