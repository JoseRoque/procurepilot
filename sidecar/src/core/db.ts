import { invoke } from "@tauri-apps/api/core";

export type Row = Record<string, unknown>;

/**
 * Thin typed wrapper over the Rust SQLite commands. SQL lives in the
 * repositories; the Rust side binds parameters positionally and never
 * interpolates strings.
 */
export interface Db {
	query(sql: string, params?: unknown[]): Promise<Row[]>;
	execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

export const tauriDb: Db = {
	async query(sql, params = []) {
		return invoke<Row[]>("db_query", { sql, params });
	},
	async execute(sql, params = []) {
		return invoke<{ changes: number; lastInsertRowid: number }>("db_execute", { sql, params });
	},
};

export type FieldCrypto = {
	encrypt(plain: string): Promise<string>;
	decrypt(value: string): Promise<string>;
};

export const tauriCrypto: FieldCrypto = {
	encrypt: (plain) => invoke<string>("encrypt_text", { plain }),
	decrypt: (value) => invoke<string>("decrypt_text", { value }),
};

export type RuntimeInfo = {
	version: string;
	dbPath: string;
	bridgePort: number;
	pairingToken: string;
	encryptionAvailable: boolean;
	platform: string;
};

export function getRuntimeInfo(): Promise<RuntimeInfo> {
	return invoke<RuntimeInfo>("get_runtime_info");
}

export function writeExport(content: string): Promise<string> {
	return invoke<string>("write_export", { content });
}
