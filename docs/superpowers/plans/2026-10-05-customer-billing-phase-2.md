# Customer Billing — Phase 2 (Billing screen B, pricing engine, invoices, QuickBooks CSV, full Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eva (Travis as backup) opens **Billing**, sees one ready-to-bill list grouped by customer, clicks **Bill <customer>**, checks the suggested invoice number, downloads a QuickBooks CSV (the sheets lock as "Invoice N — in progress" *before* the file is served), imports it into QuickBooks, clicks **Imported OK** — sheets and design hours are marked billed, the Master Job Log rows get the invoice number, and nothing can ever be billed twice.

**Architecture:** Money math lives in exactly one function, `Pricing.priceInvoice()` in `js/pricing.js` (pure, no DOM / Firestore / clock). `js/invoice-lines.js` turns a priced result into QuickBooks lines (words, item names, Taxable) and the CSV — no arithmetic beyond what pricing returned. `js/billing-model.js` (pure) turns sheets + completions + owner records into the Billing list and the invoice draft. `js/invoice-store.js` owns `invoices/` and the three money transactions (lock-and-create, Imported OK, Cancel) plus Add PO and the log write-back; each transaction's decision logic is a pure *planner* so it is unit-tested without Firestore. `js/storage-owner.js` switches every `jobBilling` / `sheetBilling` / `customerBilling` / `settings` write from "whole doc from cache" to a read-modify-write **transaction** (Phase 1 must-fix). Screens, one file each: `js/billing.js` (Billing B + Recent invoices + amber reminders), `js/invoice-screen.js` (the three steps), `js/billing-done.js` (Done); `js/settings.js` gains the Phase 2 cards. `js/app.js` gains only hooks. Firestore rules (HQ repo) harden `invoices/` and `sheetBilling/` state transitions.

**Tech Stack:** Vanilla JS IIFE modules with the `module.exports` shim, Firestore compat SDK 10.12.0, Firebase Auth, Apps Script (unchanged in Phase 2 — `upsertRows` already accepts invoice / po / billed from owner uids), `node --test` (Node 24), Firestore + Auth emulator via HQ (`npx firebase emulators:exec`), Playwright and the Firebase compat SDK loaded from `HQ/node_modules`.

**Spec:** `docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md` — this plan implements **Phase 2 only** (§11.2): §7.4 Billing B, §7.5 Invoice, §7.6 Done, §7.7 Settings, §8 pricing, §9 invoice lines + QuickBooks CSV, `invoices/` writes, `settings/*` seeds, write-back to the Master Job Log via `upsertRows`. Read with §3, §4, §5, §10, §12, §13 and the §15 decisions (settled — not re-opened here).

**Phase 1 model:** `docs/superpowers/plans/2026-10-04-customer-billing-phase-1.md` (format, rigor, rollout style). Phase 1 build ledger: `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign - Phase 1 build ledger.md`.

**Build model split (Travis, 2026-10-04, recorded in the vault note):** Sonnet implements every task; Opus reviews each task; **Fable only for the final whole-branch review (Task 19), and the controller asks Travis before dispatching it.** This plan was written on Opus.

---

## Decisions (Travis, 2026-10-05)

All seven questions are settled. Every task below is written to these answers; nothing here is re-opened during the build.

1. **Billing starts on — YES.** Settings › Invoicing gets a **"Billing starts on"** date. Sheets cut before it, and design hours entered before it, never appear in Billing (they were billed the old way). Travis sets it to the day after the last week he billed the old way. *(Tasks 6, 11, 12.)*
2. **One open invoice per customer — YES.** While a customer has an invoice in progress (downloaded, not yet Imported OK or Cancelled), Billing will not start another for that customer; the card says "Finish invoice NNNN first (Imported OK or Cancel)". *(Tasks 8, 11, 14.)*
3. **No charge per sheet — YES.** An owner-only **No charge** link on each cut sheet of the job card, with **Undo** while the sheet is not on an invoice (status `external`). Collin sees nothing. *(Tasks 6, 7.)*
4. **ONE combined Materials line per invoice** — `Materials — N sheets (names)`, exactly as spec §8.3 step 9. The per-material **Taxable** switch stays in Settings › Materials; the single line's Taxable is that shared value. If the materials on one bill would disagree on Taxable, the app does not guess: the Bill button is replaced by "Materials on this bill are taxed differently — bill those jobs separately." (Travis's materials are all taxed the same way, so this should never show.) *(Tasks 3, 5, 14.)*
5. **Billed column (N) = `Y`.** *(Task 8.)*
6. **Customer change** — locked once anything from the job is on an invoice (in progress or billed). Before that, after Collin's export, it is allowed with the warning "The Master Job Log rows for this job stay on the <old> tab — move them by hand." *(Task 7.)*
7. **Design/CAM minimums apply PER JOB, per labor type** (changes the estimator's per-line rule): add up a job's hours for each type first, then apply that type's `minHours` once (Design 1 h, CAM 0.5 h, each separately). Two 0.5 h Design lines on one job bill 1 h; one 1.5 h line bills 1.5 h; Example B is unchanged ($980.00). **Presentation:** still one invoice line per labor entry (its note prints); if a type's hours on a job fall short of the minimum, the shortfall is added to the **last entry of that type on that job** — that line's billed hours include the top-up and its description says so: `Design — Layout tweaks (1 hr @ $150/hr, includes 1-hr minimum)`. Σ lines = total is unaffected (the reconcile step still runs). *(Tasks 2, 3, 5, 7.)*

---

## Global Constraints

- **Never run the app against the real config.** Every browser check runs from a temp copy with BOTH `js/firebase-config.js` → `const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };` and `js/endpoint-config.js` → `const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };`. Transactions and rules are tested only in the **Firestore emulator** (Task 10 refuses to run unless `FIRESTORE_EMULATOR_HOST` is set). The Master Job Log is never written by a test; the write-back uses the existing `upsertRows` already proven on a log COPY in Phase 1 (H3a) — Phase 2 adds no Apps Script change.
- **`master` is a live deploy** (GitHub Pages, no build step). All work happens in the git worktree `.worktrees/customer-billing-phase-2` on branch `customer-billing-phase-2`; HQ rules work in `HQ/.worktrees/jt-billing-phase-2` on branch `jt-billing-phase-2`. **No task pushes, merges or deploys.** Merge/push and the rules deploy are Travis-approved hand steps.
- **Collin's screens do not change.** Nothing new renders unless `Features.on('<screen>')` is true (never `Features.isOwner()` alone — ruling P23). Billing ships with the `billing` switch **off for everyone** (Phase 1 already seeds it off). Collin's account cannot read `invoices/`, `sheetBilling/`, `jobBilling/`, `customerBilling/` or `settings/*` (except `settings/migrations`) — rules, not UI, are the guarantee.
- **Money math lives only in `Pricing.priceInvoice()`.** No other file multiplies a rate, applies a percentage, rounds to $5 or reconciles lines. `invoice-lines.js` formats; `billing-model.js` selects; screens display. Grep check in Task 19.
- **Money tests use the spec's worked examples (§8.4) with FAKE names** (Northlight Studios, Harbor Lane Pictures, Copperline Stage, Ridgeway Vans; jobs `NL_Bridge_Wall_Panels`, `NL_Corridor_Arches`, …). No real customer, show or job name is ever committed. Fixture JSON keeps only times, toolpath counts, V-bit flags and cut dates.
- **No real emails, uids, tokens or spreadsheet ids in this repo** (it is public). Use `<travis-account-email>`, `<eva-account-email>`, `<collin-account-email>` placeholders. Scripts that need the real allowlist (Task 10) parse it out of `HQ/firestore.rules` at run time and never print it.
- **Firestore traps (still true):** an equality `where` drops docs missing the field; `where` + `orderBy` on different fields needs a composite index that fails only in production — never combine them (Phase 2 uses `orderBy('number','desc').limit(n)` alone, or `where('status','==',…)` alone); a collection with no rules block is denied; compat `get()` resolves from cache offline (treat `metadata.fromCache` as "not loaded"); `storage.js` writers swallow errors (owner writers must not).
- **Transactions:** every function passed to `runTransaction` must be pure (it can run up to 5 times). All reads before any write. Max 500 writes per transaction → an invoice is capped at **400 sheets** (the screen refuses more with a plain message).
- **Script cache-busting:** every modified JS/CSS file's `?v=` in `index.html` is bumped — `pricing.js?v=2`, `log-rows.js?v=2`, `storage.js?v=17`, `storage-owner.js?v=2`, `settings.js?v=2`, `job-details.js?v=2`, `job-card.js?v=2`, `app.js?v=36`, `style.css?v=25`; new files `?v=1`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **One file per screen.** `js/app.js` gains only hooks (nav button, screen toggles, the open-a-job hook, InvoiceStore init). Anything else in `app.js` is a review finding.

## Phase 1 must-fix carry-over → where each lands

| Carry-over (ledger) | Lands in |
|---|---|
| `jobBilling` / `sheetBilling` writes rebuild the whole doc from the cache → must become merge/transaction | **Task 6** (all owner writers become transactions), **Task 7** (job card + job details switch to them) |
| `invoices/` update rule must keep `createdAt` immutable (an owner bug could overwrite an imported invoice) | **Task 1** (rules: `number`, `createdAt`, `createdBy` immutable; allowed status transitions; imported invoices frozen except PO/log fields) |
| "Needs job details" must ignore sheetless `jobs/` docs | **Task 11** (the list is built from sheets, never from `jobs/`; explicit test) |
| Invoice number = document id, so repeats are impossible | **Task 1** (rules) + **Task 8/9** (lock transaction refuses a used id; reuse of a cancelled number keeps the original `createdAt`) |
| Billing data stays in owner-only collections Collin cannot read | **Task 1** (rules matrix), **Task 10** (emulator: Collin denied on every new write path), **Task 17** (Collin's screens unchanged) |
| Late "Add line" write after switching jobs clears the other job's inputs (Final review, parked to Phase 2) | **Task 7** |
| "No wording for the `external` status" (Task 12 minor) | **Task 7** |
| `loadFinishedSheets` swallows failures into `[]` (Task 6 minor) | **Task 14** (Billing uses a strict variant and says "couldn't load finished jobs") |
| Customer re-tag leaves old-tab log rows (Task 5 minor) | **Task 7** (Decision 6) |
| Time-less sheets share signature `0|n|-` (Task 2 minor) | **Task 2** (a 0-second sheet is never grouped as a repeat; Billing tags it) |

**Not in scope (parked by Travis 2026-10-05 — do not build):** owner Put back returning sheets to Incomplete; Collin's empty board not auto-switching to Projects; the HQ Jobs tile reading all of `sheets`. **Never build** any "bill the re-cut again" feature: a re-cut is never re-billed (the job card shows a "Re-cut" tag only); a redesign or paid repeat is a new file name = a new sheet.

## Review Focus

Inputs the spec implies but no screen mockup shows; each is pinned to a test.

1. **Two owners click Download for overlapping sheets at the same moment** → exactly one invoice is created; the other gets "these sheets were just put on invoice N" and **no file downloads** — Task 9 (fake Firestore contention) + Task 10 (real emulator).
2. **The file must never download unless the lock committed** → Task 15 (screen code order) + Task 17 (Playwright: a rejected lock fires no download event).
3. **Data changed between render and click** (Collin re-cut a sheet, Travis corrected a cut date or added hours) → the lock transaction compares a fingerprint and refuses with "Something changed — check the total and click again" — Task 8 planner test + Task 9.
4. **Partial bill, then the rest of the job** → the design's $60 is charged once — Task 2 test "partial then rest".
5. **A re-cut after billing** → never on a later invoice; the log keeps the billed cut time — Task 11 test "billed sheet with a new completedAt is excluded" + Task 8 test (log rows use the cut time frozen at lock).
6. **The log write fails at Imported OK** → the invoice is still `imported` (money never depends on the log), `logWritten:false`, Billing shows **Retry log update** — Task 9 + Task 17.
7. **Settings edited mid-invoice** → the invoice snapshots the price list, labor types and QuickBooks items it used; a later edit changes only later invoices — Task 8 (`settingsSnapshot`), Task 16 (Download again serves the stored CSV byte-for-byte).

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `HQ/firestore.rules` (HQ repo) | modify | `invoices/` and `sheetBilling/` transition rules; `createdAt` immutable |
| `HQ/.verify/verify-cnc-billing-rules-p2.js` (HQ) | create | Phase 2 rules matrix (emulator) |
| `HQ/.verify/verify-cnc-billing-rules.js` (HQ) | modify | one fixture line: the invoice create now carries `createdAt`/`createdBy` |
| `js/pricing.js` | modify | `signatureOf`, `round2`, `roundToStep`, `TURNAROUND_LABEL`, **`priceInvoice()`** |
| `js/invoice-lines.js` | create | Line-type registry (`cutSheets`, `labor`, `material`), `finalize()`, `buildQuickBooksCsv()`, `downloadName()`, due-date helpers |
| `js/log-rows.js` | modify | `withBilling(row, billing)` |
| `js/storage.js` | modify | `loadFinishedSheets({ strict })` — throws instead of `[]` when asked |
| `js/storage-owner.js` | modify | transactional writers (`mutateJobBilling`, `mutateSheetBilling`, `mutateCustomerBilling`, `setSetting`), Phase 2 seeds, `pricing()`, `qbItems()`, `invoicing()`, `priceListFor()`, `setNoCharge()`, `_putLocal()` |
| `js/invoice-store.js` | create | `InvoiceStore`: invoice cache/listeners, number suggestion/check, planners + executors for lock / import / cancel / add PO, log write-back |
| `js/billing-model.js` | create | Pure: Billing list, row states, through-date, pricing input, invoice draft + fingerprint |
| `js/billing.js` | create | Billing screen B: reminders, through-date box, Needs job details, customer cards, Recent invoices + Add PO + Retry log |
| `js/invoice-screen.js` | create | Invoice screen: breakdown, steps 1–3 |
| `js/billing-done.js` | create | Done screen |
| `js/settings.js` | modify | Prices, Labor types, QuickBooks, Invoicing, Materials cards; Customers card gains price list + remembered defaults; `module.exports` for its pure validators |
| `js/job-card.js` | modify | transactional writes, labor-type empty state, "min 1 h per job", No charge, external wording, add-line race fix |
| `js/job-details.js` | modify | transactional save, material taxable snapshot, rush labels from settings, customer-change guard, materials hint |
| `js/app.js` | modify | hooks only: Billing button, three screens in `hideAllScreens`/`showLoginScreen`, `rerenderCurrent`, `applyFeatureNav`, `ownerHomeOnEmpty`, `openJobFromBilling`, InvoiceStore init |
| `index.html` | modify | `#billing-btn`, `#billing-screen`, `#invoice-screen`, `#billing-done-screen`, Settings cards, script tags, `?v=` bumps |
| `css/style.css` | modify | `.billing-*`, `.invoice-*`, `.done-*`, settings form rows |
| `tools/build-pricing-fixtures.mjs` | create | Reads `G:\My Drive\CSV Exports\*.csv` READ-ONLY → `test/fixtures/pricing/*.json` with fake names |
| `tools/emulator-check-phase2.mjs` | create | Runs OwnerStore + InvoiceStore against the emulator with HQ's rules |
| `tools/browser-check-phase2.mjs` | create | Playwright pass in PASTE mode |
| `test/helpers/fake-firestore.cjs` | create | In-memory Firestore compat stand-in with transaction contention (node --test also loads it; it defines no tests) |
| `test/pricing-invoice.test.mjs`, `test/pricing-lines.test.mjs`, `test/pricing-fixtures.test.mjs`, `test/invoice-lines.test.mjs`, `test/storage-owner-tx.test.mjs`, `test/invoice-store.test.mjs`, `test/invoice-store-exec.test.mjs`, `test/billing-model.test.mjs`, `test/settings-validate.test.mjs` | create | per task |
| `test/fixtures/pricing/*.json` | create | committed fixtures (fake names) |
| `test/storage-owner.test.mjs`, `test/job-card.test.mjs`, `test/log-rows.test.mjs`, `test/pricing-helpers.test.mjs` | modify | per task |
| `CLAUDE.md`, spec status line, vault note | modify | Task 18 |

## Travis hand steps (not code) — where they fall

Phase 2 hand steps are numbered **B1–B9** so they never collide with Phase 1's H1–H9.

| # | Step | When | Blocked by |
|---|---|---|---|
| B1 | ~~Answer the 7 Open questions~~ — DONE 2026-10-05 (see Decisions) | — | — |
| B2 | Deploy the Phase 2 rules from HQ; check the deployed text | After Task 1 review + Task 10 PASS, **before B4** | — |
| B3 | Check QuickBooks facts: exact item names (Products and Services), last invoice number used, which materials are taxable | Any time before B6 | — |
| B4 | Merge + push (go-live skill); Pages `built`; live serves `app.js?v=36`; shop PC + every open tracker tab Ctrl+Shift+R | After Task 19 | Travis's go; Phase 1 H8 done (recommended) |
| B5 | First sign-in → Settings: check every Phase 2 card; set invoice seed, Billing starts on, materials; flag VanLab, Golden Boys and the `ZZTEST` test customer **Billed outside this app** | After B4 | — |
| B6 | Phase 0 double-billing audit result seen (spec prerequisite) | Before B7's real invoice | The `Orville - Season 4` CSV download (vault Next Actions) |
| B7 | Billing on for Travis; review the list; one small real invoice end to end (hand-check the total, import into QuickBooks, Imported OK, check the log) | After B5, B6 | — |
| B8 | Eva: Phase 1 H1/H9 first (her account, rules lists, `ALLOWED_UIDS` + `OWNER_UIDS`), then Billing on for her | After B7 | **Eva's sign-in email (open)** |
| B9 | Acceptance: Eva bills one real invoice end to end; Travis imports it and confirms | After B8 | B8 |

Exact clicks for each are in the **Rollout checklist** at the end.

---

### Task 0: Answers gate, worktrees and baseline (controller step)

**Files:** none changed.

- [ ] **Step 1: Decisions into the ledger.** Copy the seven Decisions (Travis, 2026-10-05) into the Phase 2 ledger (`G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign - Phase 2 build ledger.md`, new file, same format as Phase 1's) so every dispatch brief can cite them.

- [ ] **Step 2: CNC worktree** (from the main checkout; `.worktrees/` is gitignored):

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git status --short | head -5                     # this plan file is untracked here; commit it on the branch in Step 4
git worktree add .worktrees/customer-billing-phase-2 -b customer-billing-phase-2 master
cd .worktrees/customer-billing-phase-2 && npm test 2>&1 | tail -8
```

Expected: `ℹ tests 256` / `ℹ fail 0` (baseline at `ec0e150`). Every later task runs from this worktree. After each implementer reports DONE, run `git -C .worktrees/customer-billing-phase-2 log --oneline -1` and confirm the commit is on `customer-billing-phase-2`, not `master` (memory: a Phase 1 implementer once committed to master by cwd mismatch).

- [ ] **Step 3: HQ worktree** (Phase 1 ruling: a worktree, never `git checkout -b` in the main HQ folder):

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/HQ"
git status --short | head -3 && git log --oneline -1          # expect master at or after 6e0eb1e
git worktree add .worktrees/jt-billing-phase-2 -b jt-billing-phase-2 master
cmd //c mklink /J ".worktrees\\jt-billing-phase-2\\node_modules" "node_modules"
```

(`.worktrees/` is already in `HQ/.git/info/exclude` from Phase 1; check with `grep worktrees .git/info/exclude`.)

- [ ] **Step 4: Commit the plan on the branch.** Copy this plan file into the worktree's `docs/superpowers/plans/`, `git add` + commit (`docs: customer billing phase 2 plan`). Before B4's merge, delete the untracked copy in the main checkout or git refuses the merge (Phase 1 ledger lesson).

---

### Task 1: Firestore rules — invoices and sheetBilling transitions, createdAt immutable (HQ repo)

**Files:**
- Modify: `HQ/.worktrees/jt-billing-phase-2/firestore.rules` (the `sheetBilling` and `invoices` blocks only)
- Create: `HQ/.worktrees/jt-billing-phase-2/.verify/verify-cnc-billing-rules-p2.js`
- Modify: `HQ/.worktrees/jt-billing-phase-2/.verify/verify-cnc-billing-rules.js` (one fixture line)

**Interfaces:** Produces the rule contract every later task relies on:
- `invoices/{n}`: create only `status == 'in-progress'`, `string(number) == n`, `createdAt is number`, `createdBy is string`. Update: `number`, `createdAt`, `createdBy` never change; allowed transitions **in-progress → in-progress | imported | cancelled**, **cancelled → in-progress** (re-use of a cancelled number), **imported → imported** only touching `poNumber, poAddedAt, poAddedBy, logWritten, logError, logWrittenAt, updatedAt, updatedBy`; in-progress → imported touches only `status, importedAt, importedBy, updatedAt, updatedBy`; in-progress → cancelled only `status, cancelledAt, cancelledBy, updatedAt, updatedBy`. Delete never.
- `sheetBilling/{id}`: create with status `unbilled | in-progress | external` (never born `billed`). Update: a `billed` doc stays `billed` and its `invoiceNumber, billedAt, cutAtBilled, priced, jobKey, customerKey, cutDateOverride` never change (PO may); `billed` is reachable only from `in-progress`; an `in-progress` doc that stays `in-progress` keeps its `invoiceNumber` and `cutDateOverride`. Delete never.
- Rules stay per-document (no `get()` across collections in these blocks — the 20-call limit bites on big transactions). Cross-document consistency is the client transaction's job (Tasks 8–9).

- [ ] **Step 1: Write the failing verify script** `HQ/.worktrees/jt-billing-phase-2/.verify/verify-cnc-billing-rules-p2.js`:

```js
// Run (Git Bash, from the HQ worktree root):
//   export PATH="/c/Users/Golden Boys/AppData/Local/Programs/jdk-21.0.12.1+1/bin:$PATH"
//   export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Users\\Public\\jtmp"; mkdir -p /c/Users/Public/jtmp
//   npx firebase emulators:exec --only firestore,auth --project cnc-job-tracker "node .verify/verify-rules.js && node .verify/verify-cnc-billing-rules.js && node .verify/verify-cnc-billing-rules-p2.js"
//
// Job Tracker billing Phase 2 (CNC_WebApp plan 2026-10-05 Task 1): an invoice keeps its number,
// createdAt and createdBy forever; only legal status moves; an imported invoice is frozen except
// its PO and log flags; a billed sheet stays billed on its invoice. Allowlists are parsed from
// firestore.rules (never typed here).
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { signInAsUid, seedDoc } = require('./auth-helper');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
function emailsOf(fn) {
  const m = rules.match(new RegExp(`function ${fn}\\(\\)\\s*\\{\\s*return\\s*(\\[[^\\]]*\\]);`));
  if (!m) throw new Error(`firestore.rules has no ${fn}()`);
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const OWNERS = emailsOf('jtOwnerEmails');
const OPERATORS = emailsOf('jtOperatorEmails');
const TRAVIS = OWNERS[0];
const COLLIN = OPERATORS.find(e => !OWNERS.includes(e));

function assert(c, m) { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1; } else console.log('PASS: ' + m); }
async function denied(p) { try { await p; return false; } catch { return true; } }
async function allowed(p) { try { await p; return true; } catch (e) { console.error('  threw: ' + e.message); return false; } }

(async () => {
  const app = initializeApp({ projectId: 'cnc-job-tracker', apiKey: 'fake' }, 'p2');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  const inv = (n, extra = {}) => ({ number: n, status: 'in-progress', customerName: 'Northlight Studios', total: 1865, createdAt: 1000, createdBy: 'owner', ...extra });
  await seedDoc('invoices', '3700', inv(3700, { status: 'imported', importedAt: 2000, importedBy: 'owner' }));
  await seedDoc('invoices', '3701', inv(3701, { status: 'cancelled', cancelledAt: 2000, cancelledBy: 'owner' }));
  await seedDoc('sheetBilling', 'b1', { status: 'billed', invoiceNumber: 3700, billedAt: 2000, cutAtBilled: 1500, priced: { handling: 60 }, jobKey: 'proj_n', customerKey: 'cust_n', cutDateOverride: null, poNumber: null });
  await seedDoc('sheetBilling', 'p1', { status: 'in-progress', invoiceNumber: 3702, cutDateOverride: null });
  await seedDoc('sheetBilling', 'u1', { status: 'unbilled', cutDateOverride: '2026-10-02' });

  // ── Collin: nothing ──
  await signInAsUid(app, { localId: 'collin-uid-000000000000002', email: COLLIN, password: 'password123' });
  assert(await denied(getDoc(doc(db, 'invoices', '3700'))), 'Collin: read invoices/ DENIED');
  assert(await denied(setDoc(doc(db, 'invoices', '3800'), inv(3800))), 'Collin: create invoices/ DENIED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'u1'), { status: 'external' })), 'Collin: write sheetBilling/ DENIED');

  // ── Owner ──
  await signInAsUid(app, { localId: 'travis-uid-000000000000002', email: TRAVIS, password: 'password123' });
  // invoices: create
  assert(await allowed(setDoc(doc(db, 'invoices', '3702'), inv(3702))), 'owner: create invoices/3702 in-progress with createdAt ALLOWED');
  assert(await denied(setDoc(doc(db, 'invoices', '3703'), { number: 3703, status: 'in-progress' })), 'owner: create without createdAt/createdBy DENIED');
  assert(await denied(setDoc(doc(db, 'invoices', '3702'), inv(3702, { createdAt: 9999 }))), 'owner: a second "create" of 3702 (new createdAt) DENIED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3702'), { createdBy: 'someone-else' })), 'owner: change createdBy DENIED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3702'), { number: 3799 })), 'owner: change number DENIED');
  // in-progress → imported / cancelled
  assert(await denied(updateDoc(doc(db, 'invoices', '3702'), { status: 'imported', importedAt: 3000, importedBy: 'owner', total: 1 })), 'owner: import that also changes total DENIED');
  assert(await allowed(updateDoc(doc(db, 'invoices', '3702'), { status: 'imported', importedAt: 3000, importedBy: 'owner', updatedAt: 3000, updatedBy: 'owner' })), 'owner: in-progress → imported ALLOWED');
  // imported is frozen except PO / log fields
  assert(await denied(updateDoc(doc(db, 'invoices', '3700'), { status: 'cancelled', cancelledAt: 4000, cancelledBy: 'owner' })), 'owner: imported → cancelled DENIED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3700'), { status: 'in-progress' })), 'owner: imported → in-progress DENIED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3700'), { total: 5 })), 'owner: change an imported invoice total DENIED');
  assert(await allowed(updateDoc(doc(db, 'invoices', '3700'), { poNumber: 'PO-77', poAddedAt: 5000, poAddedBy: 'owner', updatedAt: 5000, updatedBy: 'owner' })), 'owner: add PO to an imported invoice ALLOWED');
  assert(await allowed(updateDoc(doc(db, 'invoices', '3700'), { logWritten: true, logError: null, logWrittenAt: 5001 })), 'owner: set log flags on an imported invoice ALLOWED');
  // cancelled → in-progress keeps createdAt
  assert(await denied(setDoc(doc(db, 'invoices', '3701'), inv(3701, { createdAt: 7777 }))), 'owner: re-use cancelled 3701 with a NEW createdAt DENIED');
  assert(await allowed(setDoc(doc(db, 'invoices', '3701'), inv(3701, { customerName: 'Harbor Lane Pictures' }))), 'owner: re-use cancelled 3701 keeping createdAt ALLOWED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3700'), { poNumber: 'PO-78', total: 2 })), 'owner: imported → imported with a PO AND a total change DENIED');

  // sheetBilling
  assert(await denied(setDoc(doc(db, 'sheetBilling', 'new1'), { status: 'billed', invoiceNumber: 3700 })), 'owner: create sheetBilling born billed DENIED');
  assert(await allowed(setDoc(doc(db, 'sheetBilling', 'new2'), { status: 'in-progress', invoiceNumber: 3702 })), 'owner: create sheetBilling in-progress ALLOWED');
  assert(await allowed(setDoc(doc(db, 'sheetBilling', 'new3'), { status: 'external' })), 'owner: create sheetBilling external (No charge) ALLOWED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'u1'), { status: 'billed', invoiceNumber: 3700 })), 'owner: unbilled → billed (skipping in-progress) DENIED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'p1'), { invoiceNumber: 3799 })), 'owner: move an in-progress sheet to another invoice number DENIED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'p1'), { cutDateOverride: '2026-10-01' })), 'owner: correct the cut date of an in-progress sheet DENIED');
  assert(await allowed(updateDoc(doc(db, 'sheetBilling', 'p1'), { status: 'billed', billedAt: 3000, cutAtBilled: 1500, priced: { handling: 60 } })), 'owner: in-progress → billed ALLOWED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'b1'), { status: 'unbilled', invoiceNumber: null })), 'owner: billed → unbilled DENIED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'b1'), { invoiceNumber: 3701 })), 'owner: change a billed sheet invoice number DENIED');
  assert(await denied(updateDoc(doc(db, 'sheetBilling', 'b1'), { cutAtBilled: 1 })), 'owner: change a billed sheet cutAtBilled DENIED');
  assert(await allowed(updateDoc(doc(db, 'sheetBilling', 'b1'), { poNumber: 'PO-77', updatedAt: 5000, updatedBy: 'owner' })), 'owner: add PO to a billed sheet ALLOWED');
  assert(await allowed(updateDoc(doc(db, 'sheetBilling', 'u1'), { status: 'external' })), 'owner: unbilled → external (No charge) ALLOWED');
  assert(await allowed(updateDoc(doc(db, 'sheetBilling', 'u1'), { status: 'unbilled' })), 'owner: external → unbilled (undo No charge) ALLOWED');

  console.log(process.exitCode ? 'SUITE: FAIL' : 'SUITE: PASS');
})();
```

- [ ] **Step 2: Run it to verify it fails** (the Phase 1 rules still accept a create without `createdAt` and any status move):

Same command as the header. Expected: several `FAIL:` lines (e.g. "create without createdAt/createdBy DENIED", "imported → cancelled DENIED"), `SUITE: FAIL`.

- [ ] **Step 3: Replace the `sheetBilling` and `invoices` blocks** in `firestore.rules` (leave every other line, including the email helpers, exactly as is):

```
    // Changed keys of an update — rules_version 2 map diff.
    function jtChanged() { return request.resource.data.diff(resource.data).affectedKeys(); }

    // sheetBilling (Phase 2): never born billed; billed only from in-progress; a billed sheet stays on
    // its invoice (only its PO may change); an in-progress sheet keeps its invoice and cut date.
    function jtSheetBillingUpdateOk() {
      let before = resource.data.get('status', 'unbilled');
      let after  = request.resource.data.get('status', 'unbilled');
      return after in ['unbilled', 'in-progress', 'billed', 'external']
          && (after != 'billed' || before in ['in-progress', 'billed'])
          && (before != 'billed' || (after == 'billed'
                && !jtChanged().hasAny(['invoiceNumber', 'billedAt', 'cutAtBilled', 'priced', 'jobKey', 'customerKey', 'cutDateOverride'])))
          && !(before == 'in-progress' && after == 'in-progress' && jtChanged().hasAny(['invoiceNumber', 'cutDateOverride']));
    }
    match /sheetBilling/{id} {
      allow read: if isJtOwner();
      allow create: if isJtOwner() && request.resource.data.get('status', 'unbilled') in ['unbilled', 'in-progress', 'external'];
      allow update: if isJtOwner() && jtSheetBillingUpdateOk();
      allow delete: if false;
    }

    // invoices (Phase 2): the doc id IS the invoice number. number / createdAt / createdBy never
    // change, so a second "create" of a used number (a set over it) is refused; a cancelled number
    // may be re-used (it keeps its original createdAt). Imported invoices are frozen except PO + log flags.
    function jtInvoiceUpdateOk() {
      let before = resource.data.status;
      let after  = request.resource.data.status;
      return !jtChanged().hasAny(['number', 'createdAt', 'createdBy'])
          && ((before == 'in-progress' && after == 'in-progress')
              || (before == 'in-progress' && after == 'imported'
                    && jtChanged().hasOnly(['status', 'importedAt', 'importedBy', 'updatedAt', 'updatedBy']))
              || (before == 'in-progress' && after == 'cancelled'
                    && jtChanged().hasOnly(['status', 'cancelledAt', 'cancelledBy', 'updatedAt', 'updatedBy']))
              || (before == 'cancelled' && after == 'in-progress')
              || (before == 'imported' && after == 'imported'
                    && jtChanged().hasOnly(['poNumber', 'poAddedAt', 'poAddedBy', 'logWritten', 'logError', 'logWrittenAt', 'updatedAt', 'updatedBy'])));
    }
    match /invoices/{number} {
      allow read: if isJtOwner();
      allow create: if isJtOwner()
                    && request.resource.data.status == 'in-progress'
                    && string(request.resource.data.number) == number
                    && request.resource.data.createdAt is number
                    && request.resource.data.createdBy is string;
      allow update: if isJtOwner() && jtInvoiceUpdateOk();
      allow delete: if false;
    }
```

- [ ] **Step 4: Fix the Phase 1 fixture line** in `.verify/verify-cnc-billing-rules.js`: the assertion `'owner: create invoices/3612 in-progress ALLOWED'` creates `{ number: 3612, status: 'in-progress', customerName: 'Northlight Studios' }` — add `createdAt: 1000, createdBy: 'owner'` to that object (the Phase 2 create rule requires them). The later "update invoices/3612 status (number unchanged) ALLOWED" call updates only `status` → still allowed (`in-progress → imported`, changed keys ⊂ the allowed list). Do not change any other Phase 1 assertion.

- [ ] **Step 5: Run all three verify scripts** — header command. Expected: three `SUITE: PASS` lines. Phase 1's prints the `NOTE: jtOwnerEmails() lists one owner` line until Eva is added.

- [ ] **Step 6: Match-block check (the 2026-08-19 lesson, by name):**

```bash
grep -o "match /[A-Za-z_]*" firestore.rules | sort | tr '\n' ' '
```

Expected to contain all 15 Job Tracker names: `sheets completions projectNotes sheetNotes ticketHistory customers projectCustomer sheetAnnotations printQueue jobs jobBilling customerBilling sheetBilling settings invoices` plus `users dashboard taskIntents` and the five `entity_*`.

- [ ] **Step 7: Commit (HQ worktree)**

```bash
git add firestore.rules .verify/verify-cnc-billing-rules-p2.js .verify/verify-cnc-billing-rules.js
git commit -m "security(rules): Job Tracker billing phase 2 — invoices keep number/createdAt/createdBy, legal status moves only, imported frozen except PO/log; sheetBilling never born billed, billed stays on its invoice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Not deployed here — hand step B2.

---

### Task 2: `Pricing.priceInvoice()` — repeats, time, weekend, rush, labor, material, rounding, minimum, total

**Files:**
- Modify: `js/pricing.js`
- Create: `test/pricing-invoice.test.mjs`
- Modify: `test/pricing-helpers.test.mjs` (one test: `signature(sheet) === signatureOf(...)`)

**Interfaces:**
- `Pricing.signatureOf({ totalTimeSec, toolpathCount, hasVbit }) → 'sec|count|V-or--'`; `Pricing.signature(sheet)` becomes a wrapper over it (identical output to Phase 1 — existing tests must still pass).
- `Pricing.round2(x)` half-up to the cent; `Pricing.roundToStep(x, step)` half-up to the step.
- `Pricing.TURNAROUND_LABEL = { standard: 'Standard', rush48: '48-hour rush', rush24: '24-hour rush' }`.
- `Pricing.priceInvoice(input) → result` exactly as spec §8.1/§8.2:
  - input `{ priceList, laborTypes, jobs: { [jobKey]: { jobName, turnaround, material: { kind, materialId, name, pricePerSheet, taxable }, includeLabor, laborLines: [{ id, typeId, hours, note }] } }, sheets: [{ fileKey, jobKey, order, sheetLabel, totalTimeSec, toolpathCount, hasVbit, cutDate }], priorBilled: [{ jobKey, signature, order }] }`
  - result `{ total, cutPortion, laborPortion, materialPortion, roundingAdjustment, minimumAdjustment, minimumApplied, perJob: { [jobKey]: { cutBase, weekend, rush, laborBase, laborRush, material, subtotal, sheetCount, firsts, repeats } }, perSheet: { [fileKey]: { handling, timeCharge, weekendPremium, repeatOf } }, labor: [ { jobKey, lineId, typeId, typeName, note, hours, topUpHours, billedHours, minHours, rate, base, rush, rushPct } ], lines, breakdown }` — `lines` and `breakdown` are added in **Task 3**; this task returns them as `[]`.
- Throws (never silently prices) when: the price list lacks any of `handlingFirst, handlingRepeat, hourlyRate, weekendRate, cutMinimum, roundTo` or `rush[turnaround]`; a sheet has no `cutDate`; a sheet's `jobKey` is not in `jobs`; a labor line's `typeId` is not in `laborTypes`; nothing to bill.
- Rules this task pins (spec §8.3, §15): repeats are per job and per signature, first = lowest `order` among prior-billed ∪ this invoice; a prior-billed member makes every sheet on this invoice a repeat; **a sheet with 0 seconds of Aspire time is never grouped** (it is always a first — Phase 1 Task 2 minor); weekend = (handling + time) × weekendRate on Sat/Sun local dates; rush on cut base and labor base only, never on weekend premiums or material; labor minimums **per job, per type** (Decision 7): for each job, sum the hours of each labor type, `billed = max(sum, minHours)`; the shortfall `billed − sum` (if any) is added to that job's **last** line of that type, which gets `topUpHours` > 0; every other line bills its own hours; material = `pricePerSheet × sheets of that job on this invoice`, after rounding, outside the minimum; `rounded = roundToStep(cut + labor, roundTo)`; `minimumAdj = sheets ? max(0, cutMinimum − roundToStep(cutPortion, roundTo)) : 0`; `total = round2(rounded + minimumAdj + materialPortion)`.

- [ ] **Step 1: Write the failing tests** `test/pricing-invoice.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

// settings/pricing.lists.standard as seeded (spec §5.8) and settings/laborTypes (spec §15.2).
const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [
  { id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' },
  { id: 'cam', name: 'CAM', rate: 85, minHours: 0.5, qbItem: 'Digital Design' },
];
const CUSTOMER_SUPPLIED = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const job = (jobName, extra = {}) => ({ jobName, turnaround: 'standard', material: CUSTOMER_SUPPLIED, includeLabor: false, laborLines: [], ...extra });
let n = 0;
const sheet = (jobKey, order, totalTimeSec, cutDate, extra = {}) =>
  ({ fileKey: `fk${++n}`, jobKey, order, sheetLabel: `Job Layout Sheet ${order}`, totalTimeSec, toolpathCount: 3, hasVbit: false, cutDate, ...extra });

// Example A — NL_Bridge_Wall_Panels: 10 sheets, 3 designs + 7 repeats, 3 h 09 m, standard, Thu Oct 1.
// Designs: 4 × 15:09 (909 s), 3 × 20:00 (1200 s), 3 × 22:48 (1368 s) = 11,340 s = 3.15 h.
function exampleA() {
  const t = [909, 909, 909, 909, 1200, 1200, 1200, 1368, 1368, 1368];
  return { jobs: { A: job('NL_Bridge_Wall_Panels') }, sheets: t.map((sec, i) => sheet('A', i + 1, sec, '2026-10-01')) };
}
// Example B — NL_Corridor_Arches: sheets 2–5 = 12, 18, 9, 27 min (unique), 48-hour rush,
// sheet 5 cut Saturday Oct 3, Design 1.5 h @ $150, customer supplied.
function exampleB() {
  const t = [720, 1080, 540, 1620];
  return {
    jobs: { B: job('NL_Corridor_Arches', { turnaround: 'rush48', includeLabor: true, laborLines: [{ id: 'll1', typeId: 'design', hours: 1.5, note: 'Corridor arch drawings' }] }) },
    sheets: t.map((sec, i) => sheet('B', i + 2, sec, i === 3 ? '2026-10-03' : '2026-10-01')),
  };
}
const price = (parts, extra = {}) => Pricing.priceInvoice({ priceList: STANDARD, laborTypes: LABOR, priorBilled: [], ...parts, ...extra });
const merge = (...ps) => ({ jobs: Object.assign({}, ...ps.map(p => p.jobs)), sheets: ps.flatMap(p => p.sheets) });

test('signatureOf matches the Phase 1 signature(sheet)', () => {
  const s = { totalTime: '00:15:09', toolpaths: [{ name: 'Profile' }, { name: 'V-Carve 1' }] };
  assert.equal(Pricing.signature(s), Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 2, hasVbit: true }));
  assert.equal(Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 2, hasVbit: false }), '909|2|-');
});

test('round2 is half-up to the cent; roundToStep is half-up to the step', () => {
  assert.equal(Pricing.round2(643.125), 643.13);
  assert.equal(Pricing.round2(60.375), 60.38);
  assert.equal(Pricing.roundToStep(885.25, 5), 885);
  assert.equal(Pricing.roundToStep(980.625, 5), 980);
  assert.equal(Pricing.roundToStep(1865.875, 5), 1865);
  assert.equal(Pricing.roundToStep(882.5, 5), 885);
  assert.equal(Pricing.roundToStep(78, 5), 80);
});

test('Example A: 3 designs + 7 repeats, 3 h 09 m → cut 885.25, total $885.00', () => {
  const r = price(exampleA());
  assert.equal(r.perJob.A.firsts, 3);
  assert.equal(r.perJob.A.repeats, 7);
  assert.equal(Pricing.round2(r.perJob.A.cutBase), 885.25);
  assert.equal(Pricing.round2(r.perJob.A.subtotal), 885.25, 'BillingB shows the unrounded per-job $885.25');
  assert.equal(r.total, 885);
  assert.equal(r.minimumApplied, false);
});

test('Example B: weekend on handling+time, rush on base only, design 1.5 h → total $980.00', () => {
  const r = price(exampleB());
  const p = r.perJob.B;
  assert.equal(p.firsts, 4, 'no repeats found');
  assert.equal(Pricing.round2(p.cutBase), 388.5);
  assert.equal(p.weekend, 60.375, 'sheet 5: (60 + 0.45 h × 135) × 0.5');
  assert.equal(p.rush, 194.25, 'rush never multiplies the weekend premium');
  assert.equal(p.laborBase, 225);
  assert.equal(p.laborRush, 112.5);
  assert.equal(Pricing.round2(p.subtotal), 980.63, 'BillingB shows $980.63');
  assert.equal(r.total, 980);
});

test('Example C: A + B on one invoice → $1,865.00 (rounding −0.875)', () => {
  const r = price(merge(exampleA(), exampleB()));
  assert.equal(r.total, 1865);
  assert.equal(Pricing.round2(r.roundingAdjustment), -0.88);
  assert.equal(r.materialPortion, 0);
});

test('Example D: one 8-minute sheet + our material → cut minimum, material after rounding → $245.00', () => {
  const D = { jobs: { D: job('RV_Cabinet_Fronts', { material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false } }) },
              sheets: [sheet('D', 1, 480, '2026-09-29')] };
  const r = price(D);
  assert.equal(Pricing.round2(r.perJob.D.cutBase), 78);
  assert.equal(r.minimumAdjustment, 70);
  assert.equal(r.minimumApplied, true);
  assert.equal(r.materialPortion, 95);
  assert.equal(r.total, 245);
});

test('Example E: Harbor Lane — 2 designs + 3 repeats, 1 h 00 m → $375.00; toolpath count separates designs', () => {
  const E = { jobs: { E: job('HL_Set_Walls') }, sheets: [
    sheet('E', 1, 720, '2026-09-30', { toolpathCount: 3 }), sheet('E', 2, 720, '2026-09-30', { toolpathCount: 3 }), sheet('E', 3, 720, '2026-09-30', { toolpathCount: 3 }),
    sheet('E', 4, 720, '2026-09-30', { toolpathCount: 2 }), sheet('E', 5, 720, '2026-09-30', { toolpathCount: 2 }),
  ] };
  const r = price(E);
  assert.equal(r.perJob.E.firsts, 2);
  assert.equal(r.perJob.E.repeats, 3);
  assert.equal(r.total, 375);
});

test('V-bit vs non-V-bit sheets of equal time and count are NOT repeats', () => {
  const r = price({ jobs: { V: job('V') }, sheets: [sheet('V', 1, 600, '2026-10-01', { hasVbit: true }), sheet('V', 2, 600, '2026-10-01', { hasVbit: false })] });
  assert.equal(r.perJob.V.firsts, 2);
});

test('partial bill then the rest: the first-of-design is charged once', () => {
  const first = price({ jobs: { P: job('P') }, sheets: [sheet('P', 1, 909, '2026-10-01'), sheet('P', 2, 909, '2026-10-01')] });
  assert.deepEqual([first.perJob.P.firsts, first.perJob.P.repeats], [1, 1]);
  const sig = Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 3, hasVbit: false });
  const second = price({ jobs: { P: job('P') }, sheets: [sheet('P', 3, 909, '2026-10-02'), sheet('P', 4, 909, '2026-10-02')],
    priorBilled: [{ jobKey: 'P', signature: sig, order: 1 }, { jobKey: 'P', signature: sig, order: 2 }] });
  assert.deepEqual([second.perJob.P.firsts, second.perJob.P.repeats], [0, 2], 'all repeats on the second invoice');
  const sheetKeys = Object.keys(second.perSheet);
  assert.equal(second.perSheet[sheetKeys[0]].repeatOf, 1);
});

test('prior-billed LATER sheet still makes an earlier sheet a repeat (spec §8.3.1)', () => {
  const sig = Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 3, hasVbit: false });
  const r = price({ jobs: { P: job('P') }, sheets: [sheet('P', 1, 909, '2026-10-02')], priorBilled: [{ jobKey: 'P', signature: sig, order: 3 }] });
  assert.equal(r.perJob.P.repeats, 1);
});

test('zero-second sheets are never grouped as repeats', () => {
  const r = price({ jobs: { Z: job('Z') }, sheets: [sheet('Z', 1, 0, '2026-10-01'), sheet('Z', 2, 0, '2026-10-01')] });
  assert.equal(r.perJob.Z.firsts, 2);
});

test('rush24 is +75% on cut base and labor; a CAM line below its minimum bills the minimum', () => {
  const r = price({ jobs: { R: job('R', { turnaround: 'rush24', includeLabor: true, laborLines: [{ id: 'l', typeId: 'cam', hours: 0.25, note: '' }] }) },
    sheets: [sheet('R', 1, 3600, '2026-10-01')] });
  assert.equal(r.perJob.R.cutBase, 195);
  assert.equal(r.perJob.R.rush, 146.25);
  assert.equal(r.labor[0].billedHours, 0.5, 'CAM minimum 0.5 h per job');
  assert.equal(r.labor[0].topUpHours, 0.25);
  assert.equal(r.perJob.R.laborBase, 42.5);
  assert.equal(r.perJob.R.laborRush, 31.875);
});

test('labor minimum is per job per type (Decision 7): two 0.5 h Design lines bill 1 h, not 2 h', () => {
  const r = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 0.5, note: 'Sketch' }, { id: 'b', typeId: 'design', hours: 0.5, note: 'Revisions' }] }) },
    sheets: [sheet('M', 1, 3600, '2026-10-01')] });
  assert.deepEqual(r.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['a', 0.5, 0], ['b', 0.5, 0]]);
  assert.equal(r.perJob.M.laborBase, 150);
});

test('one 1.5 h Design line bills 1.5 h; 0.25 h Design + 0.25 h CAM top up each type separately on the job', () => {
  const one = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [{ id: 'a', typeId: 'design', hours: 1.5, note: '' }] }) }, sheets: [] });
  assert.equal(one.labor[0].billedHours, 1.5);
  assert.equal(one.labor[0].topUpHours, 0);
  const two = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'd1', typeId: 'design', hours: 0.25, note: '' }, { id: 'c1', typeId: 'cam', hours: 0.25, note: '' }, { id: 'd2', typeId: 'design', hours: 0.25, note: '' }] }) }, sheets: [] });
  assert.deepEqual(two.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['d1', 0.25, 0], ['c1', 0.5, 0.25], ['d2', 0.75, 0.5]],
    'the shortfall lands on the LAST line of each type');
  assert.equal(two.perJob.M.laborBase, 1 * 150 + 0.5 * 85);
});

test('minimums never cross jobs: 0.5 h Design on each of two jobs bills 1 h on each', () => {
  const r = price({ jobs: {
    J1: job('J1', { includeLabor: true, laborLines: [{ id: 'a', typeId: 'design', hours: 0.5, note: '' }] }),
    J2: job('J2', { includeLabor: true, laborLines: [{ id: 'b', typeId: 'design', hours: 0.5, note: '' }] }) }, sheets: [] });
  assert.deepEqual(r.labor.map(l => l.billedHours), [1, 1]);
});

test('includeLabor false leaves labor out entirely', () => {
  const B = exampleB(); B.jobs.B.includeLabor = false;
  assert.equal(price(B).perJob.B.laborBase, 0);
});

test('labor-only invoice: no cut minimum, rounded to $5', () => {
  const r = price({ jobs: { L: job('L', { includeLabor: true, laborLines: [{ id: 'l', typeId: 'design', hours: 1.3, note: '' }] }) }, sheets: [] });
  assert.equal(r.minimumApplied, false);
  assert.equal(r.total, 195);   // 1.3 × 150 = 195
});

test('changing price-list numbers changes the total (no hardcoded constants)', () => {
  const base = price(exampleA()).total;
  const r = Pricing.priceInvoice({ priceList: { ...STANDARD, hourlyRate: 150 }, laborTypes: LABOR, priorBilled: [], ...exampleA() });
  assert.notEqual(r.total, base);
  const r2 = Pricing.priceInvoice({ priceList: { ...STANDARD, roundTo: 1 }, laborTypes: LABOR, priorBilled: [], ...exampleA() });
  assert.equal(r2.total, 885);
});

test('refuses to price silently', () => {
  assert.throws(() => Pricing.priceInvoice({ priceList: { ...STANDARD, hourlyRate: undefined }, laborTypes: LABOR, ...exampleA() }), /hourlyRate/);
  assert.throws(() => price({ jobs: { A: job('A') }, sheets: [sheet('A', 1, 60, null)] }), /not cut/);
  assert.throws(() => price({ jobs: {}, sheets: [sheet('X', 1, 60, '2026-10-01')] }), /no job/);
  assert.throws(() => price({ jobs: { L: job('L', { includeLabor: true, laborLines: [{ id: 'l', typeId: 'gone', hours: 1 }] }) }, sheets: [] }), /labor type/);
  assert.throws(() => price({ jobs: {}, sheets: [] }), /Nothing to bill/);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/pricing-invoice.test.mjs` → FAIL (`Pricing.signatureOf is not a function`).

- [ ] **Step 3: Implement** in `js/pricing.js` (keep every Phase 1 export; change `signature` to delegate; add the block below before `return`, and add the new names to the returned object). Update the file header comment: "Phase 2: priceInvoice() — the ONLY place money is computed."

```js
  function signatureOf(s) {
    return `${Number(s && s.totalTimeSec) || 0}|${Number(s && s.toolpathCount) || 0}|${s && s.hasVbit ? 'V' : '-'}`;
  }
  // (Phase 1 signature(sheet) now reads:)
  // function signature(sheet) {
  //   const count = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths.length : 0;
  //   return signatureOf({ totalTimeSec: parseTimeSec(sheet && sheet.totalTime), toolpathCount: count, hasVbit: sheetHasVbit(sheet) });
  // }

  /* ── Phase 2: the price engine (spec §8). Money lives ONLY here. ── */
  const TURNAROUND_LABEL = { standard: 'Standard', rush48: '48-hour rush', rush24: '24-hour rush' };
  const PRICE_KEYS = ['handlingFirst', 'handlingRepeat', 'hourlyRate', 'weekendRate', 'cutMinimum', 'roundTo'];

  // Half-up to the cent; the nudge absorbs binary noise (643.125 is stored as 643.12499…).
  function round2(x) { return Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100; }
  function roundToStep(x, step) { const s = Number(step) > 0 ? Number(step) : 1; return Math.round(x / s + 1e-9) * s; }

  function priceInvoice(input) {
    const pl = input && input.priceList;
    if (!pl) throw new Error('priceInvoice: no price list');
    PRICE_KEYS.forEach(k => { if (!(typeof pl[k] === 'number' && isFinite(pl[k]))) throw new Error(`Price list is missing ${k}`); });
    const rushOf = t => {
      const v = pl.rush && pl.rush[t];
      if (!(typeof v === 'number' && isFinite(v))) throw new Error(`Price list has no rush rate for ${t}`);
      return v;
    };
    const types = {};
    (input.laborTypes || []).forEach(t => { types[t.id] = t; });
    const jobs = input.jobs || {};
    const sheets = input.sheets || [];
    const prior = input.priorBilled || [];

    sheets.forEach(s => {
      if (!jobs[s.jobKey]) throw new Error(`Sheet ${s.fileKey} has no job ${s.jobKey}`);
      if (!s.cutDate) throw new Error(`Sheet ${s.fileKey} is not cut — it cannot be on an invoice`);
    });

    // 1. Repeats (§8.3.1). A 0-second sheet is never grouped (it has no real signature).
    const zero = s => !(Number(s.totalTimeSec) > 0);
    const gk = s => s.jobKey + '\u0000' + signatureOf(s);
    const firstOn = {};
    sheets.forEach(s => {
      if (zero(s)) return;
      const cur = firstOn[gk(s)];
      if (!cur || s.order < cur.order || (s.order === cur.order && String(s.fileKey) < String(cur.fileKey))) firstOn[gk(s)] = s;
    });
    const priorFirst = {};
    prior.forEach(p => {
      if (String(p.signature).split('|')[0] === '0') return;
      const k = p.jobKey + '\u0000' + p.signature;
      if (priorFirst[k] === undefined || p.order < priorFirst[k]) priorFirst[k] = p.order;
    });

    // 2–3. Time and weekend per sheet.
    const perSheet = {};
    sheets.forEach(s => {
      let repeatOf = null;
      if (!zero(s)) {
        if (priorFirst[gk(s)] !== undefined) repeatOf = priorFirst[gk(s)];
        else if (firstOn[gk(s)] !== s) repeatOf = firstOn[gk(s)].order;
      }
      const handling = repeatOf === null ? pl.handlingFirst : pl.handlingRepeat;
      const timeCharge = (Number(s.totalTimeSec) || 0) / 3600 * pl.hourlyRate;
      const weekendPremium = isWeekendDate(s.cutDate) ? (handling + timeCharge) * pl.weekendRate : 0;
      perSheet[s.fileKey] = { handling, timeCharge, weekendPremium, repeatOf };
    });

    // 4. Per job.
    const jobKeys = [];
    sheets.forEach(s => { if (!jobKeys.includes(s.jobKey)) jobKeys.push(s.jobKey); });
    Object.keys(jobs).forEach(k => { if (jobs[k].includeLabor && (jobs[k].laborLines || []).length && !jobKeys.includes(k)) jobKeys.push(k); });
    const perJob = {};
    const labor = [];
    jobKeys.forEach(jk => {
      const job = jobs[jk];
      const rp = rushOf(job.turnaround || 'standard');
      const js = sheets.filter(s => s.jobKey === jk);
      let cutBase = 0, weekend = 0, firsts = 0;
      js.forEach(s => { const p = perSheet[s.fileKey]; cutBase += p.handling + p.timeCharge; weekend += p.weekendPremium; if (p.repeatOf === null) firsts++; });
      let laborBase = 0, laborRush = 0;
      if (job.includeLabor) {
        const lines = job.laborLines || [];
        lines.forEach(l => { if (!types[l.typeId]) throw new Error(`Unknown labor type "${l.typeId}" on ${job.jobName}`); });
        // Minimums per job, per type (Decision 7): sum each type's hours on this job, apply minHours
        // once, and put any shortfall on the LAST line of that type (one line per entry stays).
        const sumByType = {}, lastByType = {};
        lines.forEach((l, i) => { sumByType[l.typeId] = (sumByType[l.typeId] || 0) + (Number(l.hours) || 0); lastByType[l.typeId] = i; });
        lines.forEach((l, i) => {
          const t = types[l.typeId];
          const hours = Number(l.hours) || 0;
          const topUpHours = lastByType[l.typeId] === i ? Math.max(0, (Number(t.minHours) || 0) - sumByType[l.typeId]) : 0;
          const billedHours = hours + topUpHours;
          const base = billedHours * Number(t.rate);
          const rush = base * rp;
          laborBase += base; laborRush += rush;
          labor.push({ jobKey: jk, lineId: l.id, typeId: t.id, typeName: t.name, note: l.note || '', hours, topUpHours, billedHours,
            minHours: Number(t.minHours) || 0, rate: Number(t.rate), base, rush, rushPct: rp });
        });
      }
      const m = job.material || {};
      const material = m.kind === 'ours' ? (Number(m.pricePerSheet) || 0) * js.length : 0;
      const rush = cutBase * rp;
      perJob[jk] = { cutBase, weekend, rush, laborBase, laborRush, material, subtotal: cutBase + weekend + rush + laborBase + laborRush + material,
        sheetCount: js.length, firsts, repeats: js.length - firsts };
    });

    if (!sheets.length && !labor.length) throw new Error('Nothing to bill');

    // 5–8. Per invoice.
    let cutPortion = 0, laborPortion = 0, materialPortion = 0;
    jobKeys.forEach(jk => { const p = perJob[jk]; cutPortion += p.cutBase + p.weekend + p.rush; laborPortion += p.laborBase + p.laborRush; materialPortion += p.material; });
    const rounded = roundToStep(cutPortion + laborPortion, pl.roundTo);
    const minimumAdjustment = sheets.length ? Math.max(0, pl.cutMinimum - roundToStep(cutPortion, pl.roundTo)) : 0;
    const total = round2(rounded + minimumAdjustment + materialPortion);

    return { total, cutPortion, laborPortion, materialPortion,
      roundingAdjustment: rounded - (cutPortion + laborPortion), minimumAdjustment, minimumApplied: minimumAdjustment > 0,
      perJob, perSheet, labor, lines: [], breakdown: [], _ctx: { priceList: pl, jobs, sheets, jobKeys } };
  }
```

(`_ctx` is internal for Task 3's line/breakdown builders in the same file; it is deleted from the result before returning in Task 3.)

- [ ] **Step 4: Add the delegation test** to `test/pricing-helpers.test.mjs` is already covered by the first new test; run `node --test test/pricing-invoice.test.mjs test/pricing-helpers.test.mjs` → all pass. `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js test/pricing-invoice.test.mjs
git commit -m "feat(pricing): priceInvoice — repeats incl. prior-billed, Aspire time, weekend on handling+time, rush on base only, labor minimums, material after rounding, cut minimum (spec §8.3, examples A–E)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `priceInvoice()` lines, reconcile and the plain-words breakdown

**Files:**
- Modify: `js/pricing.js`
- Create: `test/pricing-lines.test.mjs`

**Interfaces:**
- `result.lines`: `[{ type: 'material' | 'cutSheets' | 'labor', amount, rate, quantity: 1, serviceDate: 'YYYY-MM-DD' | '', jobKeys: [...], facts }]` in the estimator's order: the one Materials line (if any), the one cut line, one line per labor entry. **No descriptions, item names or Taxable here** — Task 5 adds them. `facts`:
  - `material`: `{ names: [...], taxable: true | false | 'mixed', sheetCount }` — **ONE combined line per invoice** (Decision 4, spec §8.3 step 9) covering every job with our material; `names` = distinct material names in job order; `taxable` = the shared per-material Taxable value, or `'mixed'` when they differ. Pricing does not refuse a mixed bill (the money is still right); `InvoiceLines.finalize` refuses it (Task 5) and Billing shows why (Task 14).
  - `cutSheets`: `{ sheetCount, perJob: [{ jobName, count }], rush: [{ jobName, label }], weekendSheets, weekendRate, minimumApplied }`; `serviceDate` = latest `cutDate` on the invoice.
  - `labor`: the matching `result.labor[i]` fields (including `topUpHours` and `minHours` — Decision 7).
- Amounts: `round2` of each line's money (`material`: Σ material; `cutSheets`: cutPortion + minimumAdjustment; `labor`: base + rush). **Reconcile:** `diff = round2(total − Σ amounts)` is added to the cut line, else the last labor line. `rate = amount`. Invariant: `Σ lines.amount === total` exactly (compare in cents).
- `result.breakdown`: `[{ label, amount }]` in this order (spec §7.5 / Example C): `Handling N × $60`, `Handling N repeats × $40`, `Cutting 4 h 15 m × $135/hr`, `Weekend (+50%) on N sheet(s)`, one `48-hour rush on <job>` per rushed job (cut rush + labor rush of that job), one `<Type> <billedHours> h[ (includes <minHours>-h minimum)] — <note>` per labor line (its base; the bracket only on a line with `topUpHours > 0`), `Rounded to the nearest $5` (if non-zero), `Cut minimum $150` (if applied), then material: one `Material — <names>, N sheets` line, or `Material — customer supplied` at 0 when the invoice has sheets and no ours material. Amounts are unrounded numbers (the screen formats them); Σ breakdown = total within 1 cent.

- [ ] **Step 1: Write the failing tests** `test/pricing-lines.test.mjs` (reuse the Task 2 builders — copy `STANDARD`, `LABOR`, `job`, `sheet`, `exampleA`, `exampleB`, `merge`, `price` into the file; a shared helper module under `test/helpers/` is fine too):

```js
const cents = x => Math.round(x * 100);
const sumCents = ls => ls.reduce((a, l) => a + cents(l.amount), 0);

test('Example A lines: one CNC line $885.00, no material line', () => {
  const r = price(exampleA());
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 885]]);
  assert.equal(r.lines[0].serviceDate, '2026-10-01');
  assert.equal(r.lines[0].rate, 885);
  assert.equal(r.lines[0].quantity, 1);
});

test('Example B lines: CNC 643.125 → reconciled 642.50; Design 337.50', () => {
  const r = price(exampleB());
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 642.5], ['labor', 337.5]]);
  assert.equal(r.lines[0].serviceDate, '2026-10-03', 'latest cut date');
  assert.deepEqual(r.lines[0].facts.rush, [{ jobName: 'NL_Corridor_Arches', label: '48-hour rush' }]);
  assert.equal(r.lines[0].facts.weekendSheets, 1);
});

test('Example C lines and breakdown match the InvoiceConfirm mockup', () => {
  const r = price(merge(exampleA(), exampleB()));
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 1527.5], ['labor', 337.5]]);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.deepEqual(r.lines[0].facts.perJob, [{ jobName: 'NL_Bridge_Wall_Panels', count: 10 }, { jobName: 'NL_Corridor_Arches', count: 4 }]);
  const b = Object.fromEntries(r.breakdown.map(x => [x.label, Pricing.round2(x.amount)]));
  assert.equal(b['Handling 7 × $60'], 420);
  assert.equal(b['Handling 7 repeats × $40'], 280);
  assert.equal(b['Cutting 4 h 15 m × $135/hr'], 573.75);
  assert.equal(b['Weekend (+50%) on 1 sheet'], 60.38);
  assert.equal(b['48-hour rush on NL_Corridor_Arches'], 306.75);
  assert.equal(b['Design 1.5 h — Corridor arch drawings'], 225);
  assert.equal(b['Rounded to the nearest $5'], -0.88);
  assert.equal(b['Material — customer supplied'], 0);
  assert.ok(Math.abs(r.breakdown.reduce((a, x) => a + x.amount, 0) - r.total) < 0.01);
});

test('Example D lines: Materials 95.00 then CNC (cut minimum) 150.00', () => {
  const D = { jobs: { D: job('RV_Cabinet_Fronts', { material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false } }) },
              sheets: [sheet('D', 1, 480, '2026-09-29')] };
  const r = price(D);
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['material', 95], ['cutSheets', 150]]);
  assert.equal(r.lines[1].facts.minimumApplied, true);
  assert.deepEqual(r.lines[0].facts, { names: ['3/4 in Baltic birch'], taxable: false, sheetCount: 1 });
  assert.ok(r.breakdown.some(x => x.label === 'Cut minimum $150' && x.amount === 70));
});

test('two materials on one invoice → ONE combined Materials line (Decision 4); differing Taxable → "mixed"', () => {
  const m1 = { kind: 'ours', materialId: 'm1', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false };
  const m2 = { kind: 'ours', materialId: 'm2', name: '1/2 in Sintra', pricePerSheet: 60, taxable: false };
  const parts = m => ({ jobs: { J1: job('J1', { material: m1 }), J2: job('J2', { material: m }) },
    sheets: [sheet('J1', 1, 600, '2026-10-01'), sheet('J2', 1, 600, '2026-10-01')] });
  const r = price(parts(m2));
  const mats = r.lines.filter(l => l.type === 'material');
  assert.equal(mats.length, 1);
  assert.deepEqual([mats[0].amount, mats[0].facts], [155, { names: ['3/4 in Baltic birch', '1/2 in Sintra'], taxable: false, sheetCount: 2 }]);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.equal(price(parts({ ...m2, taxable: true })).lines[0].facts.taxable, 'mixed');
});

test('labor top-up shows on the last line of the type; lines still sum to the total', () => {
  const r = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 0.25, note: 'Sketch' }, { id: 'b', typeId: 'design', hours: 0.25, note: 'Fixes' }] }) },
    sheets: [sheet('M', 1, 3600, '2026-10-01')] });
  const labor = r.lines.filter(l => l.type === 'labor');
  assert.deepEqual(labor.map(l => [l.facts.billedHours, l.facts.topUpHours]), [[0.25, 0], [0.75, 0.5]]);
  assert.ok(r.breakdown.some(x => x.label === 'Design 0.75 h (includes 1-h minimum) — Fixes'));
  assert.equal(sumCents(r.lines), cents(r.total));
});

test('labor-only invoice reconciles onto the last labor line', () => {
  const r = price({ jobs: { L: job('L', { turnaround: 'rush48', includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 1.1, note: '' }, { id: 'b', typeId: 'cam', hours: 0.7, note: '' }] }) }, sheets: [] });
  assert.equal(r.lines.every(l => l.type === 'labor'), true);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.equal(r.total % 5, 0);
});

test('invariants on every example: Σ lines = total; total − material is a multiple of 5; no negative line', () => {
  for (const parts of [exampleA(), exampleB(), merge(exampleA(), exampleB())]) {
    const r = price(parts);
    assert.equal(sumCents(r.lines), cents(r.total));
    assert.equal((cents(r.total) - cents(r.materialPortion)) % 500, 0);
    assert.ok(r.lines.every(l => l.amount >= 0));
    assert.equal(r._ctx, undefined, 'internal context is not returned');
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/pricing-lines.test.mjs` → FAIL (`lines` is `[]`).

- [ ] **Step 3: Implement** two private functions in `js/pricing.js`, called at the end of `priceInvoice` before returning (then `delete result._ctx`):
  - `buildLines(result)` — one combined Materials line (Σ material of every ours-material job; `names`, `sheetCount`, `taxable` as specified); the cut line when there are sheets (facts as specified; `perJob` counts in job order using `jobs[jk].jobName`; `rush` only for jobs whose rush rate > 0 and that have sheets on the invoice; `weekendSheets` = count of `weekendPremium > 0`); one labor line per `result.labor` entry; amounts `round2`; reconcile; `rate = amount`.
  - `buildBreakdown(result)` — exactly the labels above. Money in labels prints as `$60` when whole, else `$60.50`. Hours print as `1.5 h`, `1 h`. Duration via `formatDuration(Σ totalTimeSec)`. Weekend percent = `Math.round(weekendRate × 100)`. Singular/plural: `1 sheet` / `2 sheets`, `1 repeat` / `7 repeats`.

- [ ] **Step 4: Run** — `node --test test/pricing-lines.test.mjs test/pricing-invoice.test.mjs` → pass; `npm test` → all pass.

- [ ] **Step 5: Commit** — `feat(pricing): invoice lines (materials / CNC / labor, reconciled to the total) and the plain-words breakdown (spec §8.3.9, Example C)`.

---

### Task 4: Pricing fixtures from real exports (fake names) + invariant tests

**Files:**
- Create: `tools/build-pricing-fixtures.mjs`
- Create: `test/fixtures/pricing/*.json` (generated once, committed)
- Create: `test/pricing-fixtures.test.mjs`

**Interfaces:** fixture JSON shape (one file per real job, deduplicated across re-exports):

```json
{ "fixture": "job-07", "jobName": "NL_Fixture_07", "customer": "Northlight Studios", "legacy8Column": false,
  "sheets": [ { "order": 1, "sheetLabel": "Sheet 1", "totalTimeSec": 909, "toolpathCount": 4, "hasVbit": true, "cutDate": "2026-09-15" } ] }
```

- [ ] **Step 1: Write the builder** `tools/build-pricing-fixtures.mjs`. Rules it must follow:
  - Reads `G:\My Drive\CSV Exports\*.csv` with `fs.readFileSync` only. **Never writes, renames or deletes anything in that folder** (an Apps Script once ate files there). It writes only to `test/fixtures/pricing/` inside the worktree.
  - Accepts only files whose first line starts `"Sheet","Job","Total Time"` (Job Tracker job exports, 8 or 9 columns). Skips `Orv_*` staging-tab exports, `.gsheet` links and anything else.
  - Deduplicates re-exports: key = job name + sheet title; keep one row per key (the latest `Completed At`).
  - Replaces every customer name with one of the four fake names (round-robin by sorted real name — no real name is written), every job name with `<prefix>_Fixture_<NN>`, every sheet title with `Sheet <order>`. Notes and Operator columns are dropped.
  - `cutDate`: parse `Completed At` text like `Sep 15, 2026, 8:00 AM` (also with U+202F before AM/PM) by **reading the month/day/year words**, never `new Date(iso)`/UTC (spec §12.1 weekday trap). Blank → `null`.
  - `order`: sort the job's rows with the same rule as `compareSheets` in `js/app.js` (material label, then sheet number) using the original sheet title, then number 1..n.
  - Prints one line per fixture written and the total count. Self-check before writing: `JSON.stringify(output)` must not contain any real customer or job string read from the CSVs (assert by scanning for each original customer name and job name; abort if found).

- [ ] **Step 2: Run it once** from the worktree: `node tools/build-pricing-fixtures.mjs` → expect roughly 60 fixtures (76 job CSVs minus re-exports). Open two fixture files and confirm by eye: fake names only, `Sheet N` titles, local dates.

- [ ] **Step 3: Write the tests** `test/pricing-fixtures.test.mjs`:
  - Loads every `test/fixtures/pricing/*.json`; builds `priceInvoice` input per fixture (one job, standard turnaround, customer supplied, sheets with `cutDate` only — rows with `null` are excluded and counted).
  - **Invariants on every fixture:** Σ lines (cents) = total (cents); `total % 5 === 0` (no material); no negative line; `perJob.firsts + perJob.repeats === sheets.length`; total ≥ 150 when ≥ 1 sheet; re-pricing with `hourlyRate + 10` gives a strictly larger total or an equal one only if the cut minimum dominates.
  - **Pinned cases (literals):** pick from the fixtures (name each by its fixture id in the test) — (a) a heavy-repeat job (the four identical 15:09 sheets pattern, or the job with the most repeats), (b) an all-unique job, (c) a job spanning a weekend cut date, (d) a job with a V-bit and a non-V-bit sheet of equal time (must not be repeats), (e) a legacy 8-column export (no customer), (f) a one-sheet job that hits the minimum, (g) a two-job invoice with `rush48` on one job, (h) a partial bill followed by the rest using `priorBilled`. **Each expected total is computed by hand with the arithmetic written in a comment above the assertion** (handling count × 60 + repeats × 40 + Σsec/3600 × 135 …, then the rounding) — never by running `priceInvoice` and pasting its output. The Opus reviewer re-derives (a) and (g) independently.

- [ ] **Step 4: Run** — `node --test test/pricing-fixtures.test.mjs` → pass; `npm test` → all pass.

- [ ] **Step 5: Privacy check before committing**

```bash
grep -rliE "orville|trio|copper|harbor|ridgeway|northlight" test/fixtures/pricing | head   # fake names allowed: Northlight, Harbor Lane, Copperline, Ridgeway
grep -rhoE '"jobName": "[^"]*"' test/fixtures/pricing | sort -u | head -20
```

Only the four fake customer names and `*_Fixture_NN` job names may appear. If any real name appears, fix the builder, regenerate, re-check.

- [ ] **Step 6: Commit** — `test(pricing): fixtures from past job exports (fake names, local cut dates) + invariants and hand-computed pinned cases (spec §12.1)`.

---

### Task 5: `js/invoice-lines.js` — QuickBooks words, items, Taxable, CSV

**Files:**
- Create: `js/invoice-lines.js`
- Create: `test/invoice-lines.test.mjs`
- Modify: `index.html` — `<script src="js/invoice-lines.js?v=1"></script>` after `log-rows.js`

**Interfaces (global `InvoiceLines`):**
- `register(type, { describe(line, ctx), qbItem(line, ctx), taxable(line, ctx) })` — Phase 2 registers `cutSheets`, `labor`, `material`. Later line types (VanLab sanding/crating/hardware) register from their own file. **No arithmetic here:** amounts come from `priceInvoice` untouched.
- `finalize(priced, ctx) → [{ type, qbItem, description, quantity, rate, amount, taxable: 'Y'|'N', serviceDate, jobKeys }]` — `ctx = { qbItems: settings/qbItems, laborTypes }`. Throws on an unregistered type, and throws `{ code: 'mixed-taxable' }` with the text "Materials on this bill are taxed differently — bill those jobs separately." when the Materials line's `facts.taxable === 'mixed'` (Decision 4: never guess a tax flag).
- `buildQuickBooksCsv({ number, customerName, invoiceDate, dueDate, lines }) → string` — ported from the estimator (`Estimate and invoice Calculator/cnc-quote-calculator.html`, `buildQuickBooksCsv`, ~line 1842): headers `Invoice No., Customer, Invoice Date, Due Date, Item(Product/Service), Item Description, Item Quantity, Item Rate, Item Amount, Taxable, Service Date`; dates `MM/DD/YYYY`; quoting only when a field has `"`, `,` or a newline; rows joined `\r\n`; rate = `parseFloat((amount/qty).toFixed(4))`. **No BOM in the string** (the stored `invoices.csv` is the string; the BOM is added at download).
- `BOM = '\ufeff'`; `downloadName(customerName, number) → 'QuickBooks Exports/<sanitizeForPath(customer)>/<number>.csv'` (Chrome flattens it to `QuickBooks Exports_<customer>_<number>.csv`, confirmed 2026-07-27 — don't fight it).
- `addDays(ymd, n)`, `DUE_TERMS = { receipt: 0, net15: 15, net30: 30 }`, `dueDateFor(invoiceYmd, term, customYmd)` (local date math; `term === 'custom'` returns `customYmd`).
- Descriptions:
  - `cutSheets`: `CNC cutting — 14 sheets (NL_Bridge_Wall_Panels 10, NL_Corridor_Arches 4)[, 48-hour rush on <job>…][, Weekend (+50%) on 1 sheet][, Cut minimum]`; item `qbItems.cnc`; Taxable `qbItems.taxable.cnc` (default `N`).
  - `labor`: `<typeName>[ — <note>] (<billedHours> hr|hrs @ $<rate>/hr[, includes <minHours>-hr minimum])[ + Rush (+50%)]` — the "includes" part only when `topUpHours > 0` (Decision 7); item = that labor type's `qbItem` from `ctx.laborTypes` (fallback `qbItems.cnc`); Taxable `qbItems.taxable.labor` (default `N`).
  - `material`: `Materials — N sheet(s) (<names joined by ", ">)` — one line per invoice; item `qbItems.materials`; Taxable `Y` when `facts.taxable === true`, `N` when `false`, refused when `'mixed'`.

- [ ] **Step 1: Write the failing tests** `test/invoice-lines.test.mjs` — require `../js/path-utils.js`, `../js/pricing.js` into `globalThis` first (the module reads `PathUtils`/`Pricing` globals with a `require` fallback). Cases:
  - **Byte-exact Example C CSV** (invoice 3612, Northlight Studios, invoice date and due date `2026-10-06`, Due upon receipt), built from `priceInvoice(merge(exampleA(), exampleB()))` → `finalize` with `qbItems = { cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'N', labor: 'N' } }`:

```
Invoice No.,Customer,Invoice Date,Due Date,Item(Product/Service),Item Description,Item Quantity,Item Rate,Item Amount,Taxable,Service Date
3612,Northlight Studios,10/06/2026,10/06/2026,CNC Router Work,"CNC cutting — 14 sheets (NL_Bridge_Wall_Panels 10, NL_Corridor_Arches 4), 48-hour rush on NL_Corridor_Arches, Weekend (+50%) on 1 sheet",1,1527.5,1527.5,N,10/03/2026
3612,Northlight Studios,10/06/2026,10/06/2026,Digital Design,Design — Corridor arch drawings (1.5 hrs @ $150/hr) + Rush (+50%),1,337.5,337.5,N,
```

  (lines joined with `\r\n`, no trailing newline — assert `csv === EXPECTED` with a literal built by `[…].join('\r\n')`).
  - Example D: material line first, `Materials — 1 sheet (3/4 in Baltic birch)`, item `Materials`, Taxable `N`; flip the material's `taxable` to true → `Y`; CNC line ends `, Cut minimum`, amount `150`.
  - Labor singular: 1 hour → `(1 hr @ $150/hr)`; a lone CAM line of 0.25 h tops up to 0.5 → `(0.5 hrs @ $85/hr, includes 0.5-hr minimum)`; two 0.5 h Design lines → `(0.5 hrs @ $150/hr)` each, no "includes".
  - Two materials, same Taxable → one line `Materials — 2 sheets (3/4 in Baltic birch, 1/2 in Sintra)`; differing Taxable → `finalize` throws `mixed-taxable`.
  - A customer name with a comma is quoted; a description with a `"` is doubled.
  - `downloadName('Northlight Studios', 3612)` → `QuickBooks Exports/Northlight Studios/3612.csv`; a name with `/` becomes `-`.
  - `dueDateFor('2026-10-06','receipt')` → `2026-10-06`; `'net15'` → `2026-10-21`; `'net30'` → `2026-11-05`; `dueDateFor('2026-12-20','net15')` → `2027-01-04`; `custom`.
  - `finalize` throws on an unknown `type`; `register` lets a test add `sanding` and finalize a priced result carrying it.
  - No money: `finalize(...)` amounts are `===` the priced amounts (same numbers in, same numbers out).

- [ ] **Step 2: Run to verify failure**, **Step 3: implement** the module (IIFE, `module.exports` shim, header comment: "words and QuickBooks columns only — no arithmetic; money is Pricing.priceInvoice()"), **Step 4: run** (`node --test test/invoice-lines.test.mjs`, then `npm test`), **Step 5: script tag + commit** — `feat(invoice-lines): pluggable line types + QuickBooks CSV ported from the estimator (spec §9), due-date picks (§15.8)`.

---

### Task 6: OwnerStore — every owner write becomes a transaction; Phase 2 seeds (Phase 1 must-fix)

**Files:**
- Create: `test/helpers/fake-firestore.cjs`
- Modify: `js/storage-owner.js`
- Create: `test/storage-owner-tx.test.mjs`
- Modify: `test/storage-owner.test.mjs` (seed list + the two P18 tests re-pointed at the shared fake)

**Interfaces:**
- `test/helpers/fake-firestore.cjs` exports `makeDb()` → a compat-shaped in-memory db: `collection(c)` → `{ doc(id), where(f,'==',v), orderBy(f,dir), limit(n), get(), onSnapshot(cb, err) }`; `doc` refs with `get/set(data, { merge })/update`; `batch()`; `runTransaction(fn)` with **optimistic concurrency** (records the version of every `tx.get`, re-runs `fn` up to 5 times if any read doc changed before commit, then throws `{ code: 'aborted' }`). Test hooks: `db._hooks.beforeCommit = async () => {…}` (runs once, between `fn` and the commit — use it to land a "concurrent" write), `db._hooks.failWrites = (col, id) => bool` (throws `permission-denied`), `db._data` for assertions, `db._seed(col, id, doc)`. `{ merge: true }` here is shallow — code under test never relies on deep merge (the transactional writers below write whole docs inside the transaction). Header comment: "node --test also loads this file (it is under test/); it defines no tests."
- `OwnerStore` changes (all existing names keep working; tests from Phase 1 still pass except the two noted):
  - `mutateJobBilling(jobKey, fn, by) → Promise<doc>` — transaction: read the server doc (or `newJobBilling(jobName)` when absent), `next = fn(copy)` (may **throw** an `Error` to abort with that message), stamp `updatedAt/updatedBy`, `tx.set(ref, next)`; after commit update the cache and emit. No db → apply to the cache. `fn` must be pure.
  - `setJobBilling(jobKey, patch, by)` → `mutateJobBilling(jobKey, cur => ({ ...cur, ...patch }), by)`; **throws** if `patch` contains `laborLines` (labor changes must go through `mutateJobBilling` with a function, so a concurrent Billing lock is never overwritten).
  - `mutateSheetBilling(fileKey, fn, by)`, `mutateCustomerBilling(customerKey, fn, by)` — same shape; defaults: sheet `{ status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null }`, customer as Phase 1 plus `openInvoice: null`.
  - `setCutDateOverride(fileKey, ymd, refs, by)` — now `mutateSheetBilling`; the "already priced" refusal (`in-progress`/`billed`) is checked **inside** the transaction against the server doc; an `external` sheet may still have its date corrected (it is never billed). Validates `ymd` is `null` or a real `YYYY-MM-DD` (Phase 1 Task 2 minor).
  - `setNoCharge(fileKey, on, refs, by)` — Decision 3: `on` → status `external` (refused unless status is `unbilled`); off → `unbilled` (refused unless `external`).
  - `setCustomerBilling(key, patch, by)` → `mutateCustomerBilling(key, cur => ({ ...cur, ...patch }), by)`; `rememberMaterialDefault(…, by)` gains the `by` argument (Phase 1 minor: it wrote `updatedBy: ''`).
  - `setSetting(name, data, by)` → transaction read-merge-write (top-level keys of `data` replace the doc's keys), stamps `savedAt/savedBy`.
  - Phase 2 seeds added to `SEEDS` (seeded by the existing `ensureSeeded` path, only after a successful settings load — P17 unchanged):
    - `pricing: { defaultList: 'standard', lists: { standard: { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 } } }`
    - `qbItems: { cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'N', labor: 'N' } }` (per-material Taxable lives on each material — spec §15.8)
    - `invoicing: { seedNumber: 3603, weekEndingDay: 6, defaultDue: 'receipt', billingStartDate: null }` (`billingStartDate` = Decision 1; `null` until Travis sets it in B5)
  - Readers: `pricing()`, `qbItems()`, `invoicing()` (seed-shaped defaults merged under the stored doc so a missing key never prices silently wrong — **except** price-list numbers: `priceListFor(customerKey)` returns `pricing().lists[customerBilling.priceList || pricing().defaultList]` and returns `null` when missing, so Billing shows "Price list not set up" instead of guessing).
  - `_putLocal(name, id, doc)` — cache-only write + emit, used ONLY by InvoiceStore's no-db (PASTE/test) path.
  - Keep `loaded(name)` and the P24 gates exactly as they are.

- [ ] **Step 1: Write the fake** (`test/helpers/fake-firestore.cjs`) and its own smoke tests at the top of `test/storage-owner-tx.test.mjs`: a transaction whose read doc is changed by `beforeCommit` re-runs `fn` (count calls = 2) and the final doc reflects both writes; `failWrites` makes `set` reject with `permission-denied`.

- [ ] **Step 2: Write the failing OwnerStore tests** in `test/storage-owner-tx.test.mjs`:
  - **Lost-update guard (the must-fix):** seed `jobBilling/proj_n` with one labor line; `beforeCommit` lands a second line written "by Billing" (status `in-progress`); `mutateJobBilling(proj_n, cur => ({ ...cur, laborLines: [...cur.laborLines, newLine] }))` → the final doc has **all three** lines and the `in-progress` one is untouched.
  - `setJobBilling(k, { laborLines: [] })` throws `/laborLines/`.
  - `setCutDateOverride` on a doc that becomes `billed` in `beforeCommit` → rejects "already priced", the doc is unchanged; bad date `'2026-13-01'` → rejects.
  - `setNoCharge` on/off/refusals.
  - `mutateCustomerBilling` keeps `openInvoice` set by a concurrent writer.
  - `setSetting('pricing', { lists: {...} })` keeps `defaultList`; stamps `savedBy`.
  - `loadAll` with an empty fake db seeds `laborTypes, materials, pricing, qbItems, invoicing` (5 docs) and `priceListFor('cust_x')` returns the standard list; with `pricing` deleted from the cache `priceListFor` → `null`.
  - A failed transaction (`failWrites`) rejects, warns once, leaves the cache unchanged, emits nothing.

- [ ] **Step 3: Run to verify failure** — `node --test test/storage-owner-tx.test.mjs`.

- [ ] **Step 4: Implement.** Replace `write()`-based writers with one internal helper:

```js
  // Read-modify-write inside a transaction (Phase 1 ledger must-fix: never rebuild an owner doc
  // from the cache). fn receives a COPY of the current SERVER doc (or makeDefault()) and returns
  // the next doc; it may throw to abort with that message. fn can run up to 5 times — keep it pure.
  async function mutate(name, id, makeDefault, fn, stamp) {
    const copy = d => JSON.parse(JSON.stringify(d));
    if (!db) {
      const next = stamp(fn(copy(caches[name][id] || makeDefault())));
      caches[name][id] = next; emit(); return next;
    }
    const ref = db.collection(name).doc(id);
    let next;
    try {
      next = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const n = stamp(fn(copy(snap.exists ? snap.data() : makeDefault())));
        tx.set(ref, n);
        return n;
      });
    } catch (e) {
      if (!e || !e.ownerRefusal) console.warn(`Firestore ${name}/${id} write failed:`, e);
      throw e;
    }
    caches[name][id] = next; emit(); return next;
  }
```

(Refusals thrown by `fn` carry `ownerRefusal: true` so they are shown, not warned.) Then rebuild `mutateJobBilling`, `setJobBilling`, `mutateSheetBilling`, `setCutDateOverride`, `setNoCharge`, `mutateCustomerBilling`, `setCustomerBilling`, `rememberMaterialDefault`, `setSetting` on it. The cache is now updated **after** the commit (not optimistically) — the UI waits for the save, which is what every owner form already does (`Couldn't save — …` on failure).

- [ ] **Step 5: Update the Phase 1 tests that change for a stated reason** (and no others):
  - `P17: seeds are written…` → expected ids `['invoicing', 'laborTypes', 'materials', 'pricing', 'qbItems']`.
  - The two `P18` tests (`writers return the write promise and reject…`, `…resolve to the doc…`) → re-point at `makeDb()` from the shared helper (`failWrites` for the reject case). Same intent.
  - Run `npm test` → all pass.

- [ ] **Step 6: Commit** — `fix(storage-owner): every jobBilling/sheetBilling/customerBilling/settings write is a read-modify-write transaction (Phase 1 must-fix); Phase 2 seeds — pricing, QuickBooks items, invoicing`.

---

### Task 7: Job card + job details on the transactional writers; labor types end to end; No charge; customer-change guard

**Files:**
- Modify: `js/job-card.js`, `js/job-details.js`, `index.html` (rush labels get ids; `?v=` bumps happen in Task 14's single index.html pass — note them in the commit message here)
- Modify: `test/job-card.test.mjs`
- Create: tests appended to `test/job-card.test.mjs` (pure functions exported for the new logic)

**What changes and why:**

1. **Labor lines through `mutateJobBilling`** (must-fix). `line-add`, `line-remove`, `done`, `notready` each become one `OwnerStore.mutateJobBilling(jobKey, cur => …, by)` whose function re-checks on the **server** copy:
   - add: refuse if `cur.readyForBilling` ("This job is marked ready — click Edit — not ready yet first.");
   - remove: refuse unless that line's status is `unbilled` ("That line is already on invoice N.");
   - done: refuse unless `cur.laborLines.length || cur.noDesignTime`;
   - notready: refuse if any line is `in-progress`/`billed` ("Design hours on this job are already on an invoice.").
   Export these four as pure functions `JobCard.applyLineAdd(cur, line)`, `applyLineRemove(cur, lineId)`, `applyDone(cur, by, nowMs)`, `applyNotReady(cur)` (throw `Object.assign(new Error(msg), { ownerRefusal: true })`) so node tests cover them without DOM.
2. **Labor types end to end.** The hours dropdown reads `OwnerStore.laborTypes()` (seeded live at Phase 1 H6 with Design $150 / min 1 h and CAM $85 / min 0.5 h; editable in Settings › Labor types, Task 12). When the list is **empty** (seed failed, or Travis removed every type) the add row is replaced by `No Design/CAM types yet — add them in Settings › Labor types.` and nothing is clickable. Each option reads `Design — $150/hr (min 1 h per job)` (Decision 7), and the caption under the hours list reads "Minimums apply per job: Design 1 h, CAM 0.5 h in total — short hours are topped up on the last line of that type." (values from `laborTypes()`). A line whose `typeId` no longer exists shows its `typeName` snapshot plus `(type removed — Billing can't price this line)` and Billing lists the job under Needs attention (Task 11).
3. **Add-line race (parked Phase 1 finding):** capture `const jobAtClick = container.dataset.jobName` before the await; clear the hours/note inputs and set the status text only if `container.dataset.jobName === jobAtClick` afterwards.
4. **Sheet words:** `sheetStatus` gains `external` → `No charge` (Decision 3) — and for a billed-outside customer's job the panel caption reads `Billed outside this app` (from `customerBilling.billedOutsideApp`). Collin's rows are unchanged (this file renders nothing for him).
5. **No charge** (Decision 3): on the owner panel, each **cut, unbilled** sheet row gets a small `No charge` link; an `external` row gets `Undo no charge`. Both call `OwnerStore.setNoCharge`. Disabled unless `OwnerStore.loaded('sheetBilling')`.
6. **Job details** (`js/job-details.js`):
   - Save becomes one `OwnerStore.mutateJobBilling(jobKey, cur => applyDetails(cur, form), by)`; `applyDetails` keeps `laborLines`, `readyForBilling`, `noDesignTime` from the server copy (a details edit can never wipe hours).
   - **Customer-change guard** (Decision 6): `applyDetails` refuses a customer change when any of the job's labor lines is not `unbilled`, and the form refuses it before saving when any of the job's sheets has `sheetBilling` status `in-progress`/`billed` ("<job> already has billed work for <old customer>; its customer can't change."). When the job is finished (exported) and nothing is billed, the form shows the warning "The Master Job Log rows for this job stay on the <old> tab — move them by hand." and saves on a second click.
   - Material snapshot gains `taxable` (from the chosen material) — `{ kind, materialId, name, pricePerSheet, taxable }`.
   - Materials hint: `No materials yet — add them in Settings › Materials.` (replaces the Phase 1 "arrives with Phase 2" text). The "Ours" radio enables itself once `settings/materials.items` is non-empty — no other change needed.
   - Rush labels: the two radio labels read their percentages from `OwnerStore.pricing().lists.standard.rush` (`48-hour rush (+50%)`), so a Settings change never leaves a wrong label.

- [ ] **Step 1: Failing tests** in `test/job-card.test.mjs` for the four `apply*` functions (each refusal and each success), and for `JobDetails.applyDetails` (exported; keeps lines/ready; refuses a customer change when a line is billed; carries `taxable`). Existing four job-card tests must still pass.
- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4:** `npm test` → all pass; `node tools/browser-check-phase1.mjs` → `SUITE: PASS` (Phase 1 flows — add line, Done, Edit job details — still work in PASTE mode).
- [ ] **Step 5: Manual PASTE check** (temp copy, both configs blanked; console stub from `CLAUDE.md` Testing safety step 5 with `jobCard` on): add a line, switch to another job during the save — the second job's inputs are untouched; empty the labor types in the console (`OwnerStore._seedForTests('settings','laborTypes',{types:[]}); rerenderCurrent()`) → the hint shows and nothing is clickable.
- [ ] **Step 6: Commit** — `fix(job-card, job-details): labor lines, Done/not-ready and job details saved through transactions; labor-type empty state + per-line minimum label; No charge; customer-change guard; add-line race`.

---

### Task 8: `LogRows.withBilling` + InvoiceStore planners (pure decision logic)

**Files:**
- Modify: `js/log-rows.js`, `test/log-rows.test.mjs`
- Create: `js/invoice-store.js` (planners only in this task)
- Create: `test/invoice-store.test.mjs`

**Interfaces:**
- `LogRows.withBilling(row, { invoiceNumber, poNumber, billed }) → row` — copies a key only when its value is not `null`/`undefined`/`''` (an empty PO never blanks column L). `invoice`/`po`/`billed` as strings.
- Invoice **draft** (built by `BillingModel.buildDraft`, Task 11) — the shape the planners consume:

```
{ number, customerKey, customerName, throughDate, invoiceDate, dueDate, dueTerm, poNumber,
  sheetKeys: [fileKey…], laborLineRefs: [{ jobKey, lineId }],
  lines, breakdown, total, priceListName,
  settingsSnapshot: { priceList, laborTypes, qbItems },
  perSheet: { [fileKey]: { jobKey, cutAt, cutDate, operator, priced: { handling, timeCharge, weekendPremium, repeatOf, hourlyRate, priceList }, row } },
  fingerprint: { sheets: { [fileKey]: { completedAt, cutDateOverride } },
                 jobs: { [jobKey]: { turnaround, materialKind, materialId, pricePerSheet, readyForBilling, labor: { [lineId]: { typeId, hours } } } } },
  csv }
```

  `perSheet[k].row` is `LogRows.build(sheet, completion, customerName)` **at lock time**, so the write-back always carries the cut time the sheet was priced on (Review Focus 5) and never needs the sheet docs again. `cutAt` is the completion's raw `completedAt` (same type as stored; the job card's Re-cut tag compares it as-is).
- Planners — each `(docs, args) → { writes: [{ col, id, doc }], invoice }` and **throws** `Object.assign(new Error(text), { code })`; `docs` is plain data read by the executor:
  - `planLock({ invoice, customer, sheetBilling: {k: doc|null}, completions: {k: doc|null}, jobBilling: {jk: doc|null} }, { draft, by, now })`:
    - `invoice` exists and is not `cancelled` → `number-used` ("3598 is already on Harbor Lane Pictures (Sep 24). Use another number.");
    - `customer.openInvoice` set and ≠ this number → `customer-busy` ("Finish invoice 3611 first — Imported OK or Cancel.") (Decision 2);
    - any sheet whose `sheetBilling.status` is not absent/`unbilled` → `sheet-taken` ("2 of these sheets were just put on invoice 3613.");
    - fingerprint mismatch on any sheet (`completedAt`, `cutDateOverride`) or job (`turnaround`, material kind/id/price, `readyForBilling` when labor is included, any included labor line missing / not `unbilled` / different `hours` or `typeId`) → `changed` ("Something changed since this screen was drawn — check the total and click again.");
    - `sheetKeys.length > 400` → `too-big`.
    - Writes: `invoices/{n}` = draft minus `fingerprint` + `{ status: 'in-progress', createdAt: prev ? prev.createdAt : now, createdBy: prev ? prev.createdBy : by, downloadedAt: now, downloadedBy: by, importedAt: null, importedBy: null, cancelledAt: null, cancelledBy: null, poAddedAt: null, poAddedBy: null, logWritten: false, logError: null, logWrittenAt: null, history: prev ? [...(prev.history||[]), { status: prev.status, customerName: prev.customerName, total: prev.total, sheetKeys: prev.sheetKeys, cancelledAt: prev.cancelledAt, cancelledBy: prev.cancelledBy }] : [], updatedAt: now, updatedBy: by }` (a cancelled number re-used keeps its `createdAt/createdBy` — the rules require it); every `sheetBilling/{k}` = current-or-default + `{ status: 'in-progress', invoiceNumber, jobKey, customerKey, lockedAt, lockedBy, updatedAt, updatedBy }`; each touched `jobBilling/{jk}` with the referenced lines set `{ status: 'in-progress', invoiceNumber }`; `customerBilling/{ck}.openInvoice = number`.
  - `planImport({ invoice, customer, sheetBilling, jobBilling }, { number, by, now })` — invoice must be `in-progress` (else `state`); each sheet must be `in-progress` with this `invoiceNumber` (else `state`). Writes: invoice `{ status: 'imported', importedAt, importedBy, updatedAt, updatedBy }` (exactly the keys the rule allows); sheets `{ status: 'billed', billedAt: now, cutAtBilled: perSheet.cutAt, priced: perSheet.priced, poNumber: invoice.poNumber || null }`; labor lines `{ status: 'billed', billedAt: now }`; `openInvoice: null` when it equals this number.
  - `planCancel(…)` — invoice must be `in-progress`; sheets still `in-progress` on this number → `{ status: 'unbilled', invoiceNumber: null, lockedAt: null, lockedBy: null }`; lines `in-progress` on this number → `{ status: 'unbilled', invoiceNumber: null }`; invoice `{ status: 'cancelled', cancelledAt, cancelledBy, updatedAt, updatedBy }`; `openInvoice: null`.
  - `planAddPo({ invoice, sheetBilling }, { number, po, by, now })` — invoice must be `imported`; writes invoice `{ poNumber, poAddedAt, poAddedBy, updatedAt, updatedBy }` and each billed sheet `{ poNumber }`.
  - `logRowsFor(invoice) → rows` = `sheetKeys.map(k => LogRows.withBilling(perSheet[k].row, { invoiceNumber: number, poNumber: invoice.poNumber, billed: 'Y' }))` (Decision 5: column N = `Y`).

- [ ] **Step 1: Failing tests** `test/invoice-store.test.mjs` (require `pricing.js`, `log-rows.js`, `invoice-store.js`; build a two-sheet + one-labor-line draft by hand): every refusal code above; a re-used cancelled number keeps `createdAt/createdBy` and appends `history`; lock writes exactly the listed keys (assert each write's `doc` with `deepEqual` on the new fields); import writes only rule-allowed invoice keys (assert `Object.keys(invoiceWrite)` ⊂ the rule list); import copies `cutAt` → `cutAtBilled` and `priced` from the snapshot even if the "live" completion passed in differs (re-cut between lock and import); cancel releases only this invoice's sheets/lines (a sheet already moved to another invoice is left alone); add PO on an `in-progress` invoice → `state`; `logRowsFor` carries K = number, N = `Y`, L only when a PO exists, and F = the **lock-time** cut time.
  - `log-rows.test.mjs`: `withBilling` skips `''`/`null`; does not mutate its input.
- [ ] **Step 2–4:** fail → implement (the planners are plain functions inside the `InvoiceStore` IIFE, exported as `InvoiceStore._plan.{lock, import, cancel, addPo}` and `InvoiceStore.logRowsFor`) → `npm test` passes.
- [ ] **Step 5: Commit** — `feat(invoice-store): pure planners for lock / Imported OK / Cancel / Add PO with refusal codes; LogRows.withBilling; log rows carry the lock-time cut`.

---

### Task 9: InvoiceStore executors — transactions, listeners, number suggestion, log write-back

**Files:**
- Modify: `js/invoice-store.js`
- Create: `test/invoice-store-exec.test.mjs`
- Modify: `index.html` — `<script src="js/invoice-store.js?v=1"></script>` after `storage-owner.js` and `log-rows.js` (order: pricing, log-rows, invoice-lines, storage-owner, invoice-store — move tags if needed; nothing else reads them at load time)

**Interfaces (global `InvoiceStore`):**
- `init(db, deps)` — `deps = { getIdToken: () => Promise<string>, upsertLogRows: (rows, token) => Promise<result>, hasDatabase: () => bool }` (app.js passes `Auth.getIdToken`, `Endpoint.upsertLogRows`, `hasDatabase`).
- `loadAll()` — one-shot `invoices.orderBy('number','desc').limit(40)` (no `where`: no composite index) + two listeners: the same query, and `where('status','==','in-progress')` (no `orderBy`). Cache by id; emit on change. Offline/`fromCache` → `loaded()` false (the screens disable money buttons).
- `onChange(cb)`, `loaded()`, `get(number)`, `inProgress()` (sorted by number), `recentImported(n = 20)` (from the cache, status `imported`, number desc).
- `suggestNumber() → number` = `max(highest cached number, OwnerStore.invoicing().seedNumber) + 1`.
- `checkNumber(n) → Promise<{ state: 'free' } | { state: 'used', invoice } | { state: 'cancelled', invoice } | { state: 'invalid' }>` — positive whole number only; one `get` of `invoices/{n}` (cache in no-db mode).
- `lockAndCreate(draft, by)`, `markImported(number, by)`, `cancel(number, by)`, `addPo(number, po, by)` → each: in a `db.runTransaction`, `tx.get` every doc the planner needs (all reads first), call the planner, `tx.set(ref, doc)` each write (whole docs — the planner merged them onto what it read), commit; then update `OwnerStore` caches via its listeners (they already listen) and the invoice cache; emit. No db → read the same docs from `OwnerStore`/`Storage`/own caches, run the same planner, apply with `OwnerStore._putLocal` + own cache. Refusals propagate with their `code`.
- `markImported` and `addPo` then call `writeBack(number, by)`; `writeBack` = `deps.upsertLogRows(InvoiceStore.logRowsFor(inv), await deps.getIdToken())` → on success (an `offline` result counts only when `!deps.hasDatabase()`, the same rule as Collin's export) update the invoice `{ logWritten: true, logError: null, logWrittenAt }`, else `{ logWritten: false, logError: <reason> }`. **The invoice stays `imported` either way** (money never depends on the log). A labor-only invoice (no sheets) → `logWritten: true` with no call. `writeBack` is also the **Retry log update** action.

- [ ] **Step 1: Failing tests** `test/invoice-store-exec.test.mjs` with `makeDb()`:
  - Lock happy path: invoice doc, sheet docs and labor lines exactly as planned; `openInvoice` set.
  - **Concurrent lock (Review Focus 1):** two `lockAndCreate` calls for drafts sharing one sheet, the second started from `beforeCommit` of the first → first resolves, second rejects `sheet-taken`; exactly one invoice doc exists.
  - Same number from two owners → second rejects `number-used`.
  - Fingerprint: change a completion's `completedAt` in the fake db before the call → rejects `changed`, **no** doc written.
  - Import → sheets billed, `writeBack` called with 2 rows; `upsertLogRows` rejecting → invoice `imported` + `logWritten:false` + `logError` text; a second `writeBack` succeeding clears it.
  - `offline:true` result with `hasDatabase() === true` → `logWritten:false`, reason "Master Job Log connection isn't set up on this computer".
  - Cancel → sheets `unbilled`, `openInvoice` null; re-lock with the same number reuses it (rules shape: `createdAt` unchanged).
  - `suggestNumber` with an empty cache → `seedNumber + 1` (3604); with cached 3611 → 3612.
  - `checkNumber('abc')` → invalid; existing imported → used; cancelled → cancelled.
  - No-db mode: the same lock/import/cancel against `OwnerStore` caches (no `init` db) gives the same results.
- [ ] **Step 2–4:** fail → implement → `npm test` passes.
- [ ] **Step 5: Commit** — `feat(invoice-store): transactional lock-and-create / Imported OK / Cancel / Add PO, invoice listeners without composite indexes, number suggestion, log write-back that never blocks billing`.

---

### Task 10: Emulator check — the real client code against the real Phase 2 rules

**Files:**
- Create: `tools/emulator-check-phase2.mjs`

**What it does:** loads the Firebase **compat** SDK from the HQ worktree's `node_modules` (`firebase/compat/app`, `/auth`, `/firestore`), signs in to the **Auth emulator** as an owner and as Collin (emails parsed from `HQ/.worktrees/jt-billing-phase-2/firestore.rules` exactly like the verify scripts, never printed), points `firebase.firestore()` at the **Firestore emulator**, `require`s `js/pricing.js`, `js/log-rows.js`, `js/storage-owner.js`, `js/invoice-store.js` from this worktree, seeds fake data (Northlight Studios, `NL_Bridge_Wall_Panels`) through the admin-bypass path, and runs:

1. Owner: `OwnerStore.loadAll()` seeds the 5 settings docs; `mutateJobBilling` adds a labor line; `setCutDateOverride` works.
2. Owner: `lockAndCreate` → the rules accept every write in the transaction (this is the real proof that planner output satisfies Task 1's rules).
3. Owner: a second `lockAndCreate` on an overlapping sheet → `sheet-taken`; with the same number → `number-used` (the rules would also refuse the `createdAt` change).
4. Owner: `markImported` (stub `upsertLogRows` → ok) → invoice `imported`, sheets `billed`; then `cancel` → refused (`state`); a raw `update` of the imported invoice's `total` → **denied by rules**.
5. Owner: `addPo` → allowed.
6. Owner: lock a second invoice, `cancel` it, re-lock with the same number → allowed, `createdAt` unchanged.
7. Collin: `OwnerStore.mutateSheetBilling`, `InvoiceStore.lockAndCreate` and a raw `get` of `invoices/` → all **denied**.

**Safety:** the first line of `main()` exits with `REFUSING: FIRESTORE_EMULATOR_HOST is not set — this script only runs inside "firebase emulators:exec"` unless that variable is set. It never reads `js/firebase-config.js`.

- [ ] **Step 1: Write the script** (PASS:/FAIL: lines, `SUITE: PASS|FAIL`, exit 1 on any failure).
- [ ] **Step 2: Run it** from the HQ worktree:

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/HQ/.worktrees/jt-billing-phase-2"
export PATH="/c/Users/Golden Boys/AppData/Local/Programs/jdk-21.0.12.1+1/bin:$PATH"
export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Users\\Public\\jtmp"; mkdir -p /c/Users/Public/jtmp
npx firebase emulators:exec --only firestore,auth --project cnc-job-tracker "node \"../../../CNC_WebApp/.worktrees/customer-billing-phase-2/tools/emulator-check-phase2.mjs\""
```

Expected: `SUITE: PASS`. Also run `node tools/emulator-check-phase2.mjs` directly (no emulator) → prints `REFUSING:` and exits 1.

- [ ] **Step 3: Commit** — `test(emulator): Phase 2 client transactions against the HQ rules in the emulator — owner lock/import/cancel/PO/re-use, rules deny edits to imported invoices, Collin denied`.

---

### Task 11: `js/billing-model.js` — the Billing list, row states, draft and fingerprint (pure)

**Files:**
- Create: `js/billing-model.js`
- Create: `test/billing-model.test.mjs`
- Modify: `index.html` — script tag after `invoice-lines.js`

**Interfaces (global `BillingModel`):**
- `defaultThroughDate(todayYmd, weekEndingDay) → 'YYYY-MM-DD'` — most recent `weekEndingDay` on or before today (Mon 2026-10-05 → Sat 2026-10-03; Sat 2026-10-03 → itself).
- `build(input) → model`. `input = { sheets, completionOf(fk), sheetBillingOf(fk), jobBillingOf(jk), customerBillingOf(ck), projectCustomerOf(jk), customerKeyOf(name), noteKey(jobName), compare(a, b), laborTypes, throughDate | null, billingStart | null, inProgressInvoices }`. Sheets are grouped by `noteKey(sheet.jobName || sheet.fileName)`, de-duplicated by `fileKey`, ordered with `compare` (1-based `order` over **all** the job's sheets, active and finished).
  Per sheet: `sb = sheetBillingOf(fk)`, `status = sb ? sb.status : 'unbilled'`, `cutDate = Pricing.effectiveCutDate(completionOf(fk), sb)`:
  `external` → ignored · `billed` → `priorBilled` entry `{ jobKey, signature, order }` (never listed — **a re-cut never re-bills**: a billed sheet with a different `completedAt` is still only prior-billed) · `in-progress` → locked · unbilled & no cut date → uncut · cut before `billingStart` → `beforeStart` (Decision 1) · cut after `throughDate` → later · else **eligible**.
  Labor (only when `jobBilling.readyForBilling`): lines `status` unbilled (absent = unbilled) and `enteredAt ≥ billingStart` (start-of-day local ms); never date-gated by `throughDate` (§15.4).
  - **Needs job details** (`model.needsDetails`): a job with **at least one sheet** (sheetless `jobs/` docs are never read, so they can never appear — Phase 1 must-fix) whose `jobBilling` lacks customer, material kind or turnaround; skipped when its `projectCustomer` name maps to a `billedOutsideApp` customer, or when it has nothing billable now or later (all sheets external/billed/before start). Each `{ jobKey, jobName, customerName | null, missing: ['customer'|'material'|'turnaround'], sheetCount }`; "No customer" when `customerName` is null.
  - **Needs attention** (`model.needsAttention`): jobs with details whose included labor references a missing labor type, or whose customer's price list is missing — `{ jobKey, jobName, reason }`. Not billable until fixed.
  - **Customers** (`model.customers`, sorted by name; `billedOutsideApp` customers never appear): `{ customerKey, customerName, priceListName, busyInvoice: number | null, rows, lockedSheets, uncutSheets, laterSheets, laterFirstDate, summary }`.
  - **Row** per job with eligible sheets or eligible labor: `{ jobKey, jobName, state, defaultIncluded, sheetKeys, laborLineIds, uncutCount, laterCount, lockedCount, zeroTimeCount, sheetInputs, priorBilled, jobInput }`:
    - `ready` — job ready, no uncut sheets → sheets + labor included by default;
    - `partly` — some sheets uncut → cut sheets **opt-in** ("Add the N cut sheets"); labor of a ready job is included by default (§15.4), shown as its own amount;
    - `waiting` — all cut, job not ready → sheets opt-in ("Bill the N cut sheets anyway"), no labor;
    - `labor-only` — ready, no eligible sheets, eligible labor → included.
    `sheetInputs` are `priceInvoice` sheet inputs (`totalTimeSec` from `Pricing.parseTimeSec`, `toolpathCount`, `hasVbit` from `Pricing.sheetHasVbit`, `cutDate`, `order`, `sheetLabel = sheetTitle || fileName`). `jobInput = { jobName, turnaround, material, includeLabor, laborLines }`.
  - `busyInvoice` = the number of an `in-progress` invoice for that customer (Decision 2); a busy customer's card shows "Finish invoice NNNN first (Imported OK or Cancel)." and no Bill button.
- `pricingInput(customer, selection, ctx) → priceInvoice input` — `selection = { [jobKey]: { sheets: bool } }` (absent → `row.defaultIncluded`); labor rides with the row's state as above; `ctx = { priceList, laborTypes }`.
- `rowAmount(row, ctx) → number` — prices that row alone (its sheets **and** its labor) and returns `perJob[jobKey].subtotal` (the unrounded per-job figure the mockup shows, e.g. $885.25). This calls `Pricing.priceInvoice` — no arithmetic of its own.
- `summaryText(customer)` — "2 jobs · 14 sheets cut Sep 29 – Oct 3 · 1 sheet cut Oct 4 waits for next week"; dashed text "Nothing ready — 2 cut sheets are on invoice 3611 (in progress), 4 still to cut."
- `rowDetail(row, priced)` — "10 sheets · 3 designs, 7 repeats · 3 h 09 m Aspire time · customer supplied" / "4 sheets · 48-hour rush · 1 weekend sheet · 1.5 design hrs"; appends " · 1 sheet has no Aspire time" when `zeroTimeCount`.
- `buildDraft({ customer, selection, priced, lines, number, invoiceDate, dueDate, dueTerm, poNumber, throughDate, settings, sheetsByKey, completionOf, sheetBillingOf, jobBillingOf, csv }) → draft` (shape in Task 8), including `perSheet[k].row = LogRows.build(sheet, completion, customerName)` and the fingerprint read from the same accessors.

- [ ] **Step 1: Failing tests** `test/billing-model.test.mjs` — build small worlds with fake names (Northlight Studios, Harbor Lane Pictures, Copperline Stage, Ridgeway Vans):
  - `defaultThroughDate` (Mon → previous Sat; Sat → same day; Sun → the day before).
  - Ready job, all cut → one `ready` row, included; `rowAmount` = 885.25 for the Example A world.
  - Through date: a sheet cut Sun Oct 4 with through Sat Oct 3 → `laterCount 1`, summary says "waits for next week"; `throughDate: null` ("Everything to date") includes it.
  - Partly cut ready job → `partly`, sheets not included by default, labor included; selection `{ sheets: true }` includes them.
  - Waiting job → `waiting`, nothing by default, no labor even when selected.
  - Labor-only row after all sheets billed.
  - **Needs job details ignores sheetless jobs:** a `jobBillingOf` world that knows a job with zero sheets → not listed; a job with 2 sheets and no `jobBilling` → listed with `missing: ['customer','material','turnaround']` under "No customer"; same job whose `projectCustomer` is a billed-outside customer → not listed.
  - `billedOutsideApp` customer → no card. External sheet → never counted. In-progress sheet → `lockedSheets`, dashed summary text. Busy customer → `busyInvoice` set.
  - **Re-cut never re-bills:** a `billed` sheet whose live `completedAt` differs from `cutAtBilled` → not eligible; appears only in `priorBilled`.
  - Billing start date: a sheet cut the day before → `beforeStart` (not eligible, not in Needs); a labor line entered before → excluded.
  - Labor line with a removed type → `needsAttention`, row not billable.
  - `buildDraft`: `perSheet[k].row.completedTime` is the formatted completion at build time; fingerprint carries `completedAt`/`cutDateOverride`/labor hours; `sheetKeys` follow the selection.
- [ ] **Step 2–4:** fail → implement → `npm test` passes.
- [ ] **Step 5: Commit** — `feat(billing-model): Billing list (ready / partly cut / waiting / labor-only), through-date and billing-start gates, Needs job details from sheets only, re-cuts never re-billed, invoice draft + fingerprint`.

---

### Task 12: Settings cards I — Prices, Labor types, QuickBooks, Invoicing

**Files:**
- Modify: `js/settings.js` (+ `module.exports` shim exporting the pure `validate*` functions; the DOM part is untouched by node)
- Modify: `index.html` (four `<section class="settings-card">` blocks before "Customers (billing)"; remove the "arrive with Phase 2" line)
- Modify: `css/style.css` (`.settings-form-row`, `.settings-table`)
- Create: `test/settings-validate.test.mjs`

**Cards** (each a plain form with **Save** and a caption "Saved by <name> · Oct 6" from `savedBy/savedAt`; Save calls `OwnerStore.setSetting`; errors show in `#settings-status` as `Couldn't save — …`; every Save button is disabled unless `OwnerStore.loaded('settings')`):

- **Prices** (`settings/pricing`, list `standard` — the layout leaves room for a future "Add price list"; no such button): First-sheet handling ($), Repeat handling ($), Hourly rate ($/hr of Aspire time), 48-hour rush (%), 24-hour rush (%), Weekend (%), Cut minimum ($), Round to ($). Percentages shown as whole numbers, stored as fractions (`50` ↔ `0.5`). `validatePrices(form) → { ok, list } | { ok:false, error }`: all numbers ≥ 0, round-to > 0, rush/weekend ≤ 300%.
- **Labor types** (`settings/laborTypes.types`): one row per type — Name, Rate ($/hr), Minimum hours, QuickBooks item (exact name) — plus **Add type** and **Remove**. Existing `id`s never change (labor lines reference them); a new row's id is `lt_<slug>_<random4>`. `validateLaborTypes(rows, inUseTypeIds)`: names non-empty and unique, rate ≥ 0, min hours ≥ 0, QuickBooks item non-empty; **removing a type that an unbilled labor line still uses is refused** ("Design is used on 2 jobs that aren't billed yet."). A **Restore Design and CAM** button appears when the list is empty (writes the Phase 1 seed values: Design $150 / 1 h, CAM $85 / 0.5 h, item `Digital Design`).
- **QuickBooks** (`settings/qbItems`): item for CNC work, item for materials, Taxable for CNC (Y/N) and for labor (Y/N), with the hint "Must match the Product/Service name in QuickBooks exactly — the import fails on a typo." (Material taxability is per material, Task 13.) `validateQbItems`.
- **Invoicing** (`settings/invoicing`): Last QuickBooks invoice number (`seedNumber`, whole number — "The next suggestion is this + 1, unless a higher number was already used here"), Week ends on (Sunday…Saturday, default Saturday), Default due date (Due upon receipt / Net 15 / Net 30), **Billing starts on** (date, may be blank — Decision 1; hint: "Sheets cut before this date and design hours entered before it never show in Billing. Set it to the day after the last week billed the old way."). `validateInvoicing`.

- [ ] **Step 1: Failing tests** `test/settings-validate.test.mjs` for the four validators (percent round-trip `50 → 0.5 → 50`; negative and blank refusals; in-use labor type refusal; seed number must be a whole number; billing start must be a real date or blank).
- [ ] **Step 2–3:** fail → implement validators + cards.
- [ ] **Step 4:** `npm test`; PASTE manual check: Settings shows the seeded numbers; change hourly rate to 140 → Save → caption updates; set it back to 135.
- [ ] **Step 5: Commit** — `feat(settings): Prices, Labor types, QuickBooks items, Invoicing cards (spec §7.7, §15.8)`.

---

### Task 13: Settings cards II — Materials (with Taxable) and Customers (billing) price list + remembered defaults

**Files:** `js/settings.js`, `index.html`, `css/style.css`, `test/settings-validate.test.mjs`

- **Materials** (`settings/materials.items`): rows Name, Thickness (in), Price per sheet ($), **Taxable** (checkbox, off by default — §15.8); Add / Remove. Ids `mat_<random6>`, never reused. `validateMaterials(rows)`: name non-empty, thickness > 0, price ≥ 0. Removing a material does not touch jobs that already chose it (their `jobBilling.material` is a snapshot). Hint: "Material is charged at cost per sheet, after rounding, and never counts toward the cut minimum."
- **Customers (billing)** (existing card): each row gains **Price list** (a select listing `Object.keys(pricing.lists)` — only "standard" today) and **Remembered material** — one chip per thickness from `defaultMaterialByThickness` ("0.75 in → customer supplied ×") where × forgets it. Writes through `OwnerStore.mutateCustomerBilling`.
- The card re-renders when `customers/` changes on another device (Phase 1 Task 9 minor: wire `Storage.onCustomersChange` → `SettingsScreen.render()` in app.js — one line, it is a hook).

- [ ] Steps: failing validator tests → implement → `npm test` → PASTE check (add "3/4 in Baltic birch", 0.75, $95, not taxable → the job-details form's "Ours" option enables and lists it) → commit `feat(settings): Materials (per-material Taxable) and customer price list + remembered material defaults`.

---

### Task 14: Billing screen B (`js/billing.js`) + the app.js hooks + `index.html` screens

**Files:**
- Create: `js/billing.js`
- Modify: `js/app.js` (hooks only), `js/storage.js` (`loadFinishedSheets({ strict })`), `index.html`, `css/style.css`

**index.html:**
- Projects header: `<button class="btn btn-ghost btn-sm" id="billing-btn" hidden>Billing</button>` before `#settings-btn`.
- `<div id="billing-screen" hidden>` (owners only comment, header "← Projects", title "Billing"): `#billing-status`, `#billing-reminders`, `#billing-needs`, the through-date box (`#billing-through-date` `<input type="date">`, `#billing-through-caption`, `#billing-everything-btn` "Everything to date"), `#billing-customers`, `#billing-recent`.
- `<div id="invoice-screen" hidden>` and `<div id="billing-done-screen" hidden>` skeletons (filled by Tasks 15–16).
- Script tags (after `job-card.js`): `billing-model.js?v=1` (if not already placed), `billing.js?v=1`, `invoice-screen.js?v=1`, `billing-done.js?v=1`. All `?v=` bumps from Global Constraints land in this task's commit.

**app.js hooks (and nothing else):**
- `hideAllScreens()` and `showLoginScreen()` also hide `#billing-screen`, `#invoice-screen`, `#billing-done-screen`.
- `applyFeatureNav()`: `billing-btn.hidden = !Features.on('billing')`; if billing is switched off while any of the three screens is open → `showProjectsScreen()`.
- `ownerHomeOnEmpty()` → `Features.on('jobCard') || Features.on('settings') || Features.on('billing')`.
- `rerenderCurrent()` → also `BillingScreen.render()` / `InvoiceScreen.render()` / `BillingDone.render()` when their screen is visible (each keeps its own state; a re-render never resets the through date, selections or typed invoice number).
- `loadOwnerStateThen`: after `OwnerStore.loadAll()`, `InvoiceStore.init(db, { getIdToken: () => Auth.getIdToken(), upsertLogRows: Endpoint.upsertLogRows, hasDatabase }); await InvoiceStore.loadAll(); InvoiceStore.onChange(rerenderCurrent);` (inside the existing try — any failure = operator view, as today).
- `openJobFromBilling(jobName, finishedList)`: if the job is on the active board → `currentProject = jobName; viewingFinished = false; showContentScreen()`; else `finishedSheets = finishedList; viewingFinished = true; currentProject = jobName; showContentScreen()`. (Back still returns to Projects — unchanged.)
- `BillingScreen.init({ hideOthers: hideAllScreens, onBack: showProjectsScreen, activeSheets: () => sheets, loadFinishedSheets: () => Storage.loadFinishedSheets({ strict: true }), noteKey, customerKey, compareSheets, openJob: openJobFromBilling, currentEmail: currentUserEmail, openInvoice: d => InvoiceScreen.show(d) })`; `billing-btn` click → `BillingScreen.show()`.

**storage.js:** `loadFinishedSheets(opts)` — with `{ strict: true }` it rethrows the Firestore error instead of returning `[]` (owners' Billing must say "couldn't load", never show an empty list as if nothing were due). Default behaviour unchanged for the Show finished toggle.

**billing.js behaviour (spec §7.4):**
- `show()`: hide others, show screen, `Loading…`, load finished sheets once per visit (`Refresh` link reloads), then render. On failure: `Couldn't load finished jobs — <reason>. Nothing is billable until this loads.` and no Bill buttons.
- Every money button is disabled unless `OwnerStore.loaded('jobBilling') && loaded('sheetBilling') && loaded('settings') && InvoiceStore.loaded()`, with the Phase 1 wording "Owner data didn't load — reload the page."
- **Reminders (amber):** one per `InvoiceStore.inProgress()` — "Invoice 3611 is still in progress · Copperline Stage · 2 sheets · downloaded Fri Oct 2. Did it import into QuickBooks?" with **Imported OK**, **Cancel 3611** (confirm: "Cancel invoice 3611? Its sheets go back to ready to bill.") and **Download again** (serves `BOM + invoice.csv` under `InvoiceLines.downloadName`). Imported OK → `InvoiceStore.markImported` → Done screen.
- **Needs job details** (red border): per job "NL_Stair_Rails — missing customer, material" with **Open job card** (`openJob`). **Needs attention**: same style, with its reason.
- **Bill work cut through** box: date input defaulting to `BillingModel.defaultThroughDate(today, invoicing.weekEndingDay)`, caption "Week ending Sat Oct 3. Sheets cut after it wait for next week's bill.", **Everything to date** (clears the filter; caption "Everything cut so far."). Changing it re-renders.
- **Customer cards**: header (name, summary, **Bill Northlight · $1,865** — total from `Pricing.priceInvoice(BillingModel.pricingInput(...))`, hidden when nothing is selected, when the customer is busy — "Finish invoice 3611 first (Imported OK or Cancel)." (Decision 2) — or when `InvoiceLines.finalize` refuses the selection with `mixed-taxable` — "Materials on this bill are taxed differently — bill those jobs separately." (Decision 4)). Rows per state with their texts and toggle buttons ("Add the 3 cut sheets" / "Remove them", "Bill the 4 cut sheets anyway"), detail line, per-row amount (`rowAmount`, formatted `$885.25`). Dashed card for customers with nothing ready. Selections live in module state keyed by customer + job.
- **Bill <customer>** → `openInvoice({ customerKey, selection, throughDate })` (Task 15 rebuilds the price from the same model at that moment).
- **Recent invoices** (bottom): last 20 imported — number, customer, date, total, PO — built in Task 16.

- [ ] **Step 1:** Implement the hooks + `storage.js` option with a node test added to `test/storage-finished.test.mjs` (strict rethrows; default still `[]`).
- [ ] **Step 2:** Implement `billing.js` (no arithmetic — totals only via `Pricing`, rows via `BillingModel`).
- [ ] **Step 3:** `npm test`; `node tools/browser-check-phase1.mjs` → `SUITE: PASS` (Collin's header and screens unchanged; the new button is hidden for him).
- [ ] **Step 4:** PASTE manual check with the owner stub + `billing: { on: true, users: ['t@x'] }`: upload the sample twice-named pair (see Task 17 setup), fill job details, mark both complete, Done (No design time) → the card shows one `ready` row and a Bill button whose amount equals `Pricing.priceInvoice(...)` in the console. Give two jobs of one customer ours materials with different Taxable → the card shows "Materials on this bill are taxed differently — bill those jobs separately." instead of the Bill button; untoggling one job brings the button back.
- [ ] **Step 5: Commit** — `feat(billing): Billing screen B — reminders, through-date box, Needs job details, customer cards with ready / partly cut / waiting rows; app.js hooks; strict finished-sheets load`.

---

### Task 15: Invoice screen (`js/invoice-screen.js`) — check the number, lock-then-download, imported / cancel

**Files:** create `js/invoice-screen.js`; modify `index.html` (fill `#invoice-screen`), `css/style.css`.

**Layout (spec §7.5, design target `InvoiceConfirm`):**
- Left — **What the customer is paying for**: the priced `breakdown` rows (`label` … `$amount`, negatives as `−$0.88`), then **Total**.
- Right — three numbered steps:
  1. **Check the invoice number.** `#invoice-number` pre-filled with `InvoiceStore.suggestNumber()`; caption "Suggested 3612 — the last number used here was 3611. Check it's the next number in QuickBooks (VanLab invoices use the same numbers)." On input (debounced 300 ms) → `InvoiceStore.checkNumber`: `used` → red "3598 is already on Harbor Lane Pictures (Sep 24). Use another number." and step 2 disabled; `cancelled` → grey "3598 was cancelled earlier — you can use it again."; `invalid` → red "Type a whole number." **PO #** optional ("from the customer — add later"). **Invoice date** = today (shown). **Due date**: quick picks **Due upon receipt** / **Net 15** / **Net 30** (default from `invoicing.defaultDue`) plus an editable date (a typed date selects "custom").
  2. **Download the QuickBooks file.** Two-line preview built from the finalized lines ("CNC Router Work — 14 sheets, rush, weekend $1,527.50" / "Digital Design — 1.5 h + rush $337.50"). Button **Download QuickBooks file for #3612**. Caption: "The file already has 3612 in it. The moment you download, these 14 sheets lock as Invoice 3612 — in progress, so nothing else can bill them. Then in QuickBooks: Sales › Invoices › Import, pick this file."
  3. **Did it import into QuickBooks?** **Imported OK — mark 14 sheets billed** and **Cancel 3612** (enabled only after step 2 committed, or when the screen was opened for an existing in-progress invoice).
- **Download click, in this exact order** (Review Focus 2):
  1. Disable the button; rebuild the model from current caches; re-price (`Pricing.priceInvoice`), `InvoiceLines.finalize`, `InvoiceLines.buildQuickBooksCsv` with the chosen number/dates; `BillingModel.buildDraft(...)`.
  2. `await InvoiceStore.lockAndCreate(draft, by)`.
  3. **Only if step 2 resolved:** create the Blob `BOM + draft.csv` (`text/csv;charset=utf-8`), `a.download = InvoiceLines.downloadName(customer, number)`, click, revoke later.
  4. If step 2 rejected: no Blob, no anchor. Show the refusal text by code (`number-used` → back to step 1 in red; `sheet-taken` / `customer-busy` → "Another owner just billed some of these. Back to Billing." + a **Back to Billing** button; `changed` → "Something changed since this screen was drawn — the total has been refreshed; check it and click again." and re-render with the new total; `mixed-taxable` (thrown by `finalize` before the lock) → the same text as the Billing card and no lock; anything else → `Couldn't lock the sheets — <message>. Nothing was downloaded.`).
- **Imported OK** → `InvoiceStore.markImported(n, by)` → `BillingDone.show(n)`. **Cancel** → confirm → `InvoiceStore.cancel(n, by)` → back to Billing with status "Invoice 3612 cancelled — its sheets are ready to bill again." Leaving via "← Billing" without choosing leaves the amber reminder.
- Guard: a selection over 400 sheets shows "That's more than 400 sheets — bill it in two parts (use the cut-through date)." and no download button.

- [ ] Steps: implement → `npm test` → PASTE manual check: download produces `QuickBooks Exports_<customer>_3604.csv`; open it — first char is the BOM, header line exact; job card shows "On invoice 3604 (in progress)" → Imported OK → "Billed · #3604". Then in the console replace `InvoiceStore.lockAndCreate = () => Promise.reject(Object.assign(new Error('x'), { code: 'sheet-taken' }))` and click Download on a fresh invoice → no file appears in Downloads, message shown.
- Commit — `feat(invoice-screen): check the number, lock-then-download (the file is served only after the lock commits), Imported OK / Cancel, due-date picks`.

---

### Task 16: Done screen, Recent invoices, Add PO, Retry log update

**Files:** create `js/billing-done.js`; modify `js/billing.js` (Recent invoices block + per-invoice log note), `index.html`, `css/style.css`.

- **Done** (`BillingDone.show(number)`, spec §7.6): "14 sheets billed on invoice #3612" · customer and total · "Those sheets won't show up in billing again." · log line: `logWritten` → "The Master Job Log now has #3612 on all 14 rows."; else "The log could not be updated (<logError>) — retry from Billing." · "Add the PO number any time from Billing › Recent invoices when the customer sends it." Buttons **Bill the next customer** (→ Billing) and **Back to Jobs** (→ Projects). No cut-report or archive buttons (Phase 3). A labor-only invoice says "1 design line billed on invoice #3612" and omits the log line.
- **Recent invoices** (Billing bottom): `InvoiceStore.recentImported(20)` — Number, Customer, Imported (date), Total, PO, and per row **Add PO** (inline input + Save → `InvoiceStore.addPo`; then the row shows the PO) and, when `logWritten === false`, a grey note "Log not updated: <reason>" with **Retry log update** (→ `InvoiceStore.writeBack`). A PO can be changed later the same way (it re-writes column L).
- Imported OK from the amber reminder also lands on Done.

- [ ] Steps: implement → `npm test` → PASTE manual: Imported OK with `Endpoint.upsertLogRows` stubbed to reject → Done shows the "could not be updated" line; Billing › Recent invoices shows Retry; restore the stub, Retry → note disappears; Add PO "PO-4471" → shows on the row → commit `feat(billing): Done screen, Recent invoices with Add PO and Retry log update (spec §7.4 bottom, §7.6)`.

---

### Task 17: Playwright pass — owner billing end to end vs Collin, in PASTE mode

**Files:** create `tools/browser-check-phase2.mjs` (copy the Phase 1 harness: temp copy, both configs blanked, in-process `node:http` server on port 0, `require('playwright')` from HQ's `node_modules`, `SUITE: PASS|FAIL`, exit 1 on failure, temp dir removed in `finally`).

**Setup inside the copy:** the tracked sample `260520_…_Sheet 9.html` and a copy named `…Sheet 10.html` (same content → same signature → design + repeat: handling $60 + $40). Owner stub: `Features._setForTests({ ...Features.defaults('t@x'), jobCard: { on: true, users: ['t@x'] }, billing: { on: true, users: ['t@x'] } }, 't@x')`, `OwnerStore.loadAll()`, `InvoiceStore.loadAll()`, `applyFeatureNav()`, `rerenderCurrent()`.

**Assertions:**
1. **Collin:** no `#billing-btn`; the Phase 1 Collin assertions (copy them) still hold; `node tools/browser-check-phase1.mjs` is run by the controller separately and must also PASS.
2. **Owner, billing off:** `#billing-btn` hidden.
3. **Owner, billing on:** upload both sheets → job details (Northlight Studios via "Other…", customer supplied, standard) → mark both sheets In Progress → Complete through the UI → job card: tick No design time → Done. Billing: one customer card, one `ready` row, **Bill Northlight Studios · $X** where `X` equals `Pricing.priceInvoice(...)` evaluated in the page from the same model and is a multiple of 5 and ≥ 150.
4. **Invoice:** suggested number `3604` (seed 3603); type `3604` after creating a dummy imported invoice 3604 in the cache → red "already on" and the download button disabled; back to 3605 → enabled.
5. **Lock before download:** stub `InvoiceStore.lockAndCreate` to reject with `sheet-taken` → click Download → no `download` event within 1500 ms, message visible; restore.
6. **Download:** the `download` event fires; `suggestedFilename()` matches `/QuickBooks Exports.*Northlight Studios.*3605\.csv/`; the file's bytes start with `EF BB BF`, line 1 equals the 11 QuickBooks headers, every data row starts `3605,Northlight Studios,`, the amounts sum to `X`. Job card sidebar/panel says "On invoice 3605 (in progress)"; Billing shows the amber reminder.
7. **Cancel** from the reminder → rows back to Cut; Billing card back. **Bill again with 3605** → soft "was cancelled earlier" note → Download → **Imported OK** → Done text "2 sheets billed on invoice #3605"; job card "Billed · #3605"; Billing has no Northlight card; Recent invoices lists 3605.
8. **Add PO** "PO-4471" → shown on the row.
9. **Log failure:** stub `Endpoint.upsertLogRows` to reject before Imported OK on a second invoice (second job) → Done shows the "could not be updated" line; Recent invoices shows Retry; restore + Retry → note gone.
10. **Through date:** correct a sheet's cut date (job card) to the day after the through date → the row moves to "waits for next week"; Everything to date brings it back.
11. **Needs job details:** with `jobDetails` switched off, upload a third job → Billing lists it under Needs job details; **Open job card** opens it.
12. **Billed outside:** tick Billed outside this app for the customer in Settings → its card disappears.
13. **Settings:** Prices card shows 60/40/135/50/75/50/150/5; Labor types shows Design and CAM; empty the types → the job card shows the "No Design/CAM types yet" hint.
14. No uncaught page errors anywhere (`pageerror` → FAIL).

- [ ] Steps: write → run `node tools/browser-check-phase2.mjs` twice → `SUITE: PASS` both times; run `node tools/browser-check-phase1.mjs` → `SUITE: PASS` → commit `test(browser): Phase 2 Playwright pass in PASTE mode — billing end to end, lock-before-download, cancel/reuse, PO, log retry, Collin unchanged`.

---

### Task 18: Docs — CLAUDE.md, spec status, vault note

**Files:** `CLAUDE.md` (repo), the spec's `**Status:**` line, `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign.md` (vault, no git).

- [ ] **CLAUDE.md file-structure block:** add `js/invoice-lines.js`, `js/invoice-store.js`, `js/billing-model.js`, `js/billing.js`, `js/invoice-screen.js`, `js/billing-done.js`, `tools/browser-check-phase2.mjs`, `tools/emulator-check-phase2.mjs`, `tools/build-pricing-fixtures.mjs`, `test/helpers/fake-firestore.cjs` — one line each, same style; update `js/pricing.js` ("priceInvoice() — the ONLY place price math lives"), `js/storage-owner.js` ("every write is a read-modify-write transaction"), `js/settings.js` (all cards).
- [ ] **Sheet record table:** `sheetBilling` row — remove "Phase 1 writes only `cutDateOverride`"; add `openInvoice` to `customerBilling`; add an `invoices/{number}` paragraph: doc id = number; statuses; `perSheet` snapshot; `csv` stored without BOM; rules transitions (HQ).
- [ ] **Testing safety:** add step 6 — owner billing in PASTE: add `billing: { on: true, users: ['t@x'] }` to the stub and call `InvoiceStore.loadAll()`; `node tools/browser-check-phase2.mjs`; transactions + rules: `tools/emulator-check-phase2.mjs` (emulator only — it refuses otherwise). Fix the stale "~line 2626" pointer if it moved.
- [ ] **Spec status line:** "… Phase 2 implemented <date> on branch customer-billing-phase-2 (plan: ../plans/2026-10-05-customer-billing-phase-2.md)."
- [ ] **Vault note:** Current Focus entry (date): Phase 2 built on `customer-billing-phase-2` + HQ `jt-billing-phase-2`, NOT merged; rollout B2 → B4 → B5 → B6 → B7 → B8/B9; open items (Eva's email; Phase 0 audit CSV). Tick nothing that is not done.
- [ ] Commit (repo files only) — `docs: Phase 2 files, invoices record, billing PASTE stub, spec status`.

---

### Task 19: Final verification + Fable whole-branch review (ask Travis first) + hand-off — no merge

- [ ] **Step 1: Verify before claiming** (read every number; don't assume):
  - `npm test` in the worktree → all pass (baseline 256 + the new tests; report the real count).
  - `node tools/browser-check-phase1.mjs` → `SUITE: PASS`; `node tools/browser-check-phase2.mjs` → `SUITE: PASS`.
  - HQ worktree: the Task 1 command → three `SUITE: PASS`; the Task 10 command → `SUITE: PASS`.
  - **Money only in pricing.js:** `grep -nE "\* *(0\.5|0\.75|135|60|40)\b|roundTo|round5|Math\.round\([^)]*/ *5" js/*.js | grep -v "js/pricing.js"` → nothing that computes a price (formatting `toFixed(2)` for display is fine; list and justify any hit).
  - **No real identities:** `grep -rnE "@gmail|@goldenboys|@wearevanlab|AIza" --include=*.js --include=*.mjs --include=*.cjs --include=*.md --include=*.html --include=*.json . | grep -v -e "js/firebase-config.js" -e "js/endpoint-config.js" -e "docs/superpowers/plans/"` → nothing (the plans only contain this grep pattern itself); fixtures contain only the four fake customers.
  - `git log --oneline master..customer-billing-phase-2` → one commit per task; `git status` clean in both worktrees.
- [ ] **Step 2: Ask Travis** — "Ready for the Fable whole-branch review of Phase 2 (one Fable run). OK to dispatch?" (tokens-low rule). On yes, dispatch `Agent` with `model: "fable"`; say so. Give it: the spec path, this plan's path, `git diff master...customer-billing-phase-2` (CNC) and `git diff master...jt-billing-phase-2` (HQ), and these questions: (1) can any path render a billing control, or read an owner collection, for an account whose `settings/features` read was denied; (2) is there any arithmetic on money outside `Pricing.priceInvoice`; (3) can a file download happen when `lockAndCreate` rejected; (4) can any sequence bill a sheet twice (two owners, cancel + re-use, partial then rest, re-cut, Collin's Clear, Put back); (5) does every planner write satisfy the Task 1 rules (compare key lists); (6) any `where` + `orderBy` on different fields; (7) is every owner write a transaction and every transaction function pure; (8) every `?v=` bumped; (9) Collin's screens byte-for-byte unchanged in behaviour; (10) fixtures and docs free of real names/ids.
- [ ] **Step 3: Apply findings** per `superpowers:receiving-code-review` (verify each before changing code), re-run Step 1, one `fix: review findings — …` commit; re-review the fix commit (Opus) if any finding was Important or worse.
- [ ] **Step 4: Hand-off to Travis** (short; 🔊 line if voice is on): branch ready, NOT merged; first B2 (rules deploy from HQ), then his go for B4; Eva still blocked on her email; the Phase 0 audit needs the Orville CSV before the first real bill. Do not push.

---

## Rollout checklist (spec §11.2; each line is a Travis "go")

**B1 — Answers.** Done 2026-10-05 — see Decisions (Travis, 2026-10-05) at the top of this plan.

**B2 — Rules deploy (HQ repo).** Merge `jt-billing-phase-2` into HQ `master` (after Task 19's review). From `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ`:

```bash
npx firebase login:list          # must show the account that owns the cnc-job-tracker project (as at Phase 1 H2)
npx firebase deploy --only firestore:rules --project hq
```

Verify the **deployed** text: Firebase console → Firestore → Rules → the `invoices` block contains `createdAt is number` and `jtInvoiceUpdateOk()`, the `sheetBilling` block contains `jtSheetBillingUpdateOk()`, and all 15 Job Tracker match blocks are present (`sheets completions projectNotes sheetNotes ticketHistory customers projectCustomer sheetAnnotations printQueue jobs jobBilling customerBilling sheetBilling settings invoices`). Safe before the code deploy: Phase 1 code writes `sheetBilling` only as `unbilled` and never writes `invoices`. Rollback = Rules history → previous ruleset → Publish.

**B3 — QuickBooks facts.** In QuickBooks: Sales › Products and services → write down the exact names of the items used for CNC work, design/CAM labor and materials (expected `CNC Router Work`, `Digital Design`, `Materials` — a single different character makes the import fail); Sales › Invoices → the **highest invoice number used so far** (VanLab invoices share the numbering, so it has likely moved past 3603 since 10/4); which materials are taxable.

**B4 — Merge + go-live.** Travis's go → delete the untracked copy of this plan in the main checkout → merge `customer-billing-phase-2` into `master` from the main checkout → push via the **go-live** skill → Pages build `built` → `curl -s https://huffman44-ctrl.github.io/CNC-Job-Tracker/ | grep -o 'app.js?v=[0-9]*'` → `app.js?v=36`. Remove both worktrees and delete both branches. **Then the shop PC and every open tracker tab: Ctrl+Shift+R.** Billing is off for everyone at this point; Collin sees no change.

**B5 — Settings (Travis signed in).** Ctrl+Shift+R → sign in → the first load seeds `settings/pricing`, `qbItems`, `invoicing` → **Settings**:
- Prices: 60 / 40 / 135 / 50% / 75% / 50% / 150 / 5 → leave or edit → Save.
- Labor types: Design $150 min 1 h, CAM $85 min 0.5 h, item `Digital Design` (seeded at Phase 1 H6; if the list is empty click **Restore Design and CAM**).
- QuickBooks: the exact item names from B3; Taxable N/N unless he says otherwise.
- Invoicing: Last QuickBooks invoice number = the number from B3; Week ends on Saturday; Default due Due upon receipt; **Billing starts on** = the day after the last week billed the old way (Decision 1).
- Materials: add each material Golden Boys supplies (name, thickness, price per sheet, Taxable) **before entering any job details** — a job keeps the price and Taxable it was saved with; a later Settings change only affects jobs saved after it.
- Customers (billing): tick **Billed outside this app** for VanLab, Golden Boys (in-house) and **ZZTEST** (the Phase 1 live-test customer — its finished sheets can never be deleted, so this keeps them out of Billing).

**B6 — Phase 0 audit (spec prerequisite).** Download the `Orville - Season 4` tab as CSV (vault Next Actions) → Claude runs the read-only double-billing check → Travis sees the result **before B7's real invoice**.

**B7 — Billing on for Travis.** Settings › Screens on/off → tick **Billing** in his column → **Billing** button appears. Check the list against what he knows is unbilled (anything already billed the old way → move Billing starts on, or use No charge). Pick one small real customer: compare the Bill total to a hand calculation (handling + time × $135, rush, weekend, rounding, minimum). **Bill** → check the number against QuickBooks → **Download** → QuickBooks: Sales › Invoices › **Import invoices** → pick the file → map/confirm → import → check the invoice in QuickBooks (items landed on `CNC Router Work` / `Digital Design`, total matches) → back in the tracker **Imported OK** → Done says the log has the number → Master Job Log: that customer's tab (refresh the tab first) → those rows have K = the invoice number, N = `Y`; for an Orville invoice, the `Orville — Job Log (Shared)` mirror shows K. If anything is wrong before Imported OK: **Cancel N** puts everything back.

**B8 — Eva (BLOCKED: her sign-in email).** First Phase 1 H1 + H9 (her Firebase account; her address in `jtOperatorEmails()` and `jtOwnerEmails()` in HQ rules → emulator verify → deploy; her uid in the live Apps Script `ALLOWED_UIDS` **and** `OWNER_UIDS` → Manage deployments → ✎ → New version — without `OWNER_UIDS` her Imported OK marks the invoice billed but the log write says "owner only" until retried). Then Settings › Screens → her column → tick Billing (and Job card / Settings as he wants).

**B9 — Acceptance (spec §11.2 step 3 / §12.5).** Eva bills one real invoice end to end on her device; Travis imports it into QuickBooks and confirms the items, the total, the invoice number in the log and on the Orville mirror.

**Rollback at any point:** Billing switch off (Settings, or edit `settings/features` in the console) → owners see the Phase 1 app; an in-progress invoice can still be cancelled by switching Billing back on; rules → previous ruleset from Rules history (Phase 1 rules still accept everything Phase 1 code does); code → revert the merge commit and push. Billed records and invoices stay as they are; nothing is deleted.

## Verification list (after B7, again after B9)

- [ ] The invoice in QuickBooks: customer name, every line's item, description, amount, Taxable and service date match the tracker's breakdown; the total equals the Bill button's total.
- [ ] Job card for the billed job: every billed sheet reads `Billed · #N`; design lines read `Billed · #N`; the job no longer appears in Billing; Recent invoices lists N with its total.
- [ ] Master Job Log: each billed sheet's row appears **once**; K = N; N column = `Y`; F (Completed Time) unchanged from Collin's export; L blank until Add PO, then the PO.
- [ ] Firestore console: `invoices/N` has `status: imported`, `logWritten: true`, `csv` present; `sheetBilling/<a billed fileKey>` has `status: billed`, `invoiceNumber: N`, `cutAtBilled`, `priced`; `customerBilling/<key>.openInvoice` is null.
- [ ] Rules playground (Collin's email, authenticated): Get `/invoices/N`, `/sheetBilling/<key>`, `/settings/pricing` → **Denied**. Owner: Update `/invoices/N` changing `total` → **Denied**.
- [ ] Collin's shop PC: Projects header unchanged (To Print, Ticket History, Manage Customers, + Upload Job — no Billing); job header unchanged; Mark Complete / Export CSV as before.
- [ ] Repo: no real email, uid, token or spreadsheet id outside the two config files; fixtures only fake names.

## Self-review (done while writing; left here so the executor can see what was checked)

**Spec coverage, Phase 2 (§11.2):** §8 priceInvoice (inputs/outputs, formula steps 1–9, examples A–E) → T2, T3; §8.5 deliberate differences (rush never on material, material after rounding and outside the minimum, weekend on handling+time, minimum per invoice) → T2 tests; §9 line types + QuickBooks CSV + filename → T5; §7.4 Billing B (reminders, through date, Everything to date, cards, ready/partly/waiting rows, Needs job details, dashed customers, external never shown, Recent invoices + Add PO) → T11, T14, T16; §7.5 Invoice (number suggestion/refusal/soft reuse, PO, invoice date, due picks per §15.8, preview, lock-then-download transaction re-reading every sheet, Imported OK, Cancel, log failure keeps money state) → T8, T9, T15; §7.6 Done → T16; §7.7 Settings (Prices, Labor types, QuickBooks, Materials with per-material Taxable, Customers price list + remembered defaults; Screens and Maintenance already shipped) → T12, T13; §5.6 invoices doc → T8/T9 (+ `invoiceDate`, `dueDate`, `dueTerm`, `perSheet`, `history`, `logWrittenAt` — see departures); §5.8 seeds (pricing, qbItems, invoicing; laborTypes/materials already seeded in Phase 1) → T6; §5.9 invoices/sheetBilling rules hardened → T1; §6.3 write-back (Imported OK: full row + K, N; Add PO: L) → T8/T9/T16; §10 one row builder → T8 (`withBilling` on `LogRows.build` output); §12.1 money tests (fixtures, pinned, invariants, weekday trap) → T2–T4; §12.2 rules matrix additions → T1 (+ T10 real client); §12.4 screen tests incl. lock-before-download → T17; §12.5 acceptance → B7/B9; §13 risks (two owners, Settings mid-invoice, re-cut, log failure) → Review Focus 1–7; §15 decisions honoured: seed 3603 (T6, B5 re-checks), due picks (T5/T15), per-material Taxable feeding the one Materials line (T3/T5/T13), Design $150 / CAM $85 with 1 h / 0.5 h minimums applied per job per type (Decision 7; T2/T7/T12), cut minimum per invoice (T2), labor never date-gated (T11), Trio spelling already handled in Phase 1.

**Phase 1 must-fix carry-over:** table near the top; each row names its task and test.

**Deliberate departures / interpretations (each named where it happens):** `invoice-lines.js` holds words and QuickBooks columns only, while `priceInvoice` returns the line *amounts* and the reconcile (spec §8.2 puts `lines` in the engine; §9 puts line-type builders in invoice-lines — split this way so money stays in one function) — T3/T5; `priced` and `cutAtBilled` are computed **at lock** (they must match the downloaded CSV) and copied into `sheetBilling` at Imported OK — T8; the invoice keeps a per-sheet log-row snapshot so the write-back carries the cut time it was priced on — T8; `invoices` gains `invoiceDate`, `dueDate`, `dueTerm`, `perSheet`, `history`, `logWrittenAt`, `poAddedBy`, `updatedAt/By` — T8; `customerBilling.openInvoice` as the per-customer lock (Decision 2) — T8; labor minimums per job per type with the shortfall shown on the last line of that type (Decision 7 — changes the estimator's per-line rule; spec §8.3 step 4 `Σ max(hours, minHours) × rate` now reads `Σ over types of max(Σ hours of that type on the job, minHours) × rate`) — T2/T3/T5/T7; one combined Materials line whose Taxable is the shared per-material value, a mixed bill refused rather than guessed (Decision 4) — T3/T5/T14; a reused cancelled number keeps its original `createdAt` and records the earlier attempt in `history` (the rules make `createdAt` immutable) — T1/T8; `sheetBilling` can never be *created* as `billed` (a Phase 3 backfill will need a rules change) — T1; 0-second sheets never grouped as repeats — T2; fixture sheet titles replaced by `Sheet N` (spec §12.1 said titles stay real; real titles can carry show names and this repo is public) — T4; Billing loads all finished sheets once per visit (fine for a few thousand sheets; when that grows, switch to per-job `where('jobName','in',…)` queries of open jobs — noted for Phase 3) — T14; `js/billing.js` + `js/invoice-screen.js` + `js/billing-done.js` instead of the spec's single `js/billing.js` (one file per screen) and `js/billing-model.js` + `js/invoice-store.js` as non-screen modules — file map; rush labels on the job-details form read Settings — T7; Settings writes are transactions too (not in the ledger, same reasoning) — T6.

**Placeholder scan:** `<travis-account-email>`, `<eva-account-email>`, `<collin-account-email>` and `PASTE_…` are deliberate. No "TBD"; no open questions remain — every task is written to the Decisions (Travis, 2026-10-05).

**Type consistency:** `Pricing.priceInvoice(input)` (T2/T3) ← `BillingModel.rowAmount`/`pricingInput` (T11), `billing.js` totals (T14), `invoice-screen.js` (T15); `InvoiceLines.finalize(priced, { qbItems, laborTypes })` (T5) ← T15; `InvoiceLines.buildQuickBooksCsv({ number, customerName, invoiceDate, dueDate, lines })` (T5) ← T15, and its output is `draft.csv` (T8/T11) re-served by Download again (T14/T16) with `InvoiceLines.BOM`; `BillingModel.buildDraft(...) → draft` (T11) ← `InvoiceStore.lockAndCreate(draft, by)` (T9) whose planner `planLock` reads `draft.fingerprint`/`perSheet` (T8); `OwnerStore.mutateJobBilling(jobKey, fn, by)` (T6) ← T7 job card/job details; `OwnerStore.setNoCharge(fileKey, on, refs, by)` (T6) ← T7; `OwnerStore.pricing()/qbItems()/invoicing()/priceListFor()` (T6) ← T11/T12/T14/T15; `OwnerStore._putLocal` (T6) ← InvoiceStore no-db path (T9); `InvoiceStore.suggestNumber()/checkNumber()/inProgress()/recentImported()/markImported()/cancel()/addPo()/writeBack()` (T9) ← T14/T15/T16; `LogRows.withBilling(row, billing)` (T8) ← `InvoiceStore.logRowsFor` (T8) → `Endpoint.upsertLogRows(rows, idToken)` (Phase 1, unchanged) whose keys `invoice/po/billed` match `apps-script/logging-endpoint.gs` (`logWriteBillingCells_`); `Storage.loadFinishedSheets({ strict })` (T14) ← `BillingScreen.init.loadFinishedSheets`; rules key lists (T1) = planner write keys (T8), cross-checked by the emulator run (T10).

**Review Focus → tests:** 1 → T9 "Concurrent lock" + T10 step 3; 2 → T15 order + T17 assertion 5; 3 → T8 `changed` + T9 fingerprint; 4 → T2 "partial bill then the rest"; 5 → T11 "Re-cut never re-bills" + T8 `logRowsFor` F; 6 → T9 log failure + T17 assertion 9; 7 → T8 `settingsSnapshot` + T16 Download again.
