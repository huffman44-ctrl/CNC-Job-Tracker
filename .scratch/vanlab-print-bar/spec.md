# VanLab print bar on the job screen

Approved by Travis 2026-10-26. Split into three tickets at his request; build one, then stop for him to look.

## Why

Collin should print a VanLab order's three things at the **start** of a job — hardware stickers (STICKERS 1x3 thermal), packing list / "hardware sheet" (letter printer) and crate label (CRATE LABEL 4x6 thermal) — so the hardware kit gets packed between sheets while the CNC cuts. Printing was never gated on completion, but all three hid behind a small grey "VanLab Stickers" header button.

## What it is

- A bar on the content (job) screen directly under the progress strip, above the sheet list. It shows only on VanLab jobs: `VanlabPrint.extractOrderNumber(fileNames)` finds exactly one order number with no conflict.
- On open it runs the Order Log lookup itself (same flow and stale-lookup guard as the old panel). Heading: `VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05`.
- Three buttons: Hardware stickers (with the sticker count), Packing list, Crate label. They call the existing print functions — no second copy.
- Lookup failures fall back as today: the manual van picker plus the honest error message.
- Jobs with no order number (or sheets that disagree) keep the old header button, which opens the same bar with the manual picker.
- "Printed" means the PDF opened, not that paper came out (Travis was told).

## Tickets

1. `issues/01-the-bar.md` — the bar itself. No database writes.
2. `issues/02-print-tracking.md` — record who and when on the job doc, Reprint / Undo, live across computers.
3. `issues/03-collapse.md` — collapse to one line once all three are done. Blocked by 02.

## Real test order (post-deploy checks for Travis and Collin)

#1210 is Van 15 (Ford Transit 148 Passenger), kit 15-05, needs a crate: 7 stickers (6 kinds), packing list `Van 15_ Transit 148 Passenger.pdf`. Not verified yet: that the job's file names contain "Order 1210", and that Collin's account passes the lookup (the live script may have an `ALLOWED_UIDS` allowlist).
