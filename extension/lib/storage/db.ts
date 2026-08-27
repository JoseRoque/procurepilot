import { MAX_STORED_SNAPSHOTS, type CartSnapshot } from "../types";

const DB_NAME = "purchasing-intelligence";
const DB_VERSION = 1;
const STORE_NAME = "cartSnapshots";
const CREATED_AT_INDEX = "createdAt";

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = request.result;
			// Schema versioning: add new `if (event.oldVersion < N)` migration
			// blocks here as the schema evolves, rather than recreating stores.
			if (event.oldVersion < 1) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
				store.createIndex(CREATED_AT_INDEX, "createdAt", { unique: false });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
		request.onblocked = () => reject(new Error("IndexedDB open request was blocked."));
	});
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
	});
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
	});
}

async function pruneOldestBeyondLimit(db: IDBDatabase, limit: number): Promise<void> {
	const transaction = db.transaction(STORE_NAME, "readwrite");
	const store = transaction.objectStore(STORE_NAME);
	const index = store.index(CREATED_AT_INDEX);

	const allKeys = await promisifyRequest(index.getAllKeys());
	if (allKeys.length <= limit) {
		return;
	}

	// getAllKeys() via the createdAt index returns keys sorted oldest-first.
	const excess = allKeys.length - limit;
	for (let i = 0; i < excess; i++) {
		store.delete(allKeys[i] as IDBValidKey);
	}
	await promisifyTransaction(transaction);
}

export interface CartSnapshotRepository {
	addSnapshot(snapshot: CartSnapshot): Promise<void>;
	getSnapshot(id: string): Promise<CartSnapshot | undefined>;
	listSnapshots(): Promise<CartSnapshot[]>;
	deleteSnapshot(id: string): Promise<void>;
	clearSnapshots(): Promise<void>;
}

class IndexedDbCartSnapshotRepository implements CartSnapshotRepository {
	async addSnapshot(snapshot: CartSnapshot): Promise<void> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put(snapshot);
			await promisifyTransaction(transaction);
			await pruneOldestBeyondLimit(db, MAX_STORED_SNAPSHOTS);
		} finally {
			db.close();
		}
	}

	async getSnapshot(id: string): Promise<CartSnapshot | undefined> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const result = await promisifyRequest(transaction.objectStore(STORE_NAME).get(id));
			return result as CartSnapshot | undefined;
		} finally {
			db.close();
		}
	}

	async listSnapshots(): Promise<CartSnapshot[]> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE_NAME, "readonly");
			const index = transaction.objectStore(STORE_NAME).index(CREATED_AT_INDEX);
			const results = await promisifyRequest(index.getAll());
			// Newest first.
			return (results as CartSnapshot[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		} finally {
			db.close();
		}
	}

	async deleteSnapshot(id: string): Promise<void> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).delete(id);
			await promisifyTransaction(transaction);
		} finally {
			db.close();
		}
	}

	async clearSnapshots(): Promise<void> {
		const db = await openDatabase();
		try {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).clear();
			await promisifyTransaction(transaction);
		} finally {
			db.close();
		}
	}
}

export const cartSnapshotRepository: CartSnapshotRepository = new IndexedDbCartSnapshotRepository();
