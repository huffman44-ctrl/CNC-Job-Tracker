// tools/browser-check-phase1.mjs — spec §12.4 screen checks for Phase 1, against a PASTE-mode
// copy (Firebase AND endpoint disabled), never the real config. Run from the repo root:
//   node tools/browser-check-phase1.mjs
// Prints PASS:/FAIL: lines and SUITE: PASS|FAIL; exits 1 on any FAIL or thrown error.
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire('C:/Users/Golden Boys/Documents/Agemtic Workflows/HQ/package.json');
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let BASE = '';   // set once the in-process server is listening on an ephemeral port
let failed = false;
const assert = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) failed = true; };

const dst = mkdtempSync(join(tmpdir(), 'cnc-p1-'));
for (const f of ['index.html', 'css', 'js', 'assets', 'package.json']) cpSync(join(ROOT, f), join(dst, f), { recursive: true });
const sample = readdirSync(ROOT).find(f => /^260520_.*\.html$/.test(f));
cpSync(join(ROOT, sample), join(dst, sample));
// A second sheet under another name (parses as Sheet 10 → different fileKey) for the mixed-drop case.
const sample2 = sample.replace(/Sheet 9\.html$/, 'Sheet 10.html');
cpSync(join(ROOT, sample), join(dst, sample2));
// An HTML file that is not an Aspire setup sheet (a saved web page) for the not-a-sheet case.
// The same sheet filed under another (fake) job name, for the job-stickers "another job" case.
const sampleOther = 'Other_Job_Sheet 1.html';
writeFileSync(join(dst, sampleOther), readFileSync(join(ROOT, sample), 'utf8').replace(/(<div id="jobtitle">)[^<]*(<\/div>)/, '$1Fake_Other_Job_0001$2'));
writeFileSync(join(dst, 'saved-web-page.html'), '<!doctype html><html><head><title>Recipe</title></head><body><h1>Banana bread</h1></body></html>\n');
// PASTE mode: BOTH configs are overwritten in the COPY, fully written before the server listens.
writeFileSync(join(dst, 'js/firebase-config.js'), "const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };\n");
writeFileSync(join(dst, 'js/endpoint-config.js'), "const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\n");

// In-process static server: serves ONLY the temp copy, port 0 = ephemeral. No child process to
// orphan and no fixed port a stale server could be holding.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const dstRoot = resolve(dst);
const server = http.createServer((req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = resolve(dstRoot, '.' + sep + rel.replace(/^[/\\]+/, ''));
    if (file !== dstRoot && !file.startsWith(dstRoot + sep)) { res.writeHead(404); res.end('not found'); return; }
    if (!statSync(file).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end('not found'); }
});

let browser;
let dialogs = [];

async function main() {
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  BASE = `http://127.0.0.1:${server.address().port}/`;
  console.log('serving the temp copy at ' + BASE);

  browser = await chromium.launch();
  async function fresh() {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); d.accept(); });
    page.on('pageerror', e => { console.log('FAIL: uncaught page error: ' + e.message); failed = true; });
    await page.addInitScript(() => { window.print = () => {}; });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#upload-screen:not([hidden])', { timeout: 10000 });
    return page;
  }
  const upload = async (page) => { await page.setInputFiles('#file-input', join(dst, sample)); await page.waitForSelector('#projects-screen:not([hidden])'); await page.waitForTimeout(300); };
  const setOwner = (page, extra = {}) => page.evaluate(async (extra) => {
    const s = Features.defaults('t@x'); Object.assign(s, extra);
    Features._setForTests(s, 't@x');
    await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); applyFeatureNav(); rerenderCurrent();
  }, extra);
  const refresh = (page) => page.evaluate(() => { applyFeatureNav(); rerenderCurrent(); });
  const jobCardOn = { jobCard: { on: true, users: ['t@x'] } };

  // ── Collin: nothing new ──
  let page = await fresh();
  await upload(page);
  assert(await page.isHidden('#settings-btn'), 'Collin: no Settings button');
  assert(await page.isHidden('#projects-show-finished-wrap'), 'Collin: no Show finished jobs toggle');
  assert(await page.$eval('#job-details-overlay', el => el.classList.contains('hidden')), 'Collin: upload opens no job-details form');
  assert((await page.$$('.jc-chip')).length === 0, 'Collin: board card has no chip');
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.isHidden('#owner-panel'), 'Collin: no owner panel on the job card');
  assert((await page.$$('.jc-row-tags')).length === 0, 'Collin: sidebar rows carry no tags');
  const headerButtons = await page.$$eval('#content-screen .header-right button', bs => bs.map(b => b.id));
  assert(JSON.stringify(headerButtons) === JSON.stringify(['dark-mode-btn', 'vanlab-print-btn', 'job-stickers-btn', 'print-ticket-btn', 'export-btn', 'reset-btn']), 'Collin: job header buttons — Print Ticket sits just left of Export CSV');
  // Print Ticket = print only: no CSV, no log write, no ticket-history record, job stays on the board
  await page.evaluate(() => {
    window.__calls = { print: 0, log: 0, ticket: 0 };
    window.print = () => { window.__calls.print++; };
    const up = Endpoint.upsertLogRows; Endpoint.upsertLogRows = (...a) => { window.__calls.log++; return up(...a); };
    const st = Storage.saveTicketRecord; Storage.saveTicketRecord = (...a) => { window.__calls.ticket++; return st(...a); };
  });
  let printDownload = false;
  const onDl = () => { printDownload = true; };
  page.on('download', onDl);
  const boardBefore = await page.evaluate(() => sheets.length);
  await page.click('#print-ticket-btn');
  await page.waitForTimeout(500);
  page.off('download', onDl);
  const calls = await page.evaluate(() => window.__calls);
  assert(calls.print === 1, 'Print Ticket: window.print called once');
  assert(!printDownload, 'Print Ticket: no CSV download');
  assert(calls.log === 0, 'Print Ticket: no Master Job Log write');
  assert(calls.ticket === 0, 'Print Ticket: no Ticket History record');
  assert(await page.evaluate(() => sheets.length) === boardBefore && boardBefore > 0, 'Print Ticket: job stays on the board');
  assert(await page.isVisible('#content-screen'), 'Print Ticket: still on the job screen');
  assert(await page.evaluate(() => document.getElementById('job-ticket').hidden), 'Print Ticket: ticket element hidden again after printing');
  // Export = finish: picker opens, then no delete prompt
  dialogs = [];
  const dl = page.waitForEvent('download');
  await page.click('#export-btn');
  await page.waitForSelector('#customer-picker-overlay:not(.hidden)');
  await page.selectOption('#customer-picker-select', '__other__');
  await page.fill('#customer-picker-other', 'Harbor Lane Pictures');
  await page.click('#customer-picker-confirm');
  const download = await dl;
  assert(/Harbor Lane Pictures/.test(download.suggestedFilename()), 'export: CSV named under the customer folder');
  await page.waitForTimeout(500);
  assert(!dialogs.some(d => d.startsWith('confirm:')), 'export: NO "Delete …?" confirm after a successful log write');
  assert(await page.evaluate(() => sheets.length === 0), 'export: finished sheets left the in-memory board');
  assert(await page.isVisible('#projects-screen') && await page.isHidden('#upload-screen'), 'Collin: empty board after finishing lands on Projects');
  assert(await page.isVisible('#print-queue-btn'), 'Collin: To Print reachable on the empty board');
  const emptyText = await page.textContent('#projects-container');
  assert(emptyText.includes('No jobs loaded.') && await page.evaluate(t => EMPTY_BOARD_LINES.some(l => t.includes(l)), emptyText), 'Collin: empty board shows "No jobs loaded." + a line from the list');
  assert(await page.evaluate(() => emptyBoardLine(new Date(2026, 9, 13, 1)) === emptyBoardLine(new Date(2026, 9, 13, 23)) && emptyBoardLine(new Date(2026, 9, 13)) !== emptyBoardLine(new Date(2026, 9, 14))), 'empty board: same line all day, a different one tomorrow');
  await page.close();

  // ── Owner (job card OFF): job details step, then export with no picker ──
  page = await fresh();
  await page.evaluate(async () => { Features._setForTests(Features.defaults('t@x'), 't@x'); await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
  assert(/no repeats found/.test(await page.textContent('#job-details-summary')), 'owner: job-details form shows the repeat summary');
  assert(await page.$eval('#job-details-material-ours', el => el.disabled), 'owner: "Ours" material disabled while settings/materials is empty');
  await page.click('#job-details-confirm');
  assert(/Pick a customer/.test(await page.textContent('#job-details-error')), 'owner: confirm without a customer is refused');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Northlight Studios');
  await page.check('input[name="jd-turnaround"][value="rush48"]');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay', { state: 'hidden' });
  const jb = await page.evaluate(() => OwnerStore.getJobBilling(Keys.job(sheets[0].jobName)));
  assert(jb && jb.customerName === 'Northlight Studios' && jb.turnaround === 'rush48' && jb.material.kind === 'customer', 'owner: jobBilling written from the form');
  assert(await page.evaluate(() => Storage.getProjectCustomer(Keys.job(sheets[0].jobName)) === 'Northlight Studios'), "owner: projectCustomer written (Collin's export reads it)");
  await refresh(page);
  assert(await page.isVisible('#settings-btn'), 'owner: Settings button visible');
  // the chip only exists once the jobCard switch is on
  await setOwner(page, jobCardOn);
  assert(/Not billed yet/.test(await page.textContent('.project-card')), 'owner: board chip reads Not billed yet (jobCard on)');
  dialogs = [];
  const dl2 = page.waitForEvent('download');
  await page.click('.project-card .btn-primary');   // Export CSV on the card
  await dl2;
  await page.waitForTimeout(300);
  assert(await page.$eval('#customer-picker-overlay', el => el.classList.contains('hidden')), 'owner-tagged job: export asks NO customer question');
  assert(!dialogs.some(d => d.startsWith('confirm:')), 'owner-tagged job: no delete prompt');
  assert(await page.isVisible('#projects-screen') && await page.evaluate(() => sheets.length === 0), 'owner (jobCard on): after export the board is empty and the owner lands on Projects');
  await page.close();

  // ── Re-upload guard ──
  page = await fresh();
  await page.evaluate(() => { Features._setForTests(Features.defaults('t@x'), 't@x'); Storage.getSheetDoc = async () => ({ finished: true, finishedAt: Date.now(), jobName: 'Old Job' }); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/already cut and finished on .* \(job Old Job\)/.test(await page.textContent('#notice-modal-text')), 'guard: blocking notice names the date and job');
  assert(await page.evaluate(() => sheets.length === 0), 'guard: nothing was saved or shown');
  await page.close();

  // Guard: on the board in the database but not on this computer's board yet → already loaded, never overwritten
  page = await fresh();
  await page.evaluate(() => {
    window.__saves = 0;
    Storage.getSheetDoc = async () => ({ finished: false, jobName: 'Other Device Job' });
    const realSave = Storage.saveSheet;
    Storage.saveSheet = async (sh) => { window.__saves++; return realSave(sh); };
  });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/is already loaded — it's on the board, so nothing was changed\./.test(await page.textContent('#notice-modal-text')), 'guard: a sheet already in the database (not on this board) gets the "already loaded" notice');
  assert(await page.evaluate(() => window.__saves === 0 && sheets.length === 0), 'guard: that sheet is never saved over');
  await page.close();

  // A file that isn't an Aspire setup sheet is refused; a real sheet in the same drop still loads
  page = await fresh();
  await page.setInputFiles('#file-input', [join(dst, 'saved-web-page.html'), join(dst, sample)]);
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/"saved-web-page\.html" isn't an Aspire setup sheet, so it wasn't added\./.test(await page.textContent('#notice-modal-text')), 'not a sheet: refused with the plain notice');
  assert(await page.evaluate(() => sheets.length === 1 && !sheets.some(s => s.fileName === 'saved-web-page.html')), 'not a sheet: only the real sheet is on the board');
  await page.close();

  // Guard: a failed lookup blocks the file
  page = await fresh();
  await page.evaluate(() => { Storage.getSheetDoc = async () => { throw new Error('offline'); }; });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/Couldn't check whether/.test(await page.textContent('#notice-modal-text')), 'guard: a rejected lookup blocks the file with a "Couldn\'t check" notice');
  assert(await page.evaluate(() => sheets.length === 0), 'guard: failed lookup saved nothing');
  await page.close();

  // Guard: same file dropped twice while in flight saves once, and says so
  page = await fresh();
  await page.evaluate(() => { Storage.getSheetDoc = () => new Promise(r => setTimeout(() => r(null), 400)); });
  await page.setInputFiles('#file-input', [join(dst, sample), join(dst, sample)]);
  await page.waitForSelector('#projects-screen:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 5000 });
  assert(await page.evaluate(() => sheets.length === 1), 'guard: same file dropped twice while in flight saves once');
  assert(/already loaded/.test(await page.textContent('#notice-modal-text')), 'guard: the duplicate gets the "already loaded" notice');
  await page.close();

  // Guard: a finished file in a mixed drop blocks only itself; the other file still loads
  page = await fresh();
  await page.evaluate((finishedName) => {
    window.__saved = [];
    window.__finishedKey = Keys.sheet(finishedName);
    Storage.getSheetDoc = async (k) => k === window.__finishedKey ? { finished: true, finishedAt: Date.now(), jobName: 'Old Job' } : null;
    const realSave = Storage.saveSheet;
    Storage.saveSheet = async (sh) => { window.__saved.push(sh.fileKey); return realSave(sh); };
  }, sample);
  await page.setInputFiles('#file-input', [join(dst, sample), join(dst, sample2)]);
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/already cut and finished/.test(await page.textContent('#notice-modal-text')), 'mixed drop: the finished notice appears');
  const mixed = await page.evaluate(() => ({ files: sheets.map(s => s.fileName), saved: window.__saved, finishedKey: window.__finishedKey }));
  assert(mixed.files.length === 1 && mixed.files[0] === sample2, 'mixed drop: exactly one sheet loaded and it is the second file');
  assert(mixed.saved.length === 1 && !mixed.saved.includes(mixed.finishedKey), 'mixed drop: saveSheet was never called with the finished key');
  await page.close();

  // ── Owner panel on the job card (jobCard switch on) ──
  page = await fresh();
  await page.evaluate(async (jc) => { Features._setForTests({ ...Features.defaults('t@x'), ...jc }, 't@x'); await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); }, jobCardOn);
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#job-details-overlay:not(.hidden)');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Copperline Stage');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay', { state: 'hidden' });
  await refresh(page);
  await page.waitForSelector('#projects-screen:not([hidden])');
  assert(await page.isVisible('#projects-show-finished-wrap'), 'owner: Show finished jobs toggle visible');
  await page.click('.project-card');
  await page.waitForSelector('#owner-panel:not([hidden])');
  assert(/Copperline Stage/.test(await page.textContent('#owner-panel')), 'panel: customer shown');
  assert(/Not cut yet/.test(await page.textContent('.sheet-nav-row .jc-row-tags')), 'panel: sidebar row status Not cut yet');
  assert(!(await page.$('#owner-panel [data-action="done"]')) && !(await page.$('#owner-panel [data-action="nodesign"]')), 'panel: no Done button and no "No design time" box (2026-10-06)');
  assert(/Not billed yet/.test(await page.textContent('#owner-panel')), 'panel: chip reads "Not billed yet"');
  await page.fill('#owner-panel [data-line-hours]', '1.5');
  await page.fill('#owner-panel [data-line-note]', 'Bridge wall panels');
  await page.click('#owner-panel [data-action="line-add"]');
  await page.waitForTimeout(200);
  assert(/Bridge wall panels/.test(await page.textContent('#owner-panel')), 'panel: labor line added');
  const typeOptions = await page.$$eval('#owner-panel [data-line-type] option', os => os.map(o => o.textContent));
  assert(typeOptions.some(t => /Design — \$150\/hr \(min 1 h per job\)/.test(t)) && typeOptions.some(t => /CAM — \$85\/hr \(min 0.5 h per job\)/.test(t)), 'panel: labor types come from the seeded settings doc');
  // Half-typed input survives a shop-floor completion change (owner panel redraw), focus included.
  await page.fill('#owner-panel [data-line-hours]', '2.25');
  await page.fill('#owner-panel [data-line-note]', 'Half typed note');
  await page.focus('#owner-panel [data-line-note]');
  await page.evaluate(async () => { await Storage.set(sheets[0].fileKey, 'sheet', { status: 'complete', completedAt: Date.now(), operator: 'Collin', notes: '' }); renderAllSheets(); });
  assert(/1 of 1 sheet cut/.test(await page.textContent('#owner-panel')), 'panel: the completion change really redrew the panel');
  assert(await page.inputValue('#owner-panel [data-line-hours]') === '2.25' && await page.inputValue('#owner-panel [data-line-note]') === 'Half typed note', 'panel: typed hours + note survive a completion-driven redraw');
  assert(await page.evaluate(() => document.activeElement && document.activeElement.matches('#owner-panel [data-line-note]')), 'panel: focus stays in the note box');
  await page.fill('#owner-panel [data-line-hours]', '');
  await page.fill('#owner-panel [data-line-note]', '');
  // Owner data did not load (jobBilling): every write control is disabled and the notice shows.
  await page.evaluate(() => { window.__realLoaded = OwnerStore.loaded; OwnerStore.loaded = (n) => n === 'jobBilling' ? false : window.__realLoaded(n); rerenderCurrent(); });
  const writeOff = await page.evaluate(() => ['[data-action="edit"]', '[data-action="line-add"]', '[data-line-hours]', '[data-line-note]', '[data-line-type]']
    .map(sel => { const el = document.querySelector('#owner-panel ' + sel); return !!el && el.disabled; }));
  assert(writeOff.every(v => v === true), 'panel: jobBilling not loaded -> every write control is disabled');
  assert((await page.textContent('#owner-panel')).includes("Owner data didn't load — reload the page."), 'panel: shows "Owner data didn\'t load — reload the page."');
  await page.evaluate(() => { OwnerStore.loaded = window.__realLoaded; rerenderCurrent(); });
  assert(/Not billed yet/.test(await page.textContent('#owner-panel')) && !(await page.$('#owner-panel [data-action="done"]')), 'panel: after the redraw the chip still reads "Not billed yet" and there is no Done control');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= 320), 'panel: no horizontal scroll at 320px');
  await page.close();

  // ── Owner with Settings on, job card OFF, empty board → Projects (not the Upload dead end) ──
  page = await fresh();
  await setOwner(page);
  await page.evaluate(() => showProjectsScreen());
  assert(await page.isVisible('#projects-screen') && await page.isHidden('#upload-screen'), 'owner (settings on, jobCard off): empty board lands on Projects');
  assert(await page.isVisible('#settings-btn'), 'owner (settings on, jobCard off): Settings button visible on the empty board');
  await page.close();

  // ── Put-back sheet whose drawing was cleared shows the archive note ──
  page = await fresh();
  await upload(page);
  await setOwner(page, jobCardOn);
  await page.evaluate(() => { const s = sheets[0]; s.layoutSvg = ''; s.layoutSvgGz = null; s.layoutOversize = false; s.archiveUrl = 'https://example.invalid/archived-sheet'; s.finishedAt = Date.now(); rerenderCurrent(); });
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  await page.waitForSelector('.layout-svg-oversize', { timeout: 5000 });
  assert(/Layout preview is not stored here\./.test(await page.textContent('.layout-svg-oversize')), 'put-back: cleared drawing shows "Layout preview is not stored here."');
  assert(await page.isVisible('.layout-svg-oversize a'), 'put-back: the note links to the archived sheet');
  await page.close();

  // ── Delete (spec .scratch/complete-sheet-delete): one action, board follows what was deleted ──
  const uploadTwo = async (page) => {
    await page.setInputFiles('#file-input', [join(dst, sample), join(dst, sample2)]);
    await page.waitForSelector('#projects-screen:not([hidden])');
    await page.waitForFunction(() => sheets.length === 2);
  };
  // Delete Sheet in the job view: whole record goes, selection moves on, last one → Projects
  page = await fresh();
  await uploadTwo(page);
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  const firstKey = await page.evaluate(async () => {
    const k = selectedSheetKey || getDisplaySheets()[0].fileKey;
    selectedSheetKey = k;
    await Storage.set(k, 'sheet', { status: 'complete', completedAt: Date.now(), operator: 'Collin', notes: '' });
    await Storage.setSheetNote(k, 'cut the pocket first');
    await Storage.setAnnotations(k, [{ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' }]);
    renderAllSheets();
    return k;
  });
  dialogs = [];
  await page.click('.detail-delete-btn');
  await page.waitForFunction(() => sheets.length === 1);
  assert(dialogs.some(d => d.startsWith('confirm:Delete "')), 'delete sheet: the same confirm prompt as before');
  const afterOne = await page.evaluate((k) => ({ left: sheets.map(s => s.fileKey), sel: selectedSheetKey, rec: Storage.get(k, 'sheet'), note: Storage.getSheetNote(k), marks: Storage.getAnnotations(k).length, notice: !document.getElementById('notice-overlay').classList.contains('hidden') }), firstKey);
  assert(!afterOne.left.includes(firstKey), 'delete sheet: the sheet left the board');
  assert(afterOne.rec === null && afterOne.note === null && afterOne.marks === 0, 'delete sheet: its completion, note and markup are gone too');
  assert(afterOne.sel !== firstKey, 'delete sheet: the selection moved off the deleted sheet');
  assert(!afterOne.notice, 'delete sheet: no notice when everything was deleted');
  assert(await page.isVisible('#content-screen'), 'delete sheet: still on the job screen while sheets remain');
  await page.click('.detail-delete-btn');
  await page.waitForFunction(() => sheets.length === 0);
  assert(await page.isVisible('#projects-screen'), 'delete sheet: deleting the last sheet lands on Projects (as today)');
  await page.close();

  // Trash icon on the project card: whole job gone; Collin's empty board → Projects (To Print stays reachable)
  page = await fresh();
  await uploadTwo(page);
  dialogs = [];
  await page.click('.project-delete-btn');
  await page.waitForFunction(() => sheets.length === 0);
  assert(dialogs.some(d => d.startsWith('confirm:Delete "')), 'delete job: the same confirm prompt as before');
  assert(await page.isVisible('#projects-screen') && await page.isHidden('#upload-screen'), 'delete job: Collin lands on Projects when the board is empty');
  await page.close();

  // A sheet on an invoice stays on the board and gets ONE notice; others in the job still go
  page = await fresh();
  await uploadTwo(page);
  await page.evaluate(() => {
    const blockedKey = sheets[0].fileKey;
    const real = Storage.deleteSheets;
    Storage.deleteSheets = async (keys) => {
      const res = await real(keys.filter(k => k !== blockedKey));
      return { ...res, blocked: keys.filter(k => k === blockedKey) };
    };
    window.__blockedKey = blockedKey;
  });
  await page.click('.project-delete-btn');
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 5000 });
  assert(/^1 sheet wasn't deleted because it's on an invoice\. Ask Travis or Eva\.$/.test(await page.textContent('#notice-modal-text')), 'delete job, one blocked: the "on an invoice — ask Travis or Eva" notice');
  assert(await page.evaluate(() => sheets.length === 1 && sheets[0].fileKey === window.__blockedKey), 'delete job, one blocked: only the blocked sheet is left on the board');
  assert(await page.isVisible('#projects-screen'), 'delete job, one blocked: stays on Projects with the blocked sheet showing');
  await page.click('#notice-ok');
  // A failed delete names the sheet and says to retry; the sheet stays
  await page.evaluate(() => { Storage.deleteSheets = async (keys) => ({ deleted: [], blocked: [], failed: keys.map(k => ({ fileKey: k, message: 'offline' })) }); });
  await page.click('.project-delete-btn');
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 5000 });
  const failText = await page.textContent('#notice-modal-text');
  const failLabel = await page.evaluate(() => sheets[0].sheetTitle || sheets[0].fileName);
  assert(failText.includes(`Couldn't delete "${failLabel}".`) && /Check your connection and try again\./.test(failText), 'delete failed: the notice names the sheet and says to try again');
  assert(await page.evaluate(() => sheets.length === 1), 'delete failed: the sheet stays on the board');
  await page.close();

  // Live listener mid-delete: Firestore's local write drops the sheet from the snapshot before the
  // database answers. A refused delete must not vanish or move the screen (PASTE has no listener,
  // so the snapshot is fed to applySheetsSnapshot by hand).
  page = await fresh();
  await upload(page);
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  await page.evaluate(() => {
    Storage.deleteSheets = async (keys) => {
      applySheetsSnapshot(sheets.filter(s => !keys.includes(s.fileKey)));   // the local write
      window.__midDelete = { onBoard: keys.every(k => sheets.some(s => s.fileKey === k)), onJob: !document.getElementById('content-screen').hidden };
      return { deleted: [], blocked: keys, failed: [] };
    };
  });
  await page.click('.detail-delete-btn');
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 5000 });
  const mid = await page.evaluate(() => window.__midDelete);
  assert(mid && mid.onBoard, 'mid-delete: the listener snapshot does not drop a sheet whose delete is still in flight');
  assert(mid && mid.onJob, 'mid-delete: the screen does not move while the database has not answered');
  assert(await page.evaluate(() => sheets.length === 1) && await page.isVisible('#content-screen'), 'mid-delete, refused: sheet still on the board and still on the job screen');
  await page.click('#notice-ok');
  await page.evaluate(() => applySheetsSnapshot([]));   // a later snapshot without it: nothing held any more
  assert(await page.evaluate(() => sheets.length === 0), 'mid-delete: nothing is held once the delete has answered');
  await page.close();

  // Owner job-details Cancel: removes only the sheets that drop saved, whole record; earlier sheets stay
  page = await fresh();
  await upload(page);
  const keptKey = await page.evaluate(() => sheets[0].fileKey);
  await page.evaluate(async () => { Features._setForTests(Features.defaults('t@x'), 't@x'); await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent); });
  await page.setInputFiles('#file-input', join(dst, sample2));
  await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
  const droppedKey = await page.evaluate((kept) => sheets.find(s => s.fileKey !== kept).fileKey, keptKey);
  await page.evaluate(async (k) => { await Storage.setSheetNote(k, 'leftover?'); }, droppedKey);
  await page.click('#job-details-cancel');
  await page.waitForFunction(() => sheets.length === 1);
  const afterCancel = await page.evaluate((k) => ({ left: sheets.map(s => s.fileKey), note: Storage.getSheetNote(k) }), droppedKey);
  assert(afterCancel.left.length === 1 && afterCancel.left[0] === keptKey, 'cancel: only the sheet this drop saved was removed');
  assert(afterCancel.note === null, 'cancel: nothing is left behind for the cancelled sheet');
  await page.close();

  // ── To Print: Print marks printed (spec .scratch/job-stickers, ticket 02) ──
  page = await fresh();
  await upload(page);
  await page.click('#print-queue-btn');
  await page.evaluate(() => { document.getElementById('pq-builder').open = true; });
  await page.fill('#pq-lines', ['ED1', 'ED2', 'ED3'].join(String.fromCharCode(10)));
  await page.click('#pq-send-btn');
  await page.waitForSelector('#print-queue-list .pq-row');
  assert(await page.locator('#print-queue-list .pq-row').count() === 1, 'to print: one waiting row');
  assert(!(await page.$('[data-action="printed"]')), 'to print: no separate Printed button on a waiting row');
  await page.evaluate(() => { window.open = () => ({}); });
  await page.click('#print-queue-list [data-action="print"]');
  await page.waitForFunction(() => /Marked printed\.$|Couldn't|Printed, but/.test(document.getElementById('print-queue-status').textContent), null, { timeout: 15000 });
  const marked = await page.evaluate(() => ({ status: document.getElementById('print-queue-status').textContent, printed: Storage.getPrintedItems().length, waiting: Storage.getPrintQueue().length }));
  assert(/3 stickers ready/.test(marked.status) && /Marked printed\.$/.test(marked.status), 'to print: Print says "3 stickers ready … Marked printed." (got: ' + marked.status + ')');
  assert(marked.printed === 1 && marked.waiting === 0, 'to print: the batch is printed after Print');
  assert(await page.isVisible('#print-queue-undo'), 'to print: Undo is offered after Print marks it');
  await page.click('#print-queue-undo');
  await page.waitForFunction(() => Storage.getPrintQueue().length === 1);
  assert(await page.evaluate(() => Storage.getPrintedItems().length === 0), 'to print: Undo puts the batch back to waiting');
  await page.evaluate(() => { window.open = () => null; });
  await page.click('#print-queue-list [data-action="print"]');
  await page.waitForFunction(() => /Popup blocked/.test(document.getElementById('print-queue-status').textContent), null, { timeout: 15000 });
  assert(await page.evaluate(() => Storage.getPrintQueue().length === 1 && Storage.getPrintedItems().length === 0), 'to print: popup blocked marks nothing');
  assert(await page.isHidden('#print-queue-undo'), 'to print: no Undo after a blocked popup');
  // Marking fails: the PDF opened, so say so — the row stays waiting, no Undo
  await page.evaluate(() => { window.open = () => ({}); window.__mp = Storage.markPrinted; Storage.markPrinted = async () => { throw new Error('offline'); }; });
  await page.click('#print-queue-list [data-action="print"]');
  await page.waitForFunction(() => /Printed, but/.test(document.getElementById('print-queue-status').textContent), null, { timeout: 15000 });
  assert(await page.textContent('#print-queue-status') === "Printed, but couldn't mark it printed — offline.", 'to print: a failed mark says "Printed, but couldn\'t mark it printed — <reason>."');
  assert(await page.evaluate(() => Storage.getPrintQueue().length === 1), 'to print: a failed mark leaves the row waiting');
  assert(await page.isHidden('#print-queue-undo'), 'to print: no Undo after a failed mark');
  // Print again from the printed list: opens the PDF, marks nothing, offers no Undo
  await page.evaluate(async () => { Storage.markPrinted = window.__mp; await Storage.markPrinted(Storage.getPrintQueue()[0].id); window.__printedAt = Storage.getPrintedItems()[0].printedAt; });
  await page.check('#print-queue-show-printed');
  await page.waitForSelector('#print-queue-list .pq-row');
  await page.click('#print-queue-list [data-action="print"]');
  await page.waitForFunction(() => /stickers ready/.test(document.getElementById('print-queue-status').textContent), null, { timeout: 15000 });
  const again = await page.evaluate(() => ({ status: document.getElementById('print-queue-status').textContent, same: Storage.getPrintedItems()[0].printedAt === window.__printedAt }));
  assert(!/Marked printed/.test(again.status) && again.same, 'to print: Print again on a printed row marks nothing (got: ' + again.status + ')');
  assert(await page.isHidden('#print-queue-undo'), 'to print: no Undo after Print again');
  await page.close();

  // ── Job stickers: Stickers button + job panel (spec .scratch/job-stickers, ticket 03) — Collin, no owner stub ──
  page = await fresh();
  await upload(page);
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  const jsJob = await page.evaluate(() => currentProject);
  assert((await page.textContent('#job-stickers-btn')).trim() === 'Stickers', 'job stickers: button says Stickers when nothing is waiting');
  assert(await page.isHidden('#job-stickers-panel'), 'job stickers: panel starts closed');
  await page.click('#job-stickers-btn');
  assert(await page.isVisible('#job-stickers-panel'), 'job stickers: button opens the panel (Collin sees it)');
  await page.click('#js-save-btn');
  assert(await page.isVisible('#js-error') && /Type at least one sticker line/.test(await page.textContent('#js-error')), 'job stickers: saving an empty box shows the empty message');
  await page.fill('#js-lines', ['ED1', 'ED2', 'ED3'].join(String.fromCharCode(10)));
  await page.click('#js-save-btn');
  await page.waitForFunction(() => document.getElementById('job-stickers-btn').textContent.trim() === 'Stickers (1)');
  assert(await page.$eval('#job-stickers-btn', b => b.classList.contains('print-queue-btn--pending')), 'job stickers: button turns pending after a save');
  assert(await page.locator('#job-stickers-list .pq-row').count() === 1, 'job stickers: one row in the job panel');
  assert(/3 stickers saved to this job\./.test(await page.textContent('#job-stickers-status')), 'job stickers: status says the batch was saved');
  assert(await page.inputValue('#js-lines') === '' && await page.isHidden('#js-error'), 'job stickers: save clears the box and the error');
  const stored = await page.evaluate(() => Storage.getPrintQueue().map(i => i.jobName));
  assert(stored.length === 1 && stored[0] === jsJob, 'job stickers: the stored batch carries the job name');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#projects-screen:not([hidden])');
  await page.click('#print-queue-btn');
  await page.waitForSelector('#print-queue-list .pq-row');
  assert((await page.textContent('#print-queue-list .pq-row-meta')).includes(jsJob), 'job stickers: the To Print row names the job');
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.isHidden('#job-stickers-panel'), 'job stickers: panel is closed again after leaving the job');
  assert((await page.textContent('#job-stickers-btn')).trim() === 'Stickers (1)', 'job stickers: button still counts the waiting batch');
  await page.click('#job-stickers-btn');
  await page.evaluate(() => { window.open = () => ({}); });
  await page.click('#job-stickers-list [data-action="print"]');
  await page.waitForFunction(() => /Marked printed\.$/.test(document.getElementById('job-stickers-status').textContent), null, { timeout: 15000 });
  assert(await page.locator('#job-stickers-printed-list .pq-row').count() === 1 && await page.locator('#job-stickers-list .pq-row').count() === 0, 'job stickers: printed row moves to the Printed group');
  assert((await page.textContent('#job-stickers-btn')).trim() === 'Stickers', 'job stickers: button back to Stickers after printing');
  assert(await page.isVisible('#job-stickers-undo'), 'job stickers: Undo is offered after Print');
  await page.click('#job-stickers-undo');
  await page.waitForFunction(() => document.getElementById('job-stickers-btn').textContent.trim() === 'Stickers (1)');
  assert(await page.locator('#job-stickers-list .pq-row').count() === 1 && await page.locator('#job-stickers-printed-list .pq-row').count() === 0, 'job stickers: Undo puts it back to waiting');
  await page.evaluate(() => { window.open = () => null; });
  await page.click('#job-stickers-list [data-action="print"]');
  await page.waitForFunction(() => /Popup blocked/.test(document.getElementById('job-stickers-status').textContent), null, { timeout: 15000 });
  assert(await page.locator('#job-stickers-list .pq-row').count() === 1 && (await page.textContent('#job-stickers-btn')).trim() === 'Stickers (1)', 'job stickers: popup blocked leaves the batch waiting');
  // Another job does not show this batch
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#projects-screen:not([hidden])');
  await page.setInputFiles('#file-input', join(dst, sampleOther));
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 2, null, { timeout: 15000 });
  await page.evaluate(() => { const c = [...document.querySelectorAll('.project-card')].find(el => el.textContent.includes('Fake_Other_Job_0001')); c.click(); });
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.evaluate(() => currentProject) === 'Fake_Other_Job_0001', 'job stickers: opened the other job');
  assert((await page.textContent('#job-stickers-btn')).trim() === 'Stickers', 'job stickers: other job button shows no count');
  await page.click('#job-stickers-btn');
  assert(await page.locator('#job-stickers-panel .pq-row').count() === 0, 'job stickers: other job panel has no rows');
  await page.close();

  // ── Settings screen ──
  page = await fresh();
  await upload(page);
  await setOwner(page);
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-screen:not([hidden])');
  assert((await page.$$('#settings-screens-grid input[type=checkbox]')).length === 4, 'settings: four switches for the one owner column');
  // a change that would leave no owner is refused and re-rendered: click, then read the resulting state
  await page.click('#settings-screens-grid input[data-screen="settings"]');
  await page.waitForTimeout(200);
  assert(/Settings must stay on/.test(await page.textContent('#settings-status')), 'settings: last owner cannot switch Settings off');
  assert(await page.isChecked('#settings-screens-grid input[data-screen="settings"]'), 'settings: the box re-checks itself');
  await page.fill('#settings-add-owner-email', 'e@x.com');
  await page.click('#settings-add-owner-btn');
  await page.waitForTimeout(200);
  assert((await page.$$('#settings-screens-grid input[type=checkbox]')).length === 8, 'settings: Add column accepted a second owner email (eight switches)');
  await page.click('#settings-migrate-btn');
  await page.waitForTimeout(300);
  const mig = (await page.textContent('#settings-status')) + ' ' + (await page.textContent('#settings-migration-status'));
  assert(/Migration done — 0 of 0/.test(mig), 'settings: migration runs (no db → nothing to stamp)');
  await page.close();
}

try {
  await main();
} catch (e) {
  console.log('FAIL: script error: ' + ((e && e.stack) || e));
  failed = true;
} finally {
  try { if (browser) await browser.close(); } catch (e) { console.log('WARN: browser close: ' + e.message); }
  try { server.closeAllConnections?.(); if (server.listening) await new Promise(r => server.close(r)); } catch (e) { console.log('WARN: server close: ' + e.message); }
  try { rmSync(dst, { recursive: true, force: true }); } catch (e) { console.log('WARN: could not remove temp dir ' + dst + ': ' + e.message); }
  console.log(failed ? 'SUITE: FAIL' : 'SUITE: PASS');
  process.exit(failed ? 1 : 0);
}
