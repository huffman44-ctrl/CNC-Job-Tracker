# Shared Master Job Log write rule

Status: ready-for-agent

Date: 2026-10-10. Builds on the export finish module (spec `docs/specs/2026-10-10-print-ticket-and-export-finish.md`, Change 2), which is committed on the local branch `export-finish` and not yet pushed. Build this on top of that branch.

## Problem Statement

Two parts of the job tracker write rows to the Master Job Log: **Export** (Collin finishing a job) and **Billing** (an owner clicking Imported OK on an invoice, or retrying the log write from Recent invoices). Each one separately decides "did the Master Job Log write actually work?" from the reply it gets back, and the two decisions are not the same:

- Export counts a write as done only when the reply says OK.
- Billing counts a write as done unless the reply explicitly says it failed, so a reply that says neither OK nor failed counts as written.

Both also carry their own copy of the "the Master Job Log connection isn't set up on this computer" rule and its wording.

Today no real reply can reach that gap, because the Job Log client already turns every not-OK reply into an error before Export or Billing sees it. The difference is on paper only. But nothing keeps the two rules in step: if someone changes the Job Log client or one of the two callers, Export and Billing can silently start disagreeing about whether the log was written. For Export that would decide whether a job leaves the board. For Billing it would decide whether an invoice is marked as logged, and the Retry button goes away once it is.

## Solution

One shared rule decides whether a Master Job Log write worked, and both Export and Billing use it. Where the two disagree, the stricter rule wins: a write counts as done only when the reply clearly says it succeeded. When in doubt, the job stays on the board, or the invoice stays marked "not logged" with its Retry option.

Nothing changes for Collin, Travis or Eva in any case that can happen today. Every message stays word for word as it is now. The only behaviour difference is the unreachable case: a reply that says neither OK nor failed would now leave a Billing invoice marked "not logged" and retryable, the same way Export already treats it.

## User Stories

1. As Collin, I want Export to finish a job only when the Master Job Log really took the rows, so that a job never leaves the board without being logged.
2. As Collin, I want the same messages I see today when the Master Job Log write fails, so that nothing about exporting feels different.
3. As Collin, I want a job kept on the board whenever the Master Job Log reply is unclear, so that I can export it again once the connection is fixed.
4. As Collin, I want exporting a job twice to keep updating the same log rows and never add duplicates, so that retrying after a failure is always safe.
5. As Collin, working on a computer where the Master Job Log connection isn't set up, I want Export to refuse to finish the job and tell me why, so that I don't think a job was logged when it wasn't.
6. As Travis, I want an invoice marked as logged only when the Master Job Log really took its rows, so that the log matches what was billed.
7. As Eva, I want the same, so that either owner can trust the "logged" state on Recent invoices.
8. As an owner, I want an invoice whose log write was unclear to stay marked "not logged" with its Retry option, so that I can retry it instead of discovering a missing row later.
9. As an owner, I want the "connection isn't set up on this computer" reason shown exactly as it is today when I click Imported OK on such a computer, so that I know to use a set-up computer.
10. As an owner, I want the log write error from the server shown exactly as it is today, so that I can tell a sheet problem from a connection problem.
11. As an owner, I want a labor-only invoice (no sheets) to keep counting as logged without any Master Job Log call, so that design-hours-only bills still complete.
12. As an owner, I want Export and Billing to agree on what "logged" means, so that a job's sheets and its invoice never tell two different stories about the Master Job Log.
13. As Travis, I want this change to make no visible difference to Collin's daily work, so that I can ship it without retraining anyone.
14. As a maintainer (a future Claude session or developer), I want one place that defines a successful Master Job Log write, so that changing the rule is a one-place change.
15. As a maintainer, I want the "not set up on this computer" rule (it counts as success in PASTE test mode only) defined once, so that test mode and real sessions can't drift between Export and Billing.
16. As a maintainer, I want tests on both Export and Billing that fail if either one stops following the shared rule, so that a future drift is caught before it reaches the shop floor.
17. As a maintainer, I want the shared rule tested through the existing Export and Billing test points, not on its own, so that the tests describe what operators and owners experience rather than how the rule is built.
18. As a maintainer working in PASTE test mode, I want an unconfigured Master Job Log to keep counting as success there, so that offline test runs can still finish jobs and complete invoices.
19. As a maintainer, I want the reason text for "not set up" to have one source, so that Export's alert and Billing's stored error can't drift in wording.
20. As Travis, I want this shipped together with the export finish cleanup, or right after it, so that the shop computer needs only one hard refresh.

## Implementation Decisions

- **One shared rule, next to the Job Log client.** It lives beside the code that already sends rows to the Master Job Log and turns error replies into errors, because that code owns what a reply means. It is a pure judgement: given the reply and whether this session has a real database, it answers "written" or "not written, with a reason". It writes nothing and shows nothing.
- **The rule's decisions:**
  - Written only when the reply clearly reports success. A missing or unclear success flag means not written. This is the stricter of the two current rules.
  - A reply marked "offline" (the Job Log connection isn't configured on this computer) counts as written only when there is no real database (PASTE test mode). In a real-database session it is not written, with the "connection isn't set up on this computer" reason.
  - Any other not-written outcome carries the server's own error text when the reply has one.
- **Thrown errors stay with the callers.** A failed sign-in token, an unreachable endpoint, or an error raised by the Job Log client are still handled by Export and Billing exactly as today. The shared rule only judges a reply that actually came back.
- **Export uses the shared rule** inside the export finish module's "log, then finish" step. Collin's alert text stays word for word, including "the Master Job Log connection isn't set up on this computer".
- **Billing uses the shared rule** in the invoice store's Master Job Log write (Imported OK, Add PO, and Retry from Recent invoices). The stored `logError` text stays as today, including the "not set up" reason and the server-error fallback "The Master Job Log did not accept the rows".
- **One source for the "not set up" reason.** Both callers take the reason wording from the shared rule. Each keeps its own surrounding sentence, so every visible text stays identical.
- **Behaviour change, deliberate and limited:** in Billing, a reply that lacks a clear success flag becomes "not logged" (retryable) instead of "logged". This case cannot occur with today's Job Log client.
- **No change to:** the Job Log client's error handling, the Apps Script endpoint, the log row columns, the invoice lifecycle, Firestore rules or data shape, or any screen.
- **Cache busting:** every changed script gets its version number bumped where it's loaded.

## Testing Decisions

- **A good test here** sets up a Master Job Log reply, runs Export's "log, then finish" step or Billing's log write through its normal interface, and checks what an operator or owner would see: whether the job finished or the invoice is marked logged, and the exact message or stored error. Tests never call the shared rule directly or check how it is wired.
- **Test points: the two that already exist, no new ones.**
  1. The export finish module's "log, then finish" step, which has 16 tests today. Add: a reply with no success flag leaves the job on the board with the "endpoint unreachable" message. The existing offline, PASTE-mode, server-error and success tests must keep passing unchanged.
  2. The invoice store's Master Job Log write (Imported OK and the retry). Add: a reply with no success flag leaves the invoice not logged and retryable, with the "did not accept the rows" error. Also lock in that an OK reply is logged, that offline with a database is not logged with the exact reason, and that offline in PASTE mode is logged. The existing labor-only and timeout tests must keep passing.
- **Prior art:** the export finish tests (fake collaborators, call order recorded in a list) and the invoice store executor tests (the in-memory fake Firestore helper in the test helpers folder, with the Master Job Log faked by swapping its implementation per test).
- **Whole suite and browser checks:** the full `npm test` suite and both PASTE-mode browser checks (phase 1 and phase 2) must pass.
- **Review:** a fresh Opus reviewer before asking Travis to push, because Billing touches invoices.

## Out of Scope

- Changing how the Job Log client handles error replies, or the Apps Script endpoint.
- Any wording change to Collin's export messages or owners' billing errors.
- Making the job doc and sheet finish writes atomic (follow-up 2 in the export finish spec).
- The Print Ticket button (already live) and the open question of whether earlier mid-job Exports finished jobs early (needs a person: ask Collin).
- Sharing anything else between Export and Billing, such as the sign-in token handling.

## Further Notes

- The case this fixes can't happen today, so the change protects future edits rather than fixing a live problem. The estimated build is 20–30 minutes plus review.
- It depends on the unpushed `export-finish` branch. Ship both together, or this one right after, so the shop computer needs one Ctrl+Shift+R.
- A push to `master` is a live deploy to the shop floor. Ask Travis before pushing.
