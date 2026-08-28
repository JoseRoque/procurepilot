#!/usr/bin/env node
/**
 * Signs a configuration pack with an Ed25519 private key.
 *
 *   node scripts/sign-config-pack.mjs <unsigned-pack.json> [--key <hex>] [--out <file>]
 *
 * With no --key, this uses the DEVELOPMENT key from packages/test-fixtures,
 * which is public in this repo and therefore provides ZERO security. A
 * production pack must be signed with a private key held outside this
 * repository (offline or in a secrets manager) — never checked in.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { signAsync } from "@noble/ed25519";

const DEV_PRIVATE_KEY_HEX = "97f961bb839fa3f6eb35d4f0d746914abf903b1bd0a5e3ca4367c9d1aa9cff4a";

function canonicalize(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
	const entries = Object.entries(value)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
	return `{${entries.join(",")}}`;
}

function hexToBytes(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

const args = process.argv.slice(2);
const inputPath = args[0];
if (!inputPath) {
	console.error("Usage: node scripts/sign-config-pack.mjs <unsigned-pack.json> [--key <hex>] [--out <file>]");
	process.exit(1);
}
function flagValue(name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
const keyHex = flagValue("--key") ?? DEV_PRIVATE_KEY_HEX;
const outPath = flagValue("--out");

if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
	console.error("Private key must be 64 hex characters (32 bytes).");
	process.exit(1);
}

if (keyHex === DEV_PRIVATE_KEY_HEX) {
	console.warn("⚠️  Signing with the DEVELOPMENT key — this pack is NOT production-safe.");
}

const unsigned = JSON.parse(readFileSync(inputPath, "utf8"));
delete unsigned.signature;
const message = new TextEncoder().encode(canonicalize(unsigned));
const signature = await signAsync(message, hexToBytes(keyHex));
const signed = {
	...unsigned,
	signature: Array.from(signature)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join(""),
};

const output = JSON.stringify(signed, null, 2);
if (outPath) {
	writeFileSync(outPath, output);
	console.log(`Signed pack written to ${outPath}`);
} else {
	console.log(output);
}
