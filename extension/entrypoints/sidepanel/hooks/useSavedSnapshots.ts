import { useCallback, useEffect, useState } from "react";
import { cartSnapshotRepository } from "@/lib/storage/db";
import type { CartSnapshot } from "@/lib/types";

export function useSavedSnapshots() {
	const [snapshots, setSnapshots] = useState<CartSnapshot[]>([]);
	const [error, setError] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const list = await cartSnapshotRepository.listSnapshots();
			setSnapshots(list);
			setError(undefined);
		} catch {
			setError("Could not load saved scans from local storage.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const save = useCallback(
		async (snapshot: CartSnapshot) => {
			try {
				await cartSnapshotRepository.addSnapshot(snapshot);
				await refresh();
				return true;
			} catch {
				setError("Could not save this scan to local storage.");
				return false;
			}
		},
		[refresh],
	);

	const remove = useCallback(
		async (id: string) => {
			try {
				await cartSnapshotRepository.deleteSnapshot(id);
				await refresh();
			} catch {
				setError("Could not delete this scan.");
			}
		},
		[refresh],
	);

	const clearAll = useCallback(async () => {
		try {
			await cartSnapshotRepository.clearSnapshots();
			await refresh();
		} catch {
			setError("Could not clear saved scans.");
		}
	}, [refresh]);

	return { snapshots, loading, error, save, remove, clearAll, refresh };
}
