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

/* -- ticket 02: week sections -- */
const CTX = { weekEndingDay: 6, priceList: STANDARD, laborTypes: LABOR };
const sections = c => BillingModel.weekSections(c, CTX);
const priceOf = c => Pricing.priceInvoice(BillingModel.pricingInput(c, {}, CTX));
const D = (d) => iso(2026, 10, d);

test('weekEndingOf: on-or-after boundaries, Sunday, bad input throws', () => {
  assert.equal(BillingModel.weekEndingOf('2026-10-04', 6), '2026-10-10');
  assert.equal(BillingModel.weekEndingOf('2026-10-10', 6), '2026-10-10');
  assert.equal(BillingModel.weekEndingOf('2026-10-11', 6), '2026-10-17');
  assert.equal(BillingModel.weekEndingOf('2026-12-30', 6), '2027-01-02');
  assert.throws(() => BillingModel.weekEndingOf('nope', 6));
  assert.throws(() => BillingModel.weekEndingOf('2026-10-10', 7));
  assert.throws(() => BillingModel.weekEndingOf('2026-10-10', 1.5));
});

test('two jobs across two weeks: sections 10-10 and 10-17, rows split, only the first billable', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' }, Beta_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(6) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: D(13) },
      { job: 'Beta_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Beta_Job', n: 2, sec: 900, cut: D(15) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const s = sections(c);
  assert.deepEqual(s.map(x => x.weekEnding), ['2026-10-10', '2026-10-17']);
  assert.deepEqual(s.map(x => x.billable), [true, false]);
  assert.deepEqual(s[0].rows.map(r => [r.jobName, r.sheetKeys]), [['Alpha_Job', ['fk_Alpha_Job_1']], ['Beta_Job', ['fk_Beta_Job_1']]]);
  assert.deepEqual(s[1].rows.map(r => [r.jobName, r.sheetKeys]), [['Alpha_Job', ['fk_Alpha_Job_2']], ['Beta_Job', ['fk_Beta_Job_2']]]);
  s.forEach(x => { assert.equal(x.error, null); assert.ok(x.total > 0); });
  s[1].rows.forEach(r => { assert.deepEqual(Object.keys(r.captured.sheets), r.sheetKeys); assert.equal(r.sheetInputs.length, 1); });
  // the customer's own rows are untouched
  assert.equal(c.rows[0].sheetKeys.length, 2);
});

test('hours of a job cut across both weeks ride on its 10-10 row only', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: D(14) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const [a, b] = sections(c);
  assert.deepEqual(a.rows[0].laborLineIds, ['d1']); assert.equal(a.rows[0].jobInput.includeLabor, true); assert.equal(a.rows[0].jobInput.laborLines.length, 1);
  assert.deepEqual(b.rows[0].laborLineIds, []); assert.equal(b.rows[0].jobInput.includeLabor, false); assert.deepEqual(b.rows[0].jobInput.laborLines, []);
  assert.deepEqual(b.rows[0].captured.job.labor, {});
  assert.ok(a.total > b.total);   // the labor is in the first bill only
});

test('a job whose sheets are all in week 10-17 carries its hours on that row', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' }, Beta_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Beta_Job', n: 1, sec: 900, cut: D(14) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const s = sections(c);
  assert.deepEqual(s.map(x => x.rows.map(r => r.jobName)), [['Alpha_Job'], ['Beta_Job']]);
  assert.deepEqual(s[1].rows[0].laborLineIds, ['d1']);
});

test('money equality: week 2 total equals the bill after week 1 is billed; the repeat is priced as a repeat both ways', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test' } };
  const sheets = [{ job: 'Alpha_Job', n: 1, sec: 7200, cut: D(8) }, { job: 'Alpha_Job', n: 2, sec: 7200, cut: D(14) }];
  const s = sections(cust(world({ jobs, sheets, throughDate: '2026-10-17' }), 'Acme Test'));
  assert.equal(s[0].total, 330);   // 60 handling + 2 h x 135
  assert.equal(s[1].total, 310);   // repeat: 40 handling + 270
  const billed = cust(world({ jobs, sheets, throughDate: '2026-10-17', sheetBilling: { fk_Alpha_Job_1: { status: 'billed', invoiceNumber: 1001 } } }), 'Acme Test');
  const after = priceOf(billed);
  assert.equal(after.total, s[1].total);
  assert.equal(after.perSheet.fk_Alpha_Job_2.repeatOf, 1);
  const rowPriced = BillingModel.rowPricing(s[1].rows[0], CTX).priced;
  assert.equal(rowPriced.perSheet.fk_Alpha_Job_2.repeatOf, 1);   // the row alone knows too
});

test('section one equals the bill built today with through 10-10', () => {
  const jobs = { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] }, Beta_Job: { customer: 'Acme Test' } };
  const sheets = [{ job: 'Alpha_Job', n: 1, sec: 3000, cut: D(6) }, { job: 'Alpha_Job', n: 2, sec: 3000, cut: D(13) },
    { job: 'Beta_Job', n: 1, sec: 1200, cut: D(10) }, { job: 'Beta_Job', n: 2, sec: 1200, cut: D(16) }];
  const s = sections(cust(world({ jobs, sheets, throughDate: '2026-10-17' }), 'Acme Test'));
  const today = cust(world({ jobs, sheets, throughDate: '2026-10-10' }), 'Acme Test');
  assert.equal(s[0].total, priceOf(today).total);
});

test('a cutDateOverride moves a sheet into the later week', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: D(6) }],
    throughDate: '2026-10-17', sheetBilling: { fk_Alpha_Job_1: { cutDateOverride: '2026-10-13' } },
  }), 'Acme Test');
  const s = sections(c);
  assert.deepEqual(s.map(x => [x.weekEnding, x.rows[0].sheetKeys]), [['2026-10-10', ['fk_Alpha_Job_2']], ['2026-10-17', ['fk_Alpha_Job_1']]]);
});

test('labor only: one section dated customer.throughDate (never null); current-week sheets are not in it', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] }, Beta_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }, { job: 'Beta_Job', n: 1, sec: 900, cut: D(19) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const s = sections(c);
  assert.equal(s.length, 1); assert.equal(s[0].weekEnding, '2026-10-17'); assert.equal(s[0].billable, true);
  assert.deepEqual(s[0].rows.map(r => [r.jobName, r.state]), [['Alpha_Job', 'labor-only']]);
  assert.equal(s[0].error, null); assert.equal(s[0].total, 300);
});

test('a labor-only job goes in the oldest of several sections', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] }, Beta_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }, { job: 'Beta_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Beta_Job', n: 2, sec: 900, cut: D(14) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const s = sections(c);
  assert.deepEqual(s.map(x => x.rows.map(r => r.jobName)), [['Alpha_Job', 'Beta_Job'], ['Beta_Job']]);
});

test('a pricing refusal gives total null + error, no throw', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: D(14) }],
    throughDate: '2026-10-17',
  }), 'Acme Test');
  const { hourlyRate, ...bad } = STANDARD;
  const s = BillingModel.weekSections(c, { ...CTX, priceList: bad });
  assert.equal(s.length, 2);
  s.forEach(x => { assert.equal(x.total, null); assert.match(x.error, /hourlyRate/); });
});

test('an Everything-to-date customer (throughDate null): sheets still section by week; labor-only alone is not billable', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(8) }, { job: 'Alpha_Job', n: 2, sec: 900, cut: D(14) }],
    throughDate: null,
  }), 'Acme Test');
  assert.deepEqual(sections(c).map(x => x.weekEnding), ['2026-10-10', '2026-10-17']);
  const lo = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test', labor: [line('d1', 'design', 2)] } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }], throughDate: null,
  }), 'Acme Test');
  const los = sections(lo);
  assert.equal(los.length, 1); assert.equal(los[0].weekEnding, null);
  assert.equal(los[0].billable, false); assert.match(los[0].error, /Pick a date yourself/);
});

test('a customer with no rows (only uncut / locked sheets) has no sections', () => {
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: null }], throughDate: '2026-10-17',
  }), 'Acme Test');
  assert.equal(c.rows.length, 0);
  assert.deepEqual(sections(c), []);
});

test('a section whose week ends after the through date is never billable', () => {
  // hand-picked Wednesday 10-14: the 10-13 sheet's week ends 10-17, past the through date
  const c = cust(world({
    jobs: { Alpha_Job: { customer: 'Acme Test' } },
    sheets: [{ job: 'Alpha_Job', n: 1, sec: 900, cut: D(13) }], throughDate: '2026-10-14',
  }), 'Acme Test');
  const s = sections(c);
  assert.equal(s.length, 1); assert.equal(s[0].weekEnding, '2026-10-17');
  assert.equal(s[0].billable, false); assert.match(s[0].error, /after the through date/);
});
