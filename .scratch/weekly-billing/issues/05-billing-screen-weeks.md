# 05 — Billing screen: week sections, Everything-to-date cards, Pick a date yourself

Status: ready-for-agent
Blocked by: 01, 02, 03, 04

Spec: `.scratch/weekly-billing/spec.md` (Solution 2, 3, 5; Implementation Decisions: "Billing screen layout", "Bills go oldest first", "Remove / Add back").

## What to build

`js/billing.js`, `index.html`, `css/style.css`. Display only — every figure comes from `BillingModel` / `Pricing`.

1. **Two modes.** Replace the `through` state with `handDate`: `null` = **rhythm mode** (the default every time the screen opens fresh); `'YYYY-MM-DD'` or `'all'` = **hand mode**.
   - Rhythm mode: `model()` passes `throughDate: lastWeekEnd` (today's `defaultThroughDate`) and `throughDateOf: ck => BillingModel.cadenceOf(OwnerStore.getCustomerBilling(ck)) === 'toDate' ? null : lastWeekEnd`.
   - Hand mode: exactly today's behaviour — one through date for everyone (`'all'` → `null`), no `throughDateOf`.
   - `buildModel(throughDate)` (used by the Invoice screen) keeps today's meaning: an explicit through date for everyone.
2. **Top card.** In rhythm mode the through-date card shows one caption — `Weekly customers: one bill per finished week. Others: everything cut to date.` — and a `Pick a date yourself` button. Clicking it shows today's date box (pre-filled with last Saturday), `Everything to date`, `Refresh`, and a `Back to weekly bills` button that returns to rhythm mode. Hand mode's caption is today's caption.
3. **Weekly customer card (rhythm mode).** Header and summary as today. Body: `BillingModel.weekSections(customer, { weekEndingDay, priceList, laborTypes })`, one block per section titled `Week ending Sat Oct 10` (use `longDate`) with its rows (today's `rowHtml`).
   - **Oldest section:** today's Remove / Add back per row, and the button `Bill week ending Oct 10 · $X`, where `$X` is today's `billState` for the section's rows with the current selection. Click → `opts.openInvoice({ customerKey, selection: resolvedSelection(section rows), throughDate: section.weekEnding })`.
   - **Later sections:** rows without Remove buttons; the section's `total` (or its `error`) and the text `Bill after week ending Oct 10`.
   - `busyInvoice` (an invoice in progress) disables every Bill on the card with today's note.
4. **Everything-to-date customer card (rhythm mode):** today's card unchanged (its `customer.throughDate` is `null`), Bill → `throughDate: null`.
5. **Summary text** for an Everything-to-date customer must not say "wait for next week" (it has no later sheets); check `summaryText` and adjust only if it would.
6. Keep `tools/browser-check-phase2.mjs` passing: it drives the date box — make it click `Pick a date yourself` first. That is the only change to it in this ticket.

## Tests first

- The screen has no node tests today; the pure parts are covered by tickets 01–03. Add node tests only for any new pure helper you extract.
- Ticket 06 adds the browser check for this screen. Before handing in, run `node tools/browser-check-phase2.mjs` → `SUITE: PASS`.

## Done

`npm test` green, `node tools/browser-check-phase2.mjs` → `SUITE: PASS`, and a PASTE-copy look (CLAUDE.md step 6) at a fake weekly customer with two finished weeks: two sections, Bill only on the oldest. Bump `js/billing.js?v=`, `css/style.css?v=`.
