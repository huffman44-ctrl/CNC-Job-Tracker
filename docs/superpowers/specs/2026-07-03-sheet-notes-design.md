# Per-Sheet Instruction Notes — Design Spec

Date: 2026-07-03
Status: Approved by Travis (brainstorming session, Fable 5)

## Goal

Let Travis attach an instruction note to each individual sheet inside a project, shown prominently and read-only to the operator when he opens that sheet. Also surface the existing job (project) note inside the sheet view so it stays visible while cutting. Builds on the master-detail UI committed in 83e4fde.

## The two note channels (core concept)

Notes are one-directional and must not be confused with each other:

1. **Instruction notes** (this feature) — written by Travis, read by the operator. Job-level note (already exists) and the new per-sheet notes. **No edit controls appear anywhere in the sheet view** — the operator has nothing to accidentally click. This is honor-system placement, not auth enforcement (the app has no sign-in; the Google-auth work is shelved separately). Travis accepted this explicitly.
2. **Completion notes** (already exists, unchanged) — written by the operator in the Mark Complete modal when finishing a sheet. His channel back to Travis.

## Storage

New Firestore collection **`sheetNotes/{fileKey}`** — one doc per sheet, `{ text }`, keyed by the same `fileKey` (`simpleHash(filename)`) that namespaces `sheets/` and `completions/`.

`js/storage.js` gains `getSheetNote` / `setSheetNote` / `loadSheetNotes` / `onSheetNoteChange`, copied from the `projectNotes` pattern: in-memory cache for synchronous reads, cache-first async writes, `onSnapshot` live sync across devices.

Rejected alternatives: storing the note in the `completions/` doc (Clear Record / Reset All would wipe instructions) or in the `sheets/` doc (re-uploading a sheet would clobber the note).

Saving an empty note deletes the doc. Deleting a project deletes its sheet notes along with its sheets and completions. The `PASTE` projectId offline-testing escape hatch applies as usual.

## UI

**Sheet detail panel (operator-facing, read-only):**
- When the selected sheet has a note, a highlighted callout renders at the very top of the detail panel, above the material strip — amber-tinted, pin/note icon, labelled "Note", dark-mode aware. First thing seen on selecting the sheet.
- No Add/Edit note button anywhere on the detail panel or sidebar.

**Sidebar (`sheet-nav`):**
- Sheets that have a note show a small note icon in their nav row, so sheets carrying instructions are visible at a glance.

**Job note banner (content screen):**
- When the project has a job note, it renders as a read-only banner under the progress header and above the workspace (sidebar + detail), so it stays visible regardless of which sheet is selected. Live-updates via the existing `onNoteChange` listener. Editing the job note still happens only from the project card.

**Notes editor (Travis-facing, projects screen):**
- The project card's existing Add Note / Edit Note button opens an **expanded notes modal**: the job note textarea at top (as today), followed by one labelled note field per sheet in that project, in numeric sheet order (reusing `getDisplaySheets` ordering logic against that project's sheets).
- Save writes the job note plus any changed sheet notes; cleared fields remove their notes. Cancel discards.
- The project card's note preview continues to show the job note only.

## Error handling

Same regime as existing notes: writes are cache-first so the UI never blocks; Firestore failures log a console warning. Live listeners re-render the projects grid / sheet view on remote changes, as `onNoteChange` and `onCompletionChange` already do.

## Testing

Offline copy with `PASTE` projectId per CLAUDE.md (Firebase skipped, in-memory only): seed a project with several sheets, verify — expanded modal saves/clears job + sheet notes; callout renders only on sheets with notes; sidebar icons match; job-note banner shows in sheet view and is not editable there; operator flow (select sheet, mark complete with completion note) untouched. Browser click-through with screenshots before touching prod.

## Non-goals

- Any auth/PIN gating of note editing (revisit if honor system proves insufficient — Travis: "if I don't like it I can change it later").
- Changes to completion notes, CSV export columns, or the shelved kit-orders/auth work.
