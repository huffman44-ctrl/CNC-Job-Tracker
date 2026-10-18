import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');
globalThis.Pricing = Pricing;
const LogRows = require('../js/log-rows.js');
globalThis.LogRows = LogRows;
const BillingModel = require('../js/billing-model.js');

const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [{ id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' }];
const CUST_MAT = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const hms = sec => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':');
const line = (id, typeId, hours) => ({ id, typeId, typeName: typeId, hours, note: '', enteredAt: Date.now() });

// jobs: { name: { customer, labor } }; sheets: [{ job, n, sec, cut: iso|null }]
function world({ jobs, sheets, throughDate = '2026-10-10', throughDateOf, sheetBilling = {} }) {
  const jobKeyOf = n => 'proj_' + n;
  const customerKeyOf = n => 'cust_' + n;
  const sheetDocs = [], comps = {};
  sheets.forEach(s => {
    const fk = `fk_${s.job}_${s.n}`;
    sheetDocs.push({ fileKey: fk, fileName: `${s.job} Sheet ${s.n}.html`, sheetTitle: `Sheet ${s.n}`, jobName: s.job, totalTime: hms(s.sec), toolpaths: [{ name: 'Profile' }], archiveUrl: '' });
    if (s.cut) comps[fk] = { status: 'complete', completedAt: s.cut, operator: 'Collin', notes: '' };
  });
  const jobDocs = {};
  Object.entries(jobs).forEach(([name, j]) => {
    jobDocs[jobKeyOf(name)] = { jobName: name, customerKey: customerKeyOf(j.customer), customerName: j.customer, material: CUST_MAT, turnaround: 'standard', laborLines: j.labor || [] };
  });
  const input = {
    sheets: sheetDocs, completionOf: fk => comps[fk] || null, sheetBillingOf: fk => sheetBilling[fk] || null,
    jobBillingOf: jk => jobDocs[jk] || null, customerBillingOf: () => null, projectCustomerOf: () => null,
    customerKeyOf, jobKeyOf, compare: (a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
    laborTypes: LABOR, priceListFor: () => STANDARD, throughDate, billingStart: null, inProgressInvoices: [],
  };
  if (throughDateOf) input.throughDateOf = throughDateOf;
  return BillingModel.build(input);
}
const cust = (model, name) => model.customers.find(c => c.customerName === name);
const WED = iso(2026, 10, 14);

test('cadenceOf: only toDate is toDate', () => {
  [null, undefined, {}, { cadence: 'weekly' }, { cadence: 'nonsense' }].forEach(v => assert.equal(BillingModel.cadenceOf(v), 'weekly'));
  assert.equal(BillingModel.cadenceOf({ cadence: 'toDate' }), 'toDate');
});

test('throughDateOf: per-customer date decides later vs billable; customer.throughDate is set', () => {
  const m = world({
    jobs: { Alpha_Job: { customer: 'Acme Test' }, Beta_Job: { customer: 'Birch Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }, { job: 'Beta_Job', n: 1, sec: 900, cut: WED }],
    throughDateOf: ck => (ck === 'cust_Acme Test' ? '2026-10-10' : null),
  });
  const a = cust(m, 'Acme Test'), b = cust(m, 'Birch Test');
  assert.equal(a.rows.length, 0); assert.equal(a.laterSheets.length, 1);
  assert.equal(b.rows.length, 1); assert.equal(b.rows[0].sheetKeys.length, 1); assert.equal(b.laterSheets.length, 0);
  assert.equal(a.throughDate, '2026-10-10'); assert.equal(b.throughDate, null);
  assert.equal(m.throughDate, '2026-10-10');
});

test('throughDateOf returning undefined falls back to input.throughDate', () => {
  const m = world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }],
    throughDateOf: () => undefined,
  });
  const a = cust(m, 'Acme Test');
  assert.equal(a.laterSheets.length, 1); assert.equal(a.rows.length, 0);
  assert.equal(a.throughDate, '2026-10-10');
});

test('hours wait: only later sheets -> no row; once the sheet is eligible the row has sheet and hours', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } };
  const sheets = [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }];
  const early = cust(world({ jobs, sheets, throughDate: '2026-10-10' }), 'Acme Test');
  assert.equal(early.rows.length, 0); assert.equal(early.laterSheets.length, 1);
  const late = cust(world({ jobs, sheets, throughDate: '2026-10-17' }), 'Acme Test');
  assert.equal(late.rows.length, 1);
  assert.equal(late.rows[0].sheetKeys.length, 1); assert.deepEqual(late.rows[0].laborLineIds, ['d1']);
});

test('hours ride with the eligible sheets when a job is cut across two weeks', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } };
  const sheets = [{ job: 'Alpha_Job', n: 1, sec: 900, cut: iso(2026, 10, 8) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: WED }];
  const r = cust(world({ jobs, sheets, throughDate: '2026-10-10' }), 'Acme Test').rows[0];
  assert.equal(r.sheetKeys.length, 1); assert.equal(r.laterCount, 1);
  assert.deepEqual(r.laborLineIds, ['d1']); assert.equal(r.state, 'ready');
});

test('labor-only still works: only sheet uncut, with hours, any through date', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } };
  const sheets = [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }];
  ['2026-10-10', '2026-10-17', null].forEach(t => {
    const r = cust(world({ jobs, sheets, throughDate: t }), 'Acme Test').rows[0];
    assert.equal(r.state, 'labor-only'); assert.deepEqual(r.laborLineIds, ['d1']);
  });
});

test('throughDateOf: a date later than input.throughDate is used, not just null', () => {
  const m = world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }],
    throughDate: '2026-10-10', throughDateOf: () => '2026-10-17',
  });
  const a = cust(m, 'Acme Test');
  assert.equal(a.rows.length, 1); assert.equal(a.laterSheets.length, 0);
  assert.equal(a.throughDate, '2026-10-17');
});

test('throughDateOf: anything but exactly null or a valid date falls back to input.throughDate', () => {
  ['', 0, false, '2026-10-1', 'garbage'].forEach(v => {
    const a = cust(world({
      jobs: { Alpha_Job: { customer: 'Acme Test' } },
      sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }],
      throughDate: '2026-10-10', throughDateOf: () => v,
    }), 'Acme Test');
    assert.equal(a.rows.length, 0, String(v)); assert.equal(a.throughDate, '2026-10-10', String(v));
  });
});

test('hours wait with later sheets even beside billed or uncut sheets', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 0.5)] } };
  // billed sheet 1 + later sheet 2
  const billed = cust(world({
    jobs, throughDate: '2026-10-10',
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: iso(2026, 10, 1) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: WED }],
    sheetBilling: { fk_Alpha_Job_1: { status: 'billed', invoiceNumber: 1001 } },
  }), 'Acme Test');
  assert.equal(billed.rows.length, 0); assert.equal(billed.laterSheets.length, 1);
  // uncut sheet 1 + later sheet 2
  const uncut = cust(world({
    jobs, throughDate: '2026-10-10',
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }, { job: 'Alpha_Job', n: 2, sec: 900, cut: WED }],
  }), 'Acme Test');
  assert.equal(uncut.rows.length, 0); assert.equal(uncut.laterSheets.length, 1);
});

test('a removed labor type still warns while the hours wait with later sheets', () => {
  const m = world({
    jobs: { Alpha_Job: { customer: 'Acme Test', labor: [line('g1', 'gone_type', 1)] } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: WED }], throughDate: '2026-10-10',
  });
  assert.equal(m.needsAttention.filter(n => n.jobKey === 'proj_Alpha_Job').length, 1);
});
