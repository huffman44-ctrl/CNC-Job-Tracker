# CSV Export: Toolpath Count + Has V-bit Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Toolpath Count` and `Has V-bit` columns to CNC Job Tracker's existing CSV export, so the Estimating App can later auto-price imported sheets.

**Architecture:** Two small additions to the existing `doExport()` function in `js/app.js` — a `sheetHasVbit()` helper reusing the same V-bit keyword list the Estimating App already uses, and two new entries in the header/row arrays. No new files, no UI changes.

**Tech Stack:** Plain JS, no build step, no framework. This repo has no automated test framework (confirmed via `package.json` — only a `serve` script) — verification follows the project's existing manual-testing pattern (see `CLAUDE.md` "Testing safety" section), not automated TDD.

## Global Constraints
- Never test against the real Firebase config — it points at the live production database (`CLAUDE.md`). All testing in this plan uses an isolated temp copy with a disabled config.
- `master` is live-deployed via GitHub Pages — do not push until manual verification (Task 1, Step 6) passes.

---

### Task 1: Add Toolpath Count and Has V-bit columns to the CSV export

**Files:**
- Modify: `js/app.js:1030-1060` (the "Export / Reset" section containing `doExport`)

**Interfaces:**
- Produces: `sheetHasVbit(sheet)` — takes a sheet object (as returned by `parseJobSheet` in `js/parser.js`, shape `{ toolpaths: [{ id, name, tool, timeEstimate }], ... }`) and returns a boolean.
- Modifies: `doExport()` — CSV header changes from `['Sheet', 'Job', 'Total Time', 'Completed At', 'Operator', 'Notes']` to `['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes']`.

- [ ] **Step 1: Add the V-bit keyword list and helper function above `doExport()`**

In `js/app.js`, immediately before the `/* Export / Reset */` section header (currently at line 1030, right before `async function doExport()`), add:

```js
const VBIT_KEYWORDS = ['V-Carve', 'V-carve', 'V Carve', 'VCarve', 'V-Groove', 'V-groove', 'V Groove'];

function sheetHasVbit(sheet) {
  const toolpaths = sheet.toolpaths || [];
  return toolpaths.some(tp => VBIT_KEYWORDS.some(kw => new RegExp(kw, 'i').test(tp.name || '')));
}
```

This mirrors the Estimating App's own `VBIT_KW` list (`cnc-quote-calculator.html:313`) exactly, so both apps agree on what counts as a V-bit operation. It checks each toolpath's `name` field (not `tool`) — real sample data confirms this matters: the tracked sample file's V-bit toolpath is named `"v-groove [2]"` with a `tool` field of `"[5] V-Bit (45 deg .125 inches)"` — the `name` field matches the `V-Groove` keyword; the `tool` field would not match any keyword in this list.

- [ ] **Step 2: Update `doExport()` to include the new columns**

Replace the existing `doExport()` function body (`js/app.js:1033-1046`):

```js
async function doExport() {
  const displaySheets = getDisplaySheets();
  if (!displaySheets.length) { alert('No sheets loaded to export.'); return; }
  const rows = [['Sheet', 'Job', 'Total Time', 'Completed At', 'Operator', 'Notes']];
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    rows.push([
      sheet.sheetTitle || sheet.fileName,
      sheet.jobName    || '',
      sheet.totalTime  || '',
      rec?.completedAt ? formatDT(new Date(rec.completedAt)) : '',
      rec?.operator || '',
      rec?.notes    || '',
    ]);
  }
```

with:

```js
async function doExport() {
  const displaySheets = getDisplaySheets();
  if (!displaySheets.length) { alert('No sheets loaded to export.'); return; }
  const rows = [['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes']];
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    rows.push([
      sheet.sheetTitle || sheet.fileName,
      sheet.jobName    || '',
      sheet.totalTime  || '',
      sheet.toolpaths ? sheet.toolpaths.length : '',
      sheetHasVbit(sheet) ? 'Y' : 'N',
      rec?.completedAt ? formatDT(new Date(rec.completedAt)) : '',
      rec?.operator || '',
      rec?.notes    || '',
    ]);
  }
```

The rest of the function (CSV escaping, blob creation, download) is unchanged.

- [ ] **Step 3: Set up an isolated test copy**

Per `CLAUDE.md`'s testing safety rule, never run this app against the real Firebase config.

```bash
cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" /tmp/cnc-webapp-test
```

Edit `/tmp/cnc-webapp-test/js/firebase-config.js` and change the `projectId` value to `"PASTE_DISABLED"`. This makes `initApp()` skip Firebase entirely and run in in-memory-only mode (`js/app.js` ~line 850).

- [ ] **Step 4: Run the test copy**

```bash
cd /tmp/cnc-webapp-test && npx serve .
```

Open the printed local URL (typically `http://localhost:3000`) in a browser.

- [ ] **Step 5: Upload the tracked sample file and mark it complete**

- Drag-and-drop (or browse to) `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html` from the repo root.
- Click into the project, select the sheet, click the completion action button to advance it to "Complete."
- In the Mark Complete modal, set Operator to **Travis**, leave notes as **"test export"**, and confirm.

- [ ] **Step 6: Export and verify the CSV**

Click "Export CSV." Open the downloaded file. Verify the row matches (Completed At will reflect whatever date/time you completed it in Step 5 — that column is unchanged by this task and locale-dependent, so just confirm it's non-empty and plausible):

```
"Sheet","Job","Total Time","Toolpath Count","Has V-bit","Completed At","Operator","Notes"
"Job Layout Sheet 9","260520_gmc_savana_3500_155wb_ew_cargo_Order_1195","00:29:05","5","Y","<your completion timestamp>","Travis","test export"
```

The two new columns must read exactly `5` and `Y` for this sample file — confirmed by inspecting its HTML directly: it has 5 toolpath rows, and one (`v-groove [2]`) matches the V-bit keyword list.

- [ ] **Step 7: Clean up the test copy**

```bash
rm -rf /tmp/cnc-webapp-test
```

- [ ] **Step 8: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add js/app.js
git commit -m "Add Toolpath Count and Has V-bit columns to CSV export

Lets the Estimating App auto-price imported completed sheets using
the same complexity signals (time, toolpath count, V-bit) manual
uploads already use."
```

Do not push yet — confirm with the user before pushing, since `master` is a live deploy.
