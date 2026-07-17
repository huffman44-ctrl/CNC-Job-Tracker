# Instant Master Job Log Updates + HTML Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export CSV writes the job's rows straight into the Master Job Log (with a 9th archive-link column), and every uploaded VCarve HTML is archived to `Job Sheet Archive/<job>/` in Drive via a single Apps Script endpoint.

**Architecture:** One Apps Script web app (two actions: `archive`, `appendRows`, light token check) + a small `Endpoint` browser module that no-ops under the `PASTE` placeholder convention. Upload hook fire-and-forgets the archive; export hook awaits the log append and gates the delete-project prompt on success. Spec: `docs/superpowers/specs/2026-07-17-instant-logging-html-archive-design.md`.

**Tech Stack:** Plain JS, no build step, no test framework — verification is `node --check` syntax checks per task plus the repo's manual isolated-copy testing pattern (CLAUDE.md "Testing safety"). Apps Script (V8 runtime) on the Google side.

## Global Constraints

- **Never test against production** — the committed `js/firebase-config.js` points at the live Firestore DB, and the real endpoint writes to the real Master Job Log. All testing uses a temp copy with `PASTE`-disabled configs; endpoint testing uses throwaway spreadsheet/folder IDs (see Switchover Runbook).
- **`master` is live-deployed** via GitHub Pages. Commit per task, but do **not** push until the Switchover Runbook says so.
- The downloaded **CSV stays exactly 8 columns** (Estimating App import contract). Only the log rows get the 9th `Archive Link` column.
- Endpoint requests are POSTs with `Content-Type: text/plain;charset=utf-8` and `redirect: 'follow'` — any other content type triggers a CORS preflight that Apps Script cannot answer.
- New/changed JS files loaded by `index.html` must get bumped `?v=` cache-busting params.
- All code committed with `PASTE_` placeholder config values; real values are filled only at switchover.

---

### Task 1: Apps Script endpoint source

**Files:**
- Create: `apps-script/logging-endpoint.gs`

**Interfaces:**
- Produces (HTTP, consumed by Task 2's `Endpoint` module): POST JSON body `{ token, action: 'archive', fileName, jobName, html }` → `{ ok: true, url }`; POST `{ token, action: 'appendRows', rows: [[9 strings]] }` → `{ ok: true, appended }`; any failure → `{ ok: false, error }`. Always HTTP 200 with a JSON body (Apps Script convention).

- [ ] **Step 1: Write the script**

Create `apps-script/logging-endpoint.gs`:

```js
/**
 * CNC Job Tracker endpoint — paste into script.google.com, fill the four
 * constants, then Deploy > New deployment > Web app:
 *   Execute as: Me   |   Who has access: Anyone
 * Redeploying creates a fresh URL (rotate if the endpoint is ever abused).
 */
const TOKEN              = 'PASTE_TOKEN';
const ARCHIVE_FOLDER_ID  = 'PASTE_ARCHIVE_FOLDER_ID';
const LOG_SPREADSHEET_ID = 'PASTE_LOG_SPREADSHEET_ID';
const LOG_SHEET_NAME     = 'PASTE_LOG_SHEET_NAME';

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'invalid JSON' });
  }
  if (!body || body.token !== TOKEN) {
    return jsonOut({ ok: false, error: 'bad token' });
  }
  try {
    if (body.action === 'archive')    return jsonOut(archiveSheet(body));
    if (body.action === 'appendRows') return jsonOut(appendRows(body));
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function archiveSheet(body) {
  if (!body.fileName || !body.html) {
    return { ok: false, error: 'missing fileName or html' };
  }
  const root      = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  const jobName   = String(body.jobName || '').trim() || 'Unknown Job';
  const folders   = root.getFoldersByName(jobName);
  const jobFolder = folders.hasNext() ? folders.next() : root.createFolder(jobName);
  // Overwrite in place so the Drive file ID (and any links already exported
  // into old log rows) survives a re-upload of the same sheet.
  const existing = jobFolder.getFilesByName(body.fileName);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
    file.setContent(body.html);
  } else {
    file = jobFolder.createFile(body.fileName, body.html, 'text/html');
  }
  return { ok: true, url: file.getUrl() };
}

function appendRows(body) {
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'no rows' };
  }
  if (!rows.every(function (r) { return Array.isArray(r) && r.length === 9; })) {
    return { ok: false, error: 'rows must be 9 columns' };
  }
  const sheet = SpreadsheetApp.openById(LOG_SPREADSHEET_ID).getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'log sheet not found' };
  const values = rows.map(function (r) { return r.map(String); });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 9).setValues(values);
  return { ok: true, appended: values.length };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check "apps-script/logging-endpoint.gs"`
Expected: no output, exit 0. (`DriveApp` etc. are Apps Script globals — `--check` only parses, so that's fine.)

- [ ] **Step 3: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add apps-script/logging-endpoint.gs
git commit -m "Add Apps Script endpoint source for archive + log append"
```

---

### Task 2: Endpoint config + browser module

**Files:**
- Create: `js/endpoint-config.js`
- Create: `js/endpoint.js`
- Modify: `index.html:256-259` (script tag block)

**Interfaces:**
- Produces: global `ENDPOINT_CONFIG = { url, token }`; global `Endpoint` with `Endpoint.archiveSheet(fileName, jobName, html) → Promise<string|null>` (archive URL, or `null` when disabled) and `Endpoint.appendLogRows(rows) → Promise<true>` (resolves `true` on success **and** when disabled — so the offline export flow still reaches the delete prompt; rejects on any real failure). Tasks 3 and 4 consume these exact names.

- [ ] **Step 1: Create `js/endpoint-config.js`**

```js
/**
 * Apps Script web app endpoint (archive + Master Job Log append).
 * PASTE convention (same as firebase-config.js): while url starts with
 * 'PASTE', all endpoint calls are skipped — safe for offline/test copies.
 * Real values are filled at switchover; token is junk-filtering, not auth.
 */
const ENDPOINT_CONFIG = {
  url:   'PASTE_DEPLOYED_WEB_APP_URL',
  token: 'PASTE_TOKEN',
};
```

- [ ] **Step 2: Create `js/endpoint.js`**

```js
/**
 * Thin client for the Apps Script endpoint (apps-script/logging-endpoint.gs).
 * Content-Type must stay text/plain — anything else triggers a CORS
 * preflight that Apps Script web apps cannot answer.
 */
const Endpoint = (() => {
  function enabled() {
    return typeof ENDPOINT_CONFIG !== 'undefined'
      && ENDPOINT_CONFIG.url
      && !ENDPOINT_CONFIG.url.startsWith('PASTE');
  }

  async function post(payload) {
    const res = await fetch(ENDPOINT_CONFIG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: ENDPOINT_CONFIG.token, ...payload }),
      redirect: 'follow',
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'endpoint error');
    return data;
  }

  async function archiveSheet(fileName, jobName, html) {
    if (!enabled()) return null;
    const data = await post({ action: 'archive', fileName, jobName, html });
    return data.url || null;
  }

  async function appendLogRows(rows) {
    if (!enabled()) return true;
    await post({ action: 'appendRows', rows });
    return true;
  }

  return { enabled, archiveSheet, appendLogRows };
})();
```

- [ ] **Step 3: Load them in `index.html`**

Replace lines 256-259:

```html
  <script src="js/firebase-config.js?v=7"></script>
  <script src="js/storage.js?v=7"></script>
  <script src="js/parser.js?v=7"></script>
  <script src="js/app.js?v=9"></script>
```

with:

```html
  <script src="js/firebase-config.js?v=7"></script>
  <script src="js/endpoint-config.js?v=1"></script>
  <script src="js/endpoint.js?v=1"></script>
  <script src="js/storage.js?v=8"></script>
  <script src="js/parser.js?v=7"></script>
  <script src="js/app.js?v=10"></script>
```

(storage.js and app.js get bumped now because Tasks 3-4 modify them; doing it once here keeps the diff in one place. This also picks up the 2026-07-17 live-sync changes that shipped without a bump.)

- [ ] **Step 4: Syntax-check**

Run: `node --check js/endpoint-config.js && node --check js/endpoint.js`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add js/endpoint-config.js js/endpoint.js index.html
git commit -m "Add Endpoint client module with PASTE-disabled placeholder config"
```

---

### Task 3: Archive on upload

**Files:**
- Modify: `js/storage.js` (add `setArchiveUrl`, export it)
- Modify: `js/app.js:159-181` (`handleFiles` reader callback)

**Interfaces:**
- Consumes: `Endpoint.archiveSheet(fileName, jobName, html)` from Task 2.
- Produces: `Storage.setArchiveUrl(fileKey, url) → Promise<void>`; Firestore `sheets/{fileKey}` docs gain optional string `archiveUrl`, which flows into the in-memory `sheets` array via the existing `onSheetsChange` listener (no extra plumbing) — Task 4 reads `sheet.archiveUrl` from there.

- [ ] **Step 1: Add `setArchiveUrl` to `js/storage.js`**

Insert directly after the `saveSheet` function (after its closing `}`):

```js
  async function setArchiveUrl(fileKey, url) {
    if (!db) return;
    try {
      // update() (not merge-set) so a sheet deleted while the archive POST
      // was in flight doesn't get resurrected as a ghost doc with only
      // an archiveUrl field.
      await db.collection('sheets').doc(fileKey).update({ archiveUrl: url });
    } catch (e) {
      console.warn('Firestore setArchiveUrl failed:', e);
    }
  }
```

In the `return { ... }` export list, add `setArchiveUrl` immediately after `saveSheet`.

- [ ] **Step 2: Hook the upload in `js/app.js`**

In `handleFiles`, the reader callback currently contains:

```js
      if (!sheets.find(s => s.fileKey === key)) {
        const sheet = { fileKey: key, fileName: file.name, ...parsed };
        if (!firstNewJobName) firstNewJobName = projectKey(sheet);
        sheets.push(sheet);
        Storage.saveSheet(sheet);
      }
```

Replace with:

```js
      if (!sheets.find(s => s.fileKey === key)) {
        const sheet = { fileKey: key, fileName: file.name, ...parsed };
        if (!firstNewJobName) firstNewJobName = projectKey(sheet);
        sheets.push(sheet);
        Storage.saveSheet(sheet);
        // Fire-and-forget: the raw HTML only exists in-hand right now.
        // Failure just means a blank Archive Link cell later.
        Endpoint.archiveSheet(file.name, sheet.jobName || '', e.target.result)
          .then(url => { if (url) Storage.setArchiveUrl(key, url); })
          .catch(err => console.warn('Archive upload failed:', err));
      }
```

- [ ] **Step 3: Syntax-check**

Run: `node --check js/storage.js && node --check js/app.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add js/storage.js js/app.js
git commit -m "Archive uploaded sheet HTML to Drive via endpoint, store link on sheet doc"
```

---

### Task 4: Direct log append on export

**Files:**
- Modify: `js/app.js:1071-1106` (`exportJob`)

**Interfaces:**
- Consumes: `Endpoint.appendLogRows(rows)` from Task 2; `sheet.archiveUrl` from Task 3.
- Produces: log rows = the 8 CSV columns + `archiveUrl` (or `''`) as column 9. Delete-project prompt now appears only after a successful (or disabled-mode) append.

- [ ] **Step 1: Rework `exportJob`**

Replace the entire `exportJob` function (`js/app.js:1071-1106`) with:

```js
async function exportJob(jobName, jobSheets) {
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

  // CSV download: unchanged 8-column format (Estimating App import contract).
  const rows = [['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes'], ...dataRows];
  const escape = c => String(c).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const out  = rows.map(r => r.map(c => `"${escape(c)}"`).join(',')).join('\r\n');
  const blob = new Blob([out], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const baseName = (jobSheets[0]?.fileName || 'cnc-job')
    .replace(/\.html?$/i, '')
    .replace(/_summary.*/i, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);

  // Master Job Log: same rows plus the archive link as column 9.
  let logged = false;
  try {
    logged = await Endpoint.appendLogRows(
      dataRows.map((r, i) => [...r, jobSheets[i].archiveUrl || ''])
    );
  } catch (err) {
    console.warn('Master Job Log append failed:', err);
  }

  printJobTicket(jobName, jobSheets);

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

- [ ] **Step 2: Syntax-check**

Run: `node --check js/app.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "Append export rows directly to Master Job Log; gate delete prompt on success"
```

---

### Task 5: Offline verification + docs

**Files:**
- Modify: `CLAUDE.md` (file structure list, architecture section, current-status section)
- No code changes — this task proves the PASTE-disabled path is byte-for-byte the old behavior.

- [ ] **Step 1: Set up the isolated test copy**

```bash
cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" "$TMPDIR/cnc-webapp-test" 2>/dev/null \
  || cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" /tmp/cnc-webapp-test
```

In the copy, edit `js/firebase-config.js` → `projectId: "PASTE_DISABLED"`. Leave `js/endpoint-config.js` as-is (already `PASTE`-disabled).

- [ ] **Step 2: Serve and exercise the flow**

```bash
cd <test copy> && npx serve .
```

In a browser at the printed URL, with DevTools console open:
1. Upload `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html` from the repo root.
2. Open the project, mark the sheet Complete (Operator: Travis, notes: "offline test").
3. Click Export CSV.

Expected: CSV downloads with the same 8-column content as before this feature (`"Job Layout Sheet 9","260520_gmc_savana_3500_155wb_ew_cargo_Order_1195","00:29:05","5","Y",<timestamp>,"Travis","offline test"`); the delete-project prompt **appears** (disabled endpoint counts as success); the console shows **zero** fetch/network errors and zero requests to any Apps Script URL.

- [ ] **Step 3: Clean up**

Delete the test copy directory.

- [ ] **Step 4: Update `CLAUDE.md`**

- File structure list: add `js/endpoint-config.js` (PASTE convention, endpoint URL + token) and `js/endpoint.js` (Endpoint client: archive on upload, log append on export) after the `js/firebase-config.js` line; add `apps-script/logging-endpoint.gs` (endpoint source — pasted into script.google.com, not executed from the repo).
- Architecture § Storage: add `archiveUrl` to the `sheets/{fileKey}` field list and mention `setArchiveUrl`.
- Add to "Working" status: "Export CSV appends rows directly to the Master Job Log (9th column links each row's archived HTML in Drive); uploads are archived to Job Sheet Archive/<job>/ — both via the Apps Script endpoint, active only once `endpoint-config.js` has real values."

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Document endpoint modules and archive/instant-log flow"
```

**Do not push.** Deploy happens inside the Switchover Runbook below.

---

## Switchover Runbook (user-executed, one sitting — from the spec)

Not agent tasks; Travis drives, agent assists. Order matters.

1. **Endpoint test on throwaway targets:** paste `apps-script/logging-endpoint.gs` into script.google.com; fill constants with a fresh token + a **scratch** folder ID and **scratch** spreadsheet ID; deploy (Execute as Me / Anyone); verify with curl — expect `{"ok":true,...}` / `{"ok":false,"error":"bad token"}`:
   ```bash
   curl -sL -X POST -H "Content-Type: text/plain;charset=utf-8" -d '{"token":"<TOKEN>","action":"archive","fileName":"test.html","jobName":"Curl Test","html":"<html>hi</html>"}' "<WEB_APP_URL>"
   curl -sL -X POST -H "Content-Type: text/plain;charset=utf-8" -d '{"token":"<TOKEN>","action":"appendRows","rows":[["a","b","c","d","e","f","g","h","i"]]}' "<WEB_APP_URL>"
   curl -sL -X POST -H "Content-Type: text/plain;charset=utf-8" -d '{"token":"WRONG","action":"archive"}' "<WEB_APP_URL>"
   ```
2. **Point at real targets:** create/confirm the `Job Sheet Archive` Drive folder; add the `Archive Link` header (column 9) to the Master Job Log; swap the script constants to the real folder/spreadsheet IDs + real tab name; redeploy; note the final URL.
3. **Ship the app:** fill `js/endpoint-config.js` with the final URL + token, commit, push to `master` (= live deploy).
4. **Kill the old pipeline:** delete the `summarizeCNCJobs` timer trigger; repoint the shop browser's download folder from `My Drive\CSV Exports\` to plain Downloads.
5. **Live verification:** upload a sheet (archived file + Firestore `archiveUrl` appear) → delete and re-import it (archive overwritten in place, no duplicate file) → export a real job (rows + links land in the log instantly, CSV downloads, delete prompt appears).
