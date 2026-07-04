# Per-Sheet Instruction Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Travis can attach a read-only instruction note to each sheet in a project (shown as a prominent callout in the sheet detail), the job note stays visible inside the sheet view, and all notes are written from an expanded editor on the project card — per the approved spec `docs/superpowers/specs/2026-07-03-sheet-notes-design.md`.

**Architecture:** New `sheetNotes/{fileKey}` Firestore collection accessed through four new `Storage` functions copied from the existing `projectNotes` pattern (in-memory cache, cache-first async writes, `onSnapshot` live sync). UI work is confined to `js/app.js` (modal builder, sheet detail callout, nav icon, job-note banner), `index.html` (modal container + banner element), and `css/style.css`.

**Tech Stack:** Vanilla JS (no build step, no framework), Firebase compat SDK v10.12.0, Firestore. No test framework exists in this repo — verification is browser click-through against an offline copy (see Global Constraints).

## Global Constraints

- **NEVER run the app from the repo directory.** `js/firebase-config.js` points at the live production Firestore (`cnc-job-tracker`) used by real operators. All browser testing happens in the offline test copy created in Task 1, whose `firebase-config.js` has `projectId: "PASTE_DISABLED"` — `initApp()` then skips Firebase entirely and everything stays in-memory (per repo CLAUDE.md).
- In-memory mode means state resets on page reload. Each verification scenario re-uploads the test sheet files first; persistence-across-reload is NOT testable offline and is not part of any verification step.
- No frameworks, no npm dependencies, no build step. Follow existing code style in each file (2-space indent, section banner comments, `escHtml`/`textContent` for user text).
- Operator-facing views (sheet nav, sheet detail, job-note banner) must contain **no edit controls for instruction notes** — read-only display only. Editing happens exclusively via the project card's notes modal.
- All user-entered note text must be rendered with `textContent` (never `innerHTML` interpolation).
- Repo path: `C:\Users\Golden Boys\Documents\Agemtic Workflows\CNC_WebApp`. Commit after every task with the exact messages given; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Shell is Windows PowerShell 5.1 — no `&&` chaining; use `;`.

---

### Task 1: Offline test harness + `Storage` sheet-notes API

**Files:**
- Create: `<scratchpad>\cnc-test\refresh.ps1` (scratchpad = the session scratchpad directory; any temp dir outside the repo works)
- Modify: `js/storage.js` (cache declaration ~line 11, new section after Project Notes ~line 108, export ~line 178)
- Modify: `js/app.js` (`initApp()` ~line 957 and ~line 973)

**Interfaces:**
- Consumes: existing `Storage` IIFE structure; `db` Firestore handle; `projectNotes` pattern at `js/storage.js:66-108`.
- Produces (later tasks rely on these exact names):
  - `Storage.getSheetNote(fileKey) → string | null` — synchronous cache read
  - `Storage.setSheetNote(fileKey, text) → Promise<void>` — trims; empty/whitespace text deletes the doc and cache entry
  - `Storage.loadSheetNotes() → Promise<void>` — initial cache fill
  - `Storage.onSheetNoteChange(callback)` — live listener, rebuilds cache then calls callback

- [ ] **Step 1: Create the offline test copy refresh script**

Create `refresh.ps1` in a `cnc-test` folder under the scratchpad directory with this content (adjust `$dest` to the actual scratchpad path):

```powershell
$src  = 'C:\Users\Golden Boys\Documents\Agemtic Workflows\CNC_WebApp'
$dest = Join-Path $PSScriptRoot 'app'
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "$src\index.html" $dest -Force
Copy-Item "$src\css" $dest -Recurse -Force
Copy-Item "$src\js" $dest -Recurse -Force
# Neutralize Firebase: PASTE prefix makes initApp() skip Firebase entirely
Set-Content -Path "$dest\js\firebase-config.js" -Encoding utf8 -Value 'const FIREBASE_CONFIG = { projectId: "PASTE_DISABLED" };'
Write-Output "Offline copy refreshed at $dest"
```

- [ ] **Step 2: Create multi-sheet test fixtures**

The repo has one tracked sample: `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html`. Make three copies of it in the `cnc-test` folder (NOT in the repo) named so they parse as one project with three numerically ordered sheets (`fileKey` is a hash of the filename, so each copy is a distinct sheet; they share the same `#jobtitle` so they group into one project):

```powershell
$sample = 'C:\Users\Golden Boys\Documents\Agemtic Workflows\CNC_WebApp\260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html'
$fix = Join-Path $PSScriptRoot 'fixtures'   # run from the cnc-test folder
New-Item -ItemType Directory -Force $fix | Out-Null
Copy-Item $sample "$fix\Test_Job_Sheet 1.html"
Copy-Item $sample "$fix\Test_Job_Sheet 2.html"
Copy-Item $sample "$fix\Test_Job_Sheet 3.html"
```

- [ ] **Step 3: Run the refresh script and verify the harness works**

Run: `powershell -File <scratchpad>\cnc-test\refresh.ps1`, then serve the copy (`npx serve <scratchpad>\cnc-test\app` or the preview tooling) and open it in a browser.
Expected: app loads past the spinner straight to the upload screen; browser console shows `Running without Firebase: Firebase config not set`; NO network requests to `firestore.googleapis.com`. Upload the three fixture files → projects screen shows one project with 3 sheets.

- [ ] **Step 4: Add the sheet-notes cache and functions to `js/storage.js`**

At line 11, alongside the existing caches, add:

```js
  const sheetNotesCache = {};  // { [fileKey]: string }
```

After the Project Notes section (after `onNoteChange`, before `/* ── Sheets ── */`), add:

```js
  /* ── Sheet Notes (per-sheet instruction notes) ── */

  function getSheetNote(fileKey) {
    return sheetNotesCache[fileKey] || null;
  }

  async function setSheetNote(fileKey, text) {
    const trimmed = (text || '').trim();
    if (trimmed) {
      sheetNotesCache[fileKey] = trimmed;
    } else {
      delete sheetNotesCache[fileKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('sheetNotes').doc(fileKey).set({ text: trimmed });
      } else {
        await db.collection('sheetNotes').doc(fileKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setSheetNote failed:', e);
    }
  }

  async function loadSheetNotes() {
    if (!db) return;
    try {
      const snap = await db.collection('sheetNotes').get();
      snap.forEach(doc => { sheetNotesCache[doc.id] = doc.data().text; });
    } catch (e) {
      console.warn('Firestore loadSheetNotes failed:', e);
    }
  }

  function onSheetNoteChange(callback) {
    if (!db) return;
    db.collection('sheetNotes').onSnapshot(snap => {
      Object.keys(sheetNotesCache).forEach(k => delete sheetNotesCache[k]);
      snap.forEach(doc => { sheetNotesCache[doc.id] = doc.data().text; });
      callback();
    }, err => console.warn('Firestore sheetNotes listener error:', err));
  }
```

Extend the return statement (line 178) to also export the four new functions:

```js
  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, saveSheet, loadSheets, deleteSheet, clearSheets, clearAllCompletions };
```

- [ ] **Step 5: Wire loading and live sync into `initApp()` in `js/app.js`**

In the `Promise.all` (~line 957) add `Storage.loadSheetNotes(),` after `Storage.loadNotes(),`:

```js
    const [storedSheets] = await Promise.all([
      Storage.loadSheets(),
      Storage.loadCompletions(),
      Storage.loadNotes(),
      Storage.loadSheetNotes(),
    ]);
```

After the existing `Storage.onNoteChange(...)` block (~line 975) add:

```js
    Storage.onSheetNoteChange(() => {
      if (!projectsScreen.hidden) renderProjects();
      if (!contentScreen.hidden)  renderAllSheets();
    });
```

- [ ] **Step 6: Verify in the offline copy**

Re-run `refresh.ps1`, hard-reload the served page (Ctrl+Shift+R), upload the three fixtures, then in the browser console run:

```js
Storage.getSheetNote('nope')                       // → null
Storage.setSheetNote('k1', '  hello  ')
Storage.getSheetNote('k1')                         // → "hello" (trimmed)
Storage.setSheetNote('k1', '   ')
Storage.getSheetNote('k1')                         // → null (empty deletes)
```

Expected: exactly those return values, no console errors (offline mode exercises the cache path; the Firestore path is the same code shape as the proven `projectNotes` functions).

- [ ] **Step 7: Commit**

```powershell
git add js/storage.js js/app.js
git commit -m "Add sheetNotes storage API with cache, load, and live sync"
```

---

### Task 2: Expanded notes editor on the project card

**Files:**
- Modify: `index.html` (notes modal, lines 202-214)
- Modify: `js/app.js` (`openNotesModal` ~line 818, `saveNote` ~line 831)
- Modify: `css/style.css` (append to the notes-modal area near `.form-textarea--tall`, ~line 1206)

**Interfaces:**
- Consumes: `Storage.getSheetNote(fileKey)`, `Storage.setSheetNote(fileKey, text)` from Task 1; existing `sheets` array, `projectKey(sheet)`, `sheetNumber(fileName)`, `noteKey(jobName)`, `notesCtx`.
- Produces: notes modal now edits the job note AND one textarea per sheet (`#notes-modal-sheets textarea[data-file-key]`). No new names consumed by later tasks.

- [ ] **Step 1: Restructure the notes modal markup in `index.html`**

Replace the modal's current `.modal-form` block (lines 206-208):

```html
      <div class="modal-form">
        <textarea id="notes-modal-text" class="form-input form-textarea form-textarea--tall" placeholder="Add notes for this project…"></textarea>
      </div>
```

with:

```html
      <div class="modal-form notes-modal-form">
        <div class="form-group">
          <label class="form-label" for="notes-modal-text">Job Note</label>
          <textarea id="notes-modal-text" class="form-input form-textarea form-textarea--tall" placeholder="Add notes for this project…"></textarea>
        </div>
        <div id="notes-modal-sheets"></div>
      </div>
```

- [ ] **Step 2: Build per-sheet fields in `openNotesModal` in `js/app.js`**

Replace the whole function:

```js
function openNotesModal(jobName) {
  notesCtx = { jobName };
  document.getElementById('notes-modal-subtitle').textContent = jobName;
  document.getElementById('notes-modal-text').value = Storage.getNote(noteKey(jobName)) || '';

  const sheetsWrap = document.getElementById('notes-modal-sheets');
  sheetsWrap.innerHTML = '';
  const projectSheets = sheets
    .filter(s => projectKey(s) === jobName)
    .sort((a, b) => sheetNumber(a.fileName) - sheetNumber(b.fileName));
  if (projectSheets.length) {
    const heading = document.createElement('div');
    heading.className = 'notes-modal-section-label';
    heading.textContent = 'Sheet Notes';
    sheetsWrap.appendChild(heading);
  }
  for (const sheet of projectSheets) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = sheet.sheetTitle || sheet.fileName;
    const ta = document.createElement('textarea');
    ta.className = 'form-input form-textarea';
    ta.placeholder = 'Add a note for this sheet…';
    ta.dataset.fileKey = sheet.fileKey;
    ta.value = Storage.getSheetNote(sheet.fileKey) || '';
    group.appendChild(label);
    group.appendChild(ta);
    sheetsWrap.appendChild(group);
  }

  notesOverlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('notes-modal-text').focus(), 50);
}
```

- [ ] **Step 3: Save sheet notes in `saveNote` in `js/app.js`**

Replace the whole function (writes only changed sheet notes; `setSheetNote` trims, so compare trimmed):

```js
async function saveNote() {
  if (!notesCtx) return;
  const text = document.getElementById('notes-modal-text').value;
  const writes = [Storage.setNote(noteKey(notesCtx.jobName), text)];
  document.querySelectorAll('#notes-modal-sheets textarea').forEach(ta => {
    const existing = Storage.getSheetNote(ta.dataset.fileKey) || '';
    if (ta.value.trim() !== existing) {
      writes.push(Storage.setSheetNote(ta.dataset.fileKey, ta.value));
    }
  });
  await Promise.all(writes);
  closeNotesModal();
  renderProjects();
}
```

- [ ] **Step 4: Add modal CSS to `css/style.css`**

Append after the `.form-textarea--tall` rule (~line 1206):

```css
/* ── Notes modal: per-sheet note fields ── */
.notes-modal-form {
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 4px;
}
.notes-modal-section-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gray-400);
  border-top: 1px solid var(--gray-200);
  padding-top: 14px;
  margin-bottom: 10px;
}
#notes-modal-sheets .form-group { margin-bottom: 12px; }
#notes-modal-sheets .form-textarea { min-height: 48px; }
```

- [ ] **Step 5: Verify in the offline copy**

Re-run `refresh.ps1`, hard-reload, upload the three fixtures, then on the projects screen click **Add Note** on the project card and check:
1. Modal shows "Job Note" textarea, a "SHEET NOTES" divider, and three labelled sheet textareas in 1-2-3 order.
2. Type a job note and notes into sheets 1 and 3 → Save → card shows "Edit Note" and the job-note preview.
3. Re-open the modal → all three values persisted exactly (sheet 2 empty).
4. Clear sheet 1's text → Save → re-open → sheet 1 empty, sheet 3 intact.
5. Cancel after typing garbage → re-open → garbage NOT saved.

Expected: all five pass, no console errors.

- [ ] **Step 6: Commit**

```powershell
git add index.html js/app.js css/style.css
git commit -m "Expand project notes modal with per-sheet note fields"
```

---

### Task 3: Read-only note callout in sheet detail + sidebar note icons

**Files:**
- Modify: `js/app.js` (`buildSheetDetail` ~line 600 right after `wrap.appendChild(hero);`, and `buildSheetNavRow` ~line 543 where `dotEl` is appended)
- Modify: `css/style.css` (append after the `.detail-filename` rule, ~line 1358)

**Interfaces:**
- Consumes: `Storage.getSheetNote(fileKey)` from Task 1; `buildSheetDetail`/`buildSheetNavRow` structure; detail-body band pattern (full-width, `padding: 14px 20px`, `border-bottom`).
- Produces: `.sheet-note-callout` band and `.nav-row-note` icon, both render-only (rebuilt on every `renderAllSheets()`, so the Task 1 listener keeps them live). No edit controls anywhere.

- [ ] **Step 1: Add the callout to `buildSheetDetail` in `js/app.js`**

Directly after `wrap.appendChild(hero);` (before the `materialInfo` block), insert:

```js
  /* ── Instruction note (read-only, written from the project card) ── */
  const noteText = Storage.getSheetNote(sheet.fileKey);
  if (noteText) {
    const callout = document.createElement('div');
    callout.className = 'sheet-note-callout';
    callout.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <div class="sheet-note-callout-body">
        <div class="sheet-note-callout-label">Note</div>
        <div class="sheet-note-callout-text"></div>
      </div>`;
    callout.querySelector('.sheet-note-callout-text').textContent = noteText;
    wrap.appendChild(callout);
  }
```

(The static icon/label go through `innerHTML`; the user-entered note text is set via `textContent` — required by Global Constraints.)

- [ ] **Step 2: Add the note icon to `buildSheetNavRow` in `js/app.js`**

Replace the two lines that append the dot:

```js
  row.appendChild(numEl);
  row.appendChild(textWrap);
  row.appendChild(dotEl);
```

with:

```js
  row.appendChild(numEl);
  row.appendChild(textWrap);
  if (Storage.getSheetNote(sheet.fileKey)) {
    const noteIcon = document.createElement('span');
    noteIcon.className = 'nav-row-note';
    noteIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    row.appendChild(noteIcon);
  }
  row.appendChild(dotEl);
```

- [ ] **Step 3: Add CSS to `css/style.css`**

Append after `.detail-filename` (~line 1358), following the detail-band pattern (`padding: 14px 20px`, `border-bottom`):

```css
/* ── Sheet instruction note callout (read-only) ── */
.sheet-note-callout {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 20px;
  background: var(--gold-light);
  border-bottom: 1px solid var(--gray-200);
  border-left: 4px solid var(--gold);
}
.sheet-note-callout > svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--gold);
  margin-top: 2px;
}
.sheet-note-callout-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 2px;
}
.sheet-note-callout-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-800);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* ── Sidebar note icon ── */
.nav-row-note {
  display: flex;
  flex-shrink: 0;
}
.nav-row-note svg {
  width: 13px;
  height: 13px;
  color: var(--gold);
}
```

- [ ] **Step 4: Verify in the offline copy**

Re-run `refresh.ps1`, hard-reload, upload fixtures, add notes to sheets 1 and 3 via the project card modal, open the project, and check:
1. Sheets 1 and 3 show the gold note icon in the sidebar; sheet 2 does not.
2. Selecting sheet 1 shows the amber "NOTE" callout directly under the hero header, above the material strip, with the exact note text; sheet 2 shows no callout.
3. The callout and detail panel contain no edit button for the note anywhere.
4. A multi-line note renders its line breaks (white-space: pre-wrap).
5. Toggle dark mode → callout stays legible (gold-light token flips to its dark value).
6. Edit sheet 1's note from the project card again → reopen project → callout shows the new text (re-render path).

Expected: all six pass, no console errors.

- [ ] **Step 5: Commit**

```powershell
git add js/app.js css/style.css
git commit -m "Show read-only sheet note callout in detail and note icons in nav"
```

---

### Task 4: Job-note banner in the sheet view

**Files:**
- Modify: `index.html` (content screen, between the `.progress-strip` div ending at line 129 and `<main ...>` at line 131)
- Modify: `js/app.js` (new `updateJobNoteBanner()` near `showContentScreen` ~line 211; call it from `showContentScreen`; update the `onNoteChange` listener in `initApp` ~line 973)
- Modify: `css/style.css` (append after the `.progress-label` area — put it with the new note styles from Task 3)

**Interfaces:**
- Consumes: `Storage.getNote(noteKey(jobName))` (existing), `currentProject` state variable.
- Produces: `updateJobNoteBanner()` — safe to call any time; hides the banner when there's no current project or no note. Read-only: the banner has no click handlers.

- [ ] **Step 1: Add the banner element to `index.html`**

Between the closing `</div>` of `.progress-strip` (line 129) and `<main class="content-main content-main--wide">` (line 131), insert:

```html
    <div id="job-note-banner" class="job-note-banner" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <span id="job-note-banner-text"></span>
    </div>
```

- [ ] **Step 2: Add `updateJobNoteBanner()` and call it from `showContentScreen` in `js/app.js`**

After the `showContentScreen` function, add:

```js
function updateJobNoteBanner() {
  const banner = document.getElementById('job-note-banner');
  const note   = currentProject ? Storage.getNote(noteKey(currentProject)) : null;
  banner.hidden = !note;
  if (note) document.getElementById('job-note-banner-text').textContent = note;
}
```

Inside `showContentScreen`, before `renderAllSheets();`, add:

```js
  updateJobNoteBanner();
```

- [ ] **Step 3: Update the `onNoteChange` listener in `initApp`**

Replace:

```js
    Storage.onNoteChange(() => {
      if (!projectsScreen.hidden) renderProjects();
    });
```

with:

```js
    Storage.onNoteChange(() => {
      if (!projectsScreen.hidden) renderProjects();
      if (!contentScreen.hidden)  updateJobNoteBanner();
    });
```

- [ ] **Step 4: Add CSS to `css/style.css`**

Append after the `.nav-row-note svg` rule from Task 3:

```css
/* ── Job note banner (content screen, read-only) ── */
.job-note-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 20px;
  background: var(--orange-light);
  border-bottom: 1px solid var(--gray-200);
}
.job-note-banner svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--orange);
  margin-top: 2px;
}
#job-note-banner-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--gray-800);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
```

(Orange = job-level note, matching the project-card preview; gold = sheet-level note. The two levels stay visually distinct.)

- [ ] **Step 5: Verify in the offline copy**

Re-run `refresh.ps1`, hard-reload, upload fixtures, and check:
1. With no job note: open the project → no banner (element stays `hidden`).
2. Back to projects → add a job note → open the project → orange banner appears under the progress strip, above the workspace, showing the note.
3. The banner persists while switching between sheets 1/2/3.
4. The banner has no edit affordance (not clickable, no button).
5. Dark mode → banner legible.

Expected: all five pass, no console errors.

- [ ] **Step 6: Commit**

```powershell
git add index.html js/app.js css/style.css
git commit -m "Show read-only job note banner in the sheet view"
```

---

### Task 5: Cleanup on delete, cache-bust, full regression pass

**Files:**
- Modify: `js/app.js` (`deleteProject` ~line 318, `resetToUpload` ~line 175)
- Modify: `index.html` (lines 9 and 216-219: `?v=5` → `?v=6`)

**Interfaces:**
- Consumes: `Storage.setSheetNote(fileKey, '')` (empty text = delete) from Task 1.
- Produces: nothing new — final integration task.

- [ ] **Step 1: Delete sheet notes when a project is deleted**

In `deleteProject`, replace the `Promise.all` with:

```js
  await Promise.all(projectSheets.flatMap(s => [
    Storage.deleteSheet(s.fileKey),
    Storage.clear(s.fileKey, 'sheet'),
    Storage.setSheetNote(s.fileKey, ''),
  ]));
```

- [ ] **Step 2: Delete all sheet notes on "New Job" reset**

In `resetToUpload`, replace:

```js
  await Promise.all([Storage.clearSheets(), Storage.clearAllCompletions()]);
```

with:

```js
  await Promise.all([
    Storage.clearSheets(),
    Storage.clearAllCompletions(),
    ...sheets.map(s => Storage.setSheetNote(s.fileKey, '')),
  ]);
```

- [ ] **Step 3: Bump cache-busting query strings in `index.html`**

Change `css/style.css?v=5` (line 9) and all four `js/*.js?v=5` script tags (lines 216-219) to `?v=6`.

- [ ] **Step 4: Full regression click-through in the offline copy**

Re-run `refresh.ps1`, hard-reload, then run the whole spec scenario end-to-end:
1. Upload the three fixtures → one project, 3 sheets.
2. Project card → Add Note → set job note + notes on sheets 1 and 3 → Save.
3. Open project: job banner shows; sheets 1/3 have nav icons; callouts correct per sheet; sheet 2 clean.
4. **Operator flow untouched:** Mark In Progress → Mark Complete on sheet 1 (modal with date/operator/completion-notes works, completion note saves independently of the instruction note — both visible: callout still shows the instruction note on the completed sheet).
5. Clear Record on sheet 1 → instruction note callout still present (clearing a completion must NOT touch the instruction note).
6. Export CSV → CSV contains the completion notes column, NOT instruction notes; decline the delete-after-export confirm.
7. Delete the project from the directory → in console: `Storage.getSheetNote(<a fixture fileKey>)` → `null` (grab a fileKey earlier via `sheets[0].fileKey`).
8. Re-upload fixtures, add a sheet note, use header "New Job" reset → confirm → console check again → `null`.
9. Dark mode toggle across projects + content screens → all new elements legible.

Expected: every step passes, console free of errors throughout.

- [ ] **Step 5: Update repo CLAUDE.md status section**

In `CLAUDE.md`, add to the Architecture storage bullet list (after the `projectNotes` line):

```markdown
  - `sheetNotes/{fileKey}` — per-sheet instruction note `{ text }`, written by Travis from the project card's notes modal; rendered read-only in the sheet detail (callout) and sheet nav (icon) (`getSheetNote`/`setSheetNote`/`loadSheetNotes`/`onSheetNoteChange`)
```

And under "### Working" in the status section, add:

```markdown
- Per-sheet instruction notes (Travis → operator, read-only in sheet view) + job-note banner in sheet view; both live-synced
```

- [ ] **Step 6: Commit**

```powershell
git add js/app.js index.html CLAUDE.md
git commit -m "Clean up sheet notes on delete/reset, bump cache to v6, update docs"
```
