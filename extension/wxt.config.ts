import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		name: "Purchasing Intelligence",
		description:
			"User-initiated cart scanning and local purchase planning. No payment, login, or checkout automation.",
		// Deliberately minimal. See README "Permissions" for why each is needed.
		// No host_permissions and no static content_scripts: the content script
		// is only ever injected into the current tab in direct response to a
		// user click, via activeTab + scripting.
		permissions: ["storage", "activeTab", "scripting", "sidePanel"],
		// The loopback bridge to the local sidecar is OPTIONAL and granted only
		// when the user pairs, from the pairing UI itself. 127.0.0.1 only —
		// never a remote host.
		optional_host_permissions: ["http://127.0.0.1/*"],
		action: {},
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
});
