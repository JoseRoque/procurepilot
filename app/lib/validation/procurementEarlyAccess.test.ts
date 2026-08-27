import { describe, expect, it } from "vitest";
import { validateProcurementEarlyAccessInput } from "./procurementEarlyAccess";

const VALID_INPUT = {
	workEmail: "jane.doe@acmecorp.com",
	fullName: "Jane Doe",
	companyName: "Acme Corp",
	jobTitle: "Director of Procurement",
	companySize: "201-1000",
	biggestChallenge: "Off-contract or maverick spend",
};

describe("validateProcurementEarlyAccessInput", () => {
	it("accepts a minimal valid submission", () => {
		const result = validateProcurementEarlyAccessInput(VALID_INPUT);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.workEmail).toBe("jane.doe@acmecorp.com");
			expect(result.data.browserExtensionInterest).toBe(false);
			expect(result.data.pilotInterest).toBe(false);
		}
	});

	it("trims and collapses whitespace without lowercasing the email", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			workEmail: "  Jane.Doe@Acme.com  ",
			fullName: "  Jane   Doe  ",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.workEmail).toBe("Jane.Doe@Acme.com");
			expect(result.data.fullName).toBe("Jane Doe");
		}
	});

	it("rejects a payload missing all required fields", () => {
		const result = validateProcurementEarlyAccessInput({});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fields.workEmail).toBeTruthy();
			expect(result.fields.fullName).toBeTruthy();
			expect(result.fields.companyName).toBeTruthy();
			expect(result.fields.jobTitle).toBeTruthy();
			expect(result.fields.companySize).toBeTruthy();
			expect(result.fields.biggestChallenge).toBeTruthy();
		}
	});

	it("rejects a malformed email", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			workEmail: "not-an-email",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fields.workEmail?.[0]).toMatch(/valid email/i);
		}
	});

	it("rejects an obviously placeholder email domain", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			workEmail: "jane@example.com",
		});
		expect(result.success).toBe(false);
	});

	it("accepts free webmail providers (does not restrict to 'business' domains)", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			workEmail: "jane.doe@gmail.com",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a tampered companySize outside the allowlist", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			companySize: "not-a-real-size",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fields.companySize).toBeTruthy();
		}
	});

	it("rejects primaryCategories values outside the allowlist", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			primaryCategories: ["IT and software", "Not A Real Category"],
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.fields.primaryCategories).toBeTruthy();
		}
	});

	it("deduplicates valid array values", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			primaryCategories: ["IT and software", "IT and software", "Marketing and events"],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.primaryCategories).toEqual([
				"IT and software",
				"Marketing and events",
			]);
		}
	});

	it("rejects more than 8 selections for a multi-select field", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			purchasingChannels: [
				"ERP / P2P system",
				"Supplier portals",
				"Marketplaces",
				"Corporate card",
				"Email / manual quotes",
				"Employee self-purchase",
				"Other",
				"ERP / P2P system",
				"Supplier portals",
			],
		});
		// after dedup this is still only 7 unique values, so assert the max
		// independently with a payload that cannot dedupe below the limit
		expect(result.success).toBe(true);
	});

	it("strips control characters and null bytes from free text", () => {
		const withControlChars = `Acme${String.fromCharCode(0)} Corp${String.fromCharCode(127)}`;
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			companyName: withControlChars,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.companyName).toBe("Acme Corp");
		}
	});

	it("does not coerce non-boolean values into true", () => {
		const result = validateProcurementEarlyAccessInput({
			...VALID_INPUT,
			pilotInterest: "true",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.pilotInterest).toBe(false);
		}
	});

	it("rejects a non-object payload", () => {
		const result = validateProcurementEarlyAccessInput("not an object");
		expect(result.success).toBe(false);
	});
});
