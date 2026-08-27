import type {
	ProcurementApiErrorCode,
	ProcurementApiErrorResponse,
	ProcurementApiSuccessResponse,
	ProcurementEarlyAccessFieldErrors,
} from "~/types/procurement";

export function apiSuccess<T>(data: T): ProcurementApiSuccessResponse<T> {
	return { ok: true, data };
}

export function apiError(
	code: ProcurementApiErrorCode,
	message: string,
	fields?: ProcurementEarlyAccessFieldErrors,
): ProcurementApiErrorResponse {
	return { ok: false, error: { code, message, ...(fields ? { fields } : {}) } };
}

const STATUS_BY_ERROR_CODE: Record<ProcurementApiErrorCode, number> = {
	VALIDATION_ERROR: 400,
	RATE_LIMITED: 429,
	DUPLICATE_SUBMISSION: 409,
	INVALID_JSON: 400,
	PAYLOAD_TOO_LARGE: 413,
	INTERNAL_ERROR: 500,
	UNAUTHORIZED: 401,
	NOT_FOUND: 404,
	SERVICE_UNAVAILABLE: 503,
};

export function statusForErrorCode(code: ProcurementApiErrorCode): number {
	return STATUS_BY_ERROR_CODE[code];
}
