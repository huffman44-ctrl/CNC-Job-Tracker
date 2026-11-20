# 06 — Go-live

Status: ready-for-human
Blocked by: 05

Each numbered step waits for Travis's go.

1. Turn on the Google Sheets API in `vanlab-crm`.
2. Find which Google account the Apps Script runs as: the account signed in at script.google.com that owns the project (top-right picture). Manage deployments only says "Me".
3. Create the sheet in that account. **Title it exactly `Sticker Feed`**; the copy job refuses any other title. Tab `Order Log`. On row 4 type the headers: `Order #` in B, `Customer` in C, `Van` in E, `Kit` in F. Leave rows 1 to 3 and columns A and D empty. Nobody types below row 4. Share with specific people only: the service account as editor. If it can't live in that account, also share it with that account as viewer.
4. Merge Entity Store's branch and add `STICKER_FEED_SHEET_ID` (back up `.env` first). Claude runs the feed step alone, dry, never the whole 15-minute script. **The first dry run must report 0 rows on the sheet. Anything else means the id is wrong: stop.** Then set `INTRADAY_STICKER_FEED=1`.
5. Check the sheet filled in: row count, A1 moving, no extra columns.
6. Compare old and new lookups on several real recent orders against the current Order Log, in a copy, printing counts and order numbers only.
7. Push the screen (`master` is the live site). Ctrl+Shift+R on the shop PC.
8. In script.google.com, edit the live script in place. **Never paste the whole repo file**: it is placeholders and would wipe the real ids and `ALLOWED_UIDS`.
   - Add both new constants: `FEED_SPREADSHEET_ID` with the real id, and `FEED_STALE_MS`.
   - Replace `lookupOrder`, and add `cellText_`, `orderFields_`, `findOrderRow_`, `readOrderLogOrder_`, `readFeedOrder_`, `feedTimeMs_`, `ordersDisagree_`. `normalizeOrderId` and `parseVanKey` are unchanged.
   - Save, then Manage deployments, pencil, New version. Not New deployment, which changes the URL.
9. Open a real VanLab job as Travis, then as Collin. Confirm the source shown and that printing works. While there, confirm `ALLOWED_UIDS` in the live script holds only the people who should use it.

Rollback: set the feed constant back to PASTE and publish New version, so the lookup goes back to the Order Log only. Then set `INTRADAY_STICKER_FEED=0` so the copy job stops. If it is staying off, also remove the service account from the sheet's sharing.

## Comments

2026-11-09 status. Steps 1 to 3 done. Step 4 done except the last part: Entity Store master holds the copy job (e6fded7, 1,324 tests pass, not pushed), `.env` backed up to `.env.bak-2026-11-09-before-sticker-feed` and has `STICKER_FEED_SHEET_ID`. Dry run of the step alone reported 0 rows on the sheet, would write 223. `INTRADAY_STICKER_FEED` is NOT set yet: that waits for Travis's go.
The script runs as the huffman44 account. Lookup and screen are on CNC_WebApp branch `worktree-agent-a980fe0811dee9ed7` (650dc4e), not merged. Next after the flag: steps 5 to 9.

2026-11-09 9:31 AM. Flag on (step 4 done). First scheduled run filled the sheet: 223 order rows, 6 columns, A and D empty, 140 with a van, 159 with a kit, no emails, no doubled wheelbases. Still to confirm for step 5: A1 moves on the next run with rows left alone. Entity Store master still not pushed.

2026-11-09 9:46 AM. Step 5 done: the 9:45 run logged "rows unchanged, stamp written; 0 names read", A1 moved to 17:45 UTC, 223 rows intact. Step 6 done, against the current Google Sheet "VanLab Order Log" (221 rows, read in Chrome: order, van, kit only), running the branch's `lookupOrder` in a vm: 249 order numbers, 0 disagreements. 139 feed and Order Log agree, 1 feed only (1153), 79 fall back to the Order Log (feed row has no van or kit), 30 found in neither, same as today. Recent found in neither: 1154, 1156, 1158, 1176, 1188. Not covered: the real deployed script and real sign-in (step 9). Next: step 7, on Travis's go.

2026-11-09. Step 7 pushed: master 650dc4e, 695 tests and both browser checks pass, sheet id not in the repo, GitHub Pages built, served js matches the pushed files. Shop PC Ctrl+Shift+R still needed BEFORE step 8. Next: step 8, on Travis's go.

2026-11-09. Shop PC refreshed (Travis). Step 8 edit made in the live script from Chrome and SAVED, not published: both constants added, `lookupOrder` replaced, seven helpers added, fingerprints match the tested code, all 31 old functions still present, `normalizeOrderId` and `parseVanKey` unchanged. The running deployment is unchanged until Manage deployments, pencil, New version. `ALLOWED_UIDS` holds 2 uids: check at step 9 who they are.

2026-11-09. Step 8 done: published as Version 17 on the deployment the app calls (same URL; the other active deployment is an old Version 1, left alone). Before publishing, the saved code was confirmed to be exactly Version 16 plus this edit. Rollback target is Version 16. Next: step 9, with Travis and Collin.

2026-11-09. Step 9 part 1: Travis opened a real VanLab job, signed in, and it showed the customer and "from the CRM feed". Still to do: Collin on the shop PC signed in as himself, one real print checked, who the 2 `ALLOWED_UIDS` are (Eva?), then push Entity Store master. Separate, for later: Travis has a VanLab job with no order number in its file names (Dodge_Promaster_PANELS).

2026-11-09. Step 9 passed: Collin's sign-in worked on the shop PC (Travis's report). Go-live is complete. Because `ALLOWED_UIDS` has exactly 2 entries and both Travis and Collin got through, Eva is not on it: her lookups would be refused. That predates this work. Entity Store master pushed to its private GitHub (e6fded7). Open: add Eva if Travis wants.
