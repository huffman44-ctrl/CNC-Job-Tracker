# Job Ticket Print at CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export CSV also opens the browser print dialog with a 4×6″ job ticket (job name, sheet count, completed date, ruled write-in area) for the shop's Rollo thermal printer.

**Architecture:** Per the spec (`docs/superpowers/specs/2026-07-15-job-ticket-print-design.md`): a hidden ticket `<div>` in `index.html`, print-only CSS in `css/style.css`, and a `printJobTicket()` helper called from `doExport()` between the CSV download and the existing delete-job confirm. `window.print()` blocks until the dialog closes, so the ordering (download → print → delete confirm) falls out naturally.

**Tech Stack:** Plain JS/HTML/CSS, no framework, no build step. This repo has **no automated test framework** — verification follows its manual-testing pattern (isolated temp copy, disabled Firebase config), plus a throwaway Playwright driver (borrowed from the estimator repo's `.verify/` install, run from scratch space, **not committed here**) to exercise the flow headlessly.

## Global Constraints

- **Never run against the real Firebase config** — it points at the live production database. All testing uses a temp copy with `projectId` disabled (in-memory mode).
- `master` is live-deployed via GitHub Pages — **commit but do not push**; the final gate is Travis printing one real ticket on the Rollo.
- Ticket is black-on-white only; no logo/QR/operator (spec's "Not in scope").
- The CSV download, its contents, and the delete-job confirm are unchanged.
- Line numbers are current positions — match on the quoted code, not the number.

---

### Task 1: Ticket markup, print CSS, and the export hook

**Files:**
- Modify: `index.html` (ticket container before the `<script>` tags; bump two cache-buster versions)
- Modify: `css/style.css` (append print rules)
- Modify: `js/app.js:1040-1075` (`doExport` + new `printJobTicket` helper)
- Test: scratch Playwright driver + screenshot (not committed)

**Interfaces:**
- Produces: `printJobTicket(displaySheets)` — populates `#job-ticket` from the sheets being exported (job name = `currentProject` → first sheet's `jobName` → cleaned `fileName`; count = `displaySheets.length`; date = latest `completedAt` across `Storage.get(sheet.fileKey, 'sheet')` records, else today), toggles `body.printing-ticket`, calls `window.print()` in `try/finally`.
- Consumes: existing globals `currentProject` (`js/app.js:33`), `Storage.get`, `getDisplaySheets()` output shape.

- [ ] **Step 1: Add the ticket container to `index.html`**

Immediately before `<script src="js/firebase-config.js?v=7"></script>`, insert:

```html
  <div id="job-ticket" class="job-ticket" hidden>
    <div class="job-ticket__name" id="job-ticket-name"></div>
    <div class="job-ticket__meta" id="job-ticket-meta"></div>
    <div class="job-ticket__writein">
      <div class="job-ticket__rule"></div>
      <div class="job-ticket__rule"></div>
      <div class="job-ticket__rule"></div>
      <div class="job-ticket__rule"></div>
    </div>
  </div>
```

- [ ] **Step 2: Bump the cache-busters for the two changed files**

In `index.html`, change `css/style.css?v=7` → `css/style.css?v=8` and `js/app.js?v=7` → `js/app.js?v=8`. Leave the other three script tags at `v=7`.

- [ ] **Step 3: Append the print CSS to `css/style.css`**

At the end of the file:

```css
/* ── Job ticket — printed at CSV export, 4x6 thermal (Rollo) ────────────── */
.job-ticket { display: none; }

@page { size: 4in 6in; margin: 0.25in; }

@media print {
  body.printing-ticket > *:not(.job-ticket) { display: none !important; }
  body.printing-ticket .job-ticket {
    display: block !important;
    color: #000;
    background: #fff;
    font-family: Arial, sans-serif;
  }
  .job-ticket__name { font-size: 26pt; font-weight: 900; line-height: 1.15; word-break: break-word; }
  .job-ticket__meta { font-size: 13pt; margin-top: 12pt; }
  .job-ticket__writein { margin-top: 30pt; }
  .job-ticket__rule { border-bottom: 1px solid #888; height: 34pt; }
}
```

(`@page` sits at top level; the `!important` on the ticket's `display` overrides the `hidden` attribute's UA rule and the screen rule. The `size: 4in 6in` only affects printing, and only this app's pages.)

- [ ] **Step 4: Add `printJobTicket` to `js/app.js`**

Immediately before `async function doExport()` (currently `js/app.js:1040`, right after the `sheetHasVbit` function), insert:

```js
function printJobTicket(displaySheets) {
  const ticket = document.getElementById('job-ticket');
  if (!ticket || !displaySheets.length) return;
  const jobName = currentProject
    || displaySheets[0]?.jobName
    || (displaySheets[0]?.fileName || 'CNC Job').replace(/\.html?$/i, '');
  let latest = null;
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (rec?.completedAt) {
      const d = new Date(rec.completedAt);
      if (!latest || d > latest) latest = d;
    }
  }
  const dateStr = (latest || new Date()).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const n = displaySheets.length;
  document.getElementById('job-ticket-name').textContent = jobName;
  document.getElementById('job-ticket-meta').textContent =
    `${n} sheet${n !== 1 ? 's' : ''} — completed ${dateStr}`;
  ticket.hidden = false;
  document.body.classList.add('printing-ticket');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-ticket');
    ticket.hidden = true;
  }
}
```

- [ ] **Step 5: Call it from `doExport` between download and delete-confirm**

In `doExport` (`js/app.js:1068-1071`), change:

```js
  setTimeout(() => URL.revokeObjectURL(url), 100);

  const jobName = currentProject;
```

to:

```js
  setTimeout(() => URL.revokeObjectURL(url), 100);

  printJobTicket(displaySheets);

  const jobName = currentProject;
```

- [ ] **Step 6: Set up the isolated test copy**

```bash
TESTDIR="/c/Users/GOLDEN~1/AppData/Local/Temp/cnc-ticket-test"
rm -rf "$TESTDIR" && cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" "$TESTDIR"
```

(Windows path: `C:\Users\GOLDEN~1\AppData\Local\Temp\cnc-ticket-test` — used in the driver's `file://` URL below.)

Edit `/tmp/cnc-ticket-test/js/firebase-config.js`: change the `projectId` value to `"PASTE_DISABLED"` (app then runs in-memory, never touching production).

- [ ] **Step 7: Write the throwaway Playwright driver**

Create `C:\Users\GOLDEN~1\AppData\Local\Temp\cnc-ticket-test\check-ticket.js` (run it from the estimator's `.verify/` directory, which has Playwright installed — do NOT commit this file to CNC_WebApp):

```js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept().catch(() => {}));

  await page.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls++;
      window.__ticketDuringPrint = {
        bodyHasClass: document.body.classList.contains('printing-ticket'),
        hidden: document.getElementById('job-ticket').hidden,
        name: document.getElementById('job-ticket-name').textContent,
        meta: document.getElementById('job-ticket-meta').textContent,
      };
    };
  });

  await page.goto('file:///C:/Users/GOLDEN~1/AppData/Local/Temp/cnc-ticket-test/index.html');

  await page.setInputFiles('input[type="file"]', [
    path.join(__dirname, '260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html'),
  ]);
  await page.waitForTimeout(800);

  // Enter the project, mark the sheet complete (advance to Complete via the action button)
  await page.click('.project-card');
  await page.waitForTimeout(400);
  await page.click('.sheet-row, .sheet-card');
  await page.waitForTimeout(400);
  const actionBtn = await page.$('.btn-advance, .action-btn, button:has-text("Start")');
  // Drive the completion flow per the actual UI; if selectors differ, inspect and adapt —
  // the goal is one sheet with a completedAt record. If completion can't be reached,
  // export works on incomplete jobs too (ticket dates today) — proceed to export.

  await page.click('button:has-text("Export")');
  await page.waitForTimeout(800);

  const printCalls = await page.evaluate(() => window.__printCalls);
  const during = await page.evaluate(() => window.__ticketDuringPrint);
  console.log('window.print called once (expect 1):', printCalls);
  console.log('body had printing-ticket class during print (expect true):', during && during.bodyHasClass);
  console.log('ticket unhidden during print (expect false):', during && during.hidden);
  console.log('ticket name (expect job name, non-empty):', during && during.name);
  console.log('ticket meta (expect "1 sheet — completed <date>"):', during && during.meta);

  const cleanedUp = await page.evaluate(() => ({
    cls: document.body.classList.contains('printing-ticket'),
    hidden: document.getElementById('job-ticket').hidden,
  }));
  console.log('class removed after print (expect false):', cleanedUp.cls);
  console.log('ticket re-hidden after print (expect true):', cleanedUp.hidden);

  // Layout screenshot for human review: force print state and print media
  await page.evaluate(() => {
    document.getElementById('job-ticket').hidden = false;
    document.body.classList.add('printing-ticket');
  });
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 384, height: 576 }); // 4x6in @ 96dpi
  await page.screenshot({ path: 'ticket-preview.png' });
  console.log('Screenshot written: ticket-preview.png');

  console.log('Page errors (expect []):', JSON.stringify(errors));
  await browser.close();
})();
```

The completion-flow selectors above are best-effort — inspect the served page and adapt them to the real UI (the repo's `index.html`/`js/app.js` are the source of truth). The hard assertions are the print-call block and cleanup block; they must match their `(expect ...)` annotations.

- [ ] **Step 8: Run the driver and review the screenshot**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/Estimate and invoice Calculator/.verify"
node /tmp/cnc-ticket-test/check-ticket.js
```

All `(expect ...)` annotations must match. Open `ticket-preview.png` and confirm: big job name at top, "1 sheet — completed <date>" beneath, four ruled lines in the lower half, black on white.

- [ ] **Step 9: Serve the temp copy for the human print test**

```bash
cd /tmp/cnc-ticket-test && npx serve .
```

Travis (or the controller, reporting to Travis): open the local URL, upload the sample sheet, Export CSV, and check the real print-preview dialog shows the 4×6 ticket. This is also the artifact for the physical Rollo test before any push.

- [ ] **Step 10: Commit (do not push)**

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
git add index.html css/style.css js/app.js
git commit -m "Print a 4x6 job ticket when exporting the CSV

Export CSV now also opens the print dialog with a shop-floor ticket:
job name, sheet count, completed date, and a ruled write-in area,
sized for the Rollo thermal printer. Cancelling the dialog skips
printing; the delete-job confirm still follows either way.

Do not deploy until a real ticket has been printed on the Rollo."
```

Do not push — `master` is live via GitHub Pages. Travis prints one real ticket first.
