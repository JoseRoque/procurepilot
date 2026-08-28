# Adapter Contract and Safety/Action Matrix

An adapter is the only component allowed to read a merchant page or act on it. Adapters are
data-configured (via signed config packs), never remotely coded.

## Contract

```ts
interface CommercePageAdapter {
  id: SupportedPlatform;
  label: string;
  matches(url: URL, document: Document): boolean;
  getDetectionStatus(url: URL, document: Document): "supported" | "experimental" | "scan_unavailable";
  extract(document: Document, url: URL): Promise<CartSnapshotDraft>;   // observation
  // Action support is OPT-IN per adapter and only via bounded, pack-supplied selectors:
  actionCapabilities?: ActionCapabilityMap;                            // absent ⇒ scan-only
}
```

Rules every adapter must obey:

- Extraction reads only visible text within commerce-scoped containers, within the
  extraction budget (bounded rows, bounded characters). Never `document.body` wholesale.
- Extraction runs only after user initiation.
- `extract()` must independently refuse sensitive pages (login/payment/MFA/security),
  regardless of what the caller checked.
- Missing facts are reported as absent + an extraction note — never guessed.
- Selectors used for actions come only from a verified config pack, are bounded
  (`maxMatches`, required visible text), and can target only the six allowed action types.

## Safety / action matrix

| Category | Contents |
| --- | --- |
| **Allowed observation** | visible cart line names/quantities/prices, subtotal, discounts, fees, tax, visible credits, displayed total, visible offer text, item availability text, page origin + path hint |
| **Permitted reversible actions** | `open_visible_offers`, `search_exact_item`, `add_exact_approved_item`, `adjust_quantity` (within approved bounds), `remove_optional_item` (explicitly optional only), `rescan_cart` |
| **Required user approval** | every action, individually, with a user-visible summary, a scope hash binding the exact payload, and an expiry; approval never carries over to a different payload or page state |
| **Forbidden actions** | anything touching login, MFA, CAPTCHA, payment, wallet/gift cards, addresses, checkout/"place order"/"pay"/"submit order", promo-code brute force, background scanning, hidden interaction, anti-bot evasion |
| **Stop conditions** | unexpected origin change · material page-state-hash mismatch · login/MFA/CAPTCHA/security page detected · payment/checkout/address page detected · required element missing · action budget exhausted · repeated action (dedupe hash) · post-action total unavailable · material price change · uncertain substitution · unknown cart modifications · low adapter confidence · approval revoked/expired |

## Status vocabulary

Adapters and UI must use exactly: `Supported`, `Experimental`, `Not detected`,
`Scan unavailable on this page`. Detection is never marketed as guaranteed extraction, and
no adapter claims production support for a named merchant in this alpha. The five named
storefront stubs (DoorDash, Uber Eats, Instacart, Target, Walmart) remain experimental,
scan-only, and hostname-detection-only until real markup verification exists. The demo
store fixture (`packages/test-fixtures`) is the only adapter with action capabilities in
this build.
