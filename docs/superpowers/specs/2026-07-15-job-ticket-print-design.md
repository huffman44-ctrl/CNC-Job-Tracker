# Job Ticket Printed at CSV Export

## Problem

When a job finishes cutting, nothing physical travels with the stack of parts. Travis wants a minimal 4×6″ thermal ticket (Rollo printer at the shop station) printed as part of closing out a job — which in this app is the **Export CSV** action (per-job export followed by the delete-job offer).

## Design

### Flow

`doExport()` (`js/app.js:1040-1075`) gains one step, ordered so the ticket always prints before anything is deleted:

1. CSV downloads exactly as today.
2. The job-ticket print view is populated and `window.print()` opens the browser's print dialog. Printing to the Rollo (or hitting Cancel to skip) is the user's choice — Cancel is the opt-out, no extra confirm.
3. The existing "Delete job?" confirm runs after the print dialog closes, unchanged.

### The ticket (4×6″ portrait)

- **Job name** — large bold text at the top (the current project's name; falls back to the first sheet's job name, then the CSV base filename).
- **Sheet count** — "`N` sheets" (`N` = sheets in the export, same as the CSV's data rows; singular "1 sheet").
- **Completed date** — the latest `completedAt` across the job's completion records, date only; today's date if none.
- **Write-in area** — the bottom half is blank with a few faint ruled lines for handwritten notes.
- Black on white only (thermal printing), no logo/QR — deliberately minimal.

### Mechanics (no new dependencies)

- A hidden ticket container in `index.html`, populated by `doExport` at print time.
- Print CSS: `@page { size: 4in 6in; margin: 0.25in }`; `@media print` hides the app UI and shows only the ticket. On screen the container stays hidden.
- `window.print()` triggers the dialog; the Rollo driver handles the 4×6 stock. Same pattern the Estimating App uses for invoices.

### Rejected alternatives

- Browser-side PDF generation (jsPDF): adds a dependency for no benefit over the print dialog.
- Extending `label_generator.py` (the VanLab Rollo label script) to read the exported CSV: keeps printing a manual office step instead of in-app on the floor.

## Error handling

- No completion records at export → ticket still prints, dated today (export already works on incomplete jobs).
- Print dialog cancelled → nothing else changes; the delete confirm still runs.

## Testing

Per this repo's rules (no automated test framework; **never run against the real Firebase config** — `master` is live via GitHub Pages):

1. Copy the repo to a temp directory, disable the Firebase `projectId` so it runs in-memory.
2. Load the tracked sample sheet file, mark it complete, Export CSV.
3. Verify: CSV downloads as before; print preview shows the 4×6 ticket with job name / "1 sheet" / today's date / ruled write-in area; cancelling print still offers the delete confirm.
4. Do not push until Travis prints one real ticket on the Rollo and it looks right.

## Not in scope

- Per-sheet labels, auto-print without a dialog, QR codes, operator names, reprint buttons.
- Any change to the CSV contents or the VanLab label script.
