import type {
	ProcurementCompanySize,
	ProcurementEarlyAccessFieldErrors,
	ProcurementEarlyAccessSubmission,
} from "~/types/procurement";

export const COMPANY_SIZE_OPTIONS: {
	value: ProcurementCompanySize;
	label: string;
}[] = [
	{ value: "1-50", label: "1–50" },
	{ value: "51-200", label: "51–200" },
	{ value: "201-1000", label: "201–1,000" },
	{ value: "1001-5000", label: "1,001–5,000" },
	{ value: "5001+", label: "5,001+" },
];

const COMPANY_SIZE_VALUES = COMPANY_SIZE_OPTIONS.map((option) => option.value);

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

const FIELD_LIMITS = {
	workEmail: 254,
	fullName: 120,
	companyName: 150,
	jobTitle: 120,
	annualAddressableSpend: 100,
	procurementMaturity: 200,
	currentSystems: 300,
	notes: 1000,
} as const;

const MAX_MULTI_SELECT_ITEMS = 10;

// A reasonably strict but practical RFC 5322-ish email pattern, not a full spec implementation.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FREE_EMAIL_DOMAINS = new Set([
	"gmail.com",
	"yahoo.com",
	"hotmail.com",
	"outlook.com",
	"live.com",
	"aol.com",
	"icloud.com",
	"msn.com",
	"protonmail.com",
	"mail.com",
]);

function isValidEmailFormat(value: string): boolean {
	return EMAIL_PATTERN.test(value);
}

function isLikelyBusinessEmail(value: string): boolean {
	const domain = value.split("@")[1]?.toLowerCase().trim();
	if (!domain) return false;
	return !FREE_EMAIL_DOMAINS.has(domain);
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown, allowed: readonly string[]): string[] {
	if (!Array.isArray(value)) return [];
	const deduped = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (trimmed.length === 0) continue;
		if (!allowed.includes(trimmed)) continue;
		deduped.add(trimmed);
	}
	return Array.from(deduped).slice(0, MAX_MULTI_SELECT_ITEMS);
}

export type ProcurementValidationResult =
	| { success: true; data: ProcurementEarlyAccessSubmission }
	| { success: false; fieldErrors: ProcurementEarlyAccessFieldErrors };

/**
 * Pure validator shared by the client form and the Hono API handler. The
 * client uses it for immediate inline feedback; the server always re-runs it
 * against the raw request body, since client-side checks can be bypassed.
 */
export function validateProcurementEarlyAccessInput(
	raw: unknown,
): ProcurementValidationResult {
	const fieldErrors: ProcurementEarlyAccessFieldErrors = {};

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			success: false,
			fieldErrors: { workEmail: "Submission payload is malformed." },
		};
	}

	const input = raw as Record<string, unknown>;

	const workEmail = asTrimmedString(input.workEmail);
	if (!workEmail) {
		fieldErrors.workEmail = "Work email is required.";
	} else if (workEmail.length > FIELD_LIMITS.workEmail) {
		fieldErrors.workEmail = "Work email is too long.";
	} else if (!isValidEmailFormat(workEmail)) {
		fieldErrors.workEmail = "Enter a valid email address.";
	} else if (!isLikelyBusinessEmail(workEmail)) {
		fieldErrors.workEmail = "Please use your business email address.";
	}

	const fullName = asTrimmedString(input.fullName);
	if (!fullName) {
		fieldErrors.fullName = "Full name is required.";
	} else if (fullName.length > FIELD_LIMITS.fullName) {
		fieldErrors.fullName = "Full name is too long.";
	}

	const companyName = asTrimmedString(input.companyName);
	if (!companyName) {
		fieldErrors.companyName = "Company name is required.";
	} else if (companyName.length > FIELD_LIMITS.companyName) {
		fieldErrors.companyName = "Company name is too long.";
	}

	const jobTitle = asTrimmedString(input.jobTitle);
	if (!jobTitle) {
		fieldErrors.jobTitle = "Job title is required.";
	} else if (jobTitle.length > FIELD_LIMITS.jobTitle) {
		fieldErrors.jobTitle = "Job title is too long.";
	}

	const companySizeRaw = asTrimmedString(input.companySize);
	const companySize = COMPANY_SIZE_VALUES.find(
		(value) => value === companySizeRaw,
	);
	if (!companySize) {
		fieldErrors.companySize = "Select your company size.";
	}

	const biggestChallenge = asTrimmedString(input.biggestChallenge);
	if (!biggestChallenge) {
		fieldErrors.biggestChallenge = "Select your biggest challenge.";
	} else if (!BIGGEST_CHALLENGE_OPTIONS.includes(biggestChallenge as never)) {
		fieldErrors.biggestChallenge = "Select a valid option.";
	}

	const annualAddressableSpend = asTrimmedString(
		input.annualAddressableSpend,
	);
	if (
		annualAddressableSpend &&
		annualAddressableSpend.length > FIELD_LIMITS.annualAddressableSpend
	) {
		fieldErrors.annualAddressableSpend = "Keep this under 100 characters.";
	}

	const procurementMaturity = asTrimmedString(input.procurementMaturity);
	if (
		procurementMaturity &&
		procurementMaturity.length > FIELD_LIMITS.procurementMaturity
	) {
		fieldErrors.procurementMaturity = "Keep this under 200 characters.";
	}

	const currentSystems = asTrimmedString(input.currentSystems);
	if (currentSystems && currentSystems.length > FIELD_LIMITS.currentSystems) {
		fieldErrors.currentSystems = "Keep this under 300 characters.";
	}

	const notes = asTrimmedString(input.notes);
	if (notes && notes.length > FIELD_LIMITS.notes) {
		fieldErrors.notes = "Keep this under 1000 characters.";
	}

	const primaryCategories = asStringArray(
		input.primaryCategories,
		PRIMARY_CATEGORY_OPTIONS,
	);
	const purchasingChannels = asStringArray(
		input.purchasingChannels,
		PURCHASING_CHANNEL_OPTIONS,
	);

	const browserExtensionInterest = input.browserExtensionInterest === true;
	const pilotInterest = input.pilotInterest === true;

	if (Object.keys(fieldErrors).length > 0) {
		return { success: false, fieldErrors };
	}

	return {
		success: true,
		data: {
			workEmail: workEmail as string,
			fullName: fullName as string,
			companyName: companyName as string,
			jobTitle: jobTitle as string,
			companySize: companySize as ProcurementCompanySize,
			biggestChallenge: biggestChallenge as string,
			...(annualAddressableSpend ? { annualAddressableSpend } : {}),
			...(procurementMaturity ? { procurementMaturity } : {}),
			...(primaryCategories.length > 0 ? { primaryCategories } : {}),
			...(purchasingChannels.length > 0 ? { purchasingChannels } : {}),
			...(currentSystems ? { currentSystems } : {}),
			browserExtensionInterest,
			pilotInterest,
			...(notes ? { notes } : {}),
		},
	};
}
