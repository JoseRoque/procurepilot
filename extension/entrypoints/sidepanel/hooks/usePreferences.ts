import { useCallback, useEffect, useState } from "react";
import { getPreferences, setPreferences as persistPreferences } from "@/lib/storage/settings";
import { DEFAULT_PREFERENCES, type ShoppingPreferences } from "@/lib/types";

export function usePreferences() {
	const [preferences, setPreferencesState] = useState<ShoppingPreferences>(DEFAULT_PREFERENCES);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let cancelled = false;
		getPreferences().then((loadedPreferences) => {
			if (!cancelled) {
				setPreferencesState(loadedPreferences);
				setLoaded(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const updatePreferences = useCallback((patch: Partial<ShoppingPreferences>) => {
		setPreferencesState((prev) => {
			const next = { ...prev, ...patch, localOnly: true };
			persistPreferences(next).catch(() => {});
			return next;
		});
	}, []);

	return { preferences, updatePreferences, loaded };
}
