// tools/browser-check-phase2.mjs — Phase 2 screen checks (owner billing end to end vs Collin),
// against a PASTE-mode copy (Firebase AND endpoint disabled), never the real config. Run from the repo root:
//   node tools/browser-check-phase2.mjs
// Prints PASS:/FAIL: lines and SUITE: PASS|FAIL; exits 1 on any FAIL or thrown error.
// Weekly billing (step 15) adds Birchwood Signs and Quarry Road Vans. Fake names only (Northlight Studios, Copperline Stage, Ridgeway Vans, Harbor Lane Pictures).
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
const pageErrors = [];
const assert = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) failed = true; };

const dst = mkdtempSync(join(tmpdir(), 'cnc-p2-'));
for (const f of ['index.html', 'css', 'js', 'assets', 'package.json']) cpSync(join(ROOT, f), join(dst, f), { recursive: true });
const sample = readdirSync(ROOT).find(f => /^260520_.*\.html$/.test(f));
cpSync(join(ROOT, sample), join(dst, sample));
// Job A = the tracked sample as Sheet 9 plus an identical copy as Sheet 10 (same signature: design + repeat).
const sample10 = sample.replace(/Sheet 9\.html$/, 'Sheet 10.html');
cpSync(join(ROOT, sample), join(dst, sample10));
// Other jobs: the same sheet under another order number (new job name, new file name, one sheet each).
const sampleHtml = readFileSync(join(ROOT, sample), 'utf8');
const jobFile = n => {
  const name = sample.replace('Order_1195', 'Order_' + n);
  writeFileSync(join(dst, name), sampleHtml.split('Order_1195').join('Order_' + n));
  return join(dst, name);
};
const FILE_B = jobFile(1201), FILE_C = jobFile(1202), FILE_D = jobFile(1203);
// PASTE mode: BOTH configs are overwritten in the COPY, fully written before the server listens.
writeFileSync(join(dst, 'js/firebase-config.js'), "const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };\n");
writeFileSync(join(dst, 'js/endpoint-config.js'), "const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\n");

// In-process static server: serves ONLY the temp copy, port 0 = ephemeral (no child process to orphan).
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

// Minimal RFC 4180 reader (quoted fields, "" escapes, CRLF rows).
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const QB_HEADERS = 'Invoice No.,Customer,Invoice Date,Due Date,Item(Product/Service),Item Description,Item Quantity,Item Rate,Item Amount,Taxable,Service Date';

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
    page.on('pageerror', e => { pageErrors.push(e.message); console.log('FAIL: uncaught page error: ' + e.message); failed = true; });
    await page.addInitScript(() => { window.print = () => {}; });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#upload-screen:not([hidden])', { timeout: 10000 });
    return page;
  }
  const refresh = page => page.evaluate(() => { applyFeatureNav(); rerenderCurrent(); });
  // Owner stub (PASTE mode has no sign-in). Full init once: owner caches seeded, InvoiceStore wired with a
  // log writer that looks Endpoint.upsertLogRows up at call time (so the failure stub below takes effect).
  const ownerInit = (page, extra = {}) => page.evaluate(async (extra) => {
    Features._setForTests({ ...Features.defaults('t@x'), jobCard: { on: true, users: ['t@x'] }, billing: { on: true, users: ['t@x'] }, ...extra }, 't@x');
    await OwnerStore.loadAll(); OwnerStore.onChange(rerenderCurrent);
    InvoiceStore.init(null, { getIdToken: async () => 't', upsertLogRows: (rows, token) => Endpoint.upsertLogRows(rows, token), hasDatabase: () => false });
    await InvoiceStore.loadAll(); InvoiceStore.onChange(rerenderCurrent);
    window.__origUpsert = Endpoint.upsertLogRows;
    window.__origLock = InvoiceStore.lockAndCreate;
    applyFeatureNav(); rerenderCurrent();
  }, extra);
  const switches = (page, extra = {}) => page.evaluate(extra => {
    Features._setForTests({ ...Features.defaults('t@x'), jobCard: { on: true, users: ['t@x'] }, billing: { on: true, users: ['t@x'] }, ...extra }, 't@x');
    applyFeatureNav(); rerenderCurrent();
  }, extra);

  const toProjects = page => page.evaluate(() => showProjectsScreen());
  const openCard = async (page, orderNo) => {
    await toProjects(page);
    await page.locator('.project-card', { hasText: 'Order_' + orderNo }).locator('.project-card-name').click();
    await page.waitForSelector('#content-screen:not([hidden])');
    await page.waitForSelector('#owner-panel:not([hidden])');
  };
  // Upload through the UI; with the jobDetails switch on, fill the job-details form (customer via "Other…", standard turnaround).
  const uploadJob = async (page, files, customer) => {
    await page.setInputFiles('#file-input', files);
    if (customer) {
      await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
      await page.selectOption('#job-details-customer', '__other__');
      await page.fill('#job-details-customer-other', customer);
      await page.click('#job-details-confirm');
      await page.waitForSelector('#job-details-overlay', { state: 'hidden' });
    }
    await page.waitForSelector('#projects-screen:not([hidden])');
    await page.waitForTimeout(300);
  };
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
    // this line's own note shows in the panel and the form cleared (the "N h added." text can be left over from an earlier add on the same job)
    await page.waitForFunction(n => document.getElementById('owner-panel').textContent.includes(n) && !document.querySelector('#owner-panel [data-line-note]').value, note);
  };
  const openBilling = async (page, everything = true) => {
    await toProjects(page);
    await page.click('#billing-btn');
    await page.waitForSelector('#billing-screen:not([hidden])');
    await page.waitForFunction(() => !/Loading/.test(document.getElementById('billing-customers').textContent));
    if (everything) { await page.click('#billing-pick-btn'); await page.click('#billing-everything-btn'); await page.waitForTimeout(100); }   // weekly-billing 05: the date box lives behind "Pick a date yourself"
  };
  const priceOf = (page, customerName) => page.evaluate(name => {
    const m = BillingScreen.buildModel(null);
    const c = m.customers.find(x => x.customerName === name);
    return Pricing.priceInvoice(BillingModel.pricingInput(c, {}, { priceList: c.priceList, laborTypes: OwnerStore.laborTypes() })).total;
  }, customerName);
  const fmt = (page, n) => page.evaluate(n => BillingScreen.fmtMoney(n), n);
  const card = (page, name) => page.locator('.billing-card', { hasText: name });
  const downloadCsv = async (page) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#invoice-download-btn')]);
    return dl;
  };

  // ── 1. Collin: nothing new (the Phase 1 Collin assertions, plus no Billing button) ──
  let page = await fresh();
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#projects-screen:not([hidden])'); await page.waitForTimeout(300);
  assert(await page.isHidden('#billing-btn'), '1 Collin: no Billing button');
  assert(await page.isHidden('#billing-recent-jobs') || (await page.textContent('#billing-recent-jobs')) === '', '1 Collin: no Recent jobs block');
  assert(await page.isHidden('#settings-btn'), '1 Collin: no Settings button');
  assert(await page.isHidden('#projects-show-finished-wrap'), '1 Collin: no Show finished jobs toggle');
  assert(await page.$eval('#job-details-overlay', el => el.classList.contains('hidden')), '1 Collin: upload opens no job-details form');
  assert((await page.$$('.jc-chip')).length === 0, '1 Collin: board card has no chip');
  await page.click('.project-card');
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(await page.isHidden('#owner-panel'), '1 Collin: no owner panel on the job card');
  assert((await page.$$('.jc-row-tags')).length === 0, '1 Collin: sidebar rows carry no tags');
  const headerButtons = await page.$$eval('#content-screen .header-right button', bs => bs.map(b => b.id));
  assert(JSON.stringify(headerButtons) === JSON.stringify(['dark-mode-btn', 'vanlab-print-btn', 'job-stickers-btn', 'print-ticket-btn', 'export-btn', 'reset-btn']), '1 Collin: job header buttons Print Ticket just left of Export CSV');
  dialogs = [];
  const collinDl = page.waitForEvent('download');
  await page.click('#export-btn');
  await page.waitForSelector('#customer-picker-overlay:not(.hidden)');
  await page.selectOption('#customer-picker-select', '__other__');
  await page.fill('#customer-picker-other', 'Harbor Lane Pictures');
  await page.click('#customer-picker-confirm');
  const collinFile = await collinDl;
  assert(/Harbor Lane Pictures/.test(collinFile.suggestedFilename()), '1 Collin: export CSV named under the customer folder');
  await page.waitForTimeout(500);
  assert(!dialogs.some(d => d.startsWith('confirm:')), '1 Collin: NO "Delete …?" confirm after a successful log write');
  assert(await page.evaluate(() => sheets.length === 0), '1 Collin: finished sheets left the in-memory board');
  assert(await page.isVisible('#projects-screen') && await page.isHidden('#upload-screen'), '1 Collin: empty board after finishing lands on Projects');
  await page.close();

  // ── 2. Owner, billing off ──
  page = await fresh();
  await ownerInit(page, { billing: { on: false, users: [] } });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Northlight Studios');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#projects-screen:not([hidden])');
  assert(await page.isVisible('#settings-btn') && await page.isHidden('#billing-btn'), '2 Owner with Billing off: Billing button hidden (Settings still shown)');
  await page.close();

  // ── 3. Owner, billing on: upload → details → cut → Done → Billing ──
  page = await fresh();
  await ownerInit(page);
  await page.setInputFiles('#file-input', [join(dst, sample), join(dst, sample10)]);
  await page.waitForSelector('#job-details-overlay:not(.hidden)', { timeout: 10000 });
  assert(/2 repeat|1 repeat/.test(await page.textContent('#job-details-summary')), '3 job details form shows the repeat (sheet 10 repeats sheet 9)');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Northlight Studios');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay', { state: 'hidden' });
  await page.waitForSelector('#projects-screen:not([hidden])');
  assert(await page.isVisible('#billing-btn'), '3 owner with Billing on: Billing button visible');
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
  await page.click('#job-stickers-btn');
  assert(await page.isVisible('#job-stickers-panel'), '3 the Stickers panel opens on a Billing-opened card');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#billing-screen:not([hidden])');
  assert(await page.isHidden('#job-stickers-panel'), '3 Back to Billing closes the Stickers panel');
  assert(/· 1\.5 h Design$/.test((await page.textContent('.billing-row-detail')).trim()), '3 Back landed on Billing; the row detail ends "1.5 h Design"');
  await openCard(page, 1195);
  assert(/Projects/.test(await page.textContent('#back-to-projects-btn')), '3 opened from Projects: Back reads "← Projects" again');
  await openBilling(page);
  const X = await priceOf(page, 'Northlight Studios');
  const billText = (await page.textContent('button[data-act="bill"]')).trim();
  assert(X % 5 === 0 && X >= 150, `3 Bill amount ${X} is a multiple of 5 and at least 150`);
  assert(billText === `Bill Northlight Studios · ${await fmt(page, X)}`, `3 Bill button reads "${billText}" = priceInvoice total (sheets + 1.5 h Design)`);

  // ── 3b. Board changes reload the finished list quietly; a failed quiet reload keeps the old list ──
  // A probe finished job is served by a patched Storage.loadFinishedSheets; a sheet appearing and
  // leaving the board triggers the reload (`sheets` is app.js's top-level board list).
  const probeIn = () => page.evaluate(() => BillingScreen.buildModel().needsDetails.some(j => j.jobName === 'NL_Probe_Job'));
  const boardBlip = () => page.evaluate(() => {
    const extra = { ...sheets[0], fileKey: 'blip_key' };
    sheets = sheets.concat([extra]); BillingScreen.boardChanged();
    sheets = sheets.filter(s => s.fileKey !== 'blip_key'); BillingScreen.boardChanged();
  });
  await page.evaluate(() => {
    window.__origLoadFinished = Storage.loadFinishedSheets;
    Storage.loadFinishedSheets = async () => [{ ...sheets[0], fileKey: 'probe_fin', fileName: 'NL_Probe_Job_Sheet 1.html', jobName: 'NL_Probe_Job', finished: true }];
  });
  await boardBlip();
  await page.waitForFunction(() => BillingScreen.buildModel().needsDetails.some(j => j.jobName === 'NL_Probe_Job'), null, { timeout: 5000 });
  assert(await page.$$eval('.billing-card', c => c.length) === 1, '3b quiet reload: the customer card stayed on screen');
  await page.evaluate(() => { Storage.loadFinishedSheets = () => Promise.reject(new Error('net blip')); });
  await boardBlip();
  await page.waitForFunction(() => /Couldn't refresh finished jobs \(net blip\)/.test(document.getElementById('billing-status').textContent), null, { timeout: 5000 });
  assert(await probeIn(), '3b failed quiet reload: the finished job is still in the model (no shorter list to bill from)');
  assert(!/Loading…/.test(await page.textContent('#billing-customers')), '3b failed quiet reload: no Loading… flash');
  await page.evaluate(() => { Storage.loadFinishedSheets = window.__origLoadFinished; });
  await boardBlip();
  await page.waitForFunction(() => !BillingScreen.buildModel().needsDetails.some(j => j.jobName === 'NL_Probe_Job'), null, { timeout: 5000 });
  assert(!(await probeIn()), '3b restored: the probe job is gone again');
  await openBilling(page);   // fresh visit clears the status line for the steps below

  // ── 4. Invoice: suggested number and the "already on" check ──
  await page.click('button[data-act="bill"]');
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => /Suggested/.test(document.getElementById('invoice-number-caption').textContent));
  assert(await page.inputValue('#invoice-number') === '3604', '4 suggested invoice number is 3604 (seed 3603)');
  // A dummy imported invoice 3604 for another customer, made through the store's own no-db lock + Imported OK path.
  await page.evaluate(async () => {
    await InvoiceStore.lockAndCreate({ number: 3604, customerKey: 'cust_copperline_dummy', customerName: 'Copperline Stage', sheetKeys: [], laborLineRefs: [], total: 100, csv: 'x', perSheet: {}, fingerprint: { sheets: {}, jobs: {} } }, 't@x');
    await InvoiceStore.markImported(3604, 't@x');
  });
  assert(await page.evaluate(() => InvoiceStore.get(3604) && InvoiceStore.get(3604).status === 'imported'), '4 dummy imported invoice 3604 is in the cache');
  await page.fill('#invoice-number', '3604');
  await page.waitForFunction(() => /already on Copperline Stage/.test(document.getElementById('invoice-number-check').textContent), null, { timeout: 5000 });
  assert(await page.$eval('#invoice-number-check', e => e.classList.contains('invoice-check--error')), '4 typing 3604: red "already on Copperline Stage"');
  assert(await page.isDisabled('#invoice-download-btn'), '4 typing 3604: the download button is disabled');
  await page.fill('#invoice-number', '3605');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'), null, { timeout: 5000 });
  assert(await page.isEnabled('#invoice-download-btn'), '4 back to 3605: the download button is enabled');

  // ── 5. Lock before download ──
  let stray = 0;
  const onDl = () => { stray++; };
  page.on('download', onDl);
  await page.evaluate(() => { InvoiceStore.lockAndCreate = () => Promise.reject(Object.assign(new Error('x'), { code: 'sheet-taken' })); });
  await page.click('#invoice-download-btn');
  await page.waitForTimeout(1500);
  page.off('download', onDl);
  assert(stray === 0, '5 rejected lock (sheet-taken): NO download event within 1500 ms');
  assert(/Another owner just billed some of these\. Back to Billing\./.test(await page.textContent('#invoice-status')), '5 rejected lock: the message is visible');
  assert(await page.evaluate(() => InvoiceStore.inProgress().length === 0), '5 rejected lock: nothing was locked');
  await page.evaluate(() => { InvoiceStore.lockAndCreate = window.__origLock; });

  // ── 6. Download ──
  const dl = await downloadCsv(page);
  assert(/QuickBooks Exports.*Northlight Studios.*3605\.csv/.test(dl.suggestedFilename()), '6 download filename: ' + dl.suggestedFilename());
  const buf = readFileSync(await dl.path());
  assert(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, '6 file starts with the UTF-8 BOM (EF BB BF)');
  const csvRows = parseCsv(buf.toString('utf8').replace(/^\ufeff/, '')).filter(r => r.length > 1 || r[0] !== '');
  assert(csvRows[0].join(',') === QB_HEADERS, '6 line 1 is the 11 QuickBooks headers');
  const dataRows = csvRows.slice(1);
  assert(dataRows.length > 0 && dataRows.every(r => r[0] === '3605' && r[1] === 'Northlight Studios'), `6 every data row (${dataRows.length}) starts "3605,Northlight Studios,"`);
  const sum = Math.round(dataRows.reduce((s, r) => s + parseFloat(r[8]), 0) * 100) / 100;
  assert(sum === X, `6 the amounts sum to ${sum} = X (${X})`);
  assert(dataRows.some(r => /^Design — Layout \(1\.5 hrs @ \$150\/hr\)/.test(r[5])), '6 the CSV carries the Design line');
  await page.waitForTimeout(300);
  await openCard(page, 1195);
  assert(/On invoice 3605 \(in progress\)/.test(await page.textContent('#content-screen')), '6 job card says "On invoice 3605 (in progress)"');
  await openBilling(page, false);
  await page.waitForSelector('.billing-reminder');
  assert(/Invoice 3605 is still in progress/.test(await page.textContent('.billing-reminder')), '6 Billing shows the amber reminder for invoice 3605');

  // ── 7. Cancel, then bill again with 3605 → Imported OK → Done ──
  await page.click('.billing-reminder button[data-act="cancel"]');
  await page.waitForFunction(() => !document.querySelector('.billing-reminder'));
  await page.click('#billing-pick-btn'); await page.click('#billing-everything-btn');   // fresh visit = rhythm mode; the date box is behind "Pick a date yourself"
  assert((await page.$$('button[data-act="bill"]')).length === 1 && (await page.$$('.billing-card')).length === 1, '7 Cancel: the Northlight card and its Bill button are back');
  await openCard(page, 1195);
  const tags = await page.$$eval('.jc-row-tags', els => els.map(e => e.textContent));
  assert(tags.length === 2 && tags.every(t => /^Cut/.test(t) && !/On invoice/.test(t)), '7 Cancel: both sheets are back to Cut on the job card');
  await openBilling(page);
  await page.click('button[data-act="bill"]');
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.fill('#invoice-number', '3605');
  await page.waitForFunction(() => /was cancelled earlier/.test(document.getElementById('invoice-number-check').textContent), null, { timeout: 5000 });
  assert(await page.isEnabled('#invoice-download-btn'), '7 bill again with 3605: soft "was cancelled earlier" note, Download enabled');
  await downloadCsv(page);
  await page.waitForSelector('#invoice-imported-btn:not([disabled])');
  await page.click('#invoice-imported-btn');
  await page.waitForSelector('#billing-done-screen:not([hidden]) .done-headline');
  const doneText = await page.innerText('#billing-done-screen');
  assert(doneText.includes('2 sheets billed on invoice #3605'), '7 Done: "2 sheets billed on invoice #3605"');
  assert(doneText.includes('The Master Job Log now has #3605 on all 2 rows.'), '7 Done: the log line says the log was updated');
  await page.click('#billing-done-screen [data-act="jobs"]');
  await openCard(page, 1195);
  assert(/Billed · #3605/.test(await page.textContent('#content-screen')), '7 job card says "Billed · #3605"');
  assert(/Billed · #3605/.test(await page.$eval('#owner-panel .jc-chip--ready', e => e.textContent)), '7 job chip reads "Billed · #3605"');
  assert((await page.$$eval('#owner-panel .jc-labor .jc-caption', els => els.map(e => e.textContent))).some(t => /^Billed · #3605$/.test(t)), '7 the Design line reads "Billed · #3605"');
  await openBilling(page);
  assert((await page.$$('.billing-card')).length === 0 && !/Northlight/.test(await page.textContent('#billing-customers')), '7 Billing has no Northlight card any more');
  assert(await page.locator('.billing-recent-row[data-number="3605"]').count() === 1, '7 Recent invoices lists 3605');

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

  // ── 8. Add PO ──
  await openBilling(page, false);   // 7c ended on Projects (Put back)
  await page.click('.billing-recent-row[data-number="3605"] [data-act="add-po"]');
  await page.fill('input[data-po]', 'PO-4471');
  await page.click('[data-act="save-po"]');
  await page.waitForFunction(() => /PO PO-4471/.test(document.querySelector('.billing-recent-row[data-number="3605"]').innerText));
  assert(true, '8 PO-4471 shown on the 3605 row');
  assert(await page.evaluate(() => InvoiceStore.get(3605).poNumber === 'PO-4471'), '8 PO saved on the invoice');

  // ── 9. Log failure → Done warning → Retry ──
  await toProjects(page);
  await uploadJob(page, FILE_B, 'Copperline Stage');
  await openCard(page, 1201);
  await cutAll(page, 1);
  await addHours(page, 'Design', '0.5', 'Sketch');
  await openBilling(page);
  await card(page, 'Copperline Stage').locator('button[data-act="bill"]').click();
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => /Suggested/.test(document.getElementById('invoice-number-caption').textContent));
  const num2 = await page.inputValue('#invoice-number');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'));
  await downloadCsv(page);
  await page.waitForSelector('#invoice-imported-btn:not([disabled])');
  await page.evaluate(() => { Endpoint.upsertLogRows = () => Promise.reject(new Error('Apps Script timed out')); });
  await page.click('#invoice-imported-btn');
  await page.waitForSelector('#billing-done-screen:not([hidden]) .done-headline');
  assert(/The log could not be updated \(Apps Script timed out\) — retry from Billing\./.test(await page.innerText('#billing-done-screen')), `9 Done (invoice ${num2}) shows the "could not be updated" line`);
  await page.click('#billing-done-screen [data-act="next"]');
  await page.waitForSelector(`.billing-recent-row[data-number="${num2}"]`);
  assert(await page.locator(`.billing-recent-row[data-number="${num2}"] [data-act="retry-log"]`).count() === 1, '9 Recent invoices shows Retry log update');
  await page.evaluate(() => { Endpoint.upsertLogRows = window.__origUpsert; });
  await page.click(`.billing-recent-row[data-number="${num2}"] [data-act="retry-log"]`);
  await page.waitForFunction(n => !document.querySelector(`.billing-recent-row[data-number="${n}"] .billing-recent-note`), num2);
  assert(await page.evaluate(n => InvoiceStore.get(n).logWritten === true, Number(num2)), '9 restored + Retry: the note is gone and the log is written');

  // ── 9b. 0.5 h after 0.5 h billed: a $0.00 line, still shown with its hours ──
  await openCard(page, 1201);
  await addHours(page, 'Design', '0.5', 'Revisions');
  await openBilling(page);
  const ccRow = card(page, 'Copperline Stage').locator('.billing-row--labor-only');
  assert(await ccRow.count() === 1 && (await ccRow.locator('.billing-row-amt').textContent()).trim() === '$0', '9b Copperline: labor-only row at $0 (the 1-h minimum was charged on the first bill)');
  assert(/Bill Copperline Stage · \$0$/.test((await card(page, 'Copperline Stage').locator('button[data-act="bill"]').textContent()).trim()), '9b the Bill button reads "Bill Copperline Stage · $0"');
  await card(page, 'Copperline Stage').locator('button[data-act="bill"]').click();
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'));
  const num3 = await page.inputValue('#invoice-number');
  const dl0 = await downloadCsv(page);
  const rows0 = parseCsv(readFileSync(await dl0.path()).toString('utf8').replace(/^\ufeff/, '')).filter(r => r.length > 1 || r[0] !== '').slice(1);
  assert(rows0.length === 1 && parseFloat(rows0[0][8]) === 0 && rows0[0][5] === 'Design — Revisions (0.5 hrs, covered by the 1-hr minimum)', '9b the $0 invoice CSV has one labor row: amount 0, "Design — Revisions (0.5 hrs, covered by the 1-hr minimum)" (got ' + JSON.stringify(rows0.map(r => [r[5], r[8]])) + ')');
  await page.waitForSelector('#invoice-imported-btn:not([disabled])');
  await page.click('#invoice-imported-btn');
  await page.waitForSelector('#billing-done-screen:not([hidden]) .done-headline');
  await page.click('#billing-done-screen [data-act="next"]');
  await page.waitForSelector('.billing-recent-row[data-number="' + num3 + '"]');
  assert(/\$0(?![\d.])/.test(await page.locator('.billing-recent-row[data-number="' + num3 + '"]').innerText()), '9b Recent invoices shows ' + num3 + ' at $0');
  // (the Copperline $0 row stays on Billing for the rest of the run; steps 10–13 only look at other customers)

  // ── 10. Through date ──
  await toProjects(page);
  await uploadJob(page, FILE_C, 'Ridgeway Vans');
  await openCard(page, 1202);
  await cutAll(page, 1);
  const setThrough = (p, which) => p.evaluate(which => {
    const d = new Date(); const p2 = n => String(n).padStart(2, '0');
    const ymd = x => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
    if (document.getElementById('billing-through-date').hidden) document.getElementById('billing-pick-btn').click();   // the date box lives behind "Pick a date yourself"
    const el = document.getElementById('billing-through-date');
    el.value = ymd(which === 'tomorrow' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) : d);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }, which);
  await openBilling(page, false);
  const today = await setThrough(page, 'today');
  assert(await card(page, 'Ridgeway Vans').locator('.billing-row').count() === 1, `10 through ${today}: Ridgeway Vans' row is listed`);
  // correct the cut date to the day after the through date, on the job card
  await openCard(page, 1202);
  const tomorrow = await page.evaluate(() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; });
  await page.click('#owner-panel [data-action="cutdate"]');
  await page.fill('#owner-panel [data-cutdate-input]', tomorrow);
  await page.click('#owner-panel [data-action="cutdate-save"]');
  await page.waitForFunction(() => /cut date corrected to/.test(document.getElementById('owner-panel').textContent));
  await openBilling(page, false);
  await setThrough(page, 'today');
  const ridgeText = await card(page, 'Ridgeway Vans').textContent();
  assert(/waits for next week/.test(ridgeText) && await card(page, 'Ridgeway Vans').locator('.billing-row').count() === 0, '10 cut date moved past the through date: the row moves to "waits for next week"');
  await page.click('#billing-everything-btn');
  assert(await card(page, 'Ridgeway Vans').locator('.billing-row').count() === 1 && /Everything cut so far/.test(await page.textContent('#billing-through-caption')), '10 Everything to date brings the row back');

  // ── 11. Needs job details (jobDetails switched off) ──
  await switches(page, { jobDetails: { on: false, users: [] } });
  await toProjects(page);
  await uploadJob(page, FILE_D, null);
  assert(await page.$eval('#job-details-overlay', el => el.classList.contains('hidden')), '11 jobDetails off: the upload opened no form');
  await openBilling(page);
  const need = page.locator('.billing-need', { hasText: 'Order_1203' });
  assert(await need.count() === 1 && /Needs job details/.test(await page.textContent('#billing-needs')), '11 Billing lists the job under Needs job details');
  await need.locator('button[data-act="open-job"]').click();
  await page.waitForSelector('#content-screen:not([hidden])');
  assert(/No customer yet/.test(await page.textContent('#owner-panel')) && /Order_1203/.test(await page.textContent('#header-job-name')), '11 Open job card opens that job (no customer yet)');
  // give it details so the Design/CAM hint can be checked in 13
  await switches(page);
  await page.click('#owner-panel [data-action="edit"]');
  await page.waitForSelector('#job-details-overlay:not(.hidden)');
  await page.selectOption('#job-details-customer', '__other__');
  await page.fill('#job-details-customer-other', 'Harbor Lane Pictures');
  await page.click('#job-details-confirm');
  await page.waitForSelector('#job-details-overlay', { state: 'hidden' });

  // ── 12. Billed outside this app ──
  await openBilling(page);
  assert(await card(page, 'Ridgeway Vans').count() === 1, '12 before: Ridgeway Vans has a Billing card');
  await toProjects(page);
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-screen:not([hidden])');
  await page.click('#settings-customers-list input[data-customer][data-name="Ridgeway Vans"]');
  await page.waitForFunction(() => /Ridgeway Vans: billed outside this app/.test(document.getElementById('settings-status').textContent));
  await openBilling(page);
  assert(await card(page, 'Ridgeway Vans').count() === 0, '12 Billed outside this app ticked: the Ridgeway Vans card disappears');

  // ── 13. Settings ──
  await toProjects(page);
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-screen:not([hidden])');
  const ids = ['handlingFirst', 'handlingRepeat', 'hourlyRate', 'rush48Pct', 'rush24Pct', 'weekendPct', 'cutMinimum', 'roundTo'];
  const prices = [];
  for (const id of ids) prices.push(await page.inputValue('#settings-price-' + id));
  assert(prices.join('/') === '60/40/135/50/75/50/150/5', '13 Prices card shows ' + prices.join('/'));
  const typeNames = await page.$$eval('#settings-labor-body input[data-f="name"]', els => els.map(e => e.value));
  assert(typeNames.join(',') === 'Design,CAM', '13 Labor types shows ' + typeNames.join(','));
  // Design carries unbilled hours now (steps 7b / 9b), so it cannot be removed; CAM is unused and can.
  const rowOf = n => page.locator('#settings-labor-body tr', { has: page.locator('input[data-f="name"][value="' + n + '"]') });
  await rowOf('Design').locator('button[data-lt-remove]').click();
  assert(/Design is used on \d+ jobs? that (isn.t|aren.t) billed yet/.test(await page.textContent('#settings-status')), '13 Design (unbilled hours on jobs) cannot be removed: "' + (await page.textContent('#settings-status')) + '"');
  await rowOf('CAM').locator('button[data-lt-remove]').click();
  await page.click('#settings-labor-save');
  await page.waitForFunction(() => /Labor types saved./.test(document.getElementById('settings-status').textContent));
  assert(await page.evaluate(() => OwnerStore.laborTypes().map(t => t.name).join(',') === 'Design'), '13 the unused CAM type was removed and saved; Design stays');
  await page.evaluate(() => { window.__realLT = OwnerStore.laborTypes; OwnerStore.laborTypes = () => []; });
  await openCard(page, 1203);
  assert(/No Design\/CAM types yet/.test(await page.textContent('#owner-panel')), '13 with no types the job card shows "No Design/CAM types yet"');
  await page.evaluate(() => { OwnerStore.laborTypes = window.__realLT; });
  await page.close();

  // ── 15. Weekly billing (spec .scratch/weekly-billing): sections, week-ending wording, hours placement, rhythm setting ──
  // Fresh page = fresh in-memory state. Cut dates are seeded relative to the real today from BillingModel.lastFinishedWeekEnd, so
  // the check works on any weekday (including the week-ending day itself): W2 = last finished week-ending day, W1 = a week before.
  page = await fresh();
  await ownerInit(page);
  const D = await page.evaluate(() => {
    const p = n => String(n).padStart(2, '0');
    const ymd = x => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    const off = (s, n) => { const [a, b, c] = s.split('-').map(Number); return ymd(new Date(a, b - 1, c + n)); };
    const lw = BillingModel.lastFinishedWeekEnd(ymd(new Date()), OwnerStore.invoicing().weekEndingDay);
    return { w2: lw, w1: off(lw, -7), cut1: off(lw, -9), cut2: off(lw, -2) };   // cut dates are mid-week (no weekend uplift)
  });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymdParts = s => s.split('-').map(Number);
  const mdy = s => { const [y, m, d] = ymdParts(s); return `${m}/${d}/${y}`; };
  const shortD = s => { const [, m, d] = ymdParts(s); return `${MON[m - 1]} ${d}`; };
  const longD = s => { const [y, m, d] = ymdParts(s); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''); };
  const money = t => parseFloat(String(t).replace(/[^0-9.]/g, ''));
  console.log(`15 seeded weeks: W1 ${D.w1} (cut ${D.cut1}), W2 ${D.w2} (cut ${D.cut2})`);

  // Birchwood Signs (weekly, no cadence field): job 1195 = a design in sheet 9 (W1) repeated in sheet 10 (W2); job 1201 cut in W2; job 1202 cut today (current week).
  await uploadJob(page, [join(dst, sample), join(dst, sample10)], 'Birchwood Signs');
  await uploadJob(page, FILE_B, 'Birchwood Signs');
  await uploadJob(page, FILE_C, 'Birchwood Signs');
  await uploadJob(page, FILE_D, 'Quarry Road Vans');
  await openCard(page, 1195); await cutAll(page, 2);
  await openCard(page, 1201); await cutAll(page, 1);
  await openCard(page, 1202); await cutAll(page, 1);
  await openCard(page, 1203); await cutAll(page, 1);
  await page.evaluate(async ({ pairs }) => {
    for (const [re, ymd] of pairs) {
      const s = sheets.find(x => new RegExp(re).test(x.fileName));
      const jk = Keys.job(Keys.jobOf(s)); const jb = OwnerStore.getJobBilling(jk);
      await OwnerStore.setCutDateOverride(s.fileKey, ymd, { jobKey: jk, customerKey: jb && jb.customerKey }, 't@x');
    }
  }, { pairs: [['Order_1195.*Sheet 9\\.html', D.cut1], ['Order_1195.*Sheet 10\\.html', D.cut2], ['Order_1201', D.cut2]] });

  const bw = page.locator('section.billing-card[data-cadence="weekly"]', { hasText: 'Birchwood Signs' });
  const week = we => bw.locator(`.billing-week[data-week="${we}"]`);
  await openBilling(page, false);
  assert((await page.textContent('#billing-through-title')).trim() === 'Weekly bills' && await page.isVisible('#billing-pick-btn') && await page.isHidden('#billing-weekly-btn'), '15 a fresh visit is rhythm mode: "Weekly bills", Pick a date yourself shown');
  assert(await bw.count() === 1 && await bw.locator('.billing-week').count() === 2, '15 weekly customer (no cadence field): one card with two week sections');
  assert(JSON.stringify(await bw.locator('.billing-week').evaluateAll(els => els.map(e => e.dataset.week))) === JSON.stringify([D.w1, D.w2]), `15 sections are oldest first: ${D.w1}, ${D.w2}`);
  assert((await bw.locator('.billing-week').first().locator('.billing-week-title').textContent()) === `Week ending ${longD(D.w1)}`, `15 first title reads "Week ending ${longD(D.w1)}"`);
  assert(await page.evaluate(() => { const m = BillingScreen.buildModel(); const c = m.customers.find(x => x.customerName === 'Birchwood Signs'); const f = sheets.find(x => /Order_1202/.test(x.fileName)); return !!c && !!f && c.laterSheets.some(x => x.fileKey === f.fileKey); }), '15 Order_1202 is cut and waiting: it is in the laterSheets of Birchwood Signs');
  assert(await bw.locator('.billing-row', { hasText: 'Order_1202' }).count() === 0, '15 the sheet cut in the current week (Order_1202) is not in any section');
  const billBtn1 = week(D.w1).locator('button[data-act="bill"]');
  assert(await billBtn1.count() === 1 && await week(D.w2).locator('button[data-act="bill"]').count() === 0, '15 only the oldest week has a Bill button');
  const w1Before = money((await billBtn1.textContent()).split('·')[1]);
  assert(new RegExp(`^Bill week ending ${shortD(D.w1)} · \\$[\\d,.]+$`).test((await billBtn1.textContent()).trim()), `15 oldest button reads "Bill week ending ${shortD(D.w1)} · $X" (got ${(await billBtn1.textContent()).trim()})`);
  assert((await week(D.w2).textContent()).includes(`Bill after week ending ${shortD(D.w1)}`) && await week(D.w2).locator('.billing-week-total').count() === 1, `15 later week shows its total and "Bill after week ending ${shortD(D.w1)}"`);
  // $230 pins repeat pricing: Order_1195 sheet 10 repeats sheet 9 (billed in week 1) and Order_1201 is a first copy; priced as a first copy, sheet 10 would make this $250.
  assert((await week(D.w2).locator(".billing-week-total").textContent()).trim() === "$230", `15 week 2 total without hours is exactly $230 (repeat priced as a repeat)`);
  const t2NoHours = money(await week(D.w2).locator('.billing-week-total').textContent());

  // Hours: 2 h Design on the week-2 job (Order_1201) from its job card, via the job-name link; Back returns to Billing.
  await week(D.w2).locator('.billing-row', { hasText: 'Order_1201' }).locator('button[data-act="open-job"]').click();
  await page.waitForSelector('#content-screen:not([hidden])');
  await page.waitForSelector('#owner-panel:not([hidden])');
  await addHours(page, 'Design', '2', 'Weekly fixture layout');
  await page.click('#back-to-projects-btn');
  await page.waitForSelector('#billing-screen:not([hidden])');
  assert(/· 2 h Design$/.test((await week(D.w2).locator('.billing-row', { hasText: 'Order_1201' }).locator('.billing-row-detail').textContent()).trim()), '15 the 2 h Design shows on the week-2 row (Order_1201)');
  assert((await week(D.w1).textContent()).indexOf('Design') === -1, '15 week 1 shows no Design hours');
  const w1After = money((await billBtn1.textContent()).split('·')[1]);
  const t2 = money(await week(D.w2).locator('.billing-week-total').textContent());
  assert(w1After === w1Before, `15 week 1 Bill amount unchanged by the hours (${w1Before} -> ${w1After})`);
  assert(t2 > t2NoHours, `15 week 2 total rose with the hours (${t2NoHours} -> ${t2})`);

  // Bill week 1: the Invoice screen preview (BEFORE Download) already reads "Week ending M/D/YYYY"; its total = the button.
  await billBtn1.click();
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'), null, { timeout: 5000 });
  const wk1 = `Week ending ${mdy(D.w1)}`;
  const previewLines = await page.$$eval('.invoice-preview-line', els => els.map(e => e.firstElementChild.textContent));
  assert(previewLines.includes(wk1), `15 Invoice screen preview (before Download) has the cutting line exactly "${wk1}" (got ${JSON.stringify(previewLines)})`);
  assert(money(await page.textContent('#invoice-total')) === w1Before, `15 Invoice screen total ${await page.textContent('#invoice-total')} = the week's Bill button amount ${w1Before}`);
  const wnum = await page.inputValue('#invoice-number');
  const wdl = await downloadCsv(page);
  const wrows = parseCsv(readFileSync(await wdl.path()).toString('utf8').replace(/^﻿/, '')).filter(r => r.length > 1 || r[0] !== '').slice(1);
  assert(wrows.some(r => r[5] === wk1), `15 downloaded CSV has the cutting line "${wk1}"`);
  assert(Math.round(wrows.reduce((s, r) => s + parseFloat(r[8]), 0) * 100) / 100 === w1Before, '15 downloaded CSV amounts sum to the Bill amount');
  assert(await page.evaluate(([n, line]) => InvoiceStore.get(Number(n)).csv.includes(line), [wnum, wk1]), '15 the stored invoice CSV has the same line');

  // Invoice in progress: the weekly card shows no dollars for week 2 and no enabled Bill button.
  await openBilling(page, false);
  await page.waitForSelector('.billing-reminder');
  assert((await bw.textContent()).includes(`Total shown after invoice ${wnum} is finished`), `15 in progress: card says "Total shown after invoice ${wnum} is finished"`);
  assert(await bw.locator('.billing-week-total').count() === 0 && !/\$/.test(await week(D.w2).textContent()), '15 in progress: week 2 shows no dollar amount');
  assert(await bw.locator('button[data-act="bill"]:not([disabled])').count() === 0, '15 in progress: no enabled Bill button on the weekly card');

  // Imported OK: week 2 is now the oldest, billable, same total as its preview.
  await page.click('.billing-reminder button[data-act="imported"]');
  await page.waitForSelector('#billing-done-screen:not([hidden]) .done-headline');
  await page.click('#billing-done-screen [data-act="next"]');
  await page.waitForSelector('#billing-screen:not([hidden])');
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('billing-customers').textContent));
  await page.waitForSelector(`section.billing-card[data-cadence="weekly"] .billing-week[data-week="${D.w2}"] button[data-act="bill"]`);
  assert(await bw.locator('.billing-week').count() === 1 && await week(D.w1).count() === 0, '15 after Imported OK: week 1 is gone, week 2 is the only section');
  const w2Btn = week(D.w2).locator('button[data-act="bill"]');
  assert(new RegExp(`^Bill week ending ${shortD(D.w2)} · `).test((await w2Btn.textContent()).trim()), '15 week 2 now has the Bill button');
  const w2Bill = money((await w2Btn.textContent()).split('·')[1]);
  assert(w2Bill === t2, `15 week 2's total is the same number once it is the oldest (${t2} -> ${w2Bill})`);
  await w2Btn.click();
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'), null, { timeout: 5000 });
  const wk2 = `Week ending ${mdy(D.w2)}`;
  assert((await page.$$eval('.invoice-preview-line', els => els.map(e => e.firstElementChild.textContent))).includes(wk2), `15 week 2 preview has "${wk2}"`);
  assert(money(await page.textContent('#invoice-total')) === w2Bill, `15 week 2 Invoice screen total = Bill amount ${w2Bill}`);
  await page.click('#invoice-back-btn');   // not locked: nothing downloaded

  // Pick a date yourself / Back to weekly bills.
  await page.waitForSelector('#billing-screen:not([hidden])');
  await page.click('#billing-pick-btn');
  assert(await page.isVisible('#billing-through-date') && await page.isVisible('#billing-weekly-btn') && await page.isHidden('#billing-pick-btn'), '15 Pick a date yourself: date box and Back to weekly bills show');
  assert(await page.locator('section.billing-card[data-cadence="weekly"]').count() === 0 && await page.locator('.billing-week').count() === 0, "15 hand mode: today's single-card layout (no week sections)");
  const hb = card(page, 'Birchwood Signs');
  assert(await hb.count() === 1 && await hb.locator('button[data-act="bill"]').count() === 1 && (await hb.locator('button[data-act="bill"]').textContent()).trim().startsWith('Bill Birchwood Signs · '), '15 hand mode: Birchwood Signs is one plain card with one "Bill Birchwood Signs · $X" button');
  assert(await hb.locator('.billing-row', { hasText: 'Order_1195' }).count() === 1 && await hb.locator('.billing-row', { hasText: 'Order_1201' }).count() === 1 && await hb.locator('.billing-row', { hasText: 'Order_1202' }).count() === 0, '15 hand mode (prefilled with the last finished week-ending day): rows Order_1195 and Order_1201, not Order_1202');
  await page.click('#billing-weekly-btn');
  assert(await bw.locator('.billing-week').count() === 1 && await page.isVisible('#billing-pick-btn'), '15 Back to weekly bills: sections are back');

  // Settings > Customers: Billing choice (Weekly by default, writes cadence, Billing follows).
  const qKey = await page.evaluate(() => Keys.customer('Quarry Road Vans'));
  const qCard = card(page, 'Quarry Road Vans');
  assert(await qCard.count() === 1 && await qCard.locator('.billing-row').count() === 0, '15 Quarry Road Vans (weekly by default): the sheet cut today waits - no row yet');
  await toProjects(page);
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-screen:not([hidden])');
  const sel = page.locator(`select[data-cadence="${qKey}"]`);
  assert(await sel.inputValue() === 'weekly' && await page.evaluate(k => { const cb = OwnerStore.getCustomerBilling(k); return !(cb && cb.cadence); }, qKey), '15 Settings Billing select shows Weekly with no cadence stored');
  await sel.selectOption('toDate');
  await page.waitForFunction(() => /Quarry Road Vans: billed everything to date/.test(document.getElementById('settings-status').textContent));
  assert(await page.evaluate(k => OwnerStore.getCustomerBilling(k).cadence === 'toDate', qKey), '15 changing the select wrote cadence "toDate"');
  await openBilling(page, false);
  assert(await qCard.count() === 1 && await qCard.getAttribute('data-cadence') === null && await qCard.locator('button[data-act="bill"]').count() === 1, '15 Billing follows: Quarry Road Vans is a plain card with one Bill button');
  assert(await qCard.locator('.billing-row', { hasText: 'Order_1203' }).count() === 1, '15 Everything to date includes the sheet cut today');
  const qAmt = money((await qCard.locator('button[data-act="bill"]').textContent()).split('·')[1]);
  await qCard.locator('button[data-act="bill"]').click();
  await page.waitForSelector('#invoice-screen:not([hidden])');
  await page.waitForFunction(() => document.getElementById('invoice-number-check').classList.contains('invoice-check--ok'), null, { timeout: 5000 });
  const qLines = await page.$$eval('.invoice-preview-line', els => els.map(e => e.firstElementChild.textContent));
  assert(qLines.some(l => l.startsWith('CNC cutting — ')) && !qLines.some(l => l.startsWith('Week ending')), `15 Everything-to-date preview keeps today's wording (${JSON.stringify(qLines)})`);
  assert(money(await page.textContent('#invoice-total')) === qAmt, `15 Everything-to-date Invoice total = Bill amount ${qAmt}`);
  const qdl = await downloadCsv(page);
  const qrows = parseCsv(readFileSync(await qdl.path()).toString('utf8').replace(/^﻿/, '')).filter(r => r.length > 1 || r[0] !== '').slice(1);
  assert(qrows.some(r => r[5].startsWith('CNC cutting — ')) && !qrows.some(r => r[5].startsWith('Week ending')), '15 Everything-to-date CSV keeps "CNC cutting — …"');
  console.log(`15 numbers: week1 ${w1Before} (before/after hours ${w1Before}/${w1After}); week2 total ${t2NoHours} without hours, ${t2} with 2 h Design, ${w2Bill} once oldest; invoice ${wnum} total ${w1Before}; Quarry to-date ${qAmt}`);
  await page.close();

  // Collin (operator): no Billing button, no Billing choice, no rhythm buttons.
  page = await fresh();
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#projects-screen:not([hidden])'); await page.waitForTimeout(300);
  assert(await page.isHidden('#billing-btn') && await page.isHidden('#settings-btn') && await page.isHidden('#billing-screen'), '15 Collin: no Billing button, no Settings button, no Billing screen');
  assert(await page.locator('select[data-cadence]').count() === 0 && await page.isHidden('#billing-pick-btn') && await page.isHidden('#billing-weekly-btn'), '15 Collin: no Billing select in the page and the Pick a date / Back to weekly bills buttons are hidden');
  await page.close();

  // ── 14. No uncaught page errors anywhere ──
  assert(pageErrors.length === 0, '14 no uncaught page errors (' + pageErrors.length + ')');
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
