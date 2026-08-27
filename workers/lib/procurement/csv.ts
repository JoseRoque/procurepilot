import type { StoredProcurementEarlyAccessSubmission } from "./types";

const CSV_HEADERS = [
	"id",
	"workEmail",
	"fullName",
	"companyName",
	"jobTitle",
	"companySize",
	"annualAddressableSpend",
	"procurementMaturity",
	"primaryCategories",
	"purchasingChannels",
	"biggestChallenge",
	"currentSystems",
	"browserExtensionInterest",
	"pilotInterest",
	"notes",
	"status",
	"source",
	"formVersion",
	"createdAt",
	"updatedAt",
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];

/**
 * Formula-injection guard: a cell that opens with =, +, -, or @ can be
 * interpreted as a formula by Excel/Sheets when the CSV is opened. Prefixing
 * with a single quote forces those cells to be treated as literal text.
 */
function guardFormulaInjection(value: string): string {
	return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvCell(rawValue: string): string {
	const guarded = guardFormulaInjection(rawValue);
	const needsQuoting = /[",\n\r]/.test(guarded);
	const escaped = guarded.replace(/"/g, '""');
	return needsQuoting ? `"${escaped}"` : escaped;
}

function cellFor(row: StoredProcurementEarlyAccessSubmission, header: CsvHeader): string {
	switch (header) {
		case "id":
			return row.id;
		case "workEmail":
			return row.workEmail;
		case "fullName":
			return row.fullName;
		case "companyName":
			return row.companyName;
		case "jobTitle":
			return row.jobTitle;
		case "companySize":
			return row.companySize;
		case "annualAddressableSpend":
			return row.annualAddressableSpend ?? "";
		case "procurementMaturity":
			return row.procurementMaturity ?? "";
		case "primaryCategories":
			return (row.primaryCategories ?? []).join("; ");
		case "purchasingChannels":
			return (row.purchasingChannels ?? []).join("; ");
		case "biggestChallenge":
			return row.biggestChallenge;
		case "currentSystems":
			return row.currentSystems ?? "";
		case "browserExtensionInterest":
			return row.browserExtensionInterest ? "true" : "false";
		case "pilotInterest":
			return row.pilotInterest ? "true" : "false";
		case "notes":
			return row.notes ?? "";
		case "status":
			return row.status;
		case "source":
			return row.source;
		case "formVersion":
			return row.formVersion;
		case "createdAt":
			return row.createdAt;
		case "updatedAt":
			return row.updatedAt;
	}
}

const UTF8_BOM = "﻿";

/**
 * Builds a CSV export (with UTF-8 BOM for spreadsheet compatibility).
 * Excludes ipHash/userAgentHash by design — those are internal
 * abuse-forensics fields, never operator-facing exports.
 */
export function buildProcurementLeadsCsv(
	rows: StoredProcurementEarlyAccessSubmission[],
): string {
	const lines = [CSV_HEADERS.join(",")];
	for (const row of rows) {
		lines.push(CSV_HEADERS.map((header) => escapeCsvCell(cellFor(row, header))).join(","));
	}
	return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

export function csvExportFilename(date: Date = new Date()): string {
	return `procurement-early-access-${date.toISOString().slice(0, 10)}.csv`;
}
