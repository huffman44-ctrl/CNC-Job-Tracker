import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

let records = {};
let sheetBilling = {};
globalThis.Pricing = Pricing;
globalThis.Storage = { get: (k) => records[k] || null };
globalThis.OwnerStore = { getSheetBilling: (k) => sheetBilling[k] || null };
const JobCard = require('../js/job-card.js');

beforeEach(() => { records = {}; sheetBilling = {}; });

const done = (iso, op = 'Collin') => ({ status: 'complete', completedAt: new Date(iso).getTime(), operator: op });

test('sheetStatus: not cut, cut, in progress invoice, billed', () => {
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Not cut yet');
  records.a = { status: 'in-progress' };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Not cut yet');
  records.a = done('2026-10-02T15:00:00');
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Cut');
  sheetBilling.a = { status: 'in-progress', invoiceNumber: 1042 };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'On invoice 1042 (in progress)');
  sheetBilling.a = { status: 'billed', invoiceNumber: 1042 };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Billed · #1042');
});

test('sheetTags: Weekend from a Saturday cut, repeat, override', () => {
  records.a = done('2026-10-03T12:00:00'); // Saturday
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'a' }, {}), ['Weekend']);
  records.b = done('2026-10-02T12:00:00'); // Friday
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'b' }, { b: { repeatOf: 2 } }), ['Repeat of sheet 2']);
  sheetBilling.b = { status: 'unbilled', cutDateOverride: '2026-10-03' };
  const tags = JobCard.sheetTags({ fileKey: 'b' }, {});
  assert.equal(tags[0], 'Weekend');
  assert.match(tags[1], /^cut date corrected to /);
});

test('sheetTags: re-cut after billing', () => {
  records.a = done('2026-10-06T12:00:00');
  sheetBilling.a = { status: 'billed', invoiceNumber: 7, cutAtBilled: new Date('2026-10-01T12:00:00').getTime() };
  assert.match(JobCard.sheetTags({ fileKey: 'a' }, {})[0], /^Re-cut /);
  delete records.a;
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'a' }, {}), ['Re-cut (record cleared)']);
});

test('validYmd accepts only real local dates', () => {
  assert.equal(JobCard.validYmd('2026-10-03'), true);
  assert.equal(JobCard.validYmd('2026-02-30'), false);
  assert.equal(JobCard.validYmd('2026-13-01'), false);
  assert.equal(JobCard.validYmd('10/03/2026'), false);
  assert.equal(JobCard.validYmd('2026-1-3'), false);
  assert.equal(JobCard.validYmd(''), false);
  assert.equal(JobCard.validYmd(null), false);
});

/* ── Task 7: pure transaction functions ── */
const JobDetails = require('../js/job-details.js');
const refusalOf = fn => { try { fn(); } catch (e) { return e; } return null; };
const line = (id, status = 'unbilled', extra = {}) => ({ id, typeId: 'design', typeName: 'Design', hours: 1, note: '', status, invoiceNumber: null, ...extra });

test('applyLineAdd: appends; refuses when the job is already marked ready', () => {
  const cur = { laborLines: [line('a')], readyForBilling: false };
  const next = JobCard.applyLineAdd(cur, line('b'));
  assert.deepEqual(next.laborLines.map(l => l.id), ['a', 'b']);
  assert.equal(cur.laborLines.length, 1, 'input not mutated');
  const e = refusalOf(() => JobCard.applyLineAdd({ laborLines: [], readyForBilling: true }, line('c')));
  assert.equal(e.ownerRefusal, true);
  assert.match(e.message, /marked ready/);
  assert.deepEqual(JobCard.applyLineAdd({ readyForBilling: false }, line('z')).laborLines.map(l => l.id), ['z']);
});

test('applyLineRemove: removes an unbilled line; refuses one on an invoice', () => {
  const cur = { laborLines: [line('a'), line('b', 'in-progress', { invoiceNumber: 4001 })] };
  assert.deepEqual(JobCard.applyLineRemove(cur, 'a').laborLines.map(l => l.id), ['b']);
  const e = refusalOf(() => JobCard.applyLineRemove(cur, 'b'));
  assert.equal(e.ownerRefusal, true);
  assert.match(e.message, /already on invoice 4001/);
  assert.deepEqual(JobCard.applyLineRemove(cur, 'gone').laborLines.length, 2);
});

test('applyDone: needs a line or No design time; stamps ready', () => {
  const e = refusalOf(() => JobCard.applyDone({ laborLines: [], noDesignTime: false }, 'o@x', 5));
  assert.equal(e.ownerRefusal, true);
  const a = JobCard.applyDone({ laborLines: [line('a')] }, 'o@x', 5);
  assert.deepEqual([a.readyForBilling, a.readyAt, a.readyBy], [true, 5, 'o@x']);
  assert.equal(JobCard.applyDone({ laborLines: [], noDesignTime: true }, 'o@x', 6).readyForBilling, true);
});

test('applyNotReady: refuses when hours are on an invoice', () => {
  const ok = JobCard.applyNotReady({ readyForBilling: true, readyAt: 1, readyBy: 'o', laborLines: [line('a')] });
  assert.deepEqual([ok.readyForBilling, ok.readyAt, ok.readyBy], [false, null, null]);
  for (const st of ['in-progress', 'billed']) {
    const e = refusalOf(() => JobCard.applyNotReady({ readyForBilling: true, laborLines: [line('a', st)] }));
    assert.equal(e.ownerRefusal, true);
    assert.match(e.message, /already on an invoice/);
  }
});

test('sheetStatus: external reads No charge', () => {
  sheetBilling.a = { status: 'external' };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'No charge');
});

test('applyDetails: keeps lines/ready/noDesignTime, carries taxable, guards customer change', () => {
  const cur = { jobName: 'J', customerKey: 'c1', customerName: 'One', laborLines: [line('a')], readyForBilling: true, noDesignTime: false, material: { kind: 'customer' }, turnaround: 'standard' };
  const mat = { kind: 'ours', materialId: 'm1', name: 'MDF', pricePerSheet: 40, taxable: true };
  const next = JobDetails.applyDetails(cur, { jobName: 'J', customerKey: 'c1', customerName: 'One', material: mat, turnaround: 'rush48', thicknessIn: 0.75 });
  assert.deepEqual(next.laborLines, cur.laborLines);
  assert.equal(next.readyForBilling, true);
  assert.equal(next.material.taxable, true);
  assert.equal(next.turnaround, 'rush48');
  // customer change with only unbilled lines is fine
  const moved = JobDetails.applyDetails(cur, { jobName: 'J', customerKey: 'c2', customerName: 'Two', material: mat, turnaround: 'standard', thicknessIn: 0.75 });
  assert.equal(moved.customerKey, 'c2');
  // ...but not once a line is on an invoice
  const billed = { ...cur, laborLines: [line('a', 'billed', { invoiceNumber: 9 })] };
  const e = refusalOf(() => JobDetails.applyDetails(billed, { jobName: 'J', customerKey: 'c2', customerName: 'Two', material: mat, turnaround: 'standard', thicknessIn: 0.75 }));
  assert.equal(e.ownerRefusal, true);
  assert.match(e.message, /already has billed work for One/);
  // same customer with a billed line: allowed
  assert.equal(JobDetails.applyDetails(billed, { jobName: 'J', customerKey: 'c1', customerName: 'One', material: mat, turnaround: 'standard', thicknessIn: 0.75 }).laborLines[0].status, 'billed');
  // brand-new doc (no customer yet)
  assert.equal(JobDetails.applyDetails({ laborLines: [] }, { jobName: 'J', customerKey: 'c2', customerName: 'Two', material: mat, turnaround: 'standard', thicknessIn: null }).customerKey, 'c2');
});

test('JobDetails.rushLabel: percent from the list, plain fallback when unset', () => {
  assert.equal(JobDetails.rushLabel('rush48', { rush: { rush48: 0.5, rush24: 0.75 } }), '48-hour rush (+50%)');
  assert.equal(JobDetails.rushLabel('rush24', { rush: { rush48: 0.5, rush24: 0.75 } }), '24-hour rush (+75%)');
  assert.equal(JobDetails.rushLabel('rush24', undefined), '24-hour rush');
  assert.equal(JobDetails.rushLabel('rush48', { rush: {} }), '48-hour rush');
});
