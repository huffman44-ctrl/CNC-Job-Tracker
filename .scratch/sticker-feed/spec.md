# Sticker Feed: stickers get VanLab order data from the CRM, through a separate sheet

Design agreed with Travis 2026-11-09. Plan approved 2026-11-09.

## Goal
The Job Tracker's sticker and packing lookup uses CRM order data, while the Job Tracker and the CRM stay separate. The Job Tracker keeps working if the CRM is down.

Entity Store's 15-minute run copies four fields, one way, from the CRM into a new Google Sheet ("Sticker Feed") that nobody types in. The Job Tracker reads that sheet first and falls back to the Order Log.

## Hard rules
- Never write to the VanLab Order Log. People still edit it and both stay in use.
- No changes to the CRM app (`HQ/crm/`), its rules, or its separability test.
- The Job Tracker never reads the CRM directly. Collin has no CRM login.
- No new Firestore collections and no rules change in cnc-job-tracker.
- This repo is PUBLIC: the feed sheet id and any customer data are never committed. Fake names in fixtures and tests.
- Output from any check prints counts and order numbers only.

## Sheet layout (the contract between both halves)
Tab `Order Log`. A1 = "last updated" ISO time. Header on row 4, data from row 5.
Column B order number, C customer, E van, F kit number. A and D stay empty.
Written with `valueInputOption: RAW`, so `15-05` never becomes a date and a name starting with `=` never becomes a formula.

## Decisions from the plan
- **A1 is written on every successful run; order rows only when something changed.** Otherwise a quiet day would look stale.
- **Order number:** document id without `VL-`, only for ids matching `^VL-\d+$`.
- **Kit number:** `fulfillment.assembly`, as typed.
- **Van text:** `<van number>: <vanLabel>` (with the colon, matching the Order Log's column E), e.g. `22: Ford Transit 148"`. The wheelbase is left off when the label already contains it as a whole word, so a van never reads `Sprinter 170 170"`. Blank when the kit doesn't decode to a known van, or the van's label says ARCHIVED. A blank van sends the lookup to the Order Log.
- **Customer:** the person's name, else the order's `customerName`, else blank. A value containing `@` or 7+ digits in total (dashes and spaces don't hide a phone number) is treated as blank.
- **Crate labels** print the van text, so they show the CRM's shorter name when the feed is used. Accepted in the plan.
- **Never blank the sheet:** a failed CRM read or zero orders leaves it alone. So does a result under half the rows already there.
- **Reads:** orders and vans every run; customer names only for rows not yet on the sheet, plus a full name refresh once a day. On the other runs each existing row keeps the name already on the sheet.
- **Comparison between sources** is on van key and kit number (trimmed, case-insensitive), never van wording.
- **Stale** means A1 is over 2 hours old or unreadable. The run stops 9 PM to 2:45 AM, so a late-night notice is expected.
- `parseVanKey` is unchanged. Van `13J` becomes `13`. No order uses 13J today; Travis decides if one ever does.

## Tickets
| # | Repo | What | Blocked by |
|---|---|---|---|
| 01 | Entity Store | Row builder (pure, no writes) | |
| 02 | Entity Store | Sheet writer + step in the 15-minute run, flag off | 01 |
| 03 | CNC_WebApp | `lookupOrder`: feed first, fallback, disagreements | |
| 04 | CNC_WebApp | Screen wording and the disagreement warning | 03 |
| 05 | both | Data-access review (Fable) | 02, 04 |
| 06 | both | Go-live, each step on Travis's go | 05 |

Sonnet subagents build, a fresh Opus subagent reviews each ticket, tests first. Entity Store work is in a git worktree (scheduled tasks run from its master). CNC_WebApp work is in a git worktree (`master` is the live site).

## Out of scope
The Python tools in Shop Management for VanLab. Retiring the Order Log.

## Known differences to test against
- CRM orders with no kit number have no van in the CRM.
- Three older sheet order numbers are off by one from Shopify. The CRM follows Shopify, so older numbers can disagree.
- Sheet-only rows such as `INVOICE 1030` are not CRM order 1030. Never match on digits alone.
- The saved Order Log copy (July) predates the van renumbering, so a real comparison must use the current sheet.
