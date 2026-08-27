import { z } from "zod";
import type {
	CompanySize,
	ProcurementEarlyAccessFieldErrors,
	ProcurementEarlyAccessSubmission,
} from "~/types/procurement";
import { sanitizeText } from "./sanitize";

export const COMPANY_SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
	{ value: "1-50", label: "1–50" },
	{ value: "51-200", label: "51–200" },
	{ value: "201-1000", label: "201–1,000" },
	{ value: "1001-5000", label: "1,001–5,000" },
	{ value: "5001+", label: "5,001+" },
];

const COMPANY_SIZE_VALUES = COMPANY_SIZE_OPTIONS.map(
	(option) => option.value,
) as [CompanySize, ...CompanySize[]];

export const PRIMARY_CATEGORY_OPTIONS = [
	"Facilities and office supplies",
	"IT and software",
	"Marketing and events",
	"MRO and operations",
	"Professional services",
	"Travel and expense",
	"Other",
] as const;

export const PURCHASING_CHANNEL_OPTIONS = [
	"ERP / P2P system",
	"Supplier portals",
	"Marketplaces",
	"Corporate card",
	"Email / manual quotes",
	"Employee self-purchase",
	"Other",
] as const;

export const BIGGEST_CHALLENGE_OPTIONS = [
	"Low contract utilization",
	"Off-contract or maverick spend",
	"Poor spend visibility",
	"Slow purchasing and approvals",
	"Difficulty comparing supplier total cost",
	"Catalog adoption",
	"Tail-spend control",
	"Other",
] as const;

const MAX_MULTI_SELECT_ITEMS = 8;

/**
 * A small, conservative denylist of obviously placeholder/test domains.
 * This is NOT a disposable-email detection service (those are unreliable
 * and out of scope for this MVP) — it only rejects unmistakably fake
 * addresses like `name@example.com`. Real work email providers, including
 * free webmail, are accepted: this field is labeled "work email" but we do
 * not claim to verify that an address is a business address.
 */
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
	"example.com",
	"example.org",
	"example.net",
	"test.com",
	"mailinator.com",
]);

function sanitizedPreprocess(val: unknown): unknown {
	return typeof val === "string" ? sanitizeText(val) : val;
}

function sanitizedRequiredString(min: number, max: number, requiredMessage: string) {
	return z.preprocess(
		sanitizedPreprocess,
		z
			.string({ message: requiredMessage })
			.min(min, requiredMessage)
			.max(max, `Must be ${max} characters or fewer.`),
	);
}

function sanitizedOptionalString(max: number) {
	return z.preprocess(
		(val) => {
			if (typeof val !== "string") return undefined;
			const cleaned = sanitizeText(val);
			return cleaned.length > 0 ? cleaned : undefined;
		},
		z.string().max(max, `Must be ${max} characters or fewer.`).optional(),
	);
}

function allowlistArray(allowed: readonly [string, ...string[]]) {
	return z
		.preprocess((val) => {
			if (val === undefined || val === null) return undefined;
			if (!Array.isArray(val)) return val;
			const cleaned = val.map((item) =>
				typeof item === "string" ? sanitizeText(item) : item,
			);
			return Array.from(new Set(cleaned));
		}, z.array(z.enum(allowed)).max(MAX_MULTI_SELECT_ITEMS, `Select up to ${MAX_MULTI_SELECT_ITEMS} options.`))
		.optional();
}

function legitimateBoolean() {
	return z.preprocess(
		(val) => (typeof val === "boolean" ? val : undefined),
		z.boolean().default(false),
	);
}

const workEmailInner = z
	.string({ message: "Work email is required." })
	.min(3, "Work email is required.")
	.max(254, "Work email is too long.")
	.pipe(z.email("Enter a valid email address."))
	.refine(
		(value) => !PLACEHOLDER_EMAIL_DOMAINS.has(value.split("@")[1]?.toLowerCase() ?? ""),
		"Enter your work email address.",
	);

const workEmailField = z.preprocess(sanitizedPreprocess, workEmailInner);

export const procurementEarlyAccessSchema = z.object({
	workEmail: workEmailField,
	fullName: sanitizedRequiredString(2, 120, "Full name is required."),
	companyName: sanitizedRequiredString(2, 160, "Company name is required."),
	jobTitle: sanitizedRequiredString(2, 160, "Job title is required."),
	companySize: z.preprocess(
		sanitizedPreprocess,
		z.enum(COMPANY_SIZE_VALUES, { message: "Select your company size." }),
	),
	annualAddressableSpend: sanitizedOptionalString(100),
	procurementMaturity: sanitizedOptionalString(100),
	primaryCategories: allowlistArray(PRIMARY_CATEGORY_OPTIONS),
	purchasingChannels: allowlistArray(PURCHASING_CHANNEL_OPTIONS),
	biggestChallenge: z.preprocess(
		sanitizedPreprocess,
		z.enum(BIGGEST_CHALLENGE_OPTIONS, { message: "Select your biggest challenge." }),
	),
	currentSystems: sanitizedOptionalString(1000),
	browserExtensionInterest: legitimateBoolean(),
	pilotInterest: legitimateBoolean(),
	notes: sanitizedOptionalString(2000),
});

export type ProcurementValidationResult =
	| { success: true; data: ProcurementEarlyAccessSubmission }
	| { success: false; fields: ProcurementEarlyAccessFieldErrors };

/**
 * Single source of truth for validating an early-access submission. Used
 * both by the client form (for immediate inline feedback) and the Hono API
 * handler (which always re-validates — client-side checks are never
 * trusted on their own).
 */
export function validateProcurementEarlyAccessInput(
	raw: unknown,
): ProcurementValidationResult {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			success: false,
			fields: { _root: ["Submission payload is malformed."] },
		};
	}

	const result = procurementEarlyAccessSchema.safeParse(raw);
	if (!result.success) {
		const fields: ProcurementEarlyAccessFieldErrors = {};
		for (const issue of result.error.issues) {
			const key = issue.path.length > 0 ? String(issue.path[0]) : "_root";
			(fields[key] ??= []).push(issue.message);
		}
		return { success: false, fields };
	}

	return { success: true, data: result.data as ProcurementEarlyAccessSubmission };
}
