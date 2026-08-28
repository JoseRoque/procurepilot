import { normalizeMoney } from "../money";
import { parseVisibleOffer } from "../offers";
import { hasSensitiveInputFields, isSensitivePage } from "../sensitivePages";
import type { CartLineItem } from "../types";
import type { CommercePageAdapter, CartSnapshotDraft } from "./types";

export const DEMO_ADAPTER_VERSION = "demo-1.0.0";

/**
 * Adapter for the bundled demo-store fixture page
 * (packages/test-fixtures/pages/demo-store.html). This is the only adapter
 * in the alpha whose action capabilities can be enabled — and even then only
 * through a verified configuration pack. It matches solely on the fixture's
 * own markers, never on a real merchant.
 */
export const demoStoreAdapter: CommercePageAdapter = {
	id: "demo_store",
	label: "Demo store (fixture)",

	matches(_url: URL, document: Document): boolean {
		return document.getElementById("demo-cart-lines") !== null;
	},

	getDetectionStatus(url, document) {
		if (
			isSensitivePage(url, document.title) ||
			hasSensitiveInputFields(document)
		) {
			return "scan_unavailable";
		}
		return "supported";
	},

	async extract(document: Document, url: URL): Promise<CartSnapshotDraft> {
		const notes: string[] = [];
		const items: CartLineItem[] = [];

		for (const line of Array.from(document.querySelectorAll<HTMLElement>("#demo-cart-lines .cart-line"))) {
			const displayName = line.getAttribute("data-item") ?? line.querySelector(".line-name")?.textContent?.trim() ?? "";
			if (!displayName) continue;
			const quantity = Number.parseInt(line.querySelector(".qty-value")?.textContent ?? "", 10);
			const priceEl = line.querySelector(".line-price");
			const unitCentsAttr = priceEl?.getAttribute("data-unit-cents");
			const lineTotalCents = normalizeMoney(priceEl?.textContent ?? "")?.cents;
			const rawText = (line.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
			items.push({
				displayName,
				quantity: Number.isFinite(quantity) ? quantity : undefined,
				unitPriceCents: unitCentsAttr ? Number.parseInt(unitCentsAttr, 10) : undefined,
				lineTotalCents,
				rawText,
			});
		}
		if (items.length === 0) notes.push("No cart lines were visible.");

		const summaryValue = (id: string) =>
			normalizeMoney(document.getElementById(id)?.textContent ?? "");

		const offerTexts = Array.from(document.querySelectorAll(".offer-banner, #demo-offers-panel"))
			.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
			.filter((text) => text.length > 0 && text.length < 400);

		return {
			platform: "demo_store",
			platformLabel: "Demo store (fixture)",
			detectionStatus: "supported",
			pageUrlOrigin: url.origin,
			pagePathHint: url.pathname,
			cartItemCount: items.length,
			items,
			subtotal: summaryValue("demo-subtotal"),
			deliveryFee: summaryValue("demo-delivery"),
			serviceFee: summaryValue("demo-service"),
			tax: summaryValue("demo-tax"),
			displayedFinalTotal: summaryValue("demo-total"),
			visibleOffers: offerTexts.map(parseVisibleOffer),
			confidence: items.length > 0 && summaryValue("demo-subtotal") ? "high" : "low",
			extractionNotes: notes,
		};
	},
};
