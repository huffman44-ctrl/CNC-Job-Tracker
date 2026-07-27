# Customer-Tagged Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture which customer a job belongs to at the moment of shop-floor export, so the Master Job Log and every per-job CSV carry a `Customer` column, and the per-job CSV lands in a per-customer subfolder instead of flat in Downloads.

**Architecture:** A blocking modal prompts for a customer (pick from a shared, growing Firestore-backed directory, or add a new one) before `exportJob` runs. The chosen name flows into two new CSV columns (per-job download, Master Job Log append) and into the download's folder path. A new "Manage Customers" screen lets the directory be edited later. This repo has no build step — everything is a `<script src>`-loaded plain JS file, vanilla DOM (no framework), Firestore via the `Storage` module.

**Tech Stack:** Vanilla JS, Firebase Firestore (compat SDK, already wired), `node --test` for pure-logic unit tests, throwaway (uncommitted) Playwright scripts for browser-behavior verification — both conventions already established in this repo.

## Global Constraints

- **Never test against real Firebase.** `js/firebase-config.js` points at the live production database. All testing must happen against an isolated temp copy of the repo with that file's `projectId` overwritten to start with `"PASTE"` (e.g. `"PASTE_DISABLED"`) — `initApp()` skips Firebase entirely in that case, falling back to in-memory-only mode.
- **`master` deploys live** via GitHub Pages the moment it's pushed. Commit locally after each task; only push on explicit go-ahead.
- **Browser-behavior tests use a throwaway, uncommitted Playwright script**, run with the Playwright install already present in the sibling `Estimate and invoice Calculator/.verify/node_modules` — this repo does not get its own Playwright install. Delete the script file after confirming results; it is a verification aid, not part of the codebase.
- **Pure-logic tests use `node --test`** (already wired via `"test": "node --test"` in `package.json`), following the existing `test/svg-codec.test.mjs` pattern: the module under test needs a trailing `if (typeof module !== 'undefined' && module.exports) module.exports = X;` guard so it's `require()`-able from Node while still working as a browser `<script>` global.
- **The live Apps Script (`apps-script/logging-endpoint.gs`) is not deployed from this repo.** It's a template pasted manually into script.google.com. Editing the repo file is necessary but not sufficient — Travis must re-paste it into the live script and confirm before the Master Job Log side of this feature is considered live.

---

### Task 1: `sanitizeForPath` helper

**Files:**
- Create: `js/path-utils.js`
- Modify: `index.html` (add a `<script src="js/path-utils.js?v=1"></script>` tag before `js/app.js`)
- Test: `test/path-utils.test.mjs`

**Interfaces:**
- Produces: `sanitizeForPath(name: string): string` — global (browser) and `module.exports.sanitizeForPath` (Node). Strips characters Windows can't use in a folder/file name, trims trailing dots/spaces, falls back to `'Unfiled'` if nothing usable remains.

- [ ] **Step 1: Write the failing test**

Create `test/path-utils.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeForPath } = require('../js/path-utils.js');

test('passes through an already-safe name', () => {
  assert.equal(sanitizeForPath('Jane Client'), 'Jane Client');
});

test('replaces Windows-illegal path characters with a dash', () => {
  assert.equal(sanitizeForPath('Jane/Client: "VIP"'), 'Jane-Client- -VIP-');
});

test('strips trailing dots and spaces', () => {
  assert.equal(sanitizeForPath('Jane Client...   '), 'Jane Client');
});

test('falls back to Unfiled for empty or illegal-only input', () => {
  assert.equal(sanitizeForPath('///'), 'Unfiled');
  assert.equal(sanitizeForPath(''), 'Unfiled');
  assert.equal(sanitizeForPath(null), 'Unfiled');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/path-utils.js'`

- [ ] **Step 3: Write the implementation**

Create `js/path-utils.js`:

```js
/**
 * Turns a free-typed name (customer, client) into something safe to use
 * as a Windows folder/file name segment in a download path.
 */
const PathUtils = (() => {
  function sanitizeForPath(name) {
    const cleaned = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/[.\s]+$/, '')
      .trim();
    return cleaned || 'Unfiled';
  }

  return { sanitizeForPath };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PathUtils;
```

- [ ] **Step 4: Expose it as a plain global for the browser**

Browser code elsewhere in this repo calls helpers as bare globals (e.g. `simpleHash(...)`, not `Parser.simpleHash(...)`). Add one line right after the IIFE so `sanitizeForPath` is callable directly from `app.js`:

```js
if (typeof module === 'undefined') { var sanitizeForPath = PathUtils.sanitizeForPath; }
```

Place this line directly below the `if (typeof module !== ...)` line already written in Step 3.

- [ ] **Step 5: Wire the script tag**

Modify `index.html` — find the script tags block (~line 303-309) and add the new tag **before** `js/app.js` (order matters: `app.js` will call `sanitizeForPath` at module-eval-adjacent time is not required, but keep it grouped with the other small utility scripts near `svg-codec.js`):

```html
  <script src="js/svg-codec.js?v=1"></script>
  <script src="js/path-utils.js?v=1"></script>
  <script src="js/storage.js?v=10"></script>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 4 assertions)

- [ ] **Step 7: Commit**

```bash
git add js/path-utils.js index.html test/path-utils.test.mjs
git commit -m "Add sanitizeForPath helper for customer-named export folders"
```

---

### Task 2: Storage — customer directory + per-project customer tag

**Files:**
- Modify: `js/storage.js`
- Test: `test/storage-customers.test.mjs`

**Interfaces:**
- Consumes: nothing new (uses the existing `db`/cache pattern already in `js/storage.js`).
- Produces (added to the `Storage` object returned at the bottom of `js/storage.js`):
  - `getCustomers(): Array<{key: string, name: string}>` — alphabetical by name.
  - `addCustomer(key: string, name: string): Promise<void>`
  - `renameCustomer(oldKey: string, newKey: string, newName: string): Promise<void>`
  - `removeCustomer(key: string): Promise<void>`
  - `loadCustomers(): Promise<void>`
  - `onCustomersChange(callback: () => void): void`
  - `getProjectCustomer(noteKey: string): string | null`
  - `setProjectCustomer(noteKey: string, name: string): Promise<void>`
  - `loadProjectCustomers(): Promise<void>`

  `noteKey` here is the same precomputed string `js/app.js`'s existing `noteKey(jobName)` function produces — `getProjectCustomer`/`setProjectCustomer` accept it as a plain string parameter, exactly like the existing `getNote(noteKey)`/`setNote(noteKey, text)` do. This task does not touch `app.js`; wiring happens in Task 3.

- [ ] **Step 1: Write the failing test**

Create `test/storage-customers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

test('addCustomer/getCustomers work offline (no Firestore db) and sort alphabetically', async () => {
  await Storage.addCustomer('cust_1', 'Jane Client');
  await Storage.addCustomer('cust_2', 'Bob Vans');
  const names = Storage.getCustomers().map(c => c.name);
  assert.deepEqual(names, ['Bob Vans', 'Jane Client']);
});

test('renameCustomer moves the cache entry to the new key/name', async () => {
  await Storage.addCustomer('cust_3', 'Old Name');
  await Storage.renameCustomer('cust_3', 'cust_4', 'New Name');
  const entries = Storage.getCustomers();
  assert.ok(!entries.some(c => c.key === 'cust_3'));
  assert.ok(entries.some(c => c.key === 'cust_4' && c.name === 'New Name'));
});

test('removeCustomer deletes the cache entry', async () => {
  await Storage.addCustomer('cust_5', 'Temp Customer');
  await Storage.removeCustomer('cust_5');
  assert.ok(!Storage.getCustomers().some(c => c.key === 'cust_5'));
});

test('getProjectCustomer/setProjectCustomer round-trip through the cache', async () => {
  assert.equal(Storage.getProjectCustomer('proj_abc'), null);
  await Storage.setProjectCustomer('proj_abc', 'Jane Client');
  assert.equal(Storage.getProjectCustomer('proj_abc'), 'Jane Client');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `require('../js/storage.js')` throws (no `module.exports`), or `Storage.addCustomer is not a function`.

- [ ] **Step 3: Add the module.exports guard**

Modify `js/storage.js` — at the very end of the file, immediately after the closing `})();` of the `Storage` IIFE, add (mirroring `js/svg-codec.js`'s existing last line exactly):

```js
if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
```

- [ ] **Step 4: Add the customer directory + project-customer cache and functions**

Modify `js/storage.js` — add two new cache declarations near the top, alongside the existing ones (~line 10-12):

```js
  const customersCache = {};        // { [key]: name }
  const projectCustomerCache = {};  // { [noteKey]: name }
```

Add a new section (placed after the existing `/* ── Sheet Notes ── */` block, before `/* ── Sheets ── */`):

```js
  /* ── Customer Directory ── */

  function getCustomers() {
    return Object.keys(customersCache)
      .map(key => ({ key, name: customersCache[key] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function addCustomer(key, name) {
    customersCache[key] = name;
    if (!db) return;
    try {
      await db.collection('customers').doc(key).set({ name });
    } catch (e) {
      console.warn('Firestore addCustomer failed:', e);
    }
  }

  async function renameCustomer(oldKey, newKey, newName) {
    delete customersCache[oldKey];
    customersCache[newKey] = newName;
    if (!db) return;
    try {
      await db.collection('customers').doc(oldKey).delete();
      await db.collection('customers').doc(newKey).set({ name: newName });
    } catch (e) {
      console.warn('Firestore renameCustomer failed:', e);
    }
  }

  async function removeCustomer(key) {
    delete customersCache[key];
    if (!db) return;
    try {
      await db.collection('customers').doc(key).delete();
    } catch (e) {
      console.warn('Firestore removeCustomer failed:', e);
    }
  }

  async function loadCustomers() {
    if (!db) return;
    try {
      const snap = await db.collection('customers').get();
      snap.forEach(doc => { customersCache[doc.id] = doc.data().name; });
    } catch (e) {
      console.warn('Firestore loadCustomers failed:', e);
    }
  }

  function onCustomersChange(callback) {
    if (!db) return;
    db.collection('customers').onSnapshot(snap => {
      Object.keys(customersCache).forEach(k => delete customersCache[k]);
      snap.forEach(doc => { customersCache[doc.id] = doc.data().name; });
      callback();
    }, err => console.warn('Firestore customers listener error:', err));
  }

  /* ── Project Customer (which customer a job is tagged with) ── */

  function getProjectCustomer(noteKey) {
    return projectCustomerCache[noteKey] || null;
  }

  async function setProjectCustomer(noteKey, name) {
    const trimmed = (name || '').trim();
    if (trimmed) {
      projectCustomerCache[noteKey] = trimmed;
    } else {
      delete projectCustomerCache[noteKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('projectCustomer').doc(noteKey).set({ name: trimmed });
      } else {
        await db.collection('projectCustomer').doc(noteKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setProjectCustomer failed:', e);
    }
  }

  async function loadProjectCustomers() {
    if (!db) return;
    try {
      const snap = await db.collection('projectCustomer').get();
      snap.forEach(doc => { projectCustomerCache[doc.id] = doc.data().name; });
    } catch (e) {
      console.warn('Firestore loadProjectCustomers failed:', e);
    }
  }
```

- [ ] **Step 5: Add the new functions to the returned object**

Modify `js/storage.js`'s final `return { ... }` statement — add the eight new names:

```js
  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory, getCustomers, addCustomer, renameCustomer, removeCustomer, loadCustomers, onCustomersChange, getProjectCustomer, setProjectCustomer, loadProjectCustomers };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 4 new tests, plus the existing `svg-codec.test.mjs` suite still green)

- [ ] **Step 7: Commit**

```bash
git add js/storage.js test/storage-customers.test.mjs
git commit -m "Add customer directory and per-project customer tag to Storage"
```

---

### Task 3: Customer picker modal + threading through export

**Files:**
- Modify: `index.html` (new modal markup, new script tag ordering already done in Task 1)
- Modify: `js/app.js` (`exportJob`, `doExport`, the project-card export handler, `initApp`)
- Test: throwaway Playwright script (see Step 8), not committed

**Interfaces:**
- Consumes: `PathUtils.sanitizeForPath` / global `sanitizeForPath` (Task 1), `Storage.getCustomers/addCustomer/getProjectCustomer/setProjectCustomer/loadCustomers/loadProjectCustomers/onCustomersChange` (Task 2), existing `noteKey(jobName)`, `simpleHash(str)` (from `js/parser.js`).
- Produces: `exportJob(jobName, jobSheets, customerName)` (signature change — was `exportJob(jobName, jobSheets)`), `openCustomerPicker(jobName): Promise<string|null>`, `customerKey(name): string`.

- [ ] **Step 1: Add the modal markup**

Modify `index.html` — insert a new modal block after the `sheet-note-overlay` block (~line 284, right before its closing structure ends and the next section begins):

```html
  <!-- ══════════════════════════════════
       CUSTOMER PICKER MODAL (export)
  ══════════════════════════════════ -->
  <div id="customer-picker-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <h2 class="modal-title">Who's this job for?</h2>
      <p id="customer-picker-subtitle" class="modal-subtitle"></p>
      <div class="modal-form">
        <div class="form-group">
          <label class="form-label" for="customer-picker-select">Customer</label>
          <select id="customer-picker-select" class="form-input">
            <option value="" disabled>Select customer…</option>
            <option value="__other__">+ New customer…</option>
          </select>
        </div>
        <div class="form-group" id="customer-picker-other-group" hidden>
          <label class="form-label" for="customer-picker-other">Customer Name</label>
          <input type="text" id="customer-picker-other" class="form-input" placeholder="Customer name">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="customer-picker-cancel">Cancel</button>
        <button class="btn btn-primary" id="customer-picker-confirm" disabled>Export</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add DOM refs**

Modify `js/app.js` — add to the DOM-refs block, right after the `sheetNoteOverlay`/`sheetNoteSubtitle`/`sheetNoteText` group (~line 71):

```js
const customerPickerOverlay  = document.getElementById('customer-picker-overlay');
const customerPickerSubtitle = document.getElementById('customer-picker-subtitle');
const customerPickerSelect   = document.getElementById('customer-picker-select');
const customerPickerOther    = document.getElementById('customer-picker-other');
const customerPickerOtherGrp = document.getElementById('customer-picker-other-group');
const customerPickerConfirm  = document.getElementById('customer-picker-confirm');
```

- [ ] **Step 3: Add the picker's open/close/confirm logic**

Modify `js/app.js` — add a new section (placed after the Sheet Note modal functions, ~line 1130, before `async function saveNote()` or in a logical spot near the other modal logic):

```js
/* ══════════════════════════════════════════
   Customer Picker (prompted at export)
══════════════════════════════════════════ */
function customerKey(name) {
  return 'cust_' + simpleHash(name.trim());
}

let customerPickerCtx = null; // { jobName, resolve }

function openCustomerPicker(jobName) {
  return new Promise(resolve => {
    customerPickerCtx = { jobName, resolve };
    customerPickerSubtitle.textContent = jobName;
    customerPickerOtherGrp.hidden = true;
    customerPickerOther.value = '';

    const known = Storage.getCustomers();
    customerPickerSelect.innerHTML = '<option value="" disabled>Select customer…</option>' +
      known.map(c => `<option value="${escHtml(c.key)}">${escHtml(c.name)}</option>`).join('') +
      '<option value="__other__">+ New customer…</option>';

    const priorName = Storage.getProjectCustomer(noteKey(jobName));
    const priorMatch = priorName && known.find(c => c.name === priorName);
    if (priorMatch) {
      customerPickerSelect.value = priorMatch.key;
    } else if (priorName) {
      // Tagged before, but that exact name isn't in the directory anymore
      // (renamed/deleted since) — keep it visible as free text rather than
      // silently losing the tag.
      customerPickerSelect.value = '__other__';
      customerPickerOtherGrp.hidden = false;
      customerPickerOther.value = priorName;
    } else {
      customerPickerSelect.value = '';
    }

    updateCustomerPickerConfirmState();
    customerPickerOverlay.classList.remove('hidden');
  });
}

function updateCustomerPickerConfirmState() {
  const valid = customerPickerSelect.value === '__other__'
    ? customerPickerOther.value.trim().length > 0
    : customerPickerSelect.value !== '';
  customerPickerConfirm.disabled = !valid;
}

customerPickerSelect.addEventListener('change', () => {
  customerPickerOtherGrp.hidden = customerPickerSelect.value !== '__other__';
  updateCustomerPickerConfirmState();
});
customerPickerOther.addEventListener('input', updateCustomerPickerConfirmState);

function closeCustomerPicker(result) {
  customerPickerOverlay.classList.add('hidden');
  const ctx = customerPickerCtx;
  customerPickerCtx = null;
  if (ctx) ctx.resolve(result);
}

document.getElementById('customer-picker-cancel').addEventListener('click', () => closeCustomerPicker(null));
customerPickerOverlay.addEventListener('click', e => { if (e.target === customerPickerOverlay) closeCustomerPicker(null); });

customerPickerConfirm.addEventListener('click', async () => {
  const ctx = customerPickerCtx;
  if (!ctx) return;
  let name;
  if (customerPickerSelect.value === '__other__') {
    name = customerPickerOther.value.trim();
    if (!name) return;
    await Storage.addCustomer(customerKey(name), name);
  } else {
    const match = Storage.getCustomers().find(c => c.key === customerPickerSelect.value);
    if (!match) return;
    name = match.name;
  }
  await Storage.setProjectCustomer(noteKey(ctx.jobName), name);
  closeCustomerPicker(name);
});
```

- [ ] **Step 4: Thread the picker into both export entry points**

Modify `js/app.js` — the project-card export handler (~line 590):

```js
  exportBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const jobSheets = [...projectSheets].sort((a, b) => sheetNumber(a.fileName) - sheetNumber(b.fileName));
    const customerName = await openCustomerPicker(jobName);
    if (!customerName) return;
    await exportJob(jobName, jobSheets, customerName);
  });
```

And `doExport` (~line 1294):

```js
async function doExport() {
  const customerName = await openCustomerPicker(currentProject);
  if (!customerName) return;
  await exportJob(currentProject, getDisplaySheets(), customerName);
}
```

- [ ] **Step 5: Add the Customer column and folder path to `exportJob`**

Modify `js/app.js`'s `exportJob` function (~line 1235) — change the signature and the CSV/log-row construction:

```js
async function exportJob(jobName, jobSheets, customerName) {
  if (!jobSheets.length) { alert('No sheets loaded to export.'); return; }
  const dataRows = jobSheets.map(sheet => {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    return [
      sheet.sheetTitle || sheet.fileName,
      sheet.jobName    || '',
      sheet.totalTime  || '',
      sheet.toolpaths ? sheet.toolpaths.length : '',
      sheetHasVbit(sheet) ? 'Y' : 'N',
      rec?.completedAt ? formatDT(new Date(rec.completedAt)) : '',
      rec?.operator || '',
      rec?.notes    || '',
    ];
  });

  // CSV download: 9 columns now (Customer appended — Estimating App import contract).
  const rows = [
    ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes', 'Customer'],
    ...dataRows.map(r => [...r, customerName || '']),
  ];
  const escape = c => String(c).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const out  = rows.map(r => r.map(c => `"${escape(c)}"`).join(',')).join('\r\n');
  const blob = new Blob([out], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const baseName = (jobSheets[0]?.fileName || 'cnc-job')
    .replace(/\.html?$/i, '')
    .replace(/_summary.*/i, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `CNC Job Exports/${sanitizeForPath(customerName)}/${baseName}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);

  // Print (and save to reprintable history) BEFORE the network await below —
  // window.print() must run within the click's "fresh" window or Chrome
  // silently drops it once enough time has passed since the triggering click.
  const meta = ticketMeta(jobName, jobSheets);
  showTicketAndPrint(meta);
  Storage.saveTicketRecord(meta);

  // Master Job Log: same rows plus the archive link as column 9, Customer as column 10.
  let logged = false;
  try {
    logged = await Endpoint.appendLogRows(
      dataRows.map((r, i) => [...r, jobSheets[i].archiveUrl || '', customerName || ''])
    );
  } catch (err) {
    console.warn('Master Job Log append failed:', err);
  }

  if (!logged) {
    alert('Master Job Log was NOT updated (endpoint unreachable). The CSV still downloaded. The job was kept so you can export it again later.');
    return;
  }

  if (!jobName) return;
  if (!confirm(`Delete "${jobName}"? This removes all ${jobSheets.length} sheet${jobSheets.length !== 1 ? 's' : ''} and completion records for everyone.`)) return;
  await deleteProject(jobName);
  if (sheets.length) showProjectsScreen();
}
```

- [ ] **Step 6: Load the customer data at startup**

Modify `js/app.js`'s `initApp()` (~line 1342) — add the two new loads alongside the existing ones:

```js
    const [storedSheets] = await Promise.all([
      Storage.loadSheets(),
      Storage.loadCompletions(),
      Storage.loadNotes(),
      Storage.loadSheetNotes(),
      Storage.loadCustomers(),
      Storage.loadProjectCustomers(),
    ]);
```

And add a listener alongside the existing `onNoteChange`/`onSheetNoteChange` calls (~line 1385):

```js
    Storage.onCustomersChange(() => {
      // No screen currently renders the customer list live outside the
      // export picker and Manage Customers screen (Task 4), both of which
      // read Storage.getCustomers() fresh each time they open — nothing
      // to re-render here.
    });
```

- [ ] **Step 7: Manual sanity check — Chrome subfolder creation**

This step cannot be automated (Playwright's download interception may not reflect real Chrome download-manager folder creation). Before trusting this feature:

1. Serve the app locally: `npm run serve`.
2. Open it in real Chrome (not via Playwright), upload the sample sheet at the repo root, export it, pick or type a customer.
3. Check your real Downloads folder — confirm a `CNC Job Exports\<Customer Name>\` subfolder was created containing the CSV.

- [ ] **Step 8: Write and run the throwaway Playwright verification**

This is **not committed** — write it to a scratch path, run it, delete it.

```js
// THROWAWAY — do not commit. Run against an isolated temp copy of CNC_WebApp
// with js/firebase-config.js's projectId overwritten to "PASTE_DISABLED".
const { chromium } = require('C:/Users/Golden Boys/Documents/Agemtic Workflows/Estimate and invoice Calculator/.verify/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const filePath = process.argv[2]; // path to the temp copy's index.html
  await page.goto('file:///' + filePath.split('\\').join('/'));

  await page.setInputFiles('#file-input', [
    path.resolve(process.argv[3]), // path to the sample sheet HTML
  ]);
  await page.waitForSelector('.sheet-detail');

  await page.click('#export-btn');
  await page.waitForSelector('#customer-picker-overlay:not(.hidden)');
  console.log('Confirm disabled with nothing picked (expect true):',
    await page.$eval('#customer-picker-confirm', b => b.disabled));

  await page.selectOption('#customer-picker-select', '__other__');
  await page.fill('#customer-picker-other', 'Jane Client');
  console.log('Confirm enabled after typing a name (expect false):',
    await page.$eval('#customer-picker-confirm', b => b.disabled));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#customer-picker-confirm'),
  ]);
  console.log('Suggested filename (expect to contain "CNC Job Exports/Jane Client/"):', download.suggestedFilename());

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  const header = csv.split('\r\n')[0];
  console.log('CSV header ends with "Customer" (expect true):', header.endsWith('"Customer"'));
  console.log('First data row ends with "Jane Client" (expect true):', csv.split('\r\n')[1].endsWith('"Jane Client"'));

  console.log('Page errors (expect []):', JSON.stringify(errors));
  await browser.close();
})();
```

Run: `node <script-path>.js <path-to-temp-copy>/index.html <path-to-temp-copy>/260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet\ 9.html`

Expected: both disabled-state lines print `true` then `false`; suggested filename contains the nested path; CSV header/row assertions both print `true`; page errors `[]`.

- [ ] **Step 9: Commit**

```bash
git add index.html js/app.js
git commit -m "Prompt for a customer at export and thread it into CSV/Master Log/folder path"
```

---

### Task 4: Manage Customers screen

**Files:**
- Modify: `index.html` (new screen, new header button)
- Modify: `js/app.js` (screen show/hide, list render, add/rename/delete wiring)
- Test: throwaway Playwright script, not committed

**Interfaces:**
- Consumes: `Storage.getCustomers/addCustomer/renameCustomer/removeCustomer` (Task 2), `customerKey(name)` (Task 3).
- Produces: `showManageCustomersScreen()`, `renderCustomersList()`.

- [ ] **Step 1: Add the screen markup**

Modify `index.html` — insert after the `ticket-history-screen` block (~line 101), following its exact structure:

```html
  <!-- ══════════════════════════════════
       MANAGE CUSTOMERS SCREEN
  ══════════════════════════════════ -->
  <div id="customers-screen" hidden>
    <header class="app-header">
      <div class="header-left">
        <button class="btn btn-ghost btn-sm" id="customers-back-btn">← Projects</button>
        <span class="header-logo-badge">CNC</span>
        <div class="header-divider"></div>
        <div class="header-titles">
          <span class="header-file-title">Manage Customers</span>
          <span id="customers-count" class="header-job-name"></span>
        </div>
      </div>
    </header>
    <main class="content-main">
      <div class="filter-row">
        <input type="text" id="customers-add-input" class="filter-search" placeholder="New customer name…">
        <button class="btn btn-primary btn-sm" id="customers-add-btn">+ Add</button>
      </div>
      <div id="customers-list" class="ticket-history-list"></div>
    </main>
  </div>
```

- [ ] **Step 2: Add the header button to open it**

Modify `index.html`'s Projects screen header (~line 54-58) — add next to "Ticket History":

```html
        <button class="btn btn-ghost btn-sm" id="manage-customers-btn">Manage Customers</button>
```

- [ ] **Step 3: Screen navigation + list rendering**

Modify `js/app.js` — add DOM ref near the other screen consts (~line 47):

```js
const customersScreen = document.getElementById('customers-screen');
```

Add a new section (placed after the Ticket History section, ~line 359):

```js
/* ══════════════════════════════════════════
   Manage Customers
══════════════════════════════════════════ */
function showManageCustomersScreen() {
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = false;
  document.getElementById('customers-add-input').value = '';
  renderCustomersList();
}

function renderCustomersList() {
  const container = document.getElementById('customers-list');
  const entries = Storage.getCustomers();

  document.getElementById('customers-count').textContent =
    `${entries.length} customer${entries.length !== 1 ? 's' : ''}`;

  if (!entries.length) {
    container.innerHTML = '<p class="ticket-history-empty">No customers yet — add one above.</p>';
    return;
  }

  container.innerHTML = entries.map(c => `
    <div class="ticket-history-row" data-key="${escHtml(c.key)}">
      <div class="ticket-history-row-info">
        <input type="text" class="form-input customers-rename-input" value="${escHtml(c.name)}">
      </div>
      <button class="btn btn-ghost btn-sm customers-rename-btn">Rename</button>
      <button class="btn btn-danger btn-sm customers-delete-btn">Delete</button>
    </div>
  `).join('');

  container.querySelectorAll('.customers-rename-btn').forEach(btn => {
    const row = btn.closest('.ticket-history-row');
    btn.addEventListener('click', async () => {
      const oldKey = row.dataset.key;
      const newName = row.querySelector('.customers-rename-input').value.trim();
      if (!newName) return;
      await Storage.renameCustomer(oldKey, customerKey(newName), newName);
      renderCustomersList();
    });
  });

  container.querySelectorAll('.customers-delete-btn').forEach(btn => {
    const row = btn.closest('.ticket-history-row');
    btn.addEventListener('click', async () => {
      const entry = entries.find(c => c.key === row.dataset.key);
      if (!confirm(`Remove "${entry.name}" from the customer list? This does not affect any job already tagged with this name.`)) return;
      await Storage.removeCustomer(row.dataset.key);
      renderCustomersList();
    });
  });
}

document.getElementById('customers-add-btn').addEventListener('click', async () => {
  const input = document.getElementById('customers-add-input');
  const name = input.value.trim();
  if (!name) return;
  await Storage.addCustomer(customerKey(name), name);
  input.value = '';
  renderCustomersList();
});
```

- [ ] **Step 4: Wire the back/open buttons**

Modify `js/app.js` — add alongside the existing ticket-history button wiring (~line 124):

```js
document.getElementById('manage-customers-btn').addEventListener('click', showManageCustomersScreen);
document.getElementById('customers-back-btn').addEventListener('click', showProjectsScreen);
```

Also modify `showProjectsScreen()` (~line 273) to hide the new screen too, matching how it already hides `ticketHistoryScreen`:

```js
function showProjectsScreen() {
  uploadScreen.hidden        = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = true;
  projectsScreen.hidden      = false;
  renderProjects();
}
```

- [ ] **Step 5: Write and run the throwaway Playwright verification**

Not committed — write, run, delete.

```js
// THROWAWAY — do not commit.
const { chromium } = require('C:/Users/Golden Boys/Documents/Agemtic Workflows/Estimate and invoice Calculator/.verify/node_modules/playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file:///' + process.argv[2].split('\\').join('/'));

  await page.click('#manage-customers-btn');
  await page.fill('#customers-add-input', 'Jane Client');
  await page.click('#customers-add-btn');
  console.log('Row count after add (expect 1):', await page.$$eval('.ticket-history-row', rows => rows.length));

  await page.fill('.customers-rename-input', 'Jane C. LLC');
  await page.click('.customers-rename-btn');
  console.log('Renamed value shown (expect "Jane C. LLC"):',
    await page.$eval('.customers-rename-input', el => el.value));

  page.once('dialog', d => d.accept());
  await page.click('.customers-delete-btn');
  console.log('Row count after delete (expect 0):', await page.$$eval('.ticket-history-row', rows => rows.length));

  await browser.close();
})();
```

Run: `node <script-path>.js <path-to-temp-copy>/index.html`
Expected: `1`, `"Jane C. LLC"`, `0`.

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js
git commit -m "Add Manage Customers screen for renaming/removing directory entries"
```

---

### Task 5: Apps Script column bump (template only — manual deploy required)

**Files:**
- Modify: `apps-script/logging-endpoint.gs`

**Interfaces:**
- Consumes: nothing from this repo's runtime (this file is not executed by the deployed app — see Global Constraints).
- Produces: an updated template, ready for Travis to paste into script.google.com.

- [ ] **Step 1: Bump the column-count validation**

Modify `apps-script/logging-endpoint.gs` line 87:

```js
  if (!rows.every(function (r) { return Array.isArray(r) && r.length === 10; })) {
    return { ok: false, error: 'rows must be 10 columns' };
  }
```

- [ ] **Step 2: Bump the range width**

Modify `apps-script/logging-endpoint.gs` line 93:

```js
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 10).setValues(values);
```

- [ ] **Step 3: Commit the template change**

```bash
git add apps-script/logging-endpoint.gs
git commit -m "Bump Master Job Log row width to 10 columns for Customer (template only)"
```

- [ ] **Step 4: Manual production checklist — do NOT mark this feature live until done**

This step has no automated test; it is a checklist for Travis:

1. Open the live Apps Script project at script.google.com (the one bound to the real Master Job Log spreadsheet).
2. Paste in the updated `apps-script/logging-endpoint.gs` contents from this repo (fill in the four `PASTE_*` constants with the real live values, exactly as the existing deployment already has them — do not reset them to placeholders).
3. Re-deploy (Deploy > Manage deployments > Edit > New version), or confirm the existing deployment auto-picks up the new code (Apps Script web app deployments require a new version to take effect for `doPost`/library-style script changes).
4. Open the live Master Job Log Google Sheet and add a `Customer` header in its 10th column (column J), matching the 9 existing headers already there.
5. Only after both 2–4 are confirmed: export one real test job from the live app, verify the Master Log gains a correctly-populated row with 10 columns, and confirm no `"rows must be 10 columns"` error appeared.

---

### Task 6: End-to-end verification

**Files:**
- Throwaway Playwright script, not committed.

- [ ] **Step 1: Write and run the full-flow verification**

```js
// THROWAWAY — do not commit.
const { chromium } = require('C:/Users/Golden Boys/Documents/Agemtic Workflows/Estimate and invoice Calculator/.verify/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file:///' + process.argv[2].split('\\').join('/'));

  // Load two different jobs so both the project card and header export paths
  // can be exercised, and re-export the same job to confirm tag persistence.
  await page.setInputFiles('#file-input', [path.resolve(process.argv[3])]);
  await page.waitForSelector('.sheet-detail');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('.project-card');

  // Card-initiated export
  await page.click('.project-card .btn-primary.btn-sm:has-text("Export CSV")');
  await page.waitForSelector('#customer-picker-overlay:not(.hidden)');
  await page.selectOption('#customer-picker-select', '__other__');
  await page.fill('#customer-picker-other', 'Jane Client');
  const [download1] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#customer-picker-confirm'),
  ]);
  console.log('First export suggested filename (expect to contain "Jane Client"):', download1.suggestedFilename());

  console.log('Page errors (expect []):', JSON.stringify(errors));
  await browser.close();
})();
```

Run: `node <script-path>.js <path-to-temp-copy>/index.html <path-to-temp-copy>/260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet\ 9.html`
Expected: filename line confirms the customer-scoped path, page errors `[]`.

- [ ] **Step 2: Re-run the Task 3 Step 7 manual Chrome sanity check** once more with this final code, to catch any regression introduced by Task 4/5's changes.

- [ ] **Step 3: Confirm with Travis** that Task 5's manual production checklist is complete before considering the Master Job Log side of this feature live, then push:

```bash
git push
```
