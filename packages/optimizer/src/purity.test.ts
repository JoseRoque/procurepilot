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
	{ pattern: /from\s+["'](?!\.|\.\.)/, label: "external module import (must stay dependency-free)" },
];

describe("optimizer purity", () => {
	const files = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));

	it("has source files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const [file, content] of files) {
		it(`${file} imports no Chrome/DOM/Tauri/Cloudflare/network APIs`, () => {
			for (const { pattern, label } of FORBIDDEN_PATTERNS) {
				expect(pattern.test(content), `${file} must not use ${label} (${pattern})`).toBe(false);
			}
		});
	}
});
