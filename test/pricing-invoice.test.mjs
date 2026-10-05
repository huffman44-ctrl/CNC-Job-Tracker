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

test('signatureOf matches the Phase 1 signature(sheet)', () => {
  const s = { totalTime: '00:15:09', toolpaths: [{ name: 'Profile' }, { name: 'V-Carve 1' }] };
  assert.equal(Pricing.signature(s), Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 2, hasVbit: true }));
  assert.equal(Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 2, hasVbit: false }), '909|2|-');
});

test('round2 is half-up to the cent; roundToStep is half-up to the step', () => {
  assert.equal(Pricing.round2(643.125), 643.13);
  assert.equal(Pricing.round2(60.375), 60.38);
  assert.equal(Pricing.roundToStep(885.25, 5), 885);
  assert.equal(Pricing.roundToStep(980.625, 5), 980);
  assert.equal(Pricing.roundToStep(1865.875, 5), 1865);
  assert.equal(Pricing.roundToStep(882.5, 5), 885);
  assert.equal(Pricing.roundToStep(78, 5), 80);
});

test('Example A: 3 designs + 7 repeats, 3 h 09 m → cut 885.25, total $885.00', () => {
  const r = price(exampleA());
  assert.equal(r.perJob.A.firsts, 3);
  assert.equal(r.perJob.A.repeats, 7);
  assert.equal(Pricing.round2(r.perJob.A.cutBase), 885.25);
  assert.equal(Pricing.round2(r.perJob.A.subtotal), 885.25, 'BillingB shows the unrounded per-job $885.25');
  assert.equal(r.total, 885);
  assert.equal(r.minimumApplied, false);
});

test('Example B: weekend on handling+time, rush on base only, design 1.5 h → total $980.00', () => {
  const r = price(exampleB());
  const p = r.perJob.B;
  assert.equal(p.firsts, 4, 'no repeats found');
  assert.equal(Pricing.round2(p.cutBase), 388.5);
  assert.equal(p.weekend, 60.375, 'sheet 5: (60 + 0.45 h × 135) × 0.5');
  assert.equal(p.rush, 194.25, 'rush never multiplies the weekend premium');
  assert.equal(p.laborBase, 225);
  assert.equal(p.laborRush, 112.5);
  assert.equal(Pricing.round2(p.subtotal), 980.63, 'BillingB shows $980.63');
  assert.equal(r.total, 980);
});

test('Example C: A + B on one invoice → $1,865.00 (rounding −0.875)', () => {
  const r = price(merge(exampleA(), exampleB()));
  assert.equal(r.total, 1865);
  assert.equal(Pricing.round2(r.roundingAdjustment), -0.88);
  assert.equal(r.materialPortion, 0);
});

test('Example D: one 8-minute sheet + our material → cut minimum, material after rounding → $245.00', () => {
  const D = { jobs: { D: job('RV_Cabinet_Fronts', { material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false } }) },
              sheets: [sheet('D', 1, 480, '2026-09-29')] };
  const r = price(D);
  assert.equal(Pricing.round2(r.perJob.D.cutBase), 78);
  assert.equal(r.minimumAdjustment, 70);
  assert.equal(r.minimumApplied, true);
  assert.equal(r.materialPortion, 95);
  assert.equal(r.total, 245);
});

test('Example E: Harbor Lane — 2 designs + 3 repeats, 1 h 00 m → $375.00; toolpath count separates designs', () => {
  const E = { jobs: { E: job('HL_Set_Walls') }, sheets: [
    sheet('E', 1, 720, '2026-09-30', { toolpathCount: 3 }), sheet('E', 2, 720, '2026-09-30', { toolpathCount: 3 }), sheet('E', 3, 720, '2026-09-30', { toolpathCount: 3 }),
    sheet('E', 4, 720, '2026-09-30', { toolpathCount: 2 }), sheet('E', 5, 720, '2026-09-30', { toolpathCount: 2 }),
  ] };
  const r = price(E);
  assert.equal(r.perJob.E.firsts, 2);
  assert.equal(r.perJob.E.repeats, 3);
  assert.equal(r.total, 375);
});

test('V-bit vs non-V-bit sheets of equal time and count are NOT repeats', () => {
  const r = price({ jobs: { V: job('V') }, sheets: [sheet('V', 1, 600, '2026-10-01', { hasVbit: true }), sheet('V', 2, 600, '2026-10-01', { hasVbit: false })] });
  assert.equal(r.perJob.V.firsts, 2);
});

test('partial bill then the rest: the first-of-design is charged once', () => {
  const first = price({ jobs: { P: job('P') }, sheets: [sheet('P', 1, 909, '2026-10-01'), sheet('P', 2, 909, '2026-10-01')] });
  assert.deepEqual([first.perJob.P.firsts, first.perJob.P.repeats], [1, 1]);
  const sig = Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 3, hasVbit: false });
  const second = price({ jobs: { P: job('P') }, sheets: [sheet('P', 3, 909, '2026-10-02'), sheet('P', 4, 909, '2026-10-02')],
    priorBilled: [{ jobKey: 'P', signature: sig, order: 1 }, { jobKey: 'P', signature: sig, order: 2 }] });
  assert.deepEqual([second.perJob.P.firsts, second.perJob.P.repeats], [0, 2], 'all repeats on the second invoice');
  const sheetKeys = Object.keys(second.perSheet);
  assert.equal(second.perSheet[sheetKeys[0]].repeatOf, 1);
});

test('prior-billed LATER sheet still makes an earlier sheet a repeat (spec §8.3.1)', () => {
  const sig = Pricing.signatureOf({ totalTimeSec: 909, toolpathCount: 3, hasVbit: false });
  const r = price({ jobs: { P: job('P') }, sheets: [sheet('P', 1, 909, '2026-10-02')], priorBilled: [{ jobKey: 'P', signature: sig, order: 3 }] });
  assert.equal(r.perJob.P.repeats, 1);
});

test('zero-second sheets are never grouped as repeats', () => {
  const r = price({ jobs: { Z: job('Z') }, sheets: [sheet('Z', 1, 0, '2026-10-01'), sheet('Z', 2, 0, '2026-10-01')] });
  assert.equal(r.perJob.Z.firsts, 2);
});

test('rush24 is +75% on cut base and labor; a CAM line below its minimum bills the minimum', () => {
  const r = price({ jobs: { R: job('R', { turnaround: 'rush24', includeLabor: true, laborLines: [{ id: 'l', typeId: 'cam', hours: 0.25, note: '' }] }) },
    sheets: [sheet('R', 1, 3600, '2026-10-01')] });
  assert.equal(r.perJob.R.cutBase, 195);
  assert.equal(r.perJob.R.rush, 146.25);
  assert.equal(r.labor[0].billedHours, 0.5, 'CAM minimum 0.5 h per job');
  assert.equal(r.labor[0].topUpHours, 0.25);
  assert.equal(r.perJob.R.laborBase, 42.5);
  assert.equal(r.perJob.R.laborRush, 31.875);
});

test('labor minimum is per job per type (Decision 7): two 0.5 h Design lines bill 1 h, not 2 h', () => {
  const r = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'a', typeId: 'design', hours: 0.5, note: 'Sketch' }, { id: 'b', typeId: 'design', hours: 0.5, note: 'Revisions' }] }) },
    sheets: [sheet('M', 1, 3600, '2026-10-01')] });
  assert.deepEqual(r.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['a', 0.5, 0], ['b', 0.5, 0]]);
  assert.equal(r.perJob.M.laborBase, 150);
});

test('one 1.5 h Design line bills 1.5 h; 0.25 h Design + 0.25 h CAM top up each type separately on the job', () => {
  const one = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [{ id: 'a', typeId: 'design', hours: 1.5, note: '' }] }) }, sheets: [] });
  assert.equal(one.labor[0].billedHours, 1.5);
  assert.equal(one.labor[0].topUpHours, 0);
  const two = price({ jobs: { M: job('M', { includeLabor: true, laborLines: [
    { id: 'd1', typeId: 'design', hours: 0.25, note: '' }, { id: 'c1', typeId: 'cam', hours: 0.25, note: '' }, { id: 'd2', typeId: 'design', hours: 0.25, note: '' }] }) }, sheets: [] });
  assert.deepEqual(two.labor.map(l => [l.lineId, l.billedHours, l.topUpHours]), [['d1', 0.25, 0], ['c1', 0.5, 0.25], ['d2', 0.75, 0.5]],
    'the shortfall lands on the LAST line of each type');
  assert.equal(two.perJob.M.laborBase, 1 * 150 + 0.5 * 85);
});

test('minimums never cross jobs: 0.5 h Design on each of two jobs bills 1 h on each', () => {
  const r = price({ jobs: {
    J1: job('J1', { includeLabor: true, laborLines: [{ id: 'a', typeId: 'design', hours: 0.5, note: '' }] }),
    J2: job('J2', { includeLabor: true, laborLines: [{ id: 'b', typeId: 'design', hours: 0.5, note: '' }] }) }, sheets: [] });
  assert.deepEqual(r.labor.map(l => l.billedHours), [1, 1]);
});

test('includeLabor false leaves labor out entirely', () => {
  const B = exampleB(); B.jobs.B.includeLabor = false;
  assert.equal(price(B).perJob.B.laborBase, 0);
});

test('labor-only invoice: no cut minimum, rounded to $5', () => {
  const r = price({ jobs: { L: job('L', { includeLabor: true, laborLines: [{ id: 'l', typeId: 'design', hours: 1.3, note: '' }] }) }, sheets: [] });
  assert.equal(r.minimumApplied, false);
  assert.equal(r.total, 195);   // 1.3 × 150 = 195
});

test('changing price-list numbers changes the total (no hardcoded constants)', () => {
  const base = price(exampleA()).total;
  const r = Pricing.priceInvoice({ priceList: { ...STANDARD, hourlyRate: 150 }, laborTypes: LABOR, priorBilled: [], ...exampleA() });
  assert.notEqual(r.total, base);
  const r2 = Pricing.priceInvoice({ priceList: { ...STANDARD, roundTo: 1 }, laborTypes: LABOR, priorBilled: [], ...exampleA() });
  assert.equal(r2.total, 885);
});

test('refuses to price silently', () => {
  assert.throws(() => Pricing.priceInvoice({ priceList: { ...STANDARD, hourlyRate: undefined }, laborTypes: LABOR, ...exampleA() }), /hourlyRate/);
  assert.throws(() => price({ jobs: { A: job('A') }, sheets: [sheet('A', 1, 60, null)] }), /not cut/);
  assert.throws(() => price({ jobs: {}, sheets: [sheet('X', 1, 60, '2026-10-01')] }), /no job/);
  assert.throws(() => price({ jobs: { L: job('L', { includeLabor: true, laborLines: [{ id: 'l', typeId: 'gone', hours: 1 }] }) }, sheets: [] }), /labor type/);
  assert.throws(() => price({ jobs: {}, sheets: [] }), /Nothing to bill/);
});

test('refuses bad labor types, hours, material price and sheet time', () => {
  const lab = (extra, types = LABOR) => Pricing.priceInvoice({ priceList: STANDARD, laborTypes: types, priorBilled: [], jobs: { L: job('L', { includeLabor: true, laborLines: [{ id: 'l', typeId: 'design', hours: 1, note: '', ...extra }] }) }, sheets: [] });
  assert.throws(() => lab({}, [{ id: 'design', name: 'Design', minHours: 1 }]), /no rate/);
  assert.throws(() => lab({}, [{ id: 'design', name: 'Design', rate: 150, minHours: -1 }]), /no minimum hours/);
  assert.throws(() => lab({}, [{ id: 'design', name: 'Design', rate: 150 }]), /no minimum hours/);
  [0, -1, NaN, '', undefined].forEach(h => assert.throws(() => lab({ hours: h }), /no hours/));
  assert.throws(() => price({ jobs: { D: job('D', { material: { kind: 'ours', pricePerSheet: undefined } }) }, sheets: [sheet('D', 1, 60, '2026-10-01')] }), /has no price/);
  [undefined, NaN, '600', -5].forEach(v => assert.throws(() => price({ jobs: { S: job('S') }, sheets: [sheet('S', 1, v, '2026-10-01')] }), /Aspire time/));
  assert.equal(price({ jobs: { S: job('S') }, sheets: [sheet('S', 1, 0, '2026-10-01')] }).perJob.S.firsts, 1);
});
