import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { validateProcurementEarlyAccessInput } from "~/lib/validation/procurementEarlyAccess";
import type { ProcurementEarlyAccessResponse } from "~/types/procurement";
import { getProcurementEarlyAccessStore } from "./lib/procurementEarlyAccessStore";

declare module "react-router" {
	interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const app = new Hono<{ Bindings: Env }>();

app.post("/api/procurement-early-access", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		const response: ProcurementEarlyAccessResponse = {
			success: false,
			error: { message: "Request body must be valid JSON." },
		};
		return c.json(response, 400);
	}

	const result = validateProcurementEarlyAccessInput(body);
	if (!result.success) {
		const response: ProcurementEarlyAccessResponse = {
			success: false,
			error: {
				message: "Please correct the highlighted fields.",
				fieldErrors: result.fieldErrors,
			},
		};
		return c.json(response, 400);
	}

	const store = getProcurementEarlyAccessStore(c.env);
	const stored = await store.save(result.data);

	const response: ProcurementEarlyAccessResponse = {
		success: true,
		data: { id: stored.id, createdAt: stored.createdAt },
	};
	return c.json(response, 201);
});

app.get("*", (c) => {
	const requestHandler = createRequestHandler(
		() => import("virtual:react-router/server-build"),
		import.meta.env.MODE,
	);

	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

export default app;
