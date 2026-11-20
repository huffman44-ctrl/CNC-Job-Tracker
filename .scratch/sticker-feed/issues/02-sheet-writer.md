# 02 — Sheet writer and the 15-minute step (Entity Store, flag off)

Status: ready-for-agent
Blocked by: 01
Repo: Entity Store, in a git worktree. Never on its master.

Read `../spec.md` first.

## Build
- `src/sticker-feed-sheet.js`: Sheets client on the vanlab-crm service account (`VANLAB_SA_PATH`, spreadsheets scope), holding only a read and a write of the one feed sheet, RAW. No other sheet id can reach it. `STICKER_FEED_SHEET_ID` comes from `.env`.
- Flag `stickerFeed: 'INTRADAY_STICKER_FEED'` in `FLAG_KEYS` (`src/intraday.js`), documented in `.env.example`. The real `.env` is not touched; turning it on is Travis's go.
- Step in `scripts/sync-intraday.js` right after step 0 (Shopify), so it also runs on "nothing new" slots. Own try/catch logging `STICKER FEED SKIPPED: <message>`; a failure never stops the slot.

## Behaviour
1. Read `entity_orders` and `entity_vans` via `getDb('vanlab')`, then the sheet.
2. A CRM read that fails or returns no orders: touch nothing, A1 included.
3. Names: only for order rows not already on the sheet, full refresh once a day, tracked in `entity_meta/sticker_feed`. On every other run, each existing row keeps the name already on the sheet, so a partial read can never blank names or cause a rewrite.
4. `shouldWrite` false: touch nothing, log it. `existingCount` counts only order rows, from row 5 down, never A1 or the header.
5. Rows changed: write the rows, and clear only leftover rows below the new end.
6. Every successful run: write A1.
7. `--dry-run` reads everything and writes nothing.
8. Logs carry counts only, never names.

## Notes
`CLAUDE.md` says the conversations import must never add a sheet write. That still holds: `calls-client` stays read-only. Add one line to `CLAUDE.md` saying the feed writer is the only sheet writer and lives in its own file. Also add this step to the comment at the top of `sync-intraday.js`.

## Tests first (fake sheet and store)
Quiet run writes A1 only; changed run writes rows and A1; CRM failure and zero orders write nothing; big shrink writes nothing; name reads limited to new rows; daily refresh reads all; dry run writes nothing; flag off means no reads at all.

## Done
Tests pass. Check the step alone against the real CRM, read-only, printing counts only (the Sheets API is off and the feed sheet doesn't exist yet: say so, and show that this is handled as a skipped step).

**Never run the whole `scripts/sync-intraday.js` from the worktree, even with `--dry-run`.** It would fetch mail and can open Chrome on the Inbox profile, and its lock file sits under the worktree, so it would not see a scheduled run in progress.

Commit on the worktree branch. Stop and report.

## Comments
