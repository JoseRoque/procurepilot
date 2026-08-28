import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		environment: "node",
		include: [
			"workers/**/*.test.ts",
			"app/**/*.test.ts",
			"packages/**/*.test.ts",
			"scripts/**/*.test.ts",
			"sidecar/src/**/*.test.ts",
		],
	},
});
