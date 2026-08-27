import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		name: "Purchasing Intelligence (Bronze)",
		description:
			"User-initiated cart scanning and local purchasing recommendations. No payment, login, or checkout automation.",
		// Deliberately minimal. See README "Permissions" for why each is needed.
		// No host_permissions and no static content_scripts: the content script
		// is only ever injected into the current tab in direct response to a
		// user click, via activeTab + scripting.
		permissions: ["storage", "activeTab", "scripting", "sidePanel"],
		action: {},
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
});
