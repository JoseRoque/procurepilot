import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_STORED_SNAPSHOTS, type CartSnapshot } from "../types";
import { cartSnapshotRepository } from "./db";

function makeSnapshot(id: string, createdAt: string): CartSnapshot {
	return {
		id,
		createdAt,
		platform: "generic",
		platformLabel: "Demo storefront",
		detectionStatus: "supported",
		pageUrlOrigin: "https://example.test",
		items: [],
		visibleOffers: [],
		confidence: "high",
		extractionNotes: [],
		privacy: { localOnly: true, piiRedacted: true, rawHtmlStored: false, cookiesRead: false },
	};
}

describe("cartSnapshotRepository", () => {
	beforeEach(async () => {
		await cartSnapshotRepository.clearSnapshots();
	});

	it("adds and retrieves a snapshot", async () => {
		const snapshot = makeSnapshot("a", "2026-01-01T00:00:00.000Z");
		await cartSnapshotRepository.addSnapshot(snapshot);
		const found = await cartSnapshotRepository.getSnapshot("a");
		expect(found?.id).toBe("a");
	});

	it("lists snapshots newest first", async () => {
		await cartSnapshotRepository.addSnapshot(makeSnapshot("older", "2026-01-01T00:00:00.000Z"));
		await cartSnapshotRepository.addSnapshot(makeSnapshot("newer", "2026-01-02T00:00:00.000Z"));
		const list = await cartSnapshotRepository.listSnapshots();
		expect(list.map((s) => s.id)).toEqual(["newer", "older"]);
	});

	it("deletes a single snapshot", async () => {
		await cartSnapshotRepository.addSnapshot(makeSnapshot("a", "2026-01-01T00:00:00.000Z"));
		await cartSnapshotRepository.deleteSnapshot("a");
		expect(await cartSnapshotRepository.getSnapshot("a")).toBeUndefined();
	});

	it("clears all snapshots", async () => {
		await cartSnapshotRepository.addSnapshot(makeSnapshot("a", "2026-01-01T00:00:00.000Z"));
		await cartSnapshotRepository.addSnapshot(makeSnapshot("b", "2026-01-02T00:00:00.000Z"));
		await cartSnapshotRepository.clearSnapshots();
		expect(await cartSnapshotRepository.listSnapshots()).toEqual([]);
	});

	it("retains at most MAX_STORED_SNAPSHOTS, pruning the oldest first", async () => {
		for (let i = 0; i < MAX_STORED_SNAPSHOTS + 5; i++) {
			const createdAt = new Date(2026, 0, 1 + i).toISOString();
			await cartSnapshotRepository.addSnapshot(makeSnapshot(`snap-${i}`, createdAt));
		}
		const list = await cartSnapshotRepository.listSnapshots();
		expect(list).toHaveLength(MAX_STORED_SNAPSHOTS);
		// The 5 oldest (snap-0..snap-4) should have been pruned.
		const ids = list.map((s) => s.id);
		expect(ids).not.toContain("snap-0");
		expect(ids).not.toContain("snap-4");
		expect(ids).toContain("snap-24"); // the most recently added
	});
});
