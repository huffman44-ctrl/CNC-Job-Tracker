# Per-Customer Master Job Log Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each export's Master Job Log rows into the spreadsheet tab matching the job's Customer (find-or-create), and make the web app's export-failure alert report the endpoint's real error.

**Architecture:** All routing lives in the Apps Script endpoint (`apps-script/logging-endpoint.gs`) — the client already sends Customer as the 10th column of every row and needs no routing change. The `.gs` file is plain JS, so its pure logic is unit-tested in Node by evaluating the file in a `node:vm` context with a fake `SpreadsheetApp`. A small client change flags endpoint-supplied errors so `exportJob`'s alert can show the real reason.

**Tech Stack:** Google Apps Script (hand-pasted to the live "CNC Tracker Endpoint" project — the repo file is a placeholder-constants template), vanilla JS (no build step), `node --test` with `.mjs` test files in `test/`.

**Spec:** `docs/superpowers/specs/2026-08-04-per-customer-log-routing-design.md`

## Global Constraints

- **Never test against production.** The committed Firebase config and `js/endpoint-config.js` point at the real database and live endpoint. Automated tests must be pure Node (vm + fakes); end-to-end testing uses a scratch spreadsheet + scratch Apps Script deployment only.
- `apps-script/logging-endpoint.gs` stays a single self-contained file with `PASTE_*` placeholder constants — it is deployed by hand-pasting into script.google.com. Never commit real IDs/tokens into it.
- Any edit to a `js/*.js` file loaded by `index.html` MUST bump that file's `?v=N` cache-buster in `index.html` (`js/endpoint.js` is currently `?v=1`, `js/app.js` is `?v=20`). Omitting this was a Critical finding on a prior feature.
- No frameworks, no build step — match the existing plain-JS style (the `.gs` file uses `function`-keyword declarations; keep that).
- Header row for created tabs is exactly: `Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed Time, Operator, Final Notes, Archive Link, Customer`.
- Fallback tab name for customer-less rows is exactly `Unassigned`.
- Anonymize customer names in fixtures — use made-up names, never real client PII beyond the tab names that already exist in the spec.

## File Structure

- `apps-script/logging-endpoint.gs` — modify: delete `LOG_SHEET_NAME`, add `LOG_HEADER`/`UNASSIGNED_TAB` consts and `groupRowsByCustomer` / `findOrCreateCustomerTab` / `sanitizeTabName` helpers, rewrite `appendRows`. `appendRowsLocked`, `archiveSheet`, `doPost`, `jsonOut` unchanged.
- `test/logging-endpoint.test.mjs` — create: vm harness (fake SpreadsheetApp/sheets) + routing tests.
- `js/endpoint.js` — modify: mark endpoint-supplied errors with `err.endpointError = true`.
- `test/endpoint-error.test.mjs` — create: vm test for the flag.
- `js/app.js` — modify (`exportJob`, ~lines 1495–1507): alert shows the endpoint's real reason.
- `index.html` — modify: bump `js/endpoint.js?v=1` → `?v=2` and `js/app.js?v=20` → `?v=21`.

---

### Task 1: Routing logic in the Apps Script endpoint

**Files:**
- Modify: `apps-script/logging-endpoint.gs`
- Test: `test/logging-endpoint.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `appendRows(body)` keeps its exact signature and reply shapes: `{ok:true, appended:<number>}` on success; `{ok:false, error:<string>}` on validation failure. New helpers (same file): `groupRowsByCustomer(rows) -> {customerName: rows[]}`, `findOrCreateCustomerTab(ss, customer) -> Sheet`, `sanitizeTabName(name) -> string`. Task 3's scratch drill exercises these live.

- [ ] **Step 1: Write the failing tests**

Create `test/logging-endpoint.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
  'utf8'
);

const HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer'];

function fakeSheet(name, rows = []) {
  return {
    _name: name,
    rows,
    frozen: 0,
    getName() { return this._name; },
    getLastRow() { return this.rows.length; },
    getRange(row, col, numRows, numCols) {
      const sheet = this;
      return {
        setValues(values) {
          assert.equal(values.length, numRows);
          for (const v of values) assert.equal(v.length, numCols);
          values.forEach((v, i) => { sheet.rows[row - 1 + i] = v.slice(); });
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
      if (this.sheets.some(s => s.getName() === name)) {
        throw new Error(`A sheet named "${name}" already exists`);
      }
      const s = fakeSheet(name);
      this.sheets.splice(index, 0, s);
      return s;
    },
  };
}

// Evaluate the .gs file in a sandbox. Top-level `function` declarations
// attach to the context object, so the helpers are reachable afterwards.
function loadEndpoint(ss) {
  const sandbox = {
    SpreadsheetApp: { openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    DriveApp: {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

function row(customer, sheetName = 'Job Layout Sheet 2') {
  return [sheetName, 'SomeJob', '0:10:00', '2', 'N',
    'Aug 4, 2026, 9:00 AM', 'Collin', '', '', customer];
}

test('routes rows to an existing tab, matching case-insensitively with stray whitespace', () => {
  const vanlab = fakeSheet('VanLab', [HEADER.slice()]);
  const ss = fakeSpreadsheet([fakeSheet('Trio Flatmount', [HEADER.slice()]), vanlab]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('  vanlab ')] });
  assert.deepEqual(out, { ok: true, appended: 1 });
  assert.equal(vanlab.rows.length, 2);
  assert.equal(vanlab.rows[1][9], '  vanlab ');   // row data untouched, only routing normalizes
  assert.equal(ss.sheets.length, 2);              // no new tab
});

test('auto-creates a missing customer tab at the end, with header and frozen row', () => {
  const ss = fakeSpreadsheet([fakeSheet('VanLab', [HEADER.slice()])]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('Acme Sets')] });
  assert.deepEqual(out, { ok: true, appended: 1 });
  assert.equal(ss.sheets.length, 2);
  const created = ss.sheets[1];                   // inserted at the end
  assert.equal(created.getName(), 'Acme Sets');
  assert.deepEqual(created.rows[0], HEADER);
  assert.equal(created.frozen, 1);
  assert.equal(created.rows[1][0], 'Job Layout Sheet 2');
});

test('splits a mixed batch across tabs and sums appended', () => {
  const vanlab = fakeSheet('VanLab', [HEADER.slice()]);
  const ss = fakeSpreadsheet([vanlab]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('VanLab'), row('Acme Sets'), row('VanLab')] });
  assert.deepEqual(out, { ok: true, appended: 3 });
  assert.equal(vanlab.rows.length, 3);
  assert.equal(ss.sheets[1].getName(), 'Acme Sets');
  assert.equal(ss.sheets[1].rows.length, 2);      // header + 1
});

test('9-column legacy rows and empty-customer rows land in Unassigned, padded to 10 columns', () => {
  const ss = fakeSpreadsheet([fakeSheet('VanLab', [HEADER.slice()])]);
  const g = loadEndpoint(ss);
  const legacy = row('x').slice(0, 9);            // 9 columns, no Customer
  const blank = row('   ');                       // 10 columns, blank Customer
  const out = g.appendRows({ rows: [legacy, blank] });
  assert.deepEqual(out, { ok: true, appended: 2 });
  const unassigned = ss.sheets.find(s => s.getName() === 'Unassigned');
  assert.ok(unassigned, 'Unassigned tab created');
  assert.equal(unassigned.rows.length, 3);        // header + 2 (rectangular — no setValues throw)
  assert.equal(unassigned.rows[1].length, 10);
  assert.equal(unassigned.rows[1][9], '');
});

test('sanitizes forbidden tab characters on create, but only for the tab name', () => {
  const ss = fakeSpreadsheet([]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('A/B \\ Sets? *[1]')] });
  assert.deepEqual(out, { ok: true, appended: 1 });
  assert.equal(ss.sheets[0].getName(), 'A-B - Sets- --1-');     // each of / \ ? * [ ] became -
  assert.equal(ss.sheets[0].rows[1][9], 'A/B \\ Sets? *[1]');   // data keeps the true name
});

test('a customer whose sanitized name matches an existing tab reuses it (no duplicate-name crash)', () => {
  const dashed = fakeSheet('A-B Sets', [HEADER.slice()]);
  const ss = fakeSpreadsheet([dashed]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('A/B Sets')] });
  assert.deepEqual(out, { ok: true, appended: 1 });
  assert.equal(ss.sheets.length, 1);
  assert.equal(dashed.rows.length, 2);
});

test('sanitizeTabName replaces a leading apostrophe and truncates to 100 chars', () => {
  const g = loadEndpoint(fakeSpreadsheet([]));
  assert.equal(g.sanitizeTabName("'Quoted"), '-Quoted');
  assert.equal(g.sanitizeTabName('x'.repeat(150)).length, 100);
  assert.equal(g.sanitizeTabName('  '), 'Unassigned');
});

test('validation errors are unchanged', () => {
  const g = loadEndpoint(fakeSpreadsheet([]));
  assert.deepEqual(g.appendRows({ rows: [] }), { ok: false, error: 'no rows' });
  assert.deepEqual(g.appendRows({}), { ok: false, error: 'no rows' });
  assert.deepEqual(
    g.appendRows({ rows: [['only', 'eight', 'c', 'o', 'l', 'u', 'm', 'n']] }),
    { ok: false, error: 'rows must be 9 or 10 columns' }
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/logging-endpoint.test.mjs`
Expected: FAIL — existing `appendRows` calls `SpreadsheetApp.openById(...).getSheetByName(LOG_SHEET_NAME)`; the fake spreadsheet has no `getSheetByName`, and `sanitizeTabName` is not defined.

- [ ] **Step 3: Implement routing in `apps-script/logging-endpoint.gs`**

Replace the constants block (delete `LOG_SHEET_NAME`, add the two new consts) — the file header comment's "fill the four constants" becomes "fill the three constants":

```js
const TOKEN              = 'PASTE_TOKEN';
const ARCHIVE_FOLDER_ID  = 'PASTE_ARCHIVE_FOLDER_ID';
const LOG_SPREADSHEET_ID = 'PASTE_LOG_SPREADSHEET_ID';

// Rows route to the tab named after each row's Customer (10th column),
// created on first use. Rows with no customer land in UNASSIGNED_TAB.
const LOG_HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer'];
const UNASSIGNED_TAB = 'Unassigned';
```

Replace the whole `appendRows` function (keep `appendRowsLocked` exactly as-is — the lock still wraps everything) and add the three helpers below it:

```js
function appendRows(body) {
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'no rows' };
  }
  if (!rows.every(function (r) { return Array.isArray(r) && (r.length === 9 || r.length === 10); })) {
    return { ok: false, error: 'rows must be 9 or 10 columns' };
  }
  // Pad legacy 9-column rows (pre-Customer clients) to 10 so every group is
  // rectangular for setValues; the Customer cell just stays blank.
  const padded = rows.map(function (r) { return r.length === 9 ? r.concat(['']) : r; });
  const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  const groups = groupRowsByCustomer(padded);
  let appended = 0;
  Object.keys(groups).forEach(function (customer) {
    const sheet = findOrCreateCustomerTab(ss, customer);
    const values = groups[customer].map(function (r) { return r.map(String); });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
    appended += values.length;
  });
  return { ok: true, appended: appended };
}

function groupRowsByCustomer(rows) {
  const groups = {};
  rows.forEach(function (r) {
    const customer = String(r[9] == null ? '' : r[9]).trim() || UNASSIGNED_TAB;
    (groups[customer] || (groups[customer] = [])).push(r);
  });
  return groups;
}

function findOrCreateCustomerTab(ss, customer) {
  // Match on the sanitized name: tabs only ever exist under sanitized names,
  // so this also lets "A/B Sets" find a previously created "A-B Sets" tab.
  const wanted = sanitizeTabName(customer);
  const target = wanted.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === target) return sheets[i];
  }
  const sheet = ss.insertSheet(wanted, ss.getSheets().length);
  sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]);
  sheet.setFrozenRows(1);
  return sheet;
}

function sanitizeTabName(name) {
  // Sheets forbids / \ ? * [ ] in tab names and a leading apostrophe; caps at 100 chars.
  const cleaned = String(name)
    .replace(/[\/\\?*\[\]]/g, '-')
    .replace(/^'/, '-')
    .trim();
  return (cleaned || UNASSIGNED_TAB).slice(0, 100);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/logging-endpoint.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `node --test`
Expected: all tests pass (38 pre-existing + the new file).

- [ ] **Step 6: Commit**

```bash
git add apps-script/logging-endpoint.gs test/logging-endpoint.test.mjs
git commit -m "feat: route Master Job Log rows to per-customer tabs (find-or-create)"
```

---

### Task 2: Export-failure alert shows the endpoint's real error

**Files:**
- Modify: `js/endpoint.js` (the `post` function)
- Modify: `js/app.js:1495-1507` (the append/alert block inside `exportJob`)
- Modify: `index.html:392` (`js/endpoint.js?v=1` → `?v=2`) and `index.html:399` (`js/app.js?v=20` → `?v=21`)
- Test: `test/endpoint-error.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from Task 1 (the client never learns about tabs).
- Produces: errors thrown by `Endpoint.appendLogRows` / `Endpoint.archiveSheet` carry `err.endpointError === true` **only** when the endpoint itself replied `{ok:false, error}`; network/timeout failures throw without the flag.

- [ ] **Step 1: Write the failing test**

Create `test/endpoint-error.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'),
  'utf8'
);

// `const Endpoint = (...)()` doesn't attach to the vm context, so evaluate
// the file with `;Endpoint` appended and take the completion value.
function loadEndpoint(fetchImpl) {
  const sandbox = {
    ENDPOINT_CONFIG: { url: 'https://example.invalid/exec', token: 'test-token' },
    fetch: fetchImpl,
    AbortSignal,
  };
  return vm.runInNewContext(source + ';Endpoint', sandbox);
}

test('endpoint {ok:false} replies throw with endpointError=true and the real message', async () => {
  const Endpoint = loadEndpoint(async () => ({
    json: async () => ({ ok: false, error: 'log sheet not found' }),
  }));
  await assert.rejects(
    Endpoint.appendLogRows([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]),
    (err) => err.endpointError === true && err.message === 'log sheet not found'
  );
});

test('network failures throw without the endpointError flag', async () => {
  const Endpoint = loadEndpoint(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(
    Endpoint.appendLogRows([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]),
    (err) => err.endpointError === undefined && err instanceof TypeError
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/endpoint-error.test.mjs`
Expected: FAIL — first test rejects with a plain `Error` whose `endpointError` is `undefined`.

- [ ] **Step 3: Implement**

In `js/endpoint.js`, replace the two lines after `const data = await res.json();` in `post`:

```js
    const data = await res.json();
    if (!data.ok) {
      // The server answered — its message is the real reason, and callers
      // (exportJob's alert) distinguish this from a network failure.
      const err = new Error(data.error || 'endpoint error');
      err.endpointError = true;
      throw err;
    }
    return data;
```

In `js/app.js` `exportJob`, replace the append/alert block (currently lines 1495–1507):

```js
  // Master Job Log: same rows plus the archive link as column 9, Customer as column 10.
  let logged = false;
  let failReason = ' (endpoint unreachable)';
  try {
    logged = await Endpoint.appendLogRows(
      dataRows.map((r, i) => [...r, jobSheets[i].archiveUrl || '', customerName || ''])
    );
  } catch (err) {
    console.warn('Master Job Log append failed:', err);
    if (err && err.endpointError) failReason = `: ${err.message}`;
  }

  if (!logged) {
    alert(`Master Job Log was NOT updated${failReason}. The CSV still downloaded. The job was kept so you can export it again later.`);
    return;
  }
```

In `index.html`, bump both cache-busters:
- line 392: `<script src="js/endpoint.js?v=2"></script>`
- line 399: `<script src="js/app.js?v=21"></script>`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/endpoint-error.test.mjs`
Expected: both tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add js/endpoint.js js/app.js index.html test/endpoint-error.test.mjs
git commit -m "feat: export-failure alert reports the endpoint's real error"
```

---

### Task 3: Scratch end-to-end verification (manual — requires Travis at the browser)

No repo files change in this task (checkboxes still tracked here). This is the spec's "scratch first" drill; production spreadsheet/endpoint are never touched.

**Interfaces:**
- Consumes: the final `apps-script/logging-endpoint.gs` from Task 1.

- [ ] **Step 1: Create scratch targets**

In Travis's Google account: create a throwaway spreadsheet (any name, e.g. "SCRATCH routing test") with one tab renamed to `VanLab` containing the 10-column header row. Note its spreadsheet ID from the URL. Reuse or create a throwaway Drive folder for `ARCHIVE_FOLDER_ID` (archive isn't under test; any folder ID works).

- [ ] **Step 2: Deploy a scratch endpoint**

script.google.com → New project → paste the final `logging-endpoint.gs` → fill `TOKEN` with a throwaway value (e.g. `scratch-test-token`), `LOG_SPREADSHEET_ID` with the scratch spreadsheet ID, `ARCHIVE_FOLDER_ID` with the throwaway folder ID → Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone. Copy the `/exec` URL.

- [ ] **Step 3: Exercise via browser-console fetch (NOT curl — schannel drops Content-Length on the 302)**

Open any page's DevTools console and run each check, replacing `URL` and using the scratch token. All use this helper shape:

```js
const call = (rows) => fetch('URL', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ token: 'scratch-test-token', action: 'appendRows', rows }),
  redirect: 'follow',
}).then(r => r.json()).then(console.log);

const row = (customer) => ['Sheet X', 'ScratchJob', '0:10:00', '2', 'N', 'Aug 4, 2026, 9:00 AM', 'Collin', '', '', customer];

// 1. Existing tab, case-insensitive:      expect {ok:true, appended:1}, row lands in VanLab
call([row('  vanlab ')]);
// 2. New customer:                        expect a new "Acme Sets" tab at the end, header + frozen row + 1 row
call([row('Acme Sets')]);
// 3. Mixed batch:                         expect {ok:true, appended:3}, split correctly
call([row('VanLab'), row('Acme Sets'), row('VanLab')]);
// 4. Legacy 9-col row:                    expect "Unassigned" tab created, blank Customer cell
call([row('x').slice(0, 9)]);
// 5. Illegal characters:                  expect tab named "A-B Sets", cell J keeps "A/B Sets"
call([row('A/B Sets')]);
// 6. Concurrency: paste twice fast (two calls in flight): expect both {ok:true}, no lost rows
call([row('VanLab')]); call([row('VanLab')]);
```

Verify each expectation by looking at the scratch spreadsheet after each call.

- [ ] **Step 4: Verify the client alert against the scratch endpoint**

Serve the app locally (`npm run serve`), then in that tab's console — without touching `js/endpoint-config.js` on disk — override the config and force a failure:

```js
ENDPOINT_CONFIG.url = 'SCRATCH_EXEC_URL';
ENDPOINT_CONFIG.token = 'wrong-token';
```

Upload a small sheet, complete it, export it with any customer: the alert must read `Master Job Log was NOT updated: bad token. The CSV still downloaded...` (real reason, not "endpoint unreachable"). Then set the token to the correct scratch value and export again: no alert, delete prompt appears, rows land in the scratch tab.

- [ ] **Step 5: Clean up**

Delete the scratch spreadsheet and scratch Apps Script project (or leave for future drills — Travis's call). Nothing to commit.

---

### Task 4: Go live

**Interfaces:**
- Consumes: everything above, all tests green, scratch drill passed.

- [ ] **Step 1: Push the web app live**

Use the **go-live** skill (GitHub Pages — confirm the Pages build finished, not just the push). The site changes are the alert fix + cache-busters; routing does not depend on this step.

- [ ] **Step 2: Update the live Apps Script (manual — Travis)**

Open the "CNC Tracker Endpoint" project at script.google.com → replace the code with the final `apps-script/logging-endpoint.gs` → re-enter the three real constants (`TOKEN`, `ARCHIVE_FOLDER_ID`, `LOG_SPREADSHEET_ID` — values are in the live script being replaced; copy them out first). `LOG_SHEET_NAME` is gone on purpose. Then Deploy → **Manage deployments** → ✎ on the existing deployment → Version: New version → Deploy. Same URL, so `js/endpoint-config.js` stays untouched.

- [ ] **Step 3: Live confirmation**

Collin's (or Travis's) next real export must land its rows in the tab matching the job's customer, with `{ok}` behavior — no alert, delete prompt appears. Hard-refresh (Ctrl+Shift+R) the always-open shop PC so it picks up the new alert wording (routing works regardless).

- [ ] **Step 4: Record the outcome**

Update `Brain/Projects/CNC Job Tracker.md` with the new pipeline behavior (per-customer tabs, Unassigned fallback, don't hand-rename tabs — rename in QuickBooks + Manage Customers instead) and commit any doc change:

```bash
git add docs/
git commit -m "docs: mark per-customer log routing shipped"
```
