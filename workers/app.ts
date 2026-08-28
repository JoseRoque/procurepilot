import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import { piRoutes } from "./lib/pi/routes";
import { procurementRoutes } from "./lib/procurement/routes";

declare module "react-router" {
	interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const app = new Hono<{ Bindings: Env }>();

app.route("/api", procurementRoutes);
app.route("/api", piRoutes);

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
