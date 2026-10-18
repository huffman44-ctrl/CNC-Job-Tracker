# 02 — BillingModel: split a weekly customer into week sections, oldest first

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/weekly-billing/spec.md` (Implementation Decisions: "A week", "Bills go oldest first, enforced", "Remove / Add back", "Design/CAM hours ride with the job's row").

## What to build

In `js/billing-model.js` (pure; every dollar from `Pricing.priceInvoice`, never added up here).

1. **`weekEndingOf(ymd, weekEndingDay)`** → the week-ending date on or after `ymd` (local dates; `'2026-10-10'` is a Saturday, so with `weekEndingDay 6`: `10-04` → `10-10`, `10-10` → `10-10`, `10-11` → `10-17`). Throws on a bad date or day, like `defaultThroughDate`.
2. **`weekSections(customer, ctx)`** with `ctx = { weekEndingDay, priceList, laborTypes }`, for a customer object from `build()` → an array of sections, oldest first:
   ```
   { weekEnding: 'YYYY-MM-DD', rows: [...], billable: bool, total: number|null, error: string|null }
   ```
   - Each section's `rows` are copies of the customer's rows restricted to the sheets whose `cutDate` falls in that week (`sheetKeys`, `sheetInputs`, `captured.sheets`, `zeroTimeCount` all restricted together; `state` recomputed the same way `build` does it, from the restricted sheets).
   - A job's unbilled labor lines stay **only on its row in its oldest section**; its rows in later sections carry no labor (`laborLineIds: []`, `jobInput.includeLabor: false`, `jobInput.laborLines: []`). A labor-only row (no sheets) goes in the oldest section; if the customer has only labor-only rows, there is one section with `weekEnding: customer.throughDate` — **never `null`**: the Bill button passes `weekEnding` as the Invoice screen's through date, and `null` there means "everything to date", which would sweep in current-week sheets.
   - `billable` is true on the oldest section only.
   - `total`: the section priced as one bill with every row included — `Pricing.priceInvoice(pricingInput({ rows: sectionRows }, {}, ctx))`. For a **later** section, add every earlier section's sheets to `priorBilled` (`{ jobKey, signature: Pricing.signatureOf(sheetInput), order }`) so a repeat of an earlier week's design prices as a repeat. A pricing refusal → `total: null`, `error` = the message (never throws).
   - Rows inside a section keep `build`'s job order.
3. Export both.

## Tests first

Add to `test/billing-weekly.test.mjs` (FAKE names):

- `weekEndingOf` boundaries above, plus Sunday `10-11` → `10-17` and a bad date throws.
- Two jobs, sheets cut 10-06, 10-08, 10-13, 10-15; through `10-17` → two sections `10-10` and `10-17`, rows split right, only the first `billable`.
- A job cut across both weeks with 2 h Design → its hours are on its `10-10` row only.
- A job whose sheets are all in week `10-17`, with hours → hours on its `10-17` row.
- **The money equality (the reason this ticket exists):** a design cut first on 10-08 and repeated on 10-14. (a) `weekSections` → section `10-17`'s `total`. (b) Mark the 10-08 sheet billed (`sheetBilling.status: 'billed'`), build again with through `10-17` → the customer's priced total. (a) must equal (b), and the 10-14 sheet must be priced as a repeat in both.
- **Section one = today's bill:** section `10-10`'s `total` equals `priceInvoice(pricingInput(customer))` for the same customer built with through `10-10`.
- A `cutDateOverride` moving a sheet from 10-08 to 10-13 moves it to section `10-17`.
- Labor only: a customer with job A (hours, one uncut sheet) and job B (one sheet cut 10-19, in the current week), through `10-17` → one section, `weekEnding: '10-17'` (never `null`), holding A's labor-only row; B is not in it.
- A refusal (e.g. labor type removed is caught upstream, so use a price list missing a key) → `error` set, no throw.

## Done

`npm test` green. Bump `js/billing-model.js?v=`. No screen changes.
