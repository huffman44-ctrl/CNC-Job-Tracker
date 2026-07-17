# CNC Job Sheet Tracker — Project Context

## What this app does
Browser-only (no build step, no framework) single-page app. Operators upload VCarve CNC job sheet HTML files, grouped into projects by job name, and track each sheet through a 3-state workflow: **Incomplete → In Progress → Complete** (date/time + operator name + notes recorded on completion). All sheet data, completions, and project notes sync live across devices via Firestore — this is **not** local-only storage; every operator sees the same shared state in real time.

## File structure
```
CNC_WebApp/
├── index.html                 — 4 screens (loading, projects directory, upload, content) + 4 modals (mark complete, clear confirm, project notes, sheet note)
├── css/style.css               — all styles; CSS custom properties for color tokens; dark mode via [data-theme]
├── js/parser.js                 — parseJobSheet(htmlString) → { jobName, sheetTitle, totalTime, toolpaths, materialInfo, layoutSvg }; simpleHash(str)
├── js/storage.js                — Storage wrapper around Firestore (sheets/, completions/, projectNotes/ collections) with in-memory cache for sync reads
├── js/firebase-config.js        — FIREBASE_CONFIG for the LIVE production Firestore project `cnc-job-tracker` (real credentials, committed to git — Firebase web API keys are not secrets; access is governed by Firestore security rules, not key secrecy)
├── js/app.js                    — all UI logic: dark mode, file upload, projects directory, master-detail sheet workspace, modals, CSV export, Firebase init
├── package.json                 — `npm run serve` → `npx serve .` (no build step needed)
├── 260520_..._Summary_Sheet 9.html — tracked sample file at repo root (not in samples/)
└── samples/                    — gitignored; local-only scratch space for test HTML files, not committed
```

## ⚠️ Testing safety — read before running this app
`js/firebase-config.js` points at the **real, shared production database** that real operators use. Running the app normally (`npm run serve` + open in browser, or driving it with Playwright/automation) connects live and any upload/completion/delete action writes to production immediately.

**Never test against the real config.** To test safely offline:
1. Copy the app to a temp directory.
2. Overwrite the copy's `js/firebase-config.js` with a `projectId` that starts with `"PASTE"` (e.g. `"PASTE_DISABLED"`).
3. `initApp()` in app.js (~line 850) checks `FIREBASE_CONFIG.projectId.startsWith('PASTE')` and skips Firebase entirely when true, falling back to in-memory-only mode — uploads, completions, and deletes stay local to that browser tab with zero risk to prod data.

If you ever suspect a test run touched production, check the `sheets` collection for unexpected docs by filename and delete them immediately — don't leave fake data mixed into real operator records.

**`master` is live-deployed.** This repo is published via GitHub Pages directly from the `master` branch at https://huffman44-ctrl.github.io/CNC-Job-Tracker/ — there is no build/CI step in between. Pushing to `master` is a real deploy to whatever real operators have open, not just a git bookkeeping update. Merge and verify locally before pushing.

## Architecture
- **Screens** (`index.html`, toggled via `hidden` attribute, driven by `showProjectsScreen()` / `goToUpload()` / `showContentScreen()` in app.js):
  1. **Loading** — shown while Firebase connects
  2. **Projects directory** — grid of project cards (one per distinct `jobName`), each showing progress %, complete/in-progress/incomplete stat chips, an optional note preview, Add Note / Open / Delete (trash icon) actions
  3. **Upload** — drag-drop or browse for HTML files
  4. **Content** — master-detail sheet workspace for one project: a sidebar sheet-nav (`buildSheetNavRow`, one row per sheet) beside a detail panel (`buildSheetDetail`) showing the selected sheet's hero header, note callout (if present), material info, layout SVG, toolpaths, and completion footer; plus a progress bar, Export CSV, Reset All, New Job
- **Storage** (`js/storage.js`) — thin wrapper over Firestore with a synchronous local cache so the UI never blocks on network:
  - `sheets/{fileKey}` — parsed sheet data (`saveSheet`/`loadSheets`/`deleteSheet`/`clearSheets`/`onSheetsChange` realtime listener — added 2026-07-17 after shop-computer CSV exports missed sheets uploaded while the page sat open; the listener sorts client-side by `uploadedAt` instead of query `orderBy`, which would silently drop docs missing the field)
  - `completions/{fileKey}` — completion record `{ status: 'in-progress'|'complete', completedAt, operator, notes }` (`get`/`set`/`clear`/`loadCompletions`/`onCompletionChange` realtime listener)
  - `projectNotes/{hash(jobName)}` — free-text per-project notes (`getNote`/`setNote`/`loadNotes`/`onNoteChange`)
  - `sheetNotes/{fileKey}` — per-sheet instruction note `{ text }`, written either from the project card's notes modal or from an Add Note/Edit Note button in the sheet detail header; rendered read-only in the sheet detail (callout) and the sheet nav (icon) (`getSheetNote`/`setSheetNote`/`loadSheetNotes`/`onSheetNoteChange`)
  - `fileKey` = `simpleHash(filename)` (djb2-style, from parser.js) — namespaces all four collections per uploaded file
- **Sheet ordering** — `getDisplaySheets()` (app.js ~line 232) sorts by `sheetNumber(fileName)`, which regex-matches `/sheet\s*0*(\d+)/i` out of the filename (handles `Sheet 9`, `Sheet01`, etc.) so display order is always numeric regardless of FileReader/upload completion order. Files without a parseable sheet number sort to the end.
- **Project grouping** — `projectKey(sheet)` = `sheet.jobName || sheet.fileName`; `getProjectGroups()` buckets all loaded sheets by that key for the directory screen.
- **3-state completion** — no record = Incomplete; `{status:'in-progress'}` = In Progress; `{status:'complete', completedAt, operator, notes}` = Complete. Driven by `applySheetCompletion()` (app.js ~line 659); clicking the action button advances the state, the modal only appears for the In Progress → Complete transition.
- `buildSheetDetail()` assembles the selected sheet's detail panel in order: hero header → note callout (if a sheet note exists) → material-strip → layout-svg-wrap → toolpaths-list → sheet-complete-footer. `buildSheetNavRow()` builds each sidebar row: sheet number, title + time, a note icon if the sheet has a note, and a status dot.
- **Dark mode** — `data-theme` attribute on `<html>`, persisted to `localStorage['cnc::darkMode']` (this one piece of state is intentionally local-only, not synced — it's a per-device display preference, not job data).

## VCarve HTML format (source files)
- Top-level `.boxborder` sections with `.boxtitle` headings
- Job name comes from `#jobtitle`; sheet title from the first `.boxtitle` (fallback `#title`)
- **Job Layout Sheet** section: contains `#vectorcenter` div with the Material Border SVG
- **Toolpaths Summary** section: `.childindent .fullwidth` rows, each with three `.box33` cols [name | tool | time]
- **Material Setup** section: `.box33`/`.fullwidth` elements with `<b>` labels and `.boxpic span` values
- SVG uses `viewBox="0 0 48 96"` (portrait, 48"×96" coordinate space), inline `stroke-width: 0.03`

## Key technical decisions
- SVG `id`, `width`, `height` attributes are stripped before storing `outerHTML` — prevents duplicate IDs across cards and lets CSS control sizing
- `vector-effect: non-scaling-stroke; stroke-width: 1.5px !important` applied via CSS to all SVG shape elements — the 0.03 viewBox-unit strokes would be sub-pixel (~0.08px) at display size without this
- SVG displayed at `width: 280px; height: auto` (portrait ~560px tall) inside a `max-height: 420px; overflow-y: auto` scroll container
- SVG insertion in `buildSheetDetail` is wrapped in try-catch so any SVG error doesn't prevent toolpaths from rendering
- Project card header text wrapper has `min-width: 0` + `.project-card-name` has `overflow-wrap: break-word` — without this, a long job name with no spaces (no soft wrap point) forces the flex header row wider than the card, pushing the delete button past the card's `overflow: hidden` edge and making it disappear

## Current status (as of 2026-07-08)
### Working
- File upload (drag-drop + browse), multi-file support, "Add More Sheets" within a project
- Projects directory screen: progress %, stat chips, per-project notes, delete project
- Sheets always render in numeric order based on the sheet number in the filename
- Master-detail sheet view with sheet title, total time chip, material info strip, Material Border SVG, toolpath rows
- 3-state sheet completion (Incomplete → In Progress → Complete) with Mark Complete modal (date/time, operator dropdown Collin/Travis/Other, notes) and Clear Record confirmation
- Progress bar per project; live cross-device sync via Firestore for sheets, completions, and notes
- Dark mode toggle (persisted locally per device)
- Export CSV, Reset All, New Job / back-to-projects navigation
- Per-sheet instruction notes, editable from either the project card modal or an Add Note/Edit Note button in the sheet detail header (read-only callout + sidebar icon for the operator) + job-note banner in sheet view; both live-synced

### Operators configured in modal
- Collin (default)
- Travis
- Other... (free-text input)

## Sample test files
- `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html` (repo root, tracked in git) — GMC Savana 3500 cargo van, 1 Job Layout Sheet (with SVG), 1 Material Setup section, 1 Toolpaths Summary section with 5 toolpath rows
- `samples/` — gitignored scratch folder for additional local test files (e.g. `260623_Sprinter_2108_Order_1201_Summary_Sheet01.html`); add files here freely, they won't be committed
