# Customer Billing — Phase 1 (keep every sheet, job details, Collin-sees-nothing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sheet ever cut stays in the Job Tracker (a `finished` flag replaces delete-on-export), owners set job details at upload and see an owner panel on the job card, Collin's export writes one upserted log row per sheet with no customer question and no delete prompt, and every owner screen sits behind a switch Collin's account cannot read.

**Architecture:** Owner-only data (job details, labor hours, cut-date corrections, settings, switches) lives in collections Collin's Firestore rules deny outright (`jobBilling`, `sheetBilling`, `customerBilling`, `settings`), loaded by a new `js/storage-owner.js` only after `js/features.js` has read `settings/features` successfully. Operator-reachable changes (`sheets.finished`, `jobs/`) go into the existing `js/storage.js`. One file per screen — `js/job-details.js` (upload step + edit form), `js/job-card.js` (owner panel), `js/settings.js` (switches, customers, maintenance) — and `js/app.js` gains only the hooks that open them. The Master Job Log gains an `upsertRows` Apps Script action keyed on a new Sheet Key column; `js/log-rows.js` builds the row object so export and (Phase 2) billing can never disagree on a column.

**Tech Stack:** Vanilla JS IIFE modules with the `module.exports` shim, Firestore compat SDK 10.12.0, Firebase Auth, Apps Script (V8), `node --test` (Node 24), Firestore emulator + Auth emulator (HQ repo `.verify/` style), Playwright from `HQ/node_modules` for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md` — this plan implements **Phase 1 only** (spec §11.1). Phase 2 (pricing engine, Billing screen, invoices, QuickBooks CSV, full Settings) is a separate plan; this plan leaves only the hooks §11.1 names.

**Where decisions come from:** the spec's §15 answers (Travis, 2026-10-04) are settled — no backfill; Design $150 / CAM $85 with `minHours` 1 / 0.5; `Trio Flatmount` is the QuickBooks spelling; invoice seed 3603 (Phase 2); Collin keeps "Export CSV"; **Eva's sign-in email is still open — never guess it** (it blocks only her allowlist, her Apps Script uids and her switches: hand step H9).

## Global Constraints

- **Never run the app against the real config.** Every browser check runs from a temp copy with BOTH `js/firebase-config.js` → `const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };` and `js/endpoint-config.js` → `const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };` (repo `CLAUDE.md` → Testing safety). Log tests run against a **COPY** of the Master Job Log through a scratch script deployment, exercised with browser-console `fetch` (curl does not work against Apps Script from this PC).
- **`master` is a live deploy** (GitHub Pages, no build step). All work happens in a git worktree on branch `customer-billing-phase-1`; nothing is pushed by this plan. The merge + push is Travis's go (hand step H5, go-live skill), after a Fable whole-branch review. Implementers run on Sonnet.
- **Collin's screens look exactly as today.** Nothing new renders unless `Features.on(<screen>)` is true, and `Features` is only ever true for an account that can read `settings/features`. Button text stays **Export CSV**.
- **No real emails, uids, tokens or spreadsheet ids in this repo.** This repo is public (Pages). Rules literals live in `HQ/firestore.rules` (copy the two addresses already there; never type them from memory). The Apps Script paste block is handed to Travis in-session; `apps-script/logging-endpoint.gs` keeps its `PASTE_…` placeholders and an empty `OWNER_UIDS`.
- **Fake names only** in tests, fixtures and docs: Northlight Studios, Harbor Lane Pictures, Copperline Stage, Ridgeway Vans.
- **Numbers live in Settings, not code.** Phase 1 seeds `settings/laborTypes` once (Design 150 / minHours 1, CAM 85 / minHours 0.5, both `qbItem: 'Digital Design'`) and reads them back from Firestore; nothing prices anything in Phase 1.
- **Firestore traps:** an equality `where` excludes docs that lack the field (hence the migration flag); `where` + `orderBy` on different fields needs a composite index that fails only in production — never combine them (sort client-side, as `onSheetsChange` already does); a collection with no rules match block is denied; `storage.js` writers swallow errors into `console.warn`, so a missing rule looks like "no data".
- **Master Job Log:** new columns at the right-hand end only (M `Sheet Key`, N `Billed`); never insert a column, never rename a tab or an existing header; `Orville - Season 4!A:L` mirror stays Commenter-only and unchanged.
- **Apps Script:** MERGE the paste block into the live script, never paste the repo file over it; republish with **Deploy → Manage deployments → ✎ → Version: New version** (never "New deployment", which mints a new URL).
- **Script cache-busting:** every modified JS/CSS file's `?v=` in `index.html` is bumped (`storage.js?v=16`, `endpoint.js?v=5`, `app.js?v=35`, `style.css?v=24`; new files `?v=1`).
- **Shop PC:** after go-live the shop-floor tab needs Ctrl+Shift+R on that machine; until then the old client still calls `appendRows` (kept) and still deletes on export (old code) — say so in the rollout.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but no screen mockup shows; each has its test pinned to the owning task.

1. **A legacy job exported before any owner filled details (or with `jobDetails` off):** the export must open today's customer picker, save the answer to `projectCustomer`, and finish normally — Task 11 browser check 2b.
2. **Log write succeeds, finish write fails (connection drops between the two):** the job must stay on the board with an honest alert, and the second export must update the same rows, never append — Task 5 test "same key twice → updated, not appended" + Task 11 step 3 alert path.
3. **Google Sheets auto-converting Completed Time cells to dates:** a billed row re-exported with the *same* cut time must not grow a false "Re-cut" note — Task 5 test "F holds a Date object for the same moment".
4. **Legacy `sheets/` docs with no `finished` field before the migration:** still on the board, still deletable from an active job, never dropped by the query — Task 1 verify (delete a doc without the field is ALLOWED) + Task 6 test (`filterActive` keeps docs without the field; `sheetsFilterReady()` false until the flag).
5. **Re-dropping a finished sheet's file:** blocking notice, nothing overwritten, other files in the same drop still load — Task 10 browser check 3.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `HQ/firestore.rules` (HQ repo) | modify | Job Tracker helper functions, every collection in spec §5.9, Eva placeholder comment |
| `HQ/.verify/verify-cnc-billing-rules.js` (HQ) | create | Emulator matrix from spec §12.2 |
| `HQ/.verify/verify-rules.js` (HQ) | modify | One assertion flips: a signed-in email outside the allowlist no longer reads `sheets/` |
| `js/pricing.js` | create | Phase 1 **helpers only**: `sheetHasVbit`, `parseTimeSec`, `signature`, `repeatGroups`, `localDate`, `isWeekendDate`, `effectiveCutDate`. Phase 2 adds `priceInvoice` here |
| `js/log-rows.js` | create | `LogRows.build()` — the §6.2 row object; `COLUMNS` (14) |
| `js/endpoint.js` | modify | `upsertLogRows(rows, idToken)` |
| `apps-script/logging-endpoint.gs` | modify | `upsertRows` action, `OWNER_UIDS`, 14-column `LOG_HEADER`, `ensureLogHeaders` |
| `js/storage.js` | modify | `finished` flag, migration-aware board query, `getSheetDoc`, `finishSheets`/`unfinishSheets`, `loadFinishedSheets`, `jobs/`, `migrateFinishedFlag` |
| `js/storage-owner.js` | create | `OwnerStore`: `jobBilling`, `sheetBilling`, `customerBilling`, `settings` caches + listeners, labor-type seed |
| `js/features.js` | create | `Features`: reads `settings/features`, creates the default doc on first owner sign-in, `on()`, `setSwitch()` |
| `js/settings.js` | create | Settings screen: Screens on/off grid, Customers (billing), Maintenance |
| `js/job-details.js` | create | Upload job-details step + Edit job details form; `thicknessFromMaterialInfo` |
| `js/job-card.js` | create | Owner panel on the job card, board-card chip, sidebar row tags, labor lines, Done — ready, cut-date correction, Put back on the board |
| `js/app.js` | modify | Hooks only: features load on sign-in, nav visibility, upload guard + job-details step, export (finish) flow, owner panel mount, finished-jobs toggle |
| `index.html` | modify | Settings screen section, job-details modal, `#owner-panel`, nav button + toggle (hidden), script tags, version bumps |
| `css/style.css` | modify | `.settings-*`, `.jd-*`, `.jc-*`, `.owner-panel`, `.modal-card--wide` |
| `tools/browser-check-phase1.mjs` | create | Playwright pass in PASTE mode (owner vs Collin) — lives in `tools/`, not `test/`, because `node --test` runs every file under `test/` |
| `test/*.test.mjs` | create/modify | Listed per task |
| `CLAUDE.md` | modify | Sheet record (§5.1) replaces the stale Storage bullets; file map; testing note |
| `docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md` | modify | Status line |
| `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign.md` (vault) | modify | Status entry (no git) |

## Travis hand steps (not code) — where they fall

| # | Step | When | Blocked by |
|---|---|---|---|
| H1 | Create Eva's Firebase Auth user (console), copy her uid | Any time | **Eva's email (open)** |
| H2 | Deploy rules from HQ, verify all 15 Job Tracker match blocks are in the deployed text | After Task 1 review, before H5 | — |
| H3 | Merge the Apps Script paste block into the live script; fill `OWNER_UIDS` (Travis's uid; Eva's when H1 is done); New version | After Task 5, before H5 | — |
| H3a | (Recommended) Scratch-script run of §12.3 against a COPY of the Master Job Log | After Task 5 | — |
| H4 | Trio consolidation in the Master Job Log; Manage Customers says `Trio Flatmount` | Before H8 | — |
| H5 | Merge + push (go-live skill), Pages `built`, live URL serves `app.js?v=35`; then shop PC + every open tracker tab Ctrl+Shift+R (nobody exports from any tab until the shop PC has refreshed) | After Task 15 | Travis's go |
| H6 | First owner sign-in; Settings › Maintenance › "Mark existing sheets as on the board" | After H5 | — |
| H7 | Switch Job card on for Travis; fill job details for jobs on the board; flag VanLab / Golden Boys "Billed outside this app" | After H6 | — |
| H8 | Collin's first export; Travis checks the log tab | After H6 | — |
| H9 | Eva: add her email to `jtOwnerEmails` + `jtOperatorEmails` in HQ rules and redeploy; add her uid to `ALLOWED_UIDS` + `OWNER_UIDS` (New version); Settings › Screens › Add column → tick her switches; she checks a job card | After H1 | **Eva's email (open)** |

Every hand step has its exact clicks in the **Rollout checklist** at the end.

---

### Task 0: Worktree and baseline (controller step)

**Files:** none changed.

- [ ] **Step 1: Create the worktree** (from the repo root `C:\Users\Golden Boys\Documents\Agemtic Workflows\CNC_WebApp`; `.worktrees/` is gitignored):

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git worktree add .worktrees/customer-billing-phase-1 -b customer-billing-phase-1 master
cd .worktrees/customer-billing-phase-1 && npm test 2>&1 | tail -8
```

Expected: `ℹ tests 173` / `ℹ fail 0`. Every later task runs from this worktree path. After each implementer reports DONE, run `git -C .worktrees/customer-billing-phase-1 log --oneline -1` and confirm the commit's parent is on `customer-billing-phase-1`, not `master` (memory: a Task 2 implementer once committed to master by cwd mismatch).

- [ ] **Step 2: HQ branch** (separate repo, its own commits):

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/HQ" && git status --short | head -3 && git checkout -b jt-billing-phase-1
```

Expected: clean tree, now on `jt-billing-phase-1`.

---

### Task 1: Firestore rules — every Phase 1 collection, Collin denied on billing (HQ repo)

**Files:**
- Modify: `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\firestore.rules` (whole Job Tracker section)
- Create: `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\.verify\verify-cnc-billing-rules.js`
- Modify: `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\.verify\verify-rules.js` (one assertion)

**Interfaces:**
- Produces: helper functions `jtOperatorEmails()`, `jtOwnerEmails()`, `isJtOperator()`, `isJtOwner()`, `sheetBillingLocked(id)`. **Not** `isOwner()` — HQ's rules already define `isOwner()` for its role-doc model (`dashboard`, `taskIntents`); the spec's helper names collide, so the Job Tracker helpers carry a `Jt` prefix.
- Deviation from spec §5.9, deliberate: `settings/migrations` is **readable by operators** (write stays owner). It holds only the migration flag the board query needs (Task 6); Collin's browser must be able to read it or his board would never switch to the filtered query. Every other `settings/*` doc stays owner-only.
- `sheetBilling` fields are **flat** (`status`, `invoiceNumber`, `poNumber`, `billedAt`, `cutAtBilled`, `cutDateOverride`, `priced`, `jobKey`, `customerKey`); the spec's `billing.` prefix in §5.1 is a namespace label, and its own rule text reads `.data.status`.

- [ ] **Step 1: Write the failing verify script**

`HQ/.verify/verify-cnc-billing-rules.js` (same shape as `verify-rules.js`; it reads the allowlists out of the rules file so no address is typed here):

```js
// Run under (Git Bash, from the HQ repo root):
//   export PATH="/c/Users/Golden Boys/AppData/Local/Programs/jdk-21.0.12.1+1/bin:$PATH"
//   export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Users\\Public\\jtmp"; mkdir -p /c/Users/Public/jtmp
//   npx firebase emulators:exec --only firestore,auth --project cnc-job-tracker "node .verify/verify-rules.js && node .verify/verify-cnc-billing-rules.js"
//
// Job Tracker Phase 1 rules (CNC_WebApp spec 2026-10-04 §5.9 / §12.2): operators (Travis,
// Collin, later Eva) keep the shop-floor collections; only owners can read or write anything
// that will ever hold money; sheets are never deleted once finished or billed; invoices keep
// their number. The allowlists are parsed out of firestore.rules so the test follows the file.
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
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
if (!TRAVIS || !COLLIN) throw new Error('rules must list at least one owner and one non-owner operator');

function assert(c, m) { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1; } else console.log('PASS: ' + m); }
async function denied(p) { try { await p; return false; } catch { return true; } }
async function allowed(p) { try { await p; return true; } catch (e) { console.error('  threw: ' + e.message); return false; } }

(async () => {
  const app = initializeApp({ projectId: 'cnc-job-tracker', apiKey: 'fake' });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  // Fixtures via the admin-bypass REST path (rules do not apply to seeding).
  await seedDoc('sheets', 'legacy1', { fileKey: 'legacy1', fileName: 'Legacy Sheet 1.html' });          // no finished field
  await seedDoc('sheets', 'active1', { fileKey: 'active1', finished: false });
  await seedDoc('sheets', 'done1',   { fileKey: 'done1',   finished: true });
  await seedDoc('sheets', 'billed1', { fileKey: 'billed1', finished: false });
  await seedDoc('sheetBilling', 'billed1', { status: 'billed', invoiceNumber: 3612 });
  await seedDoc('sheets', 'locked1', { fileKey: 'locked1', finished: false });
  await seedDoc('sheetBilling', 'locked1', { status: 'in-progress', invoiceNumber: 3613 });
  await seedDoc('sheets', 'ext1', { fileKey: 'ext1', finished: false });
  await seedDoc('sheetBilling', 'ext1', { status: 'external' });
  await seedDoc('settings', 'features', { settings: { on: true, users: [TRAVIS] } });
  await seedDoc('settings', 'migrations', { sheetsFinishedFlag: { done: true, count: 3 } });
  await seedDoc('jobs', 'proj_x', { jobName: 'Northlight Wall Panels', finished: false });

  // ── Unknown signed-in email: everything denied ──
  await signInAsUid(app, { localId: 'nobody-uid-000000000000001', email: 'nobody@verify-jt.local', password: 'password123' });
  assert(await denied(getDoc(doc(db, 'sheets', 'active1'))), 'unknown email: read sheets/ DENIED');
  assert(await denied(getDoc(doc(db, 'customers', 'c1'))), 'unknown email: read customers/ DENIED');
  assert(await denied(getDoc(doc(db, 'settings', 'migrations'))), 'unknown email: read settings/migrations DENIED');
  assert(await denied(setDoc(doc(db, 'jobs', 'proj_y'), { jobName: 'x' })), 'unknown email: write jobs/ DENIED');

  // ── Collin (operator, not owner) ──
  await signInAsUid(app, { localId: 'collin-uid-000000000000001', email: COLLIN, password: 'password123' });
  assert(await allowed(getDoc(doc(db, 'sheets', 'active1'))), 'Collin: read sheets/ ALLOWED');
  assert(await allowed(updateDoc(doc(db, 'sheets', 'active1'), { finished: true, finishedAt: 1, finishedBy: COLLIN })), 'Collin: write sheets.finished ALLOWED (export marks sheets finished)');
  await updateDoc(doc(db, 'sheets', 'active1'), { finished: false });
  assert(await allowed(setDoc(doc(db, 'jobs', 'proj_x'), { finished: true }, { merge: true })), 'Collin: update jobs/ ALLOWED');
  assert(await denied(deleteDoc(doc(db, 'jobs', 'proj_x'))), 'Collin: delete jobs/ DENIED (nobody deletes jobs)');
  assert(await allowed(getDoc(doc(db, 'customers', 'c1'))), 'Collin: read customers/ ALLOWED');
  assert(await allowed(setDoc(doc(db, 'projectCustomer', 'proj_x'), { name: 'Northlight Studios' })), 'Collin: write projectCustomer/ ALLOWED (export picker fallback)');
  assert(await allowed(getDoc(doc(db, 'settings', 'migrations'))), 'Collin: read settings/migrations ALLOWED (board query flag — the one operator-readable settings doc)');
  assert(await denied(setDoc(doc(db, 'settings', 'migrations'), { x: 1 })), 'Collin: write settings/migrations DENIED');
  for (const col of ['jobBilling', 'customerBilling', 'invoices']) {
    assert(await denied(getDoc(doc(db, col, 'any'))), `Collin: read ${col}/ DENIED`);
    assert(await denied(setDoc(doc(db, col, 'any'), { x: 1 })), `Collin: write ${col}/ DENIED`);
  }
  assert(await denied(getDoc(doc(db, 'sheetBilling', 'billed1'))), 'Collin: read sheetBilling/ DENIED');
  assert(await denied(getDoc(doc(db, 'settings', 'features'))), 'Collin: read settings/features DENIED (this is what hides every owner screen)');
  assert(await denied(deleteDoc(doc(db, 'sheets', 'done1'))), 'Collin: delete a finished sheet DENIED');
  assert(await allowed(deleteDoc(doc(db, 'sheets', 'legacy1'))), 'Collin: delete a legacy sheet with no finished field ALLOWED (Review Focus 4)');

  // ── Travis (owner) ──
  await signInAsUid(app, { localId: 'travis-uid-000000000000001', email: TRAVIS, password: 'password123' });
  assert(await allowed(getDoc(doc(db, 'settings', 'features'))), 'owner: read settings/features ALLOWED');
  assert(await allowed(setDoc(doc(db, 'jobBilling', 'proj_x'), { jobName: 'Northlight Wall Panels', turnaround: 'standard' })), 'owner: write jobBilling/ ALLOWED');
  assert(await allowed(setDoc(doc(db, 'customerBilling', 'cust_1'), { name: 'Ridgeway Vans', billedOutsideApp: true })), 'owner: write customerBilling/ ALLOWED');
  assert(await allowed(setDoc(doc(db, 'sheetBilling', 'active1'), { status: 'unbilled', cutDateOverride: '2026-10-02' })), 'owner: write sheetBilling/ ALLOWED');
  assert(await denied(deleteDoc(doc(db, 'sheetBilling', 'active1'))), 'owner: delete sheetBilling/ DENIED (never deleted)');
  assert(await denied(deleteDoc(doc(db, 'sheets', 'done1'))), 'owner: delete a finished sheet DENIED');
  assert(await denied(deleteDoc(doc(db, 'sheets', 'billed1'))), 'owner: delete a billed sheet DENIED');
  assert(await denied(deleteDoc(doc(db, 'sheets', 'locked1'))), 'owner: delete a sheet on an in-progress invoice DENIED');
  assert(await allowed(deleteDoc(doc(db, 'sheets', 'ext1'))), 'owner: delete an unfinished sheet marked external ALLOWED');
  assert(await allowed(deleteDoc(doc(db, 'sheets', 'active1'))), 'owner: delete an unbilled active sheet ALLOWED');
  assert(await allowed(setDoc(doc(db, 'invoices', '3612'), { number: 3612, status: 'in-progress', customerName: 'Northlight Studios' })), 'owner: create invoices/3612 in-progress ALLOWED');
  assert(await denied(setDoc(doc(db, 'invoices', '3613'), { number: 3613, status: 'imported' })), 'owner: create an invoice that is not in-progress DENIED');
  assert(await denied(setDoc(doc(db, 'invoices', '3614'), { number: 3615, status: 'in-progress' })), 'owner: create an invoice whose number differs from its id DENIED');
  assert(await denied(updateDoc(doc(db, 'invoices', '3612'), { number: 3699 })), 'owner: change invoices/3612.number DENIED');
  assert(await allowed(updateDoc(doc(db, 'invoices', '3612'), { status: 'imported' })), 'owner: update invoices/3612 status (number unchanged) ALLOWED');
  assert(await denied(deleteDoc(doc(db, 'invoices', '3612'))), 'owner: delete invoices/ DENIED');
  assert(await allowed(getDoc(doc(db, 'printQueue', 'p1'))), 'owner: read printQueue/ ALLOWED (owners are operators too)');

  // ── Eva, once her address is in the file ──
  if (OWNERS.length > 1) {
    await signInAsUid(app, { localId: 'eva-uid-00000000000000001', email: OWNERS[1], password: 'password123' });
    assert(await allowed(getDoc(doc(db, 'customers', 'c1'))), 'Eva: read customers/ ALLOWED');
    assert(await allowed(setDoc(doc(db, 'printQueue', 'p2'), { kind: 'stickers', lines: ['A'], size: '3x1', printedAt: null })), 'Eva: write printQueue/ ALLOWED');
    assert(await allowed(getDoc(doc(db, 'jobBilling', 'proj_x'))), 'Eva: read jobBilling/ ALLOWED');
  } else {
    console.log('NOTE: jtOwnerEmails() lists one owner — Eva checks skipped until her address is added (hand step H9).');
  }

  console.log(process.exitCode ? 'SUITE: FAIL' : 'SUITE: PASS');
})();
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/HQ"
export PATH="/c/Users/Golden Boys/AppData/Local/Programs/jdk-21.0.12.1+1/bin:$PATH"
export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Users\\Public\\jtmp"; mkdir -p /c/Users/Public/jtmp
npx firebase emulators:exec --only firestore,auth --project cnc-job-tracker "node .verify/verify-cnc-billing-rules.js"
```

Expected: the script throws `firestore.rules has no jtOwnerEmails()` before any assertion.

- [ ] **Step 3: Rewrite the Job Tracker section of `firestore.rules`**

Keep lines 1–28 (`isSignedIn`, `role`, `isOwner`, `users`, `dashboard`, `taskIntents`) and the `entity_*` block **verbatim**. Replace everything from the `// Job Tracker data:` comment through the `printQueue` line with:

```
    // ── Job Tracker (CNC_WebApp) — Phase 1 of the customer-billing redesign, spec
    //    CNC_WebApp/docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md §5.9.
    //    Roles are the signed-in email against two literal lists. Operators = everyone on the
    //    shop floor; owners = Travis and Eva (full co-owner, identical access).
    //    `Jt` prefix: isOwner() above is HQ's role-doc owner — a different thing.
    //    A collection with no match block is DENIED — keep this list complete (the 2026-08-19
    //    rewrite dropped three collections by omission).
    function jtOperatorEmails() { return ['<travis-account-email>', '<collin-account-email>']; }
    function jtOwnerEmails()    { return ['<travis-account-email>']; }   // + Eva's address: hand step H9, never guessed
    function isJtOperator() { return isSignedIn() && request.auth.token.email in jtOperatorEmails(); }
    function isJtOwner()    { return isSignedIn() && request.auth.token.email in jtOwnerEmails(); }
    function sheetBillingLocked(id) {
      return exists(/databases/$(database)/documents/sheetBilling/$(id))
          && get(/databases/$(database)/documents/sheetBilling/$(id)).data.status in ['in-progress', 'billed'];
    }

    // Operator collections. Sheets are never deleted once finished or on an invoice;
    // `.get('finished', false)` keeps legacy docs (no field yet) deletable until the migration stamps them.
    match /sheets/{id} {
      allow read, create, update: if isJtOperator();
      allow delete: if isJtOperator() && resource.data.get('finished', false) != true && !sheetBillingLocked(id);
    }
    match /completions/{id}      { allow read, write: if isJtOperator(); }
    match /projectNotes/{id}     { allow read, write: if isJtOperator(); }
    match /sheetNotes/{id}       { allow read, write: if isJtOperator(); }
    match /ticketHistory/{id}    { allow read, write: if isJtOperator(); }
    match /customers/{id}        { allow read, write: if isJtOperator(); }
    match /projectCustomer/{id}  { allow read, write: if isJtOperator(); }
    match /sheetAnnotations/{id} { allow read, write: if isJtOperator(); }
    match /printQueue/{id}       { allow read, write: if isJtOperator(); }
    match /jobs/{id} {
      allow read, create, update: if isJtOperator();
      allow delete: if false;
    }

    // Owner collections — anything that will ever hold a price, hours, billed status or a switch.
    // Collin's account cannot read a single field here, so no browser-side bug can leak one.
    match /jobBilling/{id}      { allow read, write: if isJtOwner(); }
    match /customerBilling/{id} { allow read, write: if isJtOwner(); }
    match /sheetBilling/{id} {
      allow read, create, update: if isJtOwner();
      allow delete: if false;
    }
    match /settings/{name} {
      // settings/migrations carries only the sheets-finished migration flag the board query
      // needs on every device, so operators may READ that one doc. Everything else: owners.
      allow read: if isJtOwner() || (name == 'migrations' && isJtOperator());
      allow write: if isJtOwner();
    }
    // Phase 2 writes these; shipping the block now (empty collection) is safe. The doc id IS the
    // invoice number, so the number can never change and a create must say in-progress.
    match /invoices/{number} {
      allow read: if isJtOwner();
      allow create: if isJtOwner()
                    && request.resource.data.status == 'in-progress'
                    && string(request.resource.data.number) == number;
      allow update: if isJtOwner() && request.resource.data.number == resource.data.number;
      allow delete: if false;
    }
```

Then replace `'<travis-account-email>'` and `'<collin-account-email>'` with the two literal addresses that are in the file you are editing right now (the old `customers` line: Travis's is the `huffman44` one, Collin's the `777litch777` one). Do not type them from memory — copy them.

- [ ] **Step 4: Flip the one stale assertion in `verify-rules.js`**

Replace

```js
  let signedInSheetsReadOk = false;
  try { await getDoc(doc(db, 'sheets', 'any')); signedInSheetsReadOk = true; } catch {}
  assert(signedInSheetsReadOk, 'signed-in read of sheets/ is ALLOWED');
```

with

```js
  // Phase 1 of the Job Tracker billing redesign (2026-10-04) tightened sheets/ from "any
  // signed-in" to the operator email allowlist; this verify account is not on it.
  let outsiderSheetsDenied = false;
  try { await getDoc(doc(db, 'sheets', 'any')); } catch { outsiderSheetsDenied = true; }
  assert(outsiderSheetsDenied, 'a signed-in email outside the Job Tracker allowlist cannot read sheets/ (the allowed case is in verify-cnc-billing-rules.js)');
```

- [ ] **Step 5: Run both verify scripts**

Same command as Step 2 but `"node .verify/verify-rules.js && node .verify/verify-cnc-billing-rules.js"`.
Expected: both end `SUITE: PASS`; the new one prints the `NOTE: jtOwnerEmails() lists one owner` line.

- [ ] **Step 6: Count the match blocks (the 2026-08-19 lesson)**

```bash
grep -c "match /" firestore.rules; grep -o "match /[A-Za-z_]*" firestore.rules | sort | tr '\n' ' '
```

Expected count **23**: `users dashboard taskIntents sheets completions projectNotes sheetNotes ticketHistory customers projectCustomer sheetAnnotations printQueue jobs jobBilling customerBilling sheetBilling settings invoices` + the five `entity_*`. The 15 Job Tracker names (sheets … invoices) are the checklist hand step H2 re-reads against the deployed text.

- [ ] **Step 7: Commit (HQ repo)**

```bash
git add firestore.rules .verify/verify-cnc-billing-rules.js .verify/verify-rules.js
git commit -m "security(rules): Job Tracker billing phase 1 — owner/operator email helpers, jobs/jobBilling/sheetBilling/customerBilling/settings/invoices, no delete of finished or billed sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Not deployed here — hand step H2.

---

### Task 2: `js/pricing.js` — sheet-identity and cut-date helpers (no money yet)

**Files:**
- Create: `js/pricing.js`
- Create: `test/pricing-helpers.test.mjs`
- Modify: `js/app.js` — `VBIT_KEYWORDS` + `sheetHasVbit` (~line 1408) delegate to `Pricing`
- Modify: `index.html` — script tag

**Interfaces:**
- Produces (global `Pricing`, `module.exports` in Node):
  - `Pricing.sheetHasVbit(sheet) → boolean` — the rule the log's "Has V-bit" column already uses
  - `Pricing.parseTimeSec('HH:MM:SS') → number` (blank/garbage → 0)
  - `Pricing.formatDuration(sec) → '3 h 09 m' | '12 m'`
  - `Pricing.signature(sheet) → 'sec|toolpathCount|V-or--'` (spec §8.1)
  - `Pricing.repeatGroups(orderedSheets) → { [fileKey]: { signature, repeatOf: number|null } }` — `repeatOf` = 1-based display position of the design's first sheet
  - `Pricing.repeatCount(orderedSheets) → number`
  - `Pricing.localDate(iso) → 'YYYY-MM-DD' | null` (local, never a slice of the ISO string)
  - `Pricing.isWeekendDate('YYYY-MM-DD') → boolean` (parsed as local parts)
  - `Pricing.effectiveCutDate(completion, sheetBilling) → 'YYYY-MM-DD' | null` — override ?? completedAt
- Phase 2 adds `priceInvoice()` to this same file; nothing here computes a dollar.

- [ ] **Step 1: Write the failing tests**

`test/pricing-helpers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

const sheet = (fileKey, totalTime, names, extra = {}) =>
  ({ fileKey, totalTime, toolpaths: names.map(name => ({ name })), ...extra });

test('parseTimeSec reads HH:MM:SS, MM:SS and blanks', () => {
  assert.equal(Pricing.parseTimeSec('00:15:09'), 909);
  assert.equal(Pricing.parseTimeSec('3:09:00'), 11340);
  assert.equal(Pricing.parseTimeSec('12:30'), 750);
  assert.equal(Pricing.parseTimeSec(''), 0);
  assert.equal(Pricing.parseTimeSec('n/a'), 0);
});

test('formatDuration', () => {
  assert.equal(Pricing.formatDuration(11340), '3 h 09 m');
  assert.equal(Pricing.formatDuration(720), '12 m');
  assert.equal(Pricing.formatDuration(0), '0 m');
});

test('sheetHasVbit matches the log rule, case-insensitively', () => {
  assert.equal(Pricing.sheetHasVbit(sheet('a', '', ['Profile', 'V-Carve Letters'])), true);
  assert.equal(Pricing.sheetHasVbit(sheet('b', '', ['v groove'])), true);
  assert.equal(Pricing.sheetHasVbit(sheet('c', '', ['Pocket', 'Drill'])), false);
  assert.equal(Pricing.sheetHasVbit({}), false);
});

test('signature: same time + count + vbit is the same design; a V-bit sheet of equal time is NOT', () => {
  const a = sheet('a', '00:15:09', ['Profile', 'Pocket']);
  const b = sheet('b', '00:15:09', ['Pocket', 'Profile']);
  const v = sheet('v', '00:15:09', ['Profile', 'V-Carve']);
  assert.equal(Pricing.signature(a), '909|2|-');
  assert.equal(Pricing.signature(a), Pricing.signature(b));
  assert.notEqual(Pricing.signature(a), Pricing.signature(v));
});

test('repeatGroups: first of a design is null, repeats point at its 1-based position', () => {
  const s1 = sheet('k1', '00:15:09', ['P', 'Q']);
  const s2 = sheet('k2', '00:12:00', ['P']);
  const s3 = sheet('k3', '00:15:09', ['P', 'Q']);
  const s4 = sheet('k4', '00:15:09', ['P', 'Q']);
  const g = Pricing.repeatGroups([s1, s2, s3, s4]);
  assert.equal(g.k1.repeatOf, null);
  assert.equal(g.k2.repeatOf, null);
  assert.equal(g.k3.repeatOf, 1);
  assert.equal(g.k4.repeatOf, 1);
  assert.equal(Pricing.repeatCount([s1, s2, s3, s4]), 2);
  assert.equal(Pricing.repeatCount([s1, s2]), 0);
});

test('localDate uses the local calendar day, not the UTC one', () => {
  // 23:30 local on Oct 3 — whatever the zone, the local day must come back.
  const d = new Date(2026, 9, 3, 23, 30);
  assert.equal(Pricing.localDate(d.toISOString()), '2026-10-03');
  assert.equal(Pricing.localDate(null), null);
  assert.equal(Pricing.localDate('garbage'), null);
});

test('isWeekendDate: Sat Oct 3 and Sun Oct 4 2026 are weekend, Mon Oct 5 is not', () => {
  assert.equal(Pricing.isWeekendDate('2026-10-03'), true);
  assert.equal(Pricing.isWeekendDate('2026-10-04'), true);
  assert.equal(Pricing.isWeekendDate('2026-10-05'), false);
  assert.equal(Pricing.isWeekendDate(''), false);
});

test('effectiveCutDate: owner override wins; not-cut sheets have none', () => {
  const done = { status: 'complete', completedAt: new Date(2026, 9, 3, 9, 12).toISOString() };
  assert.equal(Pricing.effectiveCutDate(done, null), '2026-10-03');
  assert.equal(Pricing.effectiveCutDate(done, { cutDateOverride: '2026-10-02' }), '2026-10-02');
  assert.equal(Pricing.effectiveCutDate({ status: 'in-progress' }, null), null);
  assert.equal(Pricing.effectiveCutDate(null, null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/pricing-helpers.test.mjs`
Expected: FAIL — `Cannot find module '../js/pricing.js'`

- [ ] **Step 3: Implement `js/pricing.js`**

```js
/**
 * js/pricing.js — the ONE place that knows what makes two sheets "the same design", how an
 * Aspire time is read, and what a sheet's cut date is. Phase 1 (2026-10-04 spec §8.1, §12.1)
 * ships only these helpers; Phase 2 adds priceInvoice() here and NOTHING ELSE in the app does
 * price math. Pure: no DOM, no Firestore, no Date.now() — callers pass dates.
 * Browser global `Pricing`; module.exports for node --test.
 */
const Pricing = (() => {
  // Moved here from app.js so the log's "Has V-bit" column and the repeat rule read one list.
  const VBIT_KEYWORDS = ['V-Carve', 'V-carve', 'V Carve', 'VCarve', 'V-Groove', 'V-groove', 'V Groove'];

  function sheetHasVbit(sheet) {
    const toolpaths = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths : [];
    return toolpaths.some(tp => VBIT_KEYWORDS.some(kw => new RegExp(kw, 'i').test((tp && tp.name) || '')));
  }

  // 'HH:MM:SS' (Aspire) or 'MM:SS' -> seconds. Anything unreadable is 0, never NaN.
  function parseTimeSec(text) {
    const parts = String(text || '').trim().split(':');
    if (!parts.length || parts.some(p => !/^\d+$/.test(p))) return 0;
    return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
  }

  // Spec §8.1: signature = totalTimeSec | toolpathCount | V-bit flag. Two sheets of one job with
  // the same signature are one design (the first pays handlingFirst, the rest handlingRepeat).
  function signature(sheet) {
    const count = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths.length : 0;
    return `${parseTimeSec(sheet && sheet.totalTime)}|${count}|${sheetHasVbit(sheet) ? 'V' : '-'}`;
  }

  // orderedSheets = one job's sheets in display order (app.js compareSheets).
  function repeatGroups(orderedSheets) {
    const firstPosition = {};
    const out = {};
    (orderedSheets || []).forEach((sheet, i) => {
      const sig = signature(sheet);
      if (firstPosition[sig] === undefined) {
        firstPosition[sig] = i + 1;
        out[sheet.fileKey] = { signature: sig, repeatOf: null };
      } else {
        out[sheet.fileKey] = { signature: sig, repeatOf: firstPosition[sig] };
      }
    });
    return out;
  }

  function repeatCount(orderedSheets) {
    return Object.values(repeatGroups(orderedSheets)).filter(g => g.repeatOf !== null).length;
  }

  // ISO timestamp -> local 'YYYY-MM-DD'. Never slice the ISO string: it is UTC and shifts the
  // weekday in US zones (spec §12.1 "weekday fixture trap").
  function localDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 'YYYY-MM-DD' parsed as LOCAL parts (new Date('2026-10-03') would be UTC midnight).
  function isWeekendDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return false;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return day === 0 || day === 6;
  }

  // The owner's correction (sheetBilling.cutDateOverride) wins over Collin's completion time.
  function effectiveCutDate(completion, sheetBilling) {
    if (sheetBilling && sheetBilling.cutDateOverride) return sheetBilling.cutDateOverride;
    if (completion && completion.status === 'complete' && completion.completedAt) return localDate(completion.completedAt);
    return null;
  }

  return { VBIT_KEYWORDS, sheetHasVbit, parseTimeSec, formatDuration, signature, repeatGroups, repeatCount, localDate, isWeekendDate, effectiveCutDate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pricing;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/pricing-helpers.test.mjs`
Expected: 8 passing.

- [ ] **Step 5: Point app.js at it and load it**

In `js/app.js` replace

```js
const VBIT_KEYWORDS = ['V-Carve', 'V-carve', 'V Carve', 'VCarve', 'V-Groove', 'V-groove', 'V Groove'];

function sheetHasVbit(sheet) {
  const toolpaths = sheet.toolpaths || [];
  return toolpaths.some(tp => VBIT_KEYWORDS.some(kw => new RegExp(kw, 'i').test(tp.name || '')));
}
```

with

```js
// One rule for "has a V-bit" — the log column, the CSV and the repeat detection all read Pricing.
function sheetHasVbit(sheet) { return Pricing.sheetHasVbit(sheet); }
```

In `index.html` add, directly after the `js/parser.js?v=7` script tag:

```html
  <script src="js/pricing.js?v=1"></script>
```

- [ ] **Step 6: Whole suite, commit**

Run: `npm test` — expected all passing (173 + 8).

```bash
git add js/pricing.js test/pricing-helpers.test.mjs js/app.js index.html
git commit -m "feat(pricing): sheet signature, repeat groups, V-bit rule and local cut-date helpers (phase 1, no money math)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `js/log-rows.js` — the one row builder

**Files:**
- Create: `js/log-rows.js`
- Create: `test/log-rows.test.mjs`
- Modify: `index.html` — script tag after `pricing.js`

**Interfaces:**
- Consumes: `Pricing.sheetHasVbit` (Task 2) — in the browser as the global, in Node via `require('./pricing.js')`.
- Produces (global `LogRows`):
  - `LogRows.COLUMNS` — the 14 header names, in column order A–N
  - `LogRows.build(sheet, completion, customerName, billing?) → row` where `row = { key, sheet, job, totalTime, toolpathCount, hasVbit, completedTime, operator, notes, archiveLink, customer, invoice?, po?, billed? }`. `invoice`/`po`/`billed` exist **only** when `billing` carries them (the script writes K/L/N only when carried).
  - `LogRows.formatCompletedTime(iso) → string` — the same `toLocaleString` options app.js's `formatDT` uses.

- [ ] **Step 1: Write the failing tests**

`test/log-rows.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LogRows = require('../js/log-rows.js');

const sheet = {
  fileKey: 'fk_1', fileName: 'NL_Bridge_Wall_Panels_Summary_Sheet 2.html', sheetTitle: 'Job Layout Sheet 2',
  jobName: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
  toolpaths: [{ name: 'Profile' }, { name: 'V-Carve Logo' }], archiveUrl: 'https://drive.google.com/uc?export=download&id=X',
};
const when = new Date(2026, 9, 1, 9, 12).toISOString();
const completion = { status: 'complete', completedAt: when, operator: 'Collin', notes: 'tear-out on 2' };

test('COLUMNS is the 14-column header, new ones at the right end', () => {
  assert.deepEqual(LogRows.COLUMNS, ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time',
    'Operator', 'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed']);
});

test('build: a cut sheet, no billing — the same values the CSV shows, keyed by fileKey', () => {
  const row = LogRows.build(sheet, completion, 'Northlight Studios');
  assert.deepEqual(row, {
    key: 'fk_1', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
    toolpathCount: 2, hasVbit: 'Y',
    completedTime: new Date(when).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    operator: 'Collin', notes: 'tear-out on 2',
    archiveLink: 'https://drive.google.com/uc?export=download&id=X', customer: 'Northlight Studios',
  });
  assert.ok(!('invoice' in row) && !('po' in row) && !('billed' in row), 'no billing keys unless carried');
});

test('build: not cut yet — blank time/operator/notes, title falls back to the file name', () => {
  const row = LogRows.build({ fileKey: 'fk_2', fileName: 'Sheet 3.html', toolpaths: [] }, null, '');
  assert.equal(row.sheet, 'Sheet 3.html');
  assert.equal(row.completedTime, '');
  assert.equal(row.operator, '');
  assert.equal(row.notes, '');
  assert.equal(row.hasVbit, 'N');
  assert.equal(row.toolpathCount, 0);
  assert.equal(row.customer, '');
  assert.equal(row.archiveLink, '');
});

test('build: an in-progress record has no completedAt and shows blank, like the CSV', () => {
  const row = LogRows.build(sheet, { status: 'in-progress' }, 'Northlight Studios');
  assert.equal(row.completedTime, '');
});

test('build: billing fields are carried as strings only when given', () => {
  const row = LogRows.build(sheet, completion, 'Northlight Studios', { invoiceNumber: 3612, poNumber: 'PO-77', billed: 'Y' });
  assert.equal(row.invoice, '3612');
  assert.equal(row.po, 'PO-77');
  assert.equal(row.billed, 'Y');
  const partial = LogRows.build(sheet, completion, 'Northlight Studios', { poNumber: 'PO-78' });
  assert.ok(!('invoice' in partial));
  assert.equal(partial.po, 'PO-78');
});

test('formatCompletedTime tolerates garbage', () => {
  assert.equal(LogRows.formatCompletedTime(''), '');
  assert.equal(LogRows.formatCompletedTime('not a date'), '');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/log-rows.test.mjs` — expected FAIL `Cannot find module '../js/log-rows.js'`.

- [ ] **Step 3: Implement `js/log-rows.js`**

```js
/**
 * js/log-rows.js — builds the Master Job Log row object (spec §6.2 / §10). Collin's export
 * and, in Phase 2, Billing's write-back both call build(), so the two can never disagree on
 * a column. Objects, not positional arrays: a future column never shifts anything.
 * Columns A–N: Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed Time, Operator,
 * Final Notes, Archive Link, Customer, Invoice #, PO #, Sheet Key, Billed.
 */
const LogRows = (() => {
  const P = typeof Pricing !== 'undefined' ? Pricing : require('./pricing.js');

  const COLUMNS = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time',
    'Operator', 'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed'];

  // Same options as app.js formatDT, so the log and the CSV show the same text.
  function formatCompletedTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // billing (optional): { invoiceNumber?, poNumber?, billed? } — each key is copied ONLY when
  // present, because the Apps Script writes K/L/N only when the payload carries them.
  function build(sheet, completion, customerName, billing) {
    const row = {
      key:           sheet.fileKey,
      sheet:         sheet.sheetTitle || sheet.fileName || '',
      job:           sheet.jobName || '',
      totalTime:     sheet.totalTime || '',
      toolpathCount: Array.isArray(sheet.toolpaths) ? sheet.toolpaths.length : 0,
      hasVbit:       P.sheetHasVbit(sheet) ? 'Y' : 'N',
      completedTime: completion && completion.completedAt ? formatCompletedTime(completion.completedAt) : '',
      operator:      (completion && completion.operator) || '',
      notes:         (completion && completion.notes) || '',
      archiveLink:   sheet.archiveUrl || '',
      customer:      customerName || '',
    };
    if (billing) {
      if (billing.invoiceNumber != null) row.invoice = String(billing.invoiceNumber);
      if (billing.poNumber != null)      row.po      = String(billing.poNumber);
      if (billing.billed != null)        row.billed  = String(billing.billed);
    }
    return row;
  }

  return { COLUMNS, build, formatCompletedTime };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LogRows;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/log-rows.test.mjs` — expected 6 passing.

- [ ] **Step 5: Script tag + commit**

`index.html`, after the `pricing.js` tag: `<script src="js/log-rows.js?v=1"></script>`.

Run `npm test` (all passing), then:

```bash
git add js/log-rows.js test/log-rows.test.mjs index.html
git commit -m "feat(log-rows): one builder for the 14-column Master Job Log row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `js/endpoint.js` — `upsertLogRows`

**Files:**
- Modify: `js/endpoint.js` (add one function, export it)
- Create: `test/endpoint-upsert.test.mjs`
- Modify: `index.html` — `endpoint.js?v=4` → `?v=5`

**Interfaces:**
- Produces: `Endpoint.upsertLogRows(rows, idToken) → Promise<{ ok, updated, appended, claimed }>`; when the endpoint is PASTE-disabled it resolves `{ ok: true, updated: 0, appended: 0, claimed: 0, offline: true }` without a network call. Server `{ok:false}` surfaces as an `Error` with `.endpointError = true` (existing `post()` behaviour), so `exportJob`'s alert shows the real reason.
- `appendLogRows` stays untouched: a shop tab that has not hard-refreshed still runs the old client.

- [ ] **Step 1: Write the failing tests**

`test/endpoint-upsert.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'), 'utf8');

// Same recipe as test/endpoint-doc.test.mjs: evaluate with `;Endpoint` appended and record fetches.
function loadEndpoint({ config, fetchImpl }) {
  const calls = [];
  const timeouts = [];
  const sandbox = {
    ENDPOINT_CONFIG: config,
    fetch: async (url, opts) => { calls.push({ url, opts }); return fetchImpl(); },
    AbortSignal: { timeout: (ms) => { timeouts.push(ms); return undefined; } },
  };
  const Endpoint = vm.runInNewContext(source + ';Endpoint', sandbox);
  return { Endpoint, calls, timeouts };
}

const LIVE = { url: 'https://example.test/exec', token: 'JUNKTOKEN' };
const ok = (body) => async () => ({ json: async () => ({ ok: true, ...body }) });
const rows = [{ key: 'fk1', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge', customer: 'Northlight Studios' }];

test('upsertLogRows posts action, rows (objects) and idToken with the default 20 s timeout', async () => {
  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ updated: 1, appended: 0, claimed: 0 }) });
  const res = await Endpoint.upsertLogRows(rows, 'IDTOKEN1');
  assert.deepEqual(res, { ok: true, updated: 1, appended: 0, claimed: 0 });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'upsertRows');
  assert.equal(sent.idToken, 'IDTOKEN1');
  assert.equal(sent.token, 'JUNKTOKEN');
  assert.deepEqual(sent.rows, rows);
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(timeouts, [20000]);
});

test('PASTE-disabled: resolves ok/offline without touching the network', async () => {
  const { Endpoint, calls } = loadEndpoint({ config: { url: 'PASTE_URL', token: 'x' }, fetchImpl: ok({}) });
  const res = await Endpoint.upsertLogRows(rows, null);
  assert.deepEqual(res, { ok: true, updated: 0, appended: 0, claimed: 0, offline: true });
  assert.equal(calls.length, 0);
});

test('a server refusal surfaces as endpointError with the server message', async () => {
  const { Endpoint } = loadEndpoint({ config: LIVE, fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'owner only' }) }) });
  await assert.rejects(() => Endpoint.upsertLogRows(rows, 'T'), (err) => err.endpointError === true && err.message === 'owner only');
});

test('appendLogRows is unchanged (old shop tabs keep working)', async () => {
  const { Endpoint, calls } = loadEndpoint({ config: LIVE, fetchImpl: ok({ appended: 1 }) });
  assert.equal(await Endpoint.appendLogRows([['a']]), true);
  assert.equal(JSON.parse(calls[0].opts.body).action, 'appendRows');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/endpoint-upsert.test.mjs` — expected 3 FAIL (`Endpoint.upsertLogRows is not a function`), the `appendLogRows` test passes.

- [ ] **Step 3: Implement**

In `js/endpoint.js`, after `appendLogRows`:

```js
  // Master Job Log, ONE object per sheet, upserted by Sheet Key (spec §6.2) — exporting the
  // same job twice updates the same rows. Carries the Firebase ID token: the script verifies
  // it before writing (closes the 2026-08-18 gap for the log write path). Billing columns
  // (invoice/po/billed) are accepted by the script only from an owner uid.
  async function upsertLogRows(rows, idToken) {
    if (!enabled()) return { ok: true, updated: 0, appended: 0, claimed: 0, offline: true };
    return post({ action: 'upsertRows', rows, idToken });
  }
```

Add `upsertLogRows` to the returned object: `return { enabled, archiveSheet, appendLogRows, upsertLogRows, lookupOrder, getPackingPdf, uploadDoc, getDoc, DOC_TIMEOUT_MS };`

Update the file header comment's first line to: `Thin client for the Apps Script endpoint (apps-script/logging-endpoint.gs): archive on upload, append (legacy) / upsert (Phase 1) log rows on export, order lookup, packing PDFs, print-queue documents.`

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/endpoint-upsert.test.mjs` — 4 passing. `npm test` — all passing.

- [ ] **Step 5: Bump + commit**

`index.html`: `js/endpoint.js?v=4` → `js/endpoint.js?v=5`.

```bash
git add js/endpoint.js test/endpoint-upsert.test.mjs index.html
git commit -m "feat(endpoint): upsertLogRows — object rows, id token, offline no-op

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Apps Script `upsertRows` (repo template + Travis's paste block)

**Files:**
- Modify: `apps-script/logging-endpoint.gs`
- Create: `test/logging-endpoint-upsert.test.mjs`
- Modify: `test/logging-endpoint.test.mjs` — the `HEADER` constant grows to 14 (new tabs are created with the full header)
- Deliverable (not committed): `C:\Users\Golden Boys\Downloads\CNC Tracker Endpoint - Phase 1 paste block.gs` — the functions and one-line edits Travis merges into the live script (hand step H3). It contains **no constants** except `OWNER_UIDS` with `PASTE_…` placeholders.

**Interfaces:**
- Consumes: `verifyFirebaseIdToken(idToken) → { ok, uid }` (already in the script), `findOrCreateCustomerTab`, `sanitizeTabName`, `UNASSIGNED_TAB`, `LOG_SPREADSHEET_ID`, `FIREBASE_API_KEY`.
- Produces: action `upsertRows` with payload `{ action, token, idToken, rows: [ { key, sheet, job, totalTime, toolpathCount, hasVbit, completedTime, operator, notes, archiveLink, customer, invoice?, po?, billed? } ] }` → `{ ok: true, updated, appended, claimed }` or `{ ok: false, error }`. New constant `OWNER_UIDS = []`. `LOG_HEADER` has 14 entries. `ensureLogHeaders(sheet)` fills blank header cells A1–N1 only, appends columns at the right end if the tab has fewer than 14, never inserts or renames.
- Rules per spec §6.2: find by Sheet Key (M) → else by exact `(Job, Sheet)` with blank M (claim) → else append. Always write A–E, G, I, J, M. F and H: if K blank, overwrite; if K set and the incoming `completedTime` is a different moment, keep F and append `Re-cut <incoming>` to H. K, L, N only when the payload carries them, and only from an `OWNER_UIDS` uid (else `{ok:false, error:'owner only'}` and nothing written).

- [ ] **Step 1: Write the failing tests**

`test/logging-endpoint-upsert.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rawSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'), 'utf8');

const HEADER14 = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time', 'Operator',
  'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed'];
const HEADER12 = HEADER14.slice(0, 12);   // the Orville tab today: K and L added by hand, no M/N

// A fake Sheets tab rich enough for getDataRange / getRange(...).getValues / setValues /
// getMaxColumns / insertColumnsAfter. rows[0] is the header. Cells may hold Date objects,
// exactly as Sheets hands them back when it auto-converted a typed time.
function fakeSheet(name, rows, maxColumns) {
  return {
    _name: name, rows, frozen: 0, maxColumns: maxColumns || Math.max(26, ...rows.map(r => r.length)),
    getName() { return this._name; },
    getLastRow() { return this.rows.length; },
    getMaxColumns() { return this.maxColumns; },
    insertColumnsAfter(after, n) { assert.equal(after, this.maxColumns, 'columns must be appended at the right end'); this.maxColumns += n; },
    getDataRange() {
      const width = Math.max(1, ...this.rows.map(r => r.length));
      const rows = this.rows.map(r => { const c = r.slice(); while (c.length < width) c.push(''); return c; });
      return { getValues: () => rows.map(r => r.slice()) };
    },
    getRange(row, col, numRows, numCols) {
      const sheet = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const r = sheet.rows[row - 1 + i] || [];
            out.push(Array.from({ length: numCols }, (_, j) => (r[col - 1 + j] === undefined ? '' : r[col - 1 + j])));
          }
          return out;
        },
        setValues(values) {
          assert.equal(values.length, numRows);
          for (const v of values) assert.equal(v.length, numCols);
          assert.ok(col - 1 + numCols <= sheet.maxColumns, 'write past the last column');
          values.forEach((v, i) => {
            const r = sheet.rows[row - 1 + i] || (sheet.rows[row - 1 + i] = []);
            v.forEach((cell, j) => { r[col - 1 + j] = cell; });
          });
        },
      };
    },
    setFrozenRows(n) { this.frozen = n; },
  };
}

function fakeSpreadsheet(sheets) {
  return {
    sheets,
    getSheets() { return this.sheets.slice(); },
    insertSheet(name, index) {
      if (this.sheets.some(s => s.getName() === name)) throw new Error(`A sheet named "${name}" already exists`);
      const s = fakeSheet(name, []);
      this.sheets.splice(index, 0, s);
      return s;
    },
  };
}

// uid the fake Identity Toolkit answers with; OWNER_UIDS filled by source substitution,
// the same trick test/print-queue-docs-endpoint.test.mjs uses for the API key.
function loadEndpoint(ss, { uid = 'collin-uid', owners = ['travis-uid', 'eva-uid'] } = {}) {
  const source = rawSource
    .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'")
    .replace('const OWNER_UIDS = [];', `const OWNER_UIDS = ${JSON.stringify(owners)};`);
  assert.ok(source.includes(`const OWNER_UIDS = ${JSON.stringify(owners)};`), 'OWNER_UIDS constant must exist in the template');
  const sandbox = {
    SpreadsheetApp: { openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ users: [{ localId: uid }] }) }) },
    DriveApp: {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}
const plain = v => JSON.parse(JSON.stringify(v));

const T1 = 'Oct 1, 2026, 9:12 AM';
function row(over = {}) {
  return { key: 'fk_a', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
    toolpathCount: 2, hasVbit: 'N', completedTime: T1, operator: 'Collin', notes: '', archiveLink: 'https://x/a',
    customer: 'Northlight Studios', ...over };
}

test('new key on an existing 14-column tab → appended with 14 cells, Sheet Key in M', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row()] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  assert.equal(tab.rows.length, 2);
  assert.deepEqual(plain(tab.rows[1]), ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', T1, 'Collin', '', 'https://x/a', 'Northlight Studios', '', '', 'fk_a', '']);
});

test('same key again → updated in place, no new row (export twice never duplicates)', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row()] });
  const out = g.upsertRows({ idToken: 'T', rows: [row({ notes: 'second pass', operator: 'Travis' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 1, appended: 0, claimed: 0 });
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.rows[1][7], 'second pass');
  assert.equal(tab.rows[1][6], 'Travis');
});

test('legacy row with blank M matching (Job, Sheet) → claimed: Sheet Key filled, no new row', () => {
  const legacy = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', 'Sep 30, 2026, 4:00 PM', 'Collin', 'old', 'https://x/old', 'Northlight Studios', '', ''];
  const tab = fakeSheet('Northlight Studios', [HEADER12.slice(), legacy], 12);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row()] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 0, claimed: 1 });
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.rows[1][12], 'fk_a');
  assert.equal(tab.rows[1][5], T1, 'K blank → F overwritten by the fresh export');
  assert.deepEqual(plain(tab.rows[0]), HEADER14, 'blank header cells M1/N1 filled, K1/L1 kept');
  assert.equal(tab.maxColumns, 14, 'two columns appended at the right end');
});

test('a tab that already has K–N headers is left alone; headers are never renamed', () => {
  const custom = HEADER14.slice(); custom[10] = 'Inv';   // someone typed a different K header
  const tab = fakeSheet('Harbor Lane Pictures', [custom]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ customer: 'Harbor Lane Pictures' })] });
  assert.equal(tab.rows[0][10], 'Inv');
});

test('billed row (K set) re-exported with a DIFFERENT time → F kept, H gets Re-cut; same time → nothing', () => {
  const billed = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', T1, 'Collin', 'ok', 'https://x/a', 'Northlight Studios', '3612', 'PO-1', 'fk_a', 'Y'];
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice(), billed.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 6, 2026, 2:00 PM', notes: 'recut' })] });
  assert.equal(tab.rows[1][5], T1, 'billed cut time frozen');
  assert.equal(tab.rows[1][7], 'ok · Re-cut Oct 6, 2026, 2:00 PM');
  assert.equal(tab.rows[1][10], '3612', 'K untouched by a non-owner export');
  assert.equal(tab.rows[1][13], 'Y', 'N untouched');
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 6, 2026, 2:00 PM' })] });
  assert.equal(tab.rows[1][7], 'ok · Re-cut Oct 6, 2026, 2:00 PM', 'same re-cut time twice does not double the note');
});

test('Sheets auto-converted F to a Date: same moment is NOT a re-cut (Review Focus 3)', () => {
  const asDate = new Date(2026, 9, 1, 9, 12);
  const billed = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', asDate, 'Collin', 'ok', 'https://x/a', 'Northlight Studios', '3612', '', 'fk_a', 'Y'];
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice(), billed.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: T1 })] });
  assert.equal(tab.rows[1][7], 'ok');
  assert.equal(tab.rows[1][5], asDate, 'F left exactly as it was');
  // Chrome's toLocaleString uses U+202F before AM/PM; that must still read as the same moment.
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 1, 2026, 9:12\u202fAM' })] });
  assert.equal(tab.rows[1][7], 'ok');
});

test('invoice/po/billed from an owner uid → K/L/N written; from Collin → refused, nothing written', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const ss = fakeSpreadsheet([tab]);
  const owner = loadEndpoint(ss, { uid: 'travis-uid' });
  const out = owner.upsertRows({ idToken: 'T', rows: [row({ invoice: '3612', billed: 'Y' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  assert.equal(tab.rows[1][10], '3612');
  assert.equal(tab.rows[1][11], '', 'L not carried → left blank');
  assert.equal(tab.rows[1][13], 'Y');
  const collin = loadEndpoint(ss, { uid: 'collin-uid' });
  const refused = collin.upsertRows({ idToken: 'T', rows: [row({ po: 'PO-9' })] });
  assert.deepEqual(plain(refused), { ok: false, error: 'owner only' });
  assert.equal(tab.rows[1][11], '');
  const ok = collin.upsertRows({ idToken: 'T', rows: [row({ notes: 'plain export' })] });
  assert.equal(ok.ok, true, 'rows without billing fields are fine from Collin');
  assert.equal(tab.rows[1][10], '3612', 'K survives a plain re-export');
});

test('token required, rows validated, customer routes to its tab (new tab gets the 14-col header)', () => {
  const ss = fakeSpreadsheet([]);
  const g = loadEndpoint(ss);
  assert.deepEqual(plain(g.upsertRows({ rows: [row()] })), { ok: false, error: 'missing idToken' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [] })), { ok: false, error: 'no rows' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [['positional']] })), { ok: false, error: 'row 1 has no key' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [row({ key: '' })] })), { ok: false, error: 'row 1 has no key' });
  const out = g.upsertRows({ idToken: 'T', rows: [row(), row({ key: 'fk_b', sheet: 'Sheet 3', customer: '' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 2, claimed: 0 });
  const nl = ss.sheets.find(s => s.getName() === 'Northlight Studios');
  const un = ss.sheets.find(s => s.getName() === 'Unassigned');
  assert.deepEqual(plain(nl.rows[0]), HEADER14);
  assert.equal(nl.frozen, 1);
  assert.equal(un.rows[1][12], 'fk_b');
});

test('doPost dispatches upsertRows and still knows appendRows', () => {
  const g = loadEndpoint(fakeSpreadsheet([fakeSheet('Northlight Studios', [HEADER14.slice()])]));
  const src = rawSource.replace("'PASTE_TOKEN'", "'TOK'").replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");
  const sandbox = { ...g, __out: null };
  sandbox.ContentService = { createTextOutput: (s) => { sandbox.__out = JSON.parse(s); return { setMimeType() { return this; } }; }, MimeType: { JSON: 'json' } };
  vm.runInNewContext(src, sandbox);
  sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', action: 'upsertRows', idToken: 'T', rows: [row()] }) } });
  assert.deepEqual(plain(sandbox.__out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', action: 'appendRows', rows: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'Northlight Studios']] }) } });
  assert.equal(sandbox.__out.ok, true);
});
```

Also in `test/logging-endpoint.test.mjs`, change the `HEADER` constant to the 14 names (copy `HEADER14` above) — `findOrCreateCustomerTab` now writes the full header on a new tab; the legacy append tests otherwise still pass (10-wide rows under a 14-wide header are fine).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/logging-endpoint-upsert.test.mjs` — expected: every test fails at `OWNER_UIDS constant must exist in the template`. Run `node --test test/logging-endpoint.test.mjs` — the "auto-creates a missing customer tab" test fails (header is 10, expected 14).

- [ ] **Step 3: Implement in `apps-script/logging-endpoint.gs`**

(a) Under `const ALLOWED_UIDS = [];` add:

```js
// Owners (Travis, Eva): the only uids whose rows may carry Invoice # / PO # / Billed
// (columns K, L, N). Paste from Firebase console → Authentication → Users. Empty = nobody.
const OWNER_UIDS = [];
```

(b) Replace `LOG_HEADER`:

```js
// Rows route to the tab named after each row's Customer, created on first use. Rows with no
// customer land in UNASSIGNED_TAB. Columns are only ever ADDED at the right-hand end: the
// Orville mirror (Orville - Season 4!A:L) and this script both address columns by position.
const LOG_HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer',
  'Invoice #', 'PO #', 'Sheet Key', 'Billed'];
// 0-based column positions in a LOG_HEADER-wide row.
const COL = { sheet: 0, job: 1, totalTime: 2, toolpathCount: 3, hasVbit: 4, completedTime: 5, operator: 6,
  notes: 7, archiveLink: 8, customer: 9, invoice: 10, po: 11, key: 12, billed: 13 };
```

(c) In `doPost`, after the `appendRows` line: `if (body.action === 'upsertRows')  return jsonOut(upsertRowsLocked(body));`

(d) After `groupRowsByCustomer`, add:

```js
/**
 * upsertRows — Phase 1 of the customer-billing redesign (CNC_WebApp spec 2026-10-04 §6.2).
 * ONE row per sheet, matched by Sheet Key (column M); a pre-Phase-1 row with blank M is
 * matched on exact (Job, Sheet) and claimed. Verifies the Firebase ID token; rows that carry
 * invoice / po / billed are accepted only from OWNER_UIDS. Full-duration lock like appendRows.
 */
function upsertRowsLocked(body) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    return upsertRows(body);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function upsertRows(body) {
  if (FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'no rows' };
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r) || !str(r.key)) return { ok: false, error: 'row ' + (i + 1) + ' has no key' };
  }
  const carriesBilling = rows.some(function (r) { return hasValue(r.invoice) || hasValue(r.po) || hasValue(r.billed); });
  if (carriesBilling && OWNER_UIDS.indexOf(auth.uid) === -1) return { ok: false, error: 'owner only' };

  const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  const groups = Object.create(null);
  rows.forEach(function (r) {
    const customer = str(r.customer) || UNASSIGNED_TAB;
    (groups[customer] || (groups[customer] = [])).push(r);
  });
  var updated = 0, appended = 0, claimed = 0;
  Object.keys(groups).forEach(function (customer) {
    const sheet = findOrCreateCustomerTab(ss, customer);
    ensureLogHeaders(sheet);
    const values = sheet.getDataRange().getValues();          // values[i] is sheet row i + 1
    const byKey = Object.create(null), byJobSheet = Object.create(null);
    for (var i = 1; i < values.length; i++) {
      const key = str(values[i][COL.key]);
      if (key) { if (byKey[key] === undefined) byKey[key] = i; }
      else { const js = jobSheetKey(values[i][COL.job], values[i][COL.sheet]); if (byJobSheet[js] === undefined) byJobSheet[js] = i; }
    }
    groups[customer].forEach(function (r) {
      const key = str(r.key);
      var idx = byKey[key], isClaim = false;
      if (idx === undefined) { idx = byJobSheet[jobSheetKey(r.job, r.sheet)]; isClaim = idx !== undefined; }
      if (idx === undefined) {
        const fresh = newLogRow(r);
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, LOG_HEADER.length).setValues([fresh]);
        values.push(fresh);
        byKey[key] = values.length - 1;
        appended++;
      } else {
        const merged = mergeLogRow(values[idx], r);
        sheet.getRange(idx + 1, 1, 1, LOG_HEADER.length).setValues([merged]);
        values[idx] = merged;
        byKey[key] = idx;
        if (isClaim) claimed++; else updated++;
      }
    });
  });
  return { ok: true, updated: updated, appended: appended, claimed: claimed };
}

// Fills blank header cells A1–N1 and appends columns at the right end if the tab is narrower
// than LOG_HEADER. Never inserts a column mid-sheet, never changes a non-blank header.
function ensureLogHeaders(sheet) {
  const need = LOG_HEADER.length;
  const have = sheet.getMaxColumns();
  if (have < need) sheet.insertColumnsAfter(have, need - have);
  const range = sheet.getRange(1, 1, 1, need);
  const header = range.getValues()[0];
  var changed = false;
  for (var i = 0; i < need; i++) {
    if (str(header[i]) === '') { header[i] = LOG_HEADER[i]; changed = true; }
  }
  if (changed) range.setValues([header]);
}

function str(v) { return v == null ? '' : String(v).trim(); }
function hasValue(v) { return v !== undefined && v !== null; }
function jobSheetKey(job, sheetName) { return str(job) + '\u0000' + str(sheetName); }

function newLogRow(r) {
  const row = [];
  for (var i = 0; i < LOG_HEADER.length; i++) row.push('');
  writeCoreCells(row, r);
  row[COL.completedTime] = str(r.completedTime);
  row[COL.notes] = str(r.notes);
  writeBillingCells(row, r);
  return row;
}

// A–E, G, I, J, M: always from the payload.
function writeCoreCells(row, r) {
  row[COL.sheet] = str(r.sheet);
  row[COL.job] = str(r.job);
  row[COL.totalTime] = str(r.totalTime);
  row[COL.toolpathCount] = str(r.toolpathCount);
  row[COL.hasVbit] = str(r.hasVbit);
  row[COL.operator] = str(r.operator);
  row[COL.archiveLink] = str(r.archiveLink);
  row[COL.customer] = str(r.customer);
  row[COL.key] = str(r.key);
}

// K, L, N: only when the payload carries them (owner-only, checked above).
function writeBillingCells(row, r) {
  if (hasValue(r.invoice)) row[COL.invoice] = str(r.invoice);
  if (hasValue(r.po)) row[COL.po] = str(r.po);
  if (hasValue(r.billed)) row[COL.billed] = str(r.billed);
}

function mergeLogRow(existing, r) {
  const row = existing.slice();
  while (row.length < LOG_HEADER.length) row.push('');
  writeCoreCells(row, r);
  const invoiceSet = str(row[COL.invoice]) !== '';
  if (!invoiceSet) {
    row[COL.completedTime] = str(r.completedTime);
    row[COL.notes] = str(r.notes);
  } else {
    // Billed row: the cut time it was priced on is frozen. A different incoming time is a
    // re-cut — record it in the notes without moving F (spec §6.2).
    const incoming = str(r.completedTime);
    if (incoming && !sameMoment(row[COL.completedTime], incoming)) {
      const note = 'Re-cut ' + incoming;
      const notes = str(row[COL.notes]);
      if (notes.indexOf(note) === -1) row[COL.notes] = notes ? notes + ' · ' + note : note;
    }
  }
  writeBillingCells(row, r);
  return row;
}

// Sheets may have auto-converted a typed "Oct 1, 2026, 9:12 AM" into a Date; Chrome writes a
// narrow no-break space before AM/PM. Compare as moments when both parse, else as text.
function sameMoment(cell, incoming) {
  const a = toMoment(cell), b = toMoment(incoming);
  if (a !== null && b !== null) return Math.abs(a - b) < 60000;
  return normalizeTimeText(cell) === normalizeTimeText(incoming);
}
function normalizeTimeText(v) {
  return (v instanceof Date ? v.toString() : str(v)).replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toMoment(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  const t = new Date(normalizeTimeText(v)).getTime();
  return isNaN(t) ? null : t;
}
```

(e) Header comment of the file: change `Deploy > New deployment > Web app` wording to add a second line: ` * Later edits: Deploy > Manage deployments > pencil > Version: New version (a "New deployment" mints a new URL the app does not know).`

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/logging-endpoint-upsert.test.mjs test/logging-endpoint.test.mjs` — expected 9 + 8 passing. Then `npm test` — all passing.

- [ ] **Step 5: Write the paste block for Travis (deliverable, not committed)**

Create `C:\Users\Golden Boys\Downloads\CNC Tracker Endpoint - Phase 1 paste block.gs` containing, in this order, with these exact instructions as the leading comment:

```
// ===== CNC Tracker Endpoint — Phase 1 paste block (customer billing) =====
// MERGE these into the LIVE script "CNC Tracker Endpoint". Do NOT replace the file —
// the live copy holds TOKEN, folder/spreadsheet ids, FIREBASE_API_KEY and ALLOWED_UIDS.
//
// 1. Directly under the existing `const ALLOWED_UIDS = [...]` line, add:
//      const OWNER_UIDS = ['PASTE_TRAVIS_UID', 'PASTE_EVA_UID'];
//    (Firebase console → Authentication → Users → copy each "User UID". Leave Eva's
//     out until her account exists; add it with hand step H9.)
// 2. Replace the existing `const LOG_HEADER = [...]` (10 names) with the 14-name version
//    below, and add the `const COL = {...}` line after it.
// 3. In doPost(), after the appendRows line, add:
//      if (body.action === 'upsertRows')  return jsonOut(upsertRowsLocked(body));
// 4. Paste every function below at the end of the file.
// 5. Deploy → Manage deployments → ✎ (pencil) → Version: **New version** → Deploy.
//    NEVER "New deployment" (new URL). Check: the Version dropdown must say "New version",
//    not the old number, or Deploy republishes the old code.
// 6. Verify from any signed-in Job Tracker tab's console (F12):
//      fetch(ENDPOINT_CONFIG.url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
//        body: JSON.stringify({token: ENDPOINT_CONFIG.token, action:'upsertRows', rows:[]})}).then(r=>r.json()).then(console.log)
//    → {ok:false, error:'missing idToken'}  (the action exists and is guarded). Then the same with
//      action:'appendRows', rows:[]  → {ok:false, error:'no rows'}  (the old client still works).
```

followed by the `LOG_HEADER` + `COL` constants and every function from Step 3(d), copied verbatim from the repo file. No real value anywhere in it. Tell the controller the file exists; the controller hands it to Travis in-session (hand step H3) and, if he wants H3a, the §12.3 scratch run (Rollout checklist has the console snippets).

- [ ] **Step 6: Commit**

```bash
git add apps-script/logging-endpoint.gs test/logging-endpoint-upsert.test.mjs test/logging-endpoint.test.mjs
git commit -m "feat(apps-script): upsertRows — one log row per sheet keyed by Sheet Key, claims legacy rows, freezes billed cut times, owner-only K/L/N

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `js/storage.js` — `finished` flag, migration-aware board query, `jobs/`, the migration

**Files:**
- Modify: `js/storage.js` — `saveSheet` (~line 312), `loadSheets` (~346), `onSheetsChange` (~357), new sections, `return` object
- Create: `test/storage-finished.test.mjs`
- Modify: `index.html` — `storage.js?v=15` → `?v=16`

**Interfaces:**
- Produces (all on `Storage`):
  - `saveSheet(sheet)` now writes `finished: false` on every new doc.
  - `loadMigrationState() → Promise<void>` — reads `settings/migrations` (the one operator-readable settings doc). **Call it before `loadSheets`.**
  - `sheetsFilterReady() → boolean`; `migrationState() → { done, at, count, total } | null`
  - `filterActive(docs) → docs` (drops `finished === true`; keeps docs without the field) and `sortByUploadedAt(docs)` — pure, exported for tests
  - `loadSheets()` / `onSheetsChange(cb)` — query `where('finished','==',false)` once the flag is set, the whole collection before; **no `orderBy`** (a `where` + `orderBy` on different fields needs a composite index); client-side filter + sort in both modes
  - `loadFinishedSheets() → Promise<docs>` — one-shot `where('finished','==',true)`, newest `finishedAt` first
  - `getSheetDoc(fileKey) → Promise<data|null>` — the re-upload guard's read
  - `finishPatch(sheet, by, nowMs) → object` — pure; `{ finished:true, finishedAt, finishedBy }` + drawing fields cleared when `archiveUrl` exists
  - `finishSheets(sheetList, by) → Promise<{count}>` — batched 500, **throws** on failure (the caller keeps the job on the board)
  - `unfinishSheets(fileKeys) → Promise<void>` — "Put back on the board"
  - `upsertJob(jobKey, jobName, by)`, `finishJob(jobKey, jobName, by)`, `reopenJob(jobKey)` — `jobs/{jobKey}`
  - `migrateFinishedFlag(onProgress?) → Promise<{ stamped, total }>` — idempotent; stamps `finished:false` on docs lacking the field in batches of 500, then writes `settings/migrations.sheetsFinishedFlag`
- `finishedAt`/`createdAt`/`lastExportAt` are `Date.now()` numbers (like `printQueue`), sortable without a server round-trip.

- [ ] **Step 1: Write the failing tests**

`test/storage-finished.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// saveSheet reaches for firebase.firestore.FieldValue inside its try block; give it a stub so
// the fake-db test below exercises the write instead of the catch.
globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', increment: (n) => ({ increment: n }) } } };
const Storage = require('../js/storage.js');

// Minimal compat-API fake: records set/update calls per collection/doc, answers get().
function fakeDb(docs = {}) {
  const writes = [];
  const col = (name) => ({
    doc: (id) => ({
      async get() { const d = docs[`${name}/${id}`]; return { exists: !!d, data: () => d, id }; },
      async set(data, opts) { writes.push({ op: 'set', path: `${name}/${id}`, data, opts }); docs[`${name}/${id}`] = opts && opts.merge ? { ...(docs[`${name}/${id}`] || {}), ...data } : data; },
      async update(data) { writes.push({ op: 'update', path: `${name}/${id}`, data }); Object.assign(docs[`${name}/${id}`] = docs[`${name}/${id}`] || {}, data); },
    }),
    where() { return { async get() { return { docs: [], size: 0 }; }, onSnapshot() {} }; },
    async get() { const entries = Object.entries(docs).filter(([k]) => k.startsWith(name + '/')); return { size: entries.length, docs: entries.map(([k, v]) => ({ id: k.split('/')[1], data: () => v, ref: col(name).doc(k.split('/')[1]) })) }; },
    onSnapshot() {},
  });
  return { collection: col, batch() { const ops = []; return { update(ref, data) { ops.push(() => ref.update(data)); }, async commit() { for (const op of ops) await op(); writes.push({ op: 'commit', n: ops.length }); } }; }, writes, docs };
}

test('filterActive keeps unfinished AND legacy docs (no field), drops finished', () => {
  const docs = [{ fileKey: 'a', finished: false }, { fileKey: 'legacy' }, { fileKey: 'done', finished: true }];
  assert.deepEqual(Storage.filterActive(docs).map(d => d.fileKey), ['a', 'legacy']);
});

test('sortByUploadedAt: pending/missing timestamps sort last, never vanish', () => {
  const ts = (ms) => ({ toMillis: () => ms });
  const sorted = Storage.sortByUploadedAt([{ k: 'late', uploadedAt: ts(300) }, { k: 'none' }, { k: 'early', uploadedAt: ts(100) }]);
  assert.deepEqual(sorted.map(d => d.k), ['early', 'late', 'none']);
});

test('finishPatch clears the drawing only when an archive copy exists', () => {
  const by = 'collin@example.com';
  assert.deepEqual(Storage.finishPatch({ fileKey: 'a', archiveUrl: 'https://drive/x' }, by, 1000),
    { finished: true, finishedAt: 1000, finishedBy: by, layoutSvg: '', layoutSvgGz: '', layoutOversize: false });
  assert.deepEqual(Storage.finishPatch({ fileKey: 'b' }, by, 1000),
    { finished: true, finishedAt: 1000, finishedBy: by });
});

test('before any migration: filter not ready, state null; offline finish/unfinish are no-ops that resolve', async () => {
  assert.equal(Storage.sheetsFilterReady(), false);
  assert.equal(Storage.migrationState(), null);
  assert.deepEqual(await Storage.finishSheets([{ fileKey: 'a' }], 'x'), { count: 1 });
  await Storage.unfinishSheets(['a']);
  assert.equal(await Storage.getSheetDoc('a'), null);
  assert.deepEqual(await Storage.loadFinishedSheets(), []);
});

test('with a db: saveSheet writes finished:false; getSheetDoc reads it back; finishSheets updates in a batch', async () => {
  const db = fakeDb();
  Storage.init(db);
  const res = await Storage.saveSheet({ fileKey: 'fk1', fileName: 'Sheet 1.html', jobName: 'Northlight Wall', layoutSvg: '' });
  assert.equal(res.ok, true);
  const saved = db.writes.find(w => w.path === 'sheets/fk1' && w.op === 'set').data;
  assert.equal(saved.finished, false);
  assert.equal(saved.fileName, 'Sheet 1.html');
  assert.deepEqual(await Storage.getSheetDoc('fk1'), saved);
  assert.equal(await Storage.getSheetDoc('nope'), null);
  await Storage.finishSheets([{ fileKey: 'fk1', archiveUrl: 'https://drive/x' }], 'collin@example.com');
  assert.equal(db.docs['sheets/fk1'].finished, true);
  assert.equal(db.docs['sheets/fk1'].layoutSvgGz, '');
  assert.ok(db.writes.some(w => w.op === 'commit' && w.n === 1));
  await Storage.unfinishSheets(['fk1']);
  assert.equal(db.docs['sheets/fk1'].finished, false);
});

test('jobs: upsertJob creates once, finishJob stamps + increments, reopenJob clears', async () => {
  const db = fakeDb();
  Storage.init(db);
  await Storage.upsertJob('proj_1', 'Northlight Wall', 'travis@example.com');
  await Storage.upsertJob('proj_1', 'Northlight Wall', 'travis@example.com');
  const creates = db.writes.filter(w => w.path === 'jobs/proj_1' && w.op === 'set' && !(w.opts && w.opts.merge));
  assert.equal(creates.length, 1, 'second upsert does not rewrite createdAt');
  assert.equal(db.docs['jobs/proj_1'].finished, false);
  assert.equal(db.docs['jobs/proj_1'].exportCount, 0);
  await Storage.finishJob('proj_1', 'Northlight Wall', 'collin@example.com');
  assert.equal(db.docs['jobs/proj_1'].finished, true);
  assert.equal(db.docs['jobs/proj_1'].finishedBy, 'collin@example.com');
  assert.deepEqual(db.docs['jobs/proj_1'].exportCount, { increment: 1 });
  await Storage.reopenJob('proj_1');
  assert.equal(db.docs['jobs/proj_1'].finished, false);
});

test('migrateFinishedFlag stamps only docs lacking the field, writes the flag, is idempotent', async () => {
  const db = fakeDb({ 'sheets/a': { fileKey: 'a' }, 'sheets/b': { fileKey: 'b', finished: true }, 'sheets/c': { fileKey: 'c' } });
  Storage.init(db);
  const progress = [];
  const first = await Storage.migrateFinishedFlag((done, total) => progress.push([done, total]));
  assert.deepEqual(first, { stamped: 2, total: 3 });
  assert.equal(db.docs['sheets/a'].finished, false);
  assert.equal(db.docs['sheets/b'].finished, true, 'an already-finished doc is untouched');
  assert.equal(db.docs['sheets/c'].finished, false);
  assert.deepEqual(progress, [[2, 2]]);
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.done, true);
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.count, 2);
  assert.equal(Storage.sheetsFilterReady(), true);
  const second = await Storage.migrateFinishedFlag();
  assert.deepEqual(second, { stamped: 0, total: 3 });
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.count, 2, 'count is the running total, not reset');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/storage-finished.test.mjs` — expected FAIL: `Storage.filterActive is not a function`.

- [ ] **Step 3: Implement**

In `saveSheet`'s `set({...})` object add, after `materialInfo`: `finished: false,   // leaves the board only when Collin's export finishes the job (spec §5.2)`.

Replace `loadSheets`, `onSheetsChange` and add the helpers; put this block in place of the two functions:

```js
  /* ── Sheets: the board query ──
   * Finished sheets stay in Firestore forever (Phase 1 of the billing redesign); the board
   * shows only `finished == false`. A Firestore equality filter EXCLUDES docs that lack the
   * field, and every pre-Phase-1 doc lacks it, so the filtered query is used only once
   * settings/migrations says the one-time stamp has run (Settings › Maintenance). Until then
   * the whole collection is read and finished docs are dropped here. Both modes drop them
   * client-side, so a finished sheet never shows on any device whatever the flag says.
   * settings/migrations is the ONE settings doc operators can read (rules) — Collin's board
   * needs the flag too. No orderBy: where + orderBy on different fields needs a composite
   * index that fails only in production; sort client-side like before.
   */
  let migrationFlags = {};

  async function loadMigrationState() {
    if (!db) return;
    try {
      const snap = await db.collection('settings').doc('migrations').get();
      migrationFlags = snap.exists ? (snap.data() || {}) : {};
    } catch (e) {
      console.warn('Firestore loadMigrationState failed (board falls back to the unfiltered query):', e);
      migrationFlags = {};
    }
  }

  function migrationState() { return migrationFlags.sheetsFinishedFlag || null; }
  function sheetsFilterReady() { const f = migrationState(); return !!(f && f.done); }

  function activeSheetsQuery() {
    const col = db.collection('sheets');
    return sheetsFilterReady() ? col.where('finished', '==', false) : col;
  }

  function filterActive(docs) { return docs.filter(d => d.finished !== true); }

  function sortByUploadedAt(docs) {
    // Nulls sort last here instead of disappearing (a query orderBy would drop them).
    return docs.slice().sort((a, b) => {
      const ta = a.uploadedAt?.toMillis?.() ?? Infinity;
      const tb = b.uploadedAt?.toMillis?.() ?? Infinity;
      return ta - tb;
    });
  }

  async function loadSheets() {
    if (!db) return [];
    try {
      const snap = await activeSheetsQuery().get();
      return sortByUploadedAt(filterActive(snap.docs.map(doc => doc.data())));
    } catch (e) {
      console.warn('Firestore loadSheets failed:', e);
      return [];
    }
  }

  function onSheetsChange(callback) {
    if (!db) return;
    activeSheetsQuery().onSnapshot(snap => {
      callback(sortByUploadedAt(filterActive(snap.docs.map(doc => doc.data()))));
    }, err => console.warn('Firestore sheets listener error:', err));
  }

  // Owners' "Show finished jobs" view (one-shot, not a listener — finished jobs are history).
  async function loadFinishedSheets() {
    if (!db) return [];
    try {
      const snap = await db.collection('sheets').where('finished', '==', true).get();
      return snap.docs.map(doc => doc.data()).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    } catch (e) {
      console.warn('Firestore loadFinishedSheets failed:', e);
      return [];
    }
  }

  // The re-upload guard reads Firestore, not the in-memory array: finished sheets are not in
  // the array any more, and re-dropping one must not silently overwrite it (spec §5.2).
  async function getSheetDoc(fileKey) {
    if (!db) return null;
    try {
      const snap = await db.collection('sheets').doc(fileKey).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn('Firestore getSheetDoc failed:', e);
      return null;
    }
  }

  /* ── Finishing (Collin's export) ── */
  const WRITE_BATCH = 500;   // Firestore write-batch limit

  function finishPatch(sheet, by, nowMs) {
    const patch = { finished: true, finishedAt: nowMs, finishedBy: by || '' };
    // The archived HTML is the drawing of record once a sheet is finished; dropping the
    // stored SVG keeps the board's initial load from growing by every drawing ever cut.
    if (sheet.archiveUrl) { patch.layoutSvg = ''; patch.layoutSvgGz = ''; patch.layoutOversize = false; }
    return patch;
  }

  // NOT swallowed: if this throws, exportJob keeps the job on the board and says so.
  async function finishSheets(sheetList, by) {
    if (!db) return { count: sheetList.length };
    const now = Date.now();
    for (let i = 0; i < sheetList.length; i += WRITE_BATCH) {
      const batch = db.batch();
      sheetList.slice(i, i + WRITE_BATCH).forEach(s => batch.update(db.collection('sheets').doc(s.fileKey), finishPatch(s, by, now)));
      await batch.commit();
    }
    return { count: sheetList.length };
  }

  async function unfinishSheets(fileKeys) {
    if (!db) return;
    for (let i = 0; i < fileKeys.length; i += WRITE_BATCH) {
      const batch = db.batch();
      fileKeys.slice(i, i + WRITE_BATCH).forEach(k => batch.update(db.collection('sheets').doc(k), { finished: false }));
      await batch.commit();
    }
  }

  /* ── Jobs (jobs/{jobKey}) — one job-level home for "finished" (spec §5.3) ── */
  async function upsertJob(jobKey, jobName, by) {
    if (!db) return;
    try {
      const ref = db.collection('jobs').doc(jobKey);
      const snap = await ref.get();
      if (snap.exists) return;
      await ref.set({ jobName: jobName || '', finished: false, finishedAt: null, finishedBy: '', exportCount: 0, lastExportAt: null, createdAt: Date.now(), createdBy: by || '' });
    } catch (e) {
      console.warn('Firestore upsertJob failed:', e);
    }
  }

  async function finishJob(jobKey, jobName, by) {
    if (!db) return;
    const now = Date.now();
    await db.collection('jobs').doc(jobKey).set({
      jobName: jobName || '', finished: true, finishedAt: now, finishedBy: by || '',
      exportCount: firebase.firestore.FieldValue.increment(1), lastExportAt: now,
    }, { merge: true });
  }

  async function reopenJob(jobKey) {
    if (!db) return;
    await db.collection('jobs').doc(jobKey).set({ finished: false }, { merge: true });
  }

  /* ── One-time migration: stamp finished:false on every legacy sheet (spec §11.1 step 6) ── */
  async function migrateFinishedFlag(onProgress) {
    if (!db) return { stamped: 0, total: 0 };
    const snap = await db.collection('sheets').get();
    const todo = snap.docs.filter(d => (d.data() || {}).finished === undefined);
    for (let i = 0; i < todo.length; i += WRITE_BATCH) {
      const batch = db.batch();
      todo.slice(i, i + WRITE_BATCH).forEach(d => batch.update(d.ref, { finished: false }));
      await batch.commit();
      if (onProgress) onProgress(Math.min(i + WRITE_BATCH, todo.length), todo.length);
    }
    const prior = migrationState() || { count: 0 };
    const flag = { done: true, at: Date.now(), count: (prior.count || 0) + todo.length, total: snap.size };
    await db.collection('settings').doc('migrations').set({ sheetsFinishedFlag: flag }, { merge: true });
    migrationFlags = { ...migrationFlags, sheetsFinishedFlag: flag };
    return { stamped: todo.length, total: snap.size };
  }
```

Add to the `return {…}`: `loadMigrationState, migrationState, sheetsFilterReady, filterActive, sortByUploadedAt, loadFinishedSheets, getSheetDoc, finishPatch, finishSheets, unfinishSheets, upsertJob, finishJob, reopenJob, migrateFinishedFlag`.

Update the header comment at the top of the file (lines 1–7) to add: ` * Sheets carry `finished` (Phase 1 billing redesign): finished sheets stay forever and leave the board.`

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/storage-finished.test.mjs` — 7 passing. `npm test` — all passing (the other storage tests share the module and must be unaffected).

- [ ] **Step 5: Bump + commit**

`index.html`: `js/storage.js?v=15` → `?v=16`.

```bash
git add js/storage.js test/storage-finished.test.mjs index.html
git commit -m "feat(storage): finished flag, migration-aware board query (no orderBy), finish/unfinish batches, jobs/, finished-flag migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `js/storage-owner.js` — the owner-only collections

**Files:**
- Create: `js/storage-owner.js`
- Create: `test/storage-owner.test.mjs`
- Modify: `index.html` — script tag after `storage.js`

**Interfaces:**
- Produces (global `OwnerStore`), cache-first like `Storage`, usable with no `db` (PASTE mode / tests):
  - `init(firestore)`, `loadAll() → Promise<void>` (loads the four collections, seeds `settings/laborTypes` + `settings/materials` if absent, then listens), `onChange(cb)`
  - `getJobBilling(jobKey) → doc|null`, `newJobBilling(jobName) → doc`, `setJobBilling(jobKey, patch, by) → Promise<doc>` (merges into the cached doc and writes the whole doc; **throws** on a Firestore error), `hasJobDetails(jobKey) → boolean` (customer + material kind + turnaround all set)
  - `newLaborLine(typeId, hours, note, by) → line` with `{ id, typeId, hours, note, enteredBy, enteredAt, status: 'unbilled', invoiceNumber: null, billedAt: null }`
  - `getSheetBilling(fileKey) → doc|null`, `setCutDateOverride(fileKey, ymd|null, { jobKey, customerKey }, by) → Promise<doc>` — throws `'This sheet is already priced on an invoice — its cut date is locked.'` when status is `in-progress`/`billed`
  - `getCustomerBilling(customerKey) → doc|null`, `setCustomerBilling(customerKey, patch, by)`, `rememberMaterialDefault(customerKey, customerName, thicknessIn, material)`
  - `getSetting(name) → doc|null`, `setSetting(name, data, by)`, `ensureSeeded(name, seed) → Promise<boolean>`, `laborTypes() → array`, `materials() → array`, `SEEDS`
  - `_resetForTests()`
- Doc shapes (Firestore docs are maps, so the spec's arrays sit under a key): `settings/laborTypes = { types: [ { id, name, rate, minHours, qbItem } ] }`, `settings/materials = { items: [ { id, name, thicknessIn, pricePerSheet, taxable } ] }` (empty until Phase 2's Settings › Materials). `jobBilling` per spec §5.4; `sheetBilling` flat per Task 1; `customerBilling` per §5.7.

- [ ] **Step 1: Write the failing tests**

`test/storage-owner.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OwnerStore = require('../js/storage-owner.js');   // no init() => cache-only

test('seeds: labor types carry the 2026-10-04 rates and estimator minimums, materials start empty', () => {
  assert.deepEqual(OwnerStore.SEEDS.laborTypes.types, [
    { id: 'design', name: 'Design', rate: 150, minHours: 1,   qbItem: 'Digital Design' },
    { id: 'cam',    name: 'CAM',    rate: 85,  minHours: 0.5, qbItem: 'Digital Design' },
  ]);
  assert.deepEqual(OwnerStore.SEEDS.materials, { items: [] });
});

test('loadAll offline seeds settings into the cache once; laborTypes()/materials() read them', async () => {
  OwnerStore._resetForTests();
  await OwnerStore.loadAll();
  assert.equal(OwnerStore.laborTypes().length, 2);
  assert.deepEqual(OwnerStore.materials(), []);
  assert.equal(await OwnerStore.ensureSeeded('laborTypes', { types: [] }), false, 'already present → not reseeded');
  assert.equal(OwnerStore.laborTypes().length, 2);
});

test('job billing: new doc defaults, hasJobDetails flips when customer+material+turnaround are set', async () => {
  OwnerStore._resetForTests();
  assert.equal(OwnerStore.getJobBilling('proj_1'), null);
  assert.equal(OwnerStore.hasJobDetails('proj_1'), false);
  const fresh = OwnerStore.newJobBilling('Northlight Wall Panels');
  assert.equal(fresh.turnaround, 'standard');
  assert.equal(fresh.material.kind, 'customer');
  assert.equal(fresh.readyForBilling, false);
  assert.deepEqual(fresh.laborLines, []);
  await OwnerStore.setJobBilling('proj_1', { jobName: 'Northlight Wall Panels', customerKey: 'cust_n', customerName: 'Northlight Studios',
    material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 }, turnaround: 'rush48', thicknessIn: 0.75 }, 'travis@example.com');
  assert.equal(OwnerStore.hasJobDetails('proj_1'), true);
  const doc = OwnerStore.getJobBilling('proj_1');
  assert.equal(doc.updatedBy, 'travis@example.com');
  assert.equal(typeof doc.updatedAt, 'number');
  await OwnerStore.setJobBilling('proj_1', { noDesignTime: true }, 'eva@example.com');
  assert.equal(OwnerStore.getJobBilling('proj_1').turnaround, 'rush48', 'partial patch keeps the rest');
  assert.equal(OwnerStore.getJobBilling('proj_1').noDesignTime, true);
});

test('labor lines carry their own billed status', () => {
  const line = OwnerStore.newLaborLine('design', 1.5, 'Bridge wall panels', 'travis@example.com');
  assert.match(line.id, /^ll_/);
  assert.equal(line.hours, 1.5);
  assert.equal(line.status, 'unbilled');
  assert.equal(line.invoiceNumber, null);
  assert.equal(line.enteredBy, 'travis@example.com');
});

test('cut-date override: creates an unbilled sheetBilling doc, refuses once priced', async () => {
  OwnerStore._resetForTests();
  const doc = await OwnerStore.setCutDateOverride('fk1', '2026-10-02', { jobKey: 'proj_1', customerKey: 'cust_n' }, 'travis@example.com');
  assert.equal(doc.status, 'unbilled');
  assert.equal(doc.cutDateOverride, '2026-10-02');
  assert.equal(doc.jobKey, 'proj_1');
  assert.equal(OwnerStore.getSheetBilling('fk1').cutDateOverride, '2026-10-02');
  await OwnerStore.setCutDateOverride('fk1', null, { jobKey: 'proj_1', customerKey: 'cust_n' }, 'travis@example.com');
  assert.equal(OwnerStore.getSheetBilling('fk1').cutDateOverride, null);
  OwnerStore._seedForTests('sheetBilling', 'fk2', { status: 'billed', invoiceNumber: 3612 });
  await assert.rejects(() => OwnerStore.setCutDateOverride('fk2', '2026-10-01', { jobKey: 'proj_1' }, 'x'), /already priced/);
});

test('customer billing: billed-outside flag and remembered material defaults by thickness', async () => {
  OwnerStore._resetForTests();
  await OwnerStore.setCustomerBilling('cust_r', { name: 'Ridgeway Vans', billedOutsideApp: true }, 'travis@example.com');
  assert.equal(OwnerStore.getCustomerBilling('cust_r').billedOutsideApp, true);
  assert.equal(OwnerStore.getCustomerBilling('cust_r').priceList, 'standard');
  await OwnerStore.rememberMaterialDefault('cust_n', 'Northlight Studios', 0.75, { kind: 'customer', materialId: null, name: '' });
  assert.deepEqual(OwnerStore.getCustomerBilling('cust_n').defaultMaterialByThickness, { '0.75': { kind: 'customer', materialId: null, name: '' } });
  await OwnerStore.rememberMaterialDefault('cust_n', 'Northlight Studios', null, { kind: 'ours' });
  assert.deepEqual(Object.keys(OwnerStore.getCustomerBilling('cust_n').defaultMaterialByThickness), ['0.75'], 'unknown thickness remembers nothing');
});

test('onChange fires on every write', async () => {
  OwnerStore._resetForTests();
  let n = 0;
  OwnerStore.onChange(() => n++);
  await OwnerStore.setSetting('invoicing', { weekEndingDay: 6 }, 'travis@example.com');
  await OwnerStore.setJobBilling('proj_9', { jobName: 'x' }, 'travis@example.com');
  assert.equal(n, 2);
  assert.equal(OwnerStore.getSetting('invoicing').savedBy, 'travis@example.com');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/storage-owner.test.mjs` — FAIL `Cannot find module '../js/storage-owner.js'`.

- [ ] **Step 3: Implement `js/storage-owner.js`**

```js
/**
 * js/storage-owner.js — the owner-only collections of the billing redesign (spec §5.4–5.8):
 * jobBilling/, sheetBilling/, customerBilling/, settings/. Firestore rules deny Collin every
 * one of them, so app.js initialises this module ONLY after Features.isOwner() is true — his
 * browser never asks. Same cache-plus-listener shape as storage.js; works with no db (PASTE
 * mode, tests). Writes here are NOT swallowed: the forms show the real error.
 * Phase 1 writes job details, labor lines, ready state, cut-date corrections, the
 * billed-outside flag and settings. Phase 2 adds invoices/ and the billing writes.
 */
const OwnerStore = (() => {
  let db = null;
  const caches = { jobBilling: {}, sheetBilling: {}, customerBilling: {}, settings: {} };
  const changeListeners = [];

  // Seeded once, on the first owner sign-in after Phase 1 ships (Travis's 2026-10-04 answers:
  // Design $150 / 1 h minimum, CAM $85 / 0.5 h minimum, both the QuickBooks item "Digital
  // Design"). From then on the numbers live in Firestore and Settings › Labor types (Phase 2)
  // edits them. Never read SEEDS for a price — read settings/laborTypes.
  const SEEDS = {
    laborTypes: { types: [
      { id: 'design', name: 'Design', rate: 150, minHours: 1,   qbItem: 'Digital Design' },
      { id: 'cam',    name: 'CAM',    rate: 85,  minHours: 0.5, qbItem: 'Digital Design' },
    ] },
    materials: { items: [] },
  };

  function init(firestore) { db = firestore; }
  function onChange(cb) { changeListeners.push(cb); }
  function emit() { changeListeners.forEach(cb => { try { cb(); } catch (e) { console.warn('OwnerStore listener threw:', e); } }); }
  const now = () => Date.now();

  async function loadCollection(name) {
    if (!db) return;
    try {
      const snap = await db.collection(name).get();
      snap.forEach(doc => { caches[name][doc.id] = doc.data(); });
    } catch (e) {
      console.warn(`Firestore ${name} load failed:`, e);
    }
  }

  function listen(name) {
    if (!db) return;
    db.collection(name).onSnapshot(snap => {
      Object.keys(caches[name]).forEach(k => delete caches[name][k]);
      snap.forEach(doc => { caches[name][doc.id] = doc.data(); });
      emit();
    }, err => console.warn(`Firestore ${name} listener error:`, err));
  }

  async function loadAll() {
    await Promise.all(Object.keys(caches).map(loadCollection));
    for (const name of Object.keys(SEEDS)) await ensureSeeded(name, SEEDS[name]);
    Object.keys(caches).forEach(listen);
  }

  async function write(name, id, doc) {
    caches[name][id] = doc;
    if (db) await db.collection(name).doc(id).set(doc);
    emit();
    return doc;
  }

  /* ── jobBilling/{jobKey} (spec §5.4) ── */
  function getJobBilling(jobKey) { return caches.jobBilling[jobKey] || null; }

  function newJobBilling(jobName) {
    return {
      jobName: jobName || '', customerKey: null, customerName: '',
      material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 },
      turnaround: 'standard', laborLines: [], noDesignTime: false,
      readyForBilling: false, readyAt: null, readyBy: null, thicknessIn: null,
    };
  }

  async function setJobBilling(jobKey, patch, by) {
    const base = caches.jobBilling[jobKey] || newJobBilling(patch && patch.jobName);
    return write('jobBilling', jobKey, { ...base, ...patch, updatedAt: now(), updatedBy: by || '' });
  }

  function hasJobDetails(jobKey) {
    const jb = getJobBilling(jobKey);
    return !!(jb && jb.customerName && jb.material && jb.material.kind && jb.turnaround);
  }

  function newLaborLine(typeId, hours, note, by) {
    return {
      id: 'll_' + now().toString(36) + Math.random().toString(36).slice(2, 6),
      typeId, hours: Number(hours), note: note || '', enteredBy: by || '', enteredAt: now(),
      status: 'unbilled', invoiceNumber: null, billedAt: null,
    };
  }

  /* ── sheetBilling/{fileKey} (spec §5.1, §5.5) — flat fields; no doc = unbilled ── */
  function getSheetBilling(fileKey) { return caches.sheetBilling[fileKey] || null; }

  async function setCutDateOverride(fileKey, ymd, refs, by) {
    const existing = caches.sheetBilling[fileKey];
    if (existing && (existing.status === 'in-progress' || existing.status === 'billed')) {
      throw new Error('This sheet is already priced on an invoice — its cut date is locked.');
    }
    const base = existing || { status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null };
    return write('sheetBilling', fileKey, {
      ...base, cutDateOverride: ymd || null,
      jobKey: (refs && refs.jobKey) || base.jobKey || null,
      customerKey: (refs && refs.customerKey) || base.customerKey || null,
      updatedAt: now(), updatedBy: by || '',
    });
  }

  /* ── customerBilling/{customerKey} (spec §5.7) ── */
  function getCustomerBilling(customerKey) { return caches.customerBilling[customerKey] || null; }

  async function setCustomerBilling(customerKey, patch, by) {
    const base = caches.customerBilling[customerKey] || { name: '', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '' };
    return write('customerBilling', customerKey, { ...base, ...patch, updatedAt: now(), updatedBy: by || '' });
  }

  async function rememberMaterialDefault(customerKey, customerName, thicknessIn, material) {
    if (!customerKey || thicknessIn == null) return;
    const base = getCustomerBilling(customerKey) || {};
    const defaults = { ...(base.defaultMaterialByThickness || {}) };
    defaults[String(thicknessIn)] = { kind: material.kind, materialId: material.materialId || null, name: material.name || '' };
    await setCustomerBilling(customerKey, { name: customerName || base.name || '', defaultMaterialByThickness: defaults }, '');
  }

  /* ── settings/{name} (spec §5.8) ── */
  function getSetting(name) { return caches.settings[name] || null; }

  async function setSetting(name, data, by) {
    return write('settings', name, { ...(caches.settings[name] || {}), ...data, savedAt: now(), savedBy: by || '' });
  }

  async function ensureSeeded(name, seed) {
    if (caches.settings[name]) return false;
    caches.settings[name] = { ...seed, seededAt: now() };
    if (db) await db.collection('settings').doc(name).set(caches.settings[name]);
    return true;
  }

  function laborTypes() { const s = getSetting('laborTypes'); return s && Array.isArray(s.types) ? s.types : []; }
  function materials() { const s = getSetting('materials'); return s && Array.isArray(s.items) ? s.items : []; }

  function _resetForTests() { Object.values(caches).forEach(c => Object.keys(c).forEach(k => delete c[k])); changeListeners.length = 0; db = null; }
  function _seedForTests(name, id, doc) { caches[name][id] = doc; }

  return { SEEDS, init, loadAll, onChange, getJobBilling, newJobBilling, setJobBilling, hasJobDetails, newLaborLine,
    getSheetBilling, setCutDateOverride, getCustomerBilling, setCustomerBilling, rememberMaterialDefault,
    getSetting, setSetting, ensureSeeded, laborTypes, materials, _resetForTests, _seedForTests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OwnerStore;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/storage-owner.test.mjs` — 7 passing. `npm test` — all passing.

- [ ] **Step 5: Script tag + commit**

`index.html`, after `storage.js?v=16`: `<script src="js/storage-owner.js?v=1"></script>`.

```bash
git add js/storage-owner.js test/storage-owner.test.mjs index.html
git commit -m "feat(storage-owner): owner-only collections — jobBilling, sheetBilling, customerBilling, settings with labor-type seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `js/features.js` — the switch reader

**Files:**
- Create: `js/features.js`
- Create: `test/features.test.mjs`
- Modify: `index.html` — script tag after `storage-owner.js`

**Interfaces:**
- Produces (global `Features`):
  - `Features.SCREENS` — `[{ key:'jobDetails', label:'Job details at upload' }, { key:'jobCard', label:'Job card owner panel' }, { key:'billing', label:'Billing' }, { key:'settings', label:'Settings' }]`
  - `Features.defaults(ownerEmail) → state` — `jobDetails` + `settings` on for that owner only (spec §7.8)
  - `Features.load(db, email) → Promise<boolean>` — reads `settings/features`; creates the default doc when it does not exist; **a read error (Collin's permission-denied) resolves `false` and leaves every screen off**; owners get a live listener
  - `Features.isOwner() → boolean` — true iff the doc was readable
  - `Features.on(key) → boolean` — `state[key].on && users includes current email` (emails compared lower-case)
  - `Features.owners() → string[]` — every email in any `users` list plus the current one (the Settings grid's columns; no email is hardcoded anywhere)
  - `Features.getState() → state copy | null` — a deep copy for the Settings grid (it needs every owner's column, not just the signed-in one)
  - `Features.applySwitch(state, key, email, enabled) → state` — pure; throws `'Settings must stay on for at least one owner.'`
  - `Features.setSwitch(key, email, enabled) → Promise<void>`, `Features.onChange(cb)`
  - `Features._setForTests(state, email)` — browser checks in PASTE mode (no db) set owner state through this

- [ ] **Step 1: Write the failing tests**

`test/features.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Features = require('../js/features.js');

const T = 'travis@example.com', E = 'eva@example.com';

function fakeDb({ existing = null, denied = false } = {}) {
  const calls = { set: [], listeners: 0 };
  return {
    calls,
    collection: () => ({ doc: () => ({
      async get() { if (denied) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); return { exists: !!existing, data: () => existing }; },
      async set(d) { calls.set.push(d); },
      onSnapshot() { calls.listeners++; },
    }) }),
  };
}

test('defaults: settings + jobDetails on for the signing-in owner only', () => {
  assert.deepEqual(Features.defaults(T), {
    jobDetails: { on: true, users: [T] }, jobCard: { on: false, users: [] },
    billing: { on: false, users: [] }, settings: { on: true, users: [T] },
  });
});

test('load: a denied read = operator — not owner, every screen off, nothing written', async () => {
  const db = fakeDb({ denied: true });
  assert.equal(await Features.load(db, 'collin@example.com'), false);
  assert.equal(Features.isOwner(), false);
  for (const s of Features.SCREENS) assert.equal(Features.on(s.key), false, s.key);
  assert.deepEqual(db.calls.set, []);
});

test('load: missing doc on first owner sign-in → defaults written for that owner, listener attached', async () => {
  const db = fakeDb({ existing: null });
  assert.equal(await Features.load(db, T.toUpperCase()), true);
  assert.equal(Features.isOwner(), true);
  assert.deepEqual(db.calls.set, [Features.defaults(T.toUpperCase())]);
  assert.equal(Features.on('settings'), true);
  assert.equal(Features.on('jobDetails'), true);
  assert.equal(Features.on('jobCard'), false);
  assert.equal(db.calls.listeners, 1);
});

test('load: existing doc — a screen is on only for the emails listed, case-insensitively', async () => {
  const state = { jobDetails: { on: true, users: [T] }, jobCard: { on: true, users: [E] }, billing: { on: false, users: [T] }, settings: { on: true, users: [T, E] } };
  const db = fakeDb({ existing: state });
  await Features.load(db, E);
  assert.equal(Features.on('jobCard'), true);
  assert.equal(Features.on('jobDetails'), false);
  assert.equal(Features.on('billing'), false, 'on:false hides it even when listed');
  assert.equal(Features.on('settings'), true);
  assert.deepEqual(Features.owners(), [E, T]);
  assert.deepEqual(db.calls.set, [], 'an existing doc is never rewritten on load');
});

test('applySwitch: pure, adds/removes an email, on follows the user list, settings keeps one owner', () => {
  const s0 = Features.defaults(T);
  const s1 = Features.applySwitch(s0, 'jobCard', E, true);
  assert.deepEqual(s1.jobCard, { on: true, users: [E] });
  assert.deepEqual(s0.jobCard, { on: false, users: [] }, 'input not mutated');
  const s2 = Features.applySwitch(s1, 'jobCard', E, false);
  assert.deepEqual(s2.jobCard, { on: false, users: [] });
  assert.throws(() => Features.applySwitch(s0, 'settings', T, false), /Settings must stay on for at least one owner/);
  const s3 = Features.applySwitch(s0, 'settings', E, true);
  assert.deepEqual(Features.applySwitch(s3, 'settings', T, false).settings, { on: true, users: [E] });
  assert.throws(() => Features.applySwitch(s0, 'nope', T, true), /Unknown screen/);
});

test('setSwitch writes the whole doc and notifies', async () => {
  const db = fakeDb({ existing: Features.defaults(T) });
  await Features.load(db, T);
  let fired = 0;
  Features.onChange(() => fired++);
  await Features.setSwitch('jobCard', T, true);
  assert.equal(Features.on('jobCard'), true);
  assert.deepEqual(db.calls.set.at(-1).jobCard, { on: true, users: [T] });
  assert.equal(fired, 1);
});

test('_setForTests drives owner state with no db (PASTE-mode browser checks)', () => {
  Features._setForTests(Features.defaults(T), T);
  assert.equal(Features.isOwner(), true);
  assert.equal(Features.on('settings'), true);
  Features._setForTests(null, 'collin@example.com');
  assert.equal(Features.isOwner(), false);
});

test('getState returns a copy (null for operators)', () => {
  Features._setForTests(Features.defaults(T), T);
  const s = Features.getState();
  s.jobCard.on = true; s.jobCard.users.push(T);
  assert.equal(Features.on('jobCard'), false, 'mutating the copy changes nothing');
  Features._setForTests(null, 'collin@example.com');
  assert.equal(Features.getState(), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/features.test.mjs` — FAIL `Cannot find module '../js/features.js'`.

- [ ] **Step 3: Implement `js/features.js`**

```js
/**
 * js/features.js — which owner screens are switched on for whom (spec §3, §7.8).
 * The doc settings/features is readable ONLY by owners (Firestore rules). On sign-in the app
 * tries to read it: Collin's read is denied → state stays null → every owner screen is off,
 * by construction, with no email in this file (the repo is public). An owner's read succeeds;
 * if the doc does not exist yet (first owner sign-in after Phase 1) it is created with
 * `settings` + `jobDetails` on for that owner only, so Travis can reach Settings to turn the
 * rest on. Switching a screen off hides it on the next render; it never changes data.
 */
const Features = (() => {
  const SCREENS = [
    { key: 'jobDetails', label: 'Job details at upload' },
    { key: 'jobCard',    label: 'Job card owner panel' },
    { key: 'billing',    label: 'Billing' },
    { key: 'settings',   label: 'Settings' },
  ];
  let db = null;
  let email = '';
  let state = null;          // null = operator (doc unreadable / not loaded)
  const listeners = [];
  const norm = e => String(e || '').trim().toLowerCase();

  function defaults(ownerEmail) {
    return {
      jobDetails: { on: true,  users: [ownerEmail] },
      jobCard:    { on: false, users: [] },
      billing:    { on: false, users: [] },
      settings:   { on: true,  users: [ownerEmail] },
    };
  }

  function emit() { listeners.forEach(cb => { try { cb(); } catch (e) { console.warn('Features listener threw:', e); } }); }

  async function load(firestore, currentEmail) {
    db = firestore;
    email = norm(currentEmail);
    state = null;
    try {
      const ref = db.collection('settings').doc('features');
      const snap = await ref.get();
      if (snap.exists) {
        state = snap.data();
      } else {
        state = defaults(currentEmail);
        await ref.set(state);
      }
      ref.onSnapshot(s => { if (s.exists) { state = s.data(); emit(); } },
        err => console.warn('Firestore features listener error:', err));
      return true;
    } catch (e) {
      // The normal operator path: Collin's account cannot read settings/*. Stay silent.
      state = null;
      return false;
    }
  }

  function isOwner() { return state !== null; }

  // Deep copy: the Settings grid reads every column; nothing outside this file mutates state.
  function getState() { return state ? JSON.parse(JSON.stringify(state)) : null; }

  function on(key) {
    const s = state && state[key];
    return !!(s && s.on && Array.isArray(s.users) && s.users.map(norm).includes(email));
  }

  function owners() {
    const set = new Set();
    if (state) Object.values(state).forEach(s => (s && Array.isArray(s.users) ? s.users : []).forEach(u => set.add(norm(u))));
    if (email) set.add(email);
    return [...set].sort();
  }

  // Pure. `on` follows the user list; Settings can never be switched off for the last owner.
  function applySwitch(current, key, userEmail, enabled) {
    if (!SCREENS.some(s => s.key === key)) throw new Error('Unknown screen: ' + key);
    const next = JSON.parse(JSON.stringify(current || {}));
    const sw = next[key] || (next[key] = { on: false, users: [] });
    const users = (sw.users || []).filter(u => norm(u) !== norm(userEmail));
    if (enabled) users.push(norm(userEmail));
    sw.users = users;
    sw.on = users.length > 0;
    if (key === 'settings' && users.length === 0) throw new Error('Settings must stay on for at least one owner.');
    return next;
  }

  async function setSwitch(key, userEmail, enabled) {
    const next = applySwitch(state, key, userEmail, enabled);
    state = next;
    if (db) await db.collection('settings').doc('features').set(next);
    emit();
  }

  function onChange(cb) { listeners.push(cb); }

  function _setForTests(s, e) { state = s; email = norm(e); db = null; }

  return { SCREENS, defaults, load, isOwner, getState, on, owners, applySwitch, setSwitch, onChange, _setForTests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Features;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/features.test.mjs` — 8 passing. `npm test` — all passing.

- [ ] **Step 5: Script tag + commit**

`index.html`, after `storage-owner.js`: `<script src="js/features.js?v=1"></script>`.

```bash
git add js/features.js test/features.test.mjs index.html
git commit -m "feat(features): settings/features switch reader — denied read = operator, first owner sign-in seeds the doc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings screen (switches, customers, maintenance) + the sign-in hooks in app.js

**Files:**
- Create: `js/settings.js`
- Modify: `index.html` — Settings button (hidden) in the Projects header, `#settings-screen` section, script tag, `app.js?v=35`, `style.css?v=24`
- Modify: `css/style.css` — append `.settings-*` rules
- Modify: `js/app.js` — DOM refs (~line 58), screen hiding (`showProjectsScreen` ~284, `showLoginScreen` ~294, `showTicketHistoryScreen` ~335, `showManageCustomersScreen` ~391), `loadDataAndShowApp` (~2293), `initApp`'s `Auth.onAuthChange` (~2378), new helpers before `/* ═══ Helpers ═══ */`

**Interfaces:**
- Consumes: `Features.*` (Task 8), `OwnerStore.*` (Task 7), `Storage.migrateFinishedFlag/migrationState/getCustomers` (Task 6), `formatDT`, `escHtml`.
- Produces:
  - `SettingsScreen.init({ hideOthers, onBack, currentEmail })`, `SettingsScreen.show()`, `SettingsScreen.render()`
  - app.js helpers used by Tasks 10–12: `currentUserEmail() → string`, `applyFeatureNav()`, `rerenderCurrent()`, `hideAllScreens()`.
- Order of operations on sign-in: `Features.load` → (owner) `OwnerStore.init` + `loadAll` → `Storage.loadMigrationState()` → the existing loads. Sign-out already reloads the page, so a Travis→Collin switch always starts clean.

No `node --test` covers DOM wiring in this repo; the check is the PASTE-mode run in Step 6 (and Task 13's Playwright pass).

- [ ] **Step 1: Markup**

In `index.html`, Projects header `header-right`, after `#manage-customers-btn`:

```html
        <button class="btn btn-ghost btn-sm" id="settings-btn" hidden>Settings</button>
```

After the Manage Customers screen's closing `</div>` (before the `UPLOAD SCREEN` comment):

```html
  <!-- ══════════════════════════════════
       SETTINGS SCREEN (owners only — Collin's account cannot read settings/*)
  ══════════════════════════════════ -->
  <div id="settings-screen" hidden>
    <header class="app-header">
      <div class="header-left">
        <button class="btn btn-ghost btn-sm" id="settings-back-btn">← Projects</button>
        <span class="header-logo-badge">CNC</span>
        <div class="header-divider"></div>
        <div class="header-titles">
          <span class="header-file-title">Settings</span>
          <span class="header-job-name">Owners only</span>
        </div>
      </div>
    </header>
    <main class="content-main">
      <p id="settings-status" class="vanlab-status" hidden></p>

      <section class="settings-card">
        <h2 class="settings-card-title">Screens on/off</h2>
        <p class="settings-card-hint">A switch shows or hides that screen for that owner on the next render. It never changes data and never affects Collin — his account cannot read this page at all. Settings stays on for at least one owner.</p>
        <div id="settings-screens-grid" class="settings-grid"></div>
        <div class="settings-add-owner">
          <input type="email" id="settings-add-owner-email" class="form-input" placeholder="Another owner's sign-in email…" autocomplete="off">
          <button type="button" class="btn btn-outline btn-sm" id="settings-add-owner-btn">Add column</button>
        </div>
        <p class="settings-card-hint">The column appears for this session; it is remembered once any switch is ticked for it. The account itself is created in the Firebase console and added to the Firestore rules by hand.</p>
      </section>

      <section class="settings-card">
        <h2 class="settings-card-title">Customers (billing)</h2>
        <p class="settings-card-hint">From Manage Customers. <strong>Billed outside this app</strong> keeps a customer's sheets out of Billing (VanLab until its own build; Golden Boys' in-house work). Sheets are still recorded, finished and logged.</p>
        <div id="settings-customers-list" class="settings-list"></div>
      </section>

      <section class="settings-card">
        <h2 class="settings-card-title">Maintenance</h2>
        <div class="settings-row">
          <div>
            <strong>Mark existing sheets as on the board</strong>
            <div id="settings-migration-status" class="settings-card-hint"></div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="settings-migrate-btn">Run</button>
        </div>
      </section>

      <p class="settings-card-hint">Prices, labor types, QuickBooks items, materials and the invoice seed arrive with Phase 2.</p>
    </main>
  </div>
```

Script tags: after `features.js`, add `<script src="js/settings.js?v=1"></script>`; bump `js/app.js?v=34` → `?v=35` and `css/style.css?v=23` → `?v=24`.

- [ ] **Step 2: Styles** — append to `css/style.css`:

```css
/* ── Settings screen (owners) ── */
.settings-card { background: var(--white); border: 1px solid var(--gray-200); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 16px; box-shadow: var(--shadow-sm); }
.settings-card-title { font-size: 1.05rem; font-weight: 800; margin: 0 0 6px; }
.settings-card-hint { font-size: 0.8rem; color: var(--gray-500); margin: 4px 0 10px; }
.settings-grid { display: grid; gap: 6px 14px; align-items: center; font-size: 0.9rem; }
.settings-grid .settings-grid-head { font-size: 0.75rem; color: var(--gray-500); text-transform: uppercase; letter-spacing: 0.04em; }
.settings-grid label { display: flex; justify-content: center; }
.settings-add-owner { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.settings-add-owner .form-input { max-width: 320px; }
.settings-list { display: flex; flex-direction: column; gap: 6px; }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--gray-200); }
.settings-row:first-of-type { border-top: 0; }
.settings-row label { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer; }
.settings-status--error { color: var(--red); }
@media (max-width: 480px) { .settings-card { padding: 12px; } }
```

- [ ] **Step 3: `js/settings.js`**

```js
/**
 * js/settings.js — the Settings screen (spec §7.7). Phase 1 ships three cards: Screens
 * on/off, Customers (billing) and Maintenance. Prices / labor types / QuickBooks /
 * materials cards are Phase 2. Owners only: reached through a header button that exists
 * only when Features.on('settings'). app.js owns navigation; this file owns the cards.
 */
const SettingsScreen = (() => {
  let els = null;
  let opts = { hideOthers() {}, onBack() {}, currentEmail: () => '' };
  const extraOwners = new Set();   // emails typed into "Add column" this session

  const byId = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const localPart = email => String(email || '').split('@')[0];

  function init(options) {
    opts = { ...opts, ...options };
    els = {
      screen: byId('settings-screen'), status: byId('settings-status'), grid: byId('settings-screens-grid'),
      addEmail: byId('settings-add-owner-email'), addBtn: byId('settings-add-owner-btn'),
      customers: byId('settings-customers-list'), migStatus: byId('settings-migration-status'), migBtn: byId('settings-migrate-btn'),
    };
    byId('settings-back-btn').addEventListener('click', () => opts.onBack());
    els.addBtn.addEventListener('click', addOwnerColumn);
    els.addEmail.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOwnerColumn(); } });
    els.grid.addEventListener('change', onSwitchChange);
    els.customers.addEventListener('change', onCustomerChange);
    els.migBtn.addEventListener('click', runMigration);
  }

  function setStatus(text, isError) {
    els.status.textContent = text || '';
    els.status.hidden = !text;
    els.status.classList.toggle('settings-status--error', !!isError);
  }

  function show() {
    opts.hideOthers();
    els.screen.hidden = false;
    setStatus('');
    render();
  }

  function render() {
    if (!els || els.screen.hidden) return;
    renderScreens();
    renderCustomers();
    renderMigration();
  }

  /* ── Screens on/off ── */
  function ownerColumns() {
    return [...new Set([...Features.owners(), ...extraOwners])].sort();
  }

  function renderScreens() {
    const owners = ownerColumns();
    els.grid.style.gridTemplateColumns = `minmax(160px, 1fr) repeat(${owners.length}, auto)`;
    let html = '<div class="settings-grid-head">Screen</div>' + owners.map(o => `<div class="settings-grid-head" title="${esc(o)}">${esc(localPart(o))}</div>`).join('');
    for (const s of Features.SCREENS) {
      html += `<div>${esc(s.label)}</div>`;
      for (const o of owners) {
        html += `<label><input type="checkbox" data-screen="${esc(s.key)}" data-owner="${esc(o)}" ${isOn(s.key, o) ? 'checked' : ''} aria-label="${esc(s.label)} for ${esc(o)}"></label>`;
      }
    }
    els.grid.innerHTML = html;
  }

  // Features.on() answers for the signed-in owner only; the grid needs every column.
  function isOn(key, owner) {
    const s = Features.getState();
    const sw = s && s[key];
    return !!(sw && sw.on && (sw.users || []).map(u => String(u).toLowerCase()).includes(owner));
  }

  async function onSwitchChange(e) {
    const box = e.target.closest('input[data-screen]');
    if (!box) return;
    try {
      await Features.setSwitch(box.dataset.screen, box.dataset.owner, box.checked);
      setStatus(`${box.checked ? 'On' : 'Off'}: ${Features.SCREENS.find(s => s.key === box.dataset.screen).label} for ${localPart(box.dataset.owner)}.`);
    } catch (err) {
      setStatus(err.message, true);
    }
    render();
  }

  function addOwnerColumn() {
    const email = els.addEmail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatus('Type the full sign-in email.', true); return; }
    extraOwners.add(email);
    els.addEmail.value = '';
    setStatus(`Column added for ${localPart(email)} — tick a switch to remember it.`);
    render();
  }

  /* ── Customers (billing) ── */
  function renderCustomers() {
    const customers = Storage.getCustomers();
    if (!customers.length) { els.customers.innerHTML = '<p class="settings-card-hint">No customers yet — add them in Manage Customers.</p>'; return; }
    els.customers.innerHTML = customers.map(c => {
      const cb = OwnerStore.getCustomerBilling(c.key);
      const outside = !!(cb && cb.billedOutsideApp);
      return `<div class="settings-row"><span>${esc(c.name)}</span>
        <label><input type="checkbox" data-customer="${esc(c.key)}" data-name="${esc(c.name)}" ${outside ? 'checked' : ''}> Billed outside this app</label></div>`;
    }).join('');
  }

  async function onCustomerChange(e) {
    const box = e.target.closest('input[data-customer]');
    if (!box) return;
    try {
      await OwnerStore.setCustomerBilling(box.dataset.customer, { name: box.dataset.name, billedOutsideApp: box.checked }, opts.currentEmail());
      setStatus(`${box.dataset.name}: ${box.checked ? 'billed outside this app' : 'billed here'}.`);
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`, true);
      render();
    }
  }

  /* ── Maintenance ── */
  function renderMigration() {
    const st = Storage.migrationState();
    els.migStatus.textContent = st
      ? `Done ${formatDT(new Date(st.at))} — ${st.count} sheet${st.count !== 1 ? 's' : ''} stamped. Running again is safe; it finds nothing to do.`
      : 'Not run yet. Until it runs, every device loads all sheets and hides finished ones in the browser. Run it once after this version is live.';
    els.migBtn.textContent = st ? 'Run again' : 'Run';
  }

  async function runMigration() {
    if (!confirm('Stamp every existing sheet as "on the board" (finished: false)? Nothing is deleted and nothing leaves the board. Safe to run more than once.')) return;
    els.migBtn.disabled = true;
    try {
      const res = await Storage.migrateFinishedFlag((done, total) => { els.migStatus.textContent = `Stamping ${done} of ${total}…`; });
      setStatus(`Migration done — ${res.stamped} of ${res.total} sheets needed the flag. The board now uses the finished filter on next load.`);
    } catch (err) {
      setStatus(`Migration failed — ${err.message}. Nothing is lost; run it again.`, true);
    } finally {
      els.migBtn.disabled = false;
      renderMigration();
    }
  }

  return { init, show, render };
})();
```

(`formatDT` and `confirm` are app.js's existing helpers / the repo's destructive-action pattern; `Features.onChange` → `rerenderCurrent()` in app.js is what re-paints this screen when another device flips a switch.)

- [ ] **Step 4: app.js hooks**

(a) DOM refs — after `const customersScreen = …` add `const settingsScreen = document.getElementById('settings-screen');`.

(b) Replace the body of `showProjectsScreen` with a shared hider — change it to:

```js
function hideAllScreens() {
  uploadScreen.hidden        = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = true;
  settingsScreen.hidden      = true;
  projectsScreen.hidden      = true;
}

function showProjectsScreen() {
  hideAllScreens();
  projectsScreen.hidden = false;
  renderProjects();
  renderPrintQueue();
}
```

and in `showLoginScreen`, `showTicketHistoryScreen`, `showManageCustomersScreen` add `settingsScreen.hidden = true;` next to the existing `customersScreen.hidden = true;` lines (do not restructure those three — minimal diff).

(c) New section before `/* ═══ Helpers ═══ */`:

```js
/* ══════════════════════════════════════════
   Owner screens — switches, Settings (customer billing redesign, Phase 1)
   Spec: docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md
   app.js only gains the hooks to open them; each screen lives in its own file.
══════════════════════════════════════════ */
// PASTE-mode guard (same as pqSend): firebase.auth() throws if no app was initialised.
function currentUserEmail() {
  const app = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
  const user = app ? app.auth().currentUser : null;
  return user ? (user.email || '') : '';
}

// Nav buttons exist only when the switch for THIS owner is on. For Collin, Features.on() is
// always false, so this is a no-op that leaves the header exactly as today.
function applyFeatureNav() {
  document.getElementById('settings-btn').hidden = !Features.on('settings');
  if (!Features.on('settings') && !settingsScreen.hidden) showProjectsScreen();
}

// Re-paint whatever is on screen after owner data or a switch changes.
function rerenderCurrent() {
  if (!projectsScreen.hidden) renderProjects();
  if (!contentScreen.hidden)  showContentScreen();
  if (!settingsScreen.hidden) SettingsScreen.render();
}

SettingsScreen.init({ hideOthers: hideAllScreens, onBack: showProjectsScreen, currentEmail: currentUserEmail });
document.getElementById('settings-btn').addEventListener('click', () => SettingsScreen.show());
Features.onChange(() => { applyFeatureNav(); rerenderCurrent(); });
```

(d) In `initApp`, inside `Auth.onAuthChange`'s `if (!dataLoaded)` branch, replace `loadDataAndShowApp();` with:

```js
        loadOwnerStateThen(db, user.email).then(loadDataAndShowApp);
```

and add, just above `async function initApp()`:

```js
// Owner state first: Features decides whether OwnerStore is even asked (Collin's read of
// settings/features is denied by the rules → operator → nothing else is loaded).
async function loadOwnerStateThen(db, email) {
  await Features.load(db, email);
  if (Features.isOwner()) {
    OwnerStore.init(db);
    await OwnerStore.loadAll();
    OwnerStore.onChange(rerenderCurrent);
  }
  applyFeatureNav();
}
```

(e) In `loadDataAndShowApp`, before `const [storedSheets] = await Promise.all([`, add:

```js
  // Must come first: it decides whether loadSheets()/onSheetsChange use the finished filter.
  await Storage.loadMigrationState();
```

- [ ] **Step 5: Run the suite** — `npm test` all passing (no DOM tests, but every module still loads).

- [ ] **Step 6: PASTE-mode check (never against production)**

```bash
SRC="/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp/.worktrees/customer-billing-phase-1"
DST="$TEMP/cnc-p1-test"; rm -rf "$DST"; mkdir -p "$DST"
cp -r "$SRC"/{index.html,css,js,assets,package.json} "$SRC"/260520_*.html "$DST"/
printf "const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };\n" > "$DST/js/firebase-config.js"
printf "const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\n" > "$DST/js/endpoint-config.js"
cd "$DST" && npx serve . -l 5057
```

Open http://localhost:5057 (PASTE mode: no sign-in, `Features` never loaded = Collin's view):

1. Drop the sample sheet → Projects screen. Header shows To Print / Ticket History / Manage Customers / + Upload Job — **no Settings button**. Console: `Features.isOwner()` → `false`.
2. Console: `Features._setForTests(Features.defaults('t@x'), 't@x'); OwnerStore.loadAll().then(() => { OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); })` → **Settings** button appears. Click it.
3. Screens grid: one column `t`, rows Job details (checked), Job card (unchecked), Billing (unchecked), Settings (checked). Untick Settings → red `Settings must stay on for at least one owner.` and it re-checks. Tick Job card → status line `On: Job card owner panel for t.`
4. Type `e@x` → Add column → second column `e`, all unchecked; tick Settings for `e`; now untick Settings for `t` → allowed; re-tick it.
5. Customers card: add a customer in Manage Customers first (`Ridgeway Vans`) → back to Settings → row with the Billed-outside checkbox; tick → status confirms; console `OwnerStore.getCustomerBilling(customerKey('Ridgeway Vans')).billedOutsideApp` → `true`.
6. Maintenance: status says `Not run yet…`; Run → confirm → `Migration done — 0 of 0 sheets…` (no db); button says `Run again`.
7. Resize to 320px — cards and grid wrap, no horizontal scroll.

Stop the server; keep `$DST` for Task 10.

- [ ] **Step 7: Commit**

```bash
git add index.html css/style.css js/settings.js js/app.js
git commit -m "feat(settings): owner Settings screen — screens on/off grid, billed-outside customers, finished-flag migration; features load on sign-in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Job details at upload (`js/job-details.js`) + the re-upload guard

**Files:**
- Create: `js/job-details.js`
- Create: `test/job-details-thickness.test.mjs`
- Modify: `index.html` — `#job-details-overlay` modal, script tag
- Modify: `css/style.css` — `.jd-*`, `.modal-card--wide`
- Modify: `js/app.js` — `handleFiles` (~line 183–260), one `JobDetails.init` line in the Owner screens section

**Interfaces:**
- Consumes: `OwnerStore.hasJobDetails/getJobBilling/setJobBilling/materials/rememberMaterialDefault/getCustomerBilling`, `Storage.getCustomers/addCustomer/setProjectCustomer/upsertJob/getSheetDoc`, `Pricing.parseTimeSec/formatDuration/repeatCount`, `Features.on('jobDetails')`.
- Produces (global `JobDetails`):
  - `JobDetails.thicknessFromMaterialInfo(materialInfo) → number|null` — pure. VCarve writes `Material Block: X: 48"  Y: 96"  Z: 0.47"`; Z is the thickness. A label containing "Thickness" wins when present; otherwise the `Z:` value (or last number) of a "Material Block"/"Material Size" line.
  - `JobDetails.sheetSizeLabel(materialInfo) → '48×96' | ''`
  - `JobDetails.init({ noteKey, customerKey, currentEmail, onCancelJob })`
  - `JobDetails.promptForNewJobs(jobNames, sheetsForJob) → Promise<void>` — one blocking form per job that has no details yet (spec §7.1); `sheetsForJob(jobName)` returns that job's sheets in display order. Cancel → `onCancelJob(jobName)` (app.js's `deleteProject`: the just-saved sheets are unfinished and unbilled, so the delete rule allows it).
  - `JobDetails.openEdit(jobName, jobSheets) → Promise<boolean>` — same form, prefilled, buttons "Save job details" / "Cancel" (no delete). Task 12's owner panel calls it.
- Writes on confirm: `Storage.addCustomer` (new name), `Storage.setProjectCustomer(jobKey, name)`, `Storage.upsertJob(jobKey, jobName, by)`, `OwnerStore.setJobBilling(jobKey, { jobName, customerKey, customerName, material, turnaround, thicknessIn }, by)`, `OwnerStore.rememberMaterialDefault(...)`.
- Material "Ours" reads `settings/materials` (empty until Phase 2's Settings › Materials card): when empty, the radio is disabled with the hint *No materials set up yet — Settings › Materials arrives with Phase 2.* The customer-supplied path is complete in Phase 1.
- Re-upload guard (spec §5.2): `handleFiles` reads `Storage.getSheetDoc(fileKey)` before saving; a finished doc → blocking notice *"<file>" was already cut and finished on <date> (job <name>). If this is a new cut, save it from Aspire under a new file name.* Nothing is overwritten; the other files in the drop still load.

- [ ] **Step 1: Write the failing tests**

`test/job-details-thickness.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JobDetails = require('../js/job-details.js');   // DOM is touched only inside init()

test('thickness comes from the Material Block Z value (what VCarve actually writes)', () => {
  const info = [{ label: 'Material Block', value: 'X: 48"  Y: 96"  Z: 0.47"' }, { label: 'Home / Start Position', value: 'X: 0"  Y: 0"  Z: 0.76"' }];
  assert.equal(JobDetails.thicknessFromMaterialInfo(info), 0.47);
  assert.equal(JobDetails.sheetSizeLabel(info), '48×96');
});

test('an explicit Thickness line wins; Material Size falls back to its last number', () => {
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Material Size', value: '48 x 96 x 0.75' }, { label: 'Thickness', value: '0.5 in' }]), 0.5);
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Material Size', value: '48 x 96 x 0.75' }]), 0.75);
});

test('nothing usable → null / empty, never NaN', () => {
  assert.equal(JobDetails.thicknessFromMaterialInfo([]), null);
  assert.equal(JobDetails.thicknessFromMaterialInfo(null), null);
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Datum Position', value: '' }]), null);
  assert.equal(JobDetails.sheetSizeLabel([{ label: 'Z-Zero', value: 'Top of Material' }]), '');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/job-details-thickness.test.mjs` → `Cannot find module '../js/job-details.js'`.

- [ ] **Step 3: Markup + styles**

`index.html`, after the customer-picker modal:

```html
  <!-- ══════════════════════════════════
       JOB DETAILS MODAL (owners — upload step and Edit job details)
  ══════════════════════════════════ -->
  <div id="job-details-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
    <div class="modal-card modal-card--wide">
      <h2 class="modal-title" id="job-details-title">Job details</h2>
      <p id="job-details-subtitle" class="modal-subtitle"></p>
      <div id="job-details-sheets" class="jd-sheets"></div>
      <p id="job-details-summary" class="jd-summary"></p>
      <div class="modal-form">
        <div class="form-group">
          <label class="form-label" for="job-details-customer">Customer <span class="jd-hint">— names match QuickBooks exactly</span></label>
          <select id="job-details-customer" class="form-input"></select>
        </div>
        <div class="form-group" id="job-details-customer-other-group" hidden>
          <label class="form-label" for="job-details-customer-other">Customer name</label>
          <input type="text" id="job-details-customer-other" class="form-input" placeholder="Exactly as QuickBooks spells it">
        </div>
        <div class="form-group">
          <span class="form-label">Material</span>
          <label class="jd-radio"><input type="radio" name="jd-material" value="customer" checked> Customer supplied — no material charge</label>
          <label class="jd-radio"><input type="radio" name="jd-material" value="ours" id="job-details-material-ours"> Ours:
            <select id="job-details-material" class="form-input jd-inline-select"></select></label>
          <div id="job-details-material-hint" class="jd-hint"></div>
        </div>
        <div class="form-group">
          <span class="form-label">Turnaround</span>
          <label class="jd-radio"><input type="radio" name="jd-turnaround" value="standard" checked> Standard</label>
          <label class="jd-radio"><input type="radio" name="jd-turnaround" value="rush48"> 48-hour rush (+50%)</label>
          <label class="jd-radio"><input type="radio" name="jd-turnaround" value="rush24"> 24-hour rush (+75%)</label>
        </div>
        <p class="jd-hint">Design / CAM hours get added on the job card when the drawing is done.</p>
        <p id="job-details-error" class="upload-error" hidden></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="job-details-cancel">Cancel</button>
        <button class="btn btn-primary" id="job-details-confirm">Add job to the board</button>
      </div>
    </div>
  </div>
```

Script tag after `settings.js`: `<script src="js/job-details.js?v=1"></script>`.

`css/style.css`, append:

```css
/* ── Job details (owners): upload step + Edit job details ── */
.modal-card--wide { max-width: 640px; }
.jd-sheets { font-size: 0.82rem; color: var(--gray-700); border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 8px 10px; max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.jd-sheets .jd-sheet-row { display: flex; gap: 10px; }
.jd-sheets .jd-sheet-num { color: var(--gray-500); min-width: 1.5em; }
.jd-summary { font-size: 0.85rem; color: var(--gray-500); margin: 6px 0 4px; }
.jd-hint { font-size: 0.78rem; color: var(--gray-500); font-weight: 400; }
.jd-radio { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; padding: 3px 0; cursor: pointer; }
.jd-inline-select { max-width: 280px; }
```

- [ ] **Step 4: Implement `js/job-details.js`**

```js
/**
 * js/job-details.js — the owner's job-details step (spec §7.1): after a drop, one blocking form
 * per NEW job (no jobBilling doc yet) asks customer, material and turnaround, then writes
 * projectCustomer/, jobs/ and jobBilling/. The same form reopens from the job card as "Edit job
 * details". Collin never sees it: app.js opens it only when Features.on('jobDetails').
 * Pure helpers (thickness, size) have no DOM so node --test can load this file; init() wires it.
 */
const JobDetails = (() => {
  const num = s => { const m = /(-?\d+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1]) : null; };

  // VCarve: "Material Block: X: 48"  Y: 96"  Z: 0.47"" — Z is the thickness. A line labelled
  // Thickness wins when the CAM template has one; "Material Size" falls back to its last number.
  function thicknessFromMaterialInfo(materialInfo) {
    const info = Array.isArray(materialInfo) ? materialInfo : [];
    const thick = info.find(x => /thickness/i.test(x.label || ''));
    if (thick) return num(thick.value);
    const block = info.find(x => /material\s*(block|size)/i.test(x.label || ''));
    if (!block) return null;
    const z = /Z:\s*(-?\d+(?:\.\d+)?)/i.exec(String(block.value || ''));
    if (z) return Number(z[1]);
    const nums = String(block.value || '').match(/-?\d+(?:\.\d+)?/g);
    return nums && nums.length ? Number(nums[nums.length - 1]) : null;
  }

  function sheetSizeLabel(materialInfo) {
    const info = Array.isArray(materialInfo) ? materialInfo : [];
    const block = info.find(x => /material\s*(block|size)/i.test(x.label || ''));
    if (!block) return '';
    const x = /X:\s*(\d+(?:\.\d+)?)/i.exec(block.value || ''), y = /Y:\s*(\d+(?:\.\d+)?)/i.exec(block.value || '');
    return x && y ? `${x[1]}×${y[1]}` : '';
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let els = null;
  let hooks = { noteKey: null, customerKey: null, currentEmail: () => '', onCancelJob: async () => {} };
  let ctx = null;   // { mode:'new'|'edit', jobName, jobKey, jobSheets, thicknessIn, resolve }

  function init(h) {
    hooks = { ...hooks, ...h };
    const byId = id => document.getElementById(id);
    els = {
      overlay: byId('job-details-overlay'), title: byId('job-details-title'), subtitle: byId('job-details-subtitle'),
      sheets: byId('job-details-sheets'), summary: byId('job-details-summary'),
      customer: byId('job-details-customer'), otherGroup: byId('job-details-customer-other-group'), other: byId('job-details-customer-other'),
      oursRadio: byId('job-details-material-ours'), material: byId('job-details-material'), materialHint: byId('job-details-material-hint'),
      error: byId('job-details-error'), cancel: byId('job-details-cancel'), confirm: byId('job-details-confirm'),
    };
    els.customer.addEventListener('change', () => { els.otherGroup.hidden = els.customer.value !== '__other__'; applyMaterialDefault(); });
    els.cancel.addEventListener('click', () => close(false));
    els.confirm.addEventListener('click', submit);
    // No click-outside-to-close: this step is blocking on purpose (a job without details is
    // what "Needs job details" exists to catch).
  }

  function showError(msg) { els.error.textContent = msg || ''; els.error.hidden = !msg; }

  function open(mode, jobName, jobSheets) {
    return new Promise(resolve => {
      const jobKey = hooks.noteKey(jobName);
      const existing = OwnerStore.getJobBilling(jobKey);
      const thicknessIn = thicknessFromMaterialInfo(jobSheets[0] && jobSheets[0].materialInfo);
      ctx = { mode, jobName, jobKey, jobSheets, thicknessIn, resolve };
      els.title.textContent = mode === 'edit' ? 'Edit job details' : 'Job details';
      els.subtitle.textContent = jobName;
      els.confirm.textContent = mode === 'edit' ? 'Save job details' : 'Add job to the board';
      showError('');

      els.sheets.innerHTML = jobSheets.map((s, i) => {
        const size = sheetSizeLabel(s.materialInfo);
        const t = thicknessFromMaterialInfo(s.materialInfo);
        const dims = size ? `${size}${t != null ? ` × ${t} in` : ''}` : (t != null ? `${t} in` : '');
        return `<div class="jd-sheet-row"><span class="jd-sheet-num">${i + 1}.</span><span>${esc(s.sheetTitle || s.fileName)}</span>` +
          `<span class="jd-hint">${esc(dims)}${dims ? ' · ' : ''}${(s.toolpaths || []).length} toolpath${(s.toolpaths || []).length !== 1 ? 's' : ''} · ${esc(s.totalTime || '—')}</span></div>`;
      }).join('');
      const totalSec = jobSheets.reduce((n, s) => n + Pricing.parseTimeSec(s.totalTime), 0);
      const repeats = Pricing.repeatCount(jobSheets);
      els.summary.textContent = `${jobSheets.length} sheet${jobSheets.length !== 1 ? 's' : ''} · ${Pricing.formatDuration(totalSec)} Aspire time · ${repeats ? `${repeats} repeat${repeats !== 1 ? 's' : ''} found` : 'no repeats found in this job'}`;

      const known = Storage.getCustomers();
      els.customer.innerHTML = '<option value="" disabled>Select customer…</option>' +
        known.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('') +
        '<option value="__other__">+ New customer…</option>';
      const priorName = (existing && existing.customerName) || Storage.getProjectCustomer(jobKey);
      const priorMatch = priorName && known.find(c => c.name === priorName);
      if (priorMatch) { els.customer.value = priorMatch.key; els.otherGroup.hidden = true; els.other.value = ''; }
      else if (priorName) { els.customer.value = '__other__'; els.otherGroup.hidden = false; els.other.value = priorName; }
      else { els.customer.value = ''; els.otherGroup.hidden = true; els.other.value = ''; }

      const materials = OwnerStore.materials();
      els.material.innerHTML = materials.map(m => `<option value="${esc(m.id)}">${esc(m.name)} — $${Number(m.pricePerSheet || 0).toFixed(2)} / sheet</option>`).join('');
      els.oursRadio.disabled = materials.length === 0;
      els.material.disabled = materials.length === 0;
      els.materialHint.textContent = materials.length ? '' : 'No materials set up yet — Settings › Materials arrives with Phase 2.';

      const mat = existing ? existing.material : null;
      setRadio('jd-material', mat && mat.kind === 'ours' && materials.length ? 'ours' : 'customer');
      if (mat && mat.kind === 'ours' && mat.materialId) els.material.value = mat.materialId;
      setRadio('jd-turnaround', (existing && existing.turnaround) || 'standard');
      if (!existing) applyMaterialDefault();

      els.overlay.classList.remove('hidden');
      setTimeout(() => els.customer.focus(), 50);
    });
  }

  function setRadio(name, value) { const el = document.querySelector(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; }
  function radio(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }

  // Pre-fill from the customer's remembered default for this thickness (spec §7.1).
  function applyMaterialDefault() {
    if (!ctx || ctx.mode === 'edit' || ctx.thicknessIn == null) return;
    const key = els.customer.value && els.customer.value !== '__other__' ? els.customer.value : null;
    const cb = key ? OwnerStore.getCustomerBilling(key) : null;
    const def = cb && cb.defaultMaterialByThickness && cb.defaultMaterialByThickness[String(ctx.thicknessIn)];
    if (!def) return;
    const name = (Storage.getCustomers().find(c => c.key === key) || {}).name || 'this customer';
    if (def.kind === 'ours' && OwnerStore.materials().some(m => m.id === def.materialId)) {
      setRadio('jd-material', 'ours'); els.material.value = def.materialId;
      els.materialHint.textContent = `Picked for you: the last ${ctx.thicknessIn} in job for ${name} used ${def.name || 'our material'}.`;
    } else {
      setRadio('jd-material', 'customer');
      els.materialHint.textContent = `Picked for you: the last ${ctx.thicknessIn} in job for ${name} was customer supplied.`;
    }
  }

  async function submit() {
    if (!ctx) return;
    let customerName, customerKey;
    if (els.customer.value === '__other__') {
      customerName = els.other.value.trim();
      if (!customerName) { showError('Type the customer name exactly as QuickBooks spells it.'); return; }
      customerKey = hooks.customerKey(customerName);
    } else {
      const match = Storage.getCustomers().find(c => c.key === els.customer.value);
      if (!match) { showError('Pick a customer.'); return; }
      customerName = match.name; customerKey = match.key;
    }
    const kind = radio('jd-material');
    let material = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 };
    if (kind === 'ours') {
      const m = OwnerStore.materials().find(x => x.id === els.material.value);
      if (!m) { showError('Pick one of our materials, or choose Customer supplied.'); return; }
      material = { kind: 'ours', materialId: m.id, name: m.name, pricePerSheet: Number(m.pricePerSheet || 0) };   // price snapshot at selection
    }
    const turnaround = radio('jd-turnaround') || 'standard';
    const by = hooks.currentEmail();
    els.confirm.disabled = true;
    try {
      if (!Storage.getCustomers().some(c => c.key === customerKey)) await Storage.addCustomer(customerKey, customerName);
      await Storage.setProjectCustomer(ctx.jobKey, customerName);
      await Storage.upsertJob(ctx.jobKey, ctx.jobName, by);
      await OwnerStore.setJobBilling(ctx.jobKey, { jobName: ctx.jobName, customerKey, customerName, material, turnaround, thicknessIn: ctx.thicknessIn }, by);
      await OwnerStore.rememberMaterialDefault(customerKey, customerName, ctx.thicknessIn, material);
      close(true);
    } catch (err) {
      showError(`Couldn't save — ${err.message}`);
    } finally {
      els.confirm.disabled = false;
    }
  }

  function close(result) {
    els.overlay.classList.add('hidden');
    const c = ctx; ctx = null;
    if (c) c.resolve(result);
  }

  // One form per job that has no details yet, in sequence (spec §7.1). Cancel = the job was
  // never uploaded: the caller removes its just-saved sheets.
  async function promptForNewJobs(jobNames, sheetsForJob) {
    for (const jobName of jobNames) {
      const jobKey = hooks.noteKey(jobName);
      if (OwnerStore.hasJobDetails(jobKey)) continue;
      const ok = await open('new', jobName, sheetsForJob(jobName));
      if (!ok) await hooks.onCancelJob(jobName);
    }
  }

  function openEdit(jobName, jobSheets) { return open('edit', jobName, jobSheets); }

  return { thicknessFromMaterialInfo, sheetSizeLabel, init, promptForNewJobs, openEdit };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JobDetails;
```

- [ ] **Step 5: Run to verify pass** — `node --test test/job-details-thickness.test.mjs` → 3 passing.

- [ ] **Step 6: app.js — `handleFiles` with the guard and the step**

Replace the whole `handleFiles` function (from `function handleFiles(fileList, isFirstLoad) {` through its closing `}`) with:

```js
function handleFiles(fileList, isFirstLoad) {
  const htmlFiles = Array.from(fileList).filter(f => f.name.match(/\.(html?|htm)$/i));
  if (!htmlFiles.length) {
    showUploadError('Please select HTML files (.html or .htm).');
    return;
  }

  hideUploadError();
  hideSaveBanner();

  if (isFirstLoad) {
    fileListEl.innerHTML = '';
    fileListEl.hidden = false;
    for (const f of htmlFiles) {
      const item = document.createElement('div');
      item.className = 'file-list-item';
      item.innerHTML = `
        <svg class="file-list-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        ${escHtml(f.name)}`;
      fileListEl.appendChild(item);
    }
  }

  let loadedCount = 0;
  const alreadyLoaded  = [];   // on the board already (in-memory match) — unchanged behaviour
  const finishedBefore = [];   // { name, doc } — finished sheets live in Firestore, not in `sheets`
  const newJobNames    = new Set();

  for (const file of htmlFiles) {
    const reader = new FileReader();
    reader.onload = async e => {
      const parsed = parseJobSheet(e.target.result);
      const key    = simpleHash(file.name);
      if (sheets.find(s => s.fileKey === key)) {
        // A sheet with this exact filename is already loaded. Record it so we can tell the
        // operator, instead of silently doing nothing (which reads as "the import is broken").
        alreadyLoaded.push(file.name);
      } else {
        // Re-upload guard (spec §5.2): finished sheets are not in the array any more, so ask
        // Firestore before saving — re-dropping one must never overwrite it.
        const existing = await Storage.getSheetDoc(key);
        if (existing && existing.finished === true) {
          finishedBefore.push({ name: file.name, doc: existing });
        } else {
          const sheet = { fileKey: key, fileName: file.name, ...parsed };
          sheets.push(sheet);
          newJobNames.add(projectKey(sheet));

          const result = await Storage.saveSheet(sheet);
          if (!result.ok) {
            // The sheets listener will drop this sheet from the screen on the
            // next snapshot — say why, so it isn't a silent disappearance.
            const idx = sheets.findIndex(s => s.fileKey === key);
            if (idx !== -1) sheets.splice(idx, 1);
            showSaveBanner(`Couldn't save "${file.name}" — ${result.error?.message || 'unknown error'}. The file was still archived to Drive.`);
          } else if (result.mode === 'oversize') {
            showSaveBanner(`"${file.name}" was saved, but its layout drawing is too large to store. Everything else tracks normally — use the archive link to view the drawing.`);
          }

          // Archive after the save resolves, so setArchiveUrl's update() has a
          // document to attach to.
          Endpoint.archiveSheet(file.name, sheet.jobName || '', e.target.result)
            .then(url => { if (url) Storage.setArchiveUrl(key, url); })
            .catch(err => console.warn('Archive upload failed:', err));
        }
      }
      loadedCount++;
      if (loadedCount === htmlFiles.length) await finishUploadBatch({ isFirstLoad, alreadyLoaded, finishedBefore, newJobNames });
    };
    reader.readAsText(file);
  }
}

async function finishUploadBatch({ isFirstLoad, alreadyLoaded, finishedBefore, newJobNames }) {
  if (sheets.length) {
    if (isFirstLoad) showProjectsScreen(); else renderAllSheets();
  }
  const notices = [];
  if (alreadyLoaded.length) {
    notices.push(alreadyLoaded.length === 1
      ? `"${alreadyLoaded[0]}" is already loaded — it's on the board, so nothing was changed.`
      : `${alreadyLoaded.length} sheets were already loaded, so they were left unchanged.`);
  }
  for (const { name, doc } of finishedBefore) {
    const when = doc.finishedAt ? formatDT(new Date(doc.finishedAt)) : 'an earlier export';
    notices.push(`"${name}" was already cut and finished on ${when} (job ${doc.jobName || 'unknown'}). If this is a new cut, save it from Aspire under a new file name.`);
  }
  if (notices.length) showNotice(notices.join('\n\n'));
  // Owners with the switch on: job details for every NEW job in this drop, one form at a time.
  // Jobs that already have details (adding more sheets) get no step (spec §7.1).
  if (newJobNames.size && Features.on('jobDetails')) {
    await JobDetails.promptForNewJobs([...newJobNames], jobName => sheets.filter(s => projectKey(s) === jobName).sort(compareSheets));
    if (!projectsScreen.hidden) renderProjects();
  }
}
```

In the Owner screens section (Task 9, after `SettingsScreen.init(...)`), add:

```js
JobDetails.init({ noteKey, customerKey, currentEmail: currentUserEmail, onCancelJob: deleteProject });
```

Also make the notice modal keep line breaks: in `css/style.css` add `.notice-modal-card .modal-body-text { white-space: pre-line; }`.

- [ ] **Step 7: PASTE-mode check** (refresh the copy from Task 9 Step 6, then `npx serve . -l 5057`):

```bash
cp "$SRC"/index.html "$DST"/ && cp "$SRC"/js/{app.js,job-details.js}  "$DST"/js/ && cp "$SRC"/css/style.css "$DST"/css/
```

1. **Collin's view** (no stub): drop the sample sheet → board card, **no modal**. Open it → identical to today.
2. **Owner, switch on:** console `Features._setForTests(Features.defaults('t@x'), 't@x'); OwnerStore.loadAll().then(() => { OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); })`. Reload is NOT allowed (state is in memory), so delete the card and drop the sample again → the **Job details** modal: one sheet row `1. Job Layout Sheet … 48×96 × 0.47 in · 5 toolpaths · HH:MM:SS`, summary `1 sheet · N m Aspire time · no repeats found in this job`, Customer select with `+ New customer…`, Material radios (Ours disabled, hint about Phase 2), Turnaround radios, caption. Clicking outside does nothing.
3. Confirm with nothing picked → `Pick a customer.` Pick `+ New customer…`, type `Northlight Studios`, 48-hour rush, **Add job to the board** → modal closes; console `OwnerStore.getJobBilling(noteKey('<jobName>'))` → `{ customerName: 'Northlight Studios', turnaround: 'rush48', material: { kind: 'customer' … }, thicknessIn: 0.47, … }`; `Storage.getProjectCustomer(noteKey('<jobName>'))` → `'Northlight Studios'`; Manage Customers lists Northlight Studios.
4. Drop the same file again → `"… is already loaded …"` notice (unchanged behaviour). Delete the card; stub a finished copy: `Storage.getSheetDoc = async () => ({ finished: true, finishedAt: Date.now(), jobName: 'Old Job' })` → drop → blocking notice *was already cut and finished on …* and **no card appears**. Restore with a reload only after noting the result.
5. Drop two files from different jobs (the sample + any `samples/*.html` with another job name, or a copy of the sample edited so `#jobtitle` differs) → two modals in sequence; **Cancel** the second → its card is gone, the first stays.
6. `Features._setForTests(null, 'c@x'); applyFeatureNav()` → drop a new file → no modal.

- [ ] **Step 8: Suite + commit**

`npm test` all passing.

```bash
git add js/job-details.js test/job-details-thickness.test.mjs index.html css/style.css js/app.js
git commit -m "feat(job-details): owner job-details step at upload (customer, material, turnaround), edit form, finished-sheet re-upload guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Collin's export = finish (no customer question when set, upsert, no delete)

**Files:**
- Modify: `js/app.js` — `exportJob` (~line 1457), the card export button handler (~706), `doExport` (~1521)

**Interfaces:**
- Consumes: `Storage.getProjectCustomer`, `LogRows.build`, `Endpoint.upsertLogRows`, `Auth.getIdToken`, `Storage.finishSheets/finishJob`, `currentUserEmail`.
- Produces: `customerForExport(jobName) → Promise<string|null>`; `exportJob` finishes instead of deleting. Button text stays **Export CSV**; CSV (9 columns, same filename) and ticket print unchanged.
- Behaviour (spec §7.3): customer from `projectCustomer` → no picker; missing → today's picker, answer saved (Review Focus 1). Log failure → existing honest alert, job kept. Finish failure after a successful log → alert, job kept; a re-export upserts the same rows (Review Focus 2). Success → sheets `finished:true` (drawings cleared when archived), `jobs/{jobKey}.finished`, job leaves the board, **no confirm()**.

- [ ] **Step 1: Replace the export entry points**

Card button handler in `buildProjectCard` — replace

```js
    const jobSheets = [...projectSheets].sort(compareSheets);
    const customerName = await openCustomerPicker(jobName);
    if (!customerName) return;
    await exportJob(jobName, jobSheets, customerName);
```

with

```js
    const jobSheets = [...projectSheets].sort(compareSheets);
    const customerName = await customerForExport(jobName);
    if (!customerName) return;
    await exportJob(jobName, jobSheets, customerName);
```

`doExport` — replace `const customerName = await openCustomerPicker(currentProject);` with `const customerName = await customerForExport(currentProject);`.

Add above `exportJob`:

```js
// Set at upload by an owner (job details) or on an earlier export → no question. Missing
// (legacy job, or the jobDetails switch off) → today's picker, exactly as before; its answer
// is saved to projectCustomer by the picker itself.
function customerForExport(jobName) {
  const known = jobName ? Storage.getProjectCustomer(noteKey(jobName)) : null;
  return known ? Promise.resolve(known) : openCustomerPicker(jobName);
}
```

- [ ] **Step 2: Replace everything in `exportJob` from the `// Master Job Log:` comment to the end of the function**

```js
  // Master Job Log: ONE object per sheet, upserted by Sheet Key — exporting the same job twice
  // updates the same rows and can never append a second copy (spec §6.2 / §7.3).
  let logged = false;
  let failReason = ' (endpoint unreachable)';
  try {
    const idToken = Endpoint.enabled() ? await Auth.getIdToken() : null;
    const rows = jobSheets.map(sheet => LogRows.build(sheet, Storage.get(sheet.fileKey, 'sheet'), customerName));
    const result = await Endpoint.upsertLogRows(rows, idToken);
    logged = !!(result && result.ok);
  } catch (err) {
    console.warn('Master Job Log upsert failed:', err);
    if (err && err.endpointError) failReason = `: ${err.message}`;
  }

  if (!logged) {
    alert(`Master Job Log was NOT updated${failReason}. The CSV still downloaded. The job was kept so you can export it again later.`);
    return;
  }

  // Finish, don't delete: every sheet stays in Firestore with finished:true and leaves the
  // board for everyone. Owners find it under "Show finished jobs" (and Billing, Phase 2).
  try {
    const by = currentUserEmail();
    await Storage.finishSheets(jobSheets, by);
    if (jobName) await Storage.finishJob(noteKey(jobName), jobName, by);
  } catch (err) {
    console.warn('Finish after export failed:', err);
    alert(`The Master Job Log was updated, but the job could not be marked finished (${err.message}). It stays on the board — export it again once the connection is back; the log rows will not be duplicated.`);
    return;
  }

  const finishedKeys = new Set(jobSheets.map(s => s.fileKey));
  sheets = sheets.filter(s => !finishedKeys.has(s.fileKey));
  currentProject = null;
  if (sheets.length) showProjectsScreen(); else goToUpload();
}
```

Delete nothing else: `deleteProject` stays for the trash icon on active jobs.

- [ ] **Step 3: PASTE-mode check** (`cp "$SRC"/js/app.js "$DST"/js/`; serve; `window.print = () => {}` in the console first so the ticket print does not block):

1. **Legacy job, Collin's view:** drop the sample (no stub, no details) → card → **Export CSV** → the customer picker opens as today → pick/type `Harbor Lane Pictures` → CSV downloads (9 columns, `CNC Job Exports/Harbor Lane Pictures/<base>.csv`), **no "Delete …?" confirm**, card disappears, board shows `No projects loaded.` or the upload screen. Console `Storage.getProjectCustomer(noteKey('<jobName>'))` → `'Harbor Lane Pictures'`.
2. **Job with details (owner stub from Task 10 step 2 → job details filled):** Export CSV → **no picker**, CSV + no confirm, card gone.
3. **Log failure path:** `Endpoint.upsertLogRows = async () => { const e = new Error('owner only'); e.endpointError = true; throw e; }` → Export → alert `Master Job Log was NOT updated: owner only. The CSV still downloaded. The job was kept…` and the card stays. Then `Endpoint.upsertLogRows = async () => ({ ok: true, updated: 1, appended: 0, claimed: 0 }); Storage.finishSheets = async () => { throw new Error('offline'); }` → Export → alert `… could not be marked finished (offline). It stays on the board …`, card stays.
4. Content screen's **Export CSV** button (inside a job) behaves the same as the card button.
5. **Reset All**, Mark In Progress / Mark Complete / Clear, Add More Sheets, VanLab Stickers, To Print — untouched.

- [ ] **Step 4: Suite + commit**

`npm test` all passing.

```bash
git add js/app.js
git commit -m "feat(export): finish instead of delete — customer from job details when set, one upserted log row per sheet, honest alerts keep the job on the board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Job card owner panel (`js/job-card.js`), board chip, sidebar tags, finished jobs

**Files:**
- Create: `js/job-card.js`
- Modify: `index.html` — `#owner-panel` in the content screen, "Show finished jobs" toggle in the Projects filter row (hidden), script tag
- Modify: `css/style.css` — `.owner-panel`, `.jc-*`, finished-view hiding
- Modify: `js/app.js` — state (~line 32), `getDisplaySheets`/`getProjectGroups` (~491–506), `renderProjects` (~518), `buildProjectCard` (~608), `renderAllSheets`/`buildSheetNavRow` (~760–868), `showContentScreen` (~308), back button (~146), Owner screens section (`applyFeatureNav`, init lines)

**Interfaces:**
- Consumes: `OwnerStore.*`, `Storage.get/unfinishSheets/reopenJob/loadFinishedSheets`, `Pricing.repeatGroups/effectiveCutDate/isWeekendDate/localDate/formatDuration/parseTimeSec`, `JobDetails.openEdit`, `Features.on('jobCard')`, `formatDT`.
- Produces (global `JobCard`):
  - `JobCard.init({ noteKey, currentEmail, openEdit, onChanged, onPutBack })`
  - `JobCard.cardChip(jobName) → HTMLElement` — **Needs job details** (amber) / **Not sent to billing yet** (grey) / **Ready for billing ✓** (green)
  - `JobCard.navRowExtras(sheet, groups) → HTMLElement` — `<status> · <tags…>` for a sidebar row; `groups` from `Pricing.repeatGroups(displaySheets)`
  - `JobCard.sheetStatus(sheet) → 'Not cut yet' | 'Cut' | 'On invoice N (in progress)' | 'Billed · #N'`; `JobCard.sheetTags(sheet, groups) → string[]` (`Weekend`, `Repeat of sheet 2`, `Re-cut Oct 6`, `cut date corrected to Fri Oct 2`)
  - `JobCard.renderOwnerPanel(container, jobName, orderedSheets)` — header (customer, chips, Edit job details, "N of M sheets cut", ready chip), sheet table with cut-date correction and archived-drawing links, Design / CAM hours panel, **No design time on this job**, **Done — ready for billing** / **Edit — not ready yet**, **Put back on the board** for a finished job
- app.js: owners with `jobCard` on get a **Show finished jobs** checkbox on the Projects screen (one-shot `Storage.loadFinishedSheets()`); a finished job opens read-only (export/reset/add/mark/delete controls hidden by CSS) with the owner panel on top. Collin's view: `Features.on('jobCard')` is false, so none of this renders.
- In Phase 1 every sheet is unbilled, so statuses are only "Not cut yet"/"Cut" and the "Re-cut" tag cannot appear; the code paths exist so Phase 2 only has to write `sheetBilling`.

- [ ] **Step 1: Markup + styles**

`index.html`: in the Projects screen `.filter-row`, after the `#project-sort` select:

```html
        <label id="projects-show-finished-wrap" class="print-queue-toggle" hidden>
          <input type="checkbox" id="projects-show-finished"> Show finished jobs
        </label>
```

In the content screen, directly after `#job-note-banner`'s closing `</div>`:

```html
    <div id="owner-panel" class="owner-panel" hidden></div>
```

Script tag after `job-details.js`: `<script src="js/job-card.js?v=1"></script>`.

`css/style.css`, append:

```css
/* ── Job card owner panel (owners only; Collin's screen never renders it) ── */
.owner-panel { margin: 0 20px 12px; padding: 12px 16px; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 12px; font-size: 0.88rem; }
.jc-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.jc-head strong { font-size: 1rem; }
.jc-chip { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; border: 1px solid var(--gray-200); background: var(--gray-100); color: var(--gray-500); white-space: nowrap; }
.jc-chip--needs { background: var(--gold-light); color: var(--gold); border-color: #fde68a; }
.jc-chip--ready { background: var(--green-light); color: var(--green); border-color: #a7e8bf; }
.jc-chip--muted { background: var(--gray-100); color: var(--gray-500); }
.jc-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.jc-table th { text-align: left; font-weight: 600; color: var(--gray-500); padding: 4px 8px; border-bottom: 1px solid var(--gray-200); }
.jc-table td { padding: 5px 8px; border-bottom: 1px solid var(--gray-100); vertical-align: top; }
.jc-table .jc-link { background: none; border: 0; padding: 0; color: var(--cyan); cursor: pointer; font: inherit; text-decoration: underline; }
.jc-tags { color: var(--gray-500); }
.jc-cutdate-edit { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.jc-cutdate-edit .form-input { max-width: 170px; padding: 4px 8px; }
.jc-labor { display: flex; flex-direction: column; gap: 8px; }
.jc-labor-title { font-weight: 700; }
.jc-labor-add { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.jc-labor-add .form-input { padding: 6px 8px; }
.jc-labor-add .jc-hours { max-width: 90px; }
.jc-labor-add .jc-note { flex: 1 1 220px; }
.jc-caption { font-size: 0.78rem; color: var(--gray-500); }
.jc-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.jc-status { font-size: 0.82rem; }
.jc-row-tags { font-size: 0.72rem; color: var(--gray-500); margin-top: 2px; }
.jc-row-tags .jc-row-weekend { color: var(--gold); font-weight: 700; }
/* A finished job is read-only for everyone: it left the board; "Put back on the board" reopens it. */
#content-screen.content-screen--finished #export-btn,
#content-screen.content-screen--finished #reset-btn,
#content-screen.content-screen--finished .add-sheets-row,
#content-screen.content-screen--finished .sheet-complete-footer,
#content-screen.content-screen--finished .nav-row-delete,
#content-screen.content-screen--finished .detail-delete-btn { display: none; }
@media (max-width: 480px) { .owner-panel { margin: 0 12px 10px; padding: 10px; } .jc-table th:nth-child(3), .jc-table td:nth-child(3) { display: none; } }
```

- [ ] **Step 2: Implement `js/job-card.js`**

```js
/**
 * js/job-card.js — the owner panel on the job card (spec §7.2) plus the two small owner
 * decorations elsewhere: the board card's job-level chip and the sidebar row's status/tags.
 * Collin's sheet workspace is untouched: app.js calls nothing here unless
 * Features.on('jobCard'). Plain words, no status key, never a price (spec §5.1).
 */
const JobCard = (() => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let hooks = { noteKey: null, currentEmail: () => '', openEdit: async () => false, onChanged() {}, onPutBack: async () => {} };
  let editingCutDateKey = null;   // fileKey whose cut-date editor is open
  let statusText = '';
  const TURNAROUND = { standard: 'Standard', rush48: '48-hour rush', rush24: '24-hour rush' };

  function init(h) { hooks = { ...hooks, ...h }; }

  function longDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function shortDate(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

  /* ── Job-level state ── */
  function jobState(jobName) {
    const jobKey = hooks.noteKey(jobName);
    if (!OwnerStore.hasJobDetails(jobKey)) return 'needs';
    return OwnerStore.getJobBilling(jobKey).readyForBilling ? 'ready' : 'not-ready';
  }

  function chip(state) {
    const span = document.createElement('span');
    span.className = 'jc-chip ' + { needs: 'jc-chip--needs', ready: 'jc-chip--ready', 'not-ready': 'jc-chip--muted' }[state];
    span.textContent = { needs: 'Needs job details', ready: 'Ready for billing ✓', 'not-ready': 'Not sent to billing yet' }[state];
    return span;
  }

  function cardChip(jobName) { return chip(jobState(jobName)); }

  /* ── Sheet-level words ── */
  function sheetStatus(sheet) {
    const sb = OwnerStore.getSheetBilling(sheet.fileKey);
    if (sb && sb.status === 'billed') return `Billed · #${sb.invoiceNumber}`;
    if (sb && sb.status === 'in-progress') return `On invoice ${sb.invoiceNumber} (in progress)`;
    const rec = Storage.get(sheet.fileKey, 'sheet');
    return rec && rec.status === 'complete' ? 'Cut' : 'Not cut yet';
  }

  function sheetTags(sheet, groups) {
    const tags = [];
    const rec = Storage.get(sheet.fileKey, 'sheet');
    const sb = OwnerStore.getSheetBilling(sheet.fileKey);
    const cutDate = Pricing.effectiveCutDate(rec, sb);
    if (cutDate && Pricing.isWeekendDate(cutDate)) tags.push('Weekend');
    const g = groups && groups[sheet.fileKey];
    if (g && g.repeatOf) tags.push(`Repeat of sheet ${g.repeatOf}`);
    // Billed on one cut time, cut again since (or the record cleared): a re-cut, never charged.
    if (sb && sb.cutAtBilled && (!rec || rec.completedAt !== sb.cutAtBilled)) {
      tags.push(rec && rec.completedAt ? `Re-cut ${shortDate(rec.completedAt)}` : 'Re-cut (record cleared)');
    }
    if (sb && sb.cutDateOverride) tags.push(`cut date corrected to ${longDate(sb.cutDateOverride)}`);
    return tags;
  }

  function navRowExtras(sheet, groups) {
    const div = document.createElement('div');
    div.className = 'jc-row-tags';
    const parts = [esc(sheetStatus(sheet))].concat(sheetTags(sheet, groups).map(t => t === 'Weekend' ? '<span class="jc-row-weekend">Weekend</span>' : esc(t)));
    div.innerHTML = parts.join(' · ');
    return div;
  }

  /* ── The panel ── */
  function renderOwnerPanel(container, jobName, orderedSheets) {
    if (!container.dataset.jcBound) { container.addEventListener('click', onClick); container.addEventListener('change', onChange); container.dataset.jcBound = '1'; }
    const jobKey = hooks.noteKey(jobName);
    const jb = OwnerStore.getJobBilling(jobKey);
    const hasDetails = OwnerStore.hasJobDetails(jobKey);
    const groups = Pricing.repeatGroups(orderedSheets);
    const cut = orderedSheets.filter(s => { const r = Storage.get(s.fileKey, 'sheet'); return r && r.status === 'complete'; }).length;
    const finished = orderedSheets.length > 0 && orderedSheets.every(s => s.finished === true);
    const by = hooks.currentEmail();
    container.dataset.jobName = jobName;

    const chips = [];
    if (jb && jb.turnaround && jb.turnaround !== 'standard') chips.push(TURNAROUND[jb.turnaround] || jb.turnaround);
    if (jb && jb.material) chips.push(jb.material.kind === 'ours' ? (jb.material.name || 'Our material') : 'Customer supplied');

    let html = `<div class="jc-head">
      <strong>${esc(hasDetails ? jb.customerName : 'No customer yet')}</strong>
      ${chips.map(c => `<span class="jc-chip">${esc(c)}</span>`).join('')}
      <button type="button" class="btn btn-outline btn-sm" data-action="edit">${hasDetails ? 'Edit job details' : 'Add job details'}</button>
      <span class="jc-caption">${cut} of ${orderedSheets.length} sheet${orderedSheets.length !== 1 ? 's' : ''} cut</span>
      ${chip(jobState(jobName)).outerHTML}
      ${finished ? '<button type="button" class="btn btn-ghost btn-sm" data-action="putback">Put back on the board</button>' : ''}
    </div>`;

    html += `<table class="jc-table"><thead><tr><th>#</th><th>Sheet</th><th>Aspire time</th><th>Cut</th><th>Status</th><th>Tags</th>${finished ? '<th></th>' : ''}</tr></thead><tbody>`;
    orderedSheets.forEach((s, i) => {
      const rec = Storage.get(s.fileKey, 'sheet');
      const sb = OwnerStore.getSheetBilling(s.fileKey);
      const locked = !!(sb && (sb.status === 'in-progress' || sb.status === 'billed'));
      const cutCell = rec && rec.status === 'complete'
        ? (locked ? esc(formatDT(new Date(rec.completedAt))) : `<button type="button" class="jc-link" data-action="cutdate" data-key="${esc(s.fileKey)}" title="Correct the cut date">${esc(formatDT(new Date(rec.completedAt)))}</button>`) + (rec.operator ? ` · ${esc(rec.operator)}` : '')
        : '—';
      const editor = editingCutDateKey === s.fileKey ? `<div class="jc-cutdate-edit"><input type="date" class="form-input" data-cutdate-input value="${esc((sb && sb.cutDateOverride) || Pricing.effectiveCutDate(rec, null) || '')}">
          <button type="button" class="btn btn-primary btn-sm" data-action="cutdate-save" data-key="${esc(s.fileKey)}">Save</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cutdate-clear" data-key="${esc(s.fileKey)}">Use Collin's time</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cutdate-cancel">Cancel</button></div>` : '';
      html += `<tr><td>${i + 1}</td><td>${esc(s.sheetTitle || s.fileName)}</td><td>${esc(s.totalTime || '—')}</td><td>${cutCell}${editor}</td><td>${esc(sheetStatus(s))}</td><td class="jc-tags">${sheetTags(s, groups).map(esc).join(' · ')}</td>`;
      if (finished) html += `<td>${s.archiveUrl ? `<a href="${esc(s.archiveUrl)}" target="_blank" rel="noopener">Open archived drawing</a>` : ''}</td>`;
      html += '</tr>';
    });
    html += '</tbody></table>';

    if (hasDetails) {
      const types = OwnerStore.laborTypes();
      const lines = Array.isArray(jb.laborLines) ? jb.laborLines : [];
      const anyBilled = lines.some(l => l.status === 'billed' || l.status === 'in-progress');
      const typeName = id => (types.find(t => t.id === id) || { name: id }).name;
      html += `<div class="jc-labor"><div class="jc-labor-title">Design / CAM hours</div>`;
      if (lines.length) {
        html += `<table class="jc-table"><thead><tr><th>Type</th><th>Hours</th><th>What it was for (prints on the invoice)</th><th>Entered</th><th></th></tr></thead><tbody>` +
          lines.map(l => `<tr><td>${esc(typeName(l.typeId))}</td><td>${esc(l.hours)}</td><td>${esc(l.note || '')}</td><td class="jc-caption">${esc(l.enteredBy ? l.enteredBy.split('@')[0] : '')}${l.enteredAt ? ' · ' + esc(formatDT(new Date(l.enteredAt))) : ''}</td>
            <td>${l.status === 'unbilled' ? `<button type="button" class="jc-link" data-action="line-remove" data-line="${esc(l.id)}">Remove</button>` : `<span class="jc-caption">${l.status === 'billed' ? `Billed · #${esc(l.invoiceNumber)}` : `On invoice ${esc(l.invoiceNumber)} (in progress)`}</span>`}</td></tr>`).join('') +
          '</tbody></table>';
      }
      if (!jb.readyForBilling) {
        html += `<div class="jc-labor-add">
          <select class="form-input" data-line-type>${types.map(t => `<option value="${esc(t.id)}">${esc(t.name)} — $${Number(t.rate).toFixed(0)}/hr${t.minHours ? ` (min ${t.minHours} h)` : ''}</option>`).join('')}</select>
          <input type="number" class="form-input jc-hours" data-line-hours min="0" step="0.25" placeholder="Hours">
          <input type="text" class="form-input jc-note" data-line-note placeholder="What it was for (prints on the invoice)">
          <button type="button" class="btn btn-outline btn-sm" data-action="line-add">Add line</button>
        </div>`;
      }
      html += `<label class="jc-caption"><input type="checkbox" data-action="nodesign" ${jb.noDesignTime ? 'checked' : ''} ${jb.readyForBilling ? 'disabled' : ''}> No design time on this job</label>`;
      html += `<div class="jc-actions">`;
      if (jb.readyForBilling) {
        html += `<span class="jc-caption">Marked ready${jb.readyBy ? ' by ' + esc(jb.readyBy.split('@')[0]) : ''}${jb.readyAt ? ' · ' + esc(formatDT(new Date(jb.readyAt))) : ''}.</span>
          <button type="button" class="btn btn-ghost btn-sm" data-action="notready" ${anyBilled ? 'disabled title="Design hours on this job are already on an invoice"' : ''}>Edit — not ready yet</button>`;
      } else {
        html += `<button type="button" class="btn btn-primary btn-sm" data-action="done" ${(lines.length || jb.noDesignTime) ? '' : 'disabled'}>Done — ready for billing</button>
          <span class="jc-caption">Cut sheets can still go on a weekly bill before this. Design hours wait for this button.${jb.turnaround !== 'standard' ? ' Rush applies to these hours too.' : ''}</span>`;
      }
      html += `</div>`;
      if (jb.updatedBy || jb.updatedAt) html += `<div class="jc-caption">Saved by ${esc((jb.updatedBy || '').split('@')[0] || 'owner')}${jb.updatedAt ? ' · ' + esc(formatDT(new Date(jb.updatedAt))) : ''}</div>`;
      html += '</div>';
    } else {
      html += `<div class="jc-caption">Set the customer, material and turnaround so this job can be billed. Collin can still cut and export it meanwhile.</div>`;
    }
    html += `<div class="jc-status${/^Couldn/.test(statusText) ? ' vanlab-status-error' : ''}">${esc(statusText)}</div>`;
    container.innerHTML = html;
  }

  function setStatus(t) { statusText = t || ''; hooks.onChanged(); }

  async function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.tagName !== 'BUTTON') return;
    const container = e.currentTarget;
    const jobName = container.dataset.jobName;
    const jobKey = hooks.noteKey(jobName);
    const jb = OwnerStore.getJobBilling(jobKey);
    const by = hooks.currentEmail();
    const action = btn.dataset.action;
    try {
      if (action === 'edit') {
        const sheetsNow = currentSheetsFor(container);
        await hooks.openEdit(jobName, sheetsNow);
        statusText = '';
        hooks.onChanged();
      } else if (action === 'cutdate') {
        editingCutDateKey = btn.dataset.key; statusText = ''; hooks.onChanged();
      } else if (action === 'cutdate-cancel') {
        editingCutDateKey = null; hooks.onChanged();
      } else if (action === 'cutdate-save' || action === 'cutdate-clear') {
        const input = container.querySelector('[data-cutdate-input]');
        const ymd = action === 'cutdate-clear' ? null : (input && input.value);
        if (action === 'cutdate-save' && !ymd) { setStatus("Couldn't save — pick a date first."); return; }
        await OwnerStore.setCutDateOverride(btn.dataset.key, ymd, { jobKey, customerKey: jb && jb.customerKey }, by);
        editingCutDateKey = null;
        setStatus(ymd ? `Cut date corrected to ${longDate(ymd)}.` : "Using Collin's cut time again.");
      } else if (action === 'line-add') {
        const typeId = container.querySelector('[data-line-type]').value;
        const hours = Number(container.querySelector('[data-line-hours]').value);
        const note = container.querySelector('[data-line-note]').value.trim();
        if (!typeId) { setStatus("Couldn't add — pick a type."); return; }
        if (!(hours > 0)) { setStatus("Couldn't add — hours must be more than 0."); return; }
        await OwnerStore.setJobBilling(jobKey, { laborLines: [...(jb.laborLines || []), OwnerStore.newLaborLine(typeId, hours, note, by)] }, by);
        setStatus(`${hours} h added.`);
      } else if (action === 'line-remove') {
        await OwnerStore.setJobBilling(jobKey, { laborLines: (jb.laborLines || []).filter(l => !(l.id === btn.dataset.line && l.status === 'unbilled')) }, by);
        setStatus('Line removed.');
      } else if (action === 'done') {
        await OwnerStore.setJobBilling(jobKey, { readyForBilling: true, readyAt: Date.now(), readyBy: by }, by);
        setStatus('Ready for billing. Design hours go on the next bill.');
      } else if (action === 'notready') {
        await OwnerStore.setJobBilling(jobKey, { readyForBilling: false, readyAt: null, readyBy: null }, by);
        setStatus('Not ready — edit away.');
      } else if (action === 'putback') {
        const sheetsNow = currentSheetsFor(container);
        if (!confirm(`Put "${jobName}" back on the board for everyone? Its ${sheetsNow.length} sheet${sheetsNow.length !== 1 ? 's' : ''} become active again; billing records are untouched.`)) return;
        await Storage.unfinishSheets(sheetsNow.map(s => s.fileKey));
        await Storage.reopenJob(jobKey);
        statusText = '';
        await hooks.onPutBack(jobName);
      }
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`);
    }
  }

  async function onChange(e) {
    const box = e.target.closest('input[data-action="nodesign"]');
    if (!box) return;
    const container = e.currentTarget;
    const jobKey = hooks.noteKey(container.dataset.jobName);
    try {
      await OwnerStore.setJobBilling(jobKey, { noDesignTime: box.checked }, hooks.currentEmail());
      setStatus(box.checked ? 'No design time on this job.' : '');
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`);
    }
  }

  // app.js re-renders the panel with the current display sheets; keep a handle for actions.
  let sheetsProvider = () => [];
  function currentSheetsFor() { return sheetsProvider(); }
  function setSheetsProvider(fn) { sheetsProvider = fn; }

  return { init, setSheetsProvider, cardChip, sheetStatus, sheetTags, navRowExtras, renderOwnerPanel };
})();
```

- [ ] **Step 3: app.js hooks**

(a) State, after `let currentProject = null;`:

```js
let finishedSheets  = [];     // owners' "Show finished jobs" view (one-shot load, not a listener)
let showFinished    = false;  // the Projects checkbox
let viewingFinished = false;  // the open job came from the finished list
function visibleSheets() { return (showFinished || viewingFinished) ? finishedSheets : sheets; }
```

(b) `getDisplaySheets` and `getProjectGroups`: replace `sheets` with `visibleSheets()` in both (`visibleSheets().filter(...)`, `[...visibleSheets()]`, `for (const sheet of visibleSheets())`). In `renderProjects`, the three `sheets.length` / `sheets.filter` reads for the count and stat tiles become `visibleSheets()`.

(c) `buildProjectCard`: after `hdr.appendChild(hdrText);` add

```js
  if (Features.on('jobCard')) hdrText.appendChild(JobCard.cardChip(jobName));
  if (showFinished) {
    // Finished jobs: history. No delete, no export; open for the owner panel only.
    deleteBtn.hidden = true;
    exportBtn.hidden = true;
    const fin = document.createElement('span');
    fin.className = 'jc-chip';
    const at = projectSheets.map(s => s.finishedAt || 0).reduce((a, b) => Math.max(a, b), 0);
    fin.textContent = at ? `Finished ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Finished';
    hdrText.appendChild(fin);
  }
```

(`deleteBtn` and `exportBtn` are declared later in the function today; move this block to just before `card.addEventListener('click', …)` so both exist.) In the card click handler add `viewingFinished = showFinished;` before `showContentScreen();`.

(d) `#back-to-projects-btn` handler: add `viewingFinished = false;` before `currentProject = null;`.

(e) `showContentScreen`: after `updateJobNoteBanner();` add

```js
  contentScreen.classList.toggle('content-screen--finished', viewingFinished);
  const ownerPanelEl = document.getElementById('owner-panel');
  if (Features.on('jobCard')) {
    ownerPanelEl.hidden = false;
    JobCard.renderOwnerPanel(ownerPanelEl, currentProject, displaySheets);
  } else {
    ownerPanelEl.hidden = true;
    ownerPanelEl.innerHTML = '';
  }
```

(f) `renderAllSheets`: before `sheetNavEl.innerHTML = '';` add `const tagGroups = Features.on('jobCard') ? Pricing.repeatGroups(displaySheets) : null;` and pass it: `buildSheetNavRow(sheet, idx, tagGroups)` (both calls). In `buildSheetNavRow(sheet, idx, tagGroups)`, after `textWrap.appendChild(subEl);` add `if (tagGroups) textWrap.appendChild(JobCard.navRowExtras(sheet, tagGroups));`.

(g) Owner screens section — extend `applyFeatureNav`:

```js
  const finishedWrap = document.getElementById('projects-show-finished-wrap');
  finishedWrap.hidden = !Features.on('jobCard');
  if (!Features.on('jobCard') && showFinished) {
    showFinished = false;
    document.getElementById('projects-show-finished').checked = false;
    if (!projectsScreen.hidden) renderProjects();
  }
```

and add after `JobDetails.init(...)`:

```js
JobCard.init({
  noteKey, currentEmail: currentUserEmail,
  openEdit: (jobName, jobSheets) => JobDetails.openEdit(jobName, jobSheets),
  onChanged: rerenderCurrent,
  onPutBack: async () => {
    finishedSheets = await Storage.loadFinishedSheets();
    viewingFinished = false;
    currentProject = null;
    showProjectsScreen();   // the sheets listener brings the job back onto the board
  },
});
JobCard.setSheetsProvider(() => getDisplaySheets());
document.getElementById('projects-show-finished').addEventListener('change', async e => {
  showFinished = e.target.checked;
  if (showFinished) finishedSheets = await Storage.loadFinishedSheets();
  renderProjects();
});
```

- [ ] **Step 4: PASTE-mode check** (`cp` the changed files into `$DST` as before; serve; owner stub from Task 10 step 2):

1. Board card shows **Needs job details** (amber) before details, **Not sent to billing yet** after; sidebar rows show `Not cut yet` under the time; after Mark Complete → `Cut`. Mark Complete with the date set to a Saturday → row shows `Cut · Weekend` (gold).
2. Open the job: owner panel on top — customer, chips (`48-hour rush`, `Customer supplied`), **Edit job details** (opens the Task 10 form prefilled; change turnaround → chips update), `1 of 1 sheets cut`, chip.
3. Sheet table: click the cut time → date input + Save / Use Collin's time / Cancel. Pick a Saturday → status `Cut date corrected to Sat …`, tags show `Weekend · cut date corrected to Sat …`. "Use Collin's time" clears it.
4. Design / CAM hours: select shows `Design — $150/hr (min 1 h)` and `CAM — $85/hr (min 0.5 h)` (from the seeded settings, not from code); Add line with hours `0` → `Couldn't add — hours must be more than 0.`; `1.5` + note → a row with Remove; **Done — ready for billing** was disabled, now enabled. Untick/tick **No design time** → saved. Done → chip `Ready for billing ✓`, add form gone, **Edit — not ready yet** returns it.
5. Stub finished sheets: `Storage.loadFinishedSheets = async () => [{ ...sheets[0], finished: true, finishedAt: Date.now(), archiveUrl: 'https://example.test/a' }]` → tick **Show finished jobs** → the card shows `Finished <date>`, no trash, no Export; open it → export/reset/add/mark buttons hidden, panel shows **Put back on the board** and **Open archived drawing**; click Put back → confirm → back on the Projects screen with the toggle off.
6. `Features._setForTests(null, 'c@x'); applyFeatureNav(); showProjectsScreen()` → no chip, no toggle; open the job → no panel, rows have no tags: **Collin's screen unchanged**.
7. 320px width: panel stacks, Aspire column hidden, no horizontal scroll.

- [ ] **Step 5: Suite + commit**

`npm test` all passing.

```bash
git add js/job-card.js index.html css/style.css js/app.js
git commit -m "feat(job-card): owner panel — job details chips, sheet statuses and tags, cut-date correction, design/CAM hours, Done — ready for billing, finished jobs view with Put back on the board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Playwright pass — owner vs Collin, in PASTE mode (`tools/browser-check-phase1.mjs`)

**Files:**
- Create: `tools/browser-check-phase1.mjs` (in `tools/`, not `test/` — `node --test` runs every file under `test/`, and this one needs Playwright + a server)

**Interfaces:**
- Consumes: Playwright from `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\node_modules\playwright` (already installed there; `npx --yes playwright install chromium` if the browser is missing), `npx serve`, the tracked sample sheet, `Features._setForTests`, `OwnerStore.loadAll`, `applyFeatureNav`, `rerenderCurrent` (globals in app.js).
- Produces: `PASS:`/`FAIL:` lines and `SUITE: PASS|FAIL`, exit code 1 on any FAIL. Never `waitUntil: 'networkidle'` (Firestore listeners never idle — here there are none, but keep the house rule): `domcontentloaded` + explicit waits.

- [ ] **Step 1: Write the script**

```js
// tools/browser-check-phase1.mjs — spec §12.4 screen checks for Phase 1, against a PASTE-mode
// copy (Firebase AND endpoint disabled), never the real config. Run from the repo root:
//   node tools/browser-check-phase1.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const require = createRequire('C:/Users/Golden Boys/Documents/Agemtic Workflows/HQ/package.json');
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5058;
let failed = false;
const assert = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) failed = true; };

const dst = mkdtempSync(join(tmpdir(), 'cnc-p1-'));
for (const f of ['index.html', 'css', 'js', 'assets', 'package.json']) cpSync(join(ROOT, f), join(dst, f), { recursive: true });
const sample = readdirSync(ROOT).find(f => /^260520_.*\.html$/.test(f));
cpSync(join(ROOT, sample), join(dst, sample));
writeFileSync(join(dst, 'js/firebase-config.js'), "const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };\n");
writeFileSync(join(dst, 'js/endpoint-config.js'), "const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\n");

const server = spawn('npx', ['serve', '.', '-l', String(PORT), '--no-clipboard'], { cwd: dst, shell: true, stdio: 'ignore' });
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() {
    const s = net.connect(PORT, '127.0.0.1');
    s.once('connect', () => { s.end(); resolve(); });
    s.once('error', () => { if (Date.now() - t0 > 20000) reject(new Error('serve did not start')); else setTimeout(poll, 250); });
  })();
});

const browser = await chromium.launch();
async function fresh() {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); d.accept(); });
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#upload-screen:not([hidden])', { timeout: 10000 });
  return page;
}
let dialogs = [];
const upload = async (page) => { await page.setInputFiles('#file-input', join(dst, sample)); await page.waitForSelector('#projects-screen:not([hidden])'); await page.waitForTimeout(300); };
const becomeOwner = (page, extra = {}) => page.evaluate(async (extra) => {
  const s = Features.defaults('t@x'); Object.assign(s, extra);
  Features._setForTests(s, 't@x');
  await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); rerenderCurrent();
}, extra);

try {
  // ── Collin: nothing new ──
  let page = await fresh();
  await upload(page);
  assert(await page.isHidden('#settings-btn'), "Collin: no Settings button");
  assert(await page.isHidden('#projects-show-finished-wrap'), "Collin: no Show finished jobs toggle");
  assert(await page.isHidden('#job-details-overlay') || await page.$eval('#job-details-overlay', el => el.classList.contains('hidden')), 'Collin: upload opens no job-details form');
  assert((await page.$$('.jc-chip')).length === 0, 'Collin: board card has no chip');
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.isHidden('#owner-panel'), 'Collin: no owner panel on the job card');
  assert((await page.$$('.jc-row-tags')).length === 0, 'Collin: sidebar rows carry no tags');
  const headerButtons = await page.$$eval('#content-screen .header-right button', bs => bs.map(b => b.id));
  assert(JSON.stringify(headerButtons) === JSON.stringify(['dark-mode-btn', 'vanlab-print-btn', 'export-btn', 'reset-btn']), 'Collin: job header buttons exactly as today');
  // Legacy export: picker opens, then no delete prompt (Review Focus 1)
  dialogs = [];
  const dl = page.waitForEvent('download');
  await page.click('#export-btn');
  await page.waitForSelector('#customer-picker-overlay:not(.hidden)');
  await page.selectOption('#customer-picker-select', '__other__');
  await page.fill('#customer-picker-other', 'Harbor Lane Pictures');
  await page.click('#customer-picker-confirm');
  const download = await dl;
  assert(/Harbor Lane Pictures/.test(download.suggestedFilename()), 'export: CSV named under the customer folder');
  await page.waitForTimeout(500);
  assert(!dialogs.some(d => d.startsWith('confirm:')), 'export: NO "Delete …?" confirm after a successful log write');
  assert(await page.evaluate(() => sheets.length === 0), 'export: finished sheets left the in-memory board');
  await page.close();

  // ── Owner: job details step, then export with no picker ──
  page = await fresh();
  await page.evaluate(() => { /* nothing uploaded yet */ });
  // Features must be set before the drop; the upload screen is up, so stub now.
  await page.evaluate(async () => { Features._setForTests(Features.defaults('t@x'), 't@x'); await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
  assert(/no repeats found/.test(await page.textContent('#job-details-summary')), 'owner: job-details form shows the repeat summary');
  assert(await page.$eval('#job-details-material-ours', el => el.disabled), 'owner: "Ours" material disabled while settings/materials is empty');
  await page.click('#job-details-confirm');
  assert(/Pick a customer/.test(await page.textContent('#job-details-error')), 'owner: confirm without a customer is refused');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Northlight Studios');
  await page.check('input[name="jd-turnaround"][value="rush48"]');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay.hidden');
  const jb = await page.evaluate(() => OwnerStore.getJobBilling(noteKey(sheets[0].jobName)));
  assert(jb && jb.customerName === 'Northlight Studios' && jb.turnaround === 'rush48' && jb.material.kind === 'customer', 'owner: jobBilling written from the form');
  assert(await page.evaluate(() => Storage.getProjectCustomer(noteKey(sheets[0].jobName)) === 'Northlight Studios'), 'owner: projectCustomer written (Collin\'s export reads it)');
  await page.evaluate(() => { applyFeatureNav(); rerenderCurrent(); });
  assert(await page.isVisible('#settings-btn'), 'owner: Settings button visible');
  assert(/Not sent to billing yet/.test(await page.textContent('.project-card')), 'owner: board chip reads Not sent to billing yet');
  dialogs = [];
  const dl2 = page.waitForEvent('download');
  await page.click('.project-card .btn-primary');   // Export CSV on the card
  await dl2;
  await page.waitForTimeout(300);
  assert(await page.$eval('#customer-picker-overlay', el => el.classList.contains('hidden')), 'owner-tagged job: export asks NO customer question');
  assert(!dialogs.some(d => d.startsWith('confirm:')), 'owner-tagged job: no delete prompt');
  await page.close();

  // ── Re-upload guard (Review Focus 5) ──
  page = await fresh();
  await page.evaluate(() => { Storage.getSheetDoc = async () => ({ finished: true, finishedAt: Date.now(), jobName: 'Old Job' }); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/already cut and finished on .* \(job Old Job\)/.test(await page.textContent('#notice-modal-text')), 'guard: blocking notice names the date and job');
  assert(await page.evaluate(() => sheets.length === 0), 'guard: nothing was saved or shown');
  await page.close();

  // ── Owner panel on the job card (jobCard switch on) ──
  page = await fresh();
  await page.evaluate(async () => { Features._setForTests({ ...Features.defaults('t@x'), jobCard: { on: true, users: ['t@x'] } }, 't@x'); await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#job-details-overlay:not(.hidden)');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Copperline Stage');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay.hidden');
  await page.evaluate(() => { applyFeatureNav(); rerenderCurrent(); });
  assert(await page.isVisible('#projects-show-finished-wrap'), 'owner: Show finished jobs toggle visible');
  await page.click('.project-card');
  await page.waitForSelector('#owner-panel:not([hidden])');
  assert(/Copperline Stage/.test(await page.textContent('#owner-panel')), 'panel: customer shown');
  assert(/Not cut yet/.test(await page.textContent('.sheet-nav-row .jc-row-tags')), 'panel: sidebar row status Not cut yet');
  assert(await page.$eval('#owner-panel [data-action="done"]', b => b.disabled), 'panel: Done disabled with no labor and no "no design time"');
  await page.fill('#owner-panel [data-line-hours]', '1.5');
  await page.fill('#owner-panel [data-line-note]', 'Bridge wall panels');
  await page.click('#owner-panel [data-action="line-add"]');
  await page.waitForTimeout(200);
  assert(/Bridge wall panels/.test(await page.textContent('#owner-panel')), 'panel: labor line added');
  assert(await page.$eval('#owner-panel [data-action="done"]', b => !b.disabled), 'panel: Done enabled after a labor line');
  const typeOptions = await page.$$eval('#owner-panel [data-line-type] option', os => os.map(o => o.textContent));
  assert(typeOptions.some(t => /Design — \$150\/hr \(min 1 h\)/.test(t)) && typeOptions.some(t => /CAM — \$85\/hr \(min 0.5 h\)/.test(t)), 'panel: labor types come from the seeded settings doc');
  await page.click('#owner-panel [data-action="done"]');
  await page.waitForTimeout(200);
  assert(/Ready for billing ✓/.test(await page.textContent('#owner-panel')), 'panel: Done marks the job ready');
  // Phone width: no horizontal overflow
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= 320), 'panel: no horizontal scroll at 320px');
  await page.close();

  // ── Settings screen ──
  page = await fresh();
  await upload(page);
  await becomeOwner(page);
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-screen:not([hidden])');
  assert((await page.$$('#settings-screens-grid input[type=checkbox]')).length === 4, 'settings: four switches for the one owner column');
  await page.uncheck('#settings-screens-grid input[data-screen="settings"]');
  await page.waitForTimeout(200);
  assert(/Settings must stay on/.test(await page.textContent('#settings-status')), 'settings: last owner cannot switch Settings off');
  assert(await page.isChecked('#settings-screens-grid input[data-screen="settings"]'), 'settings: the box re-checks itself');
  await page.click('#settings-migrate-btn');
  await page.waitForTimeout(300);
  assert(/Migration done — 0 of 0/.test(await page.textContent('#settings-status')), 'settings: migration runs (no db → nothing to stamp)');
  await page.close();
} finally {
  await browser.close();
  server.kill();
  rmSync(dst, { recursive: true, force: true });
  console.log(failed ? 'SUITE: FAIL' : 'SUITE: PASS');
  process.exit(failed ? 1 : 0);
}
```

- [ ] **Step 2: Run it**

Run: `node tools/browser-check-phase1.mjs`
Expected: every line `PASS:`, ending `SUITE: PASS`. A `FAIL:` is a defect in Tasks 9–12 (or in this script's selector) — fix the code, not the assertion, unless the assertion is provably wrong about the spec.

- [ ] **Step 3: Commit**

```bash
git add tools/browser-check-phase1.mjs
git commit -m "test(browser): Phase 1 Playwright pass in PASTE mode — Collin unchanged, owner job details, export without picker, re-upload guard, owner panel, settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Docs — the sheet record in `CLAUDE.md`, spec status, vault note

**Files:**
- Modify: `CLAUDE.md` (repo) — file-structure block, Architecture → Storage bullets, Testing safety
- Modify: `docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md` — the `**Status:**` line
- Modify: `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign.md` (vault; no git)

- [ ] **Step 1: `CLAUDE.md` file-structure block** — add these lines (after `js/storage.js`), and change the `js/storage.js` line's collection list to `(sheets/ with finished flag, completions/, projectNotes/, sheetNotes/, customers/, projectCustomer/, jobs/, printQueue/, settings/migrations read)`:

```
├── js/storage-owner.js          — OwnerStore: the OWNER-ONLY collections (jobBilling/, sheetBilling/, customerBilling/, settings/) — initialised only after Features.isOwner(); Collin's rules deny them, his browser never asks
├── js/features.js               — Features: reads settings/features (owner switches per screen); a denied read = operator, every owner screen off; first owner sign-in seeds the doc
├── js/pricing.js                — Pricing: sheet signature / repeat groups / V-bit rule / local cut dates (Phase 1 helpers). Phase 2 adds priceInvoice() — the ONLY place price math may live
├── js/log-rows.js               — LogRows.build(): the 14-column Master Job Log row object shared by export and (Phase 2) billing
├── js/job-details.js            — owner job-details step at upload (customer, material, turnaround) + Edit job details form
├── js/job-card.js               — owner panel on the job card: statuses/tags, cut-date correction, Design/CAM hours, Done — ready for billing, finished jobs + Put back on the board
├── js/settings.js               — Settings screen (owners): screens on/off grid, Customers (billing), Maintenance (finished-flag migration)
├── tools/browser-check-phase1.mjs — Playwright pass in PASTE mode (owner vs Collin); not under test/ because node --test runs everything there
```

and change the `apps-script/logging-endpoint.gs` line to end `… + upsertRows (one log row per sheet keyed by Sheet Key, Phase 1) …`.

- [ ] **Step 2: Replace the Architecture → Storage bullet list** (from `- **Storage** (`js/storage.js`)` through the `fileKey` bullet) with:

```markdown
- **Storage** (`js/storage.js`, operator-reachable) and **OwnerStore** (`js/storage-owner.js`, owners only) — thin wrappers over Firestore with synchronous local caches. Rules: `HQ/firestore.rules` (deployed from the HQ repo; a collection with no match block is denied; a console edit is wiped by the next deploy). Roles are the signed-in email: operators = Travis, Collin (+ Eva); owners = Travis, Eva.

### The sheet record (spec 2026-10-04 §5.1 — this is the one place it is written down)
A "sheet" is one Aspire setup-sheet HTML file. `fileKey = simpleHash(fileName)` is its identity everywhere (Firestore doc ids, the log's Sheet Key column). Its record is spread over documents that share that key:

| Field | Lives in | Meaning | Written by |
|---|---|---|---|
| `fileName`, `sheetTitle`, `jobName`, `toolpaths[]`, `materialInfo[]` | `sheets/{fileKey}` | From the Aspire file (`parseJobSheet`) | upload |
| `totalTime` | `sheets/` | Aspire's estimated cut time `HH:MM:SS` — what the customer is billed on, never wall-clock | upload |
| `layoutSvg` / `layoutSvgGz` / `layoutOversize` | `sheets/` | The drawing; cleared at finish when `archiveUrl` exists | upload; Collin's export |
| `archiveUrl` | `sheets/` | Drive download link to the archived HTML — the drawing of record after finish | upload (Apps Script, async) |
| `uploadedAt` | `sheets/` | Server timestamp | upload |
| `finished`, `finishedAt`, `finishedBy` | `sheets/` | `true` once the job was exported; finished sheets leave the board for everyone and are **never deleted** (rules) | Collin's export |
| `status`, `completedAt`, `operator`, `notes` | `completions/{fileKey}` | 3-state record; `completedAt` is the cut time (weekend detection). Absent = not cut | Collin |
| `text` | `sheetNotes/{fileKey}` | Per-sheet instruction note | anyone |
| `shapes` | `sheetAnnotations/{fileKey}` | Layout markup | anyone |
| `status` (`unbilled` default / `in-progress` / `billed` / `external`), `invoiceNumber`, `poNumber`, `billedAt`, `cutAtBilled`, `cutDateOverride`, `priced`, `jobKey`, `customerKey` | `sheetBilling/{fileKey}` | Billing state (flat fields; no doc = unbilled). Phase 1 writes only `cutDateOverride` | owners |

Job-level, keyed `jobKey = noteKey(jobName) = 'proj_' + simpleHash(jobName)`: `projectNotes/` (note), `projectCustomer/` (customer name — Collin's export routes the log by it), `jobs/` (`finished`, `exportCount`, …), `jobBilling/` (owners: customer, material, turnaround, laborLines[], noDesignTime, readyForBilling). Shared: `customers/{customerKey(name)}` (directory), `customerBilling/` (owners: `billedOutsideApp`, remembered material defaults), `settings/*` (owners; `settings/migrations` is readable by operators because the board query needs its flag), `ticketHistory/`, `printQueue/`, `invoices/` (Phase 2).

**Board query:** `Storage.onSheetsChange`/`loadSheets` read `where('finished','==',false)` once `settings/migrations.sheetsFinishedFlag.done` is true (Settings › Maintenance), the whole collection before; finished docs are also dropped client-side. No `orderBy` — sorted client-side by `uploadedAt` (a query orderBy drops docs missing the field, and where+orderBy on different fields needs a composite index).
```

- [ ] **Step 3: Testing safety** — after the PASTE-mode steps add:

```markdown
5. Owner screens in a PASTE copy: there is no sign-in, so `Features` never loads. In the console run `Features._setForTests(Features.defaults('t@x'), 't@x'); OwnerStore.loadAll().then(() => { OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); rerenderCurrent(); })` (add `jobCard: { on: true, users: ['t@x'] }` to the state for the job-card panel). `node tools/browser-check-phase1.mjs` does all of this headlessly.
```

- [ ] **Step 4: Spec status line** — replace `**Status:** Draft for Travis's review.` with `**Status:** Approved by Travis 2026-10-04 (§15 answers). Phase 1 implemented <date> on branch customer-billing-phase-1 (plan: ../plans/2026-10-04-customer-billing-phase-1.md); Phase 2 not started.` (keep the rest of the line).

- [ ] **Step 5: Vault note** `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign.md` — under **Current Focus** add one entry (today's date): Phase 1 built on branch `customer-billing-phase-1` in a worktree, NOT merged; the rollout order (Rules → Apps Script → Trio → merge/push → migration → details → shop refresh → Eva) with H-numbers; what still needs Travis (Eva's email; the paste block in Downloads; the go). Tick `Phase 1 build plan` in Next Actions and add `- [ ] Phase 1 rollout H1–H9 (see plan § Rollout checklist)`.

- [ ] **Step 6: Commit (repo files only; the vault has no git)**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md
git commit -m "docs: sheet record + collections in CLAUDE.md, PASTE-mode owner stub, spec status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Whole-branch review (Fable), fixes, hand-off — no merge

- [ ] **Step 1: Verify before claiming** — from the worktree: `npm test` (expected: 173 + 8 + 6 + 4 + 9 + 7 + 7 + 8 + 3 = **225** passing; the exact count is whatever the suite reports — read it, don't assume), `node tools/browser-check-phase1.mjs` → `SUITE: PASS`, HQ emulator run (Task 1 Step 5) → both `SUITE: PASS`, `git log --oneline master..customer-billing-phase-1` shows one commit per task, `git status` clean in both repos.

- [ ] **Step 2: Dispatch the whole-branch review on Fable** (`Agent`, `model: "fable"`; say so to Travis — tokens-low rule: ask before dispatching if he has said tokens are tight). Give it: the spec path, this plan's path, `git diff master...customer-billing-phase-1` for CNC_WebApp and `git diff master...jt-billing-phase-1` for HQ, and these questions in particular: (1) can any path render owner UI for an account whose `settings/features` read was denied; (2) does any code path still delete a sheet after export, or delete a `jobs/`/`sheetBilling` doc; (3) `where` + `orderBy` anywhere on `sheets`; (4) Apps Script `mergeLogRow` with a `Date` in F and with U+202F; (5) the rules' `.get('finished', false)` on legacy docs and `sheetBillingLocked` cost (one `get` per delete only); (6) every `index.html` `?v=` bumped; (7) real emails, uids or ids anywhere in CNC_WebApp (grep for `@gmail`, `uid`, `AIza` and the Master Job Log spreadsheet id) — none may appear outside `js/firebase-config.js` / `js/endpoint-config.js`.

- [ ] **Step 3: Apply findings** per `superpowers:receiving-code-review` (verify each finding before changing code), re-run Step 1, one `fix: review findings — …` commit, re-review the fix commit if any finding was Important or worse.

- [ ] **Step 4: Hand-off to Travis (controller, in-session; short, spoken-English 🔊 line if voice is on):** the branch is ready and NOT merged; what he does first (H2 rules deploy from HQ, H3 Apps Script paste — the file is in Downloads), then his go for H5 (merge + push via the go-live skill). Eva's email is still the one open item and blocks only H1/H9. Do not push.

---

## Rollout checklist (spec §11.1; each line is a Travis "go")

**H1 — Eva's Firebase account (BLOCKED: her sign-in email).** Firebase console → project `cnc-job-tracker` → Authentication → Users → **Add user** → her email + a temporary password → Add. Click her row → copy **User UID** (needed by H3/H9). Self-signup stays disabled. (If "Add user" silently does nothing, the email already exists — use the row's password-reset instead, as on 2026-08-03.)

**H2 — Rules deploy (HQ repo).** Merge `jt-billing-phase-1` into HQ `master` (after Task 15 Step 2's review). Then, from `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ`:
```bash
npx firebase login:list          # must show Travis's personal Google account (the one in the rules file); if the active login is the VanLab account: npx firebase login:add <travis-account-email>, then add --account <travis-account-email> to the deploy
npx firebase deploy --only firestore:rules --project hq
```
Verify the **deployed** text, not the file: Firebase console → Firestore → Rules → confirm these 15 match blocks exist: `sheets completions projectNotes sheetNotes ticketHistory customers projectCustomer sheetAnnotations printQueue jobs jobBilling customerBilling sheetBilling settings invoices` (plus `users dashboard taskIntents entity_*`). Then: shop-floor tracker on a phone, Collin's account → sheets load, customer dropdown lists names. Rollback = Rules tab → "Rules history" (left list) → previous ruleset → Publish.

**H3 — Apps Script.** Open script.google.com → "CNC Tracker Endpoint" → follow the six numbered instructions at the top of `Downloads\CNC Tracker Endpoint - Phase 1 paste block.gs` (merge, never replace; `OWNER_UIDS` gets Travis's uid now, Eva's at H9; **Manage deployments → ✎ → Version: New version**). Verify with the two console `fetch` calls in that file: `upsertRows` → `missing idToken`; `appendRows` → `no rows`.

**H3a — Scratch run against a COPY of the Master Job Log (recommended, spec §12.3).** Travis: Drive → right-click the Master Job Log → Make a copy. Apps Script → New project → paste the FULL live script (the one he just saved) → set `LOG_SPREADSHEET_ID` to the copy's id, `OWNER_UIDS` as above → Deploy → New deployment → Web app (Execute as Me, Anyone) → copy its `/exec` URL. In a signed-in Job Tracker tab's console (F12), with `U` = that URL and `T` = the live token (`ENDPOINT_CONFIG.token`):
```js
const tok = await firebase.auth().currentUser.getIdToken();
const call = (rows) => fetch(U, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ token: T, action:'upsertRows', idToken: tok, rows }) }).then(r => r.json());
const r = { key:'test_fk_1', sheet:'Job Layout Sheet 2', job:'NL_Bridge_Wall_Panels', totalTime:'00:18:00', toolpathCount:2, hasVbit:'N', completedTime:'Oct 1, 2026, 9:12 AM', operator:'Collin', notes:'', archiveLink:'', customer:'Northlight Studios' };
await call([r]);                                        // → appended:1 ; the copy gets a "Northlight Studios" tab with 14 headers
await call([r]);                                        // → updated:1 ; still one row
await call([{ ...r, invoice:'9999', billed:'Y' }]);     // Travis's uid → ok, K/N filled ; from Collin's account → {ok:false, error:'owner only'}
await call([{ ...r, completedTime:'Oct 6, 2026, 2:00 PM' }]);   // → F unchanged, H gets "Re-cut Oct 6, 2026, 2:00 PM"
```
Also: a legacy tab in the copy (e.g. the copied `Orville - Season 4`) → send a row whose `job`+`sheet` match an existing row with blank M → `claimed:1`, M filled, K1–N1 headers filled, K/L values untouched. Open the copied Orville mirror formula (if copied) — still returns A:L. Delete the scratch project and the copy afterwards.

**H4 — Trio consolidation.** Master Job Log: open `Trio Flat Mount` → select its data rows (not the header) → cut → open `Trio Flatmount` → click the first empty row in column A → paste → check the counts add up → right-click the `Trio Flat Mount` tab → Delete (it must be empty). Job Tracker → Manage Customers → if the entry reads `Trio Flat Mount`, Rename it to `Trio Flatmount`. Nothing else; the next export routes by itself.

**H5 — Merge + go-live.** Travis's go → merge `customer-billing-phase-1` into `master` (fast-forward or merge commit, from the main checkout), push via the **go-live** skill → Pages build `built` → `curl -s https://huffman44-ctrl.github.io/CNC-Job-Tracker/ | grep -o 'app.js?v=[0-9]*'` → `app.js?v=35`. Remove the worktree (`git worktree remove .worktrees/customer-billing-phase-1`), delete the branch. **Then immediately: the shop PC and every open tracker tab Ctrl+Shift+R** (until it has, that tab still runs the old client: `appendRows`, delete-on-export). **Don't export a job from any tab until the shop PC has been refreshed.**

**H6 — First owner sign-in + migration.** Travis: Ctrl+Shift+R the tracker → sign in → the first read creates `settings/features` (settings + jobDetails on for him) and seeds `settings/laborTypes`/`materials` → **Settings** button appears → Settings → Maintenance → **Run** → confirm → status `Migration done — N of N sheets…`. Reload: the board shows the same jobs as before (now through the filtered query). If anyone uploaded from an un-refreshed tab after the migration, run it again (it's safe to repeat).

**H7 — Details for jobs already on the board.** Settings → Screens → tick **Job card owner panel** for his column → Projects: every card reads **Needs job details** → open each → **Add job details** → customer / material / turnaround → save. Customers card: tick **Billed outside this app** for VanLab and Golden Boys (in-house).

**H8 — Collin's first export.** (The shop PC was already hard-refreshed at the end of H5.) Collin's next job: Mark Complete as he cuts → **Export CSV** → no customer question (details set), CSV downloads, ticket prints, **no "Delete …?" prompt**, job leaves the board. Travis: Master Job Log → that customer's tab (refresh the sheet tab first — a stale tab looks like a failed export) → rows present **once**, column M filled, K/L untouched, N blank; `Orville - Season 4` mirror still shows A–G as before. Settings → Show finished jobs → the job is there with **Finished <date>**.

**H9 — Eva (after H1).** HQ `firestore.rules`: add her address to `jtOperatorEmails()` **and** `jtOwnerEmails()` → run the Task 1 emulator command (the Eva block now runs) → commit → deploy as H2. Apps Script: add her uid to `ALLOWED_UIDS` and `OWNER_UIDS` → New version. Job Tracker → Settings → Screens → type her email → Add column → tick Job details, Job card (and Settings if she should reach it) → she signs in on her device, opens a job card, sees the owner panel. Rules verify: her account loads the customer list and the print queue.

**Rollback at any point:** switches off (Settings, or edit `settings/features` in the console) → owners see the old app; rules → previous ruleset from Rules history; Apps Script → Manage deployments → ✎ → previous version; code → revert the merge commit and push. Finished sheets stay finished (they are also in the log); nothing is lost.

## Verification list (after H8)

- [ ] Master Job Log, the exported customer's tab: each sheet appears **once**; **Sheet Key** (M) filled on every new row; **Billed** (N) blank; **Invoice #** (K) and **PO #** (L) exactly as they were on older rows; no column inserted, no tab renamed, header K1–N1 reads `Invoice #, PO #, Sheet Key, Billed`.
- [ ] `Orville - Season 4` tab: K/L values untouched; the shared mirror (`Orville — Job Log (Shared)`) shows the same seven columns, still Commenter-only.
- [ ] Collin's screens: Projects header buttons unchanged (To Print, Ticket History, Manage Customers, + Upload Job); job header unchanged (VanLab Stickers, Export CSV, Reset All); no chips, no tags, no panel; Mark In Progress / Mark Complete / Clear / Add More Sheets / trash icon on an active job all work; export shows the picker only for a job with no customer.
- [ ] Collin's account denied on every billing collection: Firebase console → Firestore → Rules → **Rules playground** → Get `/jobBilling/x`, `/sheetBilling/x`, `/customerBilling/x`, `/settings/features`, `/invoices/3612` with Authentication on, provider Google/Password, email = Collin's → all **Denied**; `/settings/migrations` → Allowed; Delete `/sheets/<a finished fileKey>` → Denied.
- [ ] Owner view: board chips present; job card panel renders; Settings reachable; Show finished jobs lists the exported job; Put back on the board returns it (then export again to re-finish — the log rows update, no duplicates).
- [ ] Firestore `sheets` collection: the exported sheets have `finished: true`, `finishedBy` = Collin's email, `layoutSvg`/`layoutSvgGz` empty where `archiveUrl` exists; `jobs/{jobKey}` has `finished: true`, `exportCount: 1`.
- [ ] Repo: no real email, uid, token or spreadsheet id anywhere except the two config files — `grep -rn "gmail|AIza" --include=*.js --include=*.md --include=*.html . | grep -v config.js` returns nothing, and a grep for the Master Job Log spreadsheet id (take it from the live Apps Script, never from this plan) returns nothing.

## Self-review (done while writing; left here so the executor can see what was checked)

**Spec coverage, Phase 1 (§11.1):** §5 collections + rules (all 15 Job Tracker blocks, Eva placeholder, delete guards, `settings/migrations` operator-read deviation) → T1. §5.2 `finished` flag, filtered listener after migration, drawings cleared at finish, re-upload guard, Put back on the board → T6, T10, T11, T12. §5.3 `jobs/` → T6/T10/T11. §5.4 `jobBilling` + labor lines + `readyForBilling` → T7/T12. §5.5 `sheetBilling` (Phase 1: `cutDateOverride` only, flat) → T7/T12. §5.7 `customerBilling` billed-outside + material defaults → T7/T9/T10. §5.8 `settings/features`, `settings/migrations`, labor-type seed → T8/T6/T7. §6 upsertRows, 14 columns, header fill, claim, F/H freeze, owner-only K/L/N, token verified → T5; row builder → T3; client → T4. §7.1 upload step (sequence per new job, pre-fill, cancel = remove, switch off = today's upload) → T10. §7.2 owner panel (chips, Edit, progress, ready chip, statuses/tags, cut-date correction, labor panel, Done/Edit-not-ready, archived drawing, Put back) → T12. §7.3 export (no picker when set, CSV/ticket unchanged, upsert, honest alert, finish, no delete, idempotent re-export) → T11. §7.7 Settings shell: switches grid, Customers (billing), Maintenance → T9. §7.8 switch behaviour incl. first-sign-in defaults and "never for Collin" → T8/T9. §10 → T3. §12.2 rules matrix → T1. §12.3 log-copy tests → T5 unit tests + H3a. §12.4 Playwright → T13. §14 CLAUDE.md sheet record → T14. §15: no backfill (nothing added), rates/minHours seed (T7), Trio (H4), Collin keeps Export CSV (T11), Eva open (H1/H9 + placeholders), seed 3603 / due-date picks / material taxable → Phase 2 (not planned here; `materials.items[].taxable` named in T7's shape so Phase 2 has the field).

**Deliberate departures from the spec text (each named where it happens):** `isJtOwner/isJtOperator` names (HQ already has `isOwner`) — T1; `settings/migrations` readable by operators — T1/T6; `sheetBilling` flat fields — T1/T7; `settings/laborTypes` seeded in Phase 1 as `{types:[…]}` and `materials` as `{items:[]}` (Firestore docs are maps; the job card needs the types now) — T7; `js/job-details.js` + `js/job-card.js` instead of one file — file map; `js/pricing.js` ships helpers only — T2; owners get a **Show finished jobs** toggle (needed to reach Put back on the board) — T12; thickness from VCarve's `Material Block` Z — T10; rules/Apps Script ship with Travis-only owner lists and Eva is a hand step — T1/H9; `invoices` rules: a second `set` on an existing id is an update, so immutability of `number` + `status == 'in-progress'` on create is what rules enforce; the transaction in Phase 2 is the real reuse guard — T1; `finishedAt` etc. are ms numbers — T6.

**Placeholder scan:** none (`<travis-account-email>`/`<collin-account-email>` and `PASTE_…` are deliberate: the literals must never be typed into this public repo).

**Type consistency:** `Storage.finishSheets(sheetList, by)` (T6) ← `exportJob` (T11) passes `jobSheets`; `Storage.getSheetDoc` (T6) ← `handleFiles` (T10) and the Playwright stub (T13); `OwnerStore.setJobBilling(jobKey, patch, by)` (T7) ← T10/T12; `OwnerStore.setCutDateOverride(fileKey, ymd, refs, by)` ← T12; `OwnerStore.laborTypes()` ← T12 select; `Features.on(key)` / `Features._setForTests(state, email)` / `Features.getState()` (T8) ← T9/T10/T12/T13; `JobDetails.openEdit(jobName, jobSheets)` (T10) ← `JobCard.init.openEdit` (T12); `JobCard.navRowExtras(sheet, groups)` with `groups = Pricing.repeatGroups(displaySheets)` (T2) ← `buildSheetNavRow` (T12); `LogRows.build(sheet, completion, customerName)` (T3) ← T11; `Endpoint.upsertLogRows(rows, idToken)` (T4) ← T11; Apps Script payload keys (`key, sheet, job, totalTime, toolpathCount, hasVbit, completedTime, operator, notes, archiveLink, customer, invoice, po, billed`) match `LogRows.build`'s output exactly (T3 ↔ T5).

**Review Focus → tests:** 1 → T13 "Legacy export: picker opens, then no delete prompt"; 2 → T5 "same key again → updated" + T11 step 3; 3 → T5 "Sheets auto-converted F to a Date"; 4 → T1 "delete a legacy sheet with no finished field ALLOWED" + T6 `filterActive`; 5 → T13 "Re-upload guard".
