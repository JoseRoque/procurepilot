import { describe, expect, it } from "vitest";
import { approvalScopeHash, canonicalJson, chainEventHash, sha256Hex } from "./hashing";

describe("canonicalJson", () => {
	it("orders keys deterministically regardless of insertion order", () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
	});

	it("drops undefined values", () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
	});
});

describe("ledger chain hashing", () => {
	it("is deterministic and chains on the previous hash", async () => {
		const first = await chainEventHash({
			previousHash: null,
			payload: { eventType: "plan_created", entityId: "plan-1" },
			occurredAt: "2026-08-28T12:00:00.000Z",
			eventId: "e-1",
		});
		const firstAgain = await chainEventHash({
			previousHash: null,
			payload: { entityId: "plan-1", eventType: "plan_created" },
			occurredAt: "2026-08-28T12:00:00.000Z",
			eventId: "e-1",
		});
		expect(first).toBe(firstAgain);
		expect(first).toMatch(/^[0-9a-f]{64}$/);

		const second = await chainEventHash({
			previousHash: first,
			payload: { eventType: "plan_updated", entityId: "plan-1" },
			occurredAt: "2026-08-28T12:01:00.000Z",
			eventId: "e-2",
		});
		const tamperedChain = await chainEventHash({
			previousHash: "0".repeat(64),
			payload: { eventType: "plan_updated", entityId: "plan-1" },
			occurredAt: "2026-08-28T12:01:00.000Z",
			eventId: "e-2",
		});
		expect(second).not.toBe(tamperedChain);
	});
});

describe("approvalScopeHash", () => {
	it("changes when the payload or page state changes", async () => {
		const base = {
			actionId: "a-1",
			actionType: "add_exact_approved_item",
			payload: { itemName: "Fixture dark chocolate bar", quantity: 1, maxUnitPriceCents: 600 },
			pageOrigin: "https://demo-store.fixture.local",
			pageStateHash: "hash-1",
		};
		const original = await approvalScopeHash(base);
		expect(original).toBe(await approvalScopeHash({ ...base }));
		expect(original).not.toBe(
			await approvalScopeHash({ ...base, payload: { ...base.payload, quantity: 2 } }),
		);
		expect(original).not.toBe(await approvalScopeHash({ ...base, pageStateHash: "hash-2" }));
	});
});

describe("sha256Hex", () => {
	it("matches a known vector", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
