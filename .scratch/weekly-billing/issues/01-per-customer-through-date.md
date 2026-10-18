# 01 — BillingModel: a through date per customer, and hours wait with later sheets

Status: ready-for-agent

Spec: `.scratch/weekly-billing/spec.md` (Implementation Decisions: data, "Weekly card = repeated use of today's machinery", "Design/CAM hours ride with the job's row").

## What to build

All in `js/billing-model.js` (pure — no DOM, no Firestore, no clock, no money math).

1. **`BillingModel.cadenceOf(customerBilling)`** → `'weekly'` | `'toDate'`. `cb.cadence === 'toDate'` → `'toDate'`; anything else (no doc, no field, junk value) → `'weekly'`.
2. **`build(input)` takes an optional `throughDateOf(customerKey)`.** When given, a job's sheets are bucketed against `throughDateOf(ck)` instead of `input.throughDate` (`undefined` from it → fall back to `input.throughDate`; `null` → everything to date). This means the job's customer key must be worked out **before** the sheets are bucketed — move the job-details lookup (`jb`, `ck`) above the bucketing loop. Nothing else about the buckets changes. The returned `throughDate` stays `input.throughDate`; add `throughDateOf` results per customer as `customer.throughDate` on each customer object.
3. **Hours wait with later sheets.** In the labor step: if the job has **no eligible sheets but at least one `later` sheet**, it gets no row (its unbilled labor lines wait for the bill that carries those sheets). A job with no eligible and no later sheets (only uncut / billed / before-start) keeps today's labor-only row. Update the header comment and the comment at the labor step (it currently says "never gated by the through date (§15.4)") to name this spec.

## Tests first

New file `test/billing-weekly.test.mjs` (FAKE customer and job names only — the repo is public). Build inputs the way `test/billing-model.test.mjs` does (copy its helpers, don't import test files).

- `cadenceOf`: null, `{}`, `{ cadence: 'weekly' }`, `{ cadence: 'nonsense' }` → weekly; `{ cadence: 'toDate' }` → toDate.
- Two customers, one sheet each cut Wed 2026-10-14; `throughDate: '2026-10-10'`; `throughDateOf` returns `'2026-10-10'` for A and `null` for B → A's sheet is `later`, B's sheet is billable. `customer.throughDate` is set on each.
- `throughDateOf` returning `undefined` → falls back to `input.throughDate`.
- Hours wait: a job with one sheet cut 2026-10-14 and 2 h of Design, through `2026-10-10` → **no row** for that job; through `2026-10-17` → one row with the sheet and the hours.
- Hours on a job cut across two weeks (one sheet 10-08, one 10-14), through `2026-10-10` → the row has the 10-08 sheet AND the hours.
- Labor-only still works: a job whose only sheet is uncut, with hours → labor-only row, through any date.
- Existing `test/billing-model.test.mjs`: if a test asserts the old rule (labor-only row while all cut sheets are later), change that one assertion to the new rule and say so in the commit message. Every other existing test must pass unchanged.

## Done

`npm test` green. Bump `js/billing-model.js?v=` in `index.html`. No screen changes in this ticket.
