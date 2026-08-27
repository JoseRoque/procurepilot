import { describe, expect, it } from "vitest";
import { parseVisibleOffer } from "./offers";

describe("parseVisibleOffer", () => {
	it("parses a threshold percent-off offer with a cap", () => {
		const offer = parseVisibleOffer("30% off orders $35+, up to $12");
		expect(offer.offerType).toBe("threshold_discount");
		expect(offer.discountPercent).toBe(30);
		expect(offer.minimumSpendCents).toBe(3500);
		expect(offer.maximumDiscountCents).toBe(1200);
		expect(offer.status).toBe("visible");
	});

	it("parses a flat-dollar order discount", () => {
		const offer = parseVisibleOffer("$10 off your order");
		expect(offer.offerType).toBe("order_discount");
		expect(offer.discountCents).toBe(1000);
	});

	it("parses free delivery offers", () => {
		const offer = parseVisibleOffer("Free delivery on this order");
		expect(offer.offerType).toBe("free_delivery");
	});

	it("parses credits", () => {
		const offer = parseVisibleOffer("$10 credit applied to this order");
		expect(offer.offerType).toBe("credit");
		expect(offer.discountCents).toBe(1000);
	});

	it("parses rebates / cash back", () => {
		const offer = parseVisibleOffer("Earn $5 cash back on this purchase");
		expect(offer.offerType).toBe("rebate");
	});

	// Requirement: a discount must never be marked "appears_applied" without
	// visible evidence of application.
	it("does not mark a discount as applied without explicit wording", () => {
		const offer = parseVisibleOffer("30% off orders $35+");
		expect(offer.status).not.toBe("appears_applied");
		expect(offer.status).toBe("visible");
	});

	it("marks a discount as applied only when the text explicitly says so", () => {
		expect(parseVisibleOffer("Free delivery applied").status).toBe("appears_applied");
		expect(parseVisibleOffer("Promo code activated").status).toBe("appears_applied");
		expect(parseVisibleOffer("10% off orders $50+").status).toBe("visible");
	});

	it("falls back to unknown/low-confidence for unrecognized wording", () => {
		const offer = parseVisibleOffer("Some vague promotional text");
		expect(offer.offerType).toBe("unknown");
		expect(offer.confidence).toBe("low");
	});

	it("does not fabricate a minimum spend when none is stated", () => {
		const offer = parseVisibleOffer("$10 off your order");
		expect(offer.minimumSpendCents).toBeUndefined();
	});
});
