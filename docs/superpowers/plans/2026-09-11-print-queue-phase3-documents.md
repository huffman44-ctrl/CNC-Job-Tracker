`# Print Queue — Phase 3 (documents) Implementation Plan
`
`> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
`
`**Goal:** Travis drops a PDF (typically a 4x6 shipping label) onto the To Print panel; the app reads its page size itself, uploads it to Drive through the existing Apps Script endpoint, and queues it; Collin prints it from the same list with the size in the PDF title.
`
`**Architecture:** One new pure module `js/doc-info.js` (PDF header check, page-size detection, title string) using the vendored pdf-lib; `js/endpoint.js` gains a per-call timeout and two actions (`uploadDoc`, `getDoc`); the Apps Script gains the matching two actions plus a self-created Drive folder; `js/storage.js` records `pages`; `js/app.js` gains a document branch in the row/Print code and a "+ Send a document" builder with a drop zone. No new services.
`
`**Tech Stack:** Vanilla JS (IIFE modules), pdf-lib (vendored, already on the page), Firestore compat, Google Apps Script (DriveApp, PropertiesService, LockService), `node --test`.
`
`**Spec:** `docs/superpowers/specs/2026-09-10-print-queue-design.md` — implement the **"Phase 3 amendment (2026-09-11) — documents"** section at the end. Where it disagrees with the older Phase 3 text above it, the amendment wins.
`
`## Global Constraints
`
`- **Branch:** all work on `print-queue-docs`, cut from `master` at `6fe3646`. `master` is a live GitHub Pages deploy; nothing is pushed to it by this plan.
`- **Never run the app against the real Firestore or the live endpoint.** Browser checks run from a temp copy with `projectId: "PASTE_DISABLED"` (Firebase off) and `ENDPOINT_CONFIG.url` left as `PASTE…` (endpoint off), with `Endpoint.uploadDoc` / `Endpoint.getDoc` / `Auth.getIdToken` stubbed on the page.
`- **Do not change existing behaviour:** `Endpoint.post` keeps a 20 000 ms default timeout for every existing caller; `buildStickerPdf` is untouched; sticker rows and the "+ New batch" builder behave exactly as in Phase 1; the VanLab panel is untouched; the `archiveSheet` / `appendRows` guard status is unchanged.
`- **Document sizes:** only `4x6` and `letter`. Auto-detect from the first page, either orientation, **±3 pt**: 288×432 → `4x6`, 612×792 → `letter`, anything else → picker. **PDF only**, checked by the `%PDF-` header, not the extension. **10 MB** cap client-side (`file.size`) and server-side (base64 length > 14 000 000 chars).
`- **Printer names in the button:** `4x6` → `CRATE LABEL 4x6`; `letter` → `letter printer`. Hint line stays `100% scale · margins none`.
`- **Title guard string:** `DocInfo.title(fileName, size, pages)` → `cut-list.pdf · 4x6 · 8 pages` (`1 page` singular). Stamped into the fetched PDF client-side before it opens; if pdf-lib cannot re-open the bytes, open them untitled rather than fail.
`- **Timeouts:** `uploadDoc` and `getDoc` use **120 000 ms**.
`- **Drive folder:** the script creates `CNC Print Queue` in the executing account's My Drive on first upload and stores its id in script property `PRINT_QUEUE_FOLDER_ID`. `getDoc` returns a file only if one of its parents is that folder.
`- **Both new Apps Script actions verify the Firebase ID token (and `ALLOWED_UIDS`) before touching Drive**, exactly like `getPackingPdf`.
`- **A drop on the panel must not reach the page-wide drop handler** (`document.body` `drop` in `app.js` ~line 130 treats any file dropped on the Projects screen as a job-sheet upload). The panel handler calls `e.stopPropagation()`.
`- **Operator spelling:** `Collin`.
`- **Cache-busting:** bump `?v=` in `index.html` for every changed JS **and CSS** file, and add the new script tag for `js/doc-info.js` after `js/sticker-pdf.js`.
`- **Live script deploy is manual and Travis's** (Task 6 writes the instructions): merge the new functions into the live script, never paste the repo file over it (`ALLOWED_UIDS` and the real ids live only in the live copy), then publish a new deployment version.
`
`---
`
`## File map
`
`| File | Change | Responsibility |
`|---|---|---|
`| `js/doc-info.js` | create | `isPdf`, `sizeFor`, `inspectPdf`, `title`. Pure; needs the `PDFLib` global. |
`| `test/doc-info.test.mjs` | create | Coverage, building PDFs with pdf-lib in a vm like `test/sticker-pdf.test.mjs`. |
`| `js/endpoint.js` | modify | `post(payload, opts)` timeout option; `uploadDoc`, `getDoc`. |
`| `test/endpoint-doc.test.mjs` | create | The two actions post the right fields, honour the 120 s timeout, existing calls keep 20 s. |
`| `apps-script/logging-endpoint.gs` | modify | `printQueueFolder`, `uploadDoc`, `getDoc`, two dispatch lines. |
`| `test/print-queue-docs-endpoint.test.mjs` | create | Fakes for Drive/Properties/Lock/Utilities; token gate; folder-once; PDF/size checks; parent-folder guard. |
`| `js/storage.js` | modify | `addPrintItem` records `pages`. |
`| `test/storage-print-queue.test.mjs` | modify | `pages` round-trips. |
`| `js/app.js` | modify | `PQ_SIZES.letter`; document branch in `renderPrintQueue`/`pqPrint`; `pqPrintDocument`; "+ Send a document" builder. |
`| `index.html` | modify | Builder markup; script tag; version bumps. |
`| `css/style.css` | modify | `.pq-drop*`, `.pq-doc-staged`. |
`| `CLAUDE.md`, spec status line, vault note | modify | Docs + Travis's redeploy checklist (Task 6). |
`
`---
`
`### Task 0: Branch
`
`- [ ] From `master` at `6fe3646` (verify with `git log --oneline -1`): `git checkout -b print-queue-docs`. Working tree must be clean (`git status --short` empty). No commit.
`
`---
`
`### Task 1: `js/doc-info.js`
`
`**Files:**
`- Create: `js/doc-info.js`
`- Create: `test/doc-info.test.mjs`
`
`**Interfaces:**
`- Produces (browser global `DocInfo`, plus `module.exports` shim):
`  - `DocInfo.isPdf(bytes: Uint8Array) → boolean` — first five bytes are `%PDF-`.
`  - `DocInfo.sizeFor(width: number, height: number) → '4x6' | 'letter' | null`.
`  - `DocInfo.inspectPdf(bytes: Uint8Array) → Promise<{ pages, width, height }>` — rejects if pdf-lib can't open it or it has no pages.
`  - `DocInfo.title(fileName, size, pages) → string`.
`  - `DocInfo.TOLERANCE` = `3`.
`
`- [ ] **Step 1: Write the failing tests**
`
``test/doc-info.test.mjs`:
`
````js
`import { test } from 'node:test';
`import assert from 'node:assert/strict';
`import { readFileSync } from 'node:fs';
`import vm from 'node:vm';
`import { fileURLToPath } from 'node:url';
`import { dirname, join } from 'node:path';
`
`const root = join(dirname(fileURLToPath(import.meta.url)), '..');
`const read = (p) => readFileSync(join(root, p), 'utf8');
`
`// Same sandbox recipe as test/sticker-pdf.test.mjs: pdf-lib defines the
`// PDFLib global, then doc-info.js reads it.
`function load() {
`  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array };
`  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
`  vm.createContext(ctx);
`  vm.runInContext(read('js/vendor/pdf-lib.min.js'), ctx);
`  vm.runInContext(read('js/doc-info.js') + '\nthis.DocInfo = DocInfo;', ctx);
`  return ctx;
`}
`
`async function makePdf(ctx, pageCount, w, h) {
`  const doc = await ctx.PDFLib.PDFDocument.create();
`  for (let i = 0; i < pageCount; i++) doc.addPage([w, h]);
`  return doc.save({ useObjectStreams: false });
`}
`
`test('sizeFor: 4x6 either way round, within 3pt', () => {
`  const { DocInfo } = load();
`  assert.equal(DocInfo.sizeFor(288, 432), '4x6');
`  assert.equal(DocInfo.sizeFor(432, 288), '4x6');
`  assert.equal(DocInfo.sizeFor(290.5, 429), '4x6');
`  assert.equal(DocInfo.sizeFor(292, 432), null, '4pt off is not 4x6');
`});
`
`test('sizeFor: letter either way round; A4 and odd sizes are null', () => {
`  const { DocInfo } = load();
`  assert.equal(DocInfo.sizeFor(612, 792), 'letter');
`  assert.equal(DocInfo.sizeFor(792, 612), 'letter');
`  assert.equal(DocInfo.sizeFor(595.28, 841.89), null, 'A4');
`  assert.equal(DocInfo.sizeFor(216, 72), null, '3x1 is a sticker, not a document size');
`  assert.equal(DocInfo.TOLERANCE, 3);
`});
`
`test('isPdf checks the %PDF- header, not the name', () => {
`  const { DocInfo } = load();
`  assert.equal(DocInfo.isPdf(new TextEncoder().encode('%PDF-1.7 junk')), true);
`  assert.equal(DocInfo.isPdf(new TextEncoder().encode('<html>')), false);
`  assert.equal(DocInfo.isPdf(new Uint8Array(0)), false);
`  assert.equal(DocInfo.isPdf(null), false);
`});
`
`test('inspectPdf reports page count and first-page size', async () => {
`  const ctx = load();
`  const bytes = await makePdf(ctx, 3, 288, 432);
`  const info = await ctx.DocInfo.inspectPdf(bytes);
`  assert.equal(info.pages, 3);
`  assert.equal(Math.round(info.width), 288);
`  assert.equal(Math.round(info.height), 432);
`});
`
`test('inspectPdf rejects bytes pdf-lib cannot open', async () => {
`  const ctx = load();
`  await assert.rejects(() => ctx.DocInfo.inspectPdf(new TextEncoder().encode('%PDF-1.4 but not really')));
`});
`
`test('title pluralises pages', () => {
`  const { DocInfo } = load();
`  assert.equal(DocInfo.title('cut-list.pdf', '4x6', 8), 'cut-list.pdf · 4x6 · 8 pages');
`  assert.equal(DocInfo.title('label.pdf', 'letter', 1), 'label.pdf · letter · 1 page');
`});
````
`
`- [ ] **Step 2: Run to verify it fails**
`
`Run: `node --test test/doc-info.test.mjs`
`Expected: FAIL — `ENOENT … js/doc-info.js`.
`
`- [ ] **Step 3: Implement**
`
``js/doc-info.js`:
`
````js
`/**
` * Print-queue document inspection: is this a PDF, what size is its first page,
` * how many pages, and the title string that guards against the wrong printer.
` * Pure apart from the PDFLib global (js/vendor/pdf-lib.min.js), so it runs
` * under node --test in a vm the same way sticker-pdf.js does.
` * Spec: docs/superpowers/specs/2026-09-10-print-queue-design.md § Phase 3 amendment.
` */
`const DocInfo = (() => {
`  const TOLERANCE = 3;   // points; scanners and label generators are rarely exact
`  const SIZES = { '4x6': [4 * 72, 6 * 72], 'letter': [8.5 * 72, 11 * 72] };
`  const near = (a, b) => Math.abs(a - b) <= TOLERANCE;
`
`  // Either orientation counts: a rotated label is still a 4x6 label.
`  function sizeFor(width, height) {
`    for (const [name, [w, h]] of Object.entries(SIZES)) {
`      if ((near(width, w) && near(height, h)) || (near(width, h) && near(height, w))) return name;
`    }
`    return null;
`  }
`
`  function isPdf(bytes) {
`    if (!bytes || bytes.length < 5) return false;
`    // '%PDF-'
`    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
`  }
`
`  async function inspectPdf(bytes) {
`    // ignoreEncryption stays false: an encrypted PDF should be refused at
`    // staging with a clear message, not queued and then fail on the shop PC.
`    const doc = await PDFLib.PDFDocument.load(bytes);
`    const pages = doc.getPageCount();
`    if (!pages) throw new Error('the PDF has no pages');
`    const { width, height } = doc.getPage(0).getSize();
`    return { pages, width, height };
`  }
`
`  function title(fileName, size, pages) {
`    return `${fileName} · ${size} · ${pages} page${pages === 1 ? '' : 's'}`;
`  }
`
`  return { isPdf, sizeFor, inspectPdf, title, TOLERANCE };
`})();
`
`if (typeof module !== 'undefined' && module.exports) module.exports = DocInfo;
````
`
`- [ ] **Step 4: Run to verify it passes**
`
`Run: `node --test test/doc-info.test.mjs` — 6 passing. Then `npm test` — all passing (136 + 6).
`
`- [ ] **Step 5: Commit**
`
````bash
`git add js/doc-info.js test/doc-info.test.mjs
`git commit -m "feat(print-queue): doc-info — PDF header check, 4x6/letter page-size detection, title string
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`---
`
`### Task 2: `js/endpoint.js` — timeout option, `uploadDoc`, `getDoc`
`
`**Files:**
`- Modify: `js/endpoint.js` (whole file is ~60 lines)
`- Create: `test/endpoint-doc.test.mjs`
`
`**Interfaces:**
`- Produces:
`  - `Endpoint.post(payload, opts = {})` — `opts.timeoutMs` (default `20000`). Internal, but the test observes it via the `AbortSignal.timeout` fake.
`  - `Endpoint.uploadDoc(fileName, base64, idToken) → Promise<string fileId | null>` (`null` when not configured).
`  - `Endpoint.getDoc(fileId, idToken) → Promise<string base64 | null>`.
`  - `Endpoint.DOC_TIMEOUT_MS` = `120000`.
`
`- [ ] **Step 1: Write the failing tests**
`
``test/endpoint-doc.test.mjs`:
`
````js
`import { test } from 'node:test';
`import assert from 'node:assert/strict';
`import { readFileSync } from 'node:fs';
`import vm from 'node:vm';
`import { fileURLToPath } from 'node:url';
`import { dirname, join } from 'node:path';
`
`const source = readFileSync(
`  join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'),
`  'utf8'
`);
`
`// Same recipe as test/endpoint-packing.test.mjs, plus an AbortSignal fake
`// that records the timeout each call asked for.
`function loadEndpoint({ config, fetchImpl }) {
`  const calls = [];
`  const timeouts = [];
`  const sandbox = {
`    ENDPOINT_CONFIG: config,
`    fetch: async (url, opts) => { calls.push({ url, opts }); return fetchImpl(); },
`    AbortSignal: { timeout: (ms) => { timeouts.push(ms); return undefined; } },
`  };
`  const Endpoint = vm.runInNewContext(source + ';Endpoint', sandbox);
`  return { Endpoint, calls, timeouts };
`}
`
`const LIVE = { url: 'https://example.test/exec', token: 'JUNKTOKEN' };
`const ok = (body) => async () => ({ json: async () => ({ ok: true, ...body }) });
`
`test('uploadDoc posts action, fileName, base64, idToken with the 120 s timeout', async () => {
`  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ fileId: 'FILE1' }) });
`  const got = await Endpoint.uploadDoc('cut-list.pdf', 'JVBERi0=', 'IDTOKEN1');
`  assert.equal(got, 'FILE1');
`  const sent = JSON.parse(calls[0].opts.body);
`  assert.deepEqual(
`    { action: sent.action, fileName: sent.fileName, base64: sent.base64, idToken: sent.idToken, token: sent.token },
`    { action: 'uploadDoc', fileName: 'cut-list.pdf', base64: 'JVBERi0=', idToken: 'IDTOKEN1', token: 'JUNKTOKEN' });
`  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
`  assert.deepEqual(timeouts, [120000]);
`  assert.equal(Endpoint.DOC_TIMEOUT_MS, 120000);
`});
`
`test('getDoc posts action, fileId, idToken with the 120 s timeout and returns pdfBase64', async () => {
`  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ pdfBase64: 'QUJD' }) });
`  assert.equal(await Endpoint.getDoc('FILE1', 'IDTOKEN1'), 'QUJD');
`  const sent = JSON.parse(calls[0].opts.body);
`  assert.equal(sent.action, 'getDoc');
`  assert.equal(sent.fileId, 'FILE1');
`  assert.equal(sent.idToken, 'IDTOKEN1');
`  assert.deepEqual(timeouts, [120000]);
`});
`
`test('existing calls keep the 20 s default timeout', async () => {
`  const { Endpoint, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ pdfBase64: 'QUJD', order: {} }) });
`  await Endpoint.getPackingPdf('x.pdf', 'T');
`  await Endpoint.lookupOrder('1206', 'T');
`  assert.deepEqual(timeouts, [20000, 20000]);
`});
`
`test('server rejection surfaces as endpointError for both actions', async () => {
`  const { Endpoint } = loadEndpoint({
`    config: LIVE,
`    fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'not a print-queue file' }) }),
`  });
`  await assert.rejects(() => Endpoint.getDoc('X', 'T'), (err) => err.endpointError === true && err.message === 'not a print-queue file');
`  await assert.rejects(() => Endpoint.uploadDoc('a.pdf', 'AA==', 'T'), (err) => err.endpointError === true);
`});
`
`test('unconfigured endpoint returns null without fetching', async () => {
`  const { Endpoint, calls } = loadEndpoint({ config: { url: 'PASTE_URL', token: 'x' }, fetchImpl: ok({}) });
`  assert.equal(await Endpoint.uploadDoc('a.pdf', 'AA==', 'T'), null);
`  assert.equal(await Endpoint.getDoc('X', 'T'), null);
`  assert.equal(calls.length, 0);
`});
````
`
`- [ ] **Step 2: Run to verify it fails**
`
`Run: `node --test test/endpoint-doc.test.mjs`
`Expected: FAIL — `Endpoint.uploadDoc is not a function`.
`
`- [ ] **Step 3: Implement**
`
`In `js/endpoint.js`, change `post` and add the two actions:
`
````js
`  const DEFAULT_TIMEOUT_MS = 20000;
`  // 10 MB of base64 each way over shop wifi does not fit in 20 s.
`  const DOC_TIMEOUT_MS = 120000;
`
`  async function post(payload, opts = {}) {
`    const res = await fetch(ENDPOINT_CONFIG.url, {
`      method: 'POST',
`      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
`      body: JSON.stringify({ token: ENDPOINT_CONFIG.token, ...payload }),
`      redirect: 'follow',
`      signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
`    });
`    const data = await res.json();
`    if (!data.ok) {
`      // The server answered — its message is the real reason, and callers
`      // (exportJob's alert) distinguish this from a network failure.
`      const err = new Error(data.error || 'endpoint error');
`      err.endpointError = true;
`      throw err;
`    }
`    return data;
`  }
````
`
`(keep everything else in `post` exactly as it is — only the `signal` line and the signature change), then after `getPackingPdf`:
`
````js
`  // Print-queue documents. Both actions carry the Firebase ID token; the
`  // Apps Script verifies it before touching Drive.
`  async function uploadDoc(fileName, base64, idToken) {
`    if (!enabled()) return null;
`    const data = await post({ action: 'uploadDoc', fileName, base64, idToken }, { timeoutMs: DOC_TIMEOUT_MS });
`    return data.fileId;
`  }
`
`  async function getDoc(fileId, idToken) {
`    if (!enabled()) return null;
`    const data = await post({ action: 'getDoc', fileId, idToken }, { timeoutMs: DOC_TIMEOUT_MS });
`    return data.pdfBase64;
`  }
`
`  return { enabled, archiveSheet, appendLogRows, lookupOrder, getPackingPdf, uploadDoc, getDoc, DOC_TIMEOUT_MS };
````
`
`- [ ] **Step 4: Run to verify it passes**
`
`Run: `node --test test/endpoint-doc.test.mjs` — 5 passing. `npm test` — all passing (the other `endpoint-*.test.mjs` files must be unaffected).
`
`- [ ] **Step 5: Commit**
`
````bash
`git add js/endpoint.js test/endpoint-doc.test.mjs
`git commit -m "feat(endpoint): uploadDoc/getDoc with a 120 s timeout; per-call timeout option
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`---
`
`### Task 3: Apps Script — `uploadDoc`, `getDoc`, self-created folder
`
`**Files:**
`- Modify: `apps-script/logging-endpoint.gs` — dispatch in `doPost` (~line 40-44); new functions after `getPackingPdf` (~line 222), before `verifyFirebaseIdToken`.
`- Create: `test/print-queue-docs-endpoint.test.mjs`
`
`**Interfaces:**
`- Produces (Apps Script, reached via `doPost` `action`):
`  - `uploadDoc({ fileName, base64, idToken }) → { ok:true, fileId } | { ok:false, error }`
`  - `getDoc({ fileId, idToken }) → { ok:true, pdfBase64 } | { ok:false, error }`
`  - `printQueueFolder() → Folder` (internal)
`
`- [ ] **Step 1: Write the failing tests**
`
``test/print-queue-docs-endpoint.test.mjs`:
`
````js
`import { test } from 'node:test';
`import assert from 'node:assert/strict';
`import { readFileSync } from 'node:fs';
`import vm from 'node:vm';
`import { fileURLToPath } from 'node:url';
`import { dirname, join } from 'node:path';
`
`let source = readFileSync(
`  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
`  'utf8'
`);
`source = source.replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");
`
`const PDF_B64 = Buffer.from('%PDF-1.4 hello').toString('base64');
`const HTML_B64 = Buffer.from('<html>nope</html>').toString('base64');
`const plain = (v) => JSON.parse(JSON.stringify(v));
`
`// Fakes for the Apps Script services the two actions touch. `state` lets a
`// test see what Drive and the script properties ended up holding.
`function makeContext({ tokenValid = true, storedFolderId = null, files = {} } = {}) {
`  const state = { props: {}, files: { ...files }, folderCreates: 0, driveTouched: false };
`  if (storedFolderId) state.props.PRINT_QUEUE_FOLDER_ID = storedFolderId;
`  const folder = (id) => ({
`    getId: () => id,
`    createFile(blob) {
`      state.driveTouched = true;
`      const fid = 'FILE' + (Object.keys(state.files).length + 1);
`      state.files[fid] = { parent: id, bytes: blob.bytes, mime: blob.mime, name: blob.name };
`      return { getId: () => fid };
`    },
`  });
`  const sandbox = {
`    PropertiesService: { getScriptProperties: () => ({
`      getProperty: (k) => state.props[k] || null,
`      setProperty: (k, v) => { state.props[k] = v; },
`    }) },
`    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
`    DriveApp: {
`      createFolder(name) { state.driveTouched = true; state.folderCreates++; assert.equal(name, 'CNC Print Queue'); return folder('NEWFOLDER'); },
`      getFolderById(id) { state.driveTouched = true; return folder(id); },
`      getFileById(id) {
`        state.driveTouched = true;
`        const f = state.files[id];
`        if (!f) throw new Error('File not found: ' + id);
`        return {
`          getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => f.parent }; } }; },
`          getBlob: () => ({ getBytes: () => f.bytes }),
`        };
`      },
`    },
`    Utilities: {
`      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
`      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
`      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
`    },
`    UrlFetchApp: {
`      fetch(url, opts) {
`        assert.ok(url.includes('identitytoolkit.googleapis.com'));
`        return {
`          getResponseCode() { return tokenValid ? 200 : 400; },
`          getContentText() { return tokenValid ? JSON.stringify({ users: [{ localId: 'uid1' }] }) : '{}'; },
`        };
`      },
`    },
`  };
`  vm.runInNewContext(source, sandbox);
`  return { ctx: sandbox, state };
`}
`
`test('uploadDoc: valid PDF lands in the folder and returns its id', () => {
`  const { ctx, state } = makeContext();
`  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'cut-list.pdf', base64: PDF_B64 });
`  assert.deepEqual(plain(r), { ok: true, fileId: 'FILE1' });
`  assert.equal(state.files.FILE1.parent, 'NEWFOLDER');
`  assert.equal(state.files.FILE1.mime, 'application/pdf');
`  assert.equal(state.files.FILE1.name, 'cut-list.pdf');
`});
`
`test('uploadDoc: folder is created once and remembered in script properties', () => {
`  const { ctx, state } = makeContext();
`  ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 });
`  ctx.uploadDoc({ idToken: 'T', fileName: 'b.pdf', base64: PDF_B64 });
`  assert.equal(state.folderCreates, 1);
`  assert.equal(state.props.PRINT_QUEUE_FOLDER_ID, 'NEWFOLDER');
`});
`
`test('uploadDoc: a stored folder id is reused, nothing is created', () => {
`  const { ctx, state } = makeContext({ storedFolderId: 'OLDFOLDER' });
`  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 });
`  assert.equal(r.ok, true);
`  assert.equal(state.folderCreates, 0);
`  assert.equal(state.files.FILE1.parent, 'OLDFOLDER');
`});
`
`test('uploadDoc: non-PDF bytes are refused by header, not by name', () => {
`  const { ctx, state } = makeContext();
`  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'looks-like.pdf', base64: HTML_B64 });
`  assert.equal(r.ok, false);
`  assert.match(r.error, /isn't a PDF/);
`  assert.deepEqual(state.files, {});
`});
`
`test('uploadDoc: over the 10 MB cap is refused before decoding', () => {
`  const { ctx, state } = makeContext();
`  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'big.pdf', base64: 'A'.repeat(14000001) });
`  assert.equal(r.ok, false);
`  assert.match(r.error, /10 MB/);
`  assert.deepEqual(state.files, {});
`});
`
`test('uploadDoc: missing fields are rejected', () => {
`  const { ctx } = makeContext();
`  assert.equal(ctx.uploadDoc({ idToken: 'T', fileName: '', base64: PDF_B64 }).ok, false);
`  assert.equal(ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: '' }).ok, false);
`});
`
`test('uploadDoc and getDoc: bad sign-in is rejected before Drive is touched', () => {
`  const a = makeContext({ tokenValid: false });
`  assert.deepEqual(plain(a.ctx.uploadDoc({ idToken: 'BAD', fileName: 'a.pdf', base64: PDF_B64 })), { ok: false, error: 'sign-in rejected' });
`  assert.equal(a.state.driveTouched, false);
`  const b = makeContext({ tokenValid: false, storedFolderId: 'F', files: { FILE1: { parent: 'F', bytes: [1] } } });
`  assert.deepEqual(plain(b.ctx.getDoc({ idToken: 'BAD', fileId: 'FILE1' })), { ok: false, error: 'sign-in rejected' });
`  assert.equal(b.state.driveTouched, false);
`  assert.deepEqual(plain(a.ctx.uploadDoc({ fileName: 'a.pdf', base64: PDF_B64 })), { ok: false, error: 'missing idToken' });
`});
`
`test('getDoc: a file in the print-queue folder comes back as base64', () => {
`  const bytes = Array.from(Buffer.from('%PDF-1.4 hello'));
`  const { ctx } = makeContext({ storedFolderId: 'F', files: { FILE1: { parent: 'F', bytes } } });
`  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'FILE1' })), { ok: true, pdfBase64: PDF_B64 });
`});
`
`test('getDoc: a file outside the folder is refused; unknown ids and missing fileId are clear errors', () => {
`  const { ctx } = makeContext({ storedFolderId: 'F', files: { ELSEWHERE: { parent: 'SOMEOTHER', bytes: [1] } } });
`  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'ELSEWHERE' })), { ok: false, error: 'not a print-queue file' });
`  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'NOPE' })), { ok: false, error: 'document not found' });
`  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: '' })), { ok: false, error: 'missing fileId' });
`});
`
`test('doPost dispatches both actions', () => {
`  const { ctx } = makeContext({ storedFolderId: 'F' });
`  ctx.ContentService = { createTextOutput: (s) => ({ setMimeType() { return { text: s }; } }), MimeType: { JSON: 'json' } };
`  const src2 = source.replace("'PASTE_TOKEN'", "'TOK'");
`  vm.runInNewContext(src2, ctx);
`  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', ...body }) } }).text);
`  assert.equal(call({ action: 'uploadDoc', idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 }).ok, true);
`  assert.equal(call({ action: 'getDoc', idToken: 'T', fileId: 'FILE1' }).ok, true);
`});
````
`
`- [ ] **Step 2: Run to verify it fails**
`
`Run: `node --test test/print-queue-docs-endpoint.test.mjs`
`Expected: FAIL — `ctx.uploadDoc is not a function`.
`
`- [ ] **Step 3: Implement**
`
`In `doPost`, after the `getPackingPdf` dispatch line add:
`
````js
`    if (body.action === 'uploadDoc')   return jsonOut(uploadDoc(body));
`    if (body.action === 'getDoc')      return jsonOut(getDoc(body));
````
`
`After `getPackingPdf` (before `verifyFirebaseIdToken`) add:
`
````js
`/**
` * Print-queue documents (the Job Tracker's "To Print" panel). Files live in
` * one Drive folder this script creates on first use and remembers in a script
` * property — nothing to paste. Both actions verify the Firebase ID token
` * before touching Drive, like getPackingPdf. getDoc only serves files whose
` * parent is that folder: the script runs as the owner, so without that guard
` * any allowlisted user could pull any file id in the owner's Drive.
` */
`const PRINT_QUEUE_FOLDER_NAME = 'CNC Print Queue';
`const PRINT_QUEUE_FOLDER_PROP = 'PRINT_QUEUE_FOLDER_ID';
`const DOC_MAX_BASE64_CHARS    = 14000000;   // ≈10 MB decoded — the same cap the client enforces
`
`function printQueueFolder() {
`  const props = PropertiesService.getScriptProperties();
`  let id = props.getProperty(PRINT_QUEUE_FOLDER_PROP);
`  if (id) return DriveApp.getFolderById(id);
`  // Same lock pattern as archiveSheet: only the create step races.
`  const lock = LockService.getScriptLock();
`  try {
`    lock.waitLock(30000);
`    id = props.getProperty(PRINT_QUEUE_FOLDER_PROP);   // re-check under the lock
`    if (!id) {
`      const folder = DriveApp.createFolder(PRINT_QUEUE_FOLDER_NAME);
`      props.setProperty(PRINT_QUEUE_FOLDER_PROP, folder.getId());
`      return folder;
`    }
`  } finally {
`    try { lock.releaseLock(); } catch (_) {}
`  }
`  return DriveApp.getFolderById(id);
`}
`
`function uploadDoc(body) {
`  if (FIREBASE_API_KEY.startsWith('PASTE')) {
`    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
`  }
`  const auth = verifyFirebaseIdToken(body.idToken);
`  if (!auth.ok) return auth;
`  const fileName = String(body.fileName == null ? '' : body.fileName).trim();
`  const base64   = String(body.base64 == null ? '' : body.base64);
`  if (!fileName || !base64) return { ok: false, error: 'missing fileName or base64' };
`  if (base64.length > DOC_MAX_BASE64_CHARS) return { ok: false, error: fileName + ' is over the 10 MB limit' };
`  const bytes = Utilities.base64Decode(base64);
`  // Apps Script bytes are signed (-128..127); mask before comparing.
`  const head = bytes.slice(0, 5).map(function (b) { return String.fromCharCode(b & 0xff); }).join('');
`  if (head !== '%PDF-') return { ok: false, error: fileName + " isn't a PDF" };
`  const file = printQueueFolder().createFile(Utilities.newBlob(bytes, 'application/pdf', fileName));
`  return { ok: true, fileId: file.getId() };
`}
`
`function getDoc(body) {
`  if (FIREBASE_API_KEY.startsWith('PASTE')) {
`    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
`  }
`  const auth = verifyFirebaseIdToken(body.idToken);
`  if (!auth.ok) return auth;
`  const fileId = String(body.fileId == null ? '' : body.fileId).trim();
`  if (!fileId) return { ok: false, error: 'missing fileId' };
`  const folderId = printQueueFolder().getId();
`  let file;
`  try { file = DriveApp.getFileById(fileId); } catch (e) { return { ok: false, error: 'document not found' }; }
`  const parents = file.getParents();
`  let inFolder = false;
`  while (parents.hasNext()) {
`    if (parents.next().getId() === folderId) { inFolder = true; break; }
`  }
`  if (!inFolder) return { ok: false, error: 'not a print-queue file' };
`  return { ok: true, pdfBase64: Utilities.base64Encode(file.getBlob().getBytes()) };
`}
````
`
`Also update the file's header comment (lines 1-6) to add one line: ` * Print-queue documents (uploadDoc/getDoc) need no constants — the folder is self-created.`
`
`- [ ] **Step 4: Run to verify it passes**
`
`Run: `node --test test/print-queue-docs-endpoint.test.mjs` — 10 passing. `npm test` — all passing (`test/logging-endpoint.test.mjs`, `get-packing-pdf`, `lookup-order` load the same `.gs` and must be unaffected).
`
`- [ ] **Step 5: Commit**
`
````bash
`git add apps-script/logging-endpoint.gs test/print-queue-docs-endpoint.test.mjs
`git commit -m "feat(apps-script): uploadDoc/getDoc for print-queue documents; self-created Drive folder; parent-folder guard
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`---
`
`### Task 4: Collin's side — document rows and Print, plus `pages` in storage
`
`**Files:**
`- Modify: `js/storage.js` — `addPrintItem` record (the `fileName:  item.fileName || null,` line).
`- Modify: `test/storage-print-queue.test.mjs` — one test.
`- Modify: `js/app.js` — `PQ_SIZES`, `renderPrintQueue`, `pqPrint`; new `pqPrintDocument`.
`- Modify: `index.html` — add `<script src="js/doc-info.js?v=1"></script>` after the `sticker-pdf.js` tag; bump `storage.js` → `?v=14`, `endpoint.js` → `?v=4`, `app.js` → `?v=30`.
`
`**Interfaces:**
`- Consumes: `DocInfo.title` (Task 1), `Endpoint.getDoc` (Task 2), `Auth.getIdToken` (existing), `PDFLib` (vendored).
`- Produces: `PQ_SIZES.letter = { printer: 'letter printer' }`; `pqPrintDocument(item, button)`; rows render for `kind: 'document'`.
`
`- [ ] **Step 1: Storage test + change**
`
`Append to `test/storage-print-queue.test.mjs` **before** the last test (the one that calls `Storage.init`):
`
````js
`test('addPrintItem records pages for documents and null for stickers', async () => {
`  const docId = await Storage.addPrintItem({ kind: 'document', fileId: 'F1', fileName: 'cut-list.pdf', pages: 8, size: '4x6', lines: [] });
`  const doc = Storage.getPrintQueue().find(i => i.id === docId);
`  assert.equal(doc.kind, 'document');
`  assert.equal(doc.pages, 8);
`  assert.equal(doc.fileId, 'F1');
`  assert.equal(doc.fileName, 'cut-list.pdf');
`  assert.deepEqual(doc.lines, []);
`  const stId = await Storage.addPrintItem(batch(['ED1']));
`  assert.equal(Storage.getPrintQueue().find(i => i.id === stId).pages, null);
`});
````
`
`Run `node --test test/storage-print-queue.test.mjs` — the new test fails (`pages` undefined). Then in `js/storage.js` `addPrintItem`, after the `fileName:` line add:
`
````js
`      pages:     Number.isInteger(item.pages) ? item.pages : null,
````
`
`Re-run — passing.
`
`- [ ] **Step 2: `PQ_SIZES`**
`
````js
`const PQ_SIZES = {
`  '3x1':    { width: 3 * 72, height: 1 * 72, startSize: 60,  printer: 'STICKERS 1x3' },
`  '4x6':    { width: 4 * 72, height: 6 * 72, startSize: 140, printer: 'CRATE LABEL 4x6' },
`  'letter': { printer: 'letter printer' },   // documents only — never rendered by buildStickerPdf
`};
````
`
`- [ ] **Step 3: Rows**
`
`In `renderPrintQueue`, replace the body of the `items.map(item => { … })` callback with:
`
````js
`    const spec = PQ_SIZES[item.size];
`    const isDoc = item.kind === 'document';
`    const count = isDoc ? (item.pages || 0) : item.lines.length;
`    const unit = isDoc ? 'page' : 'sticker';
`    const countText = `${count} ${unit}${count !== 1 ? 's' : ''}`;
`    const what = isDoc ? (item.fileName || 'document') : Sequence.rangeLabel(item.lines);
`    const when = item.createdAt ? formatDT(new Date(item.createdAt)) : '';
`    const printedNote = item.printedAt ? ` · printed ${formatDT(new Date(item.printedAt))}` : '';
`    return `
`      <div class="pq-row" data-id="${escHtml(item.id)}">
`        <div class="pq-row-main">
`          <span class="pq-row-what">${escHtml(what)}</span>
`          <span class="pq-row-meta">${countText} · ${escHtml(item.size)}${item.jobName ? ' · ' + escHtml(item.jobName) : ''} · ${escHtml(pqDisplayName(item.createdBy))} · ${escHtml(when)}${printedNote}</span>
`        </div>
`        <div class="pq-row-actions">
`          <div>
`            <button class="btn btn-primary btn-sm" data-action="print">Print ${countText} → ${escHtml(spec ? spec.printer : item.size)}</button>
`            <div class="pq-row-hint">100% scale · margins none</div>
`          </div>
`          ${item.printedAt ? '' : '<button class="btn btn-ghost btn-sm" data-action="printed">Printed</button>'}
`        </div>
`      </div>`;
````
`
`- [ ] **Step 4: Print branch**
`
`At the top of `pqPrint(item, button)`, before `const spec = …`, add:
`
````js
`  if (item.kind === 'document') return pqPrintDocument(item, button);
````
`
`Add after `pqPrint`:
`
````js
`async function pqPrintDocument(item, button) {
`  const spec = PQ_SIZES[item.size];
`  const name = item.fileName || 'document';
`  button.disabled = true;
`  pqSetStatus(`Fetching ${name}…`);
`  try {
`    const idToken = await Auth.getIdToken();
`    const b64 = await Endpoint.getDoc(item.fileId, idToken);
`    if (!b64) throw new Error('endpoint not configured');
`    let bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
`    // Wrong-printer guard: re-title so Chrome's tab and print dialog name the
`    // size. Best-effort — if pdf-lib can't re-open the file, print it untitled.
`    try {
`      const doc = await PDFLib.PDFDocument.load(bytes);
`      doc.setTitle(DocInfo.title(name, item.size, item.pages || doc.getPageCount()));
`      bytes = await doc.save({ useObjectStreams: false });
`    } catch (_) { /* open untitled */ }
`    if (pqLastBlobUrl) URL.revokeObjectURL(pqLastBlobUrl);
`    pqLastBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
`    if (!window.open(pqLastBlobUrl, '_blank')) {
`      pqSetStatus('Popup blocked — allow popups for this site, then click Print again.', true);
`      return;
`    }
`    pqSetStatus(`${name} ready — print the opened PDF on the ${spec ? spec.printer : item.size} at 100% scale.`);
`  } catch (err) {
`    // Row stays in the list; the real reason is the message.
`    pqSetStatus(`Couldn't fetch ${name} — ${err.message}. Try again.`, true);
`  } finally {
`    button.disabled = false;
`  }
`}
````
`
`- [ ] **Step 5: `index.html`** — script tag + version bumps as listed in Files.
`
`- [ ] **Step 6: Checks**
`
``node --check js/app.js`; `npm test` — all passing.
`
`Browser (PASTE mode, endpoint off, Playwright from `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\node_modules\playwright`, script in the scratchpad, temp copy of `index.html`, `css/`, `js/`, `assets/`, `package.json` and the tracked sample sheet HTML; `js/firebase-config.js` overwritten with `const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };`; `npx serve . -l 5056`):
`
`1. Upload the sample sheet to reach the Projects screen; open To Print.
`2. `page.evaluate`: build a 2-page 4x6 PDF with `PDFLib`, base64 it, then stub `Auth.getIdToken = async () => 'T'` and `Endpoint.getDoc = async (id) => (id === 'F1' ? b64 : null)`; `Storage.addPrintItem({ kind:'document', fileId:'F1', fileName:'label.pdf', pages:2, size:'4x6', lines:[] })`; `renderPrintQueue()`.
`3. Assert the row: what `label.pdf`; meta starts `2 pages · 4x6`; button text `Print 2 pages → CRATE LABEL 4x6`; badge `To Print (1)`.
`4. Stub `window.open` to capture the URL; click Print; fetch the blob; assert `%PDF-`, two `/Type /Page` entries, and `/Title` present (hex of `label.pdf · 4x6 · 2 pages`). Status text contains `CRATE LABEL 4x6`.
`5. Add a `letter` document the same way → button `→ letter printer`.
`6. Make `Endpoint.getDoc` reject with `new Error('not a print-queue file')`; click Print → status `Couldn't fetch label.pdf — not a print-queue file. Try again.` and the row is still there.
`7. A sticker row still renders and prints as before (regression).
`
`Kill the server, delete the temp copy.
`
`- [ ] **Step 7: Commit**
`
````bash
`git add js/storage.js test/storage-print-queue.test.mjs js/app.js index.html
`git commit -m "feat(print-queue): document rows and Print — fetch via getDoc, re-title, open; pages recorded
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`---
`
`### Task 5: Travis's side — "+ Send a document" with drop zone
`
`**Files:**
`- Modify: `index.html` — new `<details>` after the `#pq-builder` one; bump `app.js` → `?v=31`, `style.css` → `?v=21`.
`- Modify: `css/style.css` — append after `.print-queue-size label { … }`.
`- Modify: `js/app.js` — append a `/* ── Builder: + Send a document ── */` section after the `[pqPrefix, pqStart, pqEnd].forEach(…)` block, before the `Helpers` banner.
`
`**Interfaces:**
`- Consumes: `DocInfo.isPdf/inspectPdf/sizeFor` (Task 1), `Endpoint.uploadDoc` (Task 2), `Storage.addPrintItem` with `pages` (Task 4), `pqSetStatus`, `renderPrintQueue`, `printQueuePanel`.
`
`- [ ] **Step 1: Markup** — after the closing `</details>` of `#pq-builder`:
`
````html
`      <details class="print-queue-builder" id="pq-doc-builder">
`        <summary>+ Send a document</summary>
`        <div class="print-queue-builder-body">
`          <div id="pq-drop" class="pq-drop">
`            Drop a PDF here, or <label for="pq-file" class="pq-drop-browse">browse</label>
`            <input type="file" id="pq-file" accept="application/pdf" hidden>
`          </div>
`          <div id="pq-doc-staged" class="pq-doc-staged" hidden>
`            <span id="pq-doc-label" class="pq-row-what"></span>
`            <button class="btn btn-ghost btn-sm" id="pq-doc-clear" type="button" aria-label="Clear the file">×</button>
`          </div>
`          <div id="pq-doc-size" class="print-queue-size" hidden>
`            <span class="form-label">Size:</span>
`            <label><input type="radio" name="pq-doc-size" value="4x6"> 4x6 thermal</label>
`            <label><input type="radio" name="pq-doc-size" value="letter"> Letter</label>
`          </div>
`          <div id="pq-doc-error" class="vanlab-status vanlab-status-error" hidden></div>
`          <div><button class="btn btn-primary btn-sm" id="pq-doc-send-btn" type="button" disabled>Send to print list</button></div>
`        </div>
`      </details>
````
`
`- [ ] **Step 2: CSS**
`
````css
`.pq-drop {
`  border: 2px dashed var(--gray-300); border-radius: 8px; padding: 18px 12px;
`  text-align: center; font-size: 0.85rem; color: var(--gray-500);
`}
`.pq-drop-browse { color: var(--orange); cursor: pointer; text-decoration: underline; }
`.print-queue-panel.pq-drop--over .pq-drop { border-color: var(--orange); color: var(--orange); background: var(--orange-light); }
`.pq-doc-staged { display: flex; align-items: center; gap: 10px; }
````
`
`- [ ] **Step 3: JS**
`
````js
`/* ── Builder: + Send a document ── */
`const pqDocBuilder = document.getElementById('pq-doc-builder');
`const pqFile       = document.getElementById('pq-file');
`const pqDocStaged  = document.getElementById('pq-doc-staged');
`const pqDocLabel   = document.getElementById('pq-doc-label');
`const pqDocClear   = document.getElementById('pq-doc-clear');
`const pqDocSize    = document.getElementById('pq-doc-size');
`const pqDocError   = document.getElementById('pq-doc-error');
`const pqDocSendBtn = document.getElementById('pq-doc-send-btn');
`const PQ_DOC_MAX_BYTES = 10 * 1024 * 1024;
`let pqDoc = null;   // staged { file, bytes, pages, size } — nothing uploads until Send
`
`function pqDocShowError(msg) {
`  pqDocError.textContent = msg;
`  pqDocError.hidden = !msg;
`}
`
`function pqDocPickedSize() {
`  const r = document.querySelector('input[name="pq-doc-size"]:checked');
`  return r ? r.value : null;
`}
`
`function pqDocRender() {
`  if (!pqDoc) {
`    pqDocStaged.hidden = true;
`    pqDocSize.hidden = true;
`    pqDocSendBtn.disabled = true;
`    return;
`  }
`  const size = pqDoc.size || pqDocPickedSize();
`  pqDocLabel.textContent = `${pqDoc.file.name} · ${pqDoc.pages} page${pqDoc.pages === 1 ? '' : 's'}${size ? ' · ' + size : ''}`;
`  pqDocStaged.hidden = false;
`  pqDocSize.hidden = !!pqDoc.size;     // picker only when auto-detect found nothing
`  pqDocSendBtn.disabled = !size;
`}
`
`function pqDocReset() {
`  pqDoc = null;
`  pqFile.value = '';
`  document.querySelectorAll('input[name="pq-doc-size"]').forEach(r => { r.checked = false; });
`  pqDocRender();
`}
`
`async function pqStageFile(file) {
`  pqDocShowError('');
`  pqDocReset();
`  if (!file) return;
`  pqDocBuilder.open = true;
`  if (file.size > PQ_DOC_MAX_BYTES) {
`    pqDocShowError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB.`);
`    return;
`  }
`  const bytes = new Uint8Array(await file.arrayBuffer());
`  if (!DocInfo.isPdf(bytes)) { pqDocShowError("That isn't a PDF."); return; }
`  let info;
`  try {
`    info = await DocInfo.inspectPdf(bytes);
`  } catch (_) {
`    pqDocShowError(`Couldn't read ${file.name} — is it encrypted?`);
`    return;
`  }
`  pqDoc = { file, bytes, pages: info.pages, size: DocInfo.sizeFor(info.width, info.height) };
`  pqDocRender();
`}
`
`// The bytes are already in memory from staging, so encode those rather than
`// re-reading the file. Chunked: String.fromCharCode can't take 10 MB of args.
`function pqBytesToBase64(bytes) {
`  let s = '';
`  const CHUNK = 0x8000;
`  for (let i = 0; i < bytes.length; i += CHUNK) {
`    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
`  }
`  return btoa(s);
`}
`
`async function pqDocSend() {
`  if (!pqDoc) return;
`  const size = pqDoc.size || pqDocPickedSize();
`  if (!size) { pqDocShowError('Pick a size first.'); return; }
`  const name = pqDoc.file.name;
`  // Same PASTE-mode guard as pqSend: only touch firebase.auth() once an app exists.
`  const app = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
`  pqDocSendBtn.disabled = true;
`  pqDocShowError('');
`  pqSetStatus(`Uploading ${name}…`);
`  try {
`    const user = app ? app.auth().currentUser : null;
`    const idToken = await Auth.getIdToken();
`    const fileId = await Endpoint.uploadDoc(name, pqBytesToBase64(pqDoc.bytes), idToken);
`    if (!fileId) throw new Error('endpoint not configured');
`    // Upload first, queue second. If this write fails the file sits unused in
`    // the Drive folder — accepted; Travis just sends again.
`    await Storage.addPrintItem({ kind: 'document', fileId, fileName: name, pages: pqDoc.pages, size, lines: [], jobName: null, createdBy: user ? user.email : '' });
`    pqDocReset();
`    pqDocBuilder.open = false;
`    pqSetStatus(`${name} sent to the print list.`);
`    renderPrintQueue();
`  } catch (err) {
`    pqSetStatus('');
`    pqDocShowError(`Couldn't send — ${err.message}`);
`    pqDocSendBtn.disabled = false;
`  }
`}
`
`// Drops anywhere on the panel stage the file (the disclosure is usually
`// collapsed). stopPropagation matters: document.body's drop handler treats
`// any file dropped on the Projects screen as a job-sheet upload.
`['dragenter', 'dragover'].forEach(ev => printQueuePanel.addEventListener(ev, e => {
`  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
`  e.preventDefault();
`  e.stopPropagation();
`  printQueuePanel.classList.add('pq-drop--over');
`}));
`printQueuePanel.addEventListener('dragleave', e => {
`  if (!printQueuePanel.contains(e.relatedTarget)) printQueuePanel.classList.remove('pq-drop--over');
`});
`printQueuePanel.addEventListener('drop', e => {
`  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
`  if (!file) return;
`  e.preventDefault();
`  e.stopPropagation();
`  printQueuePanel.classList.remove('pq-drop--over');
`  pqStageFile(file);
`});
`pqFile.addEventListener('change', () => pqStageFile(pqFile.files[0]));
`pqDocClear.addEventListener('click', () => { pqDocShowError(''); pqDocReset(); });
`document.querySelectorAll('input[name="pq-doc-size"]').forEach(r => r.addEventListener('change', pqDocRender));
`pqDocSendBtn.addEventListener('click', pqDocSend);
````
`
`- [ ] **Step 4: Version bumps** (`app.js` → 31, `style.css` → 21).
`
`- [ ] **Step 5: Checks**
`
``node --check js/app.js`; `npm test` — all passing.
`
`Browser (same PASTE-mode harness as Task 4, port 5056; stub `Auth.getIdToken = async () => 'T'`, `Endpoint.uploadDoc = async (name) => 'UP-' + name`, and `Endpoint.getDoc` to return the uploaded bytes by keeping a map on `window`). Generate PDFs in Node with the repo's vendored pdf-lib in a vm (as `test/doc-info.test.mjs` does) and feed them with `page.setInputFiles('#pq-file', { name, mimeType: 'application/pdf', buffer })`:
`
`1. "+ Send a document" is collapsed by default; the "+ New batch" builder still works (regression).
`2. A 2-page 288×432 PDF → disclosure opens, staged line `label.pdf · 2 pages · 4x6`, picker hidden, Send enabled.
`3. A 612×792 PDF → `… · 1 page · letter`.
`4. A 595×842 (A4) PDF → `… · 1 page`, picker visible, Send disabled; choose Letter → label gains `· letter`, Send enabled.
`5. An HTML file named `fake.pdf` → `That isn't a PDF.`, nothing staged.
`6. An 11 MB buffer starting `%PDF-` → the `is 11.0 MB — the limit is 10 MB.` message, nothing staged.
`7. Clear (×) empties the staged line.
`8. Stage the 4x6 PDF, Send → status `label.pdf sent to the print list.`, disclosure collapsed, row `label.pdf · 2 pages · 4x6`, badge `To Print (1)`; `Endpoint.uploadDoc` was called once with `label.pdf` and a base64 string that decodes to bytes starting `%PDF-`.
`9. Make `Endpoint.uploadDoc` reject with `new Error('sign-in rejected')`, Send → `Couldn't send — sign-in rejected`, no new row.
`10. Drop simulation: dispatch a `drop` event on `#print-queue-panel` with a `DataTransfer` holding the 4x6 file (build it in `page.evaluate` from the bytes) → staged line appears **and** no job-sheet upload happened (the sheet count in the header is unchanged).
`11. Zero uncaught page errors throughout.
`
`Kill the server, delete the temp copy.
`
`- [ ] **Step 6: Commit**
`
````bash
`git add index.html css/style.css js/app.js
`git commit -m "feat(print-queue): + Send a document — drop zone, PDF check, auto-detected 4x6/letter, upload + queue
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`---
`
`### Task 6: Docs, Travis's redeploy checklist, hand-off
`
`**Files:**
`- Modify: `CLAUDE.md` (repo) — file-structure block: add `js/doc-info.js` after the `js/sequence.js` line; extend the `js/endpoint.js` line with `; uploadDoc/getDoc for print-queue documents`; extend the `apps-script/logging-endpoint.gs` line with ` + print-queue uploadDoc/getDoc (self-created Drive folder)`.
`  Also, in the **⚠️ Testing safety** section, after step 2 (`Overwrite the copy's js/firebase-config.js …`), insert a new step: `3. **Also overwrite the copy's \`js/endpoint-config.js\`** with \`const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\` — the tracked file holds the LIVE Apps Script URL and token (GitHub Pages serves it), so without this an upload in the copy calls the real \`archiveSheet\` and writes into the Drive archive. \`Endpoint.enabled()\` is false once the URL starts with PASTE.` and renumber the old step 3 to 4.
`- Modify: `docs/superpowers/specs/2026-09-10-print-queue-design.md` — status line: replace `Phase 3 (documents) amended 2026-09-11 and approved by Travis — see *Phase 3 amendment* at the end; Phase 2 not started` with `Phase 3 (documents) implemented 2026-09-11 on branch print-queue-docs (plan: ../plans/2026-09-11-print-queue-phase3-documents.md) — live script redeploy pending; Phase 2 not started`.
`- Modify: vault note `G:\My Drive\Brain\Brain\Projects\CNC Job Tracker.md` — in the top "Print queue" section, add after the existing checkboxes:
`
````
`- [ ] **Phase 3 (documents) built 2026-09-11 on branch `print-queue-docs` — needs the live Apps Script redeployed before it works.** Steps for Travis: open the live script at script.google.com → paste the block Claude hands over (the `printQueueFolder` / `uploadDoc` / `getDoc` functions and two `doPost` dispatch lines from `apps-script/logging-endpoint.gs`) — MERGE, never replace the file (the live copy holds `TOKEN`, folder ids, `FIREBASE_API_KEY`, `ALLOWED_UIDS`) → Deploy → Manage deployments → pencil → New version. No folder to create: the script makes `CNC Print Queue` in My Drive on the first upload. Until redeployed, Send a document fails with `unknown action` — that message is the cue.
`- [ ] After redeploy + merge + go-live: one emailed 4x6 label through the whole path on CRATE LABEL 4x6.
````
`
`- [ ] **Step 1:** Make the three edits. `git diff --stat` shows `CLAUDE.md` and the spec only.
`- [ ] **Step 2: Commit**
`
````bash
`git add CLAUDE.md docs/superpowers/specs/2026-09-10-print-queue-design.md
`git commit -m "docs: print queue phase 3 — CLAUDE.md map, spec status
`
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
````
`
`- [ ] **Step 3: Hand-off (not merge).** The controller reports to Travis: the branch is ready; the merge + go-live can happen before or after the script redeploy (the UI degrades to a clear `unknown action` message until then), and hands him the exact paste block extracted from `apps-script/logging-endpoint.gs`.
`
`---
`
`## Self-review
`
`**Spec coverage (Phase 3 amendment):** drop zone + browse + panel-wide drop → T5; one file at a time, replace on second drop → T5 (`pqStageFile` resets first); refusals (not PDF by header, >10 MB, unreadable) → T5 + T1; auto-detect ±3 pt either orientation, picker otherwise → T1 + T5; staged line + clear → T5; Send flow order, orphan accepted, error copy → T5; 120 s timeout, default untouched → T2; data shape with `pages` → T4; Collin's row/button/Print/re-title/best-effort → T4; Apps Script actions, token-first, folder self-created + lock + property, parent guard, size/header checks → T3; error table (`unknown action` surfaces verbatim via `endpointError`) → T2/T5; tests listed → T1/T2/T3/T4 (storage); Playwright with stubbed endpoint → T4/T5; real-printer test + redeploy → T6. Out of scope items untouched.
`
`**Placeholder scan:** none.
`
`**Type consistency:** `DocInfo.title(fileName, size, pages)` used identically in T4; `Endpoint.getDoc(fileId, idToken)` / `uploadDoc(fileName, base64, idToken)` match T2 ↔ T4/T5; `Storage.addPrintItem` receives `pages` (T4 storage change) from T5; `PQ_SIZES.letter.printer` read by the shared button template; `pqLastBlobUrl`, `pqSetStatus`, `renderPrintQueue`, `printQueuePanel` all exist from Phase 1.
