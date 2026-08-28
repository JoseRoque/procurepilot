import type {
	CartLineItem,
	CoverageResult,
	PlannedItem,
	ShoppingItem,
} from "../../domain/src";
import { normalizeItemName } from "../../domain/src";

function tokenize(name: string): string[] {
	return normalizeItemName(name)
		.split(" ")
		.filter((token) => token.length > 1);
}

/**
 * Conservative name matching. exact_only requires normalized-name equality;
 * looser tolerances allow token-subset containment (every token of the
 * shopping item appears in the cart line). Never fuzzy, never scored — a
 * non-match is reported as missing rather than guessed.
 */
function matchesCartLine(item: ShoppingItem, line: CartLineItem): boolean {
	const lineNormalized = normalizeItemName(line.displayName);
	if (item.acceptableSubstitution === "exact_only") {
		return lineNormalized === item.normalizedName;
	}
	const itemTokens = tokenize(item.name);
	if (itemTokens.length === 0) return false;
	const lineTokens = new Set(tokenize(line.displayName));
	return itemTokens.every((token) => lineTokens.has(token));
}

function toPlannedItem(item: ShoppingItem, line: CartLineItem | undefined): PlannedItem {
	const required = item.urgency === "immediate" || item.urgency === "this_week";
	const notes: string[] = [];
	let status: PlannedItem["status"];

	if (!line) {
		status = "missing_from_cart";
		notes.push("Not found among visible cart lines.");
	} else if (line.availability === "unavailable") {
		status = "unavailable";
		notes.push(`"${line.displayName}" is shown as unavailable on the page.`);
	} else {
		status = "in_cart";
		if (
			item.acceptableSubstitution === "brand_preferred" &&
			item.preferredBrand &&
			!normalizeItemName(line.displayName).includes(normalizeItemName(item.preferredBrand))
		) {
			status = "needs_review";
			notes.push(
				`Matched "${line.displayName}" but the preferred brand "${item.preferredBrand}" is not visible in the line name — review the substitution.`,
			);
		}
		if (
			item.maxUnitPriceCents !== undefined &&
			line.unitPriceCents !== undefined &&
			line.unitPriceCents > item.maxUnitPriceCents
		) {
			status = "needs_review";
			notes.push(
				`Visible unit price exceeds your limit for this item (limit set in your shopping list).`,
			);
		}
	}

	return {
		shoppingItemId: item.id,
		displayName: item.name,
		required,
		status,
		matchedCartLine: line?.displayName,
		quantityInCart: line?.quantity,
		targetQuantity: item.targetQuantity,
		unitPriceCents: line?.unitPriceCents,
		notes,
	};
}

/** Maps every active shopping item onto the visible cart lines. */
export function mapShoppingItems(
	shoppingItems: ShoppingItem[],
	cartLines: CartLineItem[],
): PlannedItem[] {
	return shoppingItems
		.filter((item) => item.active && item.urgency !== "watch_only")
		.map((item) => {
			const line = cartLines.find((candidate) => matchesCartLine(item, candidate));
			return toPlannedItem(item, line);
		});
}

export function evaluateRequiredItemCoverage(
	shoppingItems: ShoppingItem[],
	cartLines: CartLineItem[],
): CoverageResult {
	const planned = mapShoppingItems(shoppingItems, cartLines);
	const required = planned.filter((item) => item.required);
	const missingRequired = required.filter((item) => item.status === "missing_from_cart");
	const unavailableRequired = required.filter((item) => item.status === "unavailable");
	const covered = required.filter(
		(item) => item.status === "in_cart" || item.status === "needs_review",
	).length;

	const explanation: string[] = [
		`${covered} of ${required.length} required items matched a visible cart line.`,
	];
	if (cartLines.length === 0 && required.length > 0) {
		explanation.push(
			"No individual cart lines were extracted from this page, so coverage is based on absence of evidence — review the cart directly.",
		);
	}
	for (const item of missingRequired) {
		explanation.push(`Required item "${item.displayName}" was not found in the cart.`);
	}
	for (const item of unavailableRequired) {
		explanation.push(`Required item "${item.displayName}" appears unavailable.`);
	}

	return {
		requiredCovered: covered,
		requiredTotal: required.length,
		missingRequired,
		unavailableRequired,
		explanation,
	};
}
