/**
 * Opaque pagination cursor encoding a (createdAt, id) tie-break position.
 * Not a security boundary — just avoids exposing raw sort keys as a public
 * query-string contract.
 */

export function encodeCursor(createdAt: string, id: string): string {
	return btoa(`${createdAt}|${id}`);
}

export function decodeCursor(
	cursor: string,
): { createdAt: string; id: string } | null {
	try {
		const decoded = atob(cursor);
		const separatorIndex = decoded.lastIndexOf("|");
		if (separatorIndex === -1) return null;
		const createdAt = decoded.slice(0, separatorIndex);
		const id = decoded.slice(separatorIndex + 1);
		if (!createdAt || !id) return null;
		return { createdAt, id };
	} catch {
		return null;
	}
}
