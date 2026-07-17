# Instant Master Job Log Updates + HTML Archive — Design

**Date:** 2026-07-17
**Status:** Approved design, pending implementation plan
**Origin:** Resumes the direction agreed 2026-07-15 (recorded in Brain/Projects/CNC Job Tracker.md), with the four open questions resolved in this session.

## Goal

Replace the timer-based CSV sweep with direct writes to the Master Job Log at export time, and archive every uploaded VCarve job sheet HTML to a canonical Drive folder with its link recorded alongside the log row.

## Current state (what this replaces)

- Export CSV downloads an 8-column CSV. On the shop computer the browser's download folder is `My Drive\CSV Exports\`.
- A time-triggered Apps Script (`summarizeCNCJobs`) sweeps that folder every few minutes, blindly appends any CSV's rows to the Master Job Log sheet, and moves the file to Drive Trash.
- The original VCarve HTML files live scattered in transfer folders; nothing links a log row back to its source sheet.

## Decisions (resolved this session)

1. **Log rows append at Export CSV time** — one batch per job, per click. Not at per-sheet completion time.
2. **Clean-cut switchover** — the timer trigger is deleted and the shop browser's download folder repointed to plain Downloads on deploy day. No dual-running, no script-side dedupe.
3. **Light token check** on the endpoint — a fixed token in the request body, rejected if absent/wrong. Understood to be junk-filtering, not real auth (repo is public; same trust model as the committed Firebase config).
4. **Archive layout: subfolder per job** — `Job Sheet Archive/<job name>/<original filename>`.

## Architecture

One Apps Script **web app** (single script, single deployment URL) handling two actions. The browser app POSTs JSON with `Content-Type: text/plain;charset=utf-8` (this avoids CORS preflight, which Apps Script cannot answer) and `redirect: 'follow'`. All requests carry `{ token, action, ... }`; the script returns JSON via `ContentService`.

```
Upload flow:   handleFiles → saveSheet (Firestore)
                          └→ POST {action:'archive', fileName, jobName, html}   (fire-and-forget)
                             → script files HTML under Job Sheet Archive/<job>/
                             → returns { url }
                             → app writes archiveUrl onto sheets/{fileKey}

Export flow:   exportJob → CSV download (unchanged, 8 columns)
                        → POST {action:'appendRows', rows: [...9-column rows]}  (awaited)
                        → job ticket prints regardless of append outcome
                        → success: offer project delete (as today)
                        → failure: alert, NO delete prompt (job stays re-exportable)
```

## Components

### 1. Apps Script web app (pasted + deployed by Travis — no direct script access)

Constants at top, filled in at paste time: `TOKEN`, `ARCHIVE_FOLDER_ID`, `LOG_SPREADSHEET_ID`, `LOG_SHEET_NAME`.

- `doPost(e)`: parse `e.postData.contents` as JSON; reject bad/missing token with an error JSON; dispatch on `action`.
- **`archive`**: find or create subfolder named `jobName` under the archive folder; if a file with `fileName` already exists there, **overwrite its content** (keeps the same Drive file ID, so previously exported log links stay valid); otherwise create it. Return `{ ok: true, url }` (the file's Drive URL).
- **`appendRows`**: append the given rows to the log sheet in one `appendRow`/`setValues` batch, 9 columns wide. Return `{ ok: true, appended: n }`.
- Deployment: "Execute as me", "Anyone" access. Redeploying rotates the URL if the endpoint is ever abused.

### 2. `js/endpoint-config.js` (new, mirrors `firebase-config.js` pattern)

```js
const ENDPOINT_CONFIG = {
  url:   'PASTE_DEPLOYED_WEB_APP_URL',
  token: 'PASTE_TOKEN',
};
```

Every endpoint call site checks `ENDPOINT_CONFIG.url.startsWith('PASTE')` and no-ops when true — offline/test copies of the app skip the endpoint entirely, same convention as the Firebase kill switch.

### 3. App changes (`js/app.js`, `js/storage.js`)

- **Upload hook** (`handleFiles`): after `Storage.saveSheet(sheet)`, fire-and-forget the archive POST with the raw HTML string (`e.target.result` — the only moment the original HTML exists in-hand). On success, write the returned URL to the sheet doc via a new `Storage.setArchiveUrl(fileKey, url)` (Firestore merge-set). Never block or fail the upload on archive problems; `console.warn` only.
- **Export hook** (`exportJob`): build the log rows — the existing 8 CSV columns plus `archiveUrl` (empty string if the sheet has none) as column 9. CSV download itself is **unchanged at 8 columns** (Estimating App import contract). Await the append POST; only on success proceed to the existing delete-project prompt. On failure: `alert` that the Master Job Log was NOT updated and the project was kept so it can be re-exported later. Job ticket printing happens regardless.
- **Firestore schema**: `sheets/{fileKey}` gains optional string field `archiveUrl`. No migration needed; absent = blank link.

### 4. Master Job Log sheet

Gains a 9th column, header **"Archive Link"** (added manually by Travis once, at switchover). Script appends raw URLs. Existing ~119 rows keep a blank 9th column.

## Required behavior: delete → re-import

Deleting a sheet and re-importing the same file (or a batch including it) must work cleanly end-to-end — this is the scenario behind the 2026-07-17 stale-sync bug and must be verified, not assumed:

- Sheet identity is `simpleHash(filename)`; re-import recreates the same `fileKey`. The 2026-07-17 live-sync listener keeps every open tab's list current, so no stale-tab skip.
- Re-import re-sends the HTML to the archive, which overwrites the existing archived file **in place** (same file ID → old log links stay valid).
- Log rows are built only at export time from the then-current sheet list, so mid-job churn never touches the log.

## Error handling summary

| Failure | Behavior |
|---|---|
| Archive POST fails at upload | Non-blocking; sheet has no `archiveUrl`; its future log row has a blank link (tolerated, matches historic rows) |
| Append POST fails at export | Alert; CSV still downloads; delete prompt suppressed; project stays for re-export |
| Bad/missing token at endpoint | Script returns error JSON, writes nothing |
| Double export of the same job | Duplicate log rows possible — accepted limitation, unchanged from the old pipeline; the guard is the workflow (export ends by deleting the project) |

## Switchover runbook (one sitting, clean cut)

1. Travis pastes the Apps Script, fills constants (fresh token, archive folder ID, log spreadsheet ID), deploys, copies the web app URL.
2. Travis creates the `Job Sheet Archive` folder (if not already) and adds the "Archive Link" header to the Master Job Log.
3. App change ships with the real URL + token in `js/endpoint-config.js`; push to `master` (= live deploy).
4. Travis deletes the `summarizeCNCJobs` timer trigger and repoints the shop browser's download folder from `My Drive\CSV Exports\` to plain Downloads. The `CSV Exports\` folder is retired.
5. Live verification: upload a sheet (archived file + link appear), delete/re-import it (archive overwritten, no duplicate), export a real job (rows + links land in the log instantly, CSV downloads, delete prompt appears).

## Testing

- **Never test against the production log or archive.** The script's constants make targets swappable: verification before switchover uses a throwaway spreadsheet + folder ID, exercised via `curl` POSTs (both actions, plus bad-token rejection), then the constants are pointed at the real targets.
- App-side logic is testable offline via the `PASTE` placeholder convention (endpoint calls no-op; export flow must still download the CSV and reach the delete prompt as today).

## Out of scope (per the 2026-07-15 agreement)

- Backfilling archive links for the ~119 existing Master Job Log rows (manual backfill possible later).
- Archiving sheets already in Firestore before this ships — their original HTML is gone; only fresh uploads get archived.
- Any change to the 8-column CSV download or the Estimating App import.
