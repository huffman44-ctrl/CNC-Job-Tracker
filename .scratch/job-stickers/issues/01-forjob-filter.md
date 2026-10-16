# 01 — Pure job-sticker helpers: forJob, waiting count, order

Status: done

Spec: `.scratch/job-stickers/spec.md` (Implementation Decisions: data, one row builder; Testing Decisions: node tests).

## What to build

A new pure module `js/job-stickers.js` (browser global `JobStickers`, `module.exports` for node, same shape as `js/keys.js` / `js/sequence.js`). No DOM, no Firestore, no clock.

- `forJob(items, jobName)` → the print-queue items that belong to that job: `item.jobName` is a non-empty string and `Keys.job(item.jobName) === Keys.job(jobName)`. A `null`/empty `jobName` on either side matches nothing. Uses the real `Keys.job` (global `Keys` in the browser, `require('./keys.js')` in node) — never a hand-rolled comparison, never trimming.
- `waitingCount(items, jobName)` → how many of that job's items are waiting (`printedAt == null`).
- `ordered(items)` → waiting first (oldest `createdAt` first, missing `createdAt` last — same as `Storage.getPrintQueue`), then printed newest `printedAt` first (same as `Storage.getPrintedItems`). Returns a new array; does not mutate input.

Add `<script src="js/job-stickers.js?v=1"></script>` to `index.html` right after `js/keys.js`.

## Tests first

`test/job-stickers.test.mjs` (fake job names only):
- same name → match; the same name with different spacing inside (`'Harbor  Lane'` vs `'Harbor Lane'`) → different job; leading/trailing spaces are a different job too (Keys never trims).
- `null` item jobName never matches; `forJob(items, null)` / `''` → `[]`.
- waiting count ignores printed items and other jobs.
- order: waiting oldest-first, then printed newest-first; input untouched.

## Done

`npm test` green including the new file. No app.js changes in this ticket.
