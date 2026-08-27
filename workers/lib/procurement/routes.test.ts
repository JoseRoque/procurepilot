import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { procurementRoutes } from "./routes";
import { __resetProcurementServiceStateForTests } from "./service";

const TEST_ENV = {
	ADMIN_API_TOKEN: "test-admin-token",
	LEAD_HASH_SALT: "test-salt",
};

function buildTestApp() {
	const app = new Hono();
	app.route("/api", procurementRoutes);
	return app;
}

function validPayload(overrides: Record<string, unknown> = {}) {
	return {
		workEmail: "jane.doe@acmecorp.com",
		fullName: "Jane Doe",
		companyName: "Acme Corp",
		jobTitle: "Director of Procurement",
		companySize: "201-1000",
		biggestChallenge: "Off-contract or maverick spend",
		...overrides,
	};
}

async function postSubmission(
	app: Hono,
	body: unknown,
	extraHeaders: Record<string, string> = {},
) {
	return app.request(
		"/api/procurement-early-access",
		{
			method: "POST",
			headers: { "Content-Type": "application/json", ...extraHeaders },
			body: JSON.stringify(body),
		},
		TEST_ENV,
	);
}

async function getAdminList(
	app: Hono,
	token: string | undefined,
	query = "",
) {
	return app.request(
		`/api/admin/procurement-early-access${query}`,
		{
			headers: token ? { Authorization: `Bearer ${token}` } : {},
		},
		TEST_ENV,
	);
}

describe("procurement API routes", () => {
	beforeEach(() => {
		__resetProcurementServiceStateForTests();
	});

	it("accepts a valid public submission and persists it exactly once", async () => {
		const app = buildTestApp();
		const response = await postSubmission(app, validPayload(), {
			"cf-connecting-ip": "203.0.113.1",
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as { ok: true; data: { id: string; message: string } };
		expect(body.ok).toBe(true);
		expect(body.data.id).toBeTruthy();

		const listResponse = await getAdminList(app, TEST_ENV.ADMIN_API_TOKEN);
		const listBody = (await listResponse.json()) as {
			ok: true;
			data: { items: { workEmail: string }[] };
		};
		expect(listBody.data.items).toHaveLength(1);
		expect(listBody.data.items[0].workEmail).toBe("jane.doe@acmecorp.com");
	});

	it("returns field-level validation errors when required fields are missing", async () => {
		const app = buildTestApp();
		const response = await postSubmission(
			app,
			{},
			{ "cf-connecting-ip": "203.0.113.2" },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			ok: false;
			error: { code: string; fields?: Record<string, string[]> };
		};
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe("VALIDATION_ERROR");
		expect(body.error.fields?.workEmail).toBeTruthy();
		expect(body.error.fields?.fullName).toBeTruthy();
	});

	it("rejects an invalid email", async () => {
		const app = buildTestApp();
		const response = await postSubmission(
			app,
			validPayload({ workEmail: "not-an-email" }),
			{ "cf-connecting-ip": "203.0.113.3" },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { fields?: Record<string, string[]> } };
		expect(body.error.fields?.workEmail).toBeTruthy();
	});

	it("rejects array values outside the allowlist", async () => {
		const app = buildTestApp();
		const response = await postSubmission(
			app,
			validPayload({ primaryCategories: ["Definitely not a real category"] }),
			{ "cf-connecting-ip": "203.0.113.4" },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { fields?: Record<string, string[]> } };
		expect(body.error.fields?.primaryCategories).toBeTruthy();
	});

	it("treats a duplicate normalized email as an idempotent success without a second record", async () => {
		const app = buildTestApp();
		const first = await postSubmission(app, validPayload(), {
			"cf-connecting-ip": "203.0.113.5",
		});
		expect(first.status).toBe(201);

		const second = await postSubmission(
			app,
			validPayload({ workEmail: "Jane.Doe@AcmeCorp.com" }),
			{ "cf-connecting-ip": "203.0.113.5" },
		);
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as { ok: true; data: { id?: string } };
		expect(secondBody.ok).toBe(true);
		expect(secondBody.data.id).toBeUndefined();

		const listResponse = await getAdminList(app, TEST_ENV.ADMIN_API_TOKEN);
		const listBody = (await listResponse.json()) as { data: { items: unknown[] } };
		expect(listBody.data.items).toHaveLength(1);
	});

	it("rejects invalid JSON with a structured error", async () => {
		const app = buildTestApp();
		const response = await app.request(
			"/api/procurement-early-access",
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
			TEST_ENV,
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_JSON");
	});

	it("blocks a caller after the rate limit is exceeded", async () => {
		const app = buildTestApp();
		const ip = "203.0.113.99";
		for (let i = 0; i < 5; i++) {
			const response = await postSubmission(
				app,
				validPayload({ workEmail: `user${i}@acmecorp.com` }),
				{ "cf-connecting-ip": ip },
			);
			expect(response.status).toBe(201);
		}
		const sixth = await postSubmission(
			app,
			validPayload({ workEmail: "user6@acmecorp.com" }),
			{ "cf-connecting-ip": ip },
		);
		expect(sixth.status).toBe(429);
		const body = (await sixth.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATE_LIMITED");
	});

	it("denies a public caller access to the admin list", async () => {
		const app = buildTestApp();
		const response = await getAdminList(app, undefined);
		expect(response.status).toBe(401);
	});

	it("rejects an invalid admin bearer token", async () => {
		const app = buildTestApp();
		const response = await getAdminList(app, "wrong-token");
		expect(response.status).toBe(401);
	});

	it("allows a valid admin token to list submissions", async () => {
		const app = buildTestApp();
		await postSubmission(app, validPayload(), { "cf-connecting-ip": "203.0.113.6" });
		const response = await getAdminList(app, TEST_ENV.ADMIN_API_TOKEN);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: { items: unknown[] } };
		expect(body.data.items.length).toBeGreaterThan(0);
	});

	it("returns 503 for admin routes when ADMIN_API_TOKEN is unset", async () => {
		const app = buildTestApp();
		const response = await app.request(
			"/api/admin/procurement-early-access",
			{ headers: { Authorization: "Bearer anything" } },
			{ LEAD_HASH_SALT: "test-salt" },
		);
		expect(response.status).toBe(503);
	});

	it("only accepts allowlisted status values on update", async () => {
		const app = buildTestApp();
		const submitResponse = await postSubmission(app, validPayload(), {
			"cf-connecting-ip": "203.0.113.7",
		});
		const { data } = (await submitResponse.json()) as { data: { id: string } };

		const badUpdate = await app.request(
			`/api/admin/procurement-early-access/${data.id}`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_ENV.ADMIN_API_TOKEN}`,
				},
				body: JSON.stringify({ status: "not-a-real-status" }),
			},
			TEST_ENV,
		);
		expect(badUpdate.status).toBe(400);

		const goodUpdate = await app.request(
			`/api/admin/procurement-early-access/${data.id}`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_ENV.ADMIN_API_TOKEN}`,
				},
				body: JSON.stringify({ status: "qualified" }),
			},
			TEST_ENV,
		);
		expect(goodUpdate.status).toBe(200);
		const updatedBody = (await goodUpdate.json()) as { data: { status: string } };
		expect(updatedBody.data.status).toBe("qualified");
	});

	it("returns 404 when updating a lead that does not exist", async () => {
		const app = buildTestApp();
		const response = await app.request(
			"/api/admin/procurement-early-access/does-not-exist",
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${TEST_ENV.ADMIN_API_TOKEN}`,
				},
				body: JSON.stringify({ status: "qualified" }),
			},
			TEST_ENV,
		);
		expect(response.status).toBe(404);
	});

	it("exports CSV with the expected headers and content type", async () => {
		const app = buildTestApp();
		await postSubmission(app, validPayload(), { "cf-connecting-ip": "203.0.113.8" });
		const response = await app.request(
			"/api/admin/procurement-early-access/export.csv",
			{ headers: { Authorization: `Bearer ${TEST_ENV.ADMIN_API_TOKEN}` } },
			TEST_ENV,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/csv");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		const text = await response.text();
		expect(text).toContain("jane.doe@acmecorp.com");
		expect(text).not.toContain("ipHash");
	});

	describe("logging safety", () => {
		let logSpy: ReturnType<typeof vi.spyOn>;
		let warnSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		});

		afterEach(() => {
			logSpy.mockRestore();
			warnSpy.mockRestore();
		});

		it("never logs the raw email or notes from a submission", async () => {
			const app = buildTestApp();
			const secretNotes = "our contract with SupplierX expires in March, do not repeat";
			await postSubmission(
				app,
				validPayload({
					workEmail: "sensitive.person@acmecorp.com",
					notes: secretNotes,
				}),
				{ "cf-connecting-ip": "203.0.113.9" },
			);

			const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls]
				.flat()
				.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
				.join("\n");

			expect(allLoggedText).not.toContain("sensitive.person@acmecorp.com");
			expect(allLoggedText).not.toContain(secretNotes);
			expect(allLoggedText).not.toContain(TEST_ENV.ADMIN_API_TOKEN);
			expect(allLoggedText).not.toContain(TEST_ENV.LEAD_HASH_SALT);
		});
	});
});
