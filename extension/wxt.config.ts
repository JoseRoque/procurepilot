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
		// All OPTIONAL — nothing here is granted at install time.
		//
		// http/https are listed so the user can grant ONE origin at a time from
		// the side panel when they ask to scan that site. activeTab alone is not
		// enough for this product: it is granted only by a toolbar/menu/shortcut
		// invocation and is revoked on navigation, reload, and tab switch, so a
		// "Scan this page" button inside the side panel — an extension page —
		// receives no grant at all and injection fails.
		//
		// Declaring the patterns here does NOT grant them. Chrome only permits
		// permissions.request() for patterns declared optional, so without this
		// the per-site prompt cannot be shown. The user grants each origin
		// explicitly and can revoke it at any time.
		//
		// 127.0.0.1 is the loopback bridge to the local sidecar, granted only
		// when the user pairs, from the pairing UI itself. Never a remote host.
		optional_host_permissions: ["http://127.0.0.1/*", "https://*/*", "http://*/*"],
		action: {},
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
});
