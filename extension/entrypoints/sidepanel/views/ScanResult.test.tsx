import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CartSnapshot } from "@/lib/types";
import { ScanResult } from "./ScanResult";

function baseSnapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
	return {
		id: "s1",
		createdAt: "2026-01-01T00:00:00.000Z",
		platform: "generic",
		platformLabel: "Demo storefront",
		detectionStatus: "supported",
		pageUrlOrigin: "https://example.test",
		items: [],
		visibleOffers: [],
		confidence: "high",
		extractionNotes: [],
		privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: false, cookiesRead: false },
		...overrides,
	};
}

describe("ScanResult rendering safety", () => {
	it("renders stored offer/note text as literal text, never as executable markup", () => {
		const snapshot = baseSnapshot({
			extractionNotes: ['<script>window.__pwned = true</script>', "<img src=x onerror=alert(1)>"],
			visibleOffers: [
				{
					title: "<b>Fake bold</b>",
					rawText: "<svg onload=alert(1)>",
					offerType: "unknown",
					status: "unknown",
					confidence: "low",
				},
			],
		});

		const html = renderToStaticMarkup(<ScanResult snapshot={snapshot} />);

		// React escapes text content — raw tags must not appear unescaped.
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img src=x");
		expect(html).not.toContain("<svg onload");
		expect(html).not.toContain("<b>Fake bold</b>");

		// The text should still be present, just escaped.
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("&lt;b&gt;Fake bold&lt;/b&gt;");
	});
});
