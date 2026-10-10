# Shared key helpers

Status: ready-for-agent

Date: 2026-10-10. From a grilling session with Travis (improvement candidate #4). Built on branch `shared-key-helpers` off `master`.

## Problem Statement

Every job, customer and sheet is filed in the database under an ID built from its name. The formulas are each written once, but they live in the main app file (`app.js`), so the other screens get them handed over at start-up:

- If that hand-over were ever missed, the Billing screen silently used the plain name as the ID (its defaults were `s => s`) instead of failing.
- "Which job does this sheet belong to?" is written in two places that differ slightly: `app.js` falls back to "Unknown Job", the billing model doesn't.
- The hash behind every ID (`simpleHash`) lives in the upload parser, which `node --test` cannot load, so nothing pins what the IDs come out as.
- The job ID function is called `noteKey`, a leftover from when it only filed job notes; it now files `jobs/`, `jobBilling/`, `projectNotes/` and `projectCustomer/`.

The IDs are the document ids of every live record. Changing what a formula produces would cut every job and customer off from its records.

## Solution

One small shared file, `js/keys.js`, holds every ID formula and the sheet-to-job rule. Its outputs are locked by tests and must never change.

## User Stories

1. As Travis, I want the ID formulas locked by tests, so that no future change can quietly cut jobs or customers off from their records.
2. As a maintainer, I want one file that says how every ID is made, so that the upload fix (#3) and any new screen get IDs from one place.
3. As a maintainer, I want no screen to fall back to a wrong ID when wiring is missed, so that a mistake fails loudly instead of writing records under the wrong key.
4. As a maintainer, I want the board and billing to use the same "which job is this sheet in" rule, so that they always agree.
5. As a maintainer, I want the job ID function named for what it is (`jobKey`), so that the code reads true.
6. As Collin, Travis and Eva, I want nothing on screen to change.

## Implementation Decisions

- **`js/keys.js`** — browser global `Keys`, `module.exports` for `node --test`, loaded before every module that uses it.
  - `Keys.job(jobName)` = `'proj_' + simpleHash(jobName)` — no trimming, ever (a trimmed formula would orphan any job whose name has a stray space).
  - `Keys.customer(name)` = `'cust_' + simpleHash(name.trim())`.
  - `Keys.sheet(fileName)` = `simpleHash(fileName)` (the sheet's `fileKey`).
  - `Keys.jobOf(sheet)` = `sheet.jobName || sheet.fileName || 'Unknown Job'` (the app's existing `projectKey` rule, decided to win; differs from billing's only when a sheet has neither name, which can't happen for an upload).
  - `simpleHash` moves here from `parser.js`, unchanged.
- **Locked formulas:** a test pins the exact output for several made-up names (including a name with surrounding spaces, and the empty string). CLAUDE.md records "never change these".
- **Screens call `Keys` directly:** `app.js`, `job-details.js`, `job-card.js`, `billing.js`. The `noteKey` / `customerKey` hooks and the Billing screen's identity defaults are removed.
- **The billing model keeps receiving the ID formulas as inputs** (renamed `jobKeyOf` beside the existing `customerKeyOf`), so its tests keep readable fake IDs; it gets the sheet-to-job rule from `Keys.jobOf` (no hashing, so tests stay readable). Missing inputs already fail loudly.
- **Rename:** `noteKey` → `Keys.job` everywhere in code; Storage's parameter names `noteKey` → `jobKey`. Stored ids are unchanged.
- **Cache-busting:** bump the `?v=` of every changed script in `index.html`.

## Testing Decisions

- **New test point: `Keys`** — the locked outputs, `jobOf` fallbacks, and that `customer` trims while `job` does not.
- Existing tests keep passing; the billing-model tests rename `noteKey` → `jobKeyOf`.
- Both PASTE browser checks pass (they reference `noteKey`/`simpleHash` in page code; update to `Keys`).
- Review: a fresh Opus reviewer. No Fable: nothing about who may read or write changes.

## Out of Scope

- Any change to what an ID comes out as (including case-folding customer names or trimming job names).
- Firestore rules, stored data, migrations.
- The re-upload guard (#3).
