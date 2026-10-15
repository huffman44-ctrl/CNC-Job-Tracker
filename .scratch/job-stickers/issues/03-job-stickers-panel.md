# 03 — Stickers button and job panel on the job screen

Status: ready-for-agent
Blocked by: 01, 02

Spec: `.scratch/job-stickers/spec.md` § Job screen header, Job panel, One row builder, Testing Decisions (PASTE browser check).

## What to build

- **Header button** `#job-stickers-btn` in the content-screen header between `#vanlab-print-btn` and `#print-ticket-btn`. Label `Stickers`, or `Stickers (N)` plus the `print-queue-btn--pending` look when `JobStickers.waitingCount(all items, currentProject)` = N > 0. Visible to everyone who sees the job screen (Collin too). Kept current on every print-queue change (`Storage.onPrintQueueChange` → also refresh the job button/panel) and whenever the job screen is shown.
- **Job panel** `#job-stickers-panel` under the progress strip, next to `#vanlab-panel`; toggled by the button; hidden whenever a different job is shown or the job screen is left (all entry paths: project card click, `openJobFromBilling`, back to projects, export/finish). Contents:
  - its own status line + Undo button (like `print-queue-status` / `print-queue-undo`);
  - this job's waiting rows, then a "Printed (last 30 days)" group for this job (empty states: e.g. "No stickers for this job yet.");
  - builder, always open (no `<details>`): one-per-line textarea, prefix/start/end + Fill, size radios `3x1` / `4x6` (own radio `name`, not `pq-size`), `Save to this job`. Same checks and limits as `pqSend` (empty → message, over `Sequence.MAX_ITEMS` → message). Saves `{ kind: 'stickers', lines, size, jobName: currentProject, createdBy }` via `Storage.addPrintItem`; on success clears the box and says so in the job status.
  - Stickers only — no document sender.
- **One row builder:** the To Print list and the job panel render rows from the same function in app.js (today's `renderPrintQueue` row template, lifted out). The job panel passes `JobStickers.ordered(JobStickers.forJob(all, currentProject))` split into waiting/printed. Row clicks in both panels go through one handler using ticket 02's print/undo/delete logic with the panel's own status + Undo.
- Data source for "all items": `[...Storage.getPrintQueue(), ...Storage.getPrintedItems()]`.
- CSS reuses the `.print-queue-*` / `.pq-*` classes; add only what's missing. Bump `?v=` on every changed JS/CSS file.

## Tests (PASTE browser check — extend `tools/browser-check-phase1.mjs`)

Update the existing header-buttons assertion to include `job-stickers-btn` between `vanlab-print-btn` and `print-ticket-btn`. Then: open a job → button says `Stickers` → open panel → save a batch → button `Stickers (1)` with pending class, row in the job panel, row in To Print with the job name → stub `window.open` → `{}` → Print in the job panel → row moves to the job's printed group, button back to `Stickers`, Undo brings it back → `window.open` → `null` → not marked → a second job (rename the job name of an uploaded copy / upload sample2 under another job) does not show the batch → Collin (no owner stub) sees the button and panel. Save a screenshot of the open job panel to the scratchpad path given by the caller. `npm test`, `phase1`, `phase2` → green / `SUITE: PASS`.
