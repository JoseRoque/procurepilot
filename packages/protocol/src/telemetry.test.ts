import { describe, expect, it } from "vitest";
import { eventIntegrityHash } from "./hashing";
import {
	bucketSubtotal,
	validateRedactedEvent,
	type RedactedOutcomeEvent,
} from "./telemetry";

async function makeValidEvent(
	overrides: Partial<RedactedOutcomeEvent> = {},
): Promise<RedactedOutcomeEvent> {
	const base: Omit<RedactedOutcomeEvent, "eventIntegrityHash"> = {
		schemaVersion: 1,
		eventId: "3f1f2a44-9e1b-4c5a-8f5e-2b7c9d0e1a2b",
		pseudonymousDeviceId: "dev-abcdef0123456789",
		consentReceiptId: "receipt-1",
		consentVersion: "consent-v1",
		contributionMode: "contribute_redacted_outcomes",
		eventType: "visible_offer_outcome",
		platform: "demo_store",
		adapterId: "demo_store",
		adapterVersion: "demo-1.0.0",
		occurredAt: "2026-08-28T12:00:00.000Z",
		subtotalBucket: "25_35",
		offerType: "threshold_discount",
		offerTerms: { hasMinimumSpend: true, minimumSpendCents: 3500, discountPercent: 30 },
		outcome: "observed",
		confidence: "high",
		configPackVersion: "1.0.0",
		...overrides,
	};
	const hash = await eventIntegrityHash(base as Record<string, unknown>);
	return { ...base, eventIntegrityHash: hash } as RedactedOutcomeEvent;
}

describe("redacted event validation", () => {
	it("accepts a fully redacted, well-formed event", async () => {
		const event = await makeValidEvent();
		expect(validateRedactedEvent(event)).toMatchObject({ ok: true });
	});

	it("rejects raw cart line names riding along as extra fields", async () => {
		const event = await makeValidEvent();
		const polluted = { ...event, cartLines: ["Organic milk 1gal"] };
		expect(validateRedactedEvent(polluted)).toMatchObject({ ok: false });
	});

	it("rejects email addresses anywhere in string fields", async () => {
		const event = await makeValidEvent({ regionBucket: "person@example.com" });
		expect(validateRedactedEvent(event)).toMatchObject({ ok: false });
	});

	it("rejects URLs and query strings", async () => {
		const withUrl = await makeValidEvent({ regionBucket: "https://x.test/a" });
		expect(validateRedactedEvent(withUrl)).toMatchObject({ ok: false });
		const withQuery = await makeValidEvent({ categoryBuckets: ["a?session=abc"] });
		expect(validateRedactedEvent(withQuery)).toMatchObject({ ok: false });
	});

	it("rejects card-number-length digit runs", async () => {
		const event = await makeValidEvent({ categoryBuckets: ["4111111111111111"] });
		expect(validateRedactedEvent(event)).toMatchObject({ ok: false });
	});

	it("rejects events without the contribute mode literal", async () => {
		const event = await makeValidEvent();
		const wrongMode = { ...event, contributionMode: "local_only" };
		expect(validateRedactedEvent(wrongMode)).toMatchObject({ ok: false });
	});

	it("rejects extra keys inside offerTerms", async () => {
		const event = await makeValidEvent();
		const polluted = {
			...event,
			offerTerms: { ...event.offerTerms, promoCodeText: "SAVE30NOW" },
		};
		expect(validateRedactedEvent(polluted)).toMatchObject({ ok: false });
	});
});

describe("bucketSubtotal", () => {
	it("buckets integer cents into coarse ranges", () => {
		expect(bucketSubtotal(2_499)).toBe("under_25");
		expect(bucketSubtotal(2_500)).toBe("25_35");
		expect(bucketSubtotal(3_499)).toBe("25_35");
		expect(bucketSubtotal(9_999)).toBe("75_100");
		expect(bucketSubtotal(10_000)).toBe("100_plus");
	});
});
