# Purchasing Intelligence — Bronze (Chrome Extension)

A standalone Chrome MV3 extension companion to the Purchasing Intelligence web app. This is the
**Bronze** release: a local-first, user-initiated cart scanner and deterministic recommendation
engine. It has no dependency on the Cloudflare backend and makes no network calls by default.

## What the MVP does

- Lets you click **Scan current cart** in the side panel to read visible cart/checkout text on
  the current tab (subtotal, discounts, fees, tax, credits, displayed total, visible offers).
- Runs a deterministic, rules-based engine over that data — no model inference — to produce a
  recommendation: review before checkout, a grounded threshold-filler suggestion, a comparison
  against a saved cart, or a plain "nothing further to note."
- Stores results locally (`chrome.storage.local` for preferences/latest scan,
  IndexedDB for up to 20 saved snapshots you explicitly choose to save).
- Ships a complete **Demo mode** with three static fixture carts so the whole recommendation flow
  can be exercised without visiting any real store.
- Shows a small, dismissible, Shadow-DOM-isolated status chip on pages it scans.

## What it explicitly does NOT do

- It does not complete checkout, select or enter payment, redeem gift cards, edit addresses, log
  in, or handle OTP/MFA/CAPTCHA. There is no "Buy," "Pay," or "Place order" button anywhere in
  this codebase.
- It does not scan any tab automatically or in the background — every scan starts from an
  explicit click.
- It does not read, store, or transmit cookies, page HTML, screenshots, passwords, exact
  addresses, phone numbers, or payment/account identifiers.
- It does not call any external AI/LLM service, and it makes no network requests of any kind by
  default (verified — see "Verification" below).
- It does not claim durable, production-grade extraction for any named merchant. The DoorDash,
  Uber Eats, Instacart, Target, and Walmart adapters are honest stubs (see "Site adapters" below).

## Privacy model

- **Local by default.** All captured data stays in this browser profile
  (`chrome.storage.local` + IndexedDB). There is no server component to this release.
- **No cookies, ever.** The content script never reads `document.cookie`, never calls
  `chrome.cookies`, and the extension does not request the `cookies` permission.
- **No payment or login data.** The generic adapter and every site stub actively refuse to run on
  pages that look like login, payment entry, MFA, or account-security flows (`lib/sensitivePages.ts`) — no chip is shown there and no extraction is attempted.
- **No automatic cloud sync.** Preferences show "Cloud sync: coming later; disabled in this
  version," and `localOnly` is hard-locked to `true` in this release regardless of any stored
  value.
- **Scan is always user-initiated.** There is no static `content_scripts` entry and no
  `host_permissions` in the manifest — the content script only ever runs because
  `chrome.scripting.executeScript` was called in direct response to a click on **Scan current
  cart** in the side panel (using the `activeTab` grant from that click). Re-scanning by clicking
  the in-page chip after that reuses the already-injected script; nothing is injected proactively
  on page load.

## Architecture

```
lib/                       Shared, framework-agnostic TypeScript (tested with vitest)
  types.ts                 Canonical data models (CartSnapshot, VisibleOffer, etc.)
  money.ts                 normalizeMoney / formatCents / addCents (integer cents only)
  offers.ts                parseVisibleOffer — conservative offer-text parsing
  engine.ts                calculateObservedTotal, evaluateThresholdOpportunity,
                            createCartRecommendation — the deterministic rules engine
  sensitivePages.ts        Login/payment/MFA heuristics shared by chip-injection and extraction
  messages.ts               Zod-validated ExtensionMessage / ContentScriptMessage contracts
  snapshotFactory.ts        Stamps a draft with id/createdAt/privacy (the only place that happens)
  demoFixtures.ts           The three static demo carts
  adapters/
    types.ts                CommercePageAdapter interface
    generic.ts               The one fully-functional adapter (budgeted, container-scoped)
    siteStubs.ts             Experimental, honest no-op stubs for 5 named platforms
    mock.ts                  ?pi_demo=<key> adapter for exercising the full pipeline
    registry.ts               resolveAdapter / detectPage
  storage/
    settings.ts              chrome.storage.local (preferences, install metadata, latest scan)
    db.ts                    IndexedDB repository for saved snapshots (20-item cap, pruning)

entrypoints/
  background.ts             MV3 service worker: message router, injection, recommendation eval
  injected-content-script.ts  Unlisted script injected on demand (never statically registered)
  sidepanel/                 React UI (Home / Saved / Preferences / Demo)
```

### Message flow

1. Side panel sends `SCAN_CURRENT_PAGE` to the background.
2. Background resolves the active tab and calls `chrome.scripting.executeScript` to inject
   `injected-content-script.js` into it (this is the only place a content script ever runs).
3. The content script checks for sensitive-page signals first (no chip, no extraction if so),
   otherwise detects the page via the adapter registry, reports `PAGE_DETECTION_RESULT`, shows the
   chip, and — if a scan is possible — extracts and reports `CART_SNAPSHOT_EXTRACTED` (or
   `CART_SCAN_FAILED` with a plain-language reason).
4. The background stamps the draft into a full `CartSnapshot`, reads preferences and prior
   snapshots, computes a `CartRecommendation`, persists `{snapshot, recommendation}` to
   `chrome.storage.local` (so a service-worker restart never loses the latest result), and
   broadcasts `CART_SCAN_COMPLETE` to the side panel.
5. All messages are validated with Zod at the boundary. Content-script-originated messages never
   carry a `tabId` claim — the background fills it in from `sender.tab.id`, the only trustworthy
   source, since content scripts have no `chrome.tabs` access and cannot know their own tab ID.

### Site adapters — why they're experimental

Building durable extraction for a live commerce site requires ongoing verification against that
site's real, changing markup — something this environment can't do safely or continuously. The
DoorDash/Uber Eats/Instacart/Target/Walmart adapters therefore only identify the platform by
hostname (a stable, public signal) and honestly report "experimental, not yet implemented" rather
than guessing at selectors that would silently break. **Adding a real platform adapter later**
means implementing `CommercePageAdapter.extract()` in `lib/adapters/` against actual verified
markup and changing its `getDetectionStatus()` to return `"supported"` once you're confident in
it — the registry and UI already handle the "supported" vs. "experimental" distinction.

## Chrome permissions and why each is needed

| Permission | Why |
| --- | --- |
| `storage` | `chrome.storage.local` for preferences, install metadata, and the latest scan cache. |
| `activeTab` | Grants temporary access to the current tab only when the user invokes the extension (clicking the toolbar icon or a side-panel button) — the basis for every scan. |
| `scripting` | Lets the background inject the content script via `chrome.scripting.executeScript`, in direct response to that user action. |
| `sidePanel` | The primary UI surface. |

There are **no `host_permissions`** and **no static `content_scripts`** — the manifest is checked
by `npm run build` and inspectable at `.output/chrome-mv3/manifest.json`. The extension does not
request `cookies`, `webRequest`, `debugger`, `nativeMessaging`, browsing history, or `tabs`.

## Install / build

```bash
npm install
npm run build      # production build → .output/chrome-mv3/
npm run dev         # dev build with hot reload, auto-launches a throwaway Chrome profile
```

To load unpacked manually:

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3/`.
4. Click the extension's toolbar icon — the side panel opens.

## Demo mode

Open the side panel → **Demo** tab. Pick one of the three fixture carts (below-threshold,
discount-and-credit, mismatched-total) to see the full scan-result and recommendation UI without
visiting any site. No real page, network call, or local storage write is involved in Demo mode.

For an end-to-end check of the *real* pipeline (content script → background → side panel) without
a merchant account, append `?pi_demo=below_threshold` (or `discount_and_credit` /
`inconsistent_total`) to any URL's query string, then click **Scan current cart**.

## Tests

```bash
npm test          # vitest run — 76 tests across money/offers/engine/adapters/storage/messages/UI-safety
npm run test:watch
npm run compile   # tsc --noEmit
```

Notable coverage:
- Money/percent/threshold/discount parsing, and integer-cent arithmetic throughout.
- A discount is never marked `"appears_applied"` without explicit page wording.
- A discrepancy between the displayed and computed total always produces a review warning.
- Low-confidence extraction always recommends review rather than asserting a number.
- The IndexedDB repository caps storage at 20 snapshots, pruning the oldest first.
- Malformed/spoofed messages (including a content script claiming a `tabId`, or a snapshot lying
  about its own privacy attestation) are rejected by the Zod schema.
- `hasSensitiveInputFields` / `isSensitivePage` correctly flag login/payment/MFA pages so neither
  the chip nor extraction ever runs there.
- Stored text (including HTML-looking strings) renders as literal text via React's escaping —
  verified with `renderToStaticMarkup`.
- All three demo fixtures produce their intended recommendation shape.

## Known Manifest V3 limitation

Service workers can be terminated by Chrome whenever idle and restarted on the next event. This
extension never keeps anything durable in module-level memory: preferences, install metadata, and
the latest scan result are always written to `chrome.storage.local` before the background handler
returns, and saved comparisons live in IndexedDB (disk-backed, independent of the service worker's
lifecycle). A restart mid-flow can only ever lose an *in-flight* scan that hasn't completed yet —
never a previously saved or completed one.

## Verification performed

- `npm run build` succeeds and produces a manifest with exactly `storage`, `activeTab`,
  `scripting`, `sidePanel` — no host permissions, no static content script registration.
- `npm run compile` (`tsc --noEmit`, with `noUncheckedIndexedAccess` enabled) is clean.
- `npm test` — 76/76 passing, covering every rule described above.
- `grep` across `lib/` and `entrypoints/` confirms zero uses of `fetch`, `XMLHttpRequest`,
  `WebSocket`, or `navigator.sendBeacon`, and zero uses of `chrome.cookies`, `chrome.webRequest`,
  or `chrome.debugger` anywhere in the codebase.
- `grep` of the content script confirms the only DOM-mutating calls target elements the chip
  itself created — there is no `.click()`, `.submit()`, form-field assignment, or
  `dispatchEvent` call against the host page's own elements anywhere.

**Not independently verified — a real Chrome platform restriction, not just a tooling gap:**
current Chrome (confirmed on both Stable and Canary while building this) silently ignores the
`--load-extension` command-line flag entirely as an anti-malware hardening measure — it no longer
loads an unpacked extension that way at all, and this also means `npm run dev`'s auto-launch
(`web-ext`) does not actually load the extension either, despite reporting success. The only
remaining path is a human clicking **Load unpacked** in the `chrome://extensions` UI and picking
the directory in the native OS folder picker — Chrome DevTools Protocol has no hook to intercept
that picker (it isn't a standard `<input type="file">`), so this one step cannot be scripted from
outside the browser. **After** that manual step, the loaded extension is fully inspectable and
driveable via CDP like any other page — please do the one-time manual load per the steps above; a
follow-up automated pass (side panel content, Demo mode, a live scan) can then be run against it.

## Non-goals for this release

User sign-up/login, Cloudflare Access/Supabase Auth, browser automation beyond a single read-only
DOM pass, supplier/ERP/P2P integrations, payment handling, purchasing execution, LLM/agent calls,
collective-intelligence ingestion, persistent chat, CRM/email automation, multi-tenant access
control. These are all explicitly out of scope for Bronze.

## Recommended next step

An **optional** future checkpoint-sync feature: periodically send a small, explicitly redacted
event packet (e.g. `{platform, detectionStatus, confidence, action}` — no line items, no offer
text, no URLs) to the Cloudflare backend's procurement-intelligence endpoints, gated behind a
clearly-labeled opt-in toggle that defaults to off. Out of scope for this release.
