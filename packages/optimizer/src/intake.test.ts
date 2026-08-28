import { describe, expect, it } from "vitest";
import {
	applyIntakeQuarantine,
	classifyHeader,
	classifyHeaders,
	summarizeQuarantine,
} from "./intake";

describe("intake quarantine", () => {
	it("refuses the toxic columns that delivery exports actually carry", () => {
		const headers = [
			"delivery_address",
			"dropoff_latitude",
			"dropoff_longitude",
			"delivery_instructions",
			"dasher_name",
			"customer_phone",
			"payment_method",
			"card_last4",
		];
		const { safe, quarantined } = classifyHeaders(headers);
		expect(safe).toEqual([]);
		expect(quarantined).toHaveLength(headers.length);
	});

	it("categorizes each refusal so the user is told why", () => {
		expect(classifyHeader("delivery_address")?.category).toBe("location");
		expect(classifyHeader("dropoff_notes")?.category).toBe("freeform");
		expect(classifyHeader("customer_phone")?.category).toBe("contact");
		expect(classifyHeader("card_last4")?.category).toBe("payment");
		expect(classifyHeader("session_token")?.category).toBe("credential");
		expect(classifyHeader("dasher_name")?.category).toBe("person");
	});

	it("treats free-text delivery instructions as toxic, because they hide gate codes", () => {
		for (const header of [
			"delivery_instructions",
			"dropoff_instructions",
			"courier_notes",
			"gate_code",
			"special_instructions",
		]) {
			expect(classifyHeader(header), header).toBeDefined();
		}
	});

	it("keeps the columns price intelligence is built from", () => {
		const headers = [
			"order_date",
			"restaurant_name",
			"merchant_name",
			"item_name",
			"quantity",
			"item_price",
			"subtotal",
			"delivery_fee",
			"service_fee",
			"tax",
			"tip",
			"order_total",
			"platform",
		];
		const { safe, quarantined } = classifyHeaders(headers);
		expect(quarantined).toEqual([]);
		expect(safe).toEqual(headers);
	});

	it("does not mistake merchant_name or item_name for a person", () => {
		expect(classifyHeader("merchant_name")).toBeUndefined();
		expect(classifyHeader("item_name")).toBeUndefined();
		expect(classifyHeader("restaurant_name")).toBeUndefined();
		// A bare "name" is ambiguous, so it is held back rather than assumed safe.
		expect(classifyHeader("name")?.category).toBe("person");
	});

	it("does not quarantine 'state' inside unrelated words", () => {
		expect(classifyHeader("order_state")).toBeUndefined();
		expect(classifyHeader("restaurant_category")).toBeUndefined();
	});

	it("strips quarantined values from rows, not just from the header list", () => {
		const csv = {
			headers: ["order_date", "delivery_address", "subtotal"],
			rows: [
				{ order_date: "2026-01-01", delivery_address: "42 Elm St, Apt 3B", subtotal: "$18.00" },
			],
		};
		const { csv: clean, quarantined } = applyIntakeQuarantine(csv);
		expect(clean.headers).toEqual(["order_date", "subtotal"]);
		expect(quarantined).toHaveLength(1);
		expect(Object.keys(clean.rows[0])).toEqual(["order_date", "subtotal"]);
		expect(JSON.stringify(clean)).not.toMatch(/Elm St|Apt 3B/);
	});

	it("passes clean input through untouched", () => {
		const csv = {
			headers: ["order_date", "subtotal"],
			rows: [{ order_date: "2026-01-01", subtotal: "$18.00" }],
		};
		const { csv: clean, quarantined } = applyIntakeQuarantine(csv);
		expect(quarantined).toEqual([]);
		expect(clean.rows).toEqual(csv.rows);
	});

	it("summarizes refusals grouped by category", () => {
		const { quarantined } = classifyHeaders(["delivery_address", "city", "dasher_name"]);
		const summary = summarizeQuarantine(quarantined);
		expect(summary.join(" ")).toMatch(/location: dropped 2/);
		expect(summary.join(" ")).toMatch(/person: dropped 1/);
	});

	it("is case- and separator-insensitive, since exports are inconsistent", () => {
		for (const header of ["Delivery Address", "DELIVERY_ADDRESS", "deliveryAddress", "Dropoff Latitude"]) {
			expect(classifyHeader(header), header).toBeDefined();
		}
	});
});
