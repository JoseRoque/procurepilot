import { beforeEach, describe, expect, it } from "vitest";
import {
	checkRateLimit,
	hashFingerprint,
	RATE_LIMIT_WINDOW_MS,
	__resetRateLimitStateForTests,
} from "./rateLimit";

describe("checkRateLimit", () => {
	beforeEach(() => {
		__resetRateLimitStateForTests();
	});

	it("allows submissions up to the configured max within a window", () => {
		const key = "fingerprint-a";
		const now = 1_000_000;
		for (let i = 0; i < 5; i++) {
			expect(checkRateLimit(key, 5, now).allowed).toBe(true);
		}
	});

	it("blocks the submission after the max is reached in the same window", () => {
		const key = "fingerprint-b";
		const now = 1_000_000;
		for (let i = 0; i < 5; i++) {
			checkRateLimit(key, 5, now);
		}
		const result = checkRateLimit(key, 5, now);
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.retryAfterSeconds).toBeGreaterThan(0);
		}
	});

	it("resets the bucket once the window has elapsed", () => {
		const key = "fingerprint-c";
		const start = 1_000_000;
		for (let i = 0; i < 5; i++) {
			checkRateLimit(key, 5, start);
		}
		expect(checkRateLimit(key, 5, start).allowed).toBe(false);

		const afterWindow = start + RATE_LIMIT_WINDOW_MS + 1;
		expect(checkRateLimit(key, 5, afterWindow).allowed).toBe(true);
	});

	it("tracks separate fingerprints independently", () => {
		const now = 1_000_000;
		for (let i = 0; i < 5; i++) {
			checkRateLimit("fingerprint-d", 5, now);
		}
		expect(checkRateLimit("fingerprint-d", 5, now).allowed).toBe(false);
		expect(checkRateLimit("fingerprint-e", 5, now).allowed).toBe(true);
	});
});

describe("hashFingerprint", () => {
	it("produces a deterministic hex digest for the same input and salt", async () => {
		const a = await hashFingerprint("1.2.3.4", "salt");
		const b = await hashFingerprint("1.2.3.4", "salt");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it("produces different digests for different salts", async () => {
		const a = await hashFingerprint("1.2.3.4", "salt-one");
		const b = await hashFingerprint("1.2.3.4", "salt-two");
		expect(a).not.toBe(b);
	});

	it("never contains the raw input value", async () => {
		const hash = await hashFingerprint("203.0.113.42", "salt");
		expect(hash).not.toContain("203.0.113.42");
	});
});
