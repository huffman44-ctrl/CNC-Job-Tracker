# Delete Single Sheet From a Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator delete a single sheet from a project (instead of only the whole project) from either the sidebar or the sheet detail panel.

**Architecture:** One new function, `deleteSheetFromProject(sheet)`, added to `js/app.js` next to the existing `deleteProject()`. It deletes the sheet's Firestore-backed records via the existing `Storage` API, removes it from the in-memory `sheets` array, and re-renders. Two UI entry points (sidebar trash icon, detail-header button) both call this same function.

**Tech Stack:** Vanilla JS, no build step, no test framework. This repo has no automated test runner (confirmed via `package.json` — the only script is `serve`), so verification for every step here is manual, in a browser, against a **local offline copy** — never the live Firestore config. Per `CLAUDE.md`'s testing-safety section, `initApp()` (`js/app.js` ~line 850) skips Firebase entirely and runs in-memory-only when `FIREBASE_CONFIG.projectId` starts with `"PASTE"`.

## Global Constraints
- Never run or test against the real `js/firebase-config.js` — it points at the live production Firestore project `cnc-job-tracker`. All manual verification below happens in an offline temp copy.
- `master` auto-deploys live via GitHub Pages — do not push to `master` until the feature is verified working.
- No new modal: sheet deletion is confirmed with the native `confirm()` dialog, matching the existing project-delete pattern.
- No renumbering logic: sheet display order/number comes from `sheetNumber()` parsing the filename and is unaffected by deleting a different sheet.

## One-Time Manual Test Environment Setup

Do this once, before verifying Task 1:

- [ ] **Step 1: Create an offline test copy of the app**

```bash
cp -r "c:/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" "c:/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp_offline_test"
```

- [ ] **Step 2: Point the copy's Firebase config at a disabled project**

Edit `CNC_WebApp_offline_test/js/firebase-config.js` and change the `projectId` value to `"PASTE_DISABLED"` (any string starting with `"PASTE"` works — `initApp()` checks for that prefix and falls back to in-memory-only mode, so nothing touches production).

- [ ] **Step 3: Serve the offline copy and confirm it loads in-memory-only**

```bash
cd "c:/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp_offline_test"
npx serve .
```

Open the printed local URL in a browser. Open the browser devtools console — you should NOT see any Firestore network errors or writes; the app should reach the projects/upload screen normally. Upload the tracked sample file at the repo root, `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html`, plus at least one more sheet from `samples/` (or a renamed copy of the same file, e.g. `..._Sheet 10.html`) so a project with 2+ sheets exists for testing. Keep this server running for both tasks below.

---

### Task 1: Core delete function + sidebar trash-icon entry point

**Files:**
- Modify: `js/app.js:351` (insert new function directly after `deleteProject()`, which ends at line 351)
- Modify: `js/app.js:544-583` (`buildSheetNavRow()` — add delete button)
- Modify: `css/style.css` (add `.nav-row-delete` rules after the `.nav-row-note` block, currently ending at line 1422)

**Interfaces:**
- Consumes: `Storage.deleteSheet(fileKey)`, `Storage.clear(fileKey, 'sheet')`, `Storage.setSheetNote(fileKey, text)` (all existing, from `js/storage.js`); module-level `sheets` array (`js/app.js:32`); `currentProject` (`js/app.js:33`); `selectedSheetKey` (`js/app.js:36`); `projectKey(sheet)` (`js/app.js:247`); `showProjectsScreen()` (`js/app.js:216`); `renderAllSheets()` (`js/app.js:501`).
- Produces: `async function deleteSheetFromProject(sheet)` — takes a sheet object (must have `.fileKey`, `.sheetTitle`, `.fileName`). Later tasks (Task 2) call this exact function by this exact name.

- [ ] **Step 1: Add `deleteSheetFromProject()` to `js/app.js`**

Open `js/app.js` and find `deleteProject()`, which currently reads (lines 338-351):

```js
async function deleteProject(jobName) {
  const projectSheets = sheets.filter(s => projectKey(s) === jobName);
  await Promise.all(projectSheets.flatMap(s => [
    Storage.deleteSheet(s.fileKey),
    Storage.clear(s.fileKey, 'sheet'),
    Storage.setSheetNote(s.fileKey, ''),
  ]));
  sheets = sheets.filter(s => projectKey(s) !== jobName);
  if (!sheets.length) {
    goToUpload();
  } else {
    renderProjects();
  }
}
```

Immediately after this function's closing `}`, insert:

```js

async function deleteSheetFromProject(sheet) {
  const label = sheet.sheetTitle || sheet.fileName;
  if (!confirm(`Delete "${label}"? This removes its completion record and note for everyone.`)) return;

  await Promise.all([
    Storage.deleteSheet(sheet.fileKey),
    Storage.clear(sheet.fileKey, 'sheet'),
    Storage.setSheetNote(sheet.fileKey, ''),
  ]);

  sheets = sheets.filter(s => s.fileKey !== sheet.fileKey);

  const remaining = currentProject ? sheets.filter(s => projectKey(s) === currentProject) : sheets;
  if (!remaining.length) {
    showProjectsScreen();
    return;
  }

  if (selectedSheetKey === sheet.fileKey) selectedSheetKey = null;
  renderAllSheets();
}
```

- [ ] **Step 2: Add the trash-icon button to `buildSheetNavRow()`**

Find `buildSheetNavRow()` (`js/app.js:544-583`). It currently ends:

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

  row.addEventListener('click', () => {
    selectedSheetKey = sheet.fileKey;
    renderAllSheets();
  });

  return row;
}
```

Replace it with (adds a delete button between the status dot and the closing click handler):

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

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'nav-row-delete';
  deleteBtn.setAttribute('aria-label', 'Delete sheet');
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteSheetFromProject(sheet);
  });
  row.appendChild(deleteBtn);

  row.addEventListener('click', () => {
    selectedSheetKey = sheet.fileKey;
    renderAllSheets();
  });

  return row;
}
```

- [ ] **Step 3: Add `.nav-row-delete` styles to `css/style.css`**

Find the `.nav-row-note` block (`css/style.css:1413-1422`):

```css
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

Immediately after it, insert:

```css

/* ── Sidebar delete button ── */
.nav-row-delete {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  color: var(--gray-300);
  width: 22px;
  height: 22px;
  border-radius: 6px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.nav-row-delete:hover {
  background: rgba(225,29,47,0.12);
  border-color: rgba(225,29,47,0.35);
  color: var(--red);
}
.nav-row-delete svg {
  width: 13px;
  height: 13px;
  pointer-events: none;
}
```

- [ ] **Step 4: Manual verification in the offline test copy**

If the `npx serve .` from the one-time setup isn't still running, restart it in `CNC_WebApp_offline_test`. Refresh the browser tab (hard refresh to bypass cache) and open the test project with 2+ sheets.

Verify:
1. Each row in the sheet sidebar shows a small trash icon on the right.
2. Click the trash icon on a sheet that is **not** currently selected/open. A native confirm dialog appears with the sheet's title in the message. Click Cancel — nothing changes.
3. Click it again and click OK. The sheet disappears from the sidebar immediately, the sheet count in the header decreases by one, and whichever sheet was open stays open (selection unaffected).
4. Click the trash icon on the sheet that IS currently open/selected, confirm. The detail panel switches to a different remaining sheet (no blank/broken state).
5. Delete sheets down to the last one in the project, confirm the final delete. The app navigates back to the projects directory screen automatically (this project either disappears from the list or shows 0 sheets — whichever the app already does for an empty project).
6. Open browser devtools console throughout — no errors.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/style.css
git commit -m "$(cat <<'EOF'
Add sidebar delete button for individual sheets

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Detail-header "Delete Sheet" button

**Files:**
- Modify: `js/app.js:613-623` (`buildSheetDetail()` hero header — add delete button)
- Modify: `css/style.css` (add `.detail-delete-btn` hover override near the `.detail-filename` block, currently at line 1373-1377)

**Interfaces:**
- Consumes: `deleteSheetFromProject(sheet)` from Task 1 (exact name, takes the sheet object).
- Produces: nothing new consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the delete button to `buildSheetDetail()`'s hero header**

Find this block in `js/app.js` (currently lines 613-623):

```js
  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'btn btn-ghost btn-sm';
  noteBtn.textContent = Storage.getSheetNote(sheet.fileKey) ? 'Edit Note' : 'Add Note';
  noteBtn.addEventListener('click', e => {
    e.stopPropagation();
    openSheetNoteModal(sheet);
  });
  heroTop.appendChild(noteBtn);

  hero.appendChild(heroTop);
```

Replace it with:

```js
  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'btn btn-ghost btn-sm';
  noteBtn.textContent = Storage.getSheetNote(sheet.fileKey) ? 'Edit Note' : 'Add Note';
  noteBtn.addEventListener('click', e => {
    e.stopPropagation();
    openSheetNoteModal(sheet);
  });
  heroTop.appendChild(noteBtn);

  const deleteSheetBtn = document.createElement('button');
  deleteSheetBtn.type = 'button';
  deleteSheetBtn.className = 'btn btn-ghost btn-sm detail-delete-btn';
  deleteSheetBtn.textContent = 'Delete Sheet';
  deleteSheetBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteSheetFromProject(sheet);
  });
  heroTop.appendChild(deleteSheetBtn);

  hero.appendChild(heroTop);
```

- [ ] **Step 2: Add `.detail-delete-btn` hover styling to `css/style.css`**

Find the `.detail-filename` block (`css/style.css:1373-1377`):

```css
.detail-filename {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  margin-top: 3px;
}
```

Immediately after it, insert:

```css

.detail-delete-btn:hover {
  background: rgba(225,29,47,0.55);
  border-color: rgba(225,29,47,0.7);
  color: #fca5a5;
}
```

- [ ] **Step 3: Manual verification in the offline test copy**

Hard-refresh the browser tab pointed at the offline copy (same server from Task 1, still running). Open a project.

Verify:
1. The open sheet's detail panel header shows a "Delete Sheet" button next to "Add Note"/"Edit Note", and it turns red-tinted on hover.
2. Click it — the same confirm dialog from Task 1 appears with this sheet's title.
3. Cancel — nothing changes. Confirm — the sheet is removed, sidebar count updates, and the panel now shows a different remaining sheet.
4. Repeat down to the last sheet in the project — confirms the app returns to the projects directory, matching Task 1's Step 4.5 behavior.
5. No console errors.

- [ ] **Step 4: Commit**

```bash
git add js/app.js css/style.css
git commit -m "$(cat <<'EOF'
Add Delete Sheet button to sheet detail header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After Both Tasks

Once both tasks are verified in the offline copy:
- [ ] Delete the offline test copy directory (`CNC_WebApp_offline_test`) — it was scratch-only, never committed.
- [ ] Confirm `git status` in the real project shows only the intended `js/app.js` / `css/style.css` changes plus this plan/spec, nothing from the offline copy.
- [ ] Ask the user before pushing to `master`, since `master` is a live deploy (per `CLAUDE.md`).
