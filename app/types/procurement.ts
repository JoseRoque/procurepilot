export type CompanySize =
	| "1-50"
	| "51-200"
	| "201-1000"
	| "1001-5000"
	| "5001+";

/** @deprecated use {@link CompanySize} */
export type ProcurementCompanySize = CompanySize;

export type ProcurementEarlyAccessSubmission = {
	workEmail: string;
	fullName: string;
	companyName: string;
	jobTitle: string;
	companySize: CompanySize;
	annualAddressableSpend?: string;
	procurementMaturity?: string;
	primaryCategories?: string[];
	purchasingChannels?: string[];
	biggestChallenge: string;
	currentSystems?: string;
	browserExtensionInterest?: boolean;
	pilotInterest?: boolean;
	notes?: string;
	createdAt?: string;
};

/** Field-level validation errors as returned by the shared validator and the API. */
export type ProcurementEarlyAccessFieldErrors = Record<string, string[]>;

export type ProcurementApiErrorCode =
	| "VALIDATION_ERROR"
	| "RATE_LIMITED"
	| "DUPLICATE_SUBMISSION"
	| "INVALID_JSON"
	| "PAYLOAD_TOO_LARGE"
	| "INTERNAL_ERROR"
	| "UNAUTHORIZED"
	| "NOT_FOUND"
	| "SERVICE_UNAVAILABLE";

export type ProcurementApiSuccessResponse<T> = {
	ok: true;
	data: T;
};

export type ProcurementApiErrorResponse = {
	ok: false;
	error: {
		code: ProcurementApiErrorCode;
		message: string;
		fields?: ProcurementEarlyAccessFieldErrors;
	};
};

export type ProcurementApiResponse<T> =
	| ProcurementApiSuccessResponse<T>
	| ProcurementApiErrorResponse;

export type ProcurementSubmitSuccessData = {
	id?: string;
	message: string;
};

/** Subset of a stored lead returned by the admin list endpoint. */
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
	status: string;
	createdAt: string;
};

export type ProcurementLeadListData = {
	items: ProcurementLeadListItem[];
	nextCursor?: string;
};
