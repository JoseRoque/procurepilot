/**
 * Decides whether the current tab can be scanned, and — when it cannot —
 * says why in terms the user can act on.
 *
 * This exists because the previous failure path collapsed every
 * `chrome.scripting.executeScript` rejection into one guess ("the Chrome Web
 * Store or an internal browser page"). The far more common cause is that the
 * extension simply has no host access to the page:
 *
 *   activeTab is granted only by a toolbar click, keyboard command, or context
 *   menu item, and it is revoked on navigation, reload, and tab switch. A
 *   "Scan this page" button lives in the side panel, which is an extension
 *   page, so pressing it grants nothing. Injection then fails for a reason the
 *   user could fix — by granting this one site — while being told something
 *   untrue and unfixable.
 *
 * A permission the user can grant is a different situation from a page Chrome
 * will never allow, and the two must not share a message.
 */

/** Schemes no extension may script, regardless of granted permissions. */
const RESTRICTED_SCHEMES = new Set([
	"chrome:",
	"chrome-untrusted:",
	"chrome-extension:",
	"moz-extension:",
	"edge:",
	"about:",
	"data:",
	"blob:",
	"javascript:",
	"view-source:",
	"devtools:",
	"filesystem:",
]);

/**
 * Hosts Chrome blocks by policy even with host permissions granted. The
 * extension gallery is protected so an extension cannot script the page a
 * user would install or remove extensions from.
 */
const RESTRICTED_HOSTS = [
	"chromewebstore.google.com",
	"chrome.google.com/webstore",
	"addons.mozilla.org",
	"microsoftedge.microsoft.com",
];

export type ScanEligibility =
	| {
			kind: "restricted";
			/** Shown to the user. States the real limitation, offers no false hope. */
			reason: string;
	  }
	| {
			kind: "eligible";
			origin: string;
			/** Match pattern to pass to chrome.permissions.request(). */
			originPattern: string;
	  };

/**
 * Classifies a tab URL. Returns the origin match pattern when the page is
 * scannable, so the caller can check or request permission for exactly that
 * one origin rather than a broad wildcard.
 */
export function evaluateScanEligibility(rawUrl: string | undefined): ScanEligibility {
	if (!rawUrl) {
		return {
			kind: "restricted",
			reason: "No page is open in this tab yet.",
		};
	}

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { kind: "restricted", reason: "This tab's address could not be read." };
	}

	if (RESTRICTED_SCHEMES.has(url.protocol)) {
		return {
			kind: "restricted",
			reason: `Chrome does not let any extension read ${url.protocol}// pages. Open the shopping page in a normal tab and try again.`,
		};
	}

	if (url.protocol === "file:") {
		return {
			kind: "restricted",
			reason:
				"Local files can only be read if you enable “Allow access to file URLs” for this extension on chrome://extensions.",
		};
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			kind: "restricted",
			reason: `Pages served over ${url.protocol}// cannot be scanned.`,
		};
	}

	const haystack = `${url.host}${url.pathname}`.toLowerCase();
	if (RESTRICTED_HOSTS.some((host) => haystack.startsWith(host))) {
		return {
			kind: "restricted",
			reason:
				"Chrome blocks extensions from reading the extension gallery. This is a browser restriction and cannot be granted.",
		};
	}

	return {
		kind: "eligible",
		origin: url.origin,
		originPattern: `${url.origin}/*`,
	};
}

/**
 * Turns a raw injection failure into something actionable.
 *
 * Chrome's own wording for a missing host permission mentions the manifest,
 * which is meaningless to a user and, worse, implies the extension is broken
 * rather than simply not yet allowed on this site.
 */
export function describeInjectionFailure(error: unknown, origin?: string): string {
	const raw = error instanceof Error ? error.message : String(error ?? "");
	const site = origin ? `on ${origin}` : "on this site";

	if (/cannot access contents of|extension manifest must request permission|host permission/i.test(raw)) {
		return `Scanning isn't allowed ${site} yet. Grant access to this site, then scan again.`;
	}
	if (/cannot access a chrome:\/\/|chrome:\/\/ url|extension gallery|chrome web store/i.test(raw)) {
		return "Chrome does not let extensions read this page. Open the shopping page in a normal tab and try again.";
	}
	if (/no tab with id|frame with id|tab was closed/i.test(raw)) {
		return "That tab closed or navigated before the scan could run. Try again.";
	}
	if (/frame.*removed|target frame/i.test(raw)) {
		return "The page changed while scanning. Reload it and try again.";
	}
	// Never invent a cause. Surface Chrome's own text so it can be reported.
	return raw
		? `The scan could not run on this page. Chrome reported: ${raw}`
		: "The scan could not run on this page, and Chrome gave no reason.";
}
