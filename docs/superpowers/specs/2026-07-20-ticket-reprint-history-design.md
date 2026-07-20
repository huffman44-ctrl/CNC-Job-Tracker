# Job Ticket Reprint History — Design

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan
**Origin:** Discovered a real bug during live verification of the instant-logging/archive switchover (see `2026-07-17-instant-logging-html-archive-design.md`): the job ticket's `window.print()` call, which runs after an awaited network request, gets silently blocked by Chrome once the request takes long enough to lose the original click's "user activation." Fixing the ordering solves the immediate bug; this design adds a durable safety net and a real feature Travis asked for on top of it.

## Goal

1. Fix the print-timing bug: the auto-print at export time must fire before any `await`, not after.
2. Let Travis reprint any past job's ticket on demand, indefinitely — jobs are fully deleted from Firestore right after export today, so there's currently no way to get a ticket back once that happens (whether print failed, was closed by accident, or a copy is needed later for records).

## Current state (what this changes)

- `exportJob()` calls `printJobTicket(jobName, jobSheets)` *after* `await Endpoint.appendLogRows(...)` — a real network round-trip. Chrome can silently drop `window.print()` once enough time has passed since the triggering click.
- Once `deleteProject(jobName)` runs (right after a successful export, on user confirmation), every trace of that job — sheets, completions, notes — is gone. The ticket that printed (or should have printed) at that moment is the only record; if it's lost, it's gone for good.

## Approaches considered

- **New Firestore collection for ticket records (chosen).** Matches every other piece of app state (`sheets`, `completions`, `projectNotes`, `sheetNotes` are all Firestore collections with the same live-query pattern). No new server endpoint, no Apps Script redeploy.
- **Derive history from the Master Job Log spreadsheet.** Rejected — the log is one row per sheet with no concept of "one export event," so grouping rows back into a single job+ticket is ambiguous (a job name can recur over time). Would also require a new Apps Script action, meaning another live redeploy of a script real operators depend on.
- **Store ticket records as files in Drive**, alongside the sheet archive. Rejected as unnecessarily heavy for four small fields; Firestore is already the right tool and the existing pattern.

## Architecture

```
Export flow (fixed order):
  exportJob()
    → CSV download (unchanged)
    → printJobTicket(jobName, jobSheets)      [now BEFORE the await — fixes the bug]
    → Storage.saveTicketRecord({...})         [fire-and-forget; independent of print or log-append outcome]
    → await Endpoint.appendLogRows(...)
    → success: delete-project prompt (as today)
    → failure: alert, no delete prompt (unchanged)

Reprint flow (new):
  Projects directory → "Ticket History" link → Ticket History screen
    → loads ticketHistory collection (newest first)
    → search box filters by job name (client-side, same pattern as project search)
    → click Print on a row → fills #job-ticket-name/#job-ticket-meta from the STORED
      record (not live sheet data, since the job may no longer exist) → window.print()
      called synchronously in the click handler, no awaits before it
```

## Components

### 1. Firestore: new `ticketHistory` collection

One document per export, written by `Storage.saveTicketRecord()`:

```js
{
  jobName:       string,
  sheetCount:    number,
  completedDate: string,   // ISO date used for the ticket's date line — the same
                           // "latest completedAt across sheets" logic printJobTicket
                           // already computes; falls back to export time if none
  exportedAt:    string,   // ISO timestamp, used to sort the history list
}
```

No expiry, no cleanup — kept indefinitely, same retention as the Master Job Log.

### 2. `js/storage.js` additions

- `saveTicketRecord(record)` — `db.collection('ticketHistory').add(record)`. Best-effort; a failure here must never block or alert during export (wrap in try/catch, `console.warn` only — same tolerance as the existing archive-upload failure handling).
- `loadTicketHistory()` — one-time `db.collection('ticketHistory').orderBy('exportedAt', 'desc').get()`, returns the array of records for the history screen. (A live `onSnapshot` isn't needed here — this list only changes when someone exports a job, and the screen is opened on demand, not left open in the background like the projects directory.)

### 3. `js/app.js` changes

- **`exportJob()` reorder:** move the `printJobTicket(jobName, jobSheets)` call to immediately after the CSV download block, before the `try { await Endpoint.appendLogRows(...) }`. Immediately after (still synchronous-adjacent, but Firestore writes have no user-activation constraint so ordering relative to the print call doesn't matter for this one), call `Storage.saveTicketRecord(...)` using the same job name / sheet count / latest-completed-date logic already computed inside `printJobTicket` — factor that date computation out into a small shared helper (`ticketMeta(jobName, displaySheets)`) so both the print call and the history record use identical logic instead of duplicating it.
- **New screen: Ticket History.** A new `<div id="ticket-history-screen" hidden>` peer to the existing screens (projects/upload/content), following the same `showXScreen()` toggle pattern already used throughout `app.js`. Contains a search input (filters the in-memory loaded list by job name substring, same approach as `projectSearchEl`) and a list of rows (job name, sheet count, date, Print button), newest-first.
- **New function `reprintTicket(record)`:** sets `#job-ticket-name`/`#job-ticket-meta` text directly from the stored record's fields (no `Storage.get()` lookups — the original sheets may no longer exist), then `ticket.hidden = false` → `window.print()` → `finally` restore, mirroring `printJobTicket`'s existing structure. Must be called directly from the row's click handler with nothing async in between.
- **Entry point:** a "Ticket History" link/button on the Projects directory screen header, next to the existing search/sort controls, calling a new `showTicketHistoryScreen()` which calls `loadTicketHistory()` and renders the list.
- **Back navigation:** a back button on the Ticket History screen returns to the Projects directory, same pattern as `back-to-projects-btn`.

### 4. `index.html` additions

- New `#ticket-history-screen` markup: header with a search input and a back button, a container for the rendered row list.
- A "Ticket History" button added to the existing projects-screen header markup.

No changes to the existing `#job-ticket` print markup — both `printJobTicket` and `reprintTicket` reuse the same hidden ticket element and CSS.

## Error handling summary

| Failure | Behavior |
|---|---|
| `saveTicketRecord` write fails | `console.warn` only; export continues normally (CSV, print, log-append, delete-prompt all unaffected) — matches existing tolerance for the sheet-archive write |
| `loadTicketHistory` fails (offline, Firestore error) | Show an inline error message on the Ticket History screen ("Couldn't load ticket history"); no crash |
| Reprint on a record whose job was later re-exported under the same name | Both records exist independently in history (one row per export event, not deduplicated by job name) — accepted, matches how the Master Job Log already allows repeated job names over time |

## Out of scope

- Any UI for deleting/editing ticket history records — indefinite retention, no cleanup tooling, matches the Master Job Log's own "never delete" convention.
- Multi-select / batch reprint of several jobs at once — confirmed with Travis this isn't the actual need; one-at-a-time reprint from the history list is sufficient.
- Backfilling history records for jobs exported before this ships — history starts from the day this feature ships forward, same convention as the archive-link backfill being out of scope in the prior design.
