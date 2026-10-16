# 02 — Print marks the batch printed; the separate Printed button goes

Status: done
Blocked by: 01

Spec: `.scratch/job-stickers/spec.md` § "Print marks printed" and "The separate Printed button is removed".

## What to build (To Print panel, js/app.js ~line 1980–2220)

- `pqPrint` (stickers) and `pqPrintDocument` (documents): once `window.open(...)` returned a window, if the item is not already printed (`item.printedAt == null`) call `Storage.markPrinted(item.id)`.
  - Success status: the existing ready text + ` Marked printed.`, e.g. `3 stickers ready — print the opened PDF on the STICKERS 1x3 printer at 100% scale. Marked printed.` — and show the head-row Undo (`pqUndoId = item.id`, undo enabled + visible, exactly as `pqMarkPrinted` does today), then re-render.
  - Already printed (Print again from the printed list): the ready text only, nothing marked, no Undo.
  - Popup blocked (`window.open` returned null) or the PDF build/fetch failed: nothing is marked (unchanged messages).
  - Mark failed: `Printed, but couldn't mark it printed — <err.message>.` as an error; the row stays waiting.
- Remove the `Printed` button from waiting rows and the `printed` action branch / `pqMarkPrinted` function (fold what is still needed into the print path). Printed rows keep Print again (the Print button), Undo printed, Delete.
- Write the status + mark logic so ticket 03's job panel can reuse it with its own status line and Undo button (e.g. the print functions take a small "panel" object `{ setStatus, showUndo, render }` instead of hard-wiring `printQueueStatus`/`printQueueUndo`). Do not build the job panel here.
- Bump `js/app.js?v=` in `index.html` (and `css/style.css?v=` if CSS changes).

## Tests

Extend `tools/browser-check-phase1.mjs` (PASTE mode only — the script already makes a PASTE copy; never touch the real configs) with a To Print section: add a sticker batch through the builder (`#pq-builder` open, `#pq-lines`, `#pq-send-btn`), stub `window.open` to return `{}` → click Print → item has `printedAt`, status ends `Marked printed.`, Undo visible, no `[data-action="printed"]` button anywhere → Undo → back to waiting → stub `window.open` to return `null` → Print → not marked, "Popup blocked" status. `node tools/browser-check-phase1.mjs` and `phase2` → `SUITE: PASS`; `npm test` green.
