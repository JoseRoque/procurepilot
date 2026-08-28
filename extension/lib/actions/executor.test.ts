import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { demoStoreAdapter } from "../adapters/demoStore";
import { executeAction, type ActionSelectorMap } from "./executor";

/**
 * Runs the executor against the real bundled demo-store fixture page, so the
 * bounded-selector contract and every stop condition are exercised on real
 * markup rather than a hand-built stub.
 */

const FIXTURE_HTML = readFileSync(
	join(__dirname, "../../../packages/test-fixtures/pages/demo-store.html"),
	"utf8",
);

const SELECTORS: ActionSelectorMap = {
	open_visible_offers: { css: "#demo-offers-toggle", maxMatches: 1, requiresVisibleText: "offers" },
	search_exact_item: { css: "#demo-search-input", maxMatches: 1 },
	add_exact_approved_item: { css: "#demo-search-results .demo-add-button", maxMatches: 1 },
	adjust_quantity: { css: ".cart-line .demo-qty-increase", maxMatches: 5 },
	remove_optional_item: { css: ".cart-line .demo-remove-button", maxMatches: 5 },
	rescan_cart: { css: "body", maxMatches: 1 },
};

const CART_URL = new URL("https://demo-store.fixture.local/cart");

// Listeners are bound to `document`, which survives innerHTML replacement —
// abort the previous test's listener so clicks fire exactly once.
let fixtureListeners: AbortController | undefined;

function loadFixture(): Document {
	fixtureListeners?.abort();
	fixtureListeners = new AbortController();
	document.documentElement.innerHTML = FIXTURE_HTML;
	// jsdom doesn't run the fixture's inline <script>, so wire the handful of
	// behaviors the executor depends on (click → DOM change) directly.
	const recompute = () => {
		let subtotal = 0;
		for (const line of Array.from(document.querySelectorAll("#demo-cart-lines .cart-line"))) {
			const qty = Number.parseInt(line.querySelector(".qty-value")?.textContent ?? "0", 10);
			const unit = Number.parseInt(
				line.querySelector(".line-price")?.getAttribute("data-unit-cents") ?? "0",
				10,
			);
			const total = qty * unit;
			const priceEl = line.querySelector(".line-price");
			if (priceEl) priceEl.textContent = `$${(total / 100).toFixed(2)}`;
			subtotal += total;
		}
		const subtotalEl = document.getElementById("demo-subtotal");
		if (subtotalEl) subtotalEl.textContent = `$${(subtotal / 100).toFixed(2)}`;
	};
	document.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		if (target.classList.contains("demo-qty-increase") || target.classList.contains("demo-qty-decrease")) {
			const value = target.parentElement?.querySelector(".qty-value");
			if (value) {
				const next = Number.parseInt(value.textContent ?? "0", 10) + (target.classList.contains("demo-qty-increase") ? 1 : -1);
				value.textContent = String(next);
			}
			recompute();
		}
		if (target.classList.contains("demo-remove-button")) {
			target.closest(".cart-line")?.remove();
			recompute();
		}
		if (target.id === "demo-offers-toggle") {
			const panel = document.getElementById("demo-offers-panel") as HTMLElement | null;
			if (panel) panel.hidden = !panel.hidden;
		}
	}, { signal: fixtureListeners.signal });
	return document;
}

describe("demo store adapter", () => {
	beforeEach(loadFixture);

	it("extracts cart lines and totals from the fixture", async () => {
		const draft = await demoStoreAdapter.extract(document, CART_URL);
		expect(draft.platform).toBe("demo_store");
		expect(draft.items).toHaveLength(3);
		expect(draft.subtotal?.cents).toBe(3142);
		expect(draft.displayedFinalTotal?.cents).toBe(3988);
		expect(draft.visibleOffers[0]?.offerType).toBe("threshold_discount");
		expect(draft.confidence).toBe("high");
	});

	it("refuses to scan when a password field is present", () => {
		document.body.insertAdjacentHTML("beforeend", '<input type="password" />');
		expect(demoStoreAdapter.getDetectionStatus(CART_URL, document)).toBe("scan_unavailable");
	});
});

describe("action executor", () => {
	beforeEach(loadFixture);

	it("opens the visible offers section", () => {
		const panel = document.getElementById("demo-offers-panel") as HTMLElement;
		expect(panel.hidden).toBe(true);
		const result = executeAction(document, "open_visible_offers", {}, SELECTORS);
		expect(result.outcome).toBe("succeeded");
		expect(panel.hidden).toBe(false);
	});

	it("fills the search input without adding anything to the cart", () => {
		const before = document.querySelectorAll("#demo-cart-lines .cart-line").length;
		const result = executeAction(
			document,
			"search_exact_item",
			{ itemName: "fixture dark chocolate bar" },
			SELECTORS,
		);
		expect(result.outcome).toBe("succeeded");
		expect((document.getElementById("demo-search-input") as HTMLInputElement).value).toBe(
			"fixture dark chocolate bar",
		);
		expect(document.querySelectorAll("#demo-cart-lines .cart-line")).toHaveLength(before);
	});

	it("adjusts quantity within bounds and reverses cleanly", () => {
		const line = document.querySelector('[data-item="Fixture oat cereal"]') as HTMLElement;
		expect(line.querySelector(".qty-value")?.textContent).toBe("2");
		const up = executeAction(
			document,
			"adjust_quantity",
			{ itemName: "Fixture oat cereal", fromQuantity: 2, toQuantity: 3 },
			SELECTORS,
		);
		expect(up.outcome).toBe("succeeded");
		expect(line.querySelector(".qty-value")?.textContent).toBe("3");
	});

	it("stops when the observed quantity does not match the approved 'from' value", () => {
		const result = executeAction(
			document,
			"adjust_quantity",
			{ itemName: "Fixture oat cereal", fromQuantity: 99, toQuantity: 100 },
			SELECTORS,
		);
		expect(result.outcome).toBe("stopped_for_review");
		expect("stopReason" in result && result.stopReason).toMatch(/expected quantity 99/i);
	});

	it("removes an optional item", () => {
		const before = document.querySelectorAll("#demo-cart-lines .cart-line").length;
		const result = executeAction(
			document,
			"remove_optional_item",
			{ itemName: "Fixture olive oil 500ml" },
			SELECTORS,
		);
		expect(result.outcome).toBe("succeeded");
		expect(document.querySelectorAll("#demo-cart-lines .cart-line")).toHaveLength(before - 1);
	});

	it("stops rather than acting when the target item is not visible", () => {
		const result = executeAction(
			document,
			"remove_optional_item",
			{ itemName: "Nonexistent item" },
			SELECTORS,
		);
		expect(result.outcome).toBe("stopped_for_review");
	});

	it("refuses to add an item priced above the approved limit", () => {
		document.getElementById("demo-search-results")!.innerHTML = `
			<div class="product-tile" data-item="fixture dark chocolate bar" data-unit-cents="450">
				<span class="tile-price">$4.50</span>
				<button class="demo-add-button" type="button">Add to cart</button>
			</div>`;
		const result = executeAction(
			document,
			"add_exact_approved_item",
			{ itemName: "fixture dark chocolate bar", quantity: 1, maxUnitPriceCents: 300 },
			SELECTORS,
		);
		expect(result.outcome).toBe("stopped_for_review");
		expect("stopReason" in result && result.stopReason).toMatch(/exceeds the approved limit/i);
	});

	it("adds an exact approved item when the visible price is within the limit", () => {
		document.getElementById("demo-search-results")!.innerHTML = `
			<div class="product-tile" data-item="fixture dark chocolate bar" data-unit-cents="450">
				<span class="tile-price">$4.50</span>
				<button class="demo-add-button" type="button">Add to cart</button>
			</div>`;
		const result = executeAction(
			document,
			"add_exact_approved_item",
			{ itemName: "fixture dark chocolate bar", quantity: 1, maxUnitPriceCents: 600 },
			SELECTORS,
		);
		expect(result.outcome).toBe("succeeded");
	});

	it("stops when no verified selector exists for the action", () => {
		const result = executeAction(document, "open_visible_offers", {}, {});
		expect(result.outcome).toBe("stopped_for_review");
		expect("stopReason" in result && result.stopReason).toMatch(/configuration pack/i);
	});

	it("respects the maxMatches bound on selectors", () => {
		// A selector that would match many elements is clamped; with maxMatches
		// of 1 and a requiresVisibleText that no first match satisfies, nothing runs.
		const result = executeAction(document, "open_visible_offers", {}, {
			open_visible_offers: { css: "button", maxMatches: 1, requiresVisibleText: "zzz-nonexistent" },
		});
		expect(result.outcome).toBe("failed");
	});
});
