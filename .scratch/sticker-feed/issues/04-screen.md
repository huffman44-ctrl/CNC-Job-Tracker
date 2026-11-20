# 04 — Screen wording and the disagreement warning

Status: ready-for-agent
Blocked by: 03
Repo: CNC_WebApp, in a git worktree.

Read `../spec.md` first.

## Build
- `js/endpoint.js` `lookupOrder`: returns `data.order`, or `{ conflict: data.conflict }` when present.
- Pure wording in `js/vanlab-bar.js` (node-tested): the source note, the stale note, the disagreement text.
- `js/app.js` lookup:
  - "Looking up the Order Log…" becomes "Looking up the order…".
  - Status says which source was used. "No customer on the Order Log" becomes source-aware wording.
  - Stale feed gets a short note saying how old it is.
  - `orderLogChecked: false` gets a short note.
  - Disagreement: `vanlabOrder` stays null, a red status shows both van and kit values, `vanlabShowManualPicker()` opens with the order number and customer filled in and van and kit left blank. Print buttons stay disabled until a van is picked.
- Other fixed "Order Log" wording (the error when unreachable, "has no van type yet", `js/packing-map.js`): reword only where it is now untrue.
- Text goes in with `textContent`.

## Tests first
Node tests for the wording and endpoint shape. `tools/browser-check-phase1.mjs` cases in PASTE mode, with fake names: feed source, Order Log source, stale note, disagreement locks printing and prefills only order and customer. The existing stubs lack the new fields and must still work (a page reading an old script).

## Done
`node --test` and both browser checks pass. Never against production. Commit on the worktree branch. Stop and report.

## Comments
