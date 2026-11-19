# CNC Job Tracker — Project Context

## What this app does
Browser-only (no build step, no framework) single-page app. Operators upload VCarve CNC job sheet HTML files, grouped into projects by job name, and track each sheet through a 3-state workflow: **Incomplete → In Progress → Complete** (date/time + operator name + notes recorded on completion). All sheet data, completions, and project notes sync live across devices via Firestore — this is **not** local-only storage; every operator sees the same shared state in real time.

## File structure
Full per-file detail: docs/file-guide.md — read the entry before changing a file.
```
CNC_WebApp/
├── index.html                 — screens + modals markup; screens toggled via `hidden`
├── css/style.css               — all styles; CSS color tokens; dark mode via [data-theme]
├── js/parser.js                 — parseJobSheet(htmlString): reads one VCarve/Aspire setup sheet
├── js/keys.js                   — Keys: record ID formulas. **LOCKED** by test/keys.test.mjs: doc ids of every live record — never change what they produce
├── js/upload-batch.js           — UploadBatch: per-file upload checks (re-upload guard), saves, combined notice
├── js/new-job-alert.js          — NewJobAlert: alert for a job uploaded on another computer
├── js/path-utils.js             — sanitizeForPath(name) for customer-named export paths
├── js/sequence.js               — generateSequence for the To Print panel
├── js/job-stickers.js           — JobStickers: pure helpers for a job's sticker batches
├── js/vanlab-bar.js            — VanlabBar: pure helpers for the VanLab print bar on the job screen
├── js/doc-info.js               — print-queue PDF inspection/sizing; sortDrop for dropped files
├── js/storage.js                — Storage: Firestore wrapper + sync cache; deleteSheets() is the ONE sheet delete
├── js/storage-owner.js          — OwnerStore: OWNER-ONLY collections; every write is a read-modify-write transaction
├── js/features.js               — Features: owner switches; gate owner UI on Features.on(<key>), never isOwner() alone
├── js/pricing.js                — Pricing: priceInvoice() is the ONLY place price math lives
├── js/invoice-lines.js          — InvoiceLines: words + QuickBooks columns/CSV only, no arithmetic
├── js/invoice-store.js          — InvoiceStore: invoice lifecycle planners + transaction executor
├── js/billing-model.js          — BillingModel: pure Billing-screen model; every dollar from Pricing.priceInvoice()
├── js/billing.js                — BillingScreen: owners-only Billing screen (weekly rhythm + hand mode)
├── js/invoice-screen.js         — InvoiceScreen: lock THEN download QuickBooks file → Imported OK / Cancel
├── js/billing-done.js           — BillingDone: Done screen + Recent invoices builders
├── js/log-rows.js               — LogRows.build(): the 14-column Master Job Log row
├── js/export-finish.js          — ExportFinish: CSV, Master Job Log write, then finish job + sheets
├── js/sheet-thickness.js        — SheetThickness: per-sheet thickness helpers; board display only
├── js/job-details.js            — owner job-details step at upload + Edit job details form
├── js/job-card.js               — owner panel on the job card (statuses, hours, billing chip, finished jobs)
├── js/settings.js               — Settings screen (owners) + pure SettingsValidate
├── tools/browser-check-phase1.mjs — Playwright pass in PASTE mode (owner vs Collin) → `SUITE: PASS`
├── tools/browser-check-phase2.mjs — Playwright pass in PASTE mode: owner billing end to end → `SUITE: PASS`
├── tools/emulator-check-phase2.mjs — real stores vs real rules in Firestore emulator. EMULATOR ONLY
├── tools/build-pricing-fixtures.mjs — one-off: pricing fixtures with FAKE customer names (repo is public)
├── test/helpers/fake-firestore.cjs — in-memory fake Firestore for tests; defines no tests
├── js/firebase-config.js        — FIREBASE_CONFIG for the LIVE production Firestore project `cnc-job-tracker`
├── js/endpoint-config.js        — ENDPOINT_CONFIG: LIVE Apps Script web app URL + token
├── js/endpoint.js                — Endpoint client: sheet archive, Master Job Log writes, print-queue docs
├── js/app.js                    — all UI logic, Firebase init
├── package.json                 — `npm run serve` → `npx serve .` (no build step)
├── 260520_..._Summary_Sheet 9.html — tracked sample file at repo root
├── samples/                    — gitignored local test HTML, not committed
└── apps-script/logging-endpoint.gs — Apps Script endpoint source; pasted into script.google.com, not run from repo
```

## ⚠️ Testing safety — read before running this app
`js/firebase-config.js` points at the **real, shared production database** that real operators use. Running the app normally (`npm run serve` + open in browser, or driving it with Playwright/automation) connects live and any upload/completion/delete action writes to production immediately.

**Never test against the real config.** To test safely offline:
1. Copy the app to a temp directory.
2. Overwrite the copy's `js/firebase-config.js` with a `projectId` that starts with `"PASTE"` (e.g. `"PASTE_DISABLED"`).
3. **Also overwrite the copy's `js/endpoint-config.js`** with `const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };` — the tracked file holds the LIVE Apps Script URL and token (GitHub Pages serves it), so without this an upload in the copy calls the real `archiveSheet` and writes into the Drive archive. `Endpoint.enabled()` is false once the URL starts with PASTE.
4. `initApp()` in app.js (~line 2670, search `startsWith('PASTE')`) checks `FIREBASE_CONFIG.projectId.startsWith('PASTE')` and skips Firebase entirely when true, falling back to in-memory-only mode — uploads, completions, and deletes stay local to that browser tab with zero risk to prod data.
5. Owner screens in a PASTE copy: there is no sign-in, so `Features` never loads. In the console run `Features._setForTests(Features.defaults('t@x'), 't@x'); OwnerStore.loadAll().then(() => { OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); rerenderCurrent(); })` (add `jobCard: { on: true, users: ['t@x'] }` to the state for the job-card panel). `node tools/browser-check-phase1.mjs` does all of this headlessly.
6. Owner billing in a PASTE copy: `loadOwnerStateThen` (which calls `InvoiceStore.init`) never runs without sign-in, so the stub must also start InvoiceStore. Console: `Features._setForTests({ ...Features.defaults('t@x'), jobCard: { on: true, users: ['t@x'] }, billing: { on: true, users: ['t@x'] } }, 't@x'); OwnerStore.loadAll().then(async () => { OwnerStore.onChange(rerenderCurrent); InvoiceStore.init(null, { getIdToken: async () => 't', upsertLogRows: (rows, token) => Endpoint.upsertLogRows(rows, token), hasDatabase: () => false }); await InvoiceStore.loadAll(); InvoiceStore.onChange(rerenderCurrent); applyFeatureNav(); rerenderCurrent(); })`. `node tools/browser-check-phase2.mjs` does this headlessly. Transactions + rules need the emulator: `tools/emulator-check-phase2.mjs` (emulator only — it refuses otherwise; command in its header, run from the HQ worktree).

If you ever suspect a test run touched production, check the `sheets` collection for unexpected docs by filename and delete them immediately — don't leave fake data mixed into real operator records.

**`master` is live-deployed.** This repo is published via GitHub Pages directly from the `master` branch at https://huffman44-ctrl.github.io/CNC-Job-Tracker/ — there is no build/CI step in between. Pushing to `master` is a real deploy to whatever real operators have open, not just a git bookkeeping update. Merge and verify locally before pushing.

## Architecture
- **Screens** — Loading, Projects directory, Upload, Content, plus Ticket History and Manage Customers: full walk-through in docs/file-guide.md (Architecture).
- **Storage** (`js/storage.js`, operator-reachable) and **OwnerStore** (`js/storage-owner.js`, owners only) — thin wrappers over Firestore with synchronous local caches. Rules: `HQ/firestore.rules` (deployed from the HQ repo; a collection with no match block is denied; a console edit is wiped by the next deploy). Roles are the signed-in email: operators = Travis, Collin (+ Eva); owners = Travis, Eva. Owners are operators automatically (`isJtOperator` includes owners); only owners may flip `sheets.finished` true→false. Never write a real email, uid, token or spreadsheet id into this public repo.

### The sheet record (spec 2026-10-04 §5.1 — this is the one place it is written down)
A "sheet" is one Aspire setup-sheet HTML file. `fileKey = Keys.sheet(fileName)` is its identity everywhere (Firestore doc ids, the log's Sheet Key column). Its record is spread over documents that share that key:

| Field | Lives in | Meaning | Written by |
|---|---|---|---|
| `fileName`, `sheetTitle`, `jobName`, `toolpaths[]`, `materialInfo[]` | `sheets/{fileKey}` | From the Aspire file (`parseJobSheet`) | upload |
| `totalTime` | `sheets/` | Aspire's estimated cut time `HH:MM:SS` — what the customer is billed on, never wall-clock | upload |
| `layoutSvg` / `layoutSvgGz` / `layoutOversize` | `sheets/` | The drawing; cleared at finish when `archiveUrl` exists (an owner-restored sheet with no drawing shows the oversize-style notice "Layout preview is not stored here. Open the original sheet") | upload; Collin's export |
| `archiveUrl` | `sheets/` | Drive download link to the archived HTML — the drawing of record after finish | upload (Apps Script, async) |
| `uploadedAt` | `sheets/` | Server timestamp | upload |
| `finished`, `finishedAt`, `finishedBy` | `sheets/` | `true` once the job was exported; finished sheets leave the board for everyone and are **never deleted** (rules) | Collin's export |
| `status`, `completedAt`, `operator`, `notes` | `completions/{fileKey}` | 3-state record; `completedAt` is the cut time (weekend detection). Absent = not cut | Collin |
| `text` | `sheetNotes/{fileKey}` | Per-sheet instruction note | anyone |
| `shapes` | `sheetAnnotations/{fileKey}` | Layout markup | anyone |
| `status` (`unbilled` default / `in-progress` / `billed` / `external`), `invoiceNumber`, `poNumber`, `billedAt`, `cutAtBilled`, `cutDateOverride`, `priced`, `jobKey`, `customerKey` | `sheetBilling/{fileKey}` | Billing state (flat fields; no doc = unbilled). Phase 1 wrote only `cutDateOverride`; Phase 2 writes the full lifecycle (unbilled → in-progress → billed, `priced` snapshot) inside the invoice transactions | owners |

Job-level, keyed `jobKey = Keys.job(jobName)` (`'proj_…'`): `projectNotes/` (note), `projectCustomer/` (customer name — Collin's export routes the log by it), `jobs/` (`finished`, `exportCount`, …), `jobBilling/` (owners: customer, material, turnaround, laborLines[]; `noDesignTime` / `readyForBilling` / `readyAt` / `readyBy` are stale fields from before 2026-10-06 — never read or written). Shared: `customers/{Keys.customer(name)}` (directory), `customerBilling/` (owners: `billedOutsideApp`, `cadence` (`'weekly'` | `'toDate'`; absent = weekly), remembered material defaults, `openInvoice` — the one open invoice number per customer, or null), `settings/*` (owners; `settings/migrations` is readable by operators because the board query needs its flag), `ticketHistory/`, `printQueue/`, `invoices/` (owners, Phase 2 — below).

**`invoices/{number}`** — doc id = the invoice number (QuickBooks-typed, so a repeat is impossible). `status`: `in-progress` (locked, file downloaded) → `imported` (Imported OK) or `cancelled`. `perSheet` snapshots each sheet at lock time (the Master Job Log row built then, `cutAt`, `priced`), so the log write and any later dispute use what was billed, not what the sheet looks like now. `csv` is the QuickBooks file stored WITHOUT the BOM (the BOM is added at download). Reusing a cancelled number is allowed; the old state is pushed onto `history[]`. `logWritten` / `logError` / `logWrittenAt` track the Master Job Log write (retryable from Recent invoices). Rules transitions live in `HQ/firestore.rules`: `number`, `createdAt`, `createdBy` are immutable; an `imported` invoice is frozen except the PO and the log flags; never delete.

**Board query:** `Storage.onSheetsChange`/`loadSheets` read `where('finished','==',false)` once `settings/migrations.sheetsFinishedFlag.done` is true (Settings › Maintenance), the whole collection before; finished docs are also dropped client-side. No `orderBy` — sorted client-side by `uploadedAt` (a query orderBy drops docs missing the field, and where+orderBy on different fields needs a composite index).

**Export:** in a real-database session, export refuses to finish a job when the Master Job Log endpoint is unconfigured (offline success only counts in PASTE mode). Everyone (Collin included) lands on the Projects screen even when the board is empty — its header holds To Print, so a queued sticker is reachable with no jobs loaded; an empty board shows "No jobs loaded." + one line a day from `EMPTY_BOARD_LINES` in app.js.
- **Sheet ordering** — `getDisplaySheets()` / `compareSheets` (thickest first on the board); Export CSV, billing, job-details and notes keep plain `compareSheets` order. Detail: docs/file-guide.md (Architecture).
- **Project grouping** — `Keys.jobOf(sheet)` = `sheet.jobName || sheet.fileName || 'Unknown Job'`; `getProjectGroups()` buckets all loaded sheets by that key for the directory screen.
- **3-state completion** — no record = Incomplete; `{status:'in-progress'}` = In Progress; `{status:'complete', completedAt, operator, notes}` = Complete. Driven by `applySheetCompletion()` (app.js ~line 1286); clicking the action button advances the state, the modal only appears for the In Progress → Complete transition.
- `buildSheetDetail()` / `buildSheetNavRow()` panel order, and **Dark mode** (`localStorage['cnc::darkMode']`, local-only on purpose): docs/file-guide.md (Architecture).

## VCarve HTML format (source files)
Moved to docs/file-guide.md — the selectors parseJobSheet reads and the SVG viewBox.

## Key technical decisions
Moved to docs/file-guide.md — SVG stripping/stroke/size, the SVG try-catch in buildSheetDetail, the project-card long-name wrap fix.

## Where the status lives

**Current status, shipped features and history are in the vault note** `Brain\Projects\CNC Job Tracker.md`, not here. A rules file that accumulates status goes stale and stops being trusted — this section used to hold a feature inventory frozen at 2026-07-17.

## Operators configured in modal
- Collin (default)
- Travis
- Other... (free-text input)

## Sample test files
Moved to docs/file-guide.md — the tracked root sample file and the gitignored `samples/` folder.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
