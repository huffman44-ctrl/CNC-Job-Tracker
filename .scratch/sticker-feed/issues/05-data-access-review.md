# 05 — Data-access review

Status: ready-for-agent
Blocked by: 02, 04
Model: Fable subagent (customer data, who can read what). Give it the full context; it starts blank.

Read `../spec.md` first.

## Check
- Only four fields can ever reach the feed. Nothing writes to the Order Log.
- The feed writer can only reach the one feed sheet.
- The lookup still verifies the token before any read, returns one order per call, and offers no way to list orders.
- Nothing about the feed (id, names) lands in the public repo, its tests, or logs.
- Every failure path: never blanks the sheet, never prints a wrong kit silently, never stops the 15-minute run.

## Done
Findings reported, real ones fixed and re-checked. Stop and report.

## Comments
