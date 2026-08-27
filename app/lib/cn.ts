type ClassValue = string | number | null | undefined | false;

/** Minimal classnames joiner so components don't need a dependency for this. */
export function cn(...values: ClassValue[]): string {
	return values.filter(Boolean).join(" ");
}
