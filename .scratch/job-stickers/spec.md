# Job stickers — sticker batches attached to a job

Status: ready-for-agent

Date: 2026-10-15. From a design talk with Travis. This is Phase 2 ("job tagging") of the print queue spec (`docs/superpowers/specs/2026-09-10-print-queue-design.md`), reshaped: the stickers are made and printed from the job screen, not tagged from the To Print panel. Build on branch `job-stickers` off `master`.

## Problem Statement

Most sticker batches belong to one job: Collin sticks them on parts as that job's sheets get cut. Today a batch can only be made in the To Print panel on the Projects screen, with no link to its job (`jobName` is always `null`), so Collin has to work out which batch goes with which job. He also often forgets to click **Printed** after printing, so printed batches stay in the waiting list.

## Solution

1. A **Stickers** button on the job screen opens a panel listing that job's sticker batches (waiting, plus printed in the last 30 days) and a builder that saves a new batch to that job.
2. **Print marks the batch printed** everywhere (job panel and To Print panel), with Undo printed to take it back after a bad print.

## User Stories

1. As Travis, on my office PC I want to open a job and add its sticker batch there, so that it is attached to that job.
2. As Collin, on the shop PC I want to open a job and see its stickers waiting, so that I print the right ones while that job is cutting.
3. As Collin, I want the Stickers button to show how many batches are waiting for this job, so that I notice them without opening anything.
4. As Collin, I want one click on Print to also mark the batch printed, so that the waiting list stays honest without a second click.
5. As Collin, I want Undo printed after a bad print, so that the batch goes back to waiting.
6. As Collin, I want to print a batch again from the job's printed list, so that a damaged sticker can be replaced.
7. As anyone, I want job stickers to still show in the To Print panel with the job name on the row, so that nothing waiting is hidden.

## Implementation Decisions

- **Data: no new field, no rules change.** A job batch is a `printQueue` item with `jobName` = the job's name (`currentProject`). Batches from the To Print panel stay `jobName: null`. A batch belongs to a job when `Keys.job(item.jobName) === Keys.job(currentProject)`. `HQ/firestore.rules` already lets operators write any `printQueue` field — confirm, no deploy.
- **Job screen header:** a `Stickers` button between `VanLab Stickers` and `Print Ticket` (VanLab Stickers stays separate and unchanged). Label `Stickers` when nothing is waiting, `Stickers (N)` and the orange pending look (same as the To Print button) when N batches for this job are waiting. Shown for everyone who can see the job screen (Collin included).
- **Job panel** (toggled by the button, under the progress strip like the VanLab panel, closed when leaving the job):
  - A status line (its own, like `print-queue-status`), with Undo after a print.
  - This job's waiting batches, then a "Printed (last 30 days)" group for this job. Rows look and act like To Print rows: same text, `Print N stickers → PRINTER` + the 100% scale hint; printed rows have Print again, Undo printed and Delete (confirm).
  - Builder, always open (no disclosure): the one-per-line box, the range filler (prefix/start/end + Fill), size `3x1` / `4x6`, and `Save to this job`. The same checks and limits as `pqSend` (empty, over 500). Saving writes `{ kind: 'stickers', lines, size, jobName: currentProject, createdBy }`.
  - Stickers only. Documents are still sent from the To Print panel.
- **Print marks printed** (both panels, stickers and documents): once the PDF tab has opened (`window.open` returned a window), call `Storage.markPrinted(item.id)` if the item is not already printed. Status: `3 stickers ready — print the opened PDF on the STICKERS 1x3 printer at 100% scale. Marked printed.` with the Undo button. If the PDF fails, or the popup is blocked, nothing is marked. If marking fails, say so (`Printed, but couldn't mark it printed — <reason>.`); the row stays waiting.
- **The separate Printed button is removed** from waiting rows; Print now does it.
- **To Print panel:** unchanged except the Print behavior above and the removed button. Job batches show there as today; the job name is already in the row's meta line.
- **One row builder.** Rows for both panels come from one function so they cannot drift; the job panel passes the filtered items. Keep the filter (`forJob(items, jobName)`) and the waiting count pure so they can be tested in node.
- **Nothing on export or finish.** No warning about unprinted stickers (Travis: Collin prints them while the job cuts). A finished job's stickers stay in the queue as normal.
- Bump `?v=` on every changed JS and CSS file.

## Testing Decisions

- **Node tests:** `forJob` matches by `Keys.job` (same name with different spacing inside is a different job; `null` matches nothing), the waiting count, and the order (waiting first, then printed newest first).
- **PASTE browser check** (extend `tools/browser-check-phase1.mjs`): open a job → Stickers shows no count → save a batch → button shows `Stickers (1)`, row in the job panel and in To Print with the job name → Print (stub `window.open` returning an object) → row moves to printed, count gone, Undo brings it back → popup blocked (`window.open` returns null) → not marked → another job's panel does not show the batch → Collin sees the button and panel.
- Review: a fresh Opus reviewer per ticket. No Fable: who may read or write does not change.
- Real check after go-live: Travis makes a batch on the office PC, Collin prints it from the job on the shop PC (Ctrl+Shift+R first).

## Out of Scope

- A sticker badge on the project cards.
- Opening the job from a To Print row.
- Sending documents from the job panel.
- Merging with VanLab Stickers.
- Filling sticker lines from the sheets' part names.
