import type { ActionType } from "../../../packages/domain/src";
import { normalizeItemName } from "../../../packages/domain/src";
import { normalizeMoney } from "../../../packages/optimizer/src/money";

/**
 * Bounded, reversible action executor. Selectors come ONLY from a verified
 * configuration pack (via the sidecar); with no active pack this module is
 * never invoked and the extension stays scan-only. Every action is a plain
 * user-visible DOM interaction — no hidden frames, no synthetic navigation,
 * no credential/checkout surfaces (those pages are refused before this runs).
 */

export type BoundedSelectorConfig = {
	css: string;
	maxMatches: number;
	requiresVisibleText?: string;
};

export type ActionSelectorMap = Partial<Record<ActionType, BoundedSelectorConfig>>;

export type ExecuteOutcome =
	| { outcome: "succeeded"; summary: string }
	| { outcome: "failed"; summary: string; stopReason: string }
	| { outcome: "stopped_for_review"; summary: string; stopReason: string };

function isVisible(element: Element): boolean {
	if (!(element instanceof HTMLElement)) return true;
	const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
	if (style && (style.display === "none" || style.visibility === "hidden")) return false;
	if (element.hidden) return false;
	return true;
}

function findBounded(document: Document, config: BoundedSelectorConfig): HTMLElement[] {
	const matches = Array.from(document.querySelectorAll(config.css))
		.filter(isVisible)
		.slice(0, Math.min(config.maxMatches, 5));
	if (config.requiresVisibleText) {
		const needle = config.requiresVisibleText.toLowerCase();
		return matches.filter((element) =>
			(element.textContent ?? "").toLowerCase().includes(needle),
		) as HTMLElement[];
	}
	return matches as HTMLElement[];
}

function cartLineFor(document: Document, itemName: string): HTMLElement | undefined {
	const wanted = normalizeItemName(itemName);
	return Array.from(document.querySelectorAll<HTMLElement>("[data-item]")).find(
		(line) => normalizeItemName(line.getAttribute("data-item") ?? "") === wanted && isVisible(line),
	);
}

function setInputValue(input: HTMLInputElement, value: string): void {
	const proto = Object.getPrototypeOf(input) as object;
	const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
	if (setter) setter.call(input, value);
	else input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function executeAction(
	document: Document,
	actionType: ActionType,
	payload: Record<string, unknown>,
	selectors: ActionSelectorMap,
): ExecuteOutcome {
	const selector = selectors[actionType];
	if (!selector && actionType !== "rescan_cart") {
		return {
			outcome: "stopped_for_review",
			summary: "No verified selector configuration for this action.",
			stopReason: "The active configuration pack does not define this action for this site.",
		};
	}

	switch (actionType) {
		case "open_visible_offers": {
			const [toggle] = findBounded(document, selector!);
			if (!toggle) {
				return failed("Offers control not found.", "The configured offers control is not visible on this page.");
			}
			toggle.click();
			return { outcome: "succeeded", summary: "Opened the visible offers section." };
		}

		case "search_exact_item": {
			const itemName = String(payload.itemName ?? "");
			const [input] = findBounded(document, selector!);
			if (!(input instanceof HTMLInputElement)) {
				return failed("Search input not found.", "The configured search input is not visible on this page.");
			}
			setInputValue(input, itemName);
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
			);
			return { outcome: "succeeded", summary: `Searched for "${itemName}".` };
		}

		case "add_exact_approved_item": {
			const itemName = String(payload.itemName ?? "");
			const maxUnitPriceCents = payload.maxUnitPriceCents as number | null | undefined;
			const wanted = normalizeItemName(itemName);
			const buttons = findBounded(document, selector!);
			const button = buttons.find((candidate) => {
				const tile = candidate.closest("[data-item]");
				return tile && normalizeItemName(tile.getAttribute("data-item") ?? "") === wanted;
			});
			if (!button) {
				return stopped(
					"Exact item not visible.",
					`"${itemName}" is not visibly available to add — nothing was added.`,
				);
			}
			if (maxUnitPriceCents != null) {
				const tile = button.closest("[data-item]");
				const priceText = tile?.querySelector(".tile-price, .line-price, [data-unit-cents]")?.textContent ?? "";
				const priceCents = normalizeMoney(priceText)?.cents;
				if (priceCents === undefined) {
					return stopped(
						"Price not readable.",
						"The item's visible price could not be read, so it was not added.",
					);
				}
				if (priceCents > maxUnitPriceCents) {
					return stopped(
						"Price above your limit.",
						`Visible price exceeds the approved limit — nothing was added.`,
					);
				}
			}
			button.click();
			return { outcome: "succeeded", summary: `Added "${itemName}" to the cart.` };
		}

		case "adjust_quantity": {
			const itemName = String(payload.itemName ?? "");
			const from = Number(payload.fromQuantity);
			const to = Number(payload.toQuantity);
			const line = cartLineFor(document, itemName);
			if (!line) {
				return stopped("Cart line not found.", `"${itemName}" is not visible in the cart.`);
			}
			const currentText = line.querySelector(".qty-value")?.textContent?.trim();
			if (currentText !== String(from)) {
				return stopped(
					"Quantity changed since approval.",
					`Expected quantity ${from} but the page shows ${currentText ?? "unknown"}.`,
				);
			}
			const delta = to - from;
			const steps = Math.abs(delta);
			if (steps === 0 || steps > 5) {
				return stopped("Adjustment out of bounds.", "Quantity change must be 1–5 steps.");
			}
			const buttonSelector = delta > 0 ? ".demo-qty-increase" : ".demo-qty-decrease";
			const button = line.querySelector<HTMLElement>(buttonSelector);
			if (!button || !isVisible(button)) {
				return failed("Quantity control not found.", "The quantity control is not visible.");
			}
			for (let i = 0; i < steps; i++) button.click();
			return { outcome: "succeeded", summary: `Changed "${itemName}" quantity from ${from} to ${to}.` };
		}

		case "remove_optional_item": {
			const itemName = String(payload.itemName ?? "");
			const line = cartLineFor(document, itemName);
			if (!line) {
				return stopped("Cart line not found.", `"${itemName}" is not visible in the cart.`);
			}
			const button = line.querySelector<HTMLElement>(".demo-remove-button, [data-action='remove']");
			if (!button || !isVisible(button)) {
				return failed("Remove control not found.", "The remove control is not visible.");
			}
			button.click();
			return { outcome: "succeeded", summary: `Removed "${itemName}" from the cart.` };
		}

		case "rescan_cart":
		case "scan_page":
			return { outcome: "succeeded", summary: "Re-scan requested." };

		default:
			return stopped("Unknown action.", "This action type is not implemented.");
	}

	function failed(summary: string, stopReason: string): ExecuteOutcome {
		return { outcome: "failed", summary, stopReason };
	}
	function stopped(summary: string, stopReason: string): ExecuteOutcome {
		return { outcome: "stopped_for_review", summary, stopReason };
	}
}
