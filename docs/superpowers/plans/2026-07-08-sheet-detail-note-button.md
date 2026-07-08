# Sheet Detail Note Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second entry point for editing a sheet's instruction note directly from the sheet detail panel's hero header, alongside the existing project-card notes modal path.

**Architecture:** A new "Add Note"/"Edit Note" button is added to `detail-hero-top` in `buildSheetDetail()` (`js/app.js`). It opens a new dedicated modal (`sheet-note-overlay` in `index.html`, following the exact pattern of the existing `notes-overlay`/`modal-overlay` modals). Save/Cancel wiring reuses the existing `Storage.getSheetNote`/`Storage.setSheetNote` API untouched — no storage changes. After save, `renderAllSheets()` rebuilds the detail panel and sidebar so the button label, callout, and nav icon all update together.

**Tech Stack:** Vanilla JS (no framework, no build step), Firestore (via `js/storage.js`), plain CSS. No test runner exists in this repo — all verification in this plan is manual, using the offline `PASTE`-projectId escape hatch documented in `CLAUDE.md` (never test against the live production Firebase config).

## Global Constraints

- Never point the app at the real `js/firebase-config.js` while testing — copy to a temp dir and swap in a `PASTE`-prefixed `projectId` first (per `CLAUDE.md` "Testing safety" section).
- Reuse existing CSS classes (`.btn`, `.btn-ghost`, `.btn-sm`, `.modal-overlay`, `.modal-card`, `.modal-title`, `.modal-subtitle`, `.modal-form`, `.form-group`, `.form-label`, `.form-input`, `.form-textarea`, `.form-textarea--tall`, `.modal-actions`) — no new CSS classes are needed for this feature.
- Bump the `?v=6` cache-busting query param to `?v=7` on every tag in `index.html` that carries one (the project's established convention any time `js`/`css` files change), matching commit `ad37357`'s precedent.
- No new Firestore collections or fields — this task only adds a second UI entry point to data that already round-trips through `Storage.getSheetNote`/`Storage.setSheetNote`.

---

### Task 1: Add the sheet-note modal markup

**Files:**
- Modify: `index.html:207-223` (insert new modal block after the existing `notes-overlay` block)
- Modify: `index.html:9,225,226,227,228` (cache-bust bump `?v=6` → `?v=7`)

**Interfaces:**
- Produces: DOM elements `#sheet-note-overlay`, `#sheet-note-modal-subtitle`, `#sheet-note-modal-text`, `#sheet-note-modal-cancel`, `#sheet-note-modal-save` — Task 2 wires these up in `js/app.js`.

- [ ] **Step 1: Insert the new modal markup**

In `index.html`, immediately after the closing `</div>` of the `notes-overlay` block (currently line 223, right before the blank line and the `<script src="js/firebase-config.js?v=6">` line), insert:

```html

  <!-- ══════════════════════════════════
       SHEET NOTE MODAL
  ══════════════════════════════════ -->
  <div id="sheet-note-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
    <div class="modal-card">
      <h2 class="modal-title">Sheet Note</h2>
      <p id="sheet-note-modal-subtitle" class="modal-subtitle"></p>
      <div class="modal-form">
        <div class="form-group">
          <label class="form-label" for="sheet-note-modal-text">Note</label>
          <textarea id="sheet-note-modal-text" class="form-input form-textarea form-textarea--tall" placeholder="Add a note for this sheet…"></textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="sheet-note-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="sheet-note-modal-save">Save Note</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Bump the cache-busting version**

In `index.html`, change all four `?v=6` occurrences to `?v=7`:
```html
  <link rel="stylesheet" href="css/style.css?v=7">
```
```html
  <script src="js/firebase-config.js?v=7"></script>
  <script src="js/storage.js?v=7"></script>
  <script src="js/parser.js?v=7"></script>
  <script src="js/app.js?v=7"></script>
```

- [ ] **Step 3: Manually verify the modal markup renders**

Run: `npx serve .` from the repo root, open `http://localhost:3000` (or whatever port `serve` prints) in a browser, open DevTools console, and run:
```js
document.getElementById('sheet-note-overlay').classList.remove('hidden')
```
Expected: A modal card titled "Sheet Note" appears centered on screen with a subtitle line, a "Note" textarea, and Cancel/Save buttons styled identically to the existing "Project Notes" modal. Run `document.getElementById('sheet-note-overlay').classList.add('hidden')` to close it again.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add sheet-note modal markup, bump cache to v7"
```

---

### Task 2: Wire the note button and modal behavior

**Files:**
- Modify: `js/app.js:57-66` (DOM refs block — add sheet-note-overlay refs)
- Modify: `js/app.js:114-117` (event listener wiring block — add sheet-note-overlay listeners)
- Modify: `js/app.js:602-604` (inside `buildSheetDetail()` — add the note button to `heroTop`)
- Modify: `js/app.js` (add new functions `openSheetNoteModal`, `closeSheetNoteModal`, `saveSheetNote` near the existing `openNotesModal`/`closeNotesModal`/`saveNote` functions, currently around line 850-906)

**Interfaces:**
- Consumes: `Storage.getSheetNote(fileKey)` → `string|null`, `Storage.setSheetNote(fileKey, text)` → `Promise<void>` (both already exist in `js/storage.js`, unchanged). `renderAllSheets()` (existing, no signature change).
- Produces: `openSheetNoteModal(sheet)` — takes the same sheet object shape used throughout `buildSheetDetail`/`buildNavRow` (`{ fileKey, sheetTitle, fileName, ... }`).

- [ ] **Step 1: Add DOM refs for the new modal**

In `js/app.js`, immediately after line 66 (`const modalNotes            = document.getElementById('modal-notes');`), add:

```js
const sheetNoteOverlay      = document.getElementById('sheet-note-overlay');
const sheetNoteSubtitle     = document.getElementById('sheet-note-modal-subtitle');
const sheetNoteText         = document.getElementById('sheet-note-modal-text');
```

- [ ] **Step 2: Wire the modal's open/close/save event listeners**

In `js/app.js`, immediately after line 117 (`document.getElementById('notes-modal-save').addEventListener('click', saveNote);`), add:

```js
sheetNoteOverlay.addEventListener('click', e => { if (e.target === sheetNoteOverlay) closeSheetNoteModal(); });
document.getElementById('sheet-note-modal-cancel').addEventListener('click', closeSheetNoteModal);
document.getElementById('sheet-note-modal-save').addEventListener('click', saveSheetNote);
```

- [ ] **Step 3: Add the open/close/save functions**

In `js/app.js`, immediately after the existing `closeNotesModal()` function (currently ending at line 891, right before `async function saveNote() {`), add:

```js
let sheetNoteCtx = null;

function openSheetNoteModal(sheet) {
  sheetNoteCtx = { sheet };
  sheetNoteSubtitle.textContent = sheet.sheetTitle || sheet.fileName;
  sheetNoteText.value = Storage.getSheetNote(sheet.fileKey) || '';
  sheetNoteOverlay.classList.remove('hidden');
  setTimeout(() => sheetNoteText.focus(), 50);
}

function closeSheetNoteModal() {
  sheetNoteOverlay.classList.add('hidden');
  sheetNoteCtx = null;
}

async function saveSheetNote() {
  if (!sheetNoteCtx) return;
  const { sheet } = sheetNoteCtx;
  await Storage.setSheetNote(sheet.fileKey, sheetNoteText.value);
  closeSheetNoteModal();
  renderAllSheets();
}
```

- [ ] **Step 4: Add the button to the detail hero header**

In `js/app.js`, inside `buildSheetDetail()`, the current code (around line 602-604) reads:
```js
  heroTop.appendChild(numEl);
  heroTop.appendChild(titlesEl);
  hero.appendChild(heroTop);
```
Change it to:
```js
  heroTop.appendChild(numEl);
  heroTop.appendChild(titlesEl);

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

- [ ] **Step 5: Manually verify end-to-end, offline**

Per `CLAUDE.md`'s testing-safety section:
1. Copy the whole `CNC_WebApp` folder to a temp directory.
2. In the copy, overwrite `js/firebase-config.js`'s `projectId` (and the other fields, for clarity) with `"PASTE_DISABLED"`.
3. From the copy's root, run `npx serve .` and open the printed URL.
4. Upload the tracked sample file (`260520_..._Summary_Sheet 9.html`) via the upload screen.
5. Open the project, confirm the sheet detail hero header now shows an **"Add Note"** button next to the title.
6. Click it, confirm the "Sheet Note" modal opens with an empty textarea and the sheet's title as the subtitle.
7. Type a note, click **Save Note**. Confirm: the modal closes, the button now reads **"Edit Note"**, a "Note" callout appears in the detail panel below the hero, and a note icon appears next to that sheet in the sidebar.
8. Click **Edit Note** again, confirm the textarea is pre-filled with the text you saved. Clear it and save. Confirm the callout, sidebar icon, and button label ("Add Note") all revert to the no-note state.
9. Open the project card's own "Add Note" modal (from the projects directory screen) and confirm the same sheet's note field there stays in sync with whatever you last saved from the detail header (both read/write the same `sheetNotes/{fileKey}` doc).

Expected: all of the above match, with zero writes to production (confirmed by the `PASTE_DISABLED` projectId — check the browser console for `"Running without Firebase:"` warning on load, confirming Firebase was skipped).

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "Add per-sheet note button to the sheet detail header"
```

---

### Task 3: Update project docs

**Files:**
- Modify: `CLAUDE.md:9` (modal count in file structure comment)
- Modify: `CLAUDE.md:40` (sheetNotes entry-point description)
- Modify: `CLAUDE.md:63,73` (current-status date and bullet)

**Interfaces:**
- None — documentation only, no code interfaces.

- [ ] **Step 1: Update the modal count**

In `CLAUDE.md`, line 9 currently reads:
```
├── index.html                 — 4 screens (loading, projects directory, upload, content) + 3 modals (mark complete, clear confirm, project notes)
```
Change to:
```
├── index.html                 — 4 screens (loading, projects directory, upload, content) + 4 modals (mark complete, clear confirm, project notes, sheet note)
```

- [ ] **Step 2: Update the sheetNotes bullet**

In `CLAUDE.md`, line 40 currently reads:
```
  - `sheetNotes/{fileKey}` — per-sheet instruction note `{ text }`, written by Travis from the project card's notes modal; rendered read-only in the sheet detail (callout) and sheet nav (icon) (`getSheetNote`/`setSheetNote`/`loadSheetNotes`/`onSheetNoteChange`)
```
Change to:
```
  - `sheetNotes/{fileKey}` — per-sheet instruction note `{ text }`, written either from the project card's notes modal or from an Add Note/Edit Note button in the sheet detail header; rendered read-only in the sheet nav (icon) (`getSheetNote`/`setSheetNote`/`loadSheetNotes`/`onSheetNoteChange`)
```

- [ ] **Step 3: Update current-status date and bullet**

In `CLAUDE.md`, line 63 currently reads:
```
## Current status (as of 2026-06-30)
```
Change to:
```
## Current status (as of 2026-07-08)
```

Line 73 currently reads:
```
- Per-sheet instruction notes (Travis → operator, read-only in sheet view) + job-note banner in sheet view; both live-synced
```
Change to:
```
- Per-sheet instruction notes, editable from either the project card modal or an Add Note/Edit Note button in the sheet detail header (read-only callout + sidebar icon for the operator) + job-note banner in sheet view; both live-synced
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Update docs for sheet detail note button"
```
