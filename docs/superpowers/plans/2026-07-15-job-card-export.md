# Export CSV From the Job Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project card in the directory gets an `Export CSV` button (replacing the redundant `Open →` button) that runs the full close-out — CSV, 4×6 ticket, delete offer — without opening the job.

**Architecture:** Per the spec (`docs/superpowers/specs/2026-07-15-job-card-export-design.md`): refactor `doExport()` into a parameterized `exportJob(jobName, jobSheets)` (header button delegates to it), swap the card's `Open →` button for an `Export CSV` button calling it with that card's sheets. Whole-card click already opens the job (`js/app.js:500-503`) — untouched.

**Tech Stack:** Plain JS/HTML/CSS, no framework, no build step, no test framework. Verification: isolated temp copy (Firebase disabled) + throwaway Playwright driver borrowed from the estimator repo's `.verify/` install (not committed here).

## Global Constraints

- **Never run against the real `js/firebase-config.js`** — live production database. Temp copy with `projectId: "PASTE_DISABLED"` only.
- `master` deploys live via GitHub Pages — **commit, do not push** without Travis's explicit go.
- CSV columns, ticket layout, header-button behavior, and the card's note/delete/click-to-open behaviors are all unchanged.
- Line numbers are current positions — match on the quoted code, not the number.

---

### Task 1: exportJob refactor + card button swap

**Files:**
- Modify: `js/app.js:1071-1108` (`doExport` → `exportJob` + thin `doExport`)
- Modify: `js/app.js:469-482` (card button group: remove `openBtn`, add `exportBtn`)
- Modify: `index.html:259` (bump `js/app.js?v=8` → `?v=9`)
- Test: throwaway Playwright driver in the temp copy (not committed)

**Interfaces:**
- Produces: `exportJob(jobName, jobSheets)` — async; everything `doExport` does today, reading only its parameters. `jobName` may be `null` (header path with no current project) — then the delete offer is skipped, as today.
- Consumes: `buildProjectCard(jobName, projectSheets)` params (`js/app.js:375`), `sheetNumber(fileName)` sorter (used by `getDisplaySheets`, `js/app.js:264`), `printJobTicket`, `deleteProject`.

- [ ] **Step 1: Refactor `doExport` into `exportJob`**

Replace the whole function (`js/app.js:1071-1108`):

```js
async function doExport() {
  const displaySheets = getDisplaySheets();
  ...
  if (sheets.length) showProjectsScreen();
}
```

with:

```js
async function exportJob(jobName, jobSheets) {
  if (!jobSheets.length) { alert('No sheets loaded to export.'); return; }
  const rows = [['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes']];
  for (const sheet of jobSheets) {
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

  printJobTicket(jobSheets);

  if (!jobName) return;
  if (!confirm(`Delete "${jobName}"? This removes all ${jobSheets.length} sheet${jobSheets.length !== 1 ? 's' : ''} and completion records for everyone.`)) return;
  await deleteProject(jobName);
  if (sheets.length) showProjectsScreen();
}

async function doExport() {
  await exportJob(currentProject, getDisplaySheets());
}
```

(This is today's body with `displaySheets` → `jobSheets` and `const jobName = currentProject;` → the `jobName` parameter. `deleteProject` itself already re-renders the directory — `js/app.js:338-351` — so the card flow refreshes in place; the trailing `showProjectsScreen()` keeps the header flow's navigation and is a no-op-safe re-render when already on the directory.)

- [ ] **Step 2: Swap the card's Open button for Export CSV**

In `buildProjectCard` (`js/app.js:469-482`), replace:

```js
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn btn-primary btn-sm';
  openBtn.textContent = 'Open →';
  openBtn.addEventListener('click', e => {
    e.stopPropagation();
    currentProject = jobName;
    showContentScreen();
  });

  const btnGroup = document.createElement('div');
  btnGroup.className = 'project-card-btn-group';
  btnGroup.appendChild(noteBtn);
  btnGroup.appendChild(openBtn);
```

with:

```js
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn btn-primary btn-sm';
  exportBtn.textContent = 'Export CSV';
  exportBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const jobSheets = [...projectSheets].sort((a, b) => sheetNumber(a.fileName) - sheetNumber(b.fileName));
    await exportJob(jobName, jobSheets);
  });

  const btnGroup = document.createElement('div');
  btnGroup.className = 'project-card-btn-group';
  btnGroup.appendChild(noteBtn);
  btnGroup.appendChild(exportBtn);
```

(The sort mirrors `getDisplaySheets` — `js/app.js:264` — so card-initiated CSVs have identical row order to header-initiated ones.)

- [ ] **Step 3: Bump the app.js cache-buster**

In `index.html`, change `js/app.js?v=8` → `js/app.js?v=9`. Leave all other `?v=` values alone.

- [ ] **Step 4: Set up the isolated test copy**

```bash
TESTDIR="/c/Users/GOLDEN~1/AppData/Local/Temp/cnc-card-export-test"
rm -rf "$TESTDIR" && cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" "$TESTDIR"
```

Edit the copy's `js/firebase-config.js`: set `projectId` to `"PASTE_DISABLED"`.

- [ ] **Step 5: Write the throwaway driver**

Create `C:\Users\GOLDEN~1\AppData\Local\Temp\cnc-card-export-test\check-card-export.js`. Base it on the ticket feature's driver pattern (stub `window.print` via `addInitScript`, auto-accept dialogs, load `file:///C:/Users/GOLDEN~1/AppData/Local/Temp/cnc-card-export-test/index.html`). The repo has one sample sheet file (`260520_..._Summary_Sheet 9.html` at repo root) — to get **two** jobs, upload it, then create a modified copy in the temp dir with a different job name in its `<title>` (e.g. sed-replace `Order_1195` → `Order_TEST2`) and upload that too. Assertions, all with `(expect ...)` annotations:

1. Directory screen shows 2 project cards; **no button with text `Open →` anywhere**.
2. Each card has an `Export CSV` button (`.project-card-btn-group .btn-primary`).
3. Clicking one card's Export CSV (capture `download` event): CSV contains **only that job's** rows; `window.print` called once; ticket name element matched that job; auto-accepted confirm mentioned that job's name (capture dialog message).
4. After the flow, the directory is still rendered with 1 remaining card (the other job).
5. Clicking the remaining card's **title/body** still opens the job (content screen visible, header shows its name).
6. Inside the job, the header `Export CSV` still works (`window.print` count increments; download fires).
7. Zero page errors.

Adapt selectors to the real DOM (source of truth: `index.html`, `js/app.js`) — the assertions above are the contract, the selectors are yours to get right.

- [ ] **Step 6: Run the driver**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/Estimate and invoice Calculator/.verify"
node "C:\Users\GOLDEN~1\AppData\Local\Temp\cnc-card-export-test\check-card-export.js"
```

Every `(expect ...)` annotation must match.

- [ ] **Step 7: Commit (do not push)**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add js/app.js index.html
git commit -m "Add Export CSV to job cards, drop the redundant Open button

Cards close out a job (CSV, 4x6 ticket, delete offer) straight from
the directory via a shared exportJob core; opening stays as the
whole-card click it already was."
```
