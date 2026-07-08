# Delete Single Sheet From a Project — Design

## Problem
Operators can currently only delete an entire project (all sheets at once). There's no way to remove one mistakenly-uploaded or duplicate sheet without wiping the whole job.

## Behavior
Add `deleteSheetFromProject(sheet)` in `js/app.js`, modeled on the existing `deleteProject()` ([app.js:338](../../../js/app.js#L338)):

1. Confirm via native `confirm("Delete \"<sheet title or filename>\"? This removes its completion record and note for everyone.")`. Abort if the user cancels.
2. On confirm, await in parallel:
   - `Storage.deleteSheet(sheet.fileKey)`
   - `Storage.clear(sheet.fileKey, 'sheet')` (completion record)
   - `Storage.setSheetNote(sheet.fileKey, '')` (sheet note)
3. Remove the sheet from the local `sheets` array.
4. If the sheet's project (`currentProject`) now has zero sheets remaining, call `showProjectsScreen()` to return to the directory.
5. Otherwise, call `renderAllSheets()`. If the deleted sheet was the currently selected one, clear `selectedSheetKey` first so the existing fallback selection logic in `renderAllSheets()` (first active sheet, else first sheet) picks a new one.

## UI entry points
Both trigger the same `deleteSheetFromProject` flow:

1. **Sidebar row** — `buildSheetNavRow()` ([app.js:544](../../../js/app.js#L544)) gets a small trash-icon button (reusing the same SVG markup as the project card's delete button, [app.js:387](../../../js/app.js#L387)). Its click handler calls `e.stopPropagation()` so it doesn't also select the row.
2. **Detail header** — `buildSheetDetail()` ([app.js:613](../../../js/app.js#L613)) gets a "Delete Sheet" button placed next to the existing Add/Edit Note button in the hero header.

## Out of scope
- Renumbering remaining sheets — sheet order/number is derived from the filename via `sheetNumber()`, unaffected by deleting a different sheet.
- A custom confirmation modal — reuses the native `confirm()` pattern already used for project deletion, no new markup.

## Testing
Manual verification only (no test suite in this project). Test against a local offline copy per `CLAUDE.md`'s testing-safety instructions (temp copy with a `PASTE`-prefixed `projectId` in `firebase-config.js`), never the live Firestore config. Verify:
- Deleting a non-selected sheet from the sidebar leaves the current selection intact.
- Deleting the currently selected sheet re-selects a sensible remaining sheet.
- Deleting the last sheet in a project returns to the projects directory.
- Deleted sheet's completion/note records are gone (re-uploading the same file shows it as Incomplete with no note).
