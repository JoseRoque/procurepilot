/**
 * Text normalization shared by client and server validation. This does NOT
 * attempt HTML sanitization — React already escapes output on render, and
 * the server never renders stored fields as HTML. This only strips control
 * characters and normalizes whitespace so stored/exported text stays clean
 * plain text.
 */

// C0 controls (including null bytes), DEL, and C1 controls. Tab/newline/CR
// are intentionally excluded here since collapseWhitespace normalizes those
// separately below. Built from an escaped string (rather than a literal
// regex) so no raw control bytes ever live in this source file.
const CONTROL_CHARS_PATTERN = new RegExp(
	"[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F]",
	"g",
);

function stripControlChars(value: string): string {
	return value.replace(CONTROL_CHARS_PATTERN, "");
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/** Trim, collapse internal whitespace, and strip control/null characters. */
export function sanitizeText(value: string): string {
	return collapseWhitespace(stripControlChars(value));
}
