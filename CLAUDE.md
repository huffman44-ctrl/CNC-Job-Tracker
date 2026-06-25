# CNC Job Sheet Tracker — Project Context

## What this app does
Browser-only (no server, no framework) single-page app. Operators upload VCarve CNC job sheet HTML files, view toolpaths and material info per sheet, and mark each sheet complete with a date/time + operator name. Completion records persist in localStorage.

## File structure
```
CNC_WebApp/
├── index.html          — single-page shell (upload screen + content screen + 2 modals)
├── css/style.css       — all styles; CSS custom properties for color tokens
├── js/parser.js        — parseJobSheet(htmlString) → { jobName, sheetTitle, totalTime, toolpaths, materialInfo, layoutSvg }
├── js/storage.js       — Storage.get/set/clear/clearAll/getAllForFile/exportCSV
├── js/app.js           — all UI logic (drag-drop, render, accordion, modal, progress)
└── samples/            — VCarve HTML sample files for testing
```

## Architecture
- `parseJobSheet()` in parser.js uses DOMParser on the uploaded HTML
- `simpleHash(filename)` (djb2-style) namespaces localStorage keys: `cnc::<hash>::<itemId>`
- Sheet-level completion stored under itemId `'sheet'`
- `buildSheetCard()` in app.js assembles each accordion card in order:
  1. material-strip (material info chips)
  2. layout-svg-wrap (Material Border SVG)
  3. toolpaths-list (toolpath rows)
  4. sheet-complete-footer (Mark Complete / Clear Record button)
- Accordion uses CSS `max-height` transition on `.sheet-body.open`

## VCarve HTML format (source files)
- Top-level `.boxborder` sections with `.boxtitle` headings
- **Job Layout Sheet** section: contains `#vectorcenter` div with the Material Border SVG
- **Toolpaths Summary** section: `.childindent .fullwidth` rows, each with three `.box33` cols [name | tool | time]
- **Material Setup** section: `.box33`/`.fullwidth` elements with `<b>` labels and `.boxpic span` values
- SVG uses `viewBox="0 0 48 96"` (portrait, 48"×96" coordinate space), inline `stroke-width: 0.03`

## Key technical decisions
- SVG `id`, `width`, `height` attributes are stripped before storing `outerHTML` — prevents duplicate IDs across cards and lets CSS control sizing
- `vector-effect: non-scaling-stroke; stroke-width: 1.5px !important` applied via CSS to all SVG shape elements — the 0.03 viewBox-unit strokes would be sub-pixel (~0.08px) at display size without this
- SVG displayed at `width: 280px; height: auto` (portrait ~560px tall) inside a `max-height: 420px; overflow-y: auto` scroll container
- SVG insertion in `buildSheetCard` is wrapped in try-catch so any SVG error doesn't prevent toolpaths from rendering

## Current status (as of 2026-06-25)
### Working
- File upload (drag-drop + browse), multi-file support, "Add More Sheets"
- Accordion sheet cards with sheet title, total time chip
- Material info strip (parsed from Material Setup section)
- Material Border SVG display (with scroll, correct stroke rendering)
- Toolpath rows (name, tool chip, time chip) below the SVG
- Sheet-level completion: Mark Complete modal (date/time, operator dropdown with Collin/Travis/Other, notes)
- Clear Record confirmation modal
- Progress bar (X of Y sheets complete)
- Active vs. Completed sections (completed sheets move to bottom)
- Resume banner if localStorage has records from a prior session
- Export CSV button
- Reset All button

### Pending / last known issue
- The toolpath list was reported as missing after the SVG section was added. A `try-catch` was applied around the SVG block and SVG insertion simplified to `scrollEl.innerHTML = sheet.layoutSvg`. **Needs confirmation from user that toolpaths now appear correctly below the SVG.**
- If toolpaths still missing: check browser console for `"SVG render failed:"` error, or verify `sheet.toolpaths` is not empty for the test file.

## Operators configured in modal
- Collin (default)
- Travis
- Other... (free-text input)

## Sample test file
`samples/260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html`
GMC Savana 3500 cargo van — has 1 Job Layout Sheet section (with SVG), 1 Material Setup section, 1 Toolpaths Summary section with 5 toolpath rows.
