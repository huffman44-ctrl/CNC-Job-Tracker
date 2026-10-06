# Customer Billing inside the Job Tracker — Phases 1 and 2 — design

**Date:** 2026-10-04
**Status:** Approved by Travis 2026-10-04 (§15 answers). Phase 1 implemented 2026-10-04 on branch customer-billing-phase-1 (plan: ../plans/2026-10-04-customer-billing-phase-1.md); Phase 2 implemented 2026-10-05 on branch customer-billing-phase-2 (plan: ../plans/2026-10-05-customer-billing-phase-2.md). Every decision below was made by Travis on 2026-10-04 (vault note `Brain/Projects/Studio Billing Redesign.md`, plan `~/.claude/plans/pasted-content-id-536b-i-want-lazy-flamingo.md`, design canvas "Customer Billing — New Flow"). Nothing in this document re-opens a settled decision; the genuine unknowns are collected in §15.
**Design target:** the approved canvas screens `Main` (upload + job details), `JobCard`, `BillingB`, `InvoiceConfirm`, `Done`. `Archive`, `CutReport` and `QuickQuote` are Phase 3/4 reference only. BillingA/C and the phone view were dropped.
**Prerequisite (separate, not in this spec):** Phase 0 — the one-time double-billing audit, run read-only from a CSV download of the `Orville - Season 4` tab. It needs nothing from this spec and this spec needs nothing from it, but Travis should see its result before the first real bill goes out of the new screen.

---

## 1. Goal

Make billing every cutting customer — film studios, other van conversion companies, anyone Golden Boys cuts for — a review-and-click job that Eva can do, with Travis as backup, without ever missing a sheet or billing one twice. Three goals weighted equally: fewer steps, never miss or double-bill, fair prices.

Today billing is a seven-hand-off chain: Aspire → Job Tracker → per-job CSV / Master Job Log → hand-built staging tab (`Orv_3603`) → Estimating App in one browser's localStorage → QuickBooks CSV import → invoice number and colours typed back into the log by hand. The Job Tracker also *deletes* every job after export and re-appends every sheet to the log on every export (9 of 76 jobs exported 2–5 times), so the log cannot be trusted to say what was billed.

After Phases 1 and 2:

- Every sheet ever cut stays in the Job Tracker, carrying its own billed status (invoice #, PO #, date).
- Travis sets customer, material and turnaround once, at upload. Collin cuts and exports exactly as he does today, minus the customer question. Eva opens Billing, sees one ready-to-bill list grouped by customer, clicks one button per customer, downloads the QuickBooks file, imports it, clicks "Imported OK". Done.
- One price list (handling + Aspire time) replaces Simple/Complex and Production Run, with every number editable in Settings.
- The Master Job Log gets one row per sheet, updated in place, with the invoice number written by the app.

## 2. Non-goals (out of scope, but nothing here may block them)

| Later work | What this design does so it stays easy |
|---|---|
| **Phase 3** — archive/search screen, printable cut report per invoice, dispute export | Every sheet record keeps `archiveUrl`, cut time, invoice #, PO #; invoices keep the exact line snapshot and sheet list. The Done screen's "Open the cut report" / "Find them in the archive" buttons are *not* built in Phase 2 (see §9.5 for what replaces them). |
| **Phase 4** — quick quote from rough numbers | The pricing engine (`js/pricing.js`) is a pure function of plain inputs; a quote is the same call with made-up sheets. |
| **Direct QuickBooks Online connection** | The invoice record already holds everything the API would need; the CSV builder is one pluggable "output" of an invoice, not the invoice itself. |
| **VanLab billing build** (cutting + sanding + crate packing + hardware…) | Invoices are built from pluggable *line types*; VanLab's lines arrive later as their own file. Until then VanLab is a customer flagged "billed outside this app": its sheets are recorded, finished and logged, but never listed in Billing. One Settings switch flips it on. |
| A second named price list (e.g. "Studio") | Settings stores price lists as a named map with `standard` the only entry; each customer points at a list name. Adding "Studio" later is data, not code. |
| Per-job "no charge" for samples | Not built. In-house work (Golden Boys' own parts) is a customer flagged "billed outside this app", which keeps it out of Eva's list. |
| Changing anything Collin sees | Hard rule, not a non-goal — see §3. |

## 3. Roles and who sees what

Roles are identified exactly as today: by the signed-in Firebase Auth email, checked in Firestore rules against an allowlist. There is no `users/` role document for the Job Tracker; the HQ rules file keeps the email-array pattern already used for `customers`, `projectCustomer`, `sheetAnnotations`, `printQueue`.

| Role | Who | Sees | Can do |
|---|---|---|---|
| **Owner** | Travis, **Eva** (full co-owner, identical access — never a reduced role) | Everything Collin sees, plus: job details at upload, the owner panel on the job card (chips, Design/CAM hours, sheet billing tags, job-level "ready" state), Billing, Settings | Everything below, plus set job details, enter labor, mark jobs ready, bill, cancel, add PO numbers, edit Settings, flip feature switches |
| **Operator** | Collin (and the owners, when acting on the shop floor) | The app exactly as it is today: upload screen, projects board, sheet workspace, Mark In Progress / Mark Complete / Clear, Export CSV, To Print, Ticket History, Manage Customers | Upload, mark sheets, export (finish) a job |

**Collin sees nothing new — enforced two ways.**

1. **Firestore rules (the real enforcement):** every collection that holds prices, billed status, labor hours, invoices or settings is readable and writable **only** by the two owner emails. Collin's account cannot read a single billing field, so no browser-side bug can leak one.
2. **UI (the convenience):** `app.js` never hardcodes owner emails (the repo is public and served from Pages). Instead, on sign-in the app tries to read `settings/features`. Collin's read is denied by the rules → the app shows no billing UI at all. An owner's read succeeds and returns which screens are switched on for which owner (§7.6). "Switching a screen off never affects Collin" is therefore true by construction: he never had the doc.

**Eva is not on today's allowlist.** Phase 1 adds her to the existing four allowlisted collections *and* to every new one, creates her Firebase Auth account (self-signup is disabled; Travis creates it in the console as he did for Collin, per `2026-08-03-firebase-auth-design.md`), and adds her uid to `ALLOWED_UIDS` in the **live** Apps Script so the id-token-guarded endpoint actions (print queue, order lookup, and the new log actions in §6) accept her.

## 4. The workflow, end to end

```
TRAVIS   drops Aspire HTML files ─► job-details step (customer, material, turnaround)
                                   ─► job on the board (sheets saved, finished:false)
COLLIN   Mark In Progress ─► Mark Complete per sheet, as he cuts (cut time = weekend detection)
         End of job: Export CSV ─► CSV download + ticket print (unchanged)
                                 ─► ONE log row per sheet, upserted (never appended twice)
                                 ─► job marked finished; leaves the board (as today, minus the delete)
TRAVIS   Job card: adds Design/CAM hours (or ticks "No design time") ─► "Done — ready for billing"
EVA      Billing: "Bill work cut through <Saturday>" ─► "Bill Northlight · $1,865"
         Invoice screen: 1) check suggested invoice # (refuses a used one), PO optional
                         2) Download QuickBooks file  ─► sheets lock "Invoice N — in progress"
                         3) imports in QuickBooks ─► "Imported OK" ─► sheets Billed · #N, log rows get N
                                                 or "Cancel N" ─► sheets back to ready
LATER    PO arrives ─► Billing › Recent invoices › Add PO ─► sheets + log rows get the PO
```

Partial billing fits the same flow: cut sheets of a still-running job can be added to this week's bill; the rest appear when cut. Design hours wait for the "Done — ready for billing" button.

## 5. Data model

All new collections live in the same live Firestore project (`cnc-job-tracker`). Keys reuse the app's existing identities: `fileKey = simpleHash(fileName)` for a sheet; `jobKey = noteKey(jobName) = 'proj_' + simpleHash(jobName)` for a job (the same key `projectNotes/` and `projectCustomer/` already use).

Design principle behind the split: **anything Collin must read or write stays in a collection he can reach; anything about money lives in a collection he cannot.** Firestore rules work per document, not per field, so billing data is never mixed into `sheets/` or `completions/`.

### 5.1 The sheet record (write this once; it goes into the repo `CLAUDE.md` in Phase 1)

A "sheet" is one Aspire setup-sheet HTML file. Its record is spread over three documents that share the same `fileKey`:

| Field | Lives in | Meaning | Written by |
|---|---|---|---|
| `fileKey` | `sheets/{fileKey}` | `simpleHash(fileName)`; the identity of the sheet everywhere (Firestore, log column "Sheet Key") | upload (Travis) |
| `fileName`, `sheetTitle`, `jobName` | `sheets/` | From the Aspire file (`parseJobSheet`) | upload |
| `totalTime` | `sheets/` | Aspire's estimated cut time `HH:MM:SS` — **this is what the customer is billed on**, never the wall-clock time | upload (parsed) |
| `toolpaths[]`, `materialInfo[]` | `sheets/` | Toolpath list (count and names feed repeat detection and the V-bit flag); material size/thickness lines (thickness pre-fills the job's material) | upload (parsed) |
| `layoutSvg` / `layoutSvgGz` / `layoutOversize` | `sheets/` | The drawing. **Removed when the job is finished** if `archiveUrl` exists (§5.2) | upload; cleared at finish (Collin's export) |
| `archiveUrl` | `sheets/` | Drive download link to the archived original HTML — the drawing of record after finish | upload (async, Apps Script) |
| `uploadedAt` | `sheets/` | Server timestamp | upload |
| `finished`, `finishedAt`, `finishedBy` | `sheets/` | `true` once the job was exported; finished sheets leave the live board for everyone | **new** — Collin's export |
| `status`, `completedAt`, `operator`, `notes` | `completions/{fileKey}` | Unchanged 3-state record. `completedAt` is **the cut time**: it drives weekend detection and the "cut through" date. Absent = not cut. Collin's Clear deletes this doc; Mark Complete rewrites it | Collin (Mark Complete / Clear) |
| `text` | `sheetNotes/{fileKey}` | Per-sheet instruction note (unchanged) | anyone |
| `billing.status` | `sheetBilling/{fileKey}` | `unbilled` (default when no doc) · `in-progress` · `billed` · `external` (customer billed outside this app, or cleared by an owner as "no charge") | **owners only** (Billing screen) |
| `billing.invoiceNumber`, `billing.poNumber`, `billing.billedAt` | `sheetBilling/` | Which invoice, its PO, when "Imported OK" was clicked | owners (Billing) |
| `billing.cutAtBilled` | `sheetBilling/` | Snapshot of `completions.completedAt` at the moment of billing. If the live `completedAt` later differs or disappears, the sheet was **re-cut**: the job card shows "re-cut <date>", nothing is charged, billing is untouched | owners (Billing, automatically) |
| `billing.cutDateOverride` | `sheetBilling/` | Owner's correction of the cut date (the weekend/through-date safety valve). Effective cut date = override ?? `completedAt` | owners (job card) |
| `billing.priced` | `sheetBilling/` | Snapshot `{ handling, timeCharge, weekendPremium, repeatOf, hourlyRate, priceList }` frozen at billing, so a later Settings change never rewrites history | owners (Billing, automatically) |
| `billing.jobKey`, `billing.customerKey` | `sheetBilling/` | Denormalised for queries | owners |

Statuses as the owner job card shows them (no status key, plain words): **Not cut yet** · **Cut** · **On invoice 3612 (in progress)** · **Billed · #3612**. Extra tags, never with prices: **Weekend**, **Repeat of sheet 2**, **Re-cut Oct 6**. Collin's sheet rows show none of these.

### 5.2 `sheets/{fileKey}` changes (existing collection)

- New field `finished: boolean` on every doc. Upload writes `false`. Collin's export writes `true` + `finishedAt` + `finishedBy` for every sheet in the job.
- The live-board listener (`Storage.onSheetsChange`) becomes `where('finished', '==', false)`. A Firestore equality filter **excludes docs without the field**, so Phase 1 ships a one-time idempotent migration that stamps `finished: false` on every legacy doc *before* the listener change goes live (§11.1).
- At finish, if `archiveUrl` is set, the client clears `layoutSvg`, `layoutSvgGz` and sets `layoutOversize: false` on each sheet. Why: finished sheets now live forever, and the board listener's initial load would otherwise grow by every drawing ever cut (a drawing can be hundreds of KB gzipped; 1,668 sheets a year). The archived HTML is the drawing of record; the owner job card for a finished job links to it instead of rendering it. If `archiveUrl` is missing (archive failed at upload), the drawing is kept.
- Deleting a sheet remains possible for mistakes on an active job, but the rules deny a delete when `finished == true` or when a `sheetBilling` doc exists with status `in-progress` or `billed`. "Sheets are never deleted" is enforced, not just intended.
- **Re-upload guard:** today `handleFiles` only checks the in-memory `sheets` array. With finished sheets excluded from that array, re-dropping a finished sheet's file would silently overwrite it. The upload path must do a Firestore `get` of `sheets/{fileKey}` first; if it exists and is finished, show the blocking notice "*"<file>" was already cut and finished on <date> (job <name>). If this is a new cut, save it from Aspire under a new file name.*" A customer design change arrives as a new file = new sheet = billed; that is the rule.
- Owners can **put a finished job back on the board** from the job card (`finished: false` on its sheets) for an our-mistake re-cut. Billing records are untouched by this.

### 5.3 `jobs/{jobKey}` — new, operator-readable

```
{ jobName, finished: bool, finishedAt, finishedBy, exportCount, lastExportAt, createdAt, createdBy }
```
Written by Collin's export (finish) and by upload (create). Exists so "finished" has one job-level home; `projectCustomer/{jobKey}` (existing, operator-readable) keeps holding the customer name — Collin's export reads it to route the log rows. The owner job-details step writes `projectCustomer` at upload instead of the export-time picker.

### 5.4 `jobBilling/{jobKey}` — new, owners only

```
{
  jobName, customerKey, customerName,            // mirrors projectCustomer for owner-side queries
  material: { kind: 'customer' | 'ours', materialId, name, pricePerSheet },   // pricePerSheet snapshot at selection
  turnaround: 'standard' | 'rush48' | 'rush24',
  laborLines: [ { id, typeId, typeName, hours, note, enteredBy, enteredAt,
                  status: 'unbilled' | 'in-progress' | 'billed', invoiceNumber, billedAt } ],
  noDesignTime: bool,
  readyForBilling: bool, readyAt, readyBy,       // the ONE job-level state
  thicknessIn: number | null,                    // parsed from the sheets, used for the material pre-fill
  updatedAt, updatedBy
}
```
"Ready" in this app means **only** `readyForBilling`. The chip reads "Not sent to billing yet" → "Ready for billing ✓". Labor lines carry their own billed status because design hours can be billed on a later invoice than the cut sheets.

### 5.5 `sheetBilling/{fileKey}` — new, owners only

Fields in §5.1. No doc = unbilled. Docs are created the first time a sheet is billed, locked, overridden or marked external, never deleted.

### 5.6 `invoices/{invoiceNumber}` — new, owners only

Doc id **is** the invoice number as a string (`"3612"`), so two owners cannot create the same number: the create is a transaction that fails if the doc exists.

```
{
  number: 3612, customerKey, customerName,
  status: 'in-progress' | 'imported' | 'cancelled',
  createdAt, createdBy, downloadedAt, importedAt, importedBy, cancelledAt, cancelledBy,
  poNumber: '' , poAddedAt,
  throughDate: '2026-10-03' | null,               // the week-ending filter in force, or null = everything to date
  sheetKeys: [...], laborLineRefs: [ { jobKey, lineId } ],
  lines: [ { type, qbItem, description, quantity, rate, amount, serviceDate, jobKeys } ],   // exact snapshot
  breakdown: [ { label, amount } ],               // the plain-words panel, as shown
  total, priceListName, settingsSnapshot: { ...the price list and labor rates used },
  csv: '…',                                       // the exact file bytes, so "Download again" is identical
  logWritten: bool, logError: string | null
}
```

### 5.7 `customerBilling/{customerKey}` — new, owners only

```
{ name, billedOutsideApp: bool, priceList: 'standard',
  defaultMaterialByThickness: { '0.75': { kind: 'customer' | 'ours', materialId }, ... },
  notes }
```
`customers/{key}` (existing, operator-readable, drives the picker and log routing) is unchanged. VanLab and Golden Boys get `billedOutsideApp: true` before Billing is switched on (§11.2).

### 5.8 `settings/*` — new, owners only (one doc per concern)

| Doc | Contents | Defaults seeded in Phase 2 |
|---|---|---|
| `settings/pricing` | `{ defaultList: 'standard', lists: { standard: { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.50, rush24: 0.75 }, weekendRate: 0.50, cutMinimum: 150, roundTo: 5 } } }` | as shown |
| `settings/laborTypes` | `[ { id: 'design', name: 'Design', rate: 150, minHours: 0, qbItem: 'Digital Design' }, { id: 'cam', name: 'CAM', rate: 85, minHours: 0, qbItem: 'Digital Design' } ]` | mockup numbers — **rates to confirm, §15** |
| `settings/qbItems` | `{ cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'N', labor: 'N', materials: 'N' }, dueDays: 30 }` | names from the estimator's QuickBooks test 2026-09-15; `dueDays` and `materials` taxability to confirm |
| `settings/materials` | `[ { id, name: '3/4 in Baltic birch', thicknessIn: 0.75, pricePerSheet }, ... ]` | empty; Travis adds |
| `settings/invoicing` | `{ seedNumber: <last QuickBooks invoice #>, weekEndingDay: 6 }` (6 = Saturday) | seed to confirm |
| `settings/features` | §7.6 | billing/settings/jobDetails on for Travis only |
| `settings/migrations` | `{ sheetsFinishedFlag: { done: true, at, count } }` | written by the Phase 1 migration |

### 5.9 Firestore security rules — requirements

Source of truth stays `HQ/firestore.rules` (deployed from the HQ repo with `firebase deploy --only firestore:rules`; a console edit is wiped by the next deploy). **A collection with no match block is denied**, and the 2026-08-19 rewrite silently dropped three collections — so the plan's rules task must list *every* collection below and the review must diff the deployed text against this table.

Helper functions to add:
```
function isOperator() { return request.auth != null && request.auth.token.email in [TRAVIS, EVA, COLLIN]; }
function isOwner()    { return request.auth != null && request.auth.token.email in [TRAVIS, EVA]; }
```
(`TRAVIS`/`EVA`/`COLLIN` are the literal emails in the file — Eva's is an open question, §15.)

| Collection | Read | Create / update | Delete | Notes |
|---|---|---|---|---|
| `sheets` | operator | operator | operator **and** `resource.data.finished != true` **and** `!(exists(sheetBilling/$(id)) && get(sheetBilling/$(id)).data.status in ['in-progress','billed'])` | today: any signed-in |
| `completions`, `projectNotes`, `sheetNotes`, `ticketHistory` | operator | operator | operator | today: any signed-in; tightening to the three emails is a side benefit |
| `customers`, `projectCustomer`, `sheetAnnotations`, `printQueue` | operator | operator | operator | today: Travis + Collin — **add Eva** |
| `jobs` | operator | operator | nobody | |
| `jobBilling`, `sheetBilling`, `customerBilling`, `settings` | owner | owner | nobody (`sheetBilling`, `invoices`) / owner (`settings`, `customerBilling`, `jobBilling`) | Collin: denied entirely |
| `invoices` | owner | create: owner **and** `!exists(...)` (implicit) **and** `request.resource.data.status == 'in-progress'`; update: owner and `number` unchanged | nobody | status transitions enforced client-side in a transaction; rules keep the number immutable |
| `dashboard`, `taskIntents`, `users`, `entity_*` | unchanged | unchanged | unchanged | HQ's own blocks — do not touch |

Rollback for any rules mistake is the same as 2026-08-03: redeploy the previous ruleset from HQ (old rulesets are retained server-side).

## 6. Master Job Log changes and the Apps Script

### 6.1 The log after Phase 1

- **One row per sheet, updated in place.** Rows are matched by a new **Sheet Key** column (the `fileKey`). A row that has no Sheet Key yet (every row written before Phase 1) is matched on exact `(Job, Sheet)` within the customer's tab and claimed (its Sheet Key is filled) on first contact — so jobs that were on the board at cutover don't get one more duplicate.
- **New columns go at the right-hand end only.** Standard header becomes 14 columns: `Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed Time, Operator, Final Notes, Archive Link, Customer, Invoice #, PO #, Sheet Key, Billed`. K and L already exist by hand on the Orville tab; the script fills any blank header cell K1–N1 on an existing tab, never inserts a column, never renames a tab or an existing header.
- **The Orville mirror (`Orville - Season 4!A:L`) is unaffected:** it keeps receiving rows, and now K (Invoice #) and L (PO #) are filled by the app instead of by hand. M and N are outside its range by design. The mirror stays Commenter-only.
- The Trio split (`Trio Flat Mount` / `Trio Flatmount`) is a one-time hand fix by Travis in Phase 1 (§11.1): the tab whose name matches the QuickBooks spelling keeps the rows; he cuts the other tab's rows into it and deletes the empty tab; Manage Customers is made to match the QuickBooks spelling. Nothing is renamed; the next export routes correctly by itself. Which spelling QuickBooks uses is an open question (§15).

### 6.2 Apps Script changes (`apps-script/logging-endpoint.gs` → hand-pasted by Travis)

⚠️ The repo file is a template with `PASTE_…` constants. The live script ("CNC Tracker Endpoint") has the real values **only there**. The plan must hand Travis a paste-ready block with his real constants substituted (recover them from the live editor, never from the repo), and he republishes with **Deploy → Manage deployments → ✎ → New version** (never "New deployment", which mints a new URL the app doesn't know).

New action **`upsertRows`** (replaces `appendRows` for the new client; `appendRows` stays for a shop tab that hasn't been hard-refreshed yet):

- Payload: `{ action: 'upsertRows', idToken, rows: [ { key, sheet, job, totalTime, toolpathCount, hasVbit, completedTime, operator, notes, archiveLink, customer, invoice?, po?, billed? } ] }`. Objects, not positional arrays, so a future column never shifts anything.
- Verifies the Firebase ID token (`verifyFirebaseIdToken`, already in the script) — this also closes the open 2026-08-18 gap for the log write path. Rows that carry `invoice`, `po` or `billed` are additionally accepted only from a uid in a new `OWNER_UIDS` constant (Travis, Eva); otherwise the action answers `{ok:false, error:'owner only'}` and writes nothing.
- Under the existing full-duration lock: resolve the customer tab (`findOrCreateCustomerTab`, unchanged), ensure headers K1–N1, then for each row: find by Sheet Key (col M); else by `(Job, Sheet)` with blank M; else append. Always write A–E, G, I, J, M. Column F (Completed Time) and H (Final Notes): if K (Invoice #) is empty, overwrite F and H; if K is set and the incoming `completedTime` differs from F, **keep F** and append `Re-cut <incoming date>` to H (so a billed row records the re-cut without moving the billed cut time). K, L, N are written only when the payload carries them.
- Reply `{ ok: true, updated: n, appended: m, claimed: k }`.

Everything else (`archiveSheet`, `appendRows`, token check, print-queue actions) unchanged. The `LOG_HEADER` constant grows to 14 entries so new tabs are created with the full header.

### 6.3 Who calls it

| Caller | Rows | Columns written |
|---|---|---|
| Collin's export (finish) | every sheet in the job | A–J, M (F/H per the rule above) |
| Billing "Imported OK" | every sheet on the invoice (upserting rows that don't exist yet — a partial bill can precede Collin's export) | full row + K, N |
| Billing "Add PO" | sheets on that invoice | L (and the rest of the row, harmlessly) |

Labor lines are not log rows (the log is a sheet log).

## 7. Screens

Building rule: **one file per screen; `app.js` only gains the hooks to open them.** Proposed files: `js/pricing.js` (pure math), `js/invoice-lines.js` (pluggable line types + CSV builder), `js/job-details.js` (upload step + job-card owner panel), `js/billing.js` (Billing + invoice + done), `js/settings.js`, `js/features.js` (the switch reader), `js/log-rows.js` (row builder shared by export and billing). Each screen is a `<section hidden>` in `index.html` toggled like the existing Ticket History / Manage Customers screens, plus a nav button that exists only when the switch for that owner is on.

### 7.1 Upload + job details (owners; Collin's upload screen is unchanged)

Design target: `Main.dc.html`.

- After the dropped files parse, for each **new** job name in the batch (no `jobBilling/{jobKey}` yet) a job-details step appears: the sheets list (name, size × thickness, toolpath count, Aspire time), total Aspire time, "no repeats found in this job" / "N repeats found"; then **Customer** (select from `customers/`, "Names match QuickBooks exactly", with the existing "Other…" add path), **Material** (radio: *Customer supplied — no material charge* / *Ours:* select from `settings/materials` showing `name — $price / sheet`), **Turnaround** (Standard / 48-hour rush +50% / 24-hour rush +75%), note "Design / CAM hours get added on the job card when the drawing is done", buttons **Add job to the board** / **Cancel**.
- Pre-fill: thickness is parsed from `materialInfo` (the line whose label contains "Thickness", else the last dimension of "Material Size"); material defaults to `customerBilling.defaultMaterialByThickness[thickness]` with the hint "*Picked for you: the last 0.75 in job for Northlight was customer supplied*", else to Customer supplied. Turnaround defaults to Standard. Confirming updates the customer's default for that thickness.
- Writes: `projectCustomer/{jobKey}`, `jobs/{jobKey}`, `jobBilling/{jobKey}`. Cancel removes the just-saved sheets of that job (they are unfinished and unbilled, so the delete rule allows it) — the same outcome as not uploading.
- Adding more sheets to a job that already has details → no step. Multiple new jobs in one drop → steps in sequence.
- If the switch `jobDetails` is off for this owner, upload behaves exactly as today and the job shows "Needs job details" in Billing until an owner fills them on the job card.

### 7.2 Job card — owner panel (Collin's sheet workspace is unchanged)

Design target: `JobCard.dc.html`. The existing content screen keeps its sidebar + detail layout for everyone; owners get an additional panel above it and tags on each sidebar row.

Header: job name; customer; chips **48-hour rush** / **Customer supplied** (or the material name); **Edit job details** (reopens the §7.1 form inline); "4 of 4 sheets cut" progress; the job-level chip **Not sent to billing yet** → **Ready for billing ✓**.

Sheet rows (owner view) gain: Aspire time; cut time + operator ("Thu Oct 1, 9:12 AM · Collin"); status (**Not cut yet / Cut / On invoice 3612 (in progress) / Billed · #3612**); tags **Weekend**, **Repeat of sheet 2**, **Re-cut Oct 6**. Clicking the cut time on a cut sheet lets an owner **correct the cut date** (writes `sheetBilling.cutDateOverride`; shown as "cut date corrected to Fri Oct 2"). A sheet that is `in-progress` or `billed` cannot have its date changed (it was priced).

**Design / CAM hours** panel: lines of *Type* (from `settings/laborTypes`, showing rate) · *Hours* (decimal) · *What it was for (prints on the invoice)*; "Saved by Travis · Oct 2. Rush applies to these hours too." A billed line is read-only with "Billed · #3612". Checkbox **No design time on this job**. Button **Done — ready for billing** (disabled until either at least one labor line or the checkbox; sets `readyForBilling`). Caption: "Cut sheets can still go on a weekly bill before this. Design hours wait for this button." A ready job can be reopened ("Edit — not ready yet") as long as its labor lines are unbilled.

Also on the owner panel for a finished job: **Open archived drawing** per sheet (its `archiveUrl`), and **Put back on the board** (§5.2).

### 7.3 Collin's export (finish) — behaviour spec, not mocked up

Button text stays **Export CSV** unless Travis prefers otherwise (§15). What it does now:

1. Customer: read `projectCustomer/{jobKey}`. If set, **no picker**. If missing (legacy job, or details switch off), the existing picker opens exactly as today and the answer is saved to `projectCustomer`.
2. CSV download: unchanged, 9 columns, same filename.
3. Ticket print + `ticketHistory` record: unchanged.
4. Log: `Endpoint.upsertLogRows(rows, idToken)` — one object per sheet (§6.2). On failure the existing honest alert ("Master Job Log was NOT updated: <reason>. The CSV still downloaded.") and the job is **kept on the board** unfinished so he can export again — identical to today's contract.
5. On success: **no delete prompt.** Each sheet gets `finished: true`, drawings cleared per §5.2, `jobs/{jobKey}.finished = true`. The job leaves the board for everyone; owners find it under Billing (and the Jobs board's "Show finished jobs" toggle, owners only).
6. Exporting the same job twice (e.g. the log failed the first time) updates the same rows; it can never append a second copy.

Sheets not yet cut at export time: allowed as today (the CSV has blank Completed At). They still get `finished: true`; if Collin later cuts one, the owner must "Put back on the board" first — in practice Collin exports when the job is done.

### 7.4 Billing (owners; layout B)

Design target: `BillingB.dc.html`.

**Top: unfinished-invoice reminder (amber).** One banner per `invoices/` doc with `status == 'in-progress'`: "*Invoice 3611 is still in progress · Copperline Stage · 2 sheets · downloaded Fri Oct 2. Did it import into QuickBooks?*" with **Imported OK**, **Cancel 3611**, and **Download again** (re-serves `invoice.csv`). Nothing on this screen can touch those sheets until one of the two is clicked.

**"Bill work cut through [date]"** box: date input defaulting to the most recent Saturday on or before today (`settings/invoicing.weekEndingDay`), caption "*Week ending Sat Oct 3. Sheets cut after it wait for next week's bill.*", and **Everything to date** (clears the filter). The date gates **cut sheets only** (effective cut date ≤ end of that day, local time); labor lines on a ready job are never date-gated (§15 asks Travis to confirm).

**The list:** every customer with `billedOutsideApp != true` that has anything billable, each as a card:

- Header: customer name; summary line ("2 jobs · 14 sheets cut Sep 29 – Oct 3 · 1 sheet cut Oct 4 waits for next week"); button **Bill Northlight · $1,865** (the priced total of everything selected below). No button when nothing is selected.
- One row per **ready job** with unbilled cut sheets within the date (or unbilled labor): name, detail ("10 sheets · 3 designs, 7 repeats · 3 h 09 m Aspire time · customer supplied" / "4 sheets · 48-hour rush · 1 weekend sheet · 1.5 design hrs"), per-job amount (unrounded, as the mockup shows $885.25 / $980.63). Included in the total by default.
- **Partly cut** job (not finished, some sheets cut): "*3 cut sheets ready ($268.00). The other 5 come later. Not in the total unless you add them.*" + **Add the 3 cut sheets** (toggles inclusion; design hours of that job are included only if the job is ready).
- **Waiting for job card** (all sheets cut, `readyForBilling` false): "*All 4 sheets cut, but the job card isn't marked ready for billing yet (design hours may still be coming). Not in the total.*" + **Bill the 4 cut sheets anyway** (adds the sheets only; labor comes later as its own row once Travis clicks Done).
- **Needs job details** (missing customer, material or turnaround): shown at the top of the screen in a red-bordered section with a link to the job card; not billable until fixed. A job with no customer cannot be grouped, so it appears in that section under "No customer".
- A customer whose only items are locked on an in-progress invoice or not yet cut shows dashed: "*Nothing ready — 2 cut sheets are on invoice 3611 (in progress), 4 still to cut.*"
- Sheets with `status == 'external'` never appear.

**Bottom: Recent invoices** (last 20 `imported` invoices: number, customer, date, total, PO) with **Add PO** per row — this is how a PO that arrives after the bill gets recorded in Phases 1–2 (the mockup's "from the archive" is Phase 3). Add PO writes `invoices.poNumber`, `sheetBilling.poNumber` for its sheets, and column L via `upsertRows`.

The screen prices live from `js/pricing.js` on every render; nothing is stored until the invoice is created.

### 7.5 Invoice screen (owners)

Design target: `InvoiceConfirm.dc.html`. Opened by "Bill <customer>".

Left: **What the customer is paying for** — the plain-words breakdown from the engine (handling first-of-design, handling repeats, cutting time, weekend, rush per job, design/CAM lines with their notes, "Rounded to the nearest $5", "Cut minimum" if applied, material or "Material — customer supplied $0.00") and **Total**.

Right, three numbered steps:

1. **Check the invoice number.** Input pre-filled with the suggestion = `max(number over all invoices/ docs, settings/invoicing.seedNumber) + 1`; "*Suggested 3612 — the last number used here was 3611. Check it's the next number in QuickBooks (VanLab invoices use the same numbers).*" Typing a number that exists as `imported` or `in-progress` shows red: "*3598 is already on Harbor Lane Pictures (Sep 24). Use another number.*" and disables step 2. A `cancelled` number may be reused with a soft note. **PO #** optional ("from the customer — add later"). Also shown: Invoice date (today) and Due date with quick picks **Due upon receipt** (default) / **Net 15** / **Net 30** plus an editable date — same as the estimator (§15.8).
2. **Download the QuickBooks file.** Two-line preview of what QuickBooks will see (e.g. "CNC Router Work — 14 sheets, rush, weekend $1,527.50" / "Digital Design — 1.5 h + rush $337.50"). Button **Download QuickBooks file for #3612**. On click, in this order: (a) one Firestore transaction creates `invoices/3612` (`in-progress`, full snapshot incl. `csv`), re-reads every selected `sheetBilling` doc and aborts if any is not `unbilled`/absent, sets them `in-progress` with `invoiceNumber`, and sets each selected labor line `in-progress`; (b) only if (a) committed, the browser download starts. If (a) fails because another owner got there first, the screen says so and returns to Billing. Caption: "*The file already has 3612 in it. The moment you download, these 14 sheets lock as Invoice 3612 — in progress, so nothing else can bill them. Then in QuickBooks: Sales › Invoices › Import, pick this file.*"
3. **Did it import into QuickBooks?** **Imported OK — mark 14 sheets billed** → transaction: invoice `imported`, sheets `billed` with `billedAt`, `cutAtBilled`, `priced`; labor lines `billed`; then `upsertRows` with K and N. If the log write fails the invoice stays `imported` (money state never depends on the log) with `logWritten: false`; Billing shows a small grey note on that invoice with **Retry log update**. **Cancel 3612** → invoice `cancelled`, sheets and labor lines back to `unbilled` (invoiceNumber cleared). Leaving the screen without choosing leaves the amber reminder on Billing. Eva never types the number back in.

### 7.6 Done (owners)

Design target: `Done.dc.html`. "*14 sheets billed on invoice #3612*" · customer and total · "Those sheets won't show up in billing again." · "The Master Job Log now has #3612 on all 14 rows." (or "The log could not be updated — retry from Billing") · "Add the PO number any time from Billing › Recent invoices when the customer sends it." Buttons: **Bill the next customer**, **Back to Jobs**. The cut report and archive buttons wait for Phase 3.

### 7.7 Settings (owners)

Cards, each a plain form saving to its `settings/*` doc, with "Saved by Eva · Oct 6" under each:

- **Prices** (per named list; only `standard` exists): first-sheet handling, repeat handling, hourly rate, rush %s, weekend %, cut minimum, round-to. A future "Add price list" button is out of scope but the layout leaves room.
- **Labor types**: name, rate, minimum hours, QuickBooks item.
- **QuickBooks**: item names (exact-match warning), taxable flags, due days, invoice seed number.
- **Materials**: name, thickness, price per sheet; add/remove.
- **Customers (billing)**: per customer from `customers/`: price list, **Billed outside this app** toggle, the remembered material defaults by thickness.
- **Screens on/off**: a grid of switches per screen (Job details at upload, Job card owner panel, Billing, Settings) × owner (Travis, Eva). Turning a switch off hides that screen for that owner on next render; it never changes data and never affects Collin. Settings itself cannot be switched off for the last owner who has it.
- **Maintenance**: the Phase 1 migration button (§11.1) with its status, idempotent.

### 7.8 Feature switches — behaviour

`settings/features = { jobDetails: { on: true, users: [TRAVIS_EMAIL] }, jobCard: {...}, billing: {...}, settings: { on: true, users: [TRAVIS_EMAIL] } }`. `js/features.js` reads the doc once after sign-in (and listens). A screen is shown iff `on && users.includes(currentEmail)`. If the doc cannot be read (Collin), every screen is off. If the doc does not exist yet (first owner sign-in after Phase 1 deploy), the app creates it with `settings` and `jobDetails` on for the signed-in owner only, so Travis can reach Settings to turn the rest on.

## 8. Pricing engine (`js/pricing.js`)

Pure functions, no DOM, no Firestore, no `Date.now()` (callers pass dates). Billing, the invoice screen and later the quick quote call it; **nothing else in the app does price math.** Testable with `node --test` like `svg-codec.js`.

### 8.1 Inputs

```
priceInvoice({
  priceList,            // settings/pricing.lists[name]
  laborTypes,           // settings/laborTypes
  jobs: { [jobKey]: { jobName, turnaround, material: { kind, name, pricePerSheet }, includeLabor: bool,
                      laborLines: [ { id, typeId, hours, note } ] } },
  sheets: [ { fileKey, jobKey, order, sheetLabel, totalTimeSec, toolpathCount, hasVbit, cutDate /* 'YYYY-MM-DD' local or null */ } ],
  priorBilled: [ { jobKey, signature, order } ],   // sheets of these jobs already billed on earlier invoices
})
```
`signature(sheet) = totalTimeSec + '|' + toolpathCount + '|' + (hasVbit ? 'V' : '-')`. `order` is the existing `compareSheets` position within the job. `hasVbit` uses the `VBIT_KEYWORDS` test that `exportJob` already uses for the log's "Has V-bit" column — it moves into `pricing.js` so both read the same rule.

### 8.2 Outputs

```
{ total,                               // what QuickBooks will show
  breakdown: [ { label, amount } ],    // the plain-words panel, in this order
  lines: [ { type, qbItem, description, quantity: 1, rate, amount, serviceDate, jobKeys } ],
  perJob: { [jobKey]: { cutBase, weekend, rush, laborBase, laborRush, material, subtotal } },
  perSheet: { [fileKey]: { handling, timeCharge, weekendPremium, repeatOf /* order of the first-of-design, or null */ } },
  minimumApplied, roundingAdjustment }
```
The `lines` array always sums exactly to `total`.

### 8.3 Formula, in order

1. **Repeats.** Within one job, sheets with the same signature form a design group. The group's *first* is the lowest-`order` sheet among those **already billed** (`priorBilled`) **or on this invoice**. If a prior-billed sheet exists in the group, every sheet on this invoice is a repeat. Otherwise the lowest-order sheet on this invoice is the first and the rest are repeats. Handling = `handlingFirst` ($60) for the first, `handlingRepeat` ($40) for each repeat. (Toolpath names and layout can sharpen the signature later without changing anything else.)
2. **Time.** `timeCharge = totalTimeSec / 3600 × hourlyRate` ($135/hr). `sheetCut = handling + timeCharge`.
3. **Weekend.** If the sheet's effective cut date is a Saturday or Sunday: `weekendPremium = sheetCut × weekendRate` (+50% of *that sheet's* cutting charge = handling + time). Material is never surcharged. A sheet with no cut date (not cut yet) is never on an invoice.
4. **Per job.** `cutBase = Σ sheetCut`; `cutWeekend = Σ weekendPremium`; `rush = cutBase × rush[turnaround]` (+50% / +75%; **on the base only — weekend premiums never feed rush and rush never multiplies weekend; the two do not compound**, exactly as the estimator has worked since 2026-08-24). `laborBase = Σ max(hours, minHours) × rate` for lines whose job `includeLabor` is true; `laborRush = laborBase × rush[turnaround]`. `material = kind == 'ours' ? pricePerSheet × (sheets of this job on this invoice) : 0`.
5. **Per invoice.** `cutPortion = Σ (cutBase + cutWeekend + rush)`; `laborPortion = Σ (laborBase + laborRush)`; `materialPortion = Σ material`.
6. **Rounding.** `rounded = round5(cutPortion + laborPortion)` to the nearest `roundTo` ($5). Material is added **after** rounding at exact cost (it is pass-through with no markup).
7. **Cut minimum.** If the invoice has at least one sheet: `minimumAdj = max(0, cutMinimum − round5(cutPortion))`. Material does not count toward the minimum (it pays for router setup; material is at cost). Labor has no minimum beyond `minHours`.
8. **Total.** `total = rounded + minimumAdj + materialPortion`.
9. **Lines** (consolidated, as the mockup and the estimator's "two lines" mode): 
   - `Materials — N sheets (names)` on `qbItems.materials`, amount `materialPortion`, only if > 0.
   - `CNC cutting — N sheets (Job A 10, Job B 4)[, 48-hour rush on Job B][, Weekend (+50%) on 1 sheet][, Cut minimum]` on `qbItems.cnc`, amount = `cutPortion + minimumAdj`, Service Date = latest cut date on the invoice.
   - One line per labor entry: `Design — <note> (1.5 hrs @ $150/hr)[ + Rush (+50%)]` on the type's `qbItem`, amount `laborBase_line + laborRush_line`.
   - **Reconcile:** `diff = total − Σ lines`; add `diff` to the CNC line (or the last labor line if there is no cutting). Amounts are rounded to cents; the reconcile makes them sum exactly. All quantities are 1 and `rate = amount` (Travis chose qty 1 in the estimator 2026-09-15).
   The breakdown panel shows the rounding as its own "Rounded to the nearest $5" line; the CSV absorbs it, as the estimator does.

### 8.4 Worked examples (mockup numbers; fake customers)

**Example A — NL_Bridge_Wall_Panels alone.** 10 sheets, 3 designs + 7 repeats, 3 h 09 m Aspire, standard, no weekend, customer supplied.
Handling 3 × 60 = 180.00 + 7 × 40 = 280.00 → 460.00. Time 3.15 h × 135 = 425.25. Cut 885.25. No rush, no weekend, no labor. `round5(885.25) = 885`. Minimum not triggered. **Total $885.00.** CSV: one line `CNC Router Work` $885.00. (BillingB shows the per-job unrounded $885.25 ✓.)

**Example B — NL_Corridor_Arches alone.** Sheets 2/3/4/5 = 12, 18, 9, 27 min, all unique designs, 48-hour rush, sheet 5 cut Saturday, Design 1.5 h @ $150, customer supplied.
Handling 4 × 60 = 240.00. Time 1.1 h × 135 = 148.50. cutBase 388.50. Weekend: sheet 5 cut = 60 + 0.45 × 135 = 120.75 → premium 60.375. Rush 388.50 × 0.5 = 194.25. Labor 225.00, labor rush 112.50. cut+labor = 388.50 + 60.375 + 194.25 + 225 + 112.50 = 980.625 → `round5` = 980. **Total $980.00.** Lines: Digital Design 337.50; CNC = 643.125 → reconciled to 642.50. (BillingB shows the per-job unrounded $980.63 ✓; JobCard "1 h 06 m" ✓; Main "no repeats found" ✓.)

**Example C — the mockup invoice: A + B on one invoice (Northlight, #3612).** cut+labor = 885.25 + 980.625 = 1,865.875 → `round5` = **$1,865.00** ✓ (InvoiceConfirm total). Breakdown: Handling 7 × $60 = 420.00 ✓ · Handling 7 repeats × $40 = 280.00 ✓ · Cutting 4 h 15 m × $135 = 573.75 ✓ · Weekend 1 sheet = 60.38 ✓ · 48-hour rush on Corridor Arches = 306.75 ✓ (194.25 + 112.50) · Design 1.5 h = 225.00 ✓ · Rounded −0.88 ✓ · Material $0 ✓. Lines: Digital Design 337.50 ✓; CNC Router Work = 885.25 + 388.50 + 60.375 + 194.25 = 1,528.375 − 0.875 rounding = **1,527.50** ✓. Every mockup number reconciles under the formula above, which also pins down two things the prose left implicit: a weekend sheet's "cutting charge" is handling **plus** time, and rush is charged on the base cut and on design but **not** on the weekend premium.

**Example D — cut minimum + our material (not in the mockup).** Ridgeway Vans, one sheet, 8 min, unique, standard, Tuesday, our 3/4 in Baltic birch at $95/sheet (made-up price).
Handling 60 + time 0.1333 × 135 = 18.00 → cut 78.00. `round5(78) = 80`. minimumAdj = 150 − 80 = 70. Material 95. **Total 80 + 70 + 95 = $245.00.** Lines: Materials 95.00; CNC cutting (Cut minimum) 78 + 70 = 148 → reconciled +2 → 150.00. Sum 245 ✓.

**Example E — Harbor Lane (BillingB).** 5 sheets, 2 designs + 3 repeats, 1 h 00 m: 120 + 120 + 135 = **$375.00** ✓ (already a multiple of 5).

**Not checkable:** BillingB's "NL_Stair_Rails · 3 cut sheets ready ($268.00)" gives no sheet times, so $268 cannot be verified (it is reachable, e.g. 1 design + 2 repeats + 56 m 53 s). Copperline's invoice 3611 shows no amount.

### 8.5 Differences from the estimator, stated so the port is deliberate

| Estimator today | This design |
|---|---|
| Simple $75 / Complex $175, repeat $60/$115 by tier, Production Run toggle | Handling $60 first / $40 repeat + $135/hr Aspire time; repeats detected automatically |
| Rush on cut subtotal **including material** | Rush never on material |
| Material inside the rounded + minimum-checked cut subtotal | Material added after rounding, excluded from the minimum |
| Weekend = 50% of the applied cut **rate** per sheet | Weekend = 50% of the sheet's handling + time |
| Minimum per quote (one customer's batch) | Minimum per invoice — same scope in practice; §15 asks whether Travis wants it per job |
| Labor minimum hours 1 h / 0.5 h seeds | `minHours` kept as a Settings field, default 0 — §15 |
| Rounding and the "no compounding" rule | Same |
| QuickBooks CSV columns and consolidated two-line layout | Same |

## 9. Pluggable invoice lines (`js/invoice-lines.js`)

An invoice is `lines[]` built by line-type builders registered in one place:

```
InvoiceLines.register('cutSheets', buildCutSheetLines);   // Phase 2
InvoiceLines.register('labor',     buildLaborLines);      // Phase 2
InvoiceLines.register('material',  buildMaterialLines);   // Phase 2
// later, in their own file: 'sanding', 'crating', 'hardware' (VanLab build)
```
`buildQuickBooksCsv(invoice, qbItems)` is ported from the estimator unchanged in shape: headers `Invoice No., Customer, Invoice Date, Due Date, Item(Product/Service), Item Description, Item Quantity, Item Rate, Item Amount, Taxable, Service Date`; dates `MM/DD/YYYY`; `Taxable` from `settings/qbItems.taxable` per line type; UTF-8 BOM; filename `QuickBooks Exports_<customer>_<number>.csv` (Chrome flattens any slash to `_`, confirmed 2026-07-27 — don't fight it). The invoice number is inside the file, which is why the number is chosen **before** the download.

## 10. The Master Job Log row builder (`js/log-rows.js`)

One function builds the §6.2 row object from `(sheet, completion, customerName, billing?)`. Collin's export and Billing's write-back both call it, so the two can never disagree on a column.

## 11. Migration and rollout

Each phase: plan → build in a worktree (master auto-deploys) → Fable whole-branch review → Travis's go → push → Pages build confirmed `built` → **shop PC Ctrl+Shift+R** → live check. Implementers run on Sonnet.

### 11.1 Phase 1 — keep every sheet, job details, Eva, Collin-sees-nothing

Ships: §5 collections and rules (except `invoices`, which can ship now empty), §5.2 sheet changes, §6 Apps Script `upsertRows`, §7.1 upload step, §7.2 owner panel (without billing statuses, which are all "unbilled"/"Cut"), §7.3 export, §7.8 switches, `settings/features` + the Settings screen's switches and Maintenance cards only (full Settings is Phase 2). No pricing, no Billing screen.

Order of operations (each a visible step, Travis says go):

1. **Eva's account:** Travis creates her Firebase Auth user (console); confirms her sign-in email for the allowlist.
2. **Rules first (HQ repo):** add Eva to the existing four allowlisted collections; add every new collection from §5.9 (they are empty, so this is safe before any code). Deploy from HQ. Verify the deployed text contains all 13 Job Tracker collections (the 2026-08-19 lesson).
3. **Apps Script:** Travis pastes the new `upsertRows` block into the live script with his real constants, adds Eva's uid to `ALLOWED_UIDS` and both owner uids to `OWNER_UIDS`, republishes as a new version of the existing deployment. The old client's `appendRows` keeps working meanwhile.
4. **Trio consolidation** (hand step, Travis, after §15 answers which spelling QuickBooks uses).
5. **Code deploy.** Switches default: `settings` + `jobDetails` on for Travis only. Collin's screens unchanged; the board listener still loads **all** sheets until step 6.
6. **Migration (Settings › Maintenance › "Mark existing sheets as on the board"):** stamps `finished: false` on every `sheets/` doc lacking the field, in batches of 500, writes `settings/migrations.sheetsFinishedFlag`. Idempotent. Then the listener switches to `where('finished','==',false)` (the code reads the migration flag and uses the filtered query only once it is set, so the deploy order can't drop sheets).
7. Travis fills job details for jobs already on the board (Billing's "Needs job details" list doesn't exist yet, so the owner panel shows a "Needs details" chip on each board card).
8. Shop PC hard refresh. Collin's next export: CSV, ticket, **one row per sheet, no delete prompt**, job leaves the board. Travis checks the log tab: rows present once, Sheet Key filled, K/L untouched.
9. Turn `jobDetails`/`jobCard` on for Eva; she signs in and checks a job card.

**Backfill decision (open, §15):** whether to create `sheetBilling` records (status `billed`, invoice # from column K) for log rows of jobs exported before Phase 1, so Phase 3's archive is complete. Recommendation: **not in Phase 1 or 2.** Old jobs were deleted from Firestore at export; only the log knows them, the Phase 0 audit has to clean that history first, and nothing in Phases 1–2 bills retroactively. If yes later, it is a read-the-log-tab → write-`sheetBilling` script run once by an owner, and it fits Phase 3.

Rollback: switches off (owners see the old app); rules redeploy of the previous ruleset; Apps Script previous version. Finished sheets stay finished (they are also in the log); nothing is lost.

### 11.2 Phase 2 — billing screen B, pricing, Settings, invoices, QuickBooks CSV, write-back

Ships: `js/pricing.js`, `js/invoice-lines.js`, §7.4–7.7, `invoices/` writes, `settings/*` seeds.

1. Deploy with `billing` off for everyone. Travis opens Settings, checks the seeded prices, enters labor rates, QuickBooks item names (exact), due days, invoice seed (the last QuickBooks invoice number), materials; flags VanLab and Golden Boys **Billed outside this app**.
2. `billing` on for Travis. He reviews the list against what he knows is unbilled; he prices one small real invoice and compares to a hand calculation; imports it into QuickBooks himself; confirms the log row shows the number.
3. `billing` on for Eva. She bills one real invoice end to end; Travis imports and confirms. That is the acceptance test the plan ends with.
4. The Estimating App stays for anything this doesn't cover yet (VanLab until its build); nothing is removed from it.

## 12. Testing

Standing rules: never against the real `firebase-config.js` / `endpoint-config.js` — PASTE-mode copies with **both** files blanked; log changes against a **copy** of the Master Job Log through a scratch script deployment, exercised with browser-console `fetch` (curl does not work against Apps Script from this PC); every push is a live deploy, ask first.

### 12.1 Money tests (`test/pricing.test.mjs`, `node --test`)

- A fixture-builder script reads `G:\My Drive\CSV Exports\*.csv` **read-only** (never write into that folder — an Apps Script once ate files there) and writes `test/fixtures/pricing/*.json` with customer and job names replaced by fake ones (Northlight Studios, Harbor Lane Pictures, Copperline Stage, Ridgeway Vans). Sheet titles, times, toolpath counts, V-bit flags and completion dates are real. The fixtures are committed; the raw CSVs are not.
- Pinned cases (hand-computed once, written into the test as literals): a heavy-repeat job (e.g. the four identical 15:09 sheets pattern), an all-unique job, a job spanning a weekend cut date, a job with V-bit vs non-V-bit sheets of equal time (must **not** be repeats), a legacy 8-column CSV (no customer), a one-sheet minimum case, a two-job invoice with rush on one job, a partial bill followed by the rest (first-of-design must not be charged twice), a prior-billed design (all repeats on the second invoice). Plus Examples A–E from §8.4 verbatim.
- Invariants checked on every fixture: `Σ lines == total`; `total` is a multiple of 5 plus material; no line negative; changing `priceList` numbers changes totals (guards against a hardcoded constant).
- **Weekday fixture trap:** ISO strings parse as UTC and shift a weekday in US zones; fixtures carry local `YYYY-MM-DD` cut dates, and the engine takes dates, not timestamps.

### 12.2 Rules tests

`@firebase/rules-unit-testing` against the Firestore emulator, loading `HQ/firestore.rules` (the test lives in HQ, where the rules file is). Matrix: Collin read `sheetBilling`/`jobBilling`/`invoices`/`settings`/`customerBilling` → denied; Collin write `sheets.finished` → allowed; Collin delete a finished sheet → denied; owner delete a billed sheet → denied; owner delete an unbilled active sheet → allowed; Eva read/write `customers`, `printQueue` → allowed; create `invoices/3612` twice → second denied; update `invoices/3612.number` → denied; unknown email → everything denied.

### 12.3 Log-copy tests (scratch script + a copy of the Master Job Log)

Upsert new → appended with 14 columns; upsert same key → updated in place, no new row; legacy row `(Job, Sheet)` with blank M → claimed; row with invoice from an owner uid → K/N written; same from Collin's uid → refused, nothing written; billed row re-exported with a different Completed Time → F unchanged, H gets "Re-cut …"; tab without K–N headers → headers filled, nothing inserted; `Orville - Season 4!A:L` mirror formula on the copy still returns the same columns.

### 12.4 Screen tests (Playwright against a PASTE copy, as in the print-queue work)

Upload step appears for owners only (stub the features read); job card panel; Billing grouping and the date filter; the invoice flow's lock-before-download order (download must not fire if the transaction stub rejects); Imported OK / Cancel; `node --test` for `log-rows.js` and `invoice-lines.js` (CSV byte-exact against a fixture).

### 12.5 Live acceptance

Phase 1: Collin's real export → one row per sheet, job leaves board, no delete. Phase 2: Eva bills one real invoice, Travis imports it into QuickBooks, confirms item names landed on `CNC Router Work` / `Digital Design`, invoice number shows in the log and on the Orville mirror.

## 13. Risks

| Risk | Mitigation in this design |
|---|---|
| Firestore listener growth once sheets are never deleted | `finished` filter on the board listener; drawings stripped at finish; completions are tiny |
| A rules redeploy from HQ drops a Job Tracker collection again | The §5.9 table is the checklist; the review diffs deployed text; rules tests in HQ |
| Apps Script paste wipes the live constants | Paste-ready block with real values; "New version", never "New deployment" |
| Weekend misdetected by time zone | Effective cut date computed as local `YYYY-MM-DD`; owner override on the job card |
| Two owners bill the same sheets | Invoice create + sheet lock in one transaction that re-reads status |
| QuickBooks already used the suggested number for a VanLab invoice | The number is a suggestion; the app refuses only its own used numbers; Eva checks QuickBooks; Cancel frees everything |
| Partial billing charges a design's $60 twice | First-of-design rule includes prior-billed sheets |
| Stale shop tab after deploy | Old client calls `appendRows` (still served); hard refresh is in the runbook; duplicates can only happen until that refresh |
| Collin's Clear on a billed sheet | Billing never reads `completions` for billed sheets except to show "re-cut"; the script freezes F when K is set |
| Eva locked out of print queue / lookups | Her uid in `ALLOWED_UIDS` is a Phase 1 step |
| Settings edited mid-invoice | Invoice snapshots the price list; a change affects only invoices created after it |
| `jobDetails` switch off → jobs with no details reach Billing | "Needs job details" section blocks them; the export picker fallback keeps Collin unblocked |
| Memory/clobber between concurrent Claude sessions | Not a runtime risk; noted for the build process (worktrees) |

## 14. Where things live after this ships

- Sheet record (§5.1) → repo `CLAUDE.md` (Phase 1 task), replacing the stale "Storage" bullet list there.
- Rules → `HQ/firestore.rules` (+ the HQ rules test).
- Apps Script → repo template `apps-script/logging-endpoint.gs` (placeholders) and the live script (real values); the paste-ready block is handed to Travis in the session, never committed with real values.
- Status and history → `Brain/Projects/Studio Billing Redesign.md` (the vault note keeps its name).

## 15. Decisions on the open questions (Travis, 2026-10-04)

1. **Backfill history from the log:** no in Phases 1–2; revisit at Phase 3 after the Phase 0 audit (§11.1).
2. **Design / CAM rates:** Design $150/hr, CAM $85/hr, **keeping the estimator's minimum-hours floor** (1 h Design / 0.5 h CAM) as the seeded `minHours` — same as the estimator, editable in Settings › Labor types. (§8.3 step 7 "Labor has no minimum beyond `minHours`" stands; the seed is no longer zero.)
3. **Cut minimum:** per invoice, as written. Material does not count toward it.
4. **"Ready" vs weekly partial bills:** as written — design hours go on the next bill once the job card is marked Done, regardless of the "cut through" date; cut sheets are gated by the date.
5. **Collin's export button:** keep "Export CSV". Nothing new for him.
6. **Eva's sign-in email:** STILL OPEN — Travis will provide it. Blocks only Phase 1 rollout step 1–3 (§11.1) and Eva's switches; nothing else waits on it. Never guess it.
7. **Trio spelling:** QuickBooks uses **`Trio Flatmount`**. That tab keeps the rows; Travis moves `Trio Flat Mount`'s rows into it by hand and deletes the empty tab; Manage Customers says `Trio Flatmount`.
8. **QuickBooks seeds:**
   - **Next invoice number is 3604** → `settings/invoicing.seedNumber = 3603` (last used), so the first suggestion is 3604.
   - **Due date — same setup as the estimator:** the invoice screen offers quick picks **Due upon receipt** (default, today + 0), **Net 15**, **Net 30**, plus an editable date. Replaces the single `dueDays` default in §7.5 step 1 and Settings › QuickBooks (Settings holds the default pick: Due upon receipt).
   - **Material taxable:** not taxable by default, with a per-material **Taxable** toggle in Settings › Materials (written to the QuickBooks "Taxable" column for that line). Service lines stay non-taxable per the Golden Boys tax rule.
