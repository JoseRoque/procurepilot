import type { StoredProcurementEarlyAccessSubmission } from "./types";

/**
 * Follow-up notification hook. No implementation is wired to an external
 * provider yet — this exists so the submission flow has a stable extension
 * point once email/Slack/CRM notification is explicitly requested. The
 * public submission flow must never fail just because a notifier fails.
 */
export interface LeadNotificationService {
	notifyNewLead(lead: StoredProcurementEarlyAccessSubmission): Promise<void>;
}

/**
 * MVP no-op notifier. Logs only non-sensitive, high-level metadata — never
 * the lead's email, name, or notes — matching the project's log-safety
 * rules.
 */
export class NoopLeadNotificationService implements LeadNotificationService {
	async notifyNewLead(lead: StoredProcurementEarlyAccessSubmission): Promise<void> {
		console.log(
			JSON.stringify({
				event: "procurement_lead_created",
				leadId: lead.id,
				companySize: lead.companySize,
				pilotInterest: lead.pilotInterest,
			}),
		);
	}
}
