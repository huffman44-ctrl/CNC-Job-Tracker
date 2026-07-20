# Job Ticket Reprint History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the job ticket's print dialog being silently blocked by Chrome (it currently fires after an awaited network call), and add a durable, indefinitely-retained "Ticket History" screen so any past job's ticket can be reprinted after the job itself has been deleted.

**Architecture:** A new Firestore collection `ticketHistory` (one doc per export, written client-side, no server/Apps Script changes needed) backs a new browser screen reachable from the Projects directory. The existing print logic is refactored into a small shared `showTicketAndPrint(meta)` function used both by the live export flow and by reprinting from history, and `exportJob()` is reordered so printing happens before its network await instead of after. Spec: `docs/superpowers/specs/2026-07-20-ticket-reprint-history-design.md`.

**Tech Stack:** Plain JS, no build step, no test framework — verification is `node --check` syntax checks per task plus manual browser verification (this repo has no scratch Firestore project, so final functional verification necessarily uses the real production Firestore with clearly-labeled throwaway test data, same practice already used for the archive endpoint's "Debug Test" verification).

## Global Constraints

- **`master` is live-deployed** via GitHub Pages — every commit here is a real deploy once pushed. Commit per task; pushing happens after Task 5's live verification passes, not before.
- **This feature is purely additive** — it introduces a new Firestore collection and a new screen; it does not modify or delete anything in the existing `sheets`, `completions`, `projectNotes`, or `sheetNotes` collections, and does not touch the Apps Script endpoint at all.
- New/changed JS and CSS files loaded by `index.html` must get their `?v=` cache-busting param bumped (current: `js/storage.js?v=8`, `js/app.js?v=10`, `css/style.css?v=8`).
- `window.print()` must be called synchronously within a click handler with nothing `await`ed beforehand — this is the root cause of the bug being fixed, and the same rule applies to the new reprint button.
- Firestore field names for ticket records are exactly `jobName`, `sheetCount`, `completedDate`, `exportedAt` — used identically in `js/storage.js`, `js/app.js`, and by `reprintTicket` (which passes a loaded record straight through, relying on the field names matching).

---

### Task 1: Ticket history storage functions

**Files:**
- Modify: `js/storage.js` (add `saveTicketRecord`, `loadTicketHistory`, export both)
- Modify: `index.html:9` (bump `js/storage.js` cache-bust version — wait, verify exact line, see Step 3)

**Interfaces:**
- Produces: `Storage.saveTicketRecord({ jobName, sheetCount, completedDate }) → Promise<void>` (fire-and-forget safe — never throws, `console.warn`s on failure); `Storage.loadTicketHistory() → Promise<Array<{jobName, sheetCount, completedDate, exportedAt}> | null>`, newest-first, **`null` specifically means the load failed** (vs. `[]` meaning genuinely no records) — Task 4 must show a different message for each case. Both consumed by Task 2 and Task 4.

- [ ] **Step 1: Add the two functions to `js/storage.js`**

Locate the existing `clearAllCompletions` function and the `return { ... }` line right after it:

```js
  async function clearAllCompletions() {
    Object.keys(completionsCache).forEach(k => delete completionsCache[k]);
    if (!db) return;
    try {
      const snap = await db.collection('completions').get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.warn('Firestore clearAllCompletions failed:', e);
    }
  }

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions };
})();
```

Replace with:

```js
  async function clearAllCompletions() {
    Object.keys(completionsCache).forEach(k => delete completionsCache[k]);
    if (!db) return;
    try {
      const snap = await db.collection('completions').get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.warn('Firestore clearAllCompletions failed:', e);
    }
  }

  /* ── Ticket History (reprintable job tickets) ── */

  async function saveTicketRecord(record) {
    if (!db) return;
    try {
      await db.collection('ticketHistory').add({
        jobName:       record.jobName       || '',
        sheetCount:    record.sheetCount    || 0,
        completedDate: record.completedDate || '',
        exportedAt:    firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Firestore saveTicketRecord failed:', e);
    }
  }

  async function loadTicketHistory() {
    // Returns [] for "no records" but null for "failed to load" — callers
    // need to tell these apart to show the right empty-state message.
    if (!db) return [];
    try {
      const snap = await db.collection('ticketHistory').orderBy('exportedAt', 'desc').get();
      return snap.docs.map(doc => doc.data());
    } catch (e) {
      console.warn('Firestore loadTicketHistory failed:', e);
      return null;
    }
  }

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory };
})();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check "js/storage.js"`
Expected: no output, exit 0.

- [ ] **Step 3: Bump the cache-busting version in `index.html`**

Find this line (currently near the top of `<head>`, and also in the script tags near the bottom — there are two things named `storage.js`-adjacent, only bump the actual `storage.js` script tag, not `style.css`):

```html
  <script src="js/storage.js?v=8"></script>
```

Replace with:

```html
  <script src="js/storage.js?v=9"></script>
```

- [ ] **Step 4: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add js/storage.js index.html
git commit -m "Add ticketHistory storage functions for job ticket reprints"
```

---

### Task 2: Fix the print-timing bug and save history on export

**Files:**
- Modify: `js/app.js` (replace `printJobTicket`, add `ticketMeta`/`showTicketAndPrint`, reorder `exportJob`)
- Modify: `index.html` (bump `js/app.js` cache-bust version)

**Interfaces:**
- Consumes: `Storage.saveTicketRecord` from Task 1.
- Produces: `ticketMeta(jobName, displaySheets) → { jobName, sheetCount, completedDate }`; `showTicketAndPrint(meta)` — shows and prints the `#job-ticket` element from a meta object, no live sheet lookups. Both consumed by Task 4's `reprintTicket`.

- [ ] **Step 1: Replace `printJobTicket` with `ticketMeta` + `showTicketAndPrint` + a slimmer `printJobTicket`**

Locate the existing `printJobTicket` function:

```js
function printJobTicket(jobName, displaySheets) {
  const ticket = document.getElementById('job-ticket');
  if (!ticket || !displaySheets.length) return;
  const name = jobName
    || displaySheets[0]?.jobName
    || (displaySheets[0]?.fileName || 'CNC Job').replace(/\.html?$/i, '');
  let latest = null;
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (rec?.completedAt) {
      const d = new Date(rec.completedAt);
      if (!latest || d > latest) latest = d;
    }
  }
  const dateStr = (latest || new Date()).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const n = displaySheets.length;
  document.getElementById('job-ticket-name').textContent = name;
  document.getElementById('job-ticket-meta').textContent =
    `${n} sheet${n !== 1 ? 's' : ''} — completed ${dateStr}`;
  ticket.hidden = false;
  document.body.classList.add('printing-ticket');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-ticket');
    ticket.hidden = true;
  }
}
```

Replace with:

```js
function ticketMeta(jobName, displaySheets) {
  const name = jobName
    || displaySheets[0]?.jobName
    || (displaySheets[0]?.fileName || 'CNC Job').replace(/\.html?$/i, '');
  let latest = null;
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (rec?.completedAt) {
      const d = new Date(rec.completedAt);
      if (!latest || d > latest) latest = d;
    }
  }
  const completedDate = (latest || new Date()).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return { jobName: name, sheetCount: displaySheets.length, completedDate };
}

function showTicketAndPrint(meta) {
  const ticket = document.getElementById('job-ticket');
  if (!ticket) return;
  document.getElementById('job-ticket-name').textContent = meta.jobName;
  document.getElementById('job-ticket-meta').textContent =
    `${meta.sheetCount} sheet${meta.sheetCount !== 1 ? 's' : ''} — completed ${meta.completedDate}`;
  ticket.hidden = false;
  document.body.classList.add('printing-ticket');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-ticket');
    ticket.hidden = true;
  }
}

function printJobTicket(jobName, displaySheets) {
  if (!displaySheets.length) return;
  showTicketAndPrint(ticketMeta(jobName, displaySheets));
}
```

- [ ] **Step 2: Reorder `exportJob` — print and save history before the network await**

Locate the existing `exportJob` function:

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

Replace with:

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

  // Print (and save to reprintable history) BEFORE the network await below —
  // window.print() must run within the click's "fresh" window or Chrome
  // silently drops it once enough time has passed since the triggering click.
  const meta = ticketMeta(jobName, jobSheets);
  showTicketAndPrint(meta);
  Storage.saveTicketRecord(meta);

  // Master Job Log: same rows plus the archive link as column 9.
  let logged = false;
  try {
    logged = await Endpoint.appendLogRows(
      dataRows.map((r, i) => [...r, jobSheets[i].archiveUrl || ''])
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

- [ ] **Step 3: Syntax-check**

Run: `node --check "js/app.js"`
Expected: no output, exit 0.

- [ ] **Step 4: Bump the cache-busting version in `index.html`**

Find:

```html
  <script src="js/app.js?v=10"></script>
```

Replace with:

```html
  <script src="js/app.js?v=11"></script>
```

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add js/app.js index.html
git commit -m "Fix job ticket print firing after network await; save export to ticket history"
```

---

### Task 3: Ticket History screen markup and styles

**Files:**
- Modify: `index.html` (add "Ticket History" button, add `#ticket-history-screen` markup, bump `css/style.css` cache-bust version)
- Modify: `css/style.css` (append list/row styles)

**Interfaces:**
- Produces: DOM elements consumed by Task 4 — `#ticket-history-btn`, `#ticket-history-screen`, `#ticket-history-back-btn`, `#ticket-history-count`, `#ticket-history-search`, `#ticket-history-list`.

- [ ] **Step 1: Add the "Ticket History" button to the Projects screen header**

Locate:

```html
      <div class="header-right">
        <button class="dark-toggle" id="projects-dark-btn" aria-label="Toggle dark mode"></button>
        <button class="btn btn-ghost btn-sm" id="upload-new-btn">+ Upload Job</button>
      </div>
```

Replace with:

```html
      <div class="header-right">
        <button class="dark-toggle" id="projects-dark-btn" aria-label="Toggle dark mode"></button>
        <button class="btn btn-ghost btn-sm" id="ticket-history-btn">Ticket History</button>
        <button class="btn btn-ghost btn-sm" id="upload-new-btn">+ Upload Job</button>
      </div>
```

- [ ] **Step 2: Add the new screen markup**

Locate (the end of the Projects screen, right before the Upload screen comment):

```html
      <div id="projects-container" class="projects-grid"></div>
    </main>
  </div>

  <!-- ══════════════════════════════════
       UPLOAD SCREEN
  ══════════════════════════════════ -->
```

Replace with:

```html
      <div id="projects-container" class="projects-grid"></div>
    </main>
  </div>

  <!-- ══════════════════════════════════
       TICKET HISTORY SCREEN
  ══════════════════════════════════ -->
  <div id="ticket-history-screen" hidden>
    <header class="app-header">
      <div class="header-left">
        <button class="btn btn-ghost btn-sm" id="ticket-history-back-btn">← Projects</button>
        <span class="header-logo-badge">CNC</span>
        <div class="header-divider"></div>
        <div class="header-titles">
          <span class="header-file-title">Ticket History</span>
          <span id="ticket-history-count" class="header-job-name"></span>
        </div>
      </div>
    </header>
    <main class="content-main">
      <div class="filter-row">
        <div class="filter-search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="ticket-history-search" class="filter-search" placeholder="Search job name…">
        </div>
      </div>
      <div id="ticket-history-list" class="ticket-history-list"></div>
    </main>
  </div>

  <!-- ══════════════════════════════════
       UPLOAD SCREEN
  ══════════════════════════════════ -->
```

- [ ] **Step 3: Bump the CSS cache-busting version**

Locate:

```html
  <link rel="stylesheet" href="css/style.css?v=8">
```

Replace with:

```html
  <link rel="stylesheet" href="css/style.css?v=9">
```

- [ ] **Step 4: Append ticket history styles to `css/style.css`**

Add at the very end of the file:

```css

/* ── Ticket History ── */
.ticket-history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ticket-history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--white);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  padding: 14px 18px;
}
.ticket-history-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ticket-history-row-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--gray-800);
  overflow-wrap: break-word;
}
.ticket-history-row-meta {
  font-size: 12px;
  color: var(--gray-500);
}
.ticket-history-empty {
  color: var(--gray-500);
  padding: 24px 4px;
  text-align: center;
}
```

- [ ] **Step 5: Manual check — markup loads without breaking existing screens**

Run: `npm run serve` (from the repo root), open the printed local URL in a browser.
Expected: the Projects screen loads exactly as before, now with a "Ticket History" button in the header that does nothing yet (no click handler until Task 4). No console errors on page load.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add index.html css/style.css
git commit -m "Add Ticket History screen markup and styles"
```

---

### Task 4: Wire up the Ticket History screen

**Files:**
- Modify: `js/app.js` (DOM ref, event listeners, `showTicketHistoryScreen`, `renderTicketHistoryList`, `reprintTicket`, update `showProjectsScreen`)

**Interfaces:**
- Consumes: `Storage.loadTicketHistory()` (Task 1), `showTicketAndPrint(meta)` (Task 2), `#ticket-history-*` DOM elements (Task 3).

- [ ] **Step 1: Add the screen DOM reference**

Locate:

```js
const uploadScreen   = document.getElementById('upload-screen');
const projectsScreen = document.getElementById('projects-screen');
const contentScreen  = document.getElementById('content-screen');
```

Replace with:

```js
const uploadScreen        = document.getElementById('upload-screen');
const projectsScreen      = document.getElementById('projects-screen');
const contentScreen       = document.getElementById('content-screen');
const ticketHistoryScreen = document.getElementById('ticket-history-screen');
```

- [ ] **Step 2: Wire up the button and search listeners**

Locate:

```js
document.getElementById('back-to-projects-btn').addEventListener('click', () => {
  currentProject = null;
  showProjectsScreen();
});
document.getElementById('upload-new-btn').addEventListener('click', goToUpload);
```

Replace with:

```js
document.getElementById('back-to-projects-btn').addEventListener('click', () => {
  currentProject = null;
  showProjectsScreen();
});
document.getElementById('upload-new-btn').addEventListener('click', goToUpload);
document.getElementById('ticket-history-btn').addEventListener('click', showTicketHistoryScreen);
document.getElementById('ticket-history-back-btn').addEventListener('click', showProjectsScreen);
document.getElementById('ticket-history-search').addEventListener('input', renderTicketHistoryList);
```

- [ ] **Step 3: Make `showProjectsScreen` also hide the Ticket History screen**

Locate:

```js
function showProjectsScreen() {
  uploadScreen.hidden   = true;
  contentScreen.hidden  = true;
  projectsScreen.hidden = false;
  renderProjects();
}
```

Replace with:

```js
function showProjectsScreen() {
  uploadScreen.hidden        = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  projectsScreen.hidden      = false;
  renderProjects();
}
```

- [ ] **Step 4: Add the Ticket History screen functions**

Locate the end of `updateJobNoteBanner`:

```js
function updateJobNoteBanner() {
  const banner = document.getElementById('job-note-banner');
  const note   = currentProject ? Storage.getNote(noteKey(currentProject)) : null;
  banner.hidden = !note;
  if (note) document.getElementById('job-note-banner-text').textContent = note;
}
```

Insert directly after it:

```js

/* ══════════════════════════════════════════
   Ticket History
══════════════════════════════════════════ */
let ticketHistoryRecords    = [];
let ticketHistoryLoadFailed = false;

async function showTicketHistoryScreen() {
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = false;
  document.getElementById('ticket-history-search').value = '';
  const loaded = await Storage.loadTicketHistory();
  ticketHistoryLoadFailed = loaded === null;
  ticketHistoryRecords    = loaded || [];
  renderTicketHistoryList();
}

function renderTicketHistoryList() {
  const container = document.getElementById('ticket-history-list');

  if (ticketHistoryLoadFailed) {
    document.getElementById('ticket-history-count').textContent = '';
    container.innerHTML = '<p class="ticket-history-empty">Couldn’t load ticket history.</p>';
    return;
  }

  const query = document.getElementById('ticket-history-search').value.trim().toLowerCase();
  const filtered = query
    ? ticketHistoryRecords.filter(r => (r.jobName || '').toLowerCase().includes(query))
    : ticketHistoryRecords;

  document.getElementById('ticket-history-count').textContent =
    `${filtered.length} ticket${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    container.innerHTML = '<p class="ticket-history-empty">No ticket history yet.</p>';
    return;
  }

  container.innerHTML = filtered.map((r, i) => `
    <div class="ticket-history-row">
      <div class="ticket-history-row-info">
        <span class="ticket-history-row-name">${escHtml(r.jobName)}</span>
        <span class="ticket-history-row-meta">${r.sheetCount} sheet${r.sheetCount !== 1 ? 's' : ''} — completed ${escHtml(r.completedDate)}</span>
      </div>
      <button class="btn btn-ghost btn-sm ticket-history-print-btn" data-index="${i}">Print</button>
    </div>
  `).join('');

  container.querySelectorAll('.ticket-history-print-btn').forEach(btn => {
    btn.addEventListener('click', () => reprintTicket(filtered[Number(btn.dataset.index)]));
  });
}

function reprintTicket(record) {
  showTicketAndPrint(record);
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check "js/app.js"`
Expected: no output, exit 0.

- [ ] **Step 6: Manual check — screen navigation and empty state**

Run: `npm run serve`, open in browser.
Expected: clicking "Ticket History" on the Projects screen shows the new screen with "No ticket history yet." (since no jobs have been exported through the new code yet) and a "0 tickets" count. Clicking "← Projects" returns to the Projects directory. No console errors.

- [ ] **Step 7: Commit**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add js/app.js
git commit -m "Wire up Ticket History screen: browse, search, and reprint"
```

---

### Task 5: Live verification (production)

No code changes — this is the final confirmation that everything works together against the real, deployed app. There's no scratch Firestore project for this app, so this necessarily runs against production; use an obviously-labeled test job (not real shop data) the same way "Debug Test" was used to verify the archive endpoint earlier.

- [ ] **Step 1: Push to deploy**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git push
```

Confirm the GitHub Pages deploy actually lands (check `gh run list` if unsure, per the lesson learned earlier this session about stuck Pages builds) before testing on the live URL.

- [ ] **Step 2: Verify the print-timing fix**

On the live site, upload a small test job (2-3 sheets is enough), mark them complete, and export. Confirm the print dialog now appears reliably — this is the scenario that was silently failing before (a real network round-trip to the Master Job Log happens between the click and where printing used to fire).

- [ ] **Step 3: Verify the history record was saved and is reprintable**

After exporting (and confirming the delete-project prompt, same as before), click "Ticket History" from the Projects screen. Confirm the just-exported job appears at the top of the list with the correct sheet count and date. Click "Print" on it and confirm the print dialog opens with the same ticket content — this proves reprinting works independent of the job still existing.

- [ ] **Step 4: Verify search filtering**

Type part of the test job's name into the Ticket History search box. Confirm the list filters down to matching entries and the count updates. Clear the search and confirm the full list returns.

- [ ] **Step 5: Confirm nothing else regressed**

Spot-check: CSV still downloads on export, the Master Job Log still receives the row (check the spreadsheet), and the delete-project confirmation still appears and still works.
