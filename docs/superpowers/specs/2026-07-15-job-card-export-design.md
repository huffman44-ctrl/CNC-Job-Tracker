# Export CSV From the Job Card

## Problem

Export CSV (which now also prints the 4×6 job ticket) lives only in the header inside an open job. Travis wants to close out a job straight from the Projects directory — and noticed the card's `Open →` button is redundant, since clicking anywhere on the card already opens the job (`js/app.js:500-503`).

## Design

### Card button swap

In the project card's button group (`js/app.js:469-482`):

- **Remove the `Open →` button** entirely. Opening is unchanged: the existing whole-card click handler (title bar included) already does it.
- **Add an `Export CSV` button in its place** — same `btn btn-primary btn-sm` styling Open had, sitting next to Add/Edit Note. Its click handler calls `e.stopPropagation()` (like the card's other buttons) so pressing it doesn't also open the job.

### One export core, two entry points

Refactor `doExport()` (`js/app.js:1072-1107`) into `exportJob(jobName, jobSheets)` holding everything it does today — CSV build/download, `printJobTicket`, delete-job confirm — but parameterized instead of reading `currentProject`/`getDisplaySheets()`:

- Header button (unchanged behavior): `exportJob(currentProject, getDisplaySheets())`.
- Card button: `exportJob(jobName, getProjectGroups()[jobName])` — sheets sorted the same way `getDisplaySheets` sorts (by `sheetNumber(fileName)`), so the CSV row order matches a header-initiated export of the same job.

The delete confirm inside `exportJob` uses the passed `jobName` (today it re-reads `currentProject`, which is `null` on the directory screen — that's the only behavioral seam in the refactor).

### After a card-initiated delete

`deleteProject(jobName)` already handles record cleanup; after it resolves from the card flow, the Projects screen re-renders in place (matching what the card's existing trash-icon delete does). The header flow keeps its current post-delete navigation (`if (sheets.length) showProjectsScreen()`).

## Error handling

- A job with zero sheets can't occur on a card (cards are built from sheet groups), so `exportJob`'s existing empty-sheets alert only guards the header path, unchanged.
- Cancelling the print dialog or the delete confirm behaves exactly as the header flow does today.

## Testing

Per this repo's rules (no test framework; never run against real Firebase; `master` deploys live via GitHub Pages):

1. Isolated temp copy with `projectId` disabled.
2. Throwaway Playwright driver (from the estimator's `.verify/` Playwright install, not committed): load two jobs' sheets, then from the **directory screen** click one card's Export CSV — assert CSV downloads with only that job's rows, `window.print` fires once with the ticket populated for that job, accepting the delete confirm removes only that job and leaves the directory rendered. Also assert the header-button flow inside the remaining job still works, and that no `Open →` button exists while card-click still opens.
3. Commit; push only on Travis's go.

## Not in scope

- Any change to the CSV columns, ticket layout, or the in-job header buttons.
- Touching the card's existing note/delete buttons or click-to-open behavior.
