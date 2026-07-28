# Job Layout Sheet Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator draw rectangle/ellipse highlights, in one of three fixed colors, directly on a sheet's Material Border layout diagram — synced live across devices, cleared manually or automatically when the sheet is marked Complete.

**Architecture:** A new Firestore collection `sheetAnnotations/{fileKey}` (storage.js) holds each sheet's shape list, following the exact pattern already used by `sheetNotes`. A new module `js/markup.js` owns all drawing/toolbar logic: it mounts a transparent overlay `<svg>` on top of the existing layout diagram, converts mouse coordinates into the diagram's own coordinate space, and persists shapes through `Storage`. `js/app.js` wires this module into the existing sheet-detail render path and hooks the existing completion/delete/reset flows to clear annotations at the right times.

**Tech Stack:** Vanilla JS (no framework, no build step), Firestore (via the existing `Storage` wrapper), Node's built-in test runner (`node --test`) for the parts that don't require a DOM.

## Global Constraints

- Never test against production Firestore — use a local copy with `js/firebase-config.js`'s `projectId` overwritten to start with `"PASTE"` (per `CLAUDE.md`), which makes `Storage`'s internal `db` stay `null` and all writes cache-only.
- Follow the existing cache-first, non-blocking write convention used by every other `Storage` setter: update the in-memory cache synchronously, fire the Firestore write without blocking the caller, `console.warn` on failure.
- Shapes are rectangle/ellipse only, mouse-only, three fixed colors (`red`/`gold`/`green` — the app's existing `--red`/`--gold`/`--green` CSS custom properties). No freehand drawing, no touch handling, no per-shape undo.
- Marks never appear in CSV export, the printed job ticket, the archived HTML, or the Master Job Log — purely an in-app overlay.
- Every new/changed `.js` file loaded by `index.html` needs its `?v=N` query param bumped so browsers don't serve a stale cached copy.

---

### Task 1: Storage layer for annotations

**Files:**
- Modify: `js/storage.js:12` (cache declarations), `js/storage.js:156` (after the `onSheetNoteChange` block, ~line 156), `js/storage.js:392` (return statement)
- Test: `test/storage-annotations.test.mjs` (new)

**Interfaces:**
- Produces: `Storage.getAnnotations(fileKey) -> Array<{type, x, y, w, h, color}>` (returns `[]` if none), `Storage.setAnnotations(fileKey, shapes) -> Promise<void>`, `Storage.loadAnnotations() -> Promise<void>`, `Storage.onAnnotationsChange(callback) -> void`

- [ ] **Step 1: Write the failing tests**

Create `test/storage-annotations.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

test('getAnnotations returns an empty array when nothing is stored', () => {
  assert.deepEqual(Storage.getAnnotations('sheet_none'), []);
});

test('setAnnotations/getAnnotations round-trip through the cache', async () => {
  const shapes = [{ type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red' }];
  await Storage.setAnnotations('sheet_a', shapes);
  assert.deepEqual(Storage.getAnnotations('sheet_a'), shapes);
});

test('setAnnotations with an empty array clears the cache entry', async () => {
  await Storage.setAnnotations('sheet_b', [{ type: 'ellipse', x: 0, y: 0, w: 1, h: 1, color: 'gold' }]);
  await Storage.setAnnotations('sheet_b', []);
  assert.deepEqual(Storage.getAnnotations('sheet_b'), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (runs `node --test`)
Expected: FAIL — `Storage.getAnnotations is not a function`

- [ ] **Step 3: Add the cache and functions to storage.js**

In `js/storage.js`, change line 12 from:

```js
  const sheetNotesCache = {};  // { [fileKey]: string }
```

to:

```js
  const sheetNotesCache = {};  // { [fileKey]: string }
  const annotationsCache = {}; // { [fileKey]: Array<{type,x,y,w,h,color}> }
```

Immediately after the existing `onSheetNoteChange` function (ends at line 155, right before the blank line at 156), insert:

```js

  /* ── Sheet Annotations (layout diagram markup) ── */

  function getAnnotations(fileKey) {
    return annotationsCache[fileKey] || [];
  }

  async function setAnnotations(fileKey, shapes) {
    if (shapes && shapes.length) {
      annotationsCache[fileKey] = shapes;
    } else {
      delete annotationsCache[fileKey];
    }
    if (!db) return;
    try {
      if (shapes && shapes.length) {
        await db.collection('sheetAnnotations').doc(fileKey).set({ shapes });
      } else {
        await db.collection('sheetAnnotations').doc(fileKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setAnnotations failed:', e);
    }
  }

  async function loadAnnotations() {
    if (!db) return;
    try {
      const snap = await db.collection('sheetAnnotations').get();
      snap.forEach(doc => { annotationsCache[doc.id] = doc.data().shapes; });
    } catch (e) {
      console.warn('Firestore loadAnnotations failed:', e);
    }
  }

  function onAnnotationsChange(callback) {
    if (!db) return;
    db.collection('sheetAnnotations').onSnapshot(snap => {
      Object.keys(annotationsCache).forEach(k => delete annotationsCache[k]);
      snap.forEach(doc => { annotationsCache[doc.id] = doc.data().shapes; });
      callback();
    }, err => console.warn('Firestore sheetAnnotations listener error:', err));
  }
```

Update the return statement at (old) line 392 to add the four new names — change:

```js
  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, getCustomers, addCustomer, renameCustomer, removeCustomer, loadCustomers, onCustomersChange, getProjectCustomer, setProjectCustomer, loadProjectCustomers, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory };
```

to:

```js
  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, getAnnotations, setAnnotations, loadAnnotations, onAnnotationsChange, getCustomers, addCustomer, renameCustomer, removeCustomer, loadCustomers, onCustomersChange, getProjectCustomer, setProjectCustomer, loadProjectCustomers, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 new tests plus the existing suite green

- [ ] **Step 5: Commit**

```bash
git add js/storage.js test/storage-annotations.test.mjs
git commit -m "feat: add sheetAnnotations storage layer for layout markup"
```

---

### Task 2: Pure shape-math for drag-to-draw

**Files:**
- Create: `js/markup.js`
- Test: `test/markup.test.mjs` (new)

**Interfaces:**
- Consumes: nothing (pure module, no dependency on Storage yet — that comes in Task 3)
- Produces: `Markup.normalizeDrag(x1, y1, x2, y2) -> {x, y, w, h}`, `Markup.COLORS -> ['red', 'gold', 'green']`

- [ ] **Step 1: Write the failing tests**

Create `test/markup.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Markup = require('../js/markup.js');

test('normalizeDrag handles a drag toward the bottom-right (the simple case)', () => {
  assert.deepEqual(Markup.normalizeDrag(1, 2, 5, 8), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the top-left (both coords decrease)', () => {
  assert.deepEqual(Markup.normalizeDrag(5, 8, 1, 2), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the top-right (x increases, y decreases)', () => {
  assert.deepEqual(Markup.normalizeDrag(1, 8, 5, 2), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the bottom-left (x decreases, y increases)', () => {
  assert.deepEqual(Markup.normalizeDrag(5, 2, 1, 8), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag returns zero width/height for a click with no movement', () => {
  assert.deepEqual(Markup.normalizeDrag(3, 3, 3, 3), { x: 3, y: 3, w: 0, h: 0 });
});

test('COLORS lists exactly the three supported keys', () => {
  assert.deepEqual(Markup.COLORS, ['red', 'gold', 'green']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/markup.js'`

- [ ] **Step 3: Create js/markup.js with the pure logic**

```js
/**
 * Layout diagram markup: rectangle/ellipse highlights drawn on top of a
 * sheet's Material Border SVG. See js/storage.js's sheetAnnotations
 * functions for persistence; this module owns the drawing/toolbar UI.
 */
const Markup = (() => {
  const COLORS = ['red', 'gold', 'green'];

  // Drag can start from any corner; always normalize to a top-left
  // origin with positive width/height so stored shapes are consistent
  // regardless of which direction the operator dragged.
  function normalizeDrag(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  return { COLORS, normalizeDrag };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Markup;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 new tests plus the existing suite green

- [ ] **Step 5: Commit**

```bash
git add js/markup.js test/markup.test.mjs
git commit -m "feat: add pure drag-normalization logic for layout markup"
```

---

### Task 3: Overlay rendering, toolbar, and mouse interaction

**Files:**
- Modify: `js/markup.js`

**Interfaces:**
- Consumes: `Markup.COLORS`, `Markup.normalizeDrag` (Task 2); `Storage.getAnnotations`, `Storage.setAnnotations` (Task 1)
- Produces: `Markup.mount(svgWrapEl, scrollEl, sheet) -> void` — call once per sheet-detail render, after the base diagram `<svg>` has been inserted into `scrollEl`. Idempotent per call (each call builds a fresh toolbar+overlay; the caller is responsible for calling it exactly once per render, same as the rest of `buildSheetDetail`).

This task is DOM/mouse-event-driven and has no meaningful unit-test surface without a browser (no `jsdom` dependency exists in this project — see Task 1 of `storage-customers.test.mjs`'s precedent of testing only the cache logic, not DOM). It's verified manually in Task 6, matching this project's existing convention (`CLAUDE.md`: browser click-through before touching prod). Keep functions small and single-purpose so the manual check is straightforward.

- [ ] **Step 1: Add shape rendering to the overlay SVG**

Append to `js/markup.js`, inside the `(() => { ... })()` body, before the `return` statement:

```js
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function renderShapes(overlaySvg, shapes) {
    overlaySvg.innerHTML = '';
    for (const shape of shapes) {
      const el = document.createElementNS(SVG_NS, shape.type === 'ellipse' ? 'ellipse' : 'rect');
      if (shape.type === 'ellipse') {
        el.setAttribute('cx', shape.x + shape.w / 2);
        el.setAttribute('cy', shape.y + shape.h / 2);
        el.setAttribute('rx', shape.w / 2);
        el.setAttribute('ry', shape.h / 2);
      } else {
        el.setAttribute('x', shape.x);
        el.setAttribute('y', shape.y);
        el.setAttribute('width', shape.w);
        el.setAttribute('height', shape.h);
      }
      el.style.fill = `var(--${shape.color})`;
      el.style.fillOpacity = '0.3';
      el.style.stroke = `var(--${shape.color})`;
      el.style.strokeWidth = '0.15';
      overlaySvg.appendChild(el);
    }
  }
```

- [ ] **Step 2: Add the toolbar + drag-to-draw + mount function**

Append to `js/markup.js`, still before the `return` statement:

```js
  function buildToolbar(state, onToolChange) {
    const bar = document.createElement('div');
    bar.className = 'layout-markup-toolbar';

    const rectBtn = document.createElement('button');
    rectBtn.type = 'button';
    rectBtn.className = 'markup-tool-btn';
    rectBtn.textContent = '▭';
    rectBtn.title = 'Draw rectangle';
    rectBtn.addEventListener('click', () => {
      state.tool = state.tool === 'rect' ? null : 'rect';
      onToolChange();
    });

    const ellipseBtn = document.createElement('button');
    ellipseBtn.type = 'button';
    ellipseBtn.className = 'markup-tool-btn';
    ellipseBtn.textContent = '◯';
    ellipseBtn.title = 'Draw ellipse';
    ellipseBtn.addEventListener('click', () => {
      state.tool = state.tool === 'ellipse' ? null : 'ellipse';
      onToolChange();
    });

    bar.appendChild(rectBtn);
    bar.appendChild(ellipseBtn);

    for (const color of COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'markup-color-swatch';
      swatch.style.background = `var(--${color})`;
      swatch.title = color;
      swatch.addEventListener('click', () => {
        state.color = color;
        onToolChange();
      });
      bar.appendChild(swatch);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-muted btn-sm markup-clear-btn';
    clearBtn.textContent = 'Clear marks';
    clearBtn.addEventListener('click', () => {
      state.shapes = [];
      Storage.setAnnotations(state.fileKey, state.shapes);
      onToolChange();
    });
    bar.appendChild(clearBtn);

    return { bar, rectBtn, ellipseBtn, clearBtn, swatches: [...bar.querySelectorAll('.markup-color-swatch')] };
  }

  function updateToolbarUI(els, state) {
    els.rectBtn.classList.toggle('active', state.tool === 'rect');
    els.ellipseBtn.classList.toggle('active', state.tool === 'ellipse');
    els.swatches.forEach((el, i) => el.classList.toggle('active', COLORS[i] === state.color));
  }

  function screenToPoint(svg, evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const inverse = svg.getScreenCTM().inverse();
    const local = pt.matrixTransform(inverse);
    return { x: local.x, y: local.y };
  }

  function mount(svgWrapEl, scrollEl, sheet) {
    const baseSvg = scrollEl.querySelector('svg');
    if (!baseSvg) return;

    const viewBox = baseSvg.getAttribute('viewBox');

    const canvas = document.createElement('div');
    canvas.className = 'layout-svg-canvas';
    baseSvg.replaceWith(canvas);
    canvas.appendChild(baseSvg);

    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('viewBox', viewBox);
    overlay.classList.add('layout-svg-overlay');
    canvas.appendChild(overlay);

    const state = {
      fileKey: sheet.fileKey,
      shapes: Storage.getAnnotations(sheet.fileKey),
      tool: null,
      color: COLORS[0],
    };
    renderShapes(overlay, state.shapes);

    const els = buildToolbar(state, () => {
      updateToolbarUI(els, state);
      renderShapes(overlay, state.shapes);
    });
    updateToolbarUI(els, state);
    svgWrapEl.insertBefore(els.bar, scrollEl);

    let dragStart = null;
    overlay.addEventListener('mousedown', evt => {
      if (!state.tool) return;
      dragStart = screenToPoint(overlay, evt);
    });
    overlay.addEventListener('mousemove', evt => {
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      renderShapes(overlay, [...state.shapes, shape]);
    });
    overlay.addEventListener('mouseup', evt => {
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      dragStart = null;
      if (shape.w === 0 || shape.h === 0) return; // plain click, not a drag — discard
      state.shapes = [...state.shapes, shape];
      renderShapes(overlay, state.shapes);
      Storage.setAnnotations(state.fileKey, state.shapes);
    });
  }
```

- [ ] **Step 3: Update the module's return statement**

Change:

```js
  return { COLORS, normalizeDrag };
```

to:

```js
  return { COLORS, normalizeDrag, mount };
```

- [ ] **Step 4: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — same tests as Task 2, no regressions (this task added no new Node-testable surface; `mount`/`renderShapes`/`buildToolbar` need a browser, see Task 6)

- [ ] **Step 5: Commit**

```bash
git add js/markup.js
git commit -m "feat: add overlay rendering, toolbar, and drag-to-draw to layout markup"
```

---

### Task 4: Wire markup into the sheet detail view

**Files:**
- Modify: `js/app.js:923-961` (the `layoutSvg`/`layoutSvgGz` branch of `buildSheetDetail`), `js/app.js` (near line 1552, realtime listener wiring)
- Modify: `index.html:358-362` (script tags)
- Modify: `css/style.css` (after line 701, the Material Border SVG section)

**Interfaces:**
- Consumes: `Markup.mount(svgWrapEl, scrollEl, sheet)` (Task 3), `Storage.onAnnotationsChange(callback)` (Task 1)

- [ ] **Step 1: Add the script tag and bump cache-busters**

In `index.html`, change lines 358-362 from:

```html
  <script src="js/svg-codec.js?v=1"></script>
  <script src="js/path-utils.js?v=1"></script>
  <script src="js/storage.js?v=11"></script>
  <script src="js/parser.js?v=7"></script>
  <script src="js/app.js?v=16"></script>
```

to:

```html
  <script src="js/svg-codec.js?v=1"></script>
  <script src="js/path-utils.js?v=1"></script>
  <script src="js/storage.js?v=12"></script>
  <script src="js/parser.js?v=7"></script>
  <script src="js/markup.js?v=1"></script>
  <script src="js/app.js?v=17"></script>
```

- [ ] **Step 2: Call Markup.mount at all three places the diagram gets rendered**

In `js/app.js`, inside `buildSheetDetail`'s `else if (sheet.layoutSvg || sheet.layoutSvgGz)` branch (lines 923-961), change:

```js
      if (sheet.layoutSvg) {
        scrollEl.innerHTML = sheet.layoutSvg;
      } else if (svgCache.has(sheet.fileKey)) {
        scrollEl.innerHTML = svgCache.get(sheet.fileKey);
      } else {
```

to:

```js
      if (sheet.layoutSvg) {
        scrollEl.innerHTML = sheet.layoutSvg;
        Markup.mount(svgWrap, scrollEl, sheet);
      } else if (svgCache.has(sheet.fileKey)) {
        scrollEl.innerHTML = svgCache.get(sheet.fileKey);
        Markup.mount(svgWrap, scrollEl, sheet);
      } else {
```

And a few lines further down, change:

```js
        SvgCodec.decompressSvg(sheet.layoutSvgGz)
          .then(svg => {
            svgCache.set(renderingKey, svg);
            if (selectedSheetKey !== renderingKey) return;
            if (!scrollEl.isConnected) return;
            scrollEl.innerHTML = svg;
          })
```

to:

```js
        SvgCodec.decompressSvg(sheet.layoutSvgGz)
          .then(svg => {
            svgCache.set(renderingKey, svg);
            if (selectedSheetKey !== renderingKey) return;
            if (!scrollEl.isConnected) return;
            scrollEl.innerHTML = svg;
            Markup.mount(svgWrap, scrollEl, sheet);
          })
```

- [ ] **Step 3: Wire the realtime listener**

In `js/app.js`, right after the existing `Storage.onSheetNoteChange(...)` block (ends ~line 1554), add:

```js

    Storage.onAnnotationsChange(() => {
      if (!contentScreen.hidden) renderAllSheets();
    });
```

(Annotations never appear on the projects-directory screen, so unlike `onSheetNoteChange` this only needs to re-render the sheet workspace, not `renderProjects()`.)

- [ ] **Step 4: Add CSS for the overlay and toolbar**

In `css/style.css`, after the existing stroke-width rule block that ends around line 702, add:

```css

/* ── Layout Markup (highlight overlay) ── */
.layout-svg-canvas {
  position: relative;
  display: inline-block;
}

.layout-svg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.layout-markup-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.markup-tool-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  background: var(--white);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.markup-tool-btn.active {
  border-color: var(--orange);
  background: var(--orange-light);
}

.markup-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.markup-color-swatch.active {
  border-color: var(--gray-400);
}
```

- [ ] **Step 5: Run the existing test suite**

Run: `npm test`
Expected: PASS — no Node-testable surface changed in this task, confirms no accidental syntax errors broke module loading

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js css/style.css
git commit -m "feat: wire layout markup overlay into the sheet detail view"
```

---

### Task 5: Auto-clear on Complete and delete-cascade cleanup

**Files:**
- Modify: `js/app.js` — `confirmComplete()` (~line 1313), `deleteProject()` (~line 532), `deleteSheetFromProject()` (~line 547), `resetToUpload()` (~line 243)

**Interfaces:**
- Consumes: `Storage.setAnnotations(fileKey, [])` (Task 1)

- [ ] **Step 1: Clear annotations when a sheet is marked Complete**

In `js/app.js`, `confirmComplete()` currently ends with:

```js
  Storage.set(sheet.fileKey, 'sheet', {
    status:      'complete',
    completedAt: dtValue ? new Date(dtValue).toISOString() : new Date().toISOString(),
    operator,
    notes: modalNotes.value.trim(),
  });
  closeModal();
  renderAllSheets();
}
```

Change it to:

```js
  Storage.set(sheet.fileKey, 'sheet', {
    status:      'complete',
    completedAt: dtValue ? new Date(dtValue).toISOString() : new Date().toISOString(),
    operator,
    notes: modalNotes.value.trim(),
  });
  Storage.setAnnotations(sheet.fileKey, []);
  closeModal();
  renderAllSheets();
}
```

- [ ] **Step 2: Clear annotations on project delete, sheet delete, and reset-to-upload**

In `js/app.js`, `deleteProject()` currently reads:

```js
async function deleteProject(jobName) {
  const projectSheets = sheets.filter(s => projectKey(s) === jobName);
  await Promise.all(projectSheets.flatMap(s => [
    Storage.deleteSheet(s.fileKey),
    Storage.clear(s.fileKey, 'sheet'),
    Storage.setSheetNote(s.fileKey, ''),
  ]));
  sheets = sheets.filter(s => projectKey(s) !== jobName);
```

Change the `flatMap` array to add the new call:

```js
async function deleteProject(jobName) {
  const projectSheets = sheets.filter(s => projectKey(s) === jobName);
  await Promise.all(projectSheets.flatMap(s => [
    Storage.deleteSheet(s.fileKey),
    Storage.clear(s.fileKey, 'sheet'),
    Storage.setSheetNote(s.fileKey, ''),
    Storage.setAnnotations(s.fileKey, []),
  ]));
  sheets = sheets.filter(s => projectKey(s) !== jobName);
```

`deleteSheetFromProject()` currently reads:

```js
  await Promise.all([
    Storage.deleteSheet(sheet.fileKey),
    Storage.clear(sheet.fileKey, 'sheet'),
    Storage.setSheetNote(sheet.fileKey, ''),
  ]);
```

Change to:

```js
  await Promise.all([
    Storage.deleteSheet(sheet.fileKey),
    Storage.clear(sheet.fileKey, 'sheet'),
    Storage.setSheetNote(sheet.fileKey, ''),
    Storage.setAnnotations(sheet.fileKey, []),
  ]);
```

`resetToUpload()` currently reads:

```js
  await Promise.all([
    Storage.clearSheets(),
    Storage.clearAllCompletions(),
    ...sheets.map(s => Storage.setSheetNote(s.fileKey, '')),
  ]);
```

Change to:

```js
  await Promise.all([
    Storage.clearSheets(),
    Storage.clearAllCompletions(),
    ...sheets.map(s => Storage.setSheetNote(s.fileKey, '')),
    ...sheets.map(s => Storage.setAnnotations(s.fileKey, [])),
  ]);
```

- [ ] **Step 3: Run the existing test suite**

Run: `npm test`
Expected: PASS — confirms no syntax errors; these call sites have no Node-level test coverage today (they're DOM-event-bound), consistent with the rest of `app.js`

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: clear layout marks on completion, delete, and reset-to-upload"
```

---

### Task 6: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Set up an offline test copy**

Per `CLAUDE.md`: copy the app to a temp directory, overwrite the copy's `js/firebase-config.js` `projectId` with a value starting with `"PASTE"` (e.g. `"PASTE_DISABLED"`), then `npx serve .` and open it in a browser. Confirm the console does not show any Firebase connection — this copy is in-memory only.

- [ ] **Step 2: Upload a sample sheet and verify drawing**

Upload the tracked sample file (`260520_..._Summary_Sheet 9.html` at the repo root — has a Job Layout Sheet with an SVG). Open its sheet detail view. Verify:
- The toolbar (rectangle icon, ellipse icon, 3 color swatches, Clear marks) appears above the Material Border diagram.
- Clicking the rectangle tool then dragging on the diagram draws a semi-transparent rectangle in the selected color; the diagram lines remain visible underneath.
- Switching to the ellipse tool and a different color swatch draws an ellipse in the new color.
- A plain click (no drag) does not create a zero-size shape.
- Reloading the page (still same offline session) keeps the marks, since they're held in the in-memory cache for that browser tab.
- Toggle dark mode (existing app control) with marks on the diagram: confirm the diagram background stays white and the three highlight colors remain clearly visible (per the spec's "Dark mode" section — this should already work with no code changes, since `.layout-svg-scroll` already forces a white background in dark mode).
- Take screenshots of the toolbar and a couple of drawn marks, per this project's existing "browser click-through with screenshots before touching prod" convention (`CLAUDE.md`).

- [ ] **Step 3: Verify Clear marks and auto-clear-on-Complete**

- Click **Clear marks**: all shapes on that sheet disappear.
- Draw a new mark, then use **Mark In Progress** → **Mark Complete** (fill the modal, confirm): the marks disappear once the sheet shows as Complete.
- Use **Clear Record** to revert the sheet back to Incomplete: confirm the marks do **not** reappear.

- [ ] **Step 4: Verify sync across two tabs**

With two browser tabs open to the same offline copy (same page, two windows) is not meaningful for Firestore sync in offline mode — instead, do this check against a **real but disposable** Firestore project: temporarily point `firebase-config.js` at a scratch/test Firebase project (not `cnc-job-tracker`), open two tabs, draw a mark in one tab, confirm it appears in the other within a second or two without a manual refresh. Revert `firebase-config.js` afterward.

- [ ] **Step 5: Verify the oversize-sheet edge case**

Find or construct a sheet whose `layoutOversize` flag is true (or temporarily force it in the console: `sheet.layoutOversize = true` before render) and confirm no markup toolbar appears — only the existing "Layout preview is too large to store" notice.

- [ ] **Step 6: Confirm nothing leaked into export/print**

Export CSV for a project with marks on some sheets; confirm the downloaded CSV is unchanged from before this feature (marks don't appear as columns or data). Print a job ticket for a marked-up sheet; confirm the ticket is unaffected.

- [ ] **Step 7: Commit the verification note**

No code changes in this task — if any step above fails, fix the underlying task and re-run this checklist. Once all steps pass, this feature is ready to ship (still pending Travis's own click-through before pushing to `master`, per `CLAUDE.md`'s live-deploy warning).
