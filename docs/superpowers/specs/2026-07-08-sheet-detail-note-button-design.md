# Sheet Detail Note Button — Design Spec

Date: 2026-07-08
Status: Approved (brainstorming session, Sonnet 5)

## Goal

Add a second entry point for editing a sheet's instruction note directly from the sheet detail panel, instead of requiring a trip through the project card's notes modal every time.

## Relationship to the original sheet-notes design

[[2026-07-03-sheet-notes-design]] deliberately kept the detail panel and sidebar free of any edit affordance ("No Add/Edit note button anywhere on the detail panel or sidebar") so the operator had nothing to accidentally click — honor-system placement, not auth enforcement. This spec supersedes that one constraint: a note button is added to the detail hero header. Everything else from that spec (storage, callout, sidebar icon, job note banner, no auth) is unchanged.

## UI

**Detail hero header (`detail-hero-top`):**
- A ghost-style button/icon reading **"Add Note"** (no existing note) or **"Edit Note"** (note exists) sits to the right of `.detail-titles`, which is `flex:1` so it's pushed to the far edge of the header.
- Styled for the dark hero gradient background — translucent white, same treatment as the existing dark-mode ghost button on project cards.
- Clicking it opens a new single-sheet note modal.

**New modal (`sheet-note-overlay`):**
- Mirrors the existing modal pattern (Mark Complete / Project Notes): title = the sheet's `sheetTitle || fileName`, one textarea pre-filled with `Storage.getSheetNote(sheet.fileKey) || ''`, Cancel/Save actions.
- Save calls `Storage.setSheetNote(sheet.fileKey, text)` (empty text deletes the note, consistent with existing behavior), closes the modal, and re-renders the detail panel so the callout and header button label update immediately.
- Cancel discards and closes without writing.

**Sidebar nav row:** unchanged — still shows the note icon when `Storage.getSheetNote()` is truthy.

**Project card notes modal:** unchanged — the "Sheet Notes" section listing every sheet in the project stays as a second path to the same data. Both paths write to the same `sheetNotes/{fileKey}` doc, so edits from either place sync live via the existing `onSheetNoteChange` listener (editing from the new modal while the project modal happens to be open elsewhere, or vice versa, is a non-issue in practice — same-file races are already handled by cache-first writes + live listener re-render).

## Data flow

No storage changes. Reuses `Storage.getSheetNote` / `Storage.setSheetNote` exactly as they exist today. The only new code is in `js/app.js` (button + modal open/save/cancel wiring) and `index.html`/`css/style.css` (modal markup + header button styling).

## Error handling

Same regime as existing notes: cache-first write, console warning on Firestore failure, live listener re-renders on remote change.

## Testing

Offline copy with `PASTE` projectId per CLAUDE.md (Firebase skipped, in-memory only): open a sheet with no note, click Add Note, save, confirm callout + sidebar icon + header label ("Edit Note") all update; reopen modal, confirm textarea is pre-filled; clear text and save, confirm note and icon disappear; confirm editing via the project card modal still works and stays in sync with the new button's label/callout.

## Non-goals

- No change to auth/gating (still none — honor system, as before).
- No change to the project card modal's existing per-sheet fields.
- No change to completion notes or the job note banner.
