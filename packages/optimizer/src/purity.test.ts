import { describe, expect, it } from "vitest";

/**
 * Enforces the optimizer purity contract: no Chrome, DOM, Tauri, or
 * Cloudflare APIs, no network primitives, and no imports outside the pure
 * packages. Sources are read via Vite raw imports so this test itself stays
 * runtime-agnostic.
 */

const sources = import.meta.glob("./*.ts", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

/**
 * Blanks out comment bodies and string contents, keeping delimiters and
 * offsets stable.
 *
 * The API patterns below must match real code, not English. Prose like "the
 * deal's validity window." tripped `/\bwindow\./` twice, which is a false
 * failure that pressures the author to reword documentation to satisfy a
 * scanner — exactly backwards. Import checks still run against the original
 * source, since those need the literal module specifier.
 */
function stripCommentsAndStrings(source: string): string {
	let out = "";
	let index = 0;
	while (index < source.length) {
		const two = source.slice(index, index + 2);
		if (two === "//") {
			const end = source.indexOf("\n", index);
			const stop = end === -1 ? source.length : end;
			out += " ".repeat(stop - index);
			index = stop;
			continue;
		}
		if (two === "/*") {
			const end = source.indexOf("*/", index + 2);
			const stop = end === -1 ? source.length : end + 2;
			out += " ".repeat(stop - index);
			index = stop;
			continue;
		}
		const char = source[index];
		if (char === '"' || char === "'" || char === "`") {
			out += char;
			index += 1;
			while (index < source.length && source[index] !== char) {
				if (source[index] === "\\") {
					out += "  ";
					index += 2;
					continue;
				}
				out += source[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			if (index < source.length) {
				out += char;
				index += 1;
			}
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bchrome\./, label: "Chrome extension API" },
	{ pattern: /\bbrowser\./, label: "WebExtension API" },
	{ pattern: /\bdocument\./, label: "DOM document" },
	{ pattern: /\bwindow\./, label: "DOM window" },
	{ pattern: /@tauri-apps/, label: "Tauri API" },
	{ pattern: /from\s+["']hono["']/, label: "Cloudflare/Hono" },
	{ pattern: /D1Database|R2Bucket|KVNamespace|DurableObject/, label: "Cloudflare bindings" },
	{ pattern: /\bfetch\s*\(/, label: "network fetch" },
	{ pattern: /XMLHttpRequest|WebSocket/, label: "network primitives" },
];

/** Checked against the original source, since it needs the module specifier. */
const IMPORT_PATTERN = {
	pattern: /from\s+["'](?!\.|\.\.)/,
	label: "external module import (must stay dependency-free)",
};

describe("optimizer purity", () => {
	const files = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));

	it("has source files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	// The stripper exists to remove false positives from prose. If it also
	// removed real violations it would silently disarm every check below, so
	// its behaviour is pinned in both directions.
	it("still detects real API use after stripping", () => {
		const code = stripCommentsAndStrings(
			["const a = window.location.href;", "chrome.storage.local.get();", "await fetch(url);"].join("\n"),
		);
		expect(/\bwindow\./.test(code)).toBe(true);
		expect(/\bchrome\./.test(code)).toBe(true);
		expect(/\bfetch\s*\(/.test(code)).toBe(true);
	});

	it("ignores the same words in comments and string literals", () => {
		const code = stripCommentsAndStrings(
			[
				"// within the validity window. document. chrome.",
				"/* window. document. */",
				'const message = "the deal window. and chrome. and fetch(";',
				"const template = `window. document.`;",
			].join("\n"),
		);
		expect(/\bwindow\./.test(code)).toBe(false);
		expect(/\bdocument\./.test(code)).toBe(false);
		expect(/\bchrome\./.test(code)).toBe(false);
		expect(/\bfetch\s*\(/.test(code)).toBe(false);
	});

	it("does not let an escaped quote hide code after a string", () => {
		const code = stripCommentsAndStrings('const a = "he said \\"hi\\""; window.x = 1;');
		expect(/\bwindow\./.test(code)).toBe(true);
	});

	for (const [file, content] of files) {
		it(`${file} imports no Chrome/DOM/Tauri/Cloudflare/network APIs`, () => {
			const code = stripCommentsAndStrings(content);
			for (const { pattern, label } of FORBIDDEN_PATTERNS) {
				expect(pattern.test(code), `${file} must not use ${label} (${pattern})`).toBe(false);
			}
			expect(
				IMPORT_PATTERN.pattern.test(content),
				`${file} must not use ${IMPORT_PATTERN.label}`,
			).toBe(false);
		});
	}
});
