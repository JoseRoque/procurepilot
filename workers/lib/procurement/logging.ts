/**
 * Structured, non-sensitive request logging for the procurement API.
 *
 * NEVER pass: raw email addresses, names, notes, full request/response
 * bodies, the admin token, or hash salts through this helper. Only
 * request id, route, status, lead id (once generated), and a coarse error
 * category are safe to log.
 */

export function getOrCreateRequestId(request: Request): string {
	return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

type SafeLogFields = {
	requestId: string;
	route: string;
	status: number;
	leadId?: string;
	errorCategory?: string;
};

export function logApiEvent(fields: SafeLogFields): void {
	console.log(JSON.stringify({ scope: "procurement_api", ...fields }));
}
