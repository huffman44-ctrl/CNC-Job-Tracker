import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

// settings/pricing.lists.standard as seeded (spec §5.8) and settings/laborTypes (spec §15.2).
const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [
  { id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' },
  { id: 'cam', name: 'CAM', rate: 85, minHours: 0.5, qbItem: 'Digital Design' },
];
const CUSTOMER_SUPPLIED = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const job = (jobName, extra = {}) => ({ jobName, turnaround: 'standard', material: CUSTOMER_SUPPLIED, includeLabor: false, laborLines: [], ...extra });
let n = 0;
const sheet = (jobKey, order, totalTimeSec, cutDate, extra = {}) =>
  ({ fileKey: `fk${++n}`, jobKey, order, sheetLabel: `Job Layout Sheet ${order}`, totalTimeSec, toolpathCount: 3, hasVbit: false, cutDate, ...extra });

// Example A — NL_Bridge_Wall_Panels: 10 sheets, 3 designs + 7 repeats, 3 h 09 m, standard, Thu Oct 1.
// Designs: 4 × 15:09 (909 s), 3 × 20:00 (1200 s), 3 × 22:48 (1368 s) = 11,340 s = 3.15 h.
function exampleA() {
  const t = [909, 909, 909, 909, 1200, 1200, 1200, 1368, 1368, 1368];
  return { jobs: { A: job('NL_Bridge_Wall_Panels') }, sheets: t.map((sec, i) => sheet('A', i + 1, sec, '2026-10-01')) };
}
// Example B — NL_Corridor_Arches: sheets 2–5 = 12, 18, 9, 27 min (unique), 48-hour rush,
// sheet 5 cut Saturday Oct 3, Design 1.5 h @ $150, customer supplied.
function exampleB() {
  const t = [720, 1080, 540, 1620];
  return {
    jobs: { B: job('NL_Corridor_Arches', { turnaround: 'rush48', includeLabor: true, laborLines: [{ id: 'll1', typeId: 'design', hours: 1.5, note: 'Corridor arch drawings' }] }) },
    sheets: t.map((sec, i) => sheet('B', i + 2, sec, i === 3 ? '2026-10-03' : '2026-10-01')),
  };
}
const price = (parts, extra = {}) => Pricing.priceInvoice({ priceList: STANDARD, laborTypes: LABOR, priorBilled: [], ...parts, ...extra });
const merge = (...ps) => ({ jobs: Object.assign({}, ...ps.map(p => p.jobs)), sheets: ps.flatMap(p => p.sheets) });

const cents = x => Math.round(x * 100);
const sumCents = ls => ls.reduce((a, l) => a + cents(l.amount), 0);

test('Example A lines: one CNC line $885.00, no material line', () => {
  const r = price(exampleA());
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 885]]);
  assert.equal(r.lines[0].serviceDate, '2026-10-01');
  assert.equal(r.lines[0].rate, 885);
  assert.equal(r.lines[0].quantity, 1);
});

test('Example B lines: CNC 643.125 → reconciled 642.50; Design 337.50', () => {
  const r = price(exampleB());
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 642.5], ['labor', 337.5]]);
  assert.equal(r.lines[0].serviceDate, '2026-10-03', 'latest cut date');
  assert.deepEqual(r.lines[0].facts.rush, [{ jobName: 'NL_Corridor_Arches', label: '48-hour rush' }]);
  assert.equal(r.lines[0].facts.weekendSheets, 1);
});

test('Example C lines and breakdown match the InvoiceConfirm mockup', () => {
  const r = price(merge(exampleA(), exampleB()));
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['cutSheets', 1527.5], ['labor', 337.5]]);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.deepEqual(r.lines[0].facts.perJob, [{ jobName: 'NL_Bridge_Wall_Panels', count: 10 }, { jobName: 'NL_Corridor_Arches', count: 4 }]);
  const b = Object.fromEntries(r.breakdown.map(x => [x.label, Pricing.round2(x.amount)]));
  assert.equal(b['Handling 7 × $60'], 420);
  assert.equal(b['Handling 7 repeats × $40'], 280);
  assert.equal(b['Cutting 4 h 15 m × $135/hr'], 573.75);
  assert.equal(b['Weekend (+50%) on 1 sheet'], 60.38);
  assert.equal(b['48-hour rush on NL_Corridor_Arches'], 306.75);
  assert.equal(b['Design 1.5 h — Corridor arch drawings'], 225);
  assert.equal(b['Rounded to the nearest $5'], -0.88);
  assert.equal(b['Material — customer supplied'], 0);
  assert.ok(Math.abs(r.breakdown.reduce((a, x) => a + x.amount, 0) - r.total) < 0.01);
});

test('Example D lines: Materials 95.00 then CNC (cut minimum) 150.00', () => {
  const D = { jobs: { D: job('RV_Cabinet_Fronts', { material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false } }) },
              sheets: [sheet('D', 1, 480, '2026-09-29')] };
  const r = price(D);
  assert.deepEqual(r.lines.map(l => [l.type, l.amount]), [['material', 95], ['cutSheets', 150]]);
  assert.equal(r.lines[1].facts.minimumApplied, true);
  assert.deepEqual(r.lines[0].facts, { names: ['3/4 in Baltic birch'], taxable: false, sheetCount: 1 });
  assert.ok(r.breakdown.some(x => x.label === 'Cut minimum $150' && x.amount === 70));
});

test('two materials on one invoice → ONE combined Materials line (Decision 4); differing Taxable → "mixed"', () => {
  const m1 = { kind: 'ours', materialId: 'm1', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false };
  const m2 = { kind: 'ours', materialId: 'm2', name: '1/2 in Sintra', pricePerSheet: 60, taxable: false };
  const parts = m => ({ jobs: { J1: job('J1', { material: m1 }), J2: job('J2', { material: m }) },
    sheets: [sheet('J1', 1, 600, '2026-10-01'), sheet('J2', 1, 600, '2026-10-01')] });
  const r = price(parts(m2));
  const mats = r.lines.filter(l => l.type === 'material');
  assert.equal(mats.length, 1);
  assert.deepEqual([mats[0].amount, mats[0].facts], [155, { names: ['3/4 in Baltic birch', '1/2 in Sintra'], taxable: false, sheetCount: 2 }]);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.equal(price(parts({ ...m2, taxable: true })).lines[0].facts.taxable, 'mixed');
});

test('labor top-up shows on the last line of the type; lines still sum to the total', () => {
  const r = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 0.25, note: 'Sketch' }, { id: 'b', typeId: 'design', hours: 0.25, note: 'Fixes' }] }) },
    sheets: [sheet('M', 1, 3600, '2026-10-01')] });
  const labor = r.lines.filter(l => l.type === 'labor');
  assert.deepEqual(labor.map(l => [l.facts.billedHours, l.facts.topUpHours]), [[0.25, 0], [0.75, 0.5]]);
  assert.ok(r.breakdown.some(x => x.label === 'Design 0.75 h (includes 1-h minimum) — Fixes'));
  assert.equal(sumCents(r.lines), cents(r.total));
});

test('labor-only invoice reconciles onto the last labor line', () => {
  const r = price({ jobs: { L: job('L', { turnaround: 'rush48', includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 1.1, note: '' }, { id: 'b', typeId: 'cam', hours: 0.7, note: '' }] }) }, sheets: [] });
  assert.equal(r.lines.every(l => l.type === 'labor'), true);
  assert.equal(sumCents(r.lines), cents(r.total));
  assert.equal(r.total % 5, 0);
});

test('invariants on every example: Σ lines = total; total − material is a multiple of 5; no negative line', () => {
  for (const parts of [exampleA(), exampleB(), merge(exampleA(), exampleB())]) {
    const r = price(parts);
    assert.equal(sumCents(r.lines), cents(r.total));
    assert.equal((cents(r.total) - cents(r.materialPortion)) % 500, 0);
    assert.ok(r.lines.every(l => l.amount >= 0));
    assert.equal(r._ctx, undefined, 'internal context is not returned');
  }
});
