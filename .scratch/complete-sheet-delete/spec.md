# Complete sheet delete

Status: ready-for-agent

Date: 2026-10-10. From a grilling session with Travis (improvement candidate #2). Build on a fresh branch off `master`.

## Problem Statement

A sheet's record is spread over four documents that share its key: the sheet itself, its completion ("cut") record, its sheet note, and its layout markup. Deleting a sheet removes them one by one, and every step hides its own failure:

- **Billed sheets can lose their cut record.** The database correctly refuses to delete a sheet that is on an invoice (in progress or billed). But the delete still removes that sheet's completion record, note and markup, because those are always writable. If Collin or an owner deletes a partly billed job, already-billed sheets can quietly lose their cut records. The invoice keeps its own snapshot, so money is safe, but those sheets show as not cut on the board.
- **Failed deletes are silent.** Every step logs a failure to the console and carries on. The screen removes the sheet straight away whatever happened, so a sheet that failed to delete disappears and then reappears on the next reload, with no message.
- **Three ways to delete, three behaviours.** The project card's trash icon and the sheet's Delete button each make the same four calls separately. The Cancel button on the owners' job-details step (after an upload) removes only the sheet itself, which can leave a completion, note or markup behind for that key.

## Solution

Deleting a sheet becomes one complete action, used by all three entry points:

1. The sheet itself goes first. Its completion record, note and markup are removed only once that has worked, so a refused delete never touches the rest of the record.
2. A sheet that is on an invoice stays on the board, and the operator gets one plain message saying how many sheets weren't deleted because they're on an invoice, and to ask Travis or Eva.
3. A sheet that fails for any other reason (lost connection, timeout) stays on the board too, with a message naming it and saying to try again.
4. The screen updates once the database has answered and removes only what was actually deleted. No more vanishing and reappearing.
5. Deleting several sheets (a whole job) deletes everything that can be deleted, and reports the rest in one message.

## User Stories

1. As Collin, I want deleting a sheet to remove its cut record, note and markup along with it, so that nothing is left behind for that sheet.
2. As Collin, I want a sheet that couldn't be deleted to stay on the board, so that what I see matches what's really saved.
3. As Collin, I want to be told when a delete didn't work, so that I don't think a sheet is gone when it isn't.
4. As Collin, I want the message to say why (on an invoice, or a connection problem), so that I know whether to retry or ask an owner.
5. As Collin, I want deleting a whole job to delete every sheet it can and tell me about the rest, so that one blocked sheet doesn't stop the whole delete.
6. As Collin, I want a failed delete never to wipe a sheet's cut record, so that the board still shows which sheets were cut.
7. As Collin, I want the same confirm prompts I see today before anything is deleted, so that deleting feels the same.
8. As Collin, I want the board to update only after the delete has finished, so that a sheet doesn't vanish and then come back after a reload.
9. As Collin, I want to be able to retry a failed delete straight away, so that a dropped connection is a minor annoyance, not a support call.
10. As Travis, I want billed sheets protected from losing their records when someone deletes a partly billed job, so that the board and the invoices tell the same story.
11. As Eva, I want the same protection, so that either owner can trust the board after a delete.
12. As an owner, when I cancel the job-details step after an upload, I want the sheets that upload saved removed completely, so that a cancelled upload leaves nothing behind.
13. As an owner, I want Cancel to keep touching only the sheets that upload saved, never sheets that were already on the board, so that cancelling can't remove earlier work.
14. As an owner, I want the "on an invoice" message to point operators to Travis or Eva, so that I hear about it rather than it being silently ignored.
15. As Collin or an owner, when the last sheet of a job is deleted, I want to land where I do today (Projects or Upload), so that navigation doesn't change.
16. As Collin, when the sheet I'm looking at is deleted, I want the detail panel to move on as it does today, so that I'm not left staring at a sheet that's gone.
17. As anyone with the app open on another device, I want deletes to show up there through the live updates as today, so that every screen agrees.
18. As a maintainer, I want one place that knows which documents make up a sheet's record for deleting, so that adding a fifth per-sheet document is a one-place change.
19. As a maintainer, I want that action to report deleted / blocked / failed sheets, so that every screen can tell the operator the truth.
20. As a maintainer working in PASTE test mode, I want deletes to keep working in memory with no database, so that offline test runs behave as today.
21. As a maintainer, I want the in-memory caches cleared only for sheets that were really deleted, so that the app's view of a sheet never runs ahead of the database.
22. As Travis, I want this to change nothing about who is allowed to delete what, so that it needs no Firestore rules change and no rules deploy.

## Implementation Decisions

- **One storage function deletes a list of sheets.** It lives in the operator storage module next to the existing per-sheet helpers. It takes a list of sheet keys (one sheet or a whole job) and reports three groups: deleted, blocked (on an invoice), and failed (any other error, with its message). It never throws for a per-sheet failure, and it never shows anything itself.
- **Order within a sheet:** delete the sheet document first. Only after that succeeds, remove the completion record, the sheet note and the layout markup. If the sheet delete fails, leave the other three untouched, caches included.
- **Blocked versus failed:** the database refuses an operator's delete of an on-board sheet only when its billing record says in progress or billed. Finished sheets are never on the board, so they don't reach this path. So a permission-denied refusal on the sheet delete counts as blocked (on an invoice), and any other error counts as failed. Collin's browser cannot read billing records, so the function finds out by trying rather than checking first.
- **After the sheet is gone:** a failure removing the completion record, note or markup does not undo the sheet delete. Report the sheet as deleted, and log the leftover failure so it can be found. These three documents are always writable by operators, so this is unlikely.
- **Caches:** clear a sheet's in-memory entries (completion, note, markup) only once the sheet document is really deleted.
- **PASTE mode (no database):** everything is deleted from memory and reported as deleted.
- **The three entry points use the function and wait for its answer:** the project card's trash icon (every sheet in the job), the sheet's Delete button in the job view, and the owners' job-details Cancel (only the sheets that upload saved). Each removes only the reported deleted sheets from the board, then navigates exactly as today: last sheet gone → Projects or Upload, selected sheet gone → selection cleared.
- **Messages,** shown in the app's existing notice dialog, one combined notice per delete action:
  - blocked: "N sheet(s) weren't deleted because they're on an invoice. Ask Travis or Eva."
  - failed: names the sheet(s) and says to check the connection and try again.
- **Confirm prompts are unchanged.**
- **The existing per-sheet helpers stay** for their other callers: editing a note, clearing markup, Reset All clearing completions. Only the delete paths move to the new function.
- **No change to:** Firestore rules, job-level documents (project note, project customer, jobs, job details), owner billing records (never deletable by rule), the Drive archive of uploaded sheets.

## Testing Decisions

- **A good test** calls the new delete function the way the screens do and checks what comes back (deleted / blocked / failed) and what is left in the fake database and the caches afterwards. It never checks the order of internal calls except where order is the behaviour, such as "the completion record survives when the sheet delete is refused".
- **One test point: the new storage delete function.** Cases:
  - one sheet with a completion, note and markup → all four documents gone, reported deleted;
  - sheet delete refused as permission-denied → reported blocked, and its completion, note and markup are still there (the billed-sheet protection);
  - sheet delete fails with another error → reported failed with its message, and the other three documents untouched;
  - a job of three sheets, one blocked → two deleted, one blocked, reported together;
  - the sheet goes but its note delete fails → still reported deleted;
  - caches cleared only for deleted sheets;
  - PASTE mode (no database) → all reported deleted, caches cleared.
- **Prior art:** the in-memory fake Firestore helper in the test helpers folder, which has a hook to make writes fail as permission-denied. The owner-storage and invoice-store tests use it today. The existing operator storage tests (finished flag, annotations, customers) show how to load the operator storage module under `node --test`.
- **Screens:** extend the phase-1 PASTE browser check so deleting a sheet and deleting a job still remove them from the board and navigate as today. Both browser checks and the full `npm test` suite must pass.
- **Review:** a fresh Opus reviewer before asking Travis to push. No Fable: nothing about who may read or write changes.

## Out of Scope

- Deleting or keeping job-level documents (customer, job note, job details) and owner billing records. Kept as today, by decision.
- Any change to Firestore rules.
- The re-upload guard and upload flow (improvement candidate #3, a later session).
- Shared job/customer key helpers (candidate #4).
- Undo or a trash bin for deleted sheets.
- Owners pre-checking billing state before trying a delete.

## Further Notes

- The billed-sheet case needs a partly billed job still on the board to be deleted. That's rare, but when it happens the damage today is silent.
- A push to `master` is a live deploy to the shop floor. Ask Travis before pushing, and the shop computer needs Ctrl+Shift+R afterwards.
- Plan agreed with Travis: build this in a new session with `/mattpocock-skills:implement`. Candidate #4 can be grilled and built in that same session; #3 comes after this is live.
