# Print Ticket button + Export finish module — spec

Date: 2026-10-10. Status: agreed with Travis (grilling session), not started.

Two separate changes, shipped in this order, each on its own branch, each pushed only after
Travis OKs it (a push to `master` is a live deploy to the shop floor).

---

## Change 1 — Print Ticket button

### Problem
Collin sometimes wants the job ticket mid-job. The only way to print it today is **Export CSV**,
which also downloads the CSV, writes the Master Job Log and — once the log write succeeds —
marks the job finished and takes it off the board. Skipping the CSV save does not stop that.

### Behaviour
- New button **Print Ticket** in the job screen header (`index.html`, the row holding
  `vanlab-print-btn` / `export-btn` / `reset-btn`), placed immediately left of **Export CSV**.
  Same style as its neighbours: `btn btn-ghost btn-sm`, id `print-ticket-btn`.
- Visible to everyone (Collin and owners). No feature switch.
- Click → `printJobTicket(currentProject, getDisplaySheets())` — the function already exists
  (`js/app.js`, currently has no caller). It prints the same ticket Export prints.
- Prints only: **no** CSV, **no** Master Job Log write, **no** finish, **no** Ticket History
  record. The job stays on the board.
- Ticket wording unchanged ("N sheets — completed <date>"; mid-job the date is the latest
  sheet cut so far, or today if none).
- Project cards on the Projects screen are not changed.

### Checks
- Update the exact header-button assertions in `tools/browser-check-phase1.mjs` (line ~85)
  and `tools/browser-check-phase2.mjs` (line ~182) to include `print-ticket-btn` before
  `export-btn`.
- Add to the phase-1 browser check: clicking Print Ticket calls `window.print`, starts no
  download, writes no log, and the sheets are still on the board afterwards.
- Look at the job header at phone width (375 px) — five buttons must not overflow the screen.
- Bump `js/app.js?v=` in `index.html`. Shop PC needs Ctrl+Shift+R after the deploy.

---

## Change 2 — Export finish module (refactor only)

### Problem
`exportJob` (`js/app.js` ~line 1637, called from the header Export button and the project
card's Export button) mixes the CSV build, download, ticket print, Master Job Log write, the
finish writes and the choice of failure message. The rules that protect the board have no
direct tests — only the browser check's happy path touches them:
- never finish a job unless the log write succeeded;
- an "offline" log result (endpoint not configured) counts as logged only in PASTE mode;
- job doc is finished before the sheets;
- which message Collin reads for each failure.

### Rule: behaviour-identical
Same order of steps, same messages word for word, same writes. Any weakness found goes on the
follow-up list below for Travis to decide — not fixed in this change.

### What moves
New file `js/export-finish.js`, module `ExportFinish`, same loading pattern as
`js/log-rows.js` (browser global, `require` fallback for `node --test`). Loaded in
`index.html` after `log-rows.js`.

Interface — two functions:

1. `ExportFinish.csvFile(jobSheets, completionOf, customerName) → { name, text }`
   Pure. The 9-column CSV (Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed At,
   Operator, Notes, Customer — the Estimating App import contract), quoting/escaping as today,
   rows joined with `\r\n`, and the download name `CNC Job Exports/<sanitized customer>/<base>.csv`.
   `completionOf(fileKey)` returns the completion record or null.

2. `ExportFinish.logAndFinish({ jobName, jobSheets, customerName, by }, deps)`
   `→ Promise<{ finished: true } | { finished: false, message }>`
   Writes the Master Job Log (one `LogRows.build` row per sheet), then — only if that
   succeeded — finishes the job doc, then the sheets. Returns the exact text Collin should see
   when it does not finish; never calls `alert` itself.
   `deps` (the real collaborators, faked in tests):
   `logEnabled()`, `getIdToken()`, `upsertLogRows(rows, token)`, `completionOf(fileKey)`,
   `hasDatabase()`, `finishJob(jobName, by)`, `finishSheets(sheets, by)`.

Stays in `app.js`: the "No sheets loaded" guard, the download click, `ticketMeta` /
`showTicketAndPrint` / `saveTicketRecord` (the print must run inside the click — Chrome drops
`window.print()` after a network wait), the `alert` of the returned message, and removing
finished sheets from the in-memory board.

### Tests (written first, `test/export-finish.test.mjs`)
- `csvFile`: header row, a complete sheet, an uncut sheet, a V-bit sheet, quotes and line
  breaks in notes, the file name.
- `logAndFinish`, one test per outcome:
  - log OK → job then sheets finished, in that order → `{ finished: true }`;
  - log offline in PASTE mode (`hasDatabase` false) → finished;
  - log offline with a database → not finished, "connection isn't set up" message;
  - sign-in token fails → not finished, sign-out-and-back-in message;
  - endpoint returns an error → not finished, message carries the endpoint's text;
  - endpoint unreachable → not finished, "(endpoint unreachable)";
  - finish fails after the log was written → not finished, "log was updated … stays on the
    board" message; and no `finishSheets` call when `finishJob` throws.
- Both browser checks still pass (`node tools/browser-check-phase1.mjs`,
  `node tools/browser-check-phase2.mjs` → `SUITE: PASS`).
- Review by a fresh Opus subagent before asking to push.

### Housekeeping
- Add `js/export-finish.js` to the file-structure list in `CLAUDE.md`.
- Bump `app.js?v=` and add `export-finish.js?v=1` in `index.html`.

---

## Follow-ups noticed (not in scope — Travis decides)
1. **Jobs may have been finished early.** If Collin used Export to print a mid-job ticket,
   those jobs left the board. Needs a person: ask Collin; owners can see finished jobs and use
   Put back.
2. **Job finished before its sheets.** If the sheets write half-fails, the job doc says
   finished while some sheets are still on the board. A retry re-runs both, so it heals, but it
   is not atomic.
3. **Project-card Export has no Print Ticket next to it.** Left alone on purpose to keep
   change 1 small.
