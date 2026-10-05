import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

// Fixtures are built by tools/build-pricing-fixtures.mjs from past job exports, with FAKE names (spec §12.1).
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pricing');
const FIXTURES = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const byId = id => FIXTURES.find(f => f.fixture === id);

const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [
  { id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' },
  { id: 'cam', name: 'CAM', rate: 85, minHours: 0.5, qbItem: 'Digital Design' },
];
const CUSTOMER_SUPPLIED = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const jobOf = (fx, extra = {}) => ({ jobName: fx.jobName, turnaround: 'standard', material: CUSTOMER_SUPPLIED, includeLabor: false, laborLines: [], ...extra });

// One fixture -> one job's sheets (cut sheets only; null cutDate rows are not billable and are counted).
function sheetsOf(fx, jobKey, pick = () => true) {
  const all = fx.sheets.filter(pick);
  const cut = all.filter(s => s.cutDate);
  return {
    excluded: all.length - cut.length,
    sheets: cut.map(s => ({
      fileKey: `${fx.fixture}-${s.order}`, jobKey, order: s.order, sheetLabel: s.sheetLabel,
      totalTimeSec: s.totalTimeSec, toolpathCount: s.toolpathCount, hasVbit: s.hasVbit, cutDate: s.cutDate,
    })),
  };
}
const price = (jobs, sheets, extra = {}) => Pricing.priceInvoice({ priceList: STANDARD, laborTypes: LABOR, priorBilled: [], jobs, sheets, ...extra });
const cents = x => Math.round(x * 100);

test('fixtures exist and are fake-named', () => {
  assert.ok(FIXTURES.length >= 40, `expected ~60 fixtures, got ${FIXTURES.length}`);
  const fake = new Set(['Northlight Studios', 'Harbor Lane Pictures', 'Copperline Stage', 'Ridgeway Vans', null]);
  for (const fx of FIXTURES) {
    assert.ok(fake.has(fx.customer), fx.fixture);
    assert.match(fx.jobName, /^[A-Z]{2}_Fixture_\d{2}$/);
    fx.sheets.forEach((s, i) => assert.equal(s.sheetLabel, `Sheet ${i + 1}`));
  }
});

// ---- Invariants on every fixture ------------------------------------------------------------
let priced = 0, excludedTotal = 0, skippedEmpty = 0;
for (const fx of FIXTURES) {
  test(`invariants: ${fx.fixture}`, () => {
    const { sheets, excluded } = sheetsOf(fx, 'J');
    excludedTotal += excluded;
    if (!sheets.length) { skippedEmpty++; return; } // nothing cut -> nothing to bill (priceInvoice refuses)
    priced++;
    const r = price({ J: jobOf(fx) }, sheets);
    const sumCents = r.lines.reduce((a, l) => a + cents(l.amount), 0);
    assert.equal(sumCents, cents(r.total), 'lines add up to the total');
    assert.equal(cents(r.total) % 500, 0, 'multiple of $5 (no material)');
    r.lines.forEach(l => assert.ok(l.amount >= 0, 'no negative line'));
    assert.equal(r.perJob.J.firsts + r.perJob.J.repeats, sheets.length);
    assert.ok(r.total >= 150, 'cut minimum');
    // Raising the hourly rate by $10 never lowers the total; equal only when the minimum dominates
    // (or the extra time charge is smaller than one $5 rounding step).
    const r2 = price({ J: jobOf(fx) }, sheets, { priceList: { ...STANDARD, hourlyRate: 145 } });
    assert.ok(r2.total >= r.total);
    if (r2.total === r.total) {
      const extra = sheets.reduce((a, s) => a + s.totalTimeSec, 0) / 3600 * 10;
      assert.ok(r.total === 150 || extra < 5, `equal total without the minimum dominating (${fx.fixture})`);
    }
  });
}
test('invariants ran on every billable fixture', () => {
  assert.ok(priced >= 40, `priced ${priced}`);
  assert.equal(priced + skippedEmpty, FIXTURES.length);
  assert.ok(excludedTotal > 0, 'some uncut rows were excluded and counted');
});

// ---- Pinned cases: totals derived by hand from the fixture data (rate $135/h = $0.0375/s) -----

// (a) Heavy repeat — job-25: 22 sheets, two designs of 11 (389 s x 11 and 287 s x 11); cut Wed/Thu Aug 5-6 2026.
test('pinned (a) job-25 heavy repeat: 2 firsts + 20 repeats', () => {
  const { sheets } = sheetsOf(byId('job-25'), 'J');
  const r = price({ J: jobOf(byId('job-25')) }, sheets);
  assert.equal(sheets.length, 22);
  assert.equal(r.perJob.J.firsts, 2);
  assert.equal(r.perJob.J.repeats, 20);
  // Handling 2 x 60 + 20 x 40 = 120 + 800 = 920. Time (11 x 389 + 11 x 287) = 4279 + 3157 = 7436 s
  // x 0.0375 = 278.85. No weekend, standard. 920 + 278.85 = 1198.85 -> nearest $5 = 1200. Above the $150 minimum.
  assert.equal(r.total, 1200);
});

// (b) All unique — job-15: 9 distinct times, all Tue Aug 4 2026.
test('pinned (b) job-15 all unique', () => {
  const { sheets } = sheetsOf(byId('job-15'), 'J');
  const r = price({ J: jobOf(byId('job-15')) }, sheets);
  assert.equal(r.perJob.J.repeats, 0);
  // Handling 9 x 60 = 540. Time 1207+1357+1437+1558+1864+3463+1914+893+1075 = 14768 s x 0.0375 = 553.80.
  // 540 + 553.80 = 1093.80 -> nearest $5 = 1095.
  assert.equal(r.total, 1095);
});

// (c) Weekend — job-27: sheets 1-3 Fri Jul 31, sheets 4-5 (5247 s, 3 toolpaths) Sun Aug 2 2026. Sheet 5 repeats sheet 4.
test('pinned (c) job-27 weekend cut dates', () => {
  const { sheets } = sheetsOf(byId('job-27'), 'J');
  assert.deepEqual(sheets.map(s => s.cutDate), ['2026-07-31', '2026-07-31', '2026-07-31', '2026-08-02', '2026-08-02']);
  const r = price({ J: jobOf(byId('job-27')) }, sheets);
  assert.equal(r.perJob.J.repeats, 1);
  // Handling 4 x 60 + 1 x 40 = 280. Time 1788+1543+1037+5247+5247 = 14862 s x 0.0375 = 557.325.
  // Weekend +50% of (handling + time) on the two Sunday sheets: sheet 4 (60 + 5247 x 0.0375 = 60 + 196.7625) x 0.5 = 128.38125;
  // sheet 5 (40 + 196.7625) x 0.5 = 118.38125; premium 246.7625.
  // 280 + 557.325 + 246.7625 = 1084.0875 -> nearest $5 = 1085.
  assert.equal(r.total, 1085);
});

// (d) V-bit vs not, equal time — SYNTHETIC variant of real job-18: the real job has no V-bit sheet, so sheet 2 (twin of
// sheet 1, 1529 s, 1 toolpath) is flipped to hasVbit. Wed Jul 29 2026.
test('pinned (d) job-18 synthetic V-bit twin is not a repeat', () => {
  const fx = byId('job-18');
  const real = price({ J: jobOf(fx) }, sheetsOf(fx, 'J').sheets);
  // Real data: 1529, 1529, 1481, 1798 -> 3 firsts + 1 repeat: handling 180 + 40 = 220; time 6337 s x 0.0375 = 237.6375;
  // 457.6375 -> $460.
  assert.equal(real.perJob.J.repeats, 1);
  assert.equal(real.total, 460);
  const flipped = sheetsOf(fx, 'J').sheets;
  flipped[1].hasVbit = true;
  const r = price({ J: jobOf(fx) }, flipped);
  // Flipped: 4 firsts, no repeats: handling 4 x 60 = 240; same 237.6375; 477.6375 -> $480.
  assert.equal(r.perJob.J.repeats, 0);
  assert.equal(r.total, 480);
});

// (e) Legacy 8-column export (no customer) — job-12: 330, 460, 460, 357 s, Fri Jul 24 2026.
test('pinned (e) job-12 legacy export', () => {
  const fx = byId('job-12');
  assert.equal(fx.legacy8Column, true);
  assert.equal(fx.customer, null);
  const r = price({ J: jobOf(fx) }, sheetsOf(fx, 'J').sheets);
  // Handling 3 x 60 + 1 x 40 = 220. Time 330+460+460+357 = 1607 s x 0.0375 = 60.2625. 280.2625 -> $280.
  assert.equal(r.total, 280);
});

// (f) One sheet hits the minimum — job-28: one sheet, 2043 s, Wed Aug 5 2026.
test('pinned (f) job-28 one sheet hits the minimum', () => {
  const fx = byId('job-28');
  const r = price({ J: jobOf(fx) }, sheetsOf(fx, 'J').sheets);
  // 60 + 2043 x 0.0375 (76.6125) = 136.6125 -> nearest $5 = 135, below the $150 minimum -> $150 (adjustment $15).
  assert.equal(r.minimumApplied, true);
  assert.equal(r.total, 150);
});

// (g) Two jobs, rush48 on one — job-44 (733 s, 427 s; Tue Aug 25) standard and job-46 (675 s, 724 s, 281 s; Wed Aug 12) rush48.
test('pinned (g) job-44 standard + job-46 rush48 on one invoice', () => {
  const a = sheetsOf(byId('job-44'), 'A'), b = sheetsOf(byId('job-46'), 'B');
  const r = price({ A: jobOf(byId('job-44')), B: jobOf(byId('job-46'), { turnaround: 'rush48' }) }, [...a.sheets, ...b.sheets]);
  // Job 44: handling 2 x 60 = 120; time 1160 s x 0.0375 = 43.50; cut 163.50.
  // Job 46: handling 3 x 60 = 180; time 1680 s x 0.0375 = 63.00; cut 243.00; rush48 +50% of 243 = 121.50.
  // 163.50 + 243.00 + 121.50 = 528.00 -> nearest $5 = 530.
  assert.equal(r.total, 530);
});

// (h) Partial bill, then the rest with priorBilled — job-56: 809, 809, 835, 910, 1004, 1005 (all 2 toolpaths), 231 (3), Thu Aug 27 2026.
test('pinned (h) job-56 partial bill then the rest', () => {
  const fx = byId('job-56');
  const first = sheetsOf(fx, 'J', s => [1, 3, 4].includes(s.order)).sheets;
  const rest = sheetsOf(fx, 'J', s => ![1, 3, 4].includes(s.order)).sheets;
  const r1 = price({ J: jobOf(fx) }, first);
  // Invoice 1 (orders 1, 3, 4: 809, 835, 910 s): handling 3 x 60 = 180; time 2554 s x 0.0375 = 95.775;
  // 275.775 -> nearest $5 = 275.
  assert.equal(r1.total, 275);
  const prior = first.map(s => ({ jobKey: 'J', order: s.order, signature: Pricing.signatureOf(s) }));
  assert.deepEqual(prior.map(p => p.signature), ['809|2|-', '835|2|-', '910|2|-']);
  const r2 = price({ J: jobOf(fx) }, rest, { priorBilled: prior });
  // Invoice 2 (orders 2, 5, 6, 7: 809, 1004, 1005, 231 s): order 2 repeats the already-billed 809 s design (order 1) = 1 x 40;
  // the other three are new designs = 3 x 60 = 180. Handling 220. Time 3049 s x 0.0375 = 114.3375.
  // 334.3375 -> nearest $5 = 335.
  assert.equal(r2.perJob.J.repeats, 1);
  assert.equal(r2.total, 335);
  // All seven in one go: handling 6 x 60 + 1 x 40 = 400; time 5603 s x 0.0375 = 210.1125; 610.1125 -> $610 = 275 + 335.
  const all = price({ J: jobOf(fx) }, sheetsOf(fx, 'J').sheets);
  assert.equal(all.total, 610);
  assert.equal(r1.total + r2.total, all.total);
});
