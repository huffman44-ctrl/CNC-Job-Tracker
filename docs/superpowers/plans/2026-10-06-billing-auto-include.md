# Billing — everything cut goes in, no Done step, jobs reachable from Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every cut, unbilled sheet in the date window is on the bill by default (the owner removes, never adds); design/CAM hours go on the next bill the moment they are entered (the *Done — ready for billing* step disappears); every job on Billing and every recently finished job opens its job card in one click with Back returning to Billing; a job's design/CAM minimum is charged once per job even when its hours go out on two bills.

**Architecture:** Four pure modules change and the screens follow them. `js/pricing.js` gains one optional input (`priorLaborHours`) and the once-per-job minimum formula (spec §5) — still the ONLY place money is computed. `js/invoice-lines.js` gains the wording for a line covered by an earlier minimum. `js/billing-model.js` drops the `waiting` state and the `readyForBilling` gate, includes every row by default, feeds prior hours to pricing, and gains `recentJobs()` (pure). `js/invoice-store.js` swaps the lock's `readyForBilling` re-check for a prior-hours re-check. `js/job-card.js` loses Done / No design time and gains the billing-status chip and per-line status words. `js/billing.js` renders the new rows, job-name links and the Recent jobs block; `js/app.js` gains only hooks (Back-to-Billing, the chip's sheet list). No Firestore rules change; Collin's screens do not change.

**Tech Stack:** Vanilla JS IIFE modules with the `module.exports` shim, Firestore compat SDK (unchanged), `node --test` (Node 24), Playwright from `HQ/node_modules` driven by `tools/browser-check-phase2.mjs` against a PASTE-mode temp copy served by an in-process `node:http` server (never `npx serve`).

**Spec:** `docs/superpowers/specs/2026-10-06-billing-auto-include-design.md` (committed on master as `81960e4`). It builds on `docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md`; the Phase 2 plan `docs/superpowers/plans/2026-10-05-customer-billing-phase-2.md` is the format reference and names the files this plan touches.

**Build model (house rule, `~/.claude/CLAUDE.md`):** Sonnet implements every task; Opus reviews each task; **Fable only for the final whole-branch review (Task 11), and the controller asks Travis before dispatching it** (tokens-low rule). Say which model a subagent is on when dispatching.

---

## Global Constraints

- **Never run the app against the real config.** Every browser check runs from a temp copy with BOTH `js/firebase-config.js` → `const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };` and `js/endpoint-config.js` → `const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };`. `tools/browser-check-phase2.mjs` already does this and serves the copy from an in-process `node:http` server on an ephemeral port — never `npx serve`, never a spawned child. Production Firestore and the live Apps Script are never touched by any task.
- **`master` is a live deploy** (GitHub Pages, no build step). All work happens in the git worktree `.worktrees/billing-auto-include` on branch `billing-auto-include` off `master`. **No task pushes, merges or deploys.** Merge + push is a Travis-approved hand step (Task 11).
- **Collin's screens do not change.** Nothing new renders unless `Features.on('billing')` / `Features.on('jobCard')` is true (never `Features.isOwner()` alone). `tools/browser-check-phase1.mjs` and section 1 of `browser-check-phase2.mjs` (Collin) must still PASS unchanged.
- **No Firestore rules change, no new fields, no migration** (spec §6). `jobBilling.readyForBilling`, `readyAt`, `readyBy`, `noDesignTime` stay on existing docs and are no longer read or written by any code path. `OwnerStore.newJobBilling()` keeps seeding them as `false`/`null` on brand-new docs (rules unknown to this repo; a different key set is not worth a rules deploy) — the one tolerated mention outside comments.
- **Money math lives only in `Pricing.priceInvoice()`.** `invoice-lines.js` formats; `billing-model.js` selects; screens display. The spec §5 formula is implemented verbatim (see Task 1) and the three §5 table rows are tests.
- **Fake names only** (public repo): Northlight Studios, Harbor Lane Pictures, Copperline Stage, Ridgeway Vans; jobs `NL_…`, `Order_1195`… No real email, uid, token or spreadsheet id anywhere; owner stubs use `t@x`.
- **Script cache-busting (Task 8, its own commit):** `pricing.js?v=3`, `invoice-lines.js?v=2`, `billing-model.js?v=2`, `invoice-store.js?v=2`, `billing.js?v=2`, `job-card.js?v=3`, `app.js?v=37`, `style.css?v=26`. (`job-details.js` changes a comment only — no bump.)
- **Commit messages** end with the `Co-Authored-By:` line the session's attribution reminder gives for the model that makes the commit.
- **`js/app.js` gains only hooks** (the `cardReturn` flag, the Back-button branch, the Back label, `cardChip(jobName, projectSheets)`). Anything else in `app.js` is a review finding.
- **Firestore traps (still true):** no new queries are added; `recentJobs` is built from the finished list Billing already loads.

## Review Focus

Inputs the spec implies but no mockup shows; each is pinned to a test.

1. **A credit bigger than the last line's hours** — 0.5 h billed on an earlier invoice, then two 0.25 h lines: the §5 formula gives `thisBill = 0`, but "the credit stays on the LAST line" would make that line −0.25 h. Expected: both lines bill 0 h, no line ever negative — Task 1 test "credit larger than the last line".
2. **A $0.00 labor-only bill** (0.5 h then 0.5 h): the Bill button must read `$0`, the lock must succeed, the CSV row must carry amount `0` and say "covered by the 1-hr minimum", Recent invoices must show `$0` — Task 1 (total 0, one line amount 0), Task 2 (wording), Task 9 step 9b (the live page prices it). Whether QuickBooks accepts a $0 line is a Travis hand check (spec §7, Task 11).
3. **Prior hours change between render and lock** (the other invoice holding those lines was cancelled, or a billed line appeared): the lock must refuse with "Something changed" instead of charging a minimum twice — Task 4 test `prior`.
4. **Recent jobs edge cases:** a job with one sheet still on the board, a job finished 31 days ago, a finished sheet with no `finishedAt`, a customer billed outside this app — none listed — Task 5 tests.
5. **Back after Put back on the board from a card opened from Billing:** Put back goes to Projects (the sheets listener brings the job back), so the "return to Billing" flag must be cleared and the Back label reset to "← Projects" — Task 7 (`showProjectsScreen` clears it) + Task 9 step 7c.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `js/pricing.js` | modify | `priceInvoice` input `priorLaborHours`; once-per-job minimum (§5); `coveredHours` on labor results; breakdown wording; new helper `priorLaborHours(laborLines)` |
| `js/invoice-lines.js` | modify | labor description for a credited / $0.00 line |
| `js/billing-model.js` | modify | no `waiting`, no `readyForBilling` gate, every row `defaultIncluded`, toggle switches sheets + labor together, `priorLaborHours` through `rowPricing` / `laborAmount` / `pricingInput`, `billedOn`, `rowDetail` design state, `laborText()`, fingerprint `priorLabor`, **`recentJobs()`** |
| `js/invoice-store.js` | modify | `planLock`: `readyForBilling` re-check → prior-hours re-check |
| `js/job-card.js` | modify | remove Done / Edit — not ready / No design time; `billingState()`, `jobState(jobName, sheets)`, chip words; `lineStatusText()`; caption |
| `js/job-details.js` | modify (comment) | the applyDetails comment no longer names readyForBilling / noDesignTime |
| `js/billing.js` | modify | row labels / toggle words, job-name link, `#billing-recent-jobs` block, `show({ resume })` |
| `js/app.js` | modify (hooks) | `cardReturn`, Back branch + label, `showProjectsScreen` reset, `cardChip(jobName, projectSheets)` |
| `index.html` | modify | `<div id="billing-recent-jobs">`; `?v=` bumps (Task 8) |
| `css/style.css` | modify | `.billing-job-link`, `.billing-recent-job*`; drop `--waiting` |
| `test/pricing-invoice.test.mjs`, `test/invoice-lines.test.mjs`, `test/billing-model.test.mjs`, `test/invoice-store.test.mjs`, `test/invoice-store-exec.test.mjs`, `test/job-card.test.mjs` | modify | per task |
| `tools/browser-check-phase2.mjs` | modify | Done step replaced by the §7 flow; labor-only, $0 and Recent jobs assertions |
| `CLAUDE.md`, spec status line, vault note | modify | Task 10 |

---

### Task 0: Worktree and baseline (controller step)

**Files:** none changed.

- [ ] **Step 1: Worktree** (from the main checkout; `.worktrees/` is in `.gitignore`):

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git status --short | head -5          # expect only this plan file untracked
git log --oneline -1                  # expect 81960e4 (the spec commit) or later
git worktree add .worktrees/billing-auto-include -b billing-auto-include master
cd .worktrees/billing-auto-include && npm test 2>&1 | tail -8
```

Expected: `ℹ tests 492` / `ℹ fail 0` (baseline at `81960e4`, measured 2026-10-06). Every later task runs from this worktree. After each implementer reports DONE, run `git -C .worktrees/billing-auto-include log --oneline -1` and confirm the commit is on `billing-auto-include`, not `master` (memory: an implementer once committed to master by cwd mismatch).

- [ ] **Step 2: Commit the plan on the branch.** Copy this plan file into the worktree's `docs/superpowers/plans/`, `git add` + commit (`docs: billing auto-include plan`). Before the merge in Task 11, delete the untracked copy in the main checkout or git refuses the merge.

- [ ] **Step 3: Baseline browser checks** (from the worktree): `node tools/browser-check-phase1.mjs` → `SUITE: PASS`; `node tools/browser-check-phase2.mjs` → `SUITE: PASS`. (Each copies the tree to a temp dir, blanks both configs, serves in-process.)

---

### Task 1: `Pricing.priceInvoice` — the minimum charged once per job (`priorLaborHours`)

**Files:**
- Modify: `js/pricing.js` (labor block ~l.159-183, `buildBreakdown` labor label ~l.277-280, exports l.295)
- Test: `test/pricing-invoice.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `priceInvoice(input)` accepts optional `input.priorLaborHours: { [jobKey]: { [typeId]: hours } }` — hours of that job's lines of that type already billed or in progress on earlier invoices (real hours, no top-up). Absent (or a missing job/type) = `0` = today's behaviour.
  - Each entry of `result.labor` keeps `hours` (entered), `topUpHours` (now **signed**: `> 0` top-up to the minimum, `< 0` credit because the minimum was already charged), `billedHours = hours + topUpHours` (never negative) and gains `coveredHours = max(0, −topUpHours)`.
  - `Pricing.priorLaborHours(laborLines) → { [typeId]: hours }` — sums `hours` of lines whose `status` is `billed` or `in-progress`. Used by BillingModel (Task 3) and InvoiceStore (Task 4) so both compute `prior` the same way.
  - Breakdown label for a credited line: `Design 1.5 h (0.5 h covered by the 1-h minimum) — note`; for a line billed at 0 h: `Design 0.5 h (covered by the 1-h minimum) — note` (entered hours shown, so the customer sees them). Top-up wording unchanged: `Design 1 h (includes 1-h minimum)`.

**The formula (spec §5, verbatim), per job, per labor type:**

```
prior     = priorLaborHours[jobKey][typeId] || 0
now       = Σ hours of that type's lines on this invoice
charged   = prior > 0 ? max(minHours, prior) : 0
thisBill  = max(minHours, prior + now) − charged          // never negative
```

`thisBill − now` is the adjustment. It lands on the LAST line of that type (as today). A **credit larger than the last line's hours continues onto the line before it** (walk the type's lines from last to first, each line absorbs at most its own hours), so no line ever bills negative hours — this is the only way the spec's "never negative" holds for the multi-line case (Review Focus 1).

- [ ] **Step 1: Write the failing tests** — append to `test/pricing-invoice.test.mjs` (the file's `price(parts, extra)` helper spreads `extra` into the input, so `priorLaborHours` passes straight through):

```js
/* ---- spec 2026-10-06 §5: the minimum is charged once per job, across all of its bills ---- */
const laborOnly = (lines, extra = {}) => price({ jobs: { J: job('J', { includeLabor: true, laborLines: lines, ...extra }) }, sheets: [] });
const dl = (id, hours, note = '') => ({ id, typeId: 'design', hours, note });

test('§5 row 1: 0.5 h then 0.5 h → 1 h $150, then 0 h $0.00; job total 1 h $150', () => {
  const first = laborOnly([dl('a', 0.5, 'Sketch')]);
  assert.deepEqual([first.labor[0].billedHours, first.labor[0].topUpHours, first.labor[0].coveredHours, first.perJob.J.laborBase], [1, 0.5, 0, 150]);
  const second = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('b', 0.5, 'Revisions')] }) }, sheets: [] }, { priorLaborHours: { J: { design: 0.5 } } });
  const l = second.labor[0];
  assert.deepEqual([l.hours, l.billedHours, l.topUpHours, l.coveredHours], [0.5, 0, -0.5, 0.5]);
  assert.equal(second.perJob.J.laborBase, 0);
  assert.equal(second.total, 0, 'a $0.00 labor-only invoice is a valid invoice');
  assert.equal(second.lines.length, 1); assert.equal(second.lines[0].type, 'labor'); assert.equal(second.lines[0].amount, 0); assert.equal(second.lines[0].rate, 0);
  assert.equal(second.breakdown.find(b => /^Design/.test(b.label)).label, 'Design 0.5 h (covered by the 1-h minimum) — Revisions');
  assert.equal(first.perJob.J.laborBase + second.perJob.J.laborBase, 150);
});

test('§5 row 2: 0.5 h then 2 h → 1 h $150, then 1.5 h $225; job total 2.5 h $375', () => {
  const second = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('b', 2)] }) }, sheets: [] }, { priorLaborHours: { J: { design: 0.5 } } });
  const l = second.labor[0];
  assert.deepEqual([l.hours, l.billedHours, l.topUpHours, l.coveredHours], [2, 1.5, -0.5, 0.5]);
  assert.equal(second.perJob.J.laborBase, 225);
  assert.equal(second.total, 225);
  assert.equal(second.breakdown.find(b => /^Design/.test(b.label)).label, 'Design 1.5 h (0.5 h covered by the 1-h minimum)');
  assert.equal(150 + second.perJob.J.laborBase, 375);
});

test('§5 row 3: 1.5 h at once → 1.5 h $225, no bracket', () => {
  const r = laborOnly([dl('a', 1.5)]);
  assert.deepEqual([r.labor[0].billedHours, r.labor[0].topUpHours, r.perJob.J.laborBase], [1.5, 0, 225]);
  assert.equal(r.breakdown.find(b => /^Design/.test(b.label)).label, 'Design 1.5 h');
});

test('§5 rush applies to the hours billed on THIS bill (row 2 at 48-hour rush)', () => {
  const r = price({ jobs: { J: job('J', { turnaround: 'rush48', includeLabor: true, laborLines: [dl('b', 2)] }) }, sheets: [] }, { priorLaborHours: { J: { design: 0.5 } } });
  assert.equal(r.perJob.J.laborBase, 225);
  assert.equal(r.perJob.J.laborRush, 112.5);
  assert.equal(r.total, 340);   // 337.5 rounded to $5
});

test('§5 a type with minHours 0: thisBill = now, prior changes nothing', () => {
  const types = [{ id: 'cam', name: 'CAM', rate: 85, minHours: 0, qbItem: 'Digital Design' }];
  const r = Pricing.priceInvoice({ priceList: STANDARD, laborTypes: types, priorBilled: [], priorLaborHours: { J: { cam: 0.25 } },
    jobs: { J: job('J', { includeLabor: true, laborLines: [{ id: 'c', typeId: 'cam', hours: 0.5, note: '' }] }) }, sheets: [] });
  assert.deepEqual([r.labor[0].billedHours, r.labor[0].topUpHours], [0.5, 0]);
  assert.equal(r.perJob.J.laborBase, 42.5);
});

test('§5 priorLaborHours absent = today\'s behaviour (0.5 h Design bills the 1-h minimum)', () => {
  const r = laborOnly([dl('a', 0.5)]);
  assert.deepEqual([r.labor[0].billedHours, r.labor[0].topUpHours], [1, 0.5]);
  const empty = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('a', 0.5)] }) }, sheets: [] }, { priorLaborHours: {} });
  assert.equal(empty.labor[0].billedHours, 1);
  const otherJob = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('a', 0.5)] }) }, sheets: [] }, { priorLaborHours: { K: { design: 5 } } });
  assert.equal(otherJob.labor[0].billedHours, 1, 'another job\'s prior hours never count');
});

test('§5 credit larger than the last line: 0.5 h billed, then 0.25 h + 0.25 h → both 0 h, never negative', () => {
  const r = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('a', 0.25), dl('b', 0.25)] }) }, sheets: [] }, { priorLaborHours: { J: { design: 0.5 } } });
  assert.deepEqual(r.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['a', 0, -0.25], ['b', 0, -0.25]]);
  assert.ok(r.labor.every(l => l.billedHours >= 0));
  assert.equal(r.perJob.J.laborBase, 0);
});

test('§5 prior hours of one type never touch another type; a type with no lines on this bill is ignored', () => {
  const r = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [dl('a', 0.5), { id: 'c', typeId: 'cam', hours: 0.25, note: '' }] }) }, sheets: [] },
    { priorLaborHours: { J: { design: 0.5, cam: 9 } } });
  assert.deepEqual(r.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['a', 0, -0.5], ['c', 0.25, 0]], 'CAM: prior 9 ≥ 0.5 min → charged 9, thisBill = max(0.5, 9.25) − 9 = 0.25');
  const noPriorCam = price({ jobs: { J: job('J', { includeLabor: true, laborLines: [{ id: 'c', typeId: 'cam', hours: 0.25, note: '' }] }) }, sheets: [] }, { priorLaborHours: { J: { design: 3 } } });
  assert.equal(noPriorCam.labor[0].billedHours, 0.5, 'Design prior does not cover CAM');
});

test('Pricing.priorLaborHours sums billed and in-progress lines per type; unbilled and absent status are ignored', () => {
  const lines = [
    { id: 'a', typeId: 'design', hours: 0.5, status: 'billed', invoiceNumber: 3600 },
    { id: 'b', typeId: 'design', hours: 1, status: 'in-progress', invoiceNumber: 3601 },
    { id: 'c', typeId: 'cam', hours: 0.25, status: 'billed', invoiceNumber: 3600 },
    { id: 'd', typeId: 'design', hours: 2, status: 'unbilled' },
    { id: 'e', typeId: 'design', hours: 4 },
  ];
  assert.deepEqual(Pricing.priorLaborHours(lines), { design: 1.5, cam: 0.25 });
  assert.deepEqual(Pricing.priorLaborHours([]), {});
  assert.deepEqual(Pricing.priorLaborHours(undefined), {});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pricing-invoice.test.mjs`
Expected: the nine new tests FAIL (`coveredHours` undefined, `billedHours 1` instead of `0`, `Pricing.priorLaborHours is not a function`); the existing tests still pass.

- [ ] **Step 3: Implement** in `js/pricing.js`.

Replace the labor block inside `jobKeys.forEach` (today's lines ~169-183, from the `// Minimums per job, per type (Decision 7)` comment through the `lines.forEach((l, i) => { … labor.push(…) })`) with:

```js
        // Minimums per job, per type (Decision 7), charged ONCE per job across all of its bills
        // (spec 2026-10-06 §5):
        //   prior    = hours of this type already billed / in progress on earlier invoices (real hours, no top-up)
        //   charged  = prior > 0 ? max(minHours, prior) : 0
        //   thisBill = max(minHours, prior + now) − charged           (never negative)
        // thisBill − now lands on the LAST line of that type: a shortfall as a top-up, a credit (the
        // minimum was already charged) as negative topUpHours. A credit larger than the last line's
        // hours continues onto the line before it, so no line ever bills negative hours.
        const priorOf = (input.priorLaborHours || {})[jk] || {};
        const z = x => (Math.abs(x) < 1e-9 ? 0 : x);
        const sumByType = {};
        lines.forEach(l => { sumByType[l.typeId] = (sumByType[l.typeId] || 0) + (Number(l.hours) || 0); });
        const adjust = {};   // line index -> signed hours adjustment
        Object.keys(sumByType).forEach(typeId => {
          const min = Number(types[typeId].minHours) || 0;
          const prior = Number(priorOf[typeId]) || 0;
          const now = sumByType[typeId];
          const charged = prior > 0 ? Math.max(min, prior) : 0;
          const thisBill = Math.max(0, Math.max(min, prior + now) - charged);
          let diff = z(thisBill - now);
          for (let i = lines.length - 1; i >= 0 && diff !== 0; i--) {
            if (lines[i].typeId !== typeId) continue;
            const take = diff > 0 ? diff : Math.max(diff, -(Number(lines[i].hours) || 0));
            adjust[i] = take;
            diff = z(diff - take);
          }
        });
        lines.forEach((l, i) => {
          const t = types[l.typeId];
          const hours = Number(l.hours) || 0;
          const topUpHours = adjust[i] || 0;
          const billedHours = z(hours + topUpHours);
          const base = billedHours * Number(t.rate);
          const rush = base * rp;
          laborBase += base; laborRush += rush;
          labor.push({ jobKey: jk, lineId: l.id, typeId: t.id, typeName: t.name, note: l.note || '', hours, topUpHours, billedHours,
            coveredHours: topUpHours < 0 ? -topUpHours : 0,
            minHours: Number(t.minHours) || 0, rate: Number(t.rate), base, rush, rushPct: rp });
        });
```

(The validation `lines.forEach` just above it — unknown type / no rate / no minimum / no hours — stays exactly as it is.)

Replace the labor part of `buildBreakdown` (today's `result.labor.forEach(l => { const bracket = … })`) with:

```js
    result.labor.forEach(l => {
      let bracket = '';
      if (l.topUpHours > 0) bracket = ` (includes ${l.minHours}-h minimum)`;
      else if (l.coveredHours > 0) bracket = l.billedHours > 0 ? ` (${hoursText(l.coveredHours)} covered by the ${l.minHours}-h minimum)` : ` (covered by the ${l.minHours}-h minimum)`;
      const shown = l.billedHours > 0 ? l.billedHours : l.hours;   // a 0-h line still shows the hours entered
      out.push({ label: `${l.typeName} ${hoursText(shown)}${bracket}${l.note ? ' — ' + l.note : ''}`, amount: l.base });
    });
```

Add the helper (after `effectiveCutDate`) and export it:

```js
  // Hours of a job's labor lines already billed or on an invoice in progress, per type — the
  // `prior` of the once-per-job minimum (spec 2026-10-06 §5). Real hours; top-ups are never stored.
  function priorLaborHours(laborLines) {
    const out = {};
    (laborLines || []).forEach(l => {
      const st = (l && l.status) || 'unbilled';
      if (st !== 'billed' && st !== 'in-progress') return;
      out[l.typeId] = (out[l.typeId] || 0) + (Number(l.hours) || 0);
    });
    return out;
  }
```

`return { signatureOf, round2, roundToStep, TURNAROUND_LABEL, priceInvoice, priorLaborHours, VBIT_KEYWORDS, … }`. Update the file header comment: "Phase 2: priceInvoice() … 2026-10-06: the labor minimum is charged once per job across bills (`priorLaborHours`)."

- [ ] **Step 4: Run the tests**

Run: `node --test test/pricing-invoice.test.mjs test/pricing-lines.test.mjs test/pricing-fixtures.test.mjs test/invoice-lines.test.mjs`
Expected: all PASS (the existing Decision-7 tests are unchanged: with no prior, `topUpHours` is still the positive top-up on the last line).

- [ ] **Step 5: Commit**

```bash
git add js/pricing.js test/pricing-invoice.test.mjs
git commit -m "feat(pricing): labor minimum charged once per job across bills — priorLaborHours input, credit on the last line, priorLaborHours() helper (spec 2026-10-06 §5)"
```

---

### Task 2: `InvoiceLines` — wording for a line covered by an earlier minimum

**Files:**
- Modify: `js/invoice-lines.js` (the `labor` describe, l.35-43)
- Test: `test/invoice-lines.test.mjs`

**Interfaces:**
- Consumes: `line.facts` = the Task 1 labor entry (`hours`, `billedHours`, `topUpHours`, `coveredHours`, `minHours`, `rate`, `rushPct`, `typeName`, `note`).
- Produces: descriptions
  - unchanged: `Design — note (1 hr @ $150/hr)`, `CAM (0.5 hrs @ $85/hr, includes 0.5-hr minimum)`;
  - credited: `Design (1.5 hrs @ $150/hr, 0.5 hrs covered by the 1-hr minimum)`;
  - billed at 0 h: `Design — Revisions (0.5 hrs, covered by the 1-hr minimum)` — no rate, no rush suffix (there is nothing to rush); the entered hours are shown so the customer sees them (spec §5).

- [ ] **Step 1: Write the failing test** — append to `test/invoice-lines.test.mjs` (its `price(parts, extra)` and `laborJob(lines)` helpers already exist; `laborJob` uses job key `L`):

```js
test('labor wording when an earlier bill already charged the minimum (spec 2026-10-06 §5)', () => {
  const zero = InvoiceLines.finalize(price(laborJob([{ id: 'b', typeId: 'design', hours: 0.5, note: 'Revisions' }]), { priorLaborHours: { L: { design: 0.5 } } }), ctx).find(l => l.type === 'labor');
  assert.equal(zero.description, 'Design — Revisions (0.5 hrs, covered by the 1-hr minimum)');
  assert.equal(zero.amount, 0); assert.equal(zero.rate, 0); assert.equal(zero.quantity, 1);
  const part = InvoiceLines.finalize(price(laborJob([{ id: 'b', typeId: 'design', hours: 2, note: '' }]), { priorLaborHours: { L: { design: 0.5 } } }), ctx).find(l => l.type === 'labor');
  assert.equal(part.description, 'Design (1.5 hrs @ $150/hr, 0.5 hrs covered by the 1-hr minimum)');
  assert.equal(part.amount, 225);
  // a $0 line at rush carries no "+ Rush" (nothing to rush)
  const rushed = InvoiceLines.finalize(price({ jobs: { L: job('L_Job', { turnaround: 'rush48', includeLabor: true, laborLines: [{ id: 'b', typeId: 'design', hours: 0.5, note: '' }] }) }, sheets: [] }, { priorLaborHours: { L: { design: 0.5 } } }), ctx).find(l => l.type === 'labor');   // prior 0.5 → charged 1 → thisBill 0
  assert.equal(rushed.description, 'Design (0.5 hrs, covered by the 1-hr minimum)');
  // the CSV carries the 0 amount as a plain 0
  const csv = InvoiceLines.buildQuickBooksCsv({ number: 3700, customerName: 'Northlight Studios', invoiceDate: '2026-10-06', dueDate: '2026-10-06', lines: [zero] });
  assert.match(csv.split('\r\n')[1], /,1,0,0,N,$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/invoice-lines.test.mjs`
Expected: FAIL — `'Design — Revisions (0 hrs @ $150/hr)'` instead of the covered wording.

- [ ] **Step 3: Implement** — replace the `labor` `describe` in `js/invoice-lines.js`:

```js
  register('labor', {
    describe(line) {
      const f = line.facts || {};
      const hrs = h => `${h} ${h === 1 ? 'hr' : 'hrs'}`;
      let s = f.typeName + (f.note ? ' — ' + f.note : '');
      if (!(f.billedHours > 0)) return s + ` (${hrs(f.hours)}, covered by the ${f.minHours}-hr minimum)`;   // minimum charged on an earlier bill
      let extra = '';
      if (f.topUpHours > 0) extra = `, includes ${f.minHours}-hr minimum`;
      else if (f.coveredHours > 0) extra = `, ${hrs(f.coveredHours)} covered by the ${f.minHours}-hr minimum`;
      s += ` (${hrs(f.billedHours)} @ $${f.rate}/hr${extra})`;
      if (f.rushPct > 0) s += ` + Rush (+${Math.round(f.rushPct * 100)}%)`;
      return s;
    },
    qbItem(line, ctx) { … unchanged … },
    taxable: (line, ctx) => taxSetting(ctx, 'labor'),
  });
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/invoice-lines.test.mjs test/pricing-lines.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/invoice-lines.js test/invoice-lines.test.mjs
git commit -m "feat(invoice-lines): labor wording for hours covered by a minimum charged on an earlier bill"
```

---

### Task 3: `BillingModel` — every row in by default, no Done gate, prior hours through pricing

**Files:**
- Modify: `js/billing-model.js` (labor filter l.128-131, state l.144, row l.147-160, `rowPricing` l.183-193, `laborAmount` l.195-201, `pricingInput` l.204-223, `rowDetail` l.251-275, `buildDraft` fingerprint l.302-308, exports l.317)
- Test: `test/billing-model.test.mjs`

**Interfaces:**
- Consumes: `Pricing.priorLaborHours(lines)` and `priceInvoice({ …, priorLaborHours })` (Task 1).
- Produces (all consumed by Tasks 4, 5, 7):
  - `row.state ∈ 'ready' | 'partly' | 'labor-only'` (**`waiting` is gone**); `row.defaultIncluded === true` for every row.
  - `row.priorLaborHours: { [typeId]: hours }` and `row.billedOn: number[]` (unique invoice numbers of the job's `billed` sheets, ascending).
  - `row.captured.job = { turnaround, materialKind, materialId, pricePerSheet, priorLabor, labor }` — **`readyForBilling` is gone, `priorLabor` is new**; `draft.fingerprint.jobs[jk].priorLabor` carries it (Task 4 compares it).
  - `pricingInput(customer, selection, ctx)` → `{ priceList, laborTypes, jobs, sheets, priorBilled, priorLaborHours }`; the choice `selection[jobKey].sheets` (absent → `defaultIncluded`) switches the row's sheets AND its labor together in every state.
  - `rowPricing` / `rowAmount` / `laborAmount` pass `priorLaborHours: { [row.jobKey]: row.priorLaborHours }`.
  - `laborText(lines) → '1.5 h Design' | '1.5 h Design, 0.5 h CAM' | 'no design hours'` (entered hours per type, line order, `typeName` as stored — "CAM" is never lower-cased). Exported; Task 5 reuses it.
  - `rowDetail(row, priced)`: sheet parts as today, then material, then the design state at the END: `… · customer supplied · no design hours` / `… · 1.5 h Design`. A row with no sheets: `Sheets billed on #3612 · 1.5 h Design added after` (several: `#3612 and #3620`); no billed sheets but uncut ones: `2 still to cut · 1.5 h Design`; otherwise just `1.5 h Design`.

- [ ] **Step 1: Update and add tests** in `test/billing-model.test.mjs`:

Edit the existing tests:

```js
// 'ready job, all cut …' — the detail now ends with the design state:
  assert.equal(detail, '10 sheets · 3 designs, 7 repeats · 3 h 09 m Aspire time · customer supplied · no design hours');

// 'partly cut ready job: sheets opt-in, labor included by default' → rename and rewrite:
test('partly cut job: included by default; Remove switches sheets AND labor off together', () => {
  const sheets = [{ job: 'NL_Corridor_Arches', n: 1, sec: 720, cut: T }, { job: 'NL_Corridor_Arches', n: 2, sec: 1080, cut: null }];
  const labor = [line('ll1', 'design', 1.5, { note: 'Arch drawings' })];
  const w = world({ jobs: { NL_Corridor_Arches: { customer: NL, labor } }, sheets });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'partly'); assert.equal(r.defaultIncluded, true);
  assert.equal(r.uncutCount, 1); assert.deepEqual(r.laborLineIds, ['ll1']);
  const def = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(def.sheets.length, 1); assert.equal(def.jobs[r.jobKey].includeLabor, true); assert.equal(def.jobs[r.jobKey].laborLines.length, 1);
  assert.deepEqual(def.priorLaborHours, { [r.jobKey]: {} });
  const off = BillingModel.pricingInput(c, { [r.jobKey]: { sheets: false } }, ctx);
  assert.equal(off.sheets.length, 0); assert.deepEqual(Object.keys(off.jobs), []);
});

// 'waiting job: …' → replace entirely:
test('no Done step: a job never marked ready is a ready row with its labor billable; waiting is never produced', () => {
  const w = world({ jobs: { NL_Stage_Set: { customer: NL, ready: false, labor: [line('ll1', 'design', 1)] } }, sheets: [{ job: 'NL_Stage_Set', n: 1, sec: 600, cut: T }] });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'ready'); assert.equal(r.defaultIncluded, true); assert.deepEqual(r.laborLineIds, ['ll1']);
  const def = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(def.sheets.length, 1); assert.equal(def.jobs[r.jobKey].includeLabor, true);
  assert.ok(!c.rows.some(x => x.state === 'waiting'));
});

// 'labor-only row after all sheets billed' — add after the existing asserts:
  assert.deepEqual(r.billedOn, [3500]);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3500 · 2 h design added after');   // this file's line() helper sets typeName = typeId

// 'rowDetail: rush, weekend, labor hours, no-time note':
  assert.match(d, /1\.5 h Design/); assert.match(d, /1 sheet has no Aspire time$/);

// 'buildDraft: shape, …':
  assert.deepEqual([fj.labor.ll1, fj.materialKind, fj.pricePerSheet, fj.priorLabor, fj.turnaround], [{ typeId: 'design', hours: 1.5 }, 'ours', 95, {}, 'rush48']);
  assert.ok(!('readyForBilling' in fj));

// 'rowDetail counts only the row own sheets and job labor' — the injected other-job labor must not show;
// the row's own (empty) labor shows as "no design hours":
  assert.ok(!/weekend/.test(d), d); assert.ok(/2 h Design/.test(d) === false); assert.match(d, /· no design hours$/);
```

Add new tests:

```js
/* ---- spec 2026-10-06: prior hours, billedOn, laborText ---- */
test('prior hours: billed lines feed priorLaborHours; 0.5 h after 0.5 h billed prices $0 (labor-only row)', () => {
  const labor = [line('old', 'design', 0.5, { status: 'billed', invoiceNumber: 3500 }), line('new', 'design', 0.5, { note: 'Revisions' })];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }] });
  const r = cust(w.model, NL).rows[0];
  assert.equal(r.state, 'labor-only'); assert.deepEqual(r.laborLineIds, ['new']);
  assert.deepEqual(r.priorLaborHours, { design: 0.5 });
  assert.equal(BillingModel.rowAmount(r, ctx), 0);
  assert.equal(BillingModel.laborAmount(r, ctx), 0);
  assert.equal(r.captured.job.priorLabor.design, 0.5);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3500 · 0.5 h design added after');
  const c = cust(w.model, NL);
  const input = BillingModel.pricingInput(c, {}, ctx);
  assert.deepEqual(input.priorLaborHours, { proj_NL_A: { design: 0.5 } });
  assert.equal(Pricing.priceInvoice(input).total, 0);
});

test('prior hours: an in-progress line on another invoice counts as prior; the unbilled 2 h bills 1.5 h', () => {
  const labor = [line('p', 'design', 0.5, { status: 'in-progress', invoiceNumber: 3601 }), line('n', 'design', 2)];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.priorLaborHours, { design: 0.5 });
  const priced = BillingModel.rowPricing(r, ctx).priced;
  assert.equal(priced.labor[0].billedHours, 1.5);
});

test('billedOn lists each billed invoice once, ascending; a job with uncut sheets and labor only reads "still to cut"', () => {
  const sheets = [{ job: 'NL_A', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3620 }, { job: 'NL_A', n: 2, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3612 },
    { job: 'NL_A', n: 3, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3612 }];
  const w = world({ jobs: { NL_A: { customer: NL, labor: [line('ll1', 'design', 1.5), line('ll2', 'cam', 0.5, { typeName: 'CAM' })] } }, sheets });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.billedOn, [3612, 3620]);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3612 and #3620 · 1.5 h design, 0.5 h CAM added after');
  const uncut = world({ jobs: { NL_B: { customer: NL, labor: [line('ll1', 'design', 1, { typeName: 'Design' })] } }, sheets: [{ job: 'NL_B', n: 1, sec: 600, cut: null }, { job: 'NL_B', n: 2, sec: 600, cut: null }] });
  const rb = cust(uncut.model, NL).rows[0];
  assert.equal(rb.state, 'labor-only'); assert.deepEqual(rb.billedOn, []);
  assert.equal(BillingModel.rowDetail(rb, BillingModel.rowPricing(rb, ctx).priced), '2 still to cut · 1 h Design');
});

test('laborText: entered hours per type in line order; typeName as stored; empty = no design hours', () => {
  assert.equal(BillingModel.laborText([]), 'no design hours');
  assert.equal(BillingModel.laborText(undefined), 'no design hours');
  assert.equal(BillingModel.laborText([{ typeId: 'design', typeName: 'Design', hours: 1 }, { typeId: 'cam', typeName: 'CAM', hours: 0.25 }, { typeId: 'design', typeName: 'Design', hours: 0.5 }]), '1.5 h Design, 0.25 h CAM');
  assert.equal(BillingModel.laborText([{ typeId: 'design', hours: 2 }]), '2 h design', 'typeName missing → the id');
});

test('every row is included by default in every state', () => {
  const w = world({ jobs: { A: { customer: NL }, B: { customer: NL, labor: [line('x', 'design', 1)] }, C: { customer: NL, labor: [line('y', 'design', 1)] } },
    sheets: [{ job: 'A', n: 1, sec: 600, cut: T }, { job: 'B', n: 1, sec: 600, cut: T }, { job: 'B', n: 2, sec: 600, cut: null }, { job: 'C', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }] });
  const c = cust(w.model, NL);
  assert.deepEqual(c.rows.map(r => [r.state, r.defaultIncluded]).sort(), [['labor-only', true], ['partly', true], ['ready', true]]);
  const input = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(Object.keys(input.jobs).length, 3); assert.equal(input.sheets.length, 2);
});
```

Note: in the `line(...)` helper of this file `typeName` defaults to the `typeId` (`'design'`), which is why some expectations read `1.5 h design` and the Example-B style ones (with `typeName: 'Design'`) read `1.5 h Design`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/billing-model.test.mjs`
Expected: the edited and new tests FAIL (`waiting` state, `defaultIncluded false`, `billedOn` undefined, `laborText` not a function, detail wording).

- [ ] **Step 3: Implement** in `js/billing-model.js`.

Labor (replace l.128-131):

```js
      // Labor — every unbilled line goes on the next bill (no Done step, spec 2026-10-06); never gated
      // by the through date (§15.4). Lines already billed / in progress are the once-per-job minimum's `prior`.
      const lines = (jb.laborLines || []).filter(l =>
        ((l && l.status) || 'unbilled') === 'unbilled' && (startMs === null || (Number(l.enteredAt) || 0) >= startMs));
      const priorLabor = P.priorLaborHours(jb.laborLines);
```

State and row (replace l.144-160):

```js
      const state = !hasSheets ? 'labor-only' : (buckets.uncut.length ? 'partly' : 'ready');
      const laborLines = lines.map(l => ({ id: l.id, typeId: l.typeId, typeName: l.typeName || (types[l.typeId] || {}).name || '', hours: l.hours, note: l.note || '' }));
      const sheetInputs = buckets.eligible.map(e => e.sheetInput);
      const row = {
        jobKey: jk, jobName: g.jobName, state, defaultIncluded: true,   // the owner removes, never adds (spec 2026-10-06 §3.1)
        sheetKeys: buckets.eligible.map(e => e.fileKey), laborLineIds: lines.map(l => l.id),
        uncutCount: buckets.uncut.length, laterCount: buckets.later.length, lockedCount: buckets.locked.length,
        zeroTimeCount: sheetInputs.filter(s => !(s.totalTimeSec > 0)).length,
        sheetInputs, priorBilled: [...buckets.billed, ...buckets.beforeStart].map(e => e.prior),
        priorLaborHours: { ...priorLabor },
        billedOn: [...new Set(buckets.billed.map(e => e.invoiceNumber).filter(v => v != null))].sort((a, b) => a - b),
        captured: {
          sheets: Object.fromEntries(buckets.eligible.map(e => [e.fileKey, e.captured])),
          job: { turnaround: nz(jb.turnaround), materialKind: nz(jb.material.kind), materialId: nz(jb.material.materialId), pricePerSheet: nz(jb.material.pricePerSheet),
            priorLabor: { ...priorLabor }, labor: Object.fromEntries(lines.map(l => [l.id, { typeId: nz(l.typeId), hours: nz(l.hours) }])) },
        },
        jobInput: { jobName: g.jobName, turnaround: jb.turnaround, material: jb.material, includeLabor: laborLines.length > 0, laborLines },
        amount: null, error: null,
      };
```

`rowPricing` and `laborAmount` — add `priorLaborHours: { [row.jobKey]: { ...row.priorLaborHours } }` to both `P.priceInvoice({ … })` calls.

`pricingInput` (replace l.204-223):

```js
  // selection = { [jobKey]: { sheets: bool } }; absent -> row.defaultIncluded (always true).
  // The choice switches the whole row — its cut sheets AND its unbilled labor — in every state (spec 2026-10-06 §3.1).
  function pricingInput(customer, selection, ctx) {
    const jobs = {}, sheets = [], priorBilled = [], priorLaborHours = {};
    customer.rows.forEach(r => {
      const sel = selection && selection[r.jobKey];
      const on = sel && typeof sel.sheets === 'boolean' ? sel.sheets : r.defaultIncluded;
      if (!on) return;
      const withSheets = r.sheetKeys.length > 0;
      const withLabor = r.laborLineIds.length > 0;
      if (!withSheets && !withLabor) return;
      jobs[r.jobKey] = { ...r.jobInput, includeLabor: withLabor, laborLines: withLabor ? r.jobInput.laborLines.map(l => ({ ...l })) : [] };
      if (withLabor) priorLaborHours[r.jobKey] = { ...r.priorLaborHours };
      if (withSheets) {
        r.sheetInputs.forEach(s => sheets.push({ ...s }));
        r.priorBilled.forEach(p => priorBilled.push({ ...p }));
      }
    });
    return { priceList: ctx.priceList, laborTypes: ctx.laborTypes, jobs, sheets, priorBilled, priorLaborHours };
  }
```

`laborText` (new, before `rowDetail`) and `rowDetail` (replace l.251-275):

```js
  // "1.5 h Design" / "1.5 h Design, 0.25 h CAM" / "no design hours" — entered hours per type, in line order.
  function laborText(lines) {
    const byType = {}, order = [];
    (lines || []).forEach(l => {
      const k = (l && (l.typeName || l.typeId)) || '';
      if (!(k in byType)) { byType[k] = 0; order.push(k); }
      byType[k] += Number(l && l.hours) || 0;
    });
    return order.length ? order.map(k => `${P.round2(byType[k])} h ${k}`).join(', ') : 'no design hours';
  }

  function rowDetail(row, priced) {
    const parts = [];
    const jp = priced && priced.perJob && priced.perJob[row.jobKey];
    const n = row.sheetKeys.length;
    if (n) {
      parts.push(plural(n, 'sheet', 'sheets'));
      if (jp && jp.repeats > 0) parts.push(`${plural(jp.firsts, 'design', 'designs')}, ${plural(jp.repeats, 'repeat', 'repeats')}`);
    }
    const ta = row.jobInput.turnaround;
    if (n && ta && ta !== 'standard') parts.push(P.TURNAROUND_LABEL[ta] || ta);
    if (priced && n) {
      const wk = row.sheetKeys.filter(k => ((priced.perSheet || {})[k] || {}).weekendPremium > 0).length;
      if (wk) parts.push(`${plural(wk, 'weekend sheet', 'weekend sheets')}`);
    }
    if (n) parts.push(`${P.formatDuration(row.sheetInputs.reduce((a, s) => a + s.totalTimeSec, 0))} Aspire time`);
    if (n) { const m = row.jobInput.material || {}; parts.push(m.kind === 'ours' ? (m.name || 'our material') : 'customer supplied'); }
    // The design state (spec 2026-10-06 §3.1), always last.
    const billedOn = row.billedOn || [];
    if (!n && billedOn.length) parts.push(`Sheets billed on ${billedOn.map(x => '#' + x).join(' and ')}`);
    else if (!n && row.uncutCount) parts.push(`${row.uncutCount} still to cut`);
    const lt = laborText(row.jobInput.laborLines);
    parts.push(!n && billedOn.length && row.laborLineIds.length ? `${lt} added after` : lt);
    let s = parts.join(' · ');
    if (row.zeroTimeCount) s += `${s ? ' · ' : ''}${row.zeroTimeCount === 1 ? '1 sheet has' : row.zeroTimeCount + ' sheets have'} no Aspire time`;
    return s;
  }
```

`buildDraft` fingerprint (l.307): `fpJobs[jk] = { turnaround: c.turnaround, materialKind: c.materialKind, materialId: c.materialId, pricePerSheet: c.pricePerSheet, priorLabor: { ...(c.priorLabor || {}) }, labor };`

Exports: `return { defaultThroughDate, build, pricingInput, rowPricing, rowAmount, laborAmount, summaryText, rowDetail, laborText, buildDraft };`. Update the header comment (no `waiting`, every row included by default, prior hours).

- [ ] **Step 4: Run the tests**

Run: `node --test test/billing-model.test.mjs test/invoice-screen.test.mjs test/billing-done.test.mjs`
Expected: all PASS. (The `integration: draft locks …` test still passes: the draft's `priorLabor` is `{}` and Task 4's check tolerates a fingerprint without the key until then.)

- [ ] **Step 5: Commit**

```bash
git add js/billing-model.js test/billing-model.test.mjs
git commit -m "feat(billing-model): every row included by default, no waiting state, labor billable without Done, prior hours to pricing, billedOn + design state in the detail, laborText()"
```

---

### Task 4: `InvoiceStore.planLock` — prior-hours re-check replaces the readyForBilling re-check

**Files:**
- Modify: `js/invoice-store.js` (l.11-12 requires, l.101-102)
- Test: `test/invoice-store.test.mjs` (fixture l.29, cases l.126 and l.139), `test/invoice-store-exec.test.mjs` (fixture l.29)

**Interfaces:**
- Consumes: `draft.fingerprint.jobs[jk].priorLabor` (Task 3), `Pricing.priorLaborHours` (Task 1).
- Produces: `planLock` throws `changed` when labor lines of job `jk` are on the draft AND the job doc's billed/in-progress hours per type differ from `fingerprint.jobs[jk].priorLabor` (a missing `priorLabor` reads as `{}`). `readyForBilling` is never read.

- [ ] **Step 1: Update the tests** in `test/invoice-store.test.mjs`:

```js
// fixture (l.29): replace `readyForBilling: true` in fingerprint.jobs.proj_a with
      jobs: { proj_a: { turnaround: 'standard', materialKind: 'ours', materialId: 'mat_bb', pricePerSheet: 95, priorLabor: {}, labor: { ll_1: { typeId: 'design', hours: 2 } } } },

// in 'lock: changed on any fingerprint mismatch' replace the `ready:` case with:
    prior: lockDocs({ jobBilling: { proj_a: jobDoc({ laborLines: [l0, { ...l1, status: 'billed', invoiceNumber: 3590, billedAt: 2 }] }) } }),

// replace 'lock: readyForBilling only matters when labor is included' with:
test('lock: prior hours only matter when labor is included; readyForBilling is never read', () => {
  const d = draft({ laborLineRefs: [] }); d.fingerprint.jobs.proj_a.labor = {};
  lock(lockDocs({ jobBilling: { proj_a: jobDoc({ readyForBilling: false, laborLines: [{ ...jobDoc().laborLines[1], status: 'billed', invoiceNumber: 3590 }] }) } }), d);
  const withLabor = draft(); withLabor.fingerprint.jobs.proj_a.priorLabor = { cam: 1 };
  lock(lockDocs({ jobBilling: { proj_a: jobDoc({ readyForBilling: false, laborLines: [jobDoc().laborLines[0], { ...jobDoc().laborLines[1], status: 'in-progress', invoiceNumber: 3590 }] }) } }), withLabor);
  const old = draft(); delete old.fingerprint.jobs.proj_a.priorLabor;
  lock(lockDocs(), old);   // a draft without the key reads as {} — matches a job with no billed lines
});
```

In `test/invoice-store-exec.test.mjs` l.29 make the same fixture edit (`readyForBilling: true` → `priorLabor: {}` inside `fingerprint.jobs.proj_a`).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/invoice-store.test.mjs test/invoice-store-exec.test.mjs`
Expected: `prior` case FAILS (no throw), the `readyForBilling: false` locks FAIL with `changed`.

- [ ] **Step 3: Implement** in `js/invoice-store.js`:

```js
const InvoiceStore = (() => {
  const L = typeof LogRows !== 'undefined' ? LogRows : require('./log-rows.js');
  const P = typeof Pricing !== 'undefined' ? Pricing : require('./pricing.js');
  …
  // Same keys, same hours (number compare; a missing key is 0).
  function samePrior(a, b) {
    const ks = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
    return ks.every(k => (Number((a || {})[k]) || 0) === (Number((b || {})[k]) || 0));
  }
```

and in `planLock` replace l.101-102:

```js
      const ids = refsByJob[jk] || [];
      // The once-per-job minimum was priced against these prior hours; different hours now = a different price.
      if (ids.length && !samePrior(P.priorLaborHours(jd.laborLines), jf.priorLabor || {})) throw changed();
```

Header comment: add "2026-10-06: the lock re-checks the job's prior (billed / in-progress) labor hours instead of readyForBilling".

- [ ] **Step 4: Run the tests**

Run: `node --test test/invoice-store.test.mjs test/invoice-store-exec.test.mjs test/billing-model.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/invoice-store.js test/invoice-store.test.mjs test/invoice-store-exec.test.mjs
git commit -m "feat(invoice-store): lock re-checks prior labor hours instead of readyForBilling"
```

---

### Task 5: `BillingModel.recentJobs()` — the Recent jobs list (pure)

**Files:**
- Modify: `js/billing-model.js` (new function + export)
- Test: `test/billing-model.test.mjs`

**Interfaces:**
- Produces: `BillingModel.recentJobs(input) → line[]`, `input = { finishedSheets, activeSheets, nowMs, days (default 30), sheetBillingOf(fk), jobBillingOf(jk), customerBillingOf(ck), projectCustomerOf(jk), customerKeyOf(name), noteKey(name) }`.
  - One line per job (grouped by `noteKey(jobName || fileName)`, de-duplicated by `fileKey`) whose sheets are ALL finished — no sheet of that job in `activeSheets` — and whose `max(finishedAt)` is `≥ nowMs − days × 86 400 000`; a job with no `finishedAt` is skipped; newest first; a customer with `billedOutsideApp` is skipped.
  - `line = { jobKey, jobName, customerName, finishedAt, finishedText: 'Oct 2', sheetCount, billingText, laborText }` with `customerName = jobBilling.customerName || projectCustomerOf(jobKey) || 'No customer yet'`, `billingText ∈ 'N sheets billed #A, #B' | 'N of M sheets billed' | 'not billed yet'` (external sheets left out of N and M; an all-external job reads `no charge`), `laborText = laborText(jobBilling.laborLines)` (Task 3).
  - No new reads: Billing passes the finished list it already loaded.

- [ ] **Step 1: Write the failing tests** — append to `test/billing-model.test.mjs`:

```js
/* ---- spec 2026-10-06 §3.3: Recent jobs ---- */
const DAY = 86400000;
const NOW = new Date(2026, 9, 6, 9).getTime();   // Tue Oct 6
function recentWorld({ finished, active = [], jobs = {}, sb = {}, customers = {}, projectCustomer = {} }) {
  const noteKey = n => 'proj_' + n;
  const jobDocs = {};
  Object.entries(jobs).forEach(([name, j]) => { jobDocs[noteKey(name)] = { jobName: name, customerKey: 'cust_' + j.customer, customerName: j.customer, laborLines: j.labor || [] }; });
  const fin = finished.map(s => ({ fileKey: s.fk, fileName: `${s.job} Sheet ${s.n}.html`, jobName: s.job, finished: true, finishedAt: s.at }));
  const act = active.map(s => ({ fileKey: s.fk, fileName: `${s.job} Sheet ${s.n}.html`, jobName: s.job }));
  return BillingModel.recentJobs({ finishedSheets: fin, activeSheets: act, nowMs: NOW,
    sheetBillingOf: fk => sb[fk] || null, jobBillingOf: jk => jobDocs[jk] || null, customerBillingOf: ck => customers[ck] || null,
    projectCustomerOf: jk => projectCustomer[jk] || null, customerKeyOf: n => 'cust_' + n, noteKey });
}

test('recentJobs: 30-day window on max(finishedAt), newest first, all sheets finished', () => {
  const list = recentWorld({
    finished: [
      { fk: 'a1', job: 'NL_A', n: 1, at: NOW - 2 * DAY }, { fk: 'a2', job: 'NL_A', n: 2, at: NOW - 4 * DAY },
      { fk: 'b1', job: 'NL_B', n: 1, at: NOW - 1 * DAY },
      { fk: 'c1', job: 'NL_Old', n: 1, at: NOW - 31 * DAY },
      { fk: 'd1', job: 'NL_Edge', n: 1, at: NOW - 30 * DAY },
      { fk: 'e1', job: 'NL_Part', n: 1, at: NOW - 1 * DAY },
      { fk: 'f1', job: 'NL_NoDate', n: 1, at: undefined },
    ],
    active: [{ fk: 'e2', job: 'NL_Part', n: 2 }],
    jobs: { NL_A: { customer: NL }, NL_B: { customer: NL }, NL_Old: { customer: NL }, NL_Edge: { customer: NL }, NL_Part: { customer: NL }, NL_NoDate: { customer: NL } },
  });
  assert.deepEqual(list.map(j => j.jobName), ['NL_B', 'NL_A', 'NL_Edge']);
  const a = list.find(j => j.jobName === 'NL_A');
  assert.equal(a.finishedAt, NOW - 2 * DAY); assert.equal(a.finishedText, 'Oct 4'); assert.equal(a.sheetCount, 2);
  assert.equal(a.customerName, NL); assert.equal(a.jobKey, 'proj_NL_A');
});

test('recentJobs: billing and labor wording', () => {
  const sb = { a1: { status: 'billed', invoiceNumber: 3612 }, a2: { status: 'billed', invoiceNumber: 3612 },
    b1: { status: 'billed', invoiceNumber: 3612 }, b2: { status: 'billed', invoiceNumber: 3620 }, b3: { status: 'external' },
    c1: { status: 'billed', invoiceNumber: 3612 }, d1: { status: 'external' } };
  const at = NOW - DAY;
  const list = recentWorld({
    finished: [
      { fk: 'a1', job: 'NL_All', n: 1, at }, { fk: 'a2', job: 'NL_All', n: 2, at },
      { fk: 'b1', job: 'NL_Two', n: 1, at }, { fk: 'b2', job: 'NL_Two', n: 2, at }, { fk: 'b3', job: 'NL_Two', n: 3, at },
      { fk: 'c1', job: 'NL_Some', n: 1, at }, { fk: 'c2', job: 'NL_Some', n: 2, at }, { fk: 'c3', job: 'NL_Some', n: 3, at },
      { fk: 'd1', job: 'NL_NC', n: 1, at }, { fk: 'n1', job: 'NL_None', n: 1, at },
    ],
    jobs: { NL_All: { customer: NL, labor: [line('x', 'design', 1.5, { typeName: 'Design' })] }, NL_Two: { customer: NL }, NL_Some: { customer: NL }, NL_NC: { customer: NL }, NL_None: { customer: NL } },
    sb,
  });
  const by = Object.fromEntries(list.map(j => [j.jobName, j]));
  assert.equal(by.NL_All.billingText, '2 sheets billed #3612'); assert.equal(by.NL_All.laborText, '1.5 h Design');
  assert.equal(by.NL_Two.billingText, '2 sheets billed #3612, #3620', 'external sheet left out; numbers ascending');
  assert.equal(by.NL_Some.billingText, '1 of 3 sheets billed');
  assert.equal(by.NL_NC.billingText, 'no charge');
  assert.equal(by.NL_None.billingText, 'not billed yet'); assert.equal(by.NL_None.laborText, 'no design hours');
});

test('recentJobs: outside-app customers skipped; no job details → projectCustomer name, else "No customer yet"', () => {
  const at = NOW - DAY;
  const list = recentWorld({
    finished: [{ fk: 'r1', job: 'RV_Job', n: 1, at }, { fk: 'p1', job: 'PC_Job', n: 1, at }, { fk: 'q1', job: 'Mystery', n: 1, at }],
    jobs: { RV_Job: { customer: 'Ridgeway Vans' } },
    customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true } },
    projectCustomer: { proj_PC_Job: 'Copperline Stage' },
  });
  assert.deepEqual(list.map(j => [j.jobName, j.customerName]).sort(), [['Mystery', 'No customer yet'], ['PC_Job', 'Copperline Stage']]);
  const outsideByProject = recentWorld({ finished: [{ fk: 'p1', job: 'PC_Job', n: 1, at }], projectCustomer: { proj_PC_Job: 'Ridgeway Vans' }, customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true } } });
  assert.equal(outsideByProject.length, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/billing-model.test.mjs`
Expected: FAIL — `BillingModel.recentJobs is not a function`.

- [ ] **Step 3: Implement** — add to `js/billing-model.js` (after `rowDetail`) and export `recentJobs`:

```js
  const monthDayMs = ms => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

  // Recent jobs (spec 2026-10-06 §3.3): one line per job whose sheets are ALL finished (none on the board)
  // and whose latest finishedAt is within `days` of nowMs; newest first; customers billed outside this
  // app left out. Built from the finished list Billing already holds — no new reads.
  function recentJobs(input) {
    const { sheetBillingOf, jobBillingOf, customerBillingOf, projectCustomerOf, customerKeyOf, noteKey } = input;
    const cutoff = input.nowMs - (input.days || 30) * 86400000;
    const onBoard = new Set((input.activeSheets || []).map(s => noteKey(s.jobName || s.fileName)));
    const groups = new Map();
    const seen = new Set();
    (input.finishedSheets || []).forEach(s => {
      if (!s || seen.has(s.fileKey)) return;
      seen.add(s.fileKey);
      const name = s.jobName || s.fileName;
      const jk = noteKey(name);
      if (!groups.has(jk)) groups.set(jk, { jobKey: jk, jobName: name, sheets: [] });
      groups.get(jk).sheets.push(s);
    });
    const out = [];
    groups.forEach(g => {
      if (onBoard.has(g.jobKey)) return;
      const finishedAt = g.sheets.reduce((m, s) => Math.max(m, Number(s.finishedAt) || 0), 0);
      if (!finishedAt || finishedAt < cutoff) return;
      const jb = jobBillingOf(g.jobKey) || null;
      const custName = (jb && jb.customerName) || projectCustomerOf(g.jobKey) || null;
      const ck = (jb && jb.customerKey) || (custName && customerKeyOf(custName)) || null;
      if (ck && (customerBillingOf(ck) || {}).billedOutsideApp) return;
      let billed = 0, counted = 0;
      const nums = [];
      g.sheets.forEach(s => {
        const sb = sheetBillingOf(s.fileKey) || null;
        const st = (sb && sb.status) || 'unbilled';
        if (st === 'external') return;
        counted++;
        if (st === 'billed') { billed++; if (sb.invoiceNumber != null && !nums.includes(sb.invoiceNumber)) nums.push(sb.invoiceNumber); }
      });
      nums.sort((a, b) => a - b);
      let billingText;
      if (!counted) billingText = 'no charge';
      else if (billed === counted) billingText = `${plural(counted, 'sheet', 'sheets')} billed ${nums.map(n => '#' + n).join(', ')}`;
      else if (billed > 0) billingText = `${billed} of ${counted} sheets billed`;
      else billingText = 'not billed yet';
      out.push({ jobKey: g.jobKey, jobName: g.jobName, customerName: custName || 'No customer yet', finishedAt, finishedText: monthDayMs(finishedAt),
        sheetCount: g.sheets.length, billingText, laborText: laborText(jb && jb.laborLines) });
    });
    out.sort((a, b) => b.finishedAt - a.finishedAt);
    return out;
  }
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/billing-model.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/billing-model.js test/billing-model.test.mjs
git commit -m "feat(billing-model): recentJobs() — finished in the last 30 days, billing and design-hours wording (spec §3.3)"
```

---

### Task 6: Job card — no Done step; billing-status chip; line status words

**Files:**
- Modify: `js/job-card.js` (l.17-38 pure functions, l.59-73 state/chip, l.144 listener binding, l.200-239 labor block, l.263 `needsJb`, l.310-316 handlers, l.330-342 `onChange`, l.344 exports)
- Modify: `js/job-details.js` (comment l.34-36 only)
- Test: `test/job-card.test.mjs`

**Interfaces:**
- Produces:
  - `JobCard.billingState(jobSheets) → { key: 'not-billed' | 'partly-billed' | 'billed', text }` — pure over `OwnerStore.getSheetBilling`; external sheets left out; texts `Not billed yet` · `2 of 3 sheets billed` · `Billed · #3612` (several: `Billed · #3612 and #3620`); all-external → `{ key: 'not-billed', text: 'No charge' }`.
  - `JobCard.jobState(jobName, jobSheets) → { key: 'needs', text: 'Needs job details' } | billingState(jobSheets)` — *Needs job details* wins.
  - `JobCard.cardChip(jobName, jobSheets)` (**signature change**: app.js passes `projectSheets`, Task 7). Chip classes: `needs → jc-chip--needs`, `billed → jc-chip--ready`, the rest `jc-chip--muted`.
  - `JobCard.lineStatusText(line) → 'Goes on the next bill' | 'On invoice 3612 (in progress)' | 'Billed · #3612'`.
  - `applyLineAdd(cur, line)` never refuses. `applyDone`, `applyNotReady` are **deleted** (not exported).
  - Removed from the panel: the *No design time on this job* checkbox (and the `change` listener), *Done — ready for billing*, *Edit — not ready yet*, "Marked ready by …", the caption "Cut sheets can still go on a weekly bill before this. Design hours wait for this button." The hours form shows whenever labor types exist. Caption under the form: `Hours go on the next bill once you add them. The minimum is charged once per job, even if the hours go out on two bills.` + ` Minimums: Design 1 h, CAM 0.5 h.` (when any type has one) + ` Rush applies to these hours too.` (rush jobs).

- [ ] **Step 1: Update and add tests** in `test/job-card.test.mjs`:

```js
// replace the applyLineAdd test:
test('applyLineAdd: appends; never refuses (no Done step since 2026-10-06)', () => {
  const cur = { laborLines: [line('a')], readyForBilling: true };
  const next = JobCard.applyLineAdd(cur, line('b'));
  assert.deepEqual(next.laborLines.map(l => l.id), ['a', 'b']);
  assert.equal(cur.laborLines.length, 1, 'input not mutated');
  assert.deepEqual(JobCard.applyLineAdd({}, line('z')).laborLines.map(l => l.id), ['z']);
});

// delete the 'applyDone: …' and 'applyNotReady: …' tests; add:
test('Done / Not ready are gone', () => {
  assert.equal(JobCard.applyDone, undefined);
  assert.equal(JobCard.applyNotReady, undefined);
});

test('billingState: not billed / partly / billed (numbers joined with "and"); external sheets left out; all external = No charge', () => {
  const sheets = [{ fileKey: 'a' }, { fileKey: 'b' }, { fileKey: 'c' }];
  assert.deepEqual(JobCard.billingState(sheets), { key: 'not-billed', text: 'Not billed yet' });
  sheetBilling.a = { status: 'billed', invoiceNumber: 3612 };
  assert.deepEqual(JobCard.billingState(sheets), { key: 'partly-billed', text: '1 of 3 sheets billed' });
  sheetBilling.b = { status: 'billed', invoiceNumber: 3620 }; sheetBilling.c = { status: 'external' };
  assert.deepEqual(JobCard.billingState(sheets), { key: 'billed', text: 'Billed · #3612 and #3620' });
  sheetBilling.b = { status: 'in-progress', invoiceNumber: 3620 };
  assert.deepEqual(JobCard.billingState(sheets), { key: 'partly-billed', text: '1 of 2 sheets billed' });
  sheetBilling.a = { status: 'external' }; sheetBilling.b = { status: 'external' };
  assert.deepEqual(JobCard.billingState(sheets), { key: 'not-billed', text: 'No charge' });
  assert.deepEqual(JobCard.billingState([]), { key: 'not-billed', text: 'Not billed yet' });
});

test('jobState: Needs job details wins over the billing status', () => {
  globalThis.OwnerStore.hasJobDetails = () => false;
  JobCard.init({ noteKey: n => 'proj_' + n });
  assert.deepEqual(JobCard.jobState('J', [{ fileKey: 'a' }]), { key: 'needs', text: 'Needs job details' });
  globalThis.OwnerStore.hasJobDetails = () => true;
  sheetBilling.a = { status: 'billed', invoiceNumber: 7 };
  assert.deepEqual(JobCard.jobState('J', [{ fileKey: 'a' }]), { key: 'billed', text: 'Billed · #7' });
  delete globalThis.OwnerStore.hasJobDetails;
});

test('lineStatusText: next bill / in progress / billed', () => {
  assert.equal(JobCard.lineStatusText(line('a')), 'Goes on the next bill');
  assert.equal(JobCard.lineStatusText({ id: 'b', typeId: 'design', hours: 1 }), 'Goes on the next bill');
  assert.equal(JobCard.lineStatusText(line('c', 'in-progress', { invoiceNumber: 3612 })), 'On invoice 3612 (in progress)');
  assert.equal(JobCard.lineStatusText(line('d', 'billed', { invoiceNumber: 3612 })), 'Billed · #3612');
});
```

(The `applyDetails` test keeps asserting `next.readyForBilling === true` — `applyDetails` spreads `...cur`, so stale fields pass through untouched; that is the documented behaviour, not a write.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/job-card.test.mjs`
Expected: FAIL — `applyLineAdd` refuses, `applyDone` defined, `billingState` / `lineStatusText` not functions.

- [ ] **Step 3: Implement** in `js/job-card.js`.

Pure functions (replace l.17-38):

```js
  const refuse = msg => Object.assign(new Error(msg), { ownerRefusal: true });
  const lineStatus = l => (l && l.status) || 'unbilled';
  // Hours go on the next bill as soon as they are entered (spec 2026-10-06 §4) — nothing to refuse.
  function applyLineAdd(cur, line) {
    return { ...cur, laborLines: [...(cur.laborLines || []), line] };
  }
  function applyLineRemove(cur, lineId) { … unchanged … }
  // Each design/CAM line's status in plain words.
  function lineStatusText(l) {
    const st = lineStatus(l);
    if (st === 'billed') return `Billed · #${l.invoiceNumber}`;
    if (st === 'in-progress') return `On invoice ${l.invoiceNumber} (in progress)`;
    return 'Goes on the next bill';
  }
```

Job-level state (replace l.59-73):

```js
  /* ── Job-level state: Needs job details wins; otherwise the job's billing status (spec 2026-10-06 §4) ── */
  // Pure over the job's sheets; No-charge (external) sheets are left out of the count.
  function billingState(jobSheets) {
    const nums = [];
    let billed = 0, counted = 0;
    (jobSheets || []).forEach(s => {
      const sb = OwnerStore.getSheetBilling(s.fileKey);
      const st = (sb && sb.status) || 'unbilled';
      if (st === 'external') return;
      counted++;
      if (st === 'billed') { billed++; if (sb.invoiceNumber != null && !nums.includes(sb.invoiceNumber)) nums.push(sb.invoiceNumber); }
    });
    if (!counted && (jobSheets || []).length) return { key: 'not-billed', text: 'No charge' };
    if (counted && billed === counted) return { key: 'billed', text: `Billed · ${nums.sort((a, b) => a - b).map(n => '#' + n).join(' and ')}` };
    if (billed > 0) return { key: 'partly-billed', text: `${billed} of ${counted} sheets billed` };
    return { key: 'not-billed', text: 'Not billed yet' };
  }
  function jobState(jobName, jobSheets) {
    if (!OwnerStore.hasJobDetails(hooks.noteKey(jobName))) return { key: 'needs', text: 'Needs job details' };
    return billingState(jobSheets);
  }
  function chip(state) {
    const span = document.createElement('span');
    span.className = 'jc-chip ' + ({ needs: 'jc-chip--needs', billed: 'jc-chip--ready' }[state.key] || 'jc-chip--muted');
    span.textContent = state.text;
    return span;
  }
  function cardChip(jobName, jobSheets) { return chip(jobState(jobName, jobSheets)); }
```

`renderOwnerPanel`: l.144 → `if (!container.dataset.jcBound) { container.addEventListener('click', onClick); container.dataset.jcBound = '1'; }` (no `change` listener); l.169 → `${chip(jobState(jobName, orderedSheets)).outerHTML}`. Replace the labor block (l.200-239, from `if (hasDetails) {` to its closing `html += '</div>';`) with:

```js
    if (hasDetails) {
      const types = OwnerStore.laborTypes();
      const lines = Array.isArray(jb.laborLines) ? jb.laborLines : [];
      const rateOf = id => types.find(t => t.id === id);
      html += `<div class="jc-labor"><div class="jc-labor-title">Design / CAM hours</div>`;
      if (lines.length) {
        html += `<table class="jc-table"><thead><tr><th>Type</th><th>Hours</th><th>What it was for (prints on the invoice)</th><th>Entered</th><th>Status</th></tr></thead><tbody>` +
          lines.map(l => {
            const t = rateOf(l.typeId);
            const typeCell = (l.typeName || (t && t.name) || l.typeId) + (t ? (t.rate != null ? ` — $${Number(t.rate).toFixed(0)}/hr` : '') : " (type removed — Billing can't price this line)");
            const remove = lineStatus(l) === 'unbilled' ? ` <button type="button" class="jc-link" data-action="line-remove" data-line="${e(l.id)}"${noWrite}>Remove</button>` : '';
            return `<tr><td>${e(typeCell)}</td><td>${e(l.hours)}</td><td>${e(l.note || '')}</td><td class="jc-caption">${e(l.enteredBy ? l.enteredBy.split('@')[0] : '')}${l.enteredAt ? ' · ' + e(formatDT(new Date(l.enteredAt))) : ''}</td>
            <td><span class="jc-caption">${e(lineStatusText(l))}</span>${remove}</td></tr>`;
          }).join('') +
          '</tbody></table>';
      }
      if (!types.length) {
        html += `<div class="jc-caption">No Design/CAM types yet — add them in Settings › Labor types.</div>`;
      } else {
        const mins = types.filter(t => t.minHours).map(t => `${t.name} ${t.minHours} h`).join(', ');
        html += `<div class="jc-labor-add">
          <select class="form-input" data-line-type${noWrite}>${types.map(t => `<option value="${e(t.id)}">${e(t.name)} — $${Number(t.rate).toFixed(0)}/hr${t.minHours ? ` (min ${t.minHours} h per job)` : ''}</option>`).join('')}</select>
          <input type="number" class="form-input jc-hours" data-line-hours min="0" step="0.25" placeholder="Hours"${noWrite}>
          <input type="text" class="form-input jc-note" data-line-note placeholder="What it was for (prints on the invoice)"${noWrite}>
          <button type="button" class="btn btn-outline btn-sm" data-action="line-add"${noWrite}>Add line</button>
        </div>`;
        html += `<div class="jc-caption">Hours go on the next bill once you add them. The minimum is charged once per job, even if the hours go out on two bills.${mins ? ` Minimums: ${e(mins)}.` : ''}${jb.turnaround !== 'standard' ? ' Rush applies to these hours too.' : ''}</div>`;
      }
      if (jb.updatedBy || jb.updatedAt) html += `<div class="jc-caption">Saved by ${e((jb.updatedBy || '').split('@')[0] || 'owner')}${jb.updatedAt ? ' · ' + e(formatDT(new Date(jb.updatedAt))) : ''}</div>`;
      html += '</div>';
    } else {
```

`onClick`: l.263 → `const needsJb = ['edit', 'line-add', 'line-remove'].includes(action);`; delete the `'done'` and `'notready'` branches (l.310-316). Delete `onChange` entirely (l.330-342). Exports:

```js
  return { applyLineAdd, applyLineRemove, lineStatusText, billingState, jobState, init, setSheetsProvider, cardChip, sheetStatus, sheetTags, navRowExtras, renderOwnerPanel, validYmd };
```

Header comment: drop "Done — ready for billing"; say the chip is the billing status.

`js/job-details.js` l.34-36 comment → `// form's fields — laborLines (and any stale fields on the doc) stay exactly as the server has` / `// them, so an edit can never wipe hours. …`.

- [ ] **Step 4: Run the tests + grep**

Run: `node --test test/job-card.test.mjs test/job-details-thickness.test.mjs && grep -n "readyForBilling\|noDesignTime\|applyDone\|notready\|nodesign" js/job-card.js`
Expected: tests PASS; the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add js/job-card.js js/job-details.js test/job-card.test.mjs
git commit -m "feat(job-card): no Done step — hours go on the next bill as entered; billing-status chip; per-line status words"
```

---

### Task 7: Billing screen rows, job-name links, Recent jobs, Back-to-Billing hooks

**Files:**
- Modify: `js/billing.js` (`init` l.57-76, `show` l.116-128, `render` l.164-193, `rowHtml` l.304-324, new `recentJobsHtml`)
- Modify: `js/app.js` (hooks only: l.32-36 state, l.151-155 Back handler, l.392-398 `showProjectsScreen`, l.860 `cardChip`, l.2505-2515 `openJobFromBilling`)
- Modify: `index.html` (l.249-250), `css/style.css` (l.1959-1966 + new rules)

**Interfaces:**
- Consumes: `BillingModel.recentJobs`, `laborText`, row `state` / `billedOn` (Tasks 3, 5); `JobCard.cardChip(jobName, jobSheets)` (Task 6).
- Produces:
  - `BillingScreen.show({ resume: true })` — returns to the screen keeping the through date and the selections; re-renders without reloading when the finished list is already loaded (`loadState === 'ok'`), otherwise loads as a fresh visit. `show()` with no options is unchanged.
  - Row markup: the job name is `<button class="billing-job-link" data-act="open-job" data-job="…">` (the existing `open-job` handler opens it with the finished list); state labels `Ready` · `2 cut sheets, 4 still to cut` · `Design hours only`; toggle `Remove` / `Add back`; `.billing-row--<state>` classes (`waiting` never rendered).
  - `#billing-recent-jobs` (between the customer cards and Recent invoices): a `settings-card` titled **Recent jobs** with the hint `Finished in the last 30 days. Click one to add design or CAM hours.` and one `.billing-recent-job` per line: the job-name link, then `Northlight Studios · finished Oct 2 · 6 sheets billed #3612 · 1.5 h Design`. Hidden (empty) when there are none.
  - app.js: `let cardReturn = null;` (`'billing'` while the open card came from Billing). `openJobFromBilling` sets it and the Back button's label to `← Billing`; the Back handler returns to `BillingScreen.show({ resume: true })` when set; `showProjectsScreen()` always clears it and resets the label to `← Projects` (covers Put back, the sheets listener and every other route to Projects — Review Focus 5). `renderProjects` passes `projectSheets` to `JobCard.cardChip`.

No node test covers these DOM files (as in Phase 2); Task 9's Playwright pass is their test. Build them in this order so each can be eyeballed in a PASTE copy.

- [ ] **Step 1: index.html + CSS**

`index.html` l.249-250:

```html
      <div id="billing-customers"></div>
      <div id="billing-recent-jobs"></div>
      <div id="billing-recent"></div>
```

`css/style.css`: change l.1966 to `.billing-row--partly .billing-row-state { color: var(--gold); }` and add after the `.billing-row` rules:

```css
.billing-job-link { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; color: var(--cyan); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-align: left; }
.billing-job-link:hover { color: var(--cyan-dark, var(--cyan)); }
.billing-recent-jobs-card { margin-top: 16px; }
.billing-recent-job { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 6px 0; border-top: 1px solid var(--gray-200); font-size: 0.9rem; }
.billing-recent-job-text { color: var(--gray-500); font-size: 0.85rem; }
```

- [ ] **Step 2: billing.js**

`init`: add `recentJobs: byId('billing-recent-jobs')` to `els`.

`show` (replace l.116-128):

```js
  // `o.status` (optional): a line to show on arrival, e.g. after the Invoice screen cancels an invoice.
  // `o.resume`: coming back from a job card opened here — keep the date and the choices, no reload
  // when the finished list is already in hand (the owner caches already carry any new hours).
  function show(o) {
    opts.hideOthers();
    els.screen.hidden = false;
    if (o && o.resume && loadState === 'ok') { boardKeys = activeKeys(); render(); return; }
    selection = {};
    setStatus('');
    const inv = OwnerStore.invoicing();
    try { through = BillingModel.defaultThroughDate(localYmd(new Date()), inv.weekEndingDay); }
    catch (e) { through = null; setStatus(`Week-ending day in Settings › Invoicing isn't valid (${e.message}); showing everything to date.`, true); }
    els.date.value = through || '';
    if (o && o.status) setStatus(o.status);
    boardKeys = activeKeys();
    loadFinished();
  }
```

`render`: in the `loading` branch also `els.recentJobs.innerHTML = '';`; in the `error` branch too; after the customer cards:

```js
    els.recentJobs.innerHTML = recentJobsHtml(BillingModel.recentJobs({
      finishedSheets: finished || [], activeSheets: opts.activeSheets() || [], nowMs: Date.now(),
      sheetBillingOf: k => OwnerStore.getSheetBilling(k), jobBillingOf: k => OwnerStore.getJobBilling(k),
      customerBillingOf: k => OwnerStore.getCustomerBilling(k), projectCustomerOf: jk => Storage.getProjectCustomer(jk),
      customerKeyOf: opts.customerKey, noteKey: opts.noteKey,
    }));
```

New:

```js
  // Recent jobs (spec 2026-10-06 §3.3): every line's job name opens its card; Back comes back here.
  function recentJobsHtml(list) {
    if (!list.length) return '';
    const rows = list.map(j => `<div class="billing-recent-job">
        <button type="button" class="billing-job-link" data-act="open-job" data-job="${esc(j.jobName)}">${esc(j.jobName)}</button>
        <span class="billing-recent-job-text">${esc(`${j.customerName} · finished ${j.finishedText} · ${j.billingText} · ${j.laborText}`)}</span>
      </div>`).join('');
    return `<section class="settings-card billing-recent-jobs-card"><h2 class="settings-card-title">Recent jobs</h2>
      <p class="settings-card-hint">Finished in the last 30 days. Click one to add design or CAM hours.</p>${rows}</section>`;
  }
```

`rowHtml` (replace l.309-313 and the `<strong>` on l.318):

```js
    let state;
    if (row.state === 'ready') state = 'Ready';
    else if (row.state === 'labor-only') state = 'Design hours only';
    else state = `${plural(n, 'cut sheet', 'cut sheets')}, ${row.uncutCount} still to cut`;
    const label = on ? 'Remove' : 'Add back';
    …
        <div><button type="button" class="billing-job-link" data-act="open-job" data-job="${esc(row.jobName)}">${esc(row.jobName)}</button> <span class="billing-row-state">${esc(state)}${esc(later)}</span></div>
```

Header comment: "one card per customer with ready / partly cut / design-hours-only rows, every row included by default; job names open the job card; Recent jobs".

- [ ] **Step 3: app.js hooks**

```js
let viewingFinished = false;  // the open job came from the finished list
let cardReturn      = null;   // 'billing' while the open job card was reached from Billing (Back returns there)
```

Back handler (l.151-155):

```js
document.getElementById('back-to-projects-btn').addEventListener('click', () => {
  viewingFinished = false;
  currentProject = null;
  if (cardReturn === 'billing') { cardReturn = null; setCardBackLabel(); BillingScreen.show({ resume: true }); return; }
  showProjectsScreen();
});
```

`showProjectsScreen` (l.392): first lines `cardReturn = null; setCardBackLabel();` then as today. Add next to it:

```js
// The job card's Back button says where it goes (Projects, or Billing when the card was opened there).
function setCardBackLabel() {
  document.getElementById('back-to-projects-btn').textContent = cardReturn === 'billing' ? '← Billing' : '← Projects';
}
```

`renderProjects` l.860: `if (Features.on('jobCard')) hdrText.appendChild(JobCard.cardChip(jobName, projectSheets));` (`projectSheets` is the card's sheet list already in scope there — check the variable name in that function and use it).

`openJobFromBilling` (replace l.505-515 comment + body):

```js
// Billing opens a job on the same job card Collin uses: the active board when the job is on it,
// otherwise the owner's finished view (list handed over by Billing). Back returns to Billing.
function openJobFromBilling(jobName, finishedList) {
  if (sheets.some(s => (s.jobName || s.fileName) === jobName)) {
    currentProject = jobName; viewingFinished = false;
  } else {
    finishedSheets = finishedList || []; viewingFinished = true; currentProject = jobName;
  }
  cardReturn = 'billing'; setCardBackLabel();
  hideAllScreens();
  showContentScreen();
}
```

- [ ] **Step 4: Run everything that exists**

Run: `npm test && node tools/browser-check-phase1.mjs`
Expected: node tests PASS; phase 1 `SUITE: PASS` (Collin unchanged). `node tools/browser-check-phase2.mjs` is EXPECTED TO FAIL at this point (it still clicks Done) — Task 9 rewrites it.

- [ ] **Step 5: PASTE manual check** (optional but recommended; the controller does this with the browser pane): copy the worktree to a temp dir, blank both configs, serve with an in-process `node:http` server (or `python -m http.server` from the TEMP COPY — never the real tree), open the page, run the CLAUDE.md step-6 owner stub in the console, upload the sample + a `Sheet 10` copy, give it a customer, mark both complete, open Billing: one row `Ready` with `Remove`, detail ends `· no design hours`; click the job name → card with `← Billing`, add 1.5 h Design → "Goes on the next bill" → Back → Billing again, detail ends `· 1.5 h Design`.

- [ ] **Step 6: Commit**

```bash
git add js/billing.js js/app.js index.html css/style.css
git commit -m "feat(billing): every row in by default with Remove / Add back, job names open the card, Recent jobs block, Back returns to Billing"
```

---

### Task 8: Cache-busting bumps (own commit)

**Files:** `index.html` (script and stylesheet tags l.9, 723, 725, 727-730, 748)

- [ ] **Step 1: Bump exactly the changed files**

| tag | from | to |
|---|---|---|
| `css/style.css` | `?v=25` | `?v=26` |
| `js/job-card.js` | `?v=2` | `?v=3` |
| `js/pricing.js` | `?v=2` | `?v=3` |
| `js/invoice-lines.js` | `?v=1` | `?v=2` |
| `js/billing-model.js` | `?v=1` | `?v=2` |
| `js/invoice-store.js` | `?v=1` | `?v=2` |
| `js/billing.js` | `?v=1` | `?v=2` |
| `js/app.js` | `?v=36` | `?v=37` |

- [ ] **Step 2: Verify**

Run: `git diff --stat && grep -nE 'style.css\?v=|job-card.js\?v=|pricing.js\?v=|invoice-lines.js\?v=|billing-model.js\?v=|invoice-store.js\?v=|billing.js\?v=|app.js\?v=' index.html`
Expected: only `index.html` changed; the eight new numbers as in the table; every other `?v=` untouched. Then `git diff master --name-only -- js css | sort` must equal the list of bumped scripts plus `js/job-details.js` (comment only, not bumped).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: bump cache-busting versions for the billing auto-include change"
```

---

### Task 9: Playwright pass — the §7 flow replaces the Done step (PASTE mode)

**Files:**
- Modify: `tools/browser-check-phase2.mjs`

**Interfaces:** consumes the real page. The harness (temp copy, both configs blanked, in-process server, `SUITE: PASS|FAIL`) is unchanged.

- [ ] **Step 1: Replace `cutAndFinish` with `cutAll` + add `addHours`**

```js
  // On the open job card: each sheet Mark In Progress -> Mark Complete (modal) through the UI. No Done step (2026-10-06).
  const cutAll = async (page, sheetCount) => {
    for (let i = 0; i < sheetCount; i++) {
      await page.locator('.sheet-nav-row').first().click();   // completed sheets move below the active ones
      await page.click('.sheet-complete-footer button:has-text("Mark In Progress")');
      await page.click('.sheet-complete-footer button:has-text("Mark Complete")');
      await page.waitForSelector('#modal-overlay:not(.hidden)');
      await page.click('#modal-confirm');
      await page.waitForSelector('#modal-overlay', { state: 'hidden' });
      await page.waitForTimeout(150);
    }
  };
  // On the open job card: add a Design/CAM line through the owner panel's form (type picked by its name).
  const addHours = async (page, typeName, hours, note) => {
    const id = await page.$eval('#owner-panel [data-line-type]', (s, name) => [...s.options].find(o => o.textContent.startsWith(name)).value, typeName);
    await page.selectOption('#owner-panel [data-line-type]', id);
    await page.fill('#owner-panel [data-line-hours]', hours);
    await page.fill('#owner-panel [data-line-note]', note);
    await page.click('#owner-panel [data-action="line-add"]');
    await page.waitForFunction(h => new RegExp(h.replace('.', '\\.') + ' h added\\.').test(document.getElementById('owner-panel').textContent), hours);
  };
```

Every `cutAndFinish(page, n)` call (steps 3, 9, 10) becomes `cutAll(page, n)`.

- [ ] **Step 2: Rewrite step 3** (between `await openCard(page, 1195);` and `// ── 3b.`):

```js
  await openCard(page, 1195);
  await cutAll(page, 2);
  assert(await page.evaluate(() => sheets.filter(s => (Storage.get(s.fileKey, 'sheet') || {}).status === 'complete').length === 2), '3 both sheets went In Progress → Complete through the UI');
  const panel = await page.textContent('#owner-panel');
  assert(/Not billed yet/.test(panel) && !/Done — ready for billing|No design time|not ready yet/.test(panel) && !(await page.$('#owner-panel input[data-action="nodesign"]')), '3 job card: chip "Not billed yet"; no Done button, no No-design-time box');
  await openBilling(page);
  const cards = await page.$$('.billing-card');
  assert(cards.length === 1, '3 Billing: one customer card (got ' + cards.length + ')');
  const rowEls = await page.$$('.billing-row');
  assert(rowEls.length === 1 && await rowEls[0].evaluate(e => e.classList.contains('billing-row--ready') && !e.classList.contains('is-off')), '3 Billing: one ready row, included without a Done step');
  assert((await page.textContent('.billing-row button[data-act="toggle"]')).trim() === 'Remove', '3 the row toggle reads "Remove"');
  assert(/· no design hours$/.test((await page.textContent('.billing-row-detail')).trim()), '3 detail ends "no design hours"');
  await page.click('.billing-row button[data-act="toggle"]');
  assert(await page.$eval('.billing-row', e => e.classList.contains('is-off')) && (await page.textContent('.billing-row button[data-act="toggle"]')).trim() === 'Add back' && !(await page.$('button[data-act="bill"]')), '3 Remove: row dims, toggle reads "Add back", no Bill button');
  await page.click('.billing-row button[data-act="toggle"]');
  assert(!(await page.$eval('.billing-row', e => e.classList.contains('is-off'))), '3 Add back: row is back on');
  // job-name link → card → hours → Back lands on Billing
  await page.click('.billing-row button[data-act="open-job"]');
  await page.waitForSelector('#content-screen:not([hidden])');
  await page.waitForSelector('#owner-panel:not([hidden])');
  assert(/Order_1195/.test(await page.textContent('#header-job-name')) && /Billing/.test(await page.textContent('#back-to-projects-btn')), '3 the job-name link opens the card; Back reads "← Billing"');
  await addHours(page, 'Design', '1.5', 'Layout');
  assert(/Goes on the next bill/.test(await page.textContent('#owner-panel')), '3 the new line says "Goes on the next bill"');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#billing-screen:not([hidden])');
  assert(/· 1\.5 h Design$/.test((await page.textContent('.billing-row-detail')).trim()), '3 Back landed on Billing; the row detail ends "1.5 h Design"');
  await openCard(page, 1195);
  assert(/Projects/.test(await page.textContent('#back-to-projects-btn')), '3 opened from Projects: Back reads "← Projects" again');
  await openBilling(page);
  const X = await priceOf(page, 'Northlight Studios');
  const billText = (await page.textContent('button[data-act="bill"]')).trim();
  assert(X % 5 === 0 && X >= 150, `3 Bill amount ${X} is a multiple of 5 and at least 150`);
  assert(billText === `Bill Northlight Studios · ${await fmt(page, X)}`, `3 Bill button reads "${billText}" = priceInvoice total (sheets + 1.5 h Design)`);
```

- [ ] **Step 3: Step 6 and 7 additions** — in step 6, after the CSV sum assertion, add `assert(dataRows.some(r => /^Design — Layout \(1\.5 hrs @ \$150\/hr\)/.test(r[5])), '6 the CSV carries the Design line');`. In step 7, after `'7 job card says "Billed · #3605"'`, add:

```js
  assert(/Billed · #3605/.test(await page.$eval('#owner-panel .jc-chip--ready', e => e.textContent)), '7 job chip reads "Billed · #3605"');
  assert((await page.$$eval('#owner-panel .jc-labor .jc-caption', els => els.map(e => e.textContent))).some(t => /^Billed · #3605$/.test(t)), '7 the Design line reads "Billed · #3605"');
```

Then after `'7 Recent invoices lists 3605'`:

```js
  // ── 7b. Hours added after the sheets were billed: a labor-only row; the minimum was charged once ──
  await openCard(page, 1195);
  await addHours(page, 'Design', '0.5', 'Revisions');
  await openBilling(page);
  const nlRow = card(page, 'Northlight Studios').locator('.billing-row');
  assert(await nlRow.count() === 1 && await nlRow.evaluate(e => e.classList.contains('billing-row--labor-only')), '7b Northlight: one labor-only row');
  assert(/Design hours only/.test(await nlRow.locator('.billing-row-state').textContent()), '7b state reads "Design hours only"');
  assert(/Sheets billed on #3605 · 0\.5 h Design added after/.test(await nlRow.locator('.billing-row-detail').textContent()), '7b detail: "Sheets billed on #3605 · 0.5 h Design added after"');
  assert((await nlRow.locator('.billing-row-amt').textContent()).trim() === '$75', '7b 0.5 h after 1.5 h billed = $75 (the 1-h minimum was already covered)');

  // ── 7c. Recent jobs: job A finished (served by a patched loader, as in 3b) → link → card → Put back → Projects ──
  await page.evaluate(() => {
    const isA = s => /Order_1195/.test(s.jobName || s.fileName);
    window.__finA = sheets.filter(isA).map(s => ({ ...s, finished: true, finishedAt: Date.now() - 2 * 86400000 }));
    sheets = sheets.filter(s => !isA(s));
    Storage.loadFinishedSheets = async () => window.__finA;
    BillingScreen.boardChanged();
  });
  await openBilling(page);
  const recent = page.locator('#billing-recent-jobs .billing-recent-job', { hasText: 'Order_1195' });
  assert(await recent.count() === 1 && /Recent jobs/.test(await page.textContent('#billing-recent-jobs')), '7c Recent jobs lists the finished job');
  assert(/Northlight Studios · finished .* · 2 sheets billed #3605 · 2 h Design/.test(await recent.textContent()), '7c line: "Northlight Studios · finished <date> · 2 sheets billed #3605 · 2 h Design"');
  assert(await card(page, 'Northlight Studios').locator('.billing-row--labor-only').count() === 1, '7c the finished job keeps its labor-only row');
  await recent.locator('button[data-act="open-job"]').click();
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.$eval('#content-screen', e => e.classList.contains('content-screen--finished')) && /Billing/.test(await page.textContent('#back-to-projects-btn')), '7c the link opens the finished job card; Back reads "← Billing"');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#billing-screen:not([hidden])');
  assert(true, '7c Back from a finished card lands on Billing');
  await recent.locator('button[data-act="open-job"]').click();
  await page.waitForSelector('#content-screen:not([hidden])');
  dialogs = [];
  await page.click('#owner-panel [data-action="putback"]');
  await page.waitForSelector('#projects-screen:not([hidden])');
  assert(dialogs.some(d => /^confirm:Put/.test(d)) && /Projects/.test(await page.textContent('#back-to-projects-btn')), '7c Put back from a Billing-opened card lands on Projects and resets the Back label');
```

- [ ] **Step 4: Step 9 — the $0.00 line** — in step 9, after `await cutAll(page, 1);` add `await addHours(page, 'Design', '0.5', 'Sketch');` (the first Copperline invoice bills the 1-h minimum). After the Retry assertion (`'9 restored + Retry: …'`) add:

```js
  // ── 9b. 0.5 h after 0.5 h billed: a $0.00 line, still shown with its hours ──
  await openCard(page, 1201);
  await addHours(page, 'Design', '0.5', 'Revisions');
  await openBilling(page);
  const ccRow = card(page, 'Copperline Stage').locator('.billing-row--labor-only');
  assert(await ccRow.count() === 1 && (await ccRow.locator('.billing-row-amt').textContent()).trim() === '$0', '9b Copperline: labor-only row at $0 (the 1-h minimum was charged on the first bill)');
  assert(/Bill Copperline Stage · \$0$/.test((await card(page, 'Copperline Stage').locator('button[data-act="bill"]').textContent()).trim()), '9b the Bill button reads "Bill Copperline Stage · $0"');
  const desc = await page.evaluate(() => {
    const m = BillingScreen.buildModel(null);
    const c = m.customers.find(x => x.customerName === 'Copperline Stage');
    const ctx = { priceList: c.priceList, laborTypes: OwnerStore.laborTypes() };
    const priced = Pricing.priceInvoice(BillingModel.pricingInput(c, {}, ctx));
    return InvoiceLines.finalize(priced, { qbItems: OwnerStore.qbItems(), laborTypes: ctx.laborTypes }).find(l => l.type === 'labor').description;
  });
  assert(desc === 'Design — Revisions (0.5 hrs, covered by the 1-hr minimum)', `9b the invoice line reads "${desc}"`);
  // (the Copperline $0 row stays on Billing for the rest of the run; steps 10–13 only look at other customers)
```

- [ ] **Step 5: Step 1 (Collin)** — add one assertion after `'1 Collin: no Billing button'`: `assert(await page.isHidden('#billing-recent-jobs') || (await page.textContent('#billing-recent-jobs')) === '', '1 Collin: no Recent jobs block');` (the whole `#billing-screen` is hidden for him; this just documents it).

- [ ] **Step 6: Run twice**

Run: `node tools/browser-check-phase2.mjs && node tools/browser-check-phase2.mjs && node tools/browser-check-phase1.mjs`
Expected: `SUITE: PASS` three times, no `FAIL:` lines, `14 no uncaught page errors (0)`. If a selector in Step 2-4 does not match the real markup, fix the SELECTOR (not the app) unless the app is wrong — then it is a Task 7 bug to fix in a separate `fix:` commit.

- [ ] **Step 7: Commit**

```bash
git add tools/browser-check-phase2.mjs
git commit -m "test(browser): Phase 2 pass without the Done step — rows included by default, job-name link, hours after billing, \$0 line, Recent jobs, Back to Billing"
```

---

### Task 10: Docs — CLAUDE.md, spec status, vault note

**Files:** `CLAUDE.md` (repo), the spec's `**Status:**` line, `G:\My Drive\Brain\Brain\Projects\Studio Billing Redesign.md` (vault, no git).

- [ ] **CLAUDE.md file-structure block:**
  - `js/pricing.js` line: append "… `priceInvoice()` — the ONLY place price math lives (2026-10-06: the labor minimum is charged once per job across bills via `priorLaborHours`)".
  - `js/billing-model.js`: "… billable sheets and labor, row states (ready / partly / labor-only — every row included by default, no Done step), through-date and billing-start gates, invoice draft and fingerprint, `recentJobs()`. …"
  - `js/billing.js`: "… one card per customer with ready / partly cut / design-hours-only rows (all in by default; Remove / Add back), job names open the job card (Back returns to Billing), Recent jobs, Recent invoices. …"
  - `js/job-card.js`: "… statuses/tags, cut-date correction, Design/CAM hours (they go on the next bill as entered — no Done step), billing-status chip (Not billed yet / N of M sheets billed / Billed · #N), finished jobs + Put back on the board".
- [ ] **Sheet record table:** the `jobBilling/` mention → "(owners: customer, material, turnaround, laborLines[]; `noDesignTime` / `readyForBilling` / `readyAt` / `readyBy` are stale fields from before 2026-10-06 — never read or written)".
- [ ] **Spec status line** (`docs/superpowers/specs/2026-10-06-billing-auto-include-design.md` l.3): "**Status:** design approved in conversation 2026-10-06 (Travis); implemented <date> on branch `billing-auto-include` (plan: ../plans/2026-10-06-billing-auto-include.md). Not merged."
- [ ] **Vault note** (`Studio Billing Redesign.md`, Current Focus): one dated entry — built on `billing-auto-include`, NOT merged; rollout = Task 11 pre-deploy check → Travis's go → merge + push (live) → shop PC Ctrl+Shift+R → first real $0.00 line checked in QuickBooks. Tick nothing not done.
- [ ] Commit (repo files only) — `docs: no Done step, rows in by default, Recent jobs, minimum once per job — CLAUDE.md and spec status`.

---

### Task 11: Final verification, Fable whole-branch review (ask Travis first), pre-deploy check, hand-off — no merge, no push

- [ ] **Step 1: Verify before claiming** (read every number; don't assume):
  - `npm test` in the worktree → all pass (baseline 492 + the new tests; report the real count).
  - `node tools/browser-check-phase1.mjs` → `SUITE: PASS`; `node tools/browser-check-phase2.mjs` → `SUITE: PASS`.
  - Emulator check (`tools/emulator-check-phase2.mjs`, HQ worktree, Java per the memory note `reference_firestore_emulator_java`): run it if the emulator is set up on this machine — `planLock` changed, and its fixtures carry a `readyForBilling` key the lock now ignores; expected `SUITE: PASS` unchanged. If it cannot run, say so in the hand-off rather than skipping silently.
  - **Stale fields gone from code:** `grep -rn "readyForBilling\|noDesignTime\|readyAt\|readyBy\|'waiting'\|applyDone\|applyNotReady" js/` → only `js/storage-owner.js` (`newJobBilling` defaults — tolerated, see Global Constraints). Anything else is a finding.
  - **Money only in pricing.js:** `grep -nE "\* *(0\.5|0\.75|135|60|40|150)\b|roundTo|Math\.round\([^)]*/ *5" js/*.js | grep -v "js/pricing.js"` → nothing that computes a price.
  - **No real identities:** `grep -rnE "@gmail|@goldenboys|@wearevanlab|AIza" --include=*.js --include=*.mjs --include=*.cjs --include=*.md --include=*.html . | grep -v -e "js/firebase-config.js" -e "js/endpoint-config.js" -e "docs/superpowers/plans/"` → nothing.
  - `git log --oneline master..billing-auto-include` → one commit per task (plus any `fix:`); `git status` clean.
- [ ] **Step 2: Ask Travis** — "Ready for the Fable whole-branch review (one Fable run). OK to dispatch?" (tokens-low rule). On yes, dispatch `Agent` with `model: "fable"` and say so. Give it: the spec path, this plan's path, `git diff master...billing-auto-include`, and these questions: (1) is the §5 formula implemented verbatim, and can any sequence (prior on another invoice, cancel + re-lock, partial then rest, two types, min 0) charge a minimum twice or bill negative hours; (2) can a $0.00 labor line break the lock, the CSV, Imported OK, Recent invoices or the Done screen; (3) is any money computed outside `Pricing.priceInvoice`; (4) does any path still read or write `readyForBilling` / `noDesignTime` (other than `newJobBilling` defaults); (5) does Back ever strand the owner (Billing not loaded, finished job, Put back, sheets listener emptying the board); (6) Collin's screens byte-for-byte unchanged in behaviour; (7) every changed script's `?v=` bumped and nothing else; (8) no new Firestore reads or queries; (9) fixtures and docs free of real names/ids.
- [ ] **Step 3: Apply findings** per `superpowers:receiving-code-review` (verify each before changing code), re-run Step 1, one `fix: review findings — …` commit; re-review the fix commit (Opus) if any finding was Important or worse.
- [ ] **Step 4: Pre-deploy check — the rollout effect (spec §6).** Jobs that already have unbilled design lines but were never marked Done will show those hours on the next Billing visit. Travis lists them himself: signed in as an owner on the LIVE app (https://huffman44-ctrl.github.io/CNC-Job-Tracker/, today's build, Billing switch on), F12 → Console → paste this (read-only; it only reads the owner caches already loaded):

```js
(() => {
  const start = (OwnerStore.invoicing() || {}).billingStartDate || null;
  const startMs = start ? new Date(start + 'T00:00:00').getTime() : null;
  const out = [];
  OwnerStore.allJobBilling().forEach(jb => {
    const lines = (jb.laborLines || []).filter(l => ((l && l.status) || 'unbilled') === 'unbilled' && (startMs === null || (Number(l.enteredAt) || 0) >= startMs));
    if (!lines.length || jb.readyForBilling) return;
    const h = lines.reduce((a, l) => a + (Number(l.hours) || 0), 0);
    out.push(`${jb.jobName} — ${jb.customerName || 'no customer'} — ${h} h unbilled, never marked Done`);
  });
  console.log(out.length ? out.join('\n') : 'No job has unbilled design hours waiting on Done.');
})()
```

  Give Travis the list in the session (and the 🔊 line if voice is on). Each of those jobs will appear on Billing after the deploy with its hours in by default; he decides whether that is right before saying go.
- [ ] **Step 5: Hand-off to Travis** (short; 🔊 line if voice is on): branch ready, NOT merged. **Pushing `master` is a live deploy** (GitHub Pages serves `master` directly) and needs his explicit go. On go: delete the untracked plan copy in the main checkout → merge `billing-auto-include` into `master` → push via the **go-live** skill → Pages build `built` → `curl -s https://huffman44-ctrl.github.io/CNC-Job-Tracker/ | grep -o 'app.js?v=[0-9]*'` → `app.js?v=37` → **shop PC and every open tracker tab: Ctrl+Shift+R** (memory: hard refresh after every deploy). Then: the first time a bill carries a $0.00 labor line, import it into QuickBooks and confirm it lands (spec §7 — "one real test import before relying on it"). Remove the worktree and delete the branch after the merge.

---

## Self-review (done while writing; left here so the executor can see what was checked)

**Spec coverage:** §2 every cut sheet in by default → T3 (`defaultIncluded: true`, `pricingInput`), T7 (Remove / Add back); design hours on the next bill without Done → T3 (no gate), T6 (no Done UI), T4 (lock no longer checks it); every job opens its card from Billing with Back to Billing → T7 (link, `cardReturn`, `show({ resume })`), T9; minimum once per job → T1 (§5 verbatim, three table rows), T2 (wording), T3 ($0 row), T4 (prior re-check). §3.1 states / labels / toggle / detail → T3, T7. §3.2 link → T7. §3.3 Recent jobs → T5, T7, T9 step 7c. §4 job card removals, chip, line status, caption, Back → T6, T7. §5 formula, last-line credit, $0 line with "(covered by the 1-h minimum)", `priorLaborHours` input, lines billed before this change → T1 (`charged` assumes `max(min, hours)` was billed, which the old per-invoice top-up did), T2. §6 no fields/rules/migration → Global Constraints; lock and fingerprint `readyForBilling` removed → T3, T4; rollout check → T11 Step 4. §7 tests: pricing (table rows, rush split, min 0, absent) → T1; BillingModel (every state default, no waiting, not-Done labor billable, toggles together, recent jobs) → T3, T5; job card (no Done, chip wording, line status) → T6; browser flow → T9; QuickBooks $0 import → T11 Step 5 hand step. §8 out of scope untouched.

**Interpretations (each named where it happens):** a credit larger than the last line's hours walks back to earlier lines so no line is negative (T1; spec says "stays on the LAST line" and "never negative" — both cannot hold for two short lines); "1.5 h design" in §3.1 is rendered with the stored `typeName` (`1.5 h Design`, `0.5 h CAM`) so CAM is never lower-cased, matching §3.1's own labor-only example (T3); the Recent-jobs partial wording carries no invoice numbers (`1 of 3 sheets billed`) exactly as §3.3 lists it, while the all-billed wording does (T5); an all-No-charge job reads `no charge` / `No charge` (not in the spec; the alternative "0 of 0 sheets billed" is nonsense) (T5, T6); `show({ resume })` keeps the through date and selections (spec only says "Back returns to Billing") (T7); `newJobBilling` keeps seeding the stale fields (rules unknown here; §6 says no rules change) (Global Constraints); a $0.00 labor-only invoice is allowed to lock and import (spec §5 says the line "still appears on the invoice") (T1 asserts `total 0`, T9 9b prices it).

**Placeholder scan:** none. Every step has its code or its exact command. `<date>` in Task 10 is the executor's date.

**Type consistency:** `Pricing.priceInvoice({ …, priorLaborHours })` and `Pricing.priorLaborHours(lines)` (T1) ← `BillingModel.rowPricing / laborAmount / pricingInput` (T3) ← `billing.js billState` and `invoice-screen.js computeView` (unchanged callers, they pass `pricingInput`'s output through); `labor[].coveredHours / topUpHours / billedHours / hours` (T1) ← `InvoiceLines` labor describe (T2) and `buildBreakdown` (T1); `row.priorLaborHours`, `row.billedOn`, `captured.job.priorLabor` → `draft.fingerprint.jobs[jk].priorLabor` (T3) ← `InvoiceStore.planLock` (T4); `BillingModel.laborText` (T3) ← `recentJobs` (T5); `BillingModel.recentJobs(input)` (T5) ← `billing.js render` (T7); `JobCard.cardChip(jobName, jobSheets)` (T6) ← `app.js renderProjects` (T7); `BillingScreen.show({ resume: true })` (T7) ← `app.js` Back handler (T7); the `open-job` click path (`opts.openJob(name, finished)`) is unchanged and now serves rows and Recent jobs alike.

**Review Focus → tests:** 1 → T1 "credit larger than the last line"; 2 → T1 row 1 (`total 0`, one line amount 0) + T2 + T9 9b; 3 → T4 `prior` case; 4 → T5 window / active / no-finishedAt / outside tests; 5 → T7 `showProjectsScreen` reset + T9 7c Put back.
