import { describe, expect, it } from "vitest";
import type { DealRecipe, DealTerm, UserDealContext } from "../../domain/src";
import { assessApplicability } from "./recipes";

const NOW = "2026-06-15T12:00:00.000Z";

function recipe(terms: DealTerm[], overrides: Partial<DealRecipe> = {}): DealRecipe {
	return {
		recipeId: "r1",
		formatVersion: 1,
		merchantId: "examplemart",
		title: "deal",
		items: [],
		terms,
		steps: [],
		createdAt: NOW,
		source: { kind: "authored_locally" },
		...overrides,
	};
}

const NO_CONTEXT: UserDealContext = { memberships: [] };

describe("assessApplicability", () => {
	it("separates an impossible condition from work still to be done", () => {
		// A spend floor is the shape of the work, not a disqualification.
		const result = assessApplicability(recipe([{ kind: "min_spend", cents: 5000 }]), NO_CONTEXT, NOW);
		expect(result.verdict).toBe("likely_applicable");
		expect(result.blockers).toHaveLength(0);
		expect(result.requirements).toHaveLength(1);
		expect(result.explanation.join(" ")).toMatch(/To qualify.*\$50\.00/);
	});

	it("rules out a deal the user has said they cannot join", () => {
		const context: UserDealContext = { memberships: [], excludedMemberships: ["Store Plus"] };
		const result = assessApplicability(
			recipe([{ kind: "member_only", programName: "Store Plus" }]),
			context,
			NOW,
		);
		expect(result.verdict).toBe("not_applicable");
		expect(result.explanation.join(" ")).toMatch(/you have said you do not have/i);
	});

	it("treats a held membership as satisfied rather than as an obstacle", () => {
		const context: UserDealContext = { memberships: ["Store Plus"] };
		const result = assessApplicability(
			recipe([{ kind: "member_only", programName: "Store Plus" }]),
			context,
			NOW,
		);
		expect(result.verdict).toBe("likely_applicable");
		expect(result.blockers).toHaveLength(0);
	});

	it("asks rather than assuming when membership is unknown", () => {
		const result = assessApplicability(
			recipe([{ kind: "member_only", programName: "Store Plus" }]),
			NO_CONTEXT,
			NOW,
		);
		// Neither hidden as unusable nor shown as usable — the user is asked.
		expect(result.verdict).toBe("needs_info");
		expect(result.blockers).toHaveLength(0);
		expect(result.requiresConfirmation).toHaveLength(1);
	});

	it("matches membership names case-insensitively", () => {
		const context: UserDealContext = { memberships: ["store plus"] };
		const result = assessApplicability(
			recipe([{ kind: "member_only", programName: "Store Plus" }]),
			context,
			NOW,
		);
		expect(result.verdict).toBe("likely_applicable");
	});

	it("blocks an expired deal outright", () => {
		const result = assessApplicability(
			recipe([{ kind: "date_window", until: "2026-01-01T00:00:00.000Z" }]),
			NO_CONTEXT,
			NOW,
		);
		expect(result.verdict).toBe("not_applicable");
		expect(result.expiresInDays).toBeUndefined();
	});

	it("blocks on recipe-level expiry too, not just an expiry term", () => {
		const result = assessApplicability(
			recipe([], { validUntil: "2026-02-01T00:00:00.000Z" }),
			NO_CONTEXT,
			NOW,
		);
		expect(result.verdict).toBe("not_applicable");
	});

	it("counts down the days so a deal is not missed", () => {
		const result = assessApplicability(
			recipe([], { validUntil: "2026-06-17T12:00:00.000Z" }),
			NO_CONTEXT,
			NOW,
		);
		expect(result.expiresInDays).toBe(2);
		expect(result.explanation.join(" ")).toMatch(/Only 2 day\(s\) left/);
	});

	it("calls out the final day explicitly", () => {
		const result = assessApplicability(
			recipe([], { validUntil: "2026-06-15T23:00:00.000Z" }),
			NO_CONTEXT,
			NOW,
		);
		expect(result.expiresInDays).toBe(0);
		expect(result.explanation.join(" ")).toMatch(/last day of the deal/i);
	});

	it("stays quiet about timing when expiry is far off", () => {
		const result = assessApplicability(
			recipe([], { validUntil: "2026-12-31T00:00:00.000Z" }),
			NO_CONTEXT,
			NOW,
		);
		expect(result.explanation.join(" ")).not.toMatch(/day\(s\) left/);
	});

	it("flags a spend floor above the user's stated limit without blocking it", () => {
		const context: UserDealContext = { memberships: [], maxSpendCents: 3000 };
		const result = assessApplicability(recipe([{ kind: "min_spend", cents: 5000 }]), context, NOW);
		expect(result.verdict).toBe("likely_applicable");
		expect(result.requirements[0]?.explanation).toMatch(/above the \$30\.00 limit you set/);
	});

	it("surfaces coupon clipping as something to do, not something impossible", () => {
		const result = assessApplicability(
			recipe([{ kind: "requires_coupon_clip", label: "$5 off cereal" }]),
			NO_CONTEXT,
			NOW,
		);
		expect(result.verdict).toBe("needs_info");
		expect(result.blockers).toHaveLength(0);
	});

	it("reports a clean deal as ready to build", () => {
		const result = assessApplicability(
			recipe([{ kind: "limit_per_customer", n: 4 }]),
			NO_CONTEXT,
			NOW,
		);
		expect(result.verdict).toBe("likely_applicable");
		expect(result.explanation.join(" ")).toMatch(/What remains is building the cart/);
	});

	it("lets one blocker outrank any number of satisfied conditions", () => {
		const context: UserDealContext = { memberships: [], excludedMemberships: ["Store Plus"] };
		const result = assessApplicability(
			recipe([
				{ kind: "min_spend", cents: 1000 },
				{ kind: "limit_per_customer", n: 10 },
				{ kind: "member_only", programName: "Store Plus" },
			]),
			context,
			NOW,
		);
		expect(result.verdict).toBe("not_applicable");
		expect(result.explanation[0]).toMatch(/cannot work for you/i);
	});
});
