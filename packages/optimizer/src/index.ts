/**
 * @pi/optimizer — pure deterministic purchase planning.
 *
 * PURITY CONTRACT (enforced by purity.test.ts): this package must never
 * import Chrome APIs, DOM APIs, Tauri APIs, or Cloudflare APIs. It receives
 * normalized facts and preferences and returns explainable plan objects.
 * All money math is integer cents.
 */
export * from "./money";
export * from "./offers";
export * from "./coverage";
export * from "./dedupe";
export * from "./engine";
export * from "./actionHarness";
export * from "./units";
export * from "./productIdentity";
export * from "./priceHistory";
export * from "./importer";
export * from "./intake";
export * from "./delivery";
