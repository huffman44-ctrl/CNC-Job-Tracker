# 06 — Browser check for weekly billing, and the docs

Status: ready-for-agent
Blocked by: 05

Spec: `.scratch/weekly-billing/spec.md` (Testing Decisions: PASTE browser check).

## What to build

1. **Extend `tools/browser-check-phase2.mjs`** (PASTE mode, same in-process server — never spawn `npx serve`). Seed FAKE customers and sheets with cut dates relative to the real today, so the check works any day: two finished weeks before the current one, plus one sheet in the current week.
   - Weekly fake customer (no `cadence` field): two sections, oldest first; the oldest has `Bill week ending …`, the later one shows `Bill after week ending …` and a total; the current-week sheet is not shown in a section.
   - A design cut in week 1 and repeated in week 2: note week 2's total → bill week 1 → Download → Imported OK → back on Billing, week 2 is now the oldest, billable, and **its total is the same number**.
   - The downloaded/stored CSV for the weekly bill has the cutting line `Week ending M/D/YYYY`.
   - Add 2 h Design to a week-2 job from its job card (job-name link → Back to Billing) → the hours show on the week-2 row, not week 1.
   - Settings › Customers: set a second fake customer to `Everything to date` → on Billing its card has one Bill button and includes a sheet cut today; its CSV keeps today's wording.
   - `Pick a date yourself` → today's single-card layout; `Back to weekly bills` → sections again.
   - Collin (operator) sees no Billing button and no Billing choice in Settings.
2. **Docs:**
   - `CLAUDE.md` file-structure lines for `js/billing-model.js` (per-customer through date, `weekSections`, `weekEndingFor`, `cadenceOf`), `js/billing.js` (rhythm vs hand mode, week sections), `js/settings.js` (the Billing choice), `js/invoice-lines.js` (the weekly wording) — short, in the file's style. Add `cadence` to the `customerBilling/` description.
   - Set the spec's `Status:` to `built — not yet live`.

## Done

`npm test` green; `node tools/browser-check-phase1.mjs` and `node tools/browser-check-phase2.mjs` → `SUITE: PASS`.
