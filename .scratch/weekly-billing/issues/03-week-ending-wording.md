# 03 — "Week ending M/D/YYYY" on a weekly bill's cutting line

Status: ready-for-agent

Spec: `.scratch/weekly-billing/spec.md` (Implementation Decisions: "Line wording").

## What to build

1. **`BillingModel.weekEndingFor({ cadence, throughDate, weekEndingDay })`** (pure, `js/billing-model.js`) → `throughDate` when `cadence === 'weekly'` and `throughDate` is a valid `YYYY-MM-DD` falling on `weekEndingDay` (local date); otherwise `null`. Never throws (bad input → `null`).
2. **`InvoiceLines` (`js/invoice-lines.js`, words only):** the `cutSheets` line type's `describe(line, ctx)` returns exactly `Week ending M/D/YYYY` (no leading zeros, e.g. `Week ending 10/10/2026`) when `ctx.weekEnding` is a `YYYY-MM-DD` string; otherwise today's wording, unchanged. Labor and material lines ignore `weekEnding`. Reuse the file's existing `mdy` date formatting if it produces that shape; otherwise add a local helper.
3. **Wire it in the Invoice screen** (`js/invoice-screen.js`, where it calls `InvoiceLines.finalize(priced, { qbItems, laborTypes })` for a NEW invoice): add `weekEnding: BillingModel.weekEndingFor({ cadence: BillingModel.cadenceOf(OwnerStore.getCustomerBilling(customerKey)), throughDate: st.throughDate, weekEndingDay: OwnerStore.invoicing().weekEndingDay })`. An existing (already locked) invoice keeps its stored lines and CSV — do not re-word it.

## Tests first

- `test/billing-weekly.test.mjs`: `weekEndingFor` — weekly + a Saturday → that date; weekly + a Wednesday → null; toDate + a Saturday → null; null / `'garbage'` through date → null; weekEndingDay 0 (Sunday) with a Sunday date → that date.
- `test/invoice-lines.test.mjs`: with `weekEnding: '2026-10-10'` the cutting line's description is exactly `Week ending 10/10/2026`, its item / Taxable / amount unchanged, the labor line's description unchanged; the QuickBooks CSV row carries the new description; without `weekEnding` every existing assertion still passes.
- `test/invoice-screen.test.mjs`: if it covers the finalize call, add a case that a Weekly customer billed through a Saturday gets the new wording and a toDate customer does not. If the screen isn't testable at that seam, say so in the ticket comments and cover it in ticket 06's browser check.

## Done

`npm test` green. Bump `js/billing-model.js?v=`, `js/invoice-lines.js?v=`, `js/invoice-screen.js?v=`.

## Comments

- 2026-10-18 (build): `computeView` needs OwnerStore / BillingScreen / InvoiceStore, so the finalize call itself is not node-testable. The context is built by the pure `InvoiceScreen.linesCtx(...)` (tested); the wiring (right customer key, through date, week-ending day reaching `finalize`) is covered by ticket 06's browser check — it must check the on-screen preview line before lock AND the stored CSV.
- Review: Download now also refuses (`changed`) when the lines' wording / item / Taxable differ from what was on screen, not only the total.
