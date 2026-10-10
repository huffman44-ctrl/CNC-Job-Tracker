# Upload guard module

Status: ready-for-agent

Date: 2026-10-10. From a grilling session with Travis (improvement candidate #3). Built on branch `upload-guard` off `master`.

## Problem Statement

Dropping Aspire setup sheets is what Collin does every day, and the upload is the guard that stops a finished (possibly billed) sheet from ever being overwritten. All of it lives inside the screen code in `app.js` (`handleFiles`), so only the slow PASTE browser check can test it. Reading it turned up gaps:

- **An unreadable file stalls the whole drop.** There is no read-error handler, so the batch never finishes: no message, no `jobs/` doc, no owner job-details step (the other sheets do save).
- **The database read is wasted in one case.** A sheet that is on the board in the database but not yet on this computer's board (another device just uploaded it) is overwritten by a re-drop, losing its archive link and upload time — even though the guard just read it.
- **Any HTML file is accepted.** A file that isn't an Aspire setup sheet lands on the board as an empty sheet named after the file.

## Solution

A module, `js/upload-batch.js` (`UploadBatch`), decides what happens to every file in a drop and builds the one combined message. `app.js` keeps the screen work (file list, banners, navigation, the owner job-details step).

## User Stories

1. As Collin, I want a file that can't be read to be reported, so that the rest of my drop still finishes and I know to drop that one again.
2. As Collin, I want re-dropping a sheet that's already on the board to change nothing, even if this computer hasn't caught up yet, so that a saved sheet is never replaced.
3. As Collin, I want a file that isn't an Aspire setup sheet refused with a plain message, so that junk never lands on the board.
4. As Travis, I want a finished sheet never to be overwritten by a re-drop (unchanged), so that billed work stays as billed.
5. As Collin, I want every other message to stay the same, so that uploading feels the same.
6. As a maintainer, I want the upload decisions tested at one seam, so that changes to the guard are checked by `npm test`, not only the browser check.

## Implementation Decisions

- **`UploadBatch.run(files, deps)`** — `files`: `[{ name, read: () => Promise<string> }]` (app.js wraps FileReader so a read error rejects). Files are processed concurrently as today. Returns `{ saved: [{ sheet, mode }], alreadyLoaded: [name], finishedBefore: [{ name, doc }], unchecked: [name], unreadable: [name], notSheets: [name], saveFailed: [{ name, message }], savedByJob: Map(jobName -> [fileKey]) }`. Never shows anything; never rejects for a per-file problem.
- **deps:** `parse` (parseJobSheet), `onBoard(fileKey)`, `addToBoard(sheet)`, `removeFromBoard(fileKey)`, `getSheetDoc`, `saveSheet`, `archive(fileName, jobName, text)` → Promise<url|null>, `setArchiveUrl(fileKey, url)`.
- **Per file, in order:** read (fails → unreadable) → parse → not an Aspire sheet → notSheets → key = `Keys.sheet(name)` → on this board or claimed by an in-flight upload → alreadyLoaded (the check and the claim are synchronous together) → `getSheetDoc` (throws → unchecked) → finished → finishedBefore; exists unfinished → alreadyLoaded (new) → add to board, save (fails → saveFailed, removed from board) → archive after the save whatever its result (as today) and attach the URL.
- **In-flight claims** live in the module (one Set per page), released when the file is done, so a second drop during a first one still sees the claim.
- **"Is an Aspire setup sheet"**: has any of a job title, toolpaths, material setup, or a layout drawing. Checked against every sheet in the Drive "Job Sheet Archive" before shipping — none may be refused.
- **Messages** — `UploadBatch.notice(result, formatDT)` returns the one combined notice or null. Existing lines unchanged; new lines:
  - unreadable: `Couldn't read "X" — drop it again.`
  - not a sheet: `"X" isn't an Aspire setup sheet, so it wasn't added.`
  Save-failure and oversize banners stay in app.js, shown from the result.
- An unexpected error while processing a file still counts as unchecked (as today).
- **No change to:** Firestore rules, what is saved, the Drive archive, Keys, the owner job-details step, job docs.

## Testing Decisions

- **One test point: `UploadBatch.run` + `notice`** with fake deps. Cases: new sheet saved, on board, archived with URL set, grouped by job; already on the board; same name twice in one drop; finished in the database; in the database unfinished but not on this board (new); database read fails; unreadable file while the rest finishes (new); not a sheet (new); save fails (removed from board, still archived); oversize; a second drop while the first is still checking; the notice text.
- Both PASTE browser checks pass (they already cover the guard end to end).
- Review: a fresh Opus reviewer. No Fable: nothing about who may read or write changes.

## Out of Scope

- Replacing an on-board sheet by re-dropping it.
- Any change to the finished-sheet rule or its message.
- Reading the files' contents for duplicates under different names.
