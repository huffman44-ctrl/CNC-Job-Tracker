# Kit Orders in CNC_WebApp — Design Spec

Date: 2026-07-02
Status: Approved by Travis (brainstorming session, Fable 5)

## Goal

Replace the Order Log tab of `Shop Management for VanLab/CNC-Kit-Management/260627_Order sheet for Claude_Copy.xlsx` with a canonical `orders` store in the existing `cnc-job-tracker` Firestore project, managed through a new Orders screen inside CNC_WebApp. Add Google sign-in authentication to the whole app. Import all 212 historical orders. Do not disrupt the live operator workflow (Collin, Travis).

## Decisions made during brainstorming

- **Two pipelines, not one.** Kit orders (this spec) and custom/entertainment CNC work (quote calculator) remain independent systems sharing infrastructure, not a data model. The calculator is untouched this phase.
- **Kit pipeline first.** The Order Log xlsx is the active order book and highest daily value.
- **Orders UI lives in CNC_WebApp** — same app, same Firebase project, vanilla JS, no build step.
- **Only the Order Log tab migrates.** The xlsx's other tabs (Product Readiness Check, Assembly Numbering, Material Quantity, Appliances) stay in Excel for a later phase.
- **Denormalized data model.** One `orders` collection, no `customers` collection. Kit buyers are overwhelmingly one-time customers. Lowercased `customerEmail` is the disciplined future join key: a customer directory can be derived retroactively by script, with no schema migration.
- **Auth: Google sign-in** with a single-email allowlist at launch (Travis — the user — travis@goldenboyscnc.com), enforced in Firestore security rules and mirrored in the UI. Allowlisted accounts get full read/write on all collections. Collin gets added later via a one-line rules edit; note that until then, any device Collin uses must be signed in with Travis's account or the whole app (job tracker included) is locked for him.
- **Import everything** (~212 orders); numbering continues from the max (currently #1204). The xlsx is renamed `*_ARCHIVED.xlsx` afterward and its Order Log tab is never written again.
- Node.js v24 is installed on this machine (the calculator CLAUDE.md's "no Node" note is stale); the import script is a Node script.

## Architecture

New screen **Orders**, reachable from the projects-directory header. Existing screens, parser, and operator flow are unchanged.

**New Firestore collections:**

- `orders/{orderNumber}` — one denormalized doc per order; doc ID is the VanLab order number as a string (e.g. `"1204"`).
- `meta/orderCounter` — single doc `{ nextOrderNumber }`; order creation assigns the number inside a Firestore transaction.

**New module `js/orders.js`** — Firestore access + Orders screen rendering, following the `storage.js` pattern: in-memory cache for synchronous reads, `onSnapshot` live sync, async cache-first writes. `js/app.js` gains navigation wiring only.

**Order ↔ job linking is computed, not stored.** Tracker filenames already contain `Order_NNNN`. At render time the Orders screen extracts order numbers from each project's sheet filenames and shows a cutting-progress chip (e.g. "3/9 sheets complete") on matching orders, linking to that project. No match → no chip; nothing breaks.

**Data flow:** xlsx → one-time Node import script → `orders` collection → Orders screen, live-synced across devices.

## Data model

`orders/{orderNumber}`:

```js
{
  orderNumber: 1204,            // number; doc ID is String(orderNumber)
  customerName: "",             // string
  customerEmail: "",            // string, lowercased — future join key
  customerVan: "",              // free text as in xlsx (e.g. "28: Promaster 159\" N/S")
  kitAssembly: "",              // was "Kit Level/Assembly Number (Link)"; free text this phase
  material: "",                 // dropdown of known values + free entry
  orderDate: Timestamp | null,
  requiredBy: Timestamp | null,
  confirmedDate: Timestamp | null,   // was "Date Confirmed (GB)"
  fulfillment: "SHIP" | "COLLECT" | "INSTALL" | "TBC" | null,
  collectionDate: Timestamp | null,
  vanArrivalDate: Timestamp | null,
  vanCollectionDate: Timestamp | null,
  shippingCrate: true | false | null,   // from "Yes"/"No"
  status: "PAYMENT_CONFIRMED" | "CUTTING_COMPLETED" | "READY_TO_DISTRIBUTE"
        | "SHIPPED" | "ORDER_COMPLETE" | "UNKNOWN",
  cuttingOrder: number | null,  // queue position; null = not queued
  onHold: boolean,              // xlsx "HOLD" in the cutting-order column becomes this flag
  invoiceNumber: "",            // was "GB Invoice #"
  invoicePaid: true | false | null,
  notes: "",
  buildFile: "",                // free-text reference
  camFile: "",                  // free-text reference
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp,
}
```

Model decisions:

- **Status is a closed enum** in lifecycle order, matching the five values observed in real data (`Payment Confirmed` ×22, `Cutting Completed` ×13, `Ready to Distribute` ×4, `Shipped` ×72, `Order Complete` ×60). Blank statuses (×41) import as `UNKNOWN`. The UI uses a dropdown — no free-text drift.
- **Fulfillment normalizes seven messy variants** (`ship`, `Ship`, `Install`, `Install ` , `INSTALL`, `Collect`, `TBC`) to four enum values.
- **HOLD splits out of the cutting queue** into `onHold`, so an order can be held while keeping its queue position, and `cuttingOrder` stays numeric/sortable.
- **Dates are Firestore Timestamps**, parsed from Excel date serials. Unparseable date cells import as `null` with the original text appended to `notes` prefixed `[import]`.
- The xlsx's unnamed leading column (a row counter, e.g. `209.0`) is dropped; `#NNNN` in "VanLab Order Number" is the identity.

## Orders screen UI

Same CSS tokens, dark-mode support, screen toggled via `hidden` like the other four screens.

- **Orders table** — one row per order: order #, customer, van, status pill, fulfillment, required-by date, cutting-queue position (HOLD badge when `onHold`), invoice-paid indicator, linked-job progress chip. Default sort: newest first.
- **Search box** — client-side filter over the cached collection (order #, customer name, email, van).
- **Status filter chips** — the five statuses plus **Active** (default): everything not `SHIPPED` / `ORDER_COMPLETE`.
- **New Order button** → order form modal. Create mode assigns the next number via the counter transaction and pre-fills orderDate with today.
- **Row click** → same modal in edit mode. Fields grouped like the xlsx: customer info, van/kit/material, dates, fulfillment, status, notes. Status and fulfillment are dropdowns; material is a dropdown (`Baltic Birch (Pre-finished)`, `Baltic Birch (unfinished)`) plus free entry.
- **Cutting queue strip** above the table: orders with a `cuttingOrder`, sorted by position; held orders greyed with a HOLD badge. Reordering is done by editing the number in the form — no drag-to-reorder this phase.
- **Navigation:** "Orders" button in the projects-directory header.

Out of scope this phase: orders CSV export, email integration, invoice generation (custom-work pipeline), drag-to-reorder queue.

## Auth & security rules

- **Firebase Auth, Google provider**, compat SDK style matching the app's existing `firebase.firestore()` usage.
- Loading screen gains an auth gate: signed out → "Sign in with Google" button; signed in but not allowlisted → "Not authorized" + sign-out link. Sessions persist per device (one-time sign-in).
- **Allowlist** — just Travis (travis@goldenboyscnc.com) at launch; emails live in the gitignored `CNC_WebApp/.env` under `ALLOWLIST_*` keys, with a commented-out slot ready for Collin — enforced in Firestore rules — `allow read, write: if request.auth != null && request.auth.token.email in [ ...allowlist ]` — and mirrored in the UI for friendly errors. Full read/write for all allowlisted accounts on all collections. Adding a person = one-line rules edit.
- **The `PASTE` projectId escape hatch also skips auth**, preserving the offline-testing regime in CNC_WebApp's CLAUDE.md.

**Rollout order (never lock out the shop floor):**

1. Inspect current Firestore rules in the console; save a copy (the rollback artifact). Verify the assumption that they are open.
2. Deploy the app update with sign-in UI **while rules stay open** — the app asks for sign-in, the database doesn't yet require it.
3. Enroll Travis's device(s); confirm each works signed in. (Shared shop devices count — every device that uses the app needs a signed-in session before step 4.)
4. Flip the rules. Immediately verify signed-in devices still work AND an incognito window cannot read data. Rollback = paste saved rules back (<1 min).

## Migration (import script)

`scripts/import-orders.js` in CNC_WebApp. Node 24, `xlsx` package to read the Order Log tab, Firebase Admin SDK with a gitignored service-account key (bypasses rules; runs any time relative to the auth rollout, though it is scheduled before the rules flip).

- **Dry-run by default**: no flags → parse all rows, write nothing, print a report: rows mapped cleanly, every planned normalization, and problem rows (missing order numbers, duplicate order numbers, unparseable dates/statuses). Ambiguities are fixed in the xlsx or decided explicitly before commit. Only `--commit` writes.
- **Idempotent**: doc ID = order number, so re-runs overwrite rather than duplicate. A botched import is fixed by re-running.
- Rows without an order number are skipped and listed in the report.
- Unparseable cell values append to `notes` prefixed `[import]` — nothing silently dropped.
- Batched writes (212 docs fits one 500-doc batch).
- Finale: set `meta/orderCounter.nextOrderNumber = max(orderNumber) + 1`; read back collection count as verification.
- **Acceptance check**: Orders screen side-by-side with the xlsx; spot-check ~10 orders across the status spectrum (oldest, newest, a HOLD, a blank-status). Then rename the file `*_ARCHIVED.xlsx`. Other tabs remain in normal use.

## Error handling

- Writes follow the existing cache-first pattern: UI never blocks; Firestore failures log a console warning.
- **Order-number counter uses a Firestore transaction** — concurrent New Order clicks cannot collide.
- **The order edit modal shows a visible saved/offline indicator** — payment status deserves more than a console warning.

## Testing

1. **Offline UI testing**: copied app directory with `PASTE` projectId (Firebase + auth skipped), seeded fake orders in the in-memory cache; browser click-through and screenshot review before prod.
2. **Import**: the dry-run report is the test; reviewed before `--commit`.
3. **Prod verification**: post-import spot-check (above); idempotent re-run as the repair path.
4. **Auth rollout**: per-step checks listed in the rollout order, with the saved-rules rollback.

## Explicit non-goals (this phase)

- Custom-work pipeline (calculator localStorage → Firestore) — separate future design.
- Kit catalog / pricing CSV / other xlsx tabs in Firestore.
- Customer directory collection.
- Orders CSV export, email, invoicing, drag-to-reorder cutting queue.
