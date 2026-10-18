# 04 — Settings › Customers: a Billing choice (Weekly / Everything to date)

Status: ready-for-agent

Spec: `.scratch/weekly-billing/spec.md` (Implementation Decisions: data, "Settings › Customers").

## What to build

In `js/settings.js` `renderCustomers()` / `onCustomerChange()`:

- A `Billing` select beside `Price list` on each customer row: options `Weekly` (value `weekly`) and `Everything to date` (value `toDate`). Selected = `BillingModel.cadenceOf(cb)` (so no field shows Weekly). Disabled until `OwnerStore.loaded('customerBilling')`, same as the price list. Attribute `data-cadence="<customer key>"` + `data-name`.
- On change: `OwnerStore.mutateCustomerBilling(key, cur => ({ ...cur, name, cadence: value }), opts.currentEmail())` — a transaction, never a whole-doc set from the cache. Status line: `<name>: billed weekly.` / `<name>: billed everything to date.` On failure: `Couldn't save — <reason>` and re-render (same as the price list).
- `onCustomerChange` must still tell the three controls apart (checkbox, price list, billing) — no control's change may trigger another's write.
- No rules change: `customerBilling` is `allow read, write: if isJtOwner()` in `HQ/firestore.rules` — read it and confirm in the ticket comments.

## Tests first

- `test/settings-validate.test.mjs` only covers pure validators; if nothing pure is added, no new node test is needed here — say so in the comments.
- Ticket 06's PASTE browser check covers: the select shows Weekly by default, changing it writes `cadence`, and the Billing screen follows it.

## Done

`npm test` green; open Settings in a PASTE copy (CLAUDE.md steps 5–6) and change one fake customer's Billing choice — the status line confirms and a reload of the owner store keeps it. Bump `js/settings.js?v=` (and `css/style.css?v=` if any CSS changes).

## Comments

- 2026-10-18 (build): `HQ/firestore.rules` line 73 — `match /customerBilling/{id} { allow read, write: if isJtOwner(); }`. No field allow-list, so owners can write `cadence`; operators can't read or write the collection. No rules change, no deploy.
- No pure helper was added (the select reuses `BillingModel.cadenceOf`), so no new node test. Manual PASTE check passed: a fake customer showed Weekly, changed to Everything to date, status line confirmed, `cadence: 'toDate'` survived `OwnerStore.loadAll()`. Ticket 06's browser check repeats it.
