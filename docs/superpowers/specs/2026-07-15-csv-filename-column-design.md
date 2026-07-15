# CSV `File Name` Column (for Master Job Log Sheet Links)

## Problem

Travis wants each row in the Master Job Log spreadsheet to link to the original Aspire HTML summary sheet (stored in Google Drive under the `510_tap` folder). The ingest Apps Script can add that link — but only if it can find the file, and the CSV currently carries just the sheet *title* ("Job Layout Sheet 9"), which repeats across jobs. The HTML *filename* is effectively unique (order-stamped by Aspire), so the CSV needs to carry it.

## Design

`doExport`'s CSV (now `exportJob` in `js/app.js`) gains one final column:

- Header: `File Name` (appended after `Notes`).
- Value: `sheet.fileName` (the uploaded file's name, already on every sheet object — it's what `sheetNumber()` sorts by), empty string if missing.

That's the whole app change. Column order of the existing eight columns is untouched.

### Why appending is safe everywhere downstream

- **Master Job Log ingest (Apps Script):** reads/append-maps columns; the new column is the point — a companion script update (separate effort, Travis's Apps Script) will use it to look up the file in `510_tap` and write a Sheet Link.
- **Estimating App import:** `parseJobTrackerCsv` reads columns by header name and ignores unknown ones — verified behavior, already covered by its own tests.
- **QuickBooks:** never sees this CSV.

## Testing

Repo rules apply (no framework, never real Firebase, master deploys live):

1. Isolated temp copy (`projectId: "PASTE_DISABLED"`), throwaway Playwright driver from the estimator's `.verify/` install.
2. Assert: exported CSV header ends with `File Name`; each data row's last field equals that sheet's uploaded filename (quoted CSV); both entry points (job card Export CSV and in-job header Export CSV) produce it.
3. Commit; push on Travis's go.

## Not in scope

- The Apps Script change itself (needs the current bound script's code from Travis; will be spec'd/tested separately against a copied spreadsheet).
- Any ticket or UI change.
