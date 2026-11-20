# 01 — Row builder (Entity Store, no writes)

Status: ready-for-agent
Repo: Entity Store, in a git worktree. Never on its master.

Read `../spec.md` first.

## Build
A pure module, `src/sticker-feed.js`, no Firestore or Google calls:
- `feedRows({ orders, vansById, peopleById })` returns rows sorted by order number ascending, numerically, each as the six cells A to F (`['', order, customer, '', van, kit]`).
- `rowsChanged(existingRows, desiredRows)`: true when any cell differs, comparing as trimmed strings, and when row counts differ.
- `shouldWrite({ existingCount, desiredCount })`: false for zero desired rows, or desired under half of existing.

Use `parseAssembly` and `vanLabel` from `src/assembly.js`. Follow the van, customer and order-number rules in the spec exactly.

## Tests first (fake names only)
- `VL-1207` becomes `1207`; an id not matching `^VL-\d+$` is skipped.
- Kit `22-10` with a known van gives `22: <label> <wheelbase>`; a null wheelbase has no trailing space.
- Kit in words, kit with an unknown van, and a van whose label says ARCHIVED: kit kept as typed, van blank.
- No kit: van and kit blank, order and customer kept.
- Customer: person name wins; falls to `customerName`; blank when neither; blank when it holds `@` or 7+ digits in a row.
- Privacy: an order carrying fake email, phone, address, notes and line items. None of those values appears anywhere in `JSON.stringify(rows)`.
- Numeric sort: 999 before 1207, and 10081 last.
- `rowsChanged` and `shouldWrite` both ways.

## Done
Tests pass, `.env` untouched, `scripts/sync-intraday.js` untouched, commit is on the worktree branch. Stop and report to Travis.

## Comments
