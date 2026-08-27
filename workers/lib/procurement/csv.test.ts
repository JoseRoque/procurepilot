import { describe, expect, it } from "vitest";
import { buildProcurementLeadsCsv } from "./csv";
import type { StoredProcurementEarlyAccessSubmission } from "./types";

function makeLead(
	overrides: Partial<StoredProcurementEarlyAccessSubmission> = {},
): StoredProcurementEarlyAccessSubmission {
	return {
		id: "lead-1",
		workEmail: "jane@acme.com",
		fullName: "Jane Doe",
		companyName: "Acme Corp",
		jobTitle: "Director",
		companySize: "201-1000",
		biggestChallenge: "Poor spend visibility",
		browserExtensionInterest: false,
		pilotInterest: false,
		status: "new",
		source: "procurement_landing_page",
		formVersion: "v1",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("buildProcurementLeadsCsv", () => {
	it("includes a UTF-8 BOM and a header row", () => {
		const csv = buildProcurementLeadsCsv([]);
		expect(csv.startsWith("﻿")).toBe(true);
		expect(csv).toContain("id,workEmail,fullName");
	});

	it("never includes ipHash or userAgentHash columns", () => {
		const csv = buildProcurementLeadsCsv([
			makeLead({ ipHash: "abc123", userAgentHash: "def456" }),
		]);
		expect(csv).not.toContain("ipHash");
		expect(csv).not.toContain("userAgentHash");
		expect(csv).not.toContain("abc123");
		expect(csv).not.toContain("def456");
	});

	it("quotes and escapes cells containing commas, quotes, or newlines", () => {
		const csv = buildProcurementLeadsCsv([
			makeLead({ companyName: 'Acme, "The" Corp\nSecond line' }),
		]);
		expect(csv).toContain('"Acme, ""The"" Corp\nSecond line"');
	});

	it("prefixes formula-like cells with a single quote to prevent CSV injection", () => {
		const csv = buildProcurementLeadsCsv([
			makeLead({ notes: "=cmd|'/c calc'!A1" }),
			makeLead({ id: "lead-2", companyName: "+1234" }),
			makeLead({ id: "lead-3", jobTitle: "-2" }),
			makeLead({ id: "lead-4", currentSystems: "@SUM(A1:A2)" }),
		]);
		expect(csv).toMatch(/'=cmd/);
		expect(csv).toMatch(/'\+1234/);
		expect(csv).toMatch(/'-2/);
		expect(csv).toMatch(/'@SUM/);
	});

	it("serializes arrays and booleans as expected", () => {
		const csv = buildProcurementLeadsCsv([
			makeLead({
				primaryCategories: ["IT and software", "Marketing and events"],
				pilotInterest: true,
			}),
		]);
		expect(csv).toContain("IT and software; Marketing and events");
		expect(csv).toContain("true");
	});
});
