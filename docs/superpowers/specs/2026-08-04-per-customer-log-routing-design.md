# Per-customer tab routing for the Master Job Log — design

**Date:** 2026-08-04
**Status:** Approved by Travis (this session)

## Problem

Exports fail with "Master Job Log was NOT updated (endpoint unreachable)."
Root cause (confirmed 2026-08-04): the live Apps Script endpoint ("CNC Tracker
Endpoint") still has `LOG_SHEET_NAME = 'Sheet1'`, but Travis reorganized the
Master Job Log spreadsheet (`1oVUCVrcADRxiS1cw9GLO4sduwRwcreQfLiPfGI2ySXE`)
into per-customer tabs — currently "Orville - Season 4", "Trio Flatmount",
"VanLab". `getSheetByName('Sheet1')` returns null, the script replies
`{ok:false, error:'log sheet not found'}`, and the client shows its generic
"endpoint unreachable" alert regardless of the real cause.

Rather than repoint `LOG_SHEET_NAME` at one tab, build what the reorg implies:
each export's rows route to the tab matching that job's Customer.

## Decision summary

- **Approach:** server-side routing by the Customer column (10th column of each
  row, sent by the client since the 2026-07-27 customer-tagged-export feature).
  The client needs no change for routing to work.
- **Unknown customer → auto-create the tab** (Travis's call, this session).
- **Add-on:** the export failure alert in the web app must show the endpoint's
  actual error instead of always claiming "endpoint unreachable."

## Endpoint changes (`apps-script/logging-endpoint.gs` → live script)

The repo file stays a placeholder-constants template; the real deploy is a
hand-paste into script.google.com (existing workflow).

1. Delete the `LOG_SHEET_NAME` constant.
2. `appendRows` (still called under the existing full-duration `LockService`
   lock — unchanged concurrency story):
   - Validate rows exactly as today (array of 9- or 10-column rows).
   - Group rows by Customer: 10th column, trimmed. 9-column rows and rows with
     an empty Customer group under the literal name `Unassigned`.
   - For each group, resolve the target tab in the log spreadsheet:
     - **Find:** compare the customer name against every existing tab name,
       both sides trimmed and lowercased. First match wins.
     - **Create (if no match):** `insertSheet` at the end of the spreadsheet,
       named with the sanitized customer name; write the standard header row
       `Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed Time,
       Operator, Final Notes, Archive Link, Customer` and freeze row 1
       (matches the hand-made tabs).
     - **Sanitizing (creation only):** replace characters Sheets forbids in
       tab names (`/ \ ? * [ ]`, plus a leading apostrophe) with `-`,
       truncate to 100 chars. The row data keeps the original name untouched.
   - Append each group with one `getRange(...).setValues(...)` per tab, same
     width-from-payload behavior as today (9- or 10-column rows both land).
   - Reply `{ok:true, appended:<total rows>}` — response shape unchanged, the
     client stays oblivious to tabs.
3. Everything else (`archiveSheet`, token check, error envelope) unchanged.

## Web app change (`js/app.js`, `exportJob`)

Today every append failure alerts "Master Job Log was NOT updated (endpoint
unreachable)." Change: when `Endpoint.appendLogRows` throws an error carrying
an endpoint-supplied message (the `{ok:false, error}` path in `js/endpoint.js`),
include it: *"Master Job Log was NOT updated: <reason>. The CSV still
downloaded. The job was kept so you can export it again later."* Only a genuine
network/timeout failure (fetch rejection with no endpoint message) keeps the
"endpoint unreachable" wording. Behavior is otherwise identical: CSV always
downloads first, job is kept on failure, delete prompt only on success.

## QuickBooks name contract (context, no code)

Customer names originate in QuickBooks → Travis mirrors them exactly in the
app's Manage Customers directory → every export stamps that value into the CSV
(Estimating App → QuickBooks export requires the exact match) and, with this
feature, tabs derive from the same value. This design only **reads** the
Customer value; nothing here can alter what QuickBooks sees.

**Operating rule:** don't hand-rename tabs in the Master Job Log. Rename in
QuickBooks + Manage Customers; the next export auto-creates the correctly
named tab (drag old rows over manually if merging history matters). A renamed
tab that no longer matches any customer simply stops receiving rows.

Edge case, accepted: a QuickBooks name containing a Sheets-forbidden character
gets a dashed tab name, while CSV/row data keep the true name — QuickBooks
matching is unaffected.

## Rollout (no breakage window)

1. Update repo template + web app, test, push live (GitHub Pages; go-live
   skill — confirm the Pages build finished).
2. Travis pastes the new script into "CNC Tracker Endpoint" and updates the
   **existing** deployment (Deploy → Manage deployments → ✎ → Version: New
   version → Deploy) — same URL, so `js/endpoint-config.js` is untouched.

Order doesn't matter: the new script accepts exactly what the current live
client sends (and 9-column legacy rows), and the old script keeps failing
no-worse-than-today until step 2. The nicer error message on the shop PC
requires its usual hard-refresh; routing itself does not.

## Testing (never against production — standing rule)

- **Scratch first**, same drill as the 2026-07-17 switchover: scratch
  spreadsheet + scratch web-app deployment of the script, exercised via
  browser-console `fetch` (not curl — schannel drops Content-Length on Apps
  Script's 302): append to an existing tab, case/whitespace-insensitive match,
  new-customer auto-create (tab + header + frozen row), 9-column rows →
  Unassigned, illegal-character name creates dashed tab, two concurrent
  appends both land.
- Client alert change: manual check (temporarily point config at a scratch
  script returning `{ok:false,error:'test reason'}` or stub `Endpoint` in
  console).
- **Live confirmation:** after the paste, Collin's next real export lands in
  the matching customer tab.

## Out of scope

- Backfilling the 119 pre-archive-link rows or re-sorting existing rows.
- QuickBooks customer-list import (previously decided against — list is short).
- Any change to CSV columns, filenames, or the Estimating App.
