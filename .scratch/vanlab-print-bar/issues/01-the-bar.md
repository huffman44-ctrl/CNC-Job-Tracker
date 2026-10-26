# 01 — The VanLab print bar

Status: done

Spec: `.scratch/vanlab-print-bar/spec.md`

## What to build

- The existing `#vanlab-panel` becomes the bar and moves under `.progress-strip`. On a VanLab job (one order number in the sheet file names, no conflict) it shows by itself every time the job opens, and the Order Log lookup runs straight away (the `vanlabEpoch` guard stays, so switching jobs mid-lookup can't paint the wrong order).
- Heading from the pure module: `VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05` (just `VanLab order 1210` while the lookup runs or after it fails).
- Three buttons — `Hardware stickers (7)`, `Packing list`, `Crate label` — wired to the existing `vanlabPrintStickers` / `vanlabPrintPacking` / `vanlabPrintCrate`. The sticker count comes from the Sticker Map for the looked-up van.
- Lookup failure: the manual van picker and the honest error line, exactly as the old panel.
- Header `#vanlab-print-btn` ("VanLab Stickers"): **shown only when the job has no single order number** (none found, or the sheets disagree). It toggles the same bar with the manual picker. On VanLab jobs it is hidden.
- The button row wraps at phone width; no horizontal scroll.
- **No database writes.**

## Pure module

`js/vanlab-bar.js` (browser global `VanlabBar`, `module.exports` for node):
- `forJob(fileNames)` → `{ auto, orderNum, conflict }` — `auto` true only for one order number, no conflict.
- `heading(orderNum, order)` → the heading text; leaves out a van or kit the Order Log doesn't have.
- `buttonTitle(kind, { stickerCount })` → `Hardware stickers (7)` / `Packing list` / `Crate label`; unknown kind throws.
- `stickerCount(items)` → total stickers from `VanlabPrint.resolveStickers(...).items` (`[key, qty]` pairs).

## Tests first

`test/vanlab-bar.test.mjs`, fake names only. Browser: `tools/browser-check-phase1.mjs` (PASTE mode → lookup not configured → manual picker): a VanLab-named job shows the bar with heading and no header button; a plain job shows the header button and no bar until clicked; phone width has no horizontal scroll.

## Done

`node --test` green, browser check `SUITE: PASS`, `?v=` bumped, CLAUDE.md file-structure line for `js/vanlab-bar.js`.

## Comments

2026-10-26 — built and committed on `claude/vanlab-print-bar-9f9b26` (not on master). Opus fresh-eyes review: fixed (1) Back / reopen from Billing kept the old bar and skipped the lookup → `vanlabForgetJob()` in the Back handler and `openJobFromBilling`; (2) `vanlabPrintStickers` had no epoch guard and a hand-picked van could carry to the next job → `ep` guard + van select cleared in `vanlabLoad`. Note for go-live: the lookup now runs on every VanLab job open, so if the live script's `ALLOWED_UIDS` blocks Collin he'll see the honest error + manual picker every time.
