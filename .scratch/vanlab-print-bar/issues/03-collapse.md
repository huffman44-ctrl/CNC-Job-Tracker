# 03 — Collapse the bar once the kit is printed

Status: ready-for-agent

Blocked by: 02

Spec: `.scratch/vanlab-print-bar/spec.md`

## What to build

- Once all three are done, the bar shrinks to one thin line: `VanLab kit printed ✓`, with a Show button that expands it again (expanded stays for that job until it is closed; a fresh open starts collapsed).
- The packing list counts as done when `PackingMap.resolve(vanKey, assembly, null).status === 'none_needed'` (a van with no packing list) — no record is needed for it, and it shows `✓ Packing list` / `None needed for this van` with nothing to undo.
- An Undo on any item re-opens the bar.
- Collapse applies only to the automatic bar on VanLab jobs, not the manual picker.

## Pure

`VanlabBar.barState(printed, { packingNone, expanded })` → `{ allDone, collapsed }` (`collapsed = allDone && !expanded`). Tests: two of three → open; all three → collapsed; expanded → open; stickers + crate + no packing list needed → collapsed.

## Done

`node --test` green, browser check covers collapse → Show → Undo re-opens, `?v=` bumped.
