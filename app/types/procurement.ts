export type ProcurementCompanySize =
	| "1-50"
	| "51-200"
	| "201-1000"
	| "1001-5000"
	| "5001+";

export type ProcurementEarlyAccessSubmission = {
	workEmail: string;
	fullName: string;
	companyName: string;
	jobTitle: string;
	companySize: ProcurementCompanySize;
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

export type ProcurementEarlyAccessFieldErrors = Partial<
	Record<keyof ProcurementEarlyAccessSubmission, string>
>;

export type ProcurementEarlyAccessSuccessResponse = {
	success: true;
	data: {
		id: string;
		createdAt: string;
	};
};

export type ProcurementEarlyAccessErrorResponse = {
	success: false;
	error: {
		message: string;
		fieldErrors?: ProcurementEarlyAccessFieldErrors;
	};
};

export type ProcurementEarlyAccessResponse =
	| ProcurementEarlyAccessSuccessResponse
	| ProcurementEarlyAccessErrorResponse;
