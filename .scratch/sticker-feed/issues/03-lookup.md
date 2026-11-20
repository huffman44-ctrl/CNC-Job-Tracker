# 03 — lookupOrder: feed first, fallback, disagreements

Status: ready-for-agent
Repo: CNC_WebApp, in a git worktree.

Read `../spec.md` first.

## Build (`apps-script/logging-endpoint.gs`)
- Constant `FEED_SPREADSHEET_ID = 'PASTE_FEED_SPREADSHEET_ID'`. While it starts with PASTE, the feed is skipped and results are exactly as today.
- The Firebase token check stays exactly as it is, and still runs before anything is read.
- Still one order per call. No new action and no bulk read.
- Read the feed for that one order, exact match with `normalizeOrderId`, never digits alone. Blank van or kit counts as not found. Any feed error counts as not found; it never fails the lookup.
- Read the Order Log for that one order.

## Results
- Normal: `{ ok: true, order: { orderNum, customer, vanRaw, vanKey, assembly, source: 'feed' | 'orderLog', feedUpdatedAt, feedStale, orderLogChecked } }`.
- Disagreement: `{ ok: true, order: null, conflict: { orderNum, customer, feed: { vanRaw, vanKey, assembly }, orderLog: { vanRaw, vanKey, assembly }, feedUpdatedAt, feedStale } }`. `order: null` means a shop PC that hasn't refreshed goes to the manual picker and never prints.
- A disagreement needs both sides to have the value and it to differ: van key, or kit number trimmed and case-insensitive. A blank on one side is not a disagreement.
- Feed found, Order Log unreadable: use the feed, `orderLogChecked: false`.
- Feed empty, Order Log found: `source: 'orderLog'`, with `feedStale` still reported.
- Neither: not-found error naming both sources.

`feedStale`: A1 over 2 hours old or unreadable.

## Tests first (`test/lookup-order.test.mjs`, fake names)
Every case above, plus: bad token reads neither sheet; PASTE feed id matches today's results; `INVOICE 1030` does not match 1030; Apps Script returning a Date from A1 still parses.

## Done
`node --test` passes. Commit on the worktree branch. Stop and report.

## Comments
