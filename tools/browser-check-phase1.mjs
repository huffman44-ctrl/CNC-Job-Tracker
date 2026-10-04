// tools/browser-check-phase1.mjs — spec §12.4 screen checks for Phase 1, against a PASTE-mode
// copy (Firebase AND endpoint disabled), never the real config. Run from the repo root:
//   node tools/browser-check-phase1.mjs
// Prints PASS:/FAIL: lines and SUITE: PASS|FAIL; exits 1 on any FAIL or thrown error.
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';

const require = createRequire('C:/Users/Golden Boys/Documents/Agemtic Workflows/HQ/package.json');
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5058;
let failed = false;
const assert = (c, m) => { console.log((c ? 'PASS: ' : 'FAIL: ') + m); if (!c) failed = true; };

const dst = mkdtempSync(join(tmpdir(), 'cnc-p1-'));
for (const f of ['index.html', 'css', 'js', 'assets', 'package.json']) cpSync(join(ROOT, f), join(dst, f), { recursive: true });
const sample = readdirSync(ROOT).find(f => /^260520_.*\.html$/.test(f));
cpSync(join(ROOT, sample), join(dst, sample));
// PASTE mode: BOTH configs are overwritten in the COPY before anything is served.
writeFileSync(join(dst, 'js/firebase-config.js'), "const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };\n");
writeFileSync(join(dst, 'js/endpoint-config.js'), "const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };\n");

const server = spawn('npx', ['serve', '.', '-l', String(PORT), '--no-clipboard'], { cwd: dst, shell: true, stdio: 'ignore' });
let browser;
let dialogs = [];

async function main() {
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const s = net.connect(PORT, '127.0.0.1');
      s.once('connect', () => { s.end(); resolve(); });
      s.once('error', () => { if (Date.now() - t0 > 20000) reject(new Error('serve did not start')); else setTimeout(poll, 250); });
    })();
  });

  browser = await chromium.launch();
  async function fresh() {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); d.accept(); });
    page.on('pageerror', e => { console.log('FAIL: uncaught page error: ' + e.message); failed = true; });
    await page.addInitScript(() => { window.print = () => {}; });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
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
  assert(JSON.stringify(headerButtons) === JSON.stringify(['dark-mode-btn', 'vanlab-print-btn', 'export-btn', 'reset-btn']), 'Collin: job header buttons exactly as today');
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
  assert(await page.isVisible('#upload-screen'), 'Collin: empty board after finishing lands on Upload');
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
  const jb = await page.evaluate(() => OwnerStore.getJobBilling(noteKey(sheets[0].jobName)));
  assert(jb && jb.customerName === 'Northlight Studios' && jb.turnaround === 'rush48' && jb.material.kind === 'customer', 'owner: jobBilling written from the form');
  assert(await page.evaluate(() => Storage.getProjectCustomer(noteKey(sheets[0].jobName)) === 'Northlight Studios'), "owner: projectCustomer written (Collin's export reads it)");
  await refresh(page);
  assert(await page.isVisible('#settings-btn'), 'owner: Settings button visible');
  // the chip only exists once the jobCard switch is on
  await setOwner(page, jobCardOn);
  assert(/Not sent to billing yet/.test(await page.textContent('.project-card')), 'owner: board chip reads Not sent to billing yet (jobCard on)');
  dialogs = [];
  const dl2 = page.waitForEvent('download');
  await page.click('.project-card .btn-primary');   // Export CSV on the card
  await dl2;
  await page.waitForTimeout(300);
  assert(await page.$eval('#customer-picker-overlay', el => el.classList.contains('hidden')), 'owner-tagged job: export asks NO customer question');
  assert(!dialogs.some(d => d.startsWith('confirm:')), 'owner-tagged job: no delete prompt');
  await page.close();

  // ── Re-upload guard ──
  page = await fresh();
  await page.evaluate(() => { Features._setForTests(Features.defaults('t@x'), 't@x'); Storage.getSheetDoc = async () => ({ finished: true, finishedAt: Date.now(), jobName: 'Old Job' }); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/already cut and finished on .* \(job Old Job\)/.test(await page.textContent('#notice-modal-text')), 'guard: blocking notice names the date and job');
  assert(await page.evaluate(() => sheets.length === 0), 'guard: nothing was saved or shown');
  await page.close();

  // Guard: a failed lookup blocks the file
  page = await fresh();
  await page.evaluate(() => { Storage.getSheetDoc = async () => { throw new Error('offline'); }; });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#notice-overlay:not(.hidden)', { timeout: 10000 });
  assert(/Couldn't check whether/.test(await page.textContent('#notice-modal-text')), 'guard: a rejected lookup blocks the file with a "Couldn\'t check" notice');
  assert(await page.evaluate(() => sheets.length === 0), 'guard: failed lookup saved nothing');
  await page.close();

  // Guard: same file dropped twice while in flight saves once
  page = await fresh();
  await page.evaluate(() => { Storage.getSheetDoc = () => new Promise(r => setTimeout(() => r(null), 400)); });
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.setInputFiles('#file-input', join(dst, sample));
  await page.waitForSelector('#projects-screen:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(900);
  assert(await page.evaluate(() => sheets.length === 1), 'guard: same file dropped twice while in flight saves once');
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
  assert(await page.$eval('#owner-panel [data-action="done"]', b => b.disabled), 'panel: Done disabled with no labor and no "no design time"');
  await page.fill('#owner-panel [data-line-hours]', '1.5');
  await page.fill('#owner-panel [data-line-note]', 'Bridge wall panels');
  await page.click('#owner-panel [data-action="line-add"]');
  await page.waitForTimeout(200);
  assert(/Bridge wall panels/.test(await page.textContent('#owner-panel')), 'panel: labor line added');
  assert(await page.$eval('#owner-panel [data-action="done"]', b => !b.disabled), 'panel: Done enabled after a labor line');
  const typeOptions = await page.$$eval('#owner-panel [data-line-type] option', os => os.map(o => o.textContent));
  assert(typeOptions.some(t => /Design — \$150\/hr \(min 1 h\)/.test(t)) && typeOptions.some(t => /CAM — \$85\/hr \(min 0.5 h\)/.test(t)), 'panel: labor types come from the seeded settings doc');
  await page.click('#owner-panel [data-action="done"]');
  await page.waitForTimeout(200);
  assert(/Ready for billing ✓/.test(await page.textContent('#owner-panel')), 'panel: Done marks the job ready');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= 320), 'panel: no horizontal scroll at 320px');
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
  try { if (browser) await browser.close(); } catch {}
  server.kill();
  try { rmSync(dst, { recursive: true, force: true }); } catch {}
  console.log(failed ? 'SUITE: FAIL' : 'SUITE: PASS');
  process.exit(failed ? 1 : 0);
}
