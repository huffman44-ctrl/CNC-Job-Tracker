import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');
globalThis.Pricing = Pricing;
const LogRows = require('../js/log-rows.js');
globalThis.LogRows = LogRows;
const BillingModel = require('../js/billing-model.js');
const InvoiceStore = require('../js/invoice-store.js');

const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [
  { id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' },
  { id: 'cam', name: 'CAM', rate: 85, minHours: 0.5, qbItem: 'Digital Design' },
];
const OURS = { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false };
const CUST_MAT = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const hms = sec => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map(n => String(n).padStart(2, '0')).join(':');
const NL = 'Northlight Studios', NLK = 'cust_Northlight Studios';

// A tiny world. jobs: { name: { customer, ready, material, turnaround, labor, details:false } }
// sheets: [{ job, n, sec, cut: iso|null, status, cutAtBilled, override }]
function world({ jobs, sheets, customers = {}, laborTypes = LABOR, throughDate = '2026-10-03', billingStart = null, invoices = [], priceList = STANDARD, projectCustomer = {} }) {
  const noteKey = n => 'proj_' + n;
  const customerKeyOf = n => 'cust_' + n;
  const sheetDocs = [], comps = {}, sbs = {};
  sheets.forEach(s => {
    const fk = s.fk || `fk_${s.job}_${s.n}`;
    sheetDocs.push({ fileKey: fk, fileName: `${s.job} Sheet ${s.n}.html`, sheetTitle: `Sheet ${s.n}`, jobName: s.job, totalTime: hms(s.sec), toolpaths: [{ name: 'Profile' }], archiveUrl: '' });
    if (s.cut) comps[fk] = { status: 'complete', completedAt: s.cut, operator: 'Collin', notes: '' };
    if (s.status || s.override) sbs[fk] = { status: s.status || 'unbilled', invoiceNumber: s.invoiceNumber ?? null, cutAtBilled: s.cutAtBilled ?? null, cutDateOverride: s.override ?? null };
  });
  const jobDocs = {};
  Object.entries(jobs).forEach(([name, j]) => {
    if (j.details === false) return;
    jobDocs[noteKey(name)] = {
      jobName: name, customerKey: customerKeyOf(j.customer), customerName: j.customer,
      material: j.material || CUST_MAT, turnaround: j.turnaround || 'standard', readyForBilling: !!j.ready,
      laborLines: j.labor || [],
    };
  });
  const input = {
    sheets: sheetDocs,
    completionOf: fk => comps[fk] || null, sheetBillingOf: fk => sbs[fk] || null,
    jobBillingOf: jk => jobDocs[jk] || null, customerBillingOf: ck => customers[ck] || null,
    projectCustomerOf: jk => projectCustomer[jk] || null,
    customerKeyOf, noteKey, compare: (a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
    laborTypes, priceListFor: () => priceList, throughDate, billingStart, inProgressInvoices: invoices,
  };
  return { input, comps, sbs, jobDocs, sheetDocs, model: BillingModel.build(input) };
}
const cust = (model, name) => model.customers.find(c => c.customerName === name);
const T = iso(2026, 10, 1);     // Thu
const EX_A = [909, 909, 909, 909, 1200, 1200, 1200, 1368, 1368, 1368];
const exA = (job, over = {}) => EX_A.map((sec, i) => ({ job, n: i + 1, sec, cut: T, ...over }));
const ctx = { priceList: STANDARD, laborTypes: LABOR };
const line = (id, typeId, hours, extra = {}) => ({ id, typeId, typeName: typeId, hours, note: '', enteredAt: Date.now(), ...extra });

test('defaultThroughDate: most recent week-ending day on or before today', () => {
  assert.equal(BillingModel.defaultThroughDate('2026-10-05', 6), '2026-10-03');   // Mon
  assert.equal(BillingModel.defaultThroughDate('2026-10-03', 6), '2026-10-03');   // Sat
  assert.equal(BillingModel.defaultThroughDate('2026-10-04', 6), '2026-10-03');   // Sun
  assert.equal(BillingModel.defaultThroughDate('2026-03-02', 6), '2026-02-28');   // month boundary
});

test('ready job, all cut -> one ready row, included; Example A rowAmount 885.25', () => {
  const w = world({ jobs: { NL_Bridge_Wall_Panels: { customer: NL, ready: true } }, sheets: exA('NL_Bridge_Wall_Panels') });
  const c = cust(w.model, NL);
  assert.equal(c.rows.length, 1);
  const r = c.rows[0];
  assert.equal(r.state, 'ready'); assert.equal(r.defaultIncluded, true);
  assert.equal(r.sheetKeys.length, 10); assert.equal(r.uncutCount, 0);
  assert.equal(r.sheetInputs[0].order, 1); assert.equal(r.sheetInputs[0].totalTimeSec, 909);
  assert.equal(r.sheetInputs[0].sheetLabel, 'Sheet 1'); assert.equal(r.sheetInputs[0].cutDate, '2026-10-01');
  assert.equal(Pricing.round2(BillingModel.rowAmount(r, ctx)), 885.25);
  assert.equal(BillingModel.summaryText(c), '1 job · 10 sheets cut Oct 1');
  const detail = BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced);
  assert.equal(detail, '10 sheets · 3 designs, 7 repeats · 3 h 09 m Aspire time · customer supplied');
});

test('through date: a sheet cut Sun Oct 4 waits; null = everything to date', () => {
  const sheets = [...exA('NL_Bridge_Wall_Panels').slice(0, 2), { job: 'NL_Bridge_Wall_Panels', n: 11, sec: 600, cut: iso(2026, 10, 4) }];
  const jobs = { NL_Bridge_Wall_Panels: { customer: NL, ready: true } };
  const c = cust(world({ jobs, sheets }).model, NL);
  assert.equal(c.rows[0].laterCount, 1); assert.equal(c.rows[0].sheetKeys.length, 2);
  assert.equal(c.laterSheets.length, 1); assert.equal(c.laterFirstDate, '2026-10-04');
  assert.equal(BillingModel.summaryText(c), '1 job · 2 sheets cut Oct 1 · 1 sheet cut Oct 4 waits for next week');
  const all = cust(world({ jobs, sheets, throughDate: null }).model, NL);
  assert.equal(all.rows[0].sheetKeys.length, 3); assert.equal(all.rows[0].laterCount, 0);
});

test('partly cut ready job: sheets opt-in, labor included by default', () => {
  const sheets = [{ job: 'NL_Corridor_Arches', n: 1, sec: 720, cut: T }, { job: 'NL_Corridor_Arches', n: 2, sec: 1080, cut: null }];
  const labor = [line('ll1', 'design', 1.5, { note: 'Arch drawings' })];
  const w = world({ jobs: { NL_Corridor_Arches: { customer: NL, ready: true, labor } }, sheets });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'partly'); assert.equal(r.defaultIncluded, false);
  assert.equal(r.uncutCount, 1); assert.deepEqual(r.laborLineIds, ['ll1']);
  const def = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(def.sheets.length, 0); assert.equal(def.jobs[r.jobKey].includeLabor, true); assert.equal(def.jobs[r.jobKey].laborLines.length, 1);
  const withSheets = BillingModel.pricingInput(c, { [r.jobKey]: { sheets: true } }, ctx);
  assert.equal(withSheets.sheets.length, 1); assert.equal(withSheets.sheets[0].order, 1);
});

test('waiting job: sheets opt-in, no labor even when selected', () => {
  const w = world({ jobs: { NL_Stage_Set: { customer: NL, ready: false, labor: [line('ll1', 'design', 1)] } }, sheets: [{ job: 'NL_Stage_Set', n: 1, sec: 600, cut: T }] });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'waiting'); assert.equal(r.defaultIncluded, false); assert.deepEqual(r.laborLineIds, []);
  assert.equal(BillingModel.pricingInput(c, {}, ctx).sheets.length, 0);
  const sel = BillingModel.pricingInput(c, { [r.jobKey]: { sheets: true } }, ctx);
  assert.equal(sel.sheets.length, 1); assert.equal(sel.jobs[r.jobKey].includeLabor, false);
});

test('labor-only row after all sheets billed', () => {
  const sheets = [{ job: 'NL_Arch', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }];
  const w = world({ jobs: { NL_Arch: { customer: NL, ready: true, labor: [line('ll1', 'design', 2)] } }, sheets });
  const r = cust(w.model, NL).rows[0];
  assert.equal(r.state, 'labor-only'); assert.equal(r.defaultIncluded, true); assert.equal(r.sheetKeys.length, 0);
  assert.equal(r.priorBilled.length, 1);
  assert.equal(BillingModel.rowAmount(r, ctx), 300);
});

test('Needs job details: sheetless jobs never listed; no-customer job listed; billed-outside skipped', () => {
  const noJobBilling = world({
    jobs: { NL_Known: { customer: NL, ready: true } },
    sheets: [{ job: 'Mystery_Job', n: 1, sec: 600, cut: T }, { job: 'Mystery_Job', n: 2, sec: 600, cut: T }],
  });
  assert.equal(noJobBilling.model.needsDetails.length, 1);
  assert.deepEqual(noJobBilling.model.needsDetails[0], { jobKey: 'proj_Mystery_Job', jobName: 'Mystery_Job', customerName: null, missing: ['customer', 'material', 'turnaround'], sheetCount: 2 });
  // a jobBilling doc for a job with zero sheets never shows (only sheets are walked)
  const sheetless = world({ jobs: { Ghost: { customer: NL, ready: false }, NL_Known: { customer: NL, ready: true } }, sheets: exA('NL_Known').slice(0, 1) });
  assert.equal(sheetless.model.needsDetails.length, 0);
  const outside = world({
    jobs: {}, sheets: [{ job: 'Mystery_Job', n: 1, sec: 600, cut: T }],
    customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true } }, projectCustomer: { proj_Mystery_Job: 'Ridgeway Vans' },
  });
  assert.equal(outside.model.needsDetails.length, 0);
  const named = world({ jobs: {}, sheets: [{ job: 'Mystery_Job', n: 1, sec: 600, cut: T }], projectCustomer: { proj_Mystery_Job: 'Copperline Stage' } });
  assert.equal(named.model.needsDetails[0].customerName, 'Copperline Stage');
  const done = world({ jobs: {}, sheets: [{ job: 'Old', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T }, { job: 'Old', n: 2, sec: 600, cut: T, status: 'external' }] });
  assert.equal(done.model.needsDetails.length, 0);
});

test('billedOutsideApp: no card; external never counted; in-progress locked; busy customer', () => {
  const w = world({
    jobs: { NL_A: { customer: NL, ready: true }, RV_A: { customer: 'Ridgeway Vans', ready: true } },
    sheets: [{ job: 'RV_A', n: 1, sec: 600, cut: T }, { job: 'NL_A', n: 1, sec: 600, cut: T, status: 'external' },
      { job: 'NL_A', n: 2, sec: 600, cut: T, status: 'in-progress', invoiceNumber: 3611 }, { job: 'NL_A', n: 3, sec: 600, cut: null }],
    customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true }, [NLK]: { openInvoice: 3611 } },
  });
  assert.equal(cust(w.model, 'Ridgeway Vans'), undefined);
  const c = cust(w.model, NL);
  assert.equal(c.rows.length, 0); assert.equal(c.lockedSheets.length, 1); assert.equal(c.uncutSheets.length, 1);
  assert.equal(c.busyInvoice, 3611);
  assert.equal(BillingModel.summaryText(c), 'Nothing ready — 1 cut sheet is on invoice 3611 (in progress), 1 still to cut.');
});

test('busyInvoice from inProgressInvoices alone', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }],
    invoices: [{ number: 3620, customerKey: NLK, status: 'in-progress' }] });
  assert.equal(cust(w.model, NL).busyInvoice, 3620);
});

test('re-cut never re-bills: billed sheet with a different completedAt is prior-billed only', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } },
    sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: iso(2026, 10, 2), status: 'billed', cutAtBilled: iso(2026, 9, 28), invoiceNumber: 3500 }, { job: 'NL_A', n: 2, sec: 700, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.sheetKeys, ['fk_NL_A_2']);
  assert.equal(r.priorBilled.length, 1); assert.equal(r.priorBilled[0].order, 1);
  assert.equal(r.sheetInputs[0].order, 2);
});

test('billing start date: earlier cut is beforeStart (not eligible, not in Needs); earlier labor excluded', () => {
  const labor = [line('old', 'design', 1, { enteredAt: new Date(2026, 9, 1, 15).getTime() }), line('new', 'design', 1, { enteredAt: new Date(2026, 9, 3, 9).getTime() })];
  const w = world({ billingStart: '2026-10-02', jobs: { NL_A: { customer: NL, ready: true, labor } },
    sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: iso(2026, 10, 1) }, { job: 'NL_A', n: 2, sec: 600, cut: iso(2026, 10, 2, 8) }, { job: 'Early', n: 1, sec: 600, cut: iso(2026, 10, 1) }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.sheetKeys, ['fk_NL_A_2']);
  assert.deepEqual(r.laborLineIds, ['new']);
  assert.equal(w.model.needsDetails.length, 0, 'a job with only before-start sheets is not nagged');
});

test('labor line with a removed type -> needsAttention, row not billable', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true, labor: [line('ll1', 'gone', 1, { typeName: 'Gone' })] } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  assert.equal(w.model.needsAttention.length, 1);
  assert.equal(w.model.needsAttention[0].jobKey, 'proj_NL_A');
  assert.match(w.model.needsAttention[0].reason, /Gone/);
  const c = cust(w.model, NL);
  assert.equal(c ? c.rows.length : 0, 0);
});

test('price list not set up -> needsAttention, never priced', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }], priceList: null });
  assert.match(w.model.needsAttention[0].reason, /Price list not set up/);
  const c = cust(w.model, NL);
  assert.equal(c ? c.rows.length : 0, 0);
});

test('rowAmount surfaces a pricing throw instead of crashing', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true, labor: [line('ll1', 'design', 0)] } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.equal(BillingModel.rowAmount(r, ctx), null);
  assert.match(BillingModel.rowPricing(r, ctx).error, /no hours/);
});

test('rowDetail: rush, weekend, labor hours, no-time note', () => {
  const sheets = [{ job: 'NL_Arch', n: 1, sec: 720, cut: T }, { job: 'NL_Arch', n: 2, sec: 1080, cut: T }, { job: 'NL_Arch', n: 3, sec: 0, cut: iso(2026, 10, 3) }];
  const w = world({ jobs: { NL_Arch: { customer: NL, ready: true, turnaround: 'rush48', labor: [line('ll1', 'design', 1.5, { typeName: 'Design' })] } }, sheets });
  const r = cust(w.model, NL).rows[0];
  assert.equal(r.zeroTimeCount, 1);
  const d = BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced);
  assert.match(d, /^3 sheets · 48-hour rush · 1 weekend sheet · /);
  assert.match(d, /1\.5 design hrs/); assert.match(d, /1 sheet has no Aspire time$/);
});

// ---- buildDraft + planLock integration ----
function draftFor(selection) {
  const w = world({ jobs: { NL_Arch: { customer: NL, ready: true, turnaround: 'rush48', material: OURS, labor: [line('ll1', 'design', 1.5, { typeName: 'Design', note: 'Layout' })] } },
    sheets: [{ job: 'NL_Arch', n: 1, sec: 720, cut: T }, { job: 'NL_Arch', n: 2, sec: 1080, cut: T, override: '2026-10-02' }, { job: 'NL_Arch', n: 3, sec: 900, cut: null }] });
  const c = cust(w.model, NL);
  const priced = Pricing.priceInvoice(BillingModel.pricingInput(c, selection, ctx));
  const sheetsByKey = Object.fromEntries(w.sheetDocs.map(s => [s.fileKey, s]));
  const draft = BillingModel.buildDraft({
    customer: c, selection, priced, lines: [{ type: 'labor' }], number: 3604, invoiceDate: '2026-10-05', dueDate: null, dueTerm: 'receipt',
    poNumber: 'PO-7', throughDate: '2026-10-03', settings: { priceList: STANDARD, laborTypes: LABOR, qbItems: {} },
    sheetsByKey, completionOf: w.input.completionOf, sheetBillingOf: w.input.sheetBillingOf, jobBillingOf: w.input.jobBillingOf, csv: 'x,y',
  });
  return { w, c, priced, draft };
}

test('buildDraft: shape, lock-time row, fingerprint, sheetKeys follow the selection', () => {
  const none = draftFor({}).draft;
  assert.deepEqual(none.sheetKeys, []);
  assert.deepEqual(none.laborLineRefs, [{ jobKey: 'proj_NL_Arch', lineId: 'll1' }]);
  assert.equal(none.customerKey, NLK); assert.equal(none.number, 3604); assert.equal(none.poNumber, 'PO-7');
  const fj = none.fingerprint.jobs.proj_NL_Arch;
  assert.deepEqual([fj.labor.ll1, fj.materialKind, fj.pricePerSheet, fj.readyForBilling, fj.turnaround], [{ typeId: 'design', hours: 1.5 }, 'ours', 95, true, 'rush48']);
  const { draft: d2, priced } = draftFor({ proj_NL_Arch: { sheets: true } });
  assert.deepEqual(d2.sheetKeys, ['fk_NL_Arch_1', 'fk_NL_Arch_2']);
  const k = 'fk_NL_Arch_2';
  assert.equal(d2.perSheet[k].row.completedTime, LogRows.formatCompletedTime(T));
  assert.equal(d2.perSheet[k].row.customer, NL);
  assert.equal(d2.perSheet[k].cutAt, T); assert.equal(d2.perSheet[k].cutDate, '2026-10-02'); assert.equal(d2.perSheet[k].operator, 'Collin');
  assert.equal(d2.perSheet[k].priced.hourlyRate, 135); assert.equal(d2.perSheet[k].priced.repeatOf, null);
  assert.deepEqual(d2.fingerprint.sheets[k], { completedAt: T, cutDateOverride: '2026-10-02' });
  assert.equal(d2.total, priced.total);
});

test('integration: draft locks against the same world; a changed completedAt is refused', () => {
  const { w, draft } = draftFor({ proj_NL_Arch: { sheets: true } });
  const docs = () => ({
    invoice: null, customer: { name: NL, billedOutsideApp: false, openInvoice: null },
    sheetBilling: Object.fromEntries(draft.sheetKeys.map(k => [k, w.input.sheetBillingOf(k)])),
    completions: Object.fromEntries(draft.sheetKeys.map(k => [k, { ...w.input.completionOf(k) }])),
    jobBilling: { proj_NL_Arch: w.input.jobBillingOf('proj_NL_Arch') },
  });
  const plan = InvoiceStore._plan.lock(docs(), { draft, by: 'x@example.com', now: 1 });
  assert.ok(plan.invoice.perSheet.fk_NL_Arch_1.row);
  const bad = docs(); bad.completions.fk_NL_Arch_1.completedAt = iso(2026, 10, 2);
  assert.throws(() => InvoiceStore._plan.lock(bad, { draft, by: 'x@example.com', now: 1 }), e => e.code === 'changed');
});
