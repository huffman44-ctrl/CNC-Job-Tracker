# Customer-Tagged Export

## Problem

The Master Job Log has no idea which customer a job belongs to — its columns are `Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed At, Operator, Notes, [Archive Link]` (`js/app.js` `exportJob`, ~line 1235). Downstream, the Estimating App imports that log to generate invoices, but since customer identity doesn't exist anywhere in the data, invoicing a batch that spans several customers currently means manually sorting sheets by hand before generating each invoice.

`exportJob` already runs per-project (one job at a time), which is the one moment an operator reliably knows who the job is for. This spec captures the customer right there, so it flows downstream automatically. See the companion spec in the Estimate and invoice Calculator repo (`2026-07-27-customer-tagged-invoice-and-export-design.md`) for what it does with this once imported.

## Design

### Customer picker, prompted at Export CSV

Clicking "Export CSV" (either entry point — project card or in-job header) now opens a small modal **before** any of `exportJob`'s existing work (CSV build, print, Master Log append) runs:

- A `<select>` listing known customers (see directory below), sorted alphabetically, pre-selected to whatever customer this job was already tagged with if it's been exported before (re-exports don't lose the tag).
- A trailing `__other__` option that reveals a text input (mirrors the existing Operator field's `__other__` pattern in the Mark Complete modal) — typing a name here and confirming adds it to the customer directory.
- Confirm is disabled until a customer is selected or typed. Cancel aborts the whole export — no CSV, no download, no Master Log write — matching how cancelling the existing delete-confirm inside `exportJob` already lets you back out cleanly.

This is a new modal following the same overlay/`openXModal`/`closeXModal` pattern as `openNotesModal`/`openSheetNoteModal`.

### Storage: two new Firestore-backed pieces in `storage.js`

1. **`customers` collection** — the growing, shared directory of customer names (doc id = `simpleHash(name)`, data `{ name }`), loaded into an in-memory cache the same way `notesCache` works today. `getCustomers()` (all, for the picker), `addCustomer(name)`, `renameCustomer(oldName, newName)`, `removeCustomer(name)`.
2. **`projectCustomer/{noteKey(jobName)}` collection** — which customer a specific job is tagged with, exact same shape as `projectNotes` (`getProjectCustomer(jobName)` / `setProjectCustomer(jobName, name)`). This is what makes the picker pre-select on a re-export.

### Managing the customer directory

A **"Manage Customers"** button sits next to "Ticket History" in the Projects directory header (`index.html` ~line 56), opening a new full screen following the same pattern as `ticket-history-screen` (`index.html` ~line 80) — a back button, its own header, a simple list body:

- Every customer from the `customers` collection, alphabetical, each row with an inline **Rename** (edit the text, confirm to save) and **Delete** (same `confirm()` pattern as project/job deletion) action.
- An "+ Add Customer" input at the top, so a customer can be added here directly instead of only via `__other__` during an export.
- `renameCustomer`/`removeCustomer` only ever touch the `customers` directory (the picker's list of names) — they do **not** cascade to `projectCustomer` tags already set on jobs, and never touch anything already exported (matches the "no backfill" stance below; a name change here is forward-looking only). If a job's stored tag no longer matches any current directory entry (renamed or deleted since), the export picker still shows that job's last-used value pre-filled in the `__other__` text field rather than failing to pre-select anything — so a rename/delete never corrupts or blocks a re-export, it just stops offering that exact string as a dropdown option going forward.

### Threading the customer through export

`exportJob(jobName, jobSheets)` (`js/app.js` ~line 1235) becomes `exportJob(jobName, jobSheets, customerName)`, called only after the picker resolves:

- **Per-job CSV download**: append `customerName` as a new final column (`Customer`, after `Notes`) — 9 columns total, up from 8.
- **Master Job Log append**: append `customerName` as a new final column (after the archive link) — 10 columns total, up from 9.
- **Download path**: the CSV's `a.download` gains a subfolder, same trick used for the Estimating App's QuickBooks export: `CNC Job Exports/{sanitized customerName}/{baseName}.csv` instead of flat in Downloads. A `sanitizeForPath()` helper strips characters Windows folder/file names can't have (`\ / : * ? " < > |`, trailing dots/spaces) — needed since customer names are free-typed.

### ⚠️ Manual steps this spec cannot ship by itself

- **The live Apps Script is not deployed from this repo.** `apps-script/logging-endpoint.gs` is a template pasted manually into script.google.com (per this repo's existing CLAUDE.md warning) — editing the file here does nothing to production until Travis pastes the update in himself. The repo file should still be updated (source of truth for the next paste), but the spec/plan must say this explicitly and not claim "done" until confirmed pasted.
- **`appendRows` hard-validates column count**: `apps-script/logging-endpoint.gs` line 87 checks `r.length === 9` and line 93 calls `getRange(..., 9)`. Both need to become `10`, or every export will fail Master Log logging (the CSV still downloads locally per the existing `if (!logged)` fallback, but the shared log silently stops getting new rows until this is fixed).
- **The live Google Sheet's header row** needs a `Customer` header added as its 10th column by hand — code changes don't add spreadsheet headers.

## Error handling

- Cancelling the customer picker aborts the export entirely (no partial CSV, no Master Log write) — same contract as cancelling today's post-export delete-confirm.
- If Firestore is unreachable, `getCustomers()` falls back to an empty list (typing a new name via `__other__` still works locally for that export, matching how `Storage` degrades elsewhere — writes are best-effort, cache always updates).
- An empty/whitespace-only typed customer name cannot confirm the modal (same disabled-until-valid pattern as other forms in this app).

## Testing

Per this repo's rules (no framework; never test against real Firebase; `master` deploys live):

1. Isolated temp copy with `projectId: "PASTE_DISABLED"`, throwaway Playwright driver (from the estimator's `.verify/` install, not committed).
2. Assert: Export CSV opens the customer picker before any download; picking an existing customer vs. typing `__other__` both work; Cancel produces zero downloads and zero Master Log calls; the downloaded CSV's header ends with `Customer` and the value matches what was picked; re-exporting the same job pre-selects the previously used customer.
3. Assert the Manage Customers screen: renaming updates the picker's dropdown option going forward without touching an already-tagged job's stored value; deleting removes it from the dropdown but a job previously tagged with that name still pre-fills it (as free text) on its next export rather than silently reverting to blank.
4. Commit; push only on Travis's go — and confirm with Travis that the live Apps Script + Google Sheet header have been updated by hand before considering the Master Log side "live."

## Not in scope

- Any change to job ticket printing, archive linking, or the Operator/Notes fields.
- Backfilling customer names onto rows already in the Master Job Log before this ships, or cascading a rename/delete in the directory onto jobs already tagged with the old name.
