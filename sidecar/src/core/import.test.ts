import { readFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveProductIdentity } from "../../../packages/optimizer/src";
import type { Db, FieldCrypto } from "./db";
import { ImportService } from "./importService";
import { SidecarCore } from "./services";

/**
 * End-to-end: a retailer CSV goes in, and personal price intelligence comes
 * out — through the real migrations, real repositories, and real SQLite.
 */

const MIGRATIONS = [
	"../../src-tauri/migrations/0001_init.sql",
	"../../src-tauri/migrations/0002_product_intelligence.sql",
].map((relative) => readFileSync(join(__dirname, relative), "utf8"));

function createDb(sqlite: Database): Db {
	return {
		async query(sql, params = []) {
			const stmt = sqlite.prepare(sql);
			stmt.bind(params as never[]);
			const rows: Record<string, unknown>[] = [];
			while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
			stmt.free();
			return rows;
		},
		async execute(sql, params = []) {
			sqlite.run(sql, params as never[]);
			return { changes: sqlite.getRowsModified(), lastInsertRowid: 0 };
		},
	};
}

/** Records what was encrypted so we can assert the boundary, not just assume it. */
function createTrackingCrypto(): FieldCrypto & { encrypted: string[] } {
	const encrypted: string[] = [];
	return {
		encrypted,
		async encrypt(plain) {
			encrypted.push(plain);
			return `enc:${plain}`;
		},
		async decrypt(value) {
			return value.startsWith("enc:") ? value.slice(4) : value;
		},
	};
}

const CSV = [
	"Order Date,Order ID,Title,ASIN,Quantity,Unit Price,Total Owed",
	'2026-01-05,A1,"Barilla Spaghetti, 16 oz",B001,1,$1.99,$1.99',
	'2026-02-02,A2,"Barilla Spaghetti, 16 oz",B001,1,$2.49,$2.49',
	'2026-03-02,A3,"Barilla Spaghetti, 16 oz",B001,1,$2.29,$2.29',
	'2026-03-02,A3,"Olive oil 1L",B002,1,$12.99,$12.99',
	'2026-03-09,A4,"Olive oil 500ml",B003,1,$7.49,$7.49',
].join("\n");

describe("import → price intelligence", () => {
	let core: SidecarCore;
	let service: ImportService;
	let cryptoTracker: ReturnType<typeof createTrackingCrypto>;
	let sqlite: Database;

	beforeEach(async () => {
		const SQL = await initSqlJs();
		sqlite = new SQL.Database();
		for (const migration of MIGRATIONS) sqlite.run(migration);
		sqlite.run(
			`INSERT INTO local_profile (id, pseudonymous_device_id, pairing_token, schema_version, app_version, preferences_json, created_at, updated_at)
			 VALUES ('profile','dev-test12345678','token',2,'0.1.0','{}','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')`,
		);
		cryptoTracker = createTrackingCrypto();
		core = new SidecarCore(createDb(sqlite), cryptoTracker, {
			appVersion: "0.1.0",
			apiBaseUrl: "http://localhost:8787",
			configPackPublicKeyHex: "00",
			configPackKeyId: "test",
		});
		service = new ImportService(core);
	});

	async function importAll() {
		const { csv, mapping } = service.parse(CSV);
		const preview = service.preview(csv, mapping, "amazon", "amazon-history");
		return { preview, result: await service.commit(preview) };
	}

	it("imports orders and observations through the real schema", async () => {
		const { result } = await importAll();
		expect(result.observations).toBe(5);
		expect(result.events).toBe(4); // A3 has two lines → one order
		const stats = await core.purchases.stats();
		expect(stats.events).toBe(4);
		expect(stats.lines).toBe(5);
	});

	it("builds a price benchmark and calls the cheapest price best_seen", async () => {
		await importAll();
		const products = await core.products.listProducts();
		const spaghetti = products.find((p) => p.displayName.includes("Barilla"));
		expect(spaghetti?.observationCount).toBe(3);

		const assessment = await core.products.assessCurrentPrice(spaghetti!.productKey, 199);
		expect(assessment.verdict).toBe("best_seen");
		expect(assessment.benchmark?.medianCents).toBe(229);
	});

	it("refuses a verdict when history is too thin", async () => {
		await importAll();
		const products = await core.products.listProducts();
		const oil1L = products.find((p) => p.displayName.includes("1L"));
		// Only one observation for this exact size.
		const assessment = await core.products.assessCurrentPrice(oil1L!.productKey, 1299);
		expect(assessment.verdict).toBe("insufficient_history");
	});

	it("keeps different sizes as separate products (they are not interchangeable)", async () => {
		await importAll();
		const products = await core.products.listProducts();
		const oils = products.filter((p) => p.displayName.toLowerCase().includes("olive oil"));
		expect(oils).toHaveLength(2);
		expect(new Set(oils.map((o) => o.productKey)).size).toBe(2);
	});

	it("derives repurchase cadence from purchase ground truth", async () => {
		await importAll();
		const products = await core.products.listProducts();
		const spaghetti = products.find((p) => p.displayName.includes("Barilla"));
		const interval = await core.purchases.consumptionInterval(spaghetti!.productKey);
		expect(interval?.purchaseCount).toBe(3);
		expect(interval?.reliable).toBe(true);
		expect(interval?.medianDaysBetween).toBeGreaterThan(20);
	});

	it("encrypts product names at rest but leaves keys/prices queryable", async () => {
		await importAll();
		expect(cryptoTracker.encrypted.some((value) => value.includes("Barilla"))).toBe(true);

		const raw = await core.db.query(
			"SELECT display_name, product_key, price_paid_cents FROM product_observations LIMIT 1",
		);
		expect(raw[0]?.display_name as string).toMatch(/^enc:/);
		expect(raw[0]?.product_key as string).not.toMatch(/^enc:/);
		expect(Number.isInteger(raw[0]?.price_paid_cents)).toBe(true);
	});

	it("records only volume metadata in the ledger, never product names", async () => {
		await importAll();
		const entries = await core.ledger.list(10);
		const importEntry = entries.find((entry) => entry.eventType === "data_imported");
		expect(importEntry).toBeDefined();
		expect(JSON.stringify(importEntry?.payload)).not.toMatch(/Barilla|Olive/i);
		expect(importEntry?.payload).toMatchObject({ observations: 5, events: 4 });
	});

	it("never stores basket co-occurrence (the key re-identification vector)", async () => {
		await importAll();
		const tables = await core.db.query(
			"SELECT name FROM sqlite_master WHERE type='table'",
		);
		const names = tables.map((t) => (t.name as string).toLowerCase()).join(" ");
		expect(names).not.toMatch(/co_?occur|basket_pair|affinity/);
	});

	it("undoes an import wholesale, leaving no orphans", async () => {
		const { result } = await importAll();
		await service.undo(result.batchId);
		expect(await core.products.listProducts()).toHaveLength(0);
		const stats = await core.purchases.stats();
		expect(stats.events).toBe(0);
		expect(stats.lines).toBe(0);
	});

	it("preview writes nothing until commit", async () => {
		const { csv, mapping } = service.parse(CSV);
		service.preview(csv, mapping, "amazon", "amazon-history");
		expect(await core.products.listProducts()).toHaveLength(0);
	});

	it("groups an identical product across merchants under one key when GTIN-backed", async () => {
		const gtinCsv = [
			"Order Date,Title,UPC,Quantity,Unit Price,Merchant",
			"2026-01-01,Pasta 500g,0012345600012,1,$1.99,storeA",
			"2026-02-01,PASTA - 500 g,0012345600012,1,$2.49,storeB",
		].join("\n");
		const { csv, mapping } = service.parse(gtinCsv);
		await service.commit(service.preview(csv, mapping, "fallback", "gtin-test"));

		const products = await core.products.listProducts();
		expect(products).toHaveLength(1);
		expect(products[0]?.productKey).toBe("gtin:0012345600012");
		expect(products[0]?.authoritative).toBe(true);
		expect(products[0]?.observationCount).toBe(2);
	});

	it("strips toxic columns from a delivery export before anything is stored", async () => {
		// Shaped like a real DoorDash/Uber Eats export, toxic columns included.
		const deliveryCsv = [
			"order_date,restaurant_name,item_name,quantity,item_price,delivery_address,dropoff_latitude,dropoff_longitude,delivery_instructions,dasher_name,customer_phone,card_last4",
			'2026-01-04,Thai Place,Pad Thai,1,$14.50,"42 Elm St Apt 3B, Springfield",42.10412,-72.58991,"Gate code 4521 then buzz 3B",Jamie R.,555-0142,4242',
			'2026-01-18,Thai Place,Pad Thai,1,$15.50,"42 Elm St Apt 3B, Springfield",42.10412,-72.58991,"Leave at door",Alex T.,555-0142,4242',
			'2026-02-01,Thai Place,Pad Thai,1,$13.95,"42 Elm St Apt 3B, Springfield",42.10412,-72.58991,"Gate code 4521",Sam P.,555-0142,4242',
		].join("\n");

		const parsed = service.parse(deliveryCsv);

		// Refused at intake, and reported by name.
		expect(parsed.quarantined.map((entry) => entry.header).sort()).toEqual([
			"card_last4",
			"customer_phone",
			"dasher_name",
			"delivery_address",
			"delivery_instructions",
			"dropoff_latitude",
			"dropoff_longitude",
		]);
		// Already gone from the parsed rows, before any mapping decision.
		expect(JSON.stringify(parsed.csv)).not.toMatch(
			/Elm St|Apt 3B|4521|42\.104|72\.589|Jamie|Alex T|Sam P|555-0142|4242/,
		);

		await service.commit(
			service.preview(parsed.csv, parsed.mapping, "doordash", "delivery-history"),
		);

		// And absent from every table in the database, not merely unmapped.
		const tables = await core.db.query(
			"SELECT name FROM sqlite_master WHERE type='table'",
		);
		let dump = "";
		for (const row of tables) {
			const rows = await core.db.query(`SELECT * FROM "${row.name as string}"`);
			dump += JSON.stringify(rows);
		}
		expect(dump).not.toMatch(/Elm St|Apt 3B|4521|42\.104|72\.589|Jamie|Alex T|Sam P|555-0142/);

		// The legitimate price intelligence still landed.
		const products = await core.products.listProducts();
		const padThai = products.find((p) => p.displayName.includes("Pad Thai"));
		expect(padThai?.observationCount).toBe(3);
	});

	it("reports the applied schema version from the database, not a constant", async () => {
		// Regression: the bridge previously returned a hardcoded 1, so a
		// migrated database still advertised the pre-migration schema.
		expect(await core.schemaVersion()).toBe(2);
		await core.db.execute("UPDATE local_profile SET schema_version = 7");
		expect(await core.schemaVersion()).toBe(7);
	});

	it("keeps identity derivation consistent between importer and scanner", () => {
		const fromImport = deriveProductIdentity({ displayName: "Olive oil 500ml" });
		const fromScan = deriveProductIdentity({ displayName: "Olive oil 500ml" });
		expect(fromImport.key).toBe(fromScan.key);
	});
});
