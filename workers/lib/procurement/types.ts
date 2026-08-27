import type { ProcurementEarlyAccessSubmission } from "~/types/procurement";

export type ProcurementLeadStatus =
	| "new"
	| "reviewing"
	| "qualified"
	| "contacted"
	| "not_a_fit"
	| "archived";

export const PROCUREMENT_LEAD_STATUSES: readonly ProcurementLeadStatus[] = [
	"new",
	"reviewing",
	"qualified",
	"contacted",
	"not_a_fit",
	"archived",
];

export type StoredProcurementEarlyAccessSubmission =
	ProcurementEarlyAccessSubmission & {
		id: string;
		createdAt: string;
		updatedAt: string;
		status: ProcurementLeadStatus;
		source: "procurement_landing_page";
		formVersion: string;
		ipHash?: string;
		userAgentHash?: string;
	};

export type CreateProcurementLeadInput = {
	submission: ProcurementEarlyAccessSubmission;
	normalizedEmail: string;
	formVersion: string;
	ipHash?: string;
	userAgentHash?: string;
};

export type ProcurementLeadListQuery = {
	status?: ProcurementLeadStatus;
	limit: number;
	cursor?: string;
};

export type ProcurementLeadListItem = {
	id: string;
	workEmail: string;
	fullName: string;
	companyName: string;
	jobTitle: string;
	companySize: string;
	biggestChallenge: string;
	primaryCategories: string[];
	purchasingChannels: string[];
	pilotInterest: boolean;
	browserExtensionInterest: boolean;
	status: ProcurementLeadStatus;
	createdAt: string;
};

export type ProcurementLeadListResult = {
	items: ProcurementLeadListItem[];
	nextCursor?: string;
};

/**
 * Persistence boundary for procurement early-access leads. The D1
 * implementation is used whenever `env.DB` is bound; otherwise callers fall
 * back to the in-memory implementation for local development only.
 */
export interface ProcurementLeadRepository {
	findByNormalizedEmail(
		normalizedEmail: string,
	): Promise<StoredProcurementEarlyAccessSubmission | null>;
	create(
		input: CreateProcurementLeadInput,
	): Promise<StoredProcurementEarlyAccessSubmission>;
	getById(id: string): Promise<StoredProcurementEarlyAccessSubmission | null>;
	updateStatus(
		id: string,
		status: ProcurementLeadStatus,
	): Promise<StoredProcurementEarlyAccessSubmission | null>;
	list(query: ProcurementLeadListQuery): Promise<ProcurementLeadListResult>;
	/** Full unpaginated dataset, newest first — used only by the CSV export path. */
	listAllForExport(): Promise<StoredProcurementEarlyAccessSubmission[]>;
}

export function toLeadListItem(
	row: StoredProcurementEarlyAccessSubmission,
): ProcurementLeadListItem {
	return {
		id: row.id,
		workEmail: row.workEmail,
		fullName: row.fullName,
		companyName: row.companyName,
		jobTitle: row.jobTitle,
		companySize: row.companySize,
		biggestChallenge: row.biggestChallenge,
		primaryCategories: row.primaryCategories ?? [],
		purchasingChannels: row.purchasingChannels ?? [],
		pilotInterest: row.pilotInterest ?? false,
		browserExtensionInterest: row.browserExtensionInterest ?? false,
		status: row.status,
		createdAt: row.createdAt,
	};
}
