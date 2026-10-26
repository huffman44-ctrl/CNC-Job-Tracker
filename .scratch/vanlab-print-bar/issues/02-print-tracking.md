# 02 — Print tracking: who printed what, and when

Status: ready-for-agent

Blocked by: 01

Spec: `.scratch/vanlab-print-bar/spec.md`

## What to build

- A successful print (the PDF opened) saves `{ at, by }` on `jobs/{Keys.job(jobName)}` as `vanlabPrinted.stickers` / `.packing` / `.crate`. **Field-level merge only — never write the whole doc from a cache.** Capture the job name when the print starts, so a job switch mid-print records on the right job.
- `by` = the display name from the signed-in email's local part (`pqDisplayName`, same mapping as `PQ_DISPLAY_NAMES`). Never a full email address in this public repo.
- A printed button shows a check mark and `Printed by Collin, 10:42 AM` (a print from another day also shows the date: `10/24 2:05 PM`). Reprint and Undo stay; Undo clears that one item.
- Live across computers: a listener on the one job doc while the job is open (the office PC sees what the shop PC printed).
- Rules: HQ `firestore.rules` already has `match /jobs/{id} { allow read, create, update: if isJtOperator(); }` — checked 2026-10-26. If a rules change turns out to be needed, stop and ask (and that would need a Fable review).

## Draft from the ticket 1 session (built test-first, then pulled out when the work was split)

Storage (`js/storage.js`, after `reopenJob`):
- `setVanlabPrinted(jobKey, jobName, kind, record)` → `db.collection('jobs').doc(jobKey).set({ jobName, vanlabPrinted: { [kind]: record } }, { merge: true })` (set-merge merges nested maps, so the other two items survive; works even if the job doc is missing).
- `clearVanlabPrinted(jobKey, kind)` → `set({ vanlabPrinted: { [kind]: firebase.firestore.FieldValue.delete() } }, { merge: true })`.
- `onJobDocChange(jobKey, cb)` → `doc(jobKey).onSnapshot(snap => cb(snap.exists ? snap.data() : null))`, returns the unsubscribe.
- Unknown kind throws before anything is written. With no database (PASTE copy) keep the record in a per-tab object and call listeners by hand, so the browser check can see it.
- Watch out: `upsertJob` does get-then-plain-set when the doc is missing; a print landing in that gap on a brand-new job would be overwritten. Tiny window; note it, or make `upsertJob` merge.

Pure (`js/vanlab-bar.js`): `printedFrom(jobDoc)` (drops malformed entries), `record(by, at)` (`by` blank → `Someone`), and per-button view `{ title: '✓ Crate label', done, action: 'Reprint', note: 'Printed by Collin, 10:42 AM', canUndo }`. Time is h:mm AM/PM, date added when not the same day as `now`.

## Done

`node --test` green (storage tests with a fake db: the merge shape, Undo shape, refused kind, listener + unsubscribe, no-db mode), browser check covers print → check mark → Undo, `?v=` bumped.
