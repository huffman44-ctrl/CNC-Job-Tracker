# Weekly billing — each customer billed on its own rhythm, no date to pick

Status: built — not yet live

Date: 2026-10-18. From a walkthrough with Travis of the live Billing screen (Orville had two weeks waiting: Oct 6–10 and Oct 11–17). Build on branch `weekly-billing` off `master`. Touches money, so: spec → plan → tickets → per-ticket Opus review → final whole-branch review on Fable before go-live.

## Problem Statement

The Billing screen has one **Bill work cut through** date for every customer. It defaults to last Saturday, so a steady weekly rhythm needs no date — but:

1. **When weeks pile up**, Travis has to set the date to the first Saturday, bill, import, Imported OK, change the date to the next Saturday, bill again — remembering which Saturday is next. That is the bottleneck.
2. **Not every customer is billed weekly.** Orville is billed by the week; van companies (Pacific Van Works) are billed when their work is done. The shared Saturday date holds a van company's Sunday-to-today work back for a week.
3. **The invoice line doesn't say which week it is.** The hand-made Orville bills read "Week ending M/D/YYYY"; the app's line reads "CNC cutting — N sheets (job list)".

## Solution

1. Each customer gets a **billing rhythm** in Settings › Customers: **Weekly** or **Everything to date**.
2. A **Weekly** customer's card on Billing shows **one section per finished, unbilled week**, oldest first, each with its own total. Only the **oldest** week has a Bill button (`Bill week ending Oct 10 · $X`); later weeks show their total and "Bill after week ending Oct 10". After Imported OK, the next week moves up.
3. An **Everything to date** customer's card shows everything cut through today, one Bill button — no Saturday cut-off.
4. A weekly bill's cutting line reads just **"Week ending 10/10/2026"**, like the hand-made Orville bills.
5. The **Bill work cut through** box stays, folded under "Pick a date yourself". When used, it overrides every customer's rhythm for that visit, exactly as the screen works today.

## User Stories

1. As Travis, when two weeks of Orville work are waiting, I want two bills listed oldest first, so that I click down the list without choosing dates.
2. As Travis, I want each week's total shown before I bill, so that I can sanity-check the size of each bill.
3. As Travis, I want the bill to say "Week ending …", so that it matches the bills Orville already gets.
4. As Travis, I want Pacific Van Works' work billable as soon as it is cut, so that a van company isn't held to a Saturday cut-off.
5. As Travis, I want to set a customer's rhythm once in Settings, so that I never think about it on the Billing screen.
6. As Travis, I still want to pick a date by hand now and then, so that an odd case (a mid-week bill, a customer asking for a split) is still possible.
7. As Eva (when she has Billing), I want the same screen to make the same bills without knowing the history, so that billing doesn't depend on Travis remembering dates.

## Implementation Decisions

- **Data: one new field, no rules change.** `customerBilling/{customerKey}.cadence` = `'weekly'` | `'toDate'`. `HQ/firestore.rules` already lets owners write any `customerBilling` field (`allow read, write: if isJtOwner()`) — confirm, no deploy. A customer with no `cadence` is Weekly.
- **A week** is the 7 days ending on Settings › Invoicing › week-ending day (Saturday). A week is **finished** once its last day is before today. Sheets cut in the current, unfinished week wait (as today).
- **Weekly card = repeated use of today's machinery.** The oldest finished week with unbilled cut sheets is billed exactly as Billing works now with the through date set to that week's Saturday — nothing earlier is left unbilled, so "through that Saturday" is that week. `BillingModel.build` gains an optional per-customer through date (`throughDateOf(customerKey)`, falling back to `throughDate`): a Weekly customer gets the last finished week-ending day, an Everything-to-date customer gets `null` (everything, as today's Everything to date button). A new pure helper splits a Weekly customer's rows into week sections by `cutDate` (same `effectiveCutDate`, so a corrected cut date moves the sheet to its corrected week). Clicking Bill on the oldest section opens the Invoice screen with that section's Saturday as the through date, and the Invoice screen's rebuild (`BillingScreen.buildModel(throughDate)`) then prices exactly that week.
- **Bills go oldest first, enforced.** Only the oldest week can be billed. This is a money rule, not a nicety: a repeat sheet is priced as a repeat ($20 handling) only when its first copy is already billed (`priorBilled`). Billing a later week first would charge the repeat as a first ($50). For the same reason, a **later week's preview total** is priced with every earlier unbilled week's sheets counted as already billed, so the preview matches what the bill will be once the earlier weeks go out.
- **Remove / Add back** works inside a week section as it does on today's card. A row removed from the oldest week is not billed on it and **stays in its own week**: after that bill, that week shows again with only the removed row, still the oldest, so it must be dealt with before the next week. Three ways out, all existing tools: bill it alone; fold it into the next week with Pick a date yourself → the next Saturday (one bill for both, still worded "Week ending" that Saturday); or mark it No charge on the job card if it should never be billed. Kept this way on purpose: a sheet never silently changes week, and no new stored state is needed. (If that removed row is instead marked No charge, its sheets no longer count as billed, so a later week's repeat of the same design re-prices as a first copy — the later week's total visibly goes up before it is billed. Correct: the first copy was never charged.)
- **Design/CAM hours ride with the job's row** (Travis 10/18). His workflow: look down a week's jobs, spot the ones that took design or CAM time, click the job name, add the hours on the job card, Back, then bill that week. So a job's unbilled hours go on the **oldest week in which that job has unbilled cut sheets** — the row he was looking at when he added them. A job with hours but no unbilled sheets (labor only) goes on the oldest open week. The row's total updates as soon as the hours are saved (it already does today). Hours are still never gated by the date they were entered. **One rule change in `BillingModel.build`, for every bill:** a job whose unbilled cut sheets are all after the through date no longer gets a labor-only row — its hours wait with those sheets. (Today's rule, spec 2026-10-06 §15.4, puts them on the earlier bill; with weekly sections that would put a week-2 job's hours on week 1's bill.) A job with no unbilled cut sheets at all (only uncut, or all billed) still gets its labor-only row on the next bill.
- **The $150 cut minimum and the $5 rounding stay per invoice.** Two weekly bills can each hit the minimum where one combined bill would not. This is already true when Travis bills weekly by hand-picking dates; flagged here so it's a known effect, not a surprise.
- **Weekend +50%, rush, the once-per-job labor minimum, the billing-start date, one open invoice per customer, "billed outside this app" customers:** all unchanged.
- **Invoice record:** `invoices/{n}.throughDate` already stores the through date — for a weekly bill it is that week's Saturday; for an Everything-to-date bill it is `null`, as today. The invoice screen already rebuilds the model with the invoice's through date, so it prices the same week it showed.
- **Line wording** (InvoiceLines, words only; Travis 10/18 — match the hand-made Orville bills): a weekly bill's cutting line description is just `Week ending M/D/YYYY`. The job list, sheet count and weekend note drop off that line (the per-sheet detail stays in the Master Job Log and the Orville shared log, with the invoice number on every row). Labor and material lines unchanged. The rule, one pure function: the "Week ending" wording is used when the customer is Weekly **and** the bill's through date falls on the week-ending day — so a hand-picked Saturday for Orville is worded the same way. Everything-to-date bills, and hand-picked non-Saturday dates, keep today's wording.
- **Settings › Customers:** a `Billing` select beside `Price list` — `Weekly` / `Everything to date`. Written with `OwnerStore.mutateCustomerBilling` (a transaction), disabled until `customerBilling` is loaded — same pattern as the price list.
- **Billing screen layout:** the through-date card is replaced by a one-line caption ("Weekly customers: one bill per finished week. Others: everything cut to date.") with a `Pick a date yourself` link that opens today's date box + Everything to date + Refresh. Picking a date shows today's single-card layout for every customer until `Back to weekly bills` (or a fresh visit to the screen) resets it; Refresh only reloads. One deliberate difference from today: the box prefills with the last *finished* week-ending day, so on a Saturday it opens on the Saturday before, never on the unfinished week (type today's date to bill it). If Settings › Invoicing's week-ending day is ever invalid (Settings only accepts 0–6 and the store defaults to Saturday, so only a hand-edited document could do it), weekly bills refuse with a warning and Pick a date yourself opens on Everything to date, as today.
- Bump `?v=` on every changed JS and CSS file.

## Testing Decisions

- **Node tests (pure):**
  - Week split: sheets on Sat/Sun boundaries land in the right week (local dates only, never UTC); a `cutDateOverride` moves a sheet; the current unfinished week is held back; weeks before the billing-start date never appear.
  - Oldest-first: only the oldest week is billable; a later week's preview counts earlier weeks' sheets as prior, so a repeat in week 2 of a week-1 design prices at the repeat rate in the preview and on the real bill after week 1 is billed — same number both times.
  - Everything-to-date: through date = today; a sheet cut today is included.
  - A customer with no `cadence` is Weekly.
  - Labor placement: hours on a job whose sheets are in week 2 show on its week-2 row, not on week 1; a labor-only job goes on the oldest week; the once-per-job minimum holds across two weekly bills.
  - Line wording: a weekly cutting line is exactly `Week ending M/D/YYYY`; to-date and hand-picked bills unchanged.
  - Fixture with FAKE customer names (the repo is public).
- **PASTE browser check** (extend `tools/browser-check-phase2.mjs`): a weekly fake customer with sheets in two finished weeks + the current week → two sections, oldest has Bill, later shows "Bill after …" → Bill → Invoice → Imported OK → the second week moves up with its preview total unchanged → a to-date fake customer bills today's sheet → Pick a date yourself restores today's layout → Collin sees nothing.
- **Emulator:** not needed — no rules change and no new transaction shape (the lock is today's lock). Confirm in review.
- Review: a fresh Opus reviewer per ticket; **Fable whole-branch review before go-live** (money).
- Real check after go-live: bill Orville week ending Oct 10, then Oct 17, through QuickBooks; compare each total to a hand check of one job.

## Out of Scope

- Billing two weeks on one invoice from the weekly view (use Pick a date yourself).
- Monthly or per-job rhythms (add later as more `cadence` values if needed).
- Making the weekend +50% skippable (separate open decision).
- Automatic bills on a schedule — a person still clicks Bill and imports.
- Changing the $150 minimum or rounding to work across weekly bills.

## Decisions (Travis, 2026-10-18)

1. **Default rhythm:** Weekly for any customer not set (same as today's Saturday default). Set Pacific Van Works to Everything to date after go-live.
2. **Design/CAM hours:** ride with the job's row in its oldest unbilled week (see Implementation Decisions).
3. **Line wording:** weekly cutting line = `Week ending M/D/YYYY` only, matching the hand-made bills.
4. **Hand-picked date:** kept, behind "Pick a date yourself".
