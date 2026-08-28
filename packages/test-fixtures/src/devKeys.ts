/**
 * ⚠️ DEVELOPMENT-ONLY KEY MATERIAL — NEVER PRODUCTION ⚠️
 *
 * This keypair exists so config-pack signing/verification can be developed
 * and tested without network access. It is intentionally public in the
 * repository, which means it provides ZERO security. A production deployment
 * must generate its own keypair, keep the private key offline, and ship only
 * the public key (CONFIG_PACK_PUBLIC_KEY) to clients.
 */
export const DEV_CONFIG_SIGNING_PRIVATE_KEY_HEX =
	"97f961bb839fa3f6eb35d4f0d746914abf903b1bd0a5e3ca4367c9d1aa9cff4a";

export const DEV_CONFIG_SIGNING_PUBLIC_KEY_HEX =
	"122f9f8a5340c0c3f37f41a4dba21e5bcb032264c9a77393d4312d8c8a5ed31b";

export const DEV_CONFIG_KEY_ID = "dev-key-1-NON-PRODUCTION";
