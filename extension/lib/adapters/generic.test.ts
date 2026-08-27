import { beforeEach, describe, expect, it } from "vitest";
import { genericAdapter } from "./generic";

function setBody(html: string) {
	document.body.innerHTML = html;
}

const CART_URL = new URL("https://shop.example.test/cart");
const HOME_URL = new URL("https://shop.example.test/");
const LOGIN_URL = new URL("https://shop.example.test/login");

describe("genericAdapter", () => {
	beforeEach(() => {
		setBody("");
	});

	it("always matches (it's the universal fallback)", () => {
		expect(genericAdapter.matches(CART_URL, document)).toBe(true);
		expect(genericAdapter.matches(HOME_URL, document)).toBe(true);
	});

	it("reports scan_unavailable when nothing resembling a cart is found", () => {
		setBody("<main><h1>Welcome to our store</h1><p>Browse our catalog.</p></main>");
		expect(genericAdapter.getDetectionStatus(HOME_URL, document)).toBe("scan_unavailable");
	});

	it("reports supported when a subtotal/total container is present", () => {
		setBody(`
			<div class="cart-summary">
				<div>Subtotal $31.42</div>
				<div>Total $39.88</div>
			</div>
		`);
		expect(genericAdapter.getDetectionStatus(CART_URL, document)).toBe("supported");
	});

	it("degrades gracefully (fails safely) when no cart page is detected", async () => {
		setBody("<main><h1>Welcome</h1></main>");
		const draft = await genericAdapter.extract(document, HOME_URL);
		expect(draft.detectionStatus).toBe("scan_unavailable");
		expect(draft.subtotal).toBeUndefined();
		expect(draft.extractionNotes.length).toBeGreaterThan(0);
	});

	it("extracts subtotal, fees, tax, and total from a typical cart layout", async () => {
		setBody(`
			<div class="cart-container">
				<div class="row">Subtotal $31.42</div>
				<div class="row">Delivery fee $1.99</div>
				<div class="row">Service fee $3.56</div>
				<div class="row">Tax $2.91</div>
				<div class="row">Total $39.88</div>
				<div class="row">30% off orders $35+, up to $12</div>
			</div>
		`);
		const draft = await genericAdapter.extract(document, CART_URL);
		expect(draft.subtotal?.cents).toBe(3142);
		expect(draft.deliveryFee?.cents).toBe(199);
		expect(draft.serviceFee?.cents).toBe(356);
		expect(draft.tax?.cents).toBe(291);
		expect(draft.displayedFinalTotal?.cents).toBe(3988);
		expect(draft.visibleOffers).toHaveLength(1);
		expect(draft.visibleOffers[0]?.offerType).toBe("threshold_discount");
		expect(draft.confidence).toBe("high");
	});

	it("does not capture the entire document body (scopes to cart-like containers)", async () => {
		setBody(`
			<nav>Unrelated navigation subtotal $999.99 total $999.99</nav>
			<div class="checkout-summary">
				<div>Subtotal $20.00</div>
				<div>Total $22.00</div>
			</div>
		`);
		const draft = await genericAdapter.extract(document, CART_URL);
		expect(draft.subtotal?.cents).toBe(2000);
	});

	it("never runs extraction on a page that looks like login/payment/MFA", async () => {
		setBody('<form><input type="password" /><button>Sign in</button></form>');
		const draft = await genericAdapter.extract(document, LOGIN_URL);
		expect(draft.detectionStatus).toBe("scan_unavailable");
		expect(draft.subtotal).toBeUndefined();
	});

	it("reports scan_unavailable detection status for sensitive pages, not supported", () => {
		setBody('<div class="cart-summary">Subtotal $10.00 <input type="password" /></div>');
		expect(genericAdapter.getDetectionStatus(CART_URL, document)).toBe("scan_unavailable");
	});
});
