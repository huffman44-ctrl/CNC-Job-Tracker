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
  assert.equal(detail, '10 sheets · 3 designs, 7 repeats · 3 h 09 m Aspire time · customer supplied · no design hours');
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

test('partly cut job: included by default; Remove switches sheets AND labor off together', () => {
  const sheets = [{ job: 'NL_Corridor_Arches', n: 1, sec: 720, cut: T }, { job: 'NL_Corridor_Arches', n: 2, sec: 1080, cut: null }];
  const labor = [line('ll1', 'design', 1.5, { note: 'Arch drawings' })];
  const w = world({ jobs: { NL_Corridor_Arches: { customer: NL, labor } }, sheets });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'partly'); assert.equal(r.defaultIncluded, true);
  assert.equal(r.uncutCount, 1); assert.deepEqual(r.laborLineIds, ['ll1']);
  const def = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(def.sheets.length, 1); assert.equal(def.jobs[r.jobKey].includeLabor, true); assert.equal(def.jobs[r.jobKey].laborLines.length, 1);
  assert.deepEqual(def.priorLaborHours, { [r.jobKey]: {} });
  const off = BillingModel.pricingInput(c, { [r.jobKey]: { sheets: false } }, ctx);
  assert.equal(off.sheets.length, 0); assert.deepEqual(Object.keys(off.jobs), []);
});

test('no Done step: a job never marked ready is a ready row with its labor billable; waiting is never produced', () => {
  const w = world({ jobs: { NL_Stage_Set: { customer: NL, ready: false, labor: [line('ll1', 'design', 1)] } }, sheets: [{ job: 'NL_Stage_Set', n: 1, sec: 600, cut: T }] });
  const c = cust(w.model, NL); const r = c.rows[0];
  assert.equal(r.state, 'ready'); assert.equal(r.defaultIncluded, true); assert.deepEqual(r.laborLineIds, ['ll1']);
  const def = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(def.sheets.length, 1); assert.equal(def.jobs[r.jobKey].includeLabor, true);
  assert.ok(!c.rows.some(x => x.state === 'waiting'));
});

test('labor-only row after all sheets billed', () => {
  const sheets = [{ job: 'NL_Arch', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }];
  const w = world({ jobs: { NL_Arch: { customer: NL, ready: true, labor: [line('ll1', 'design', 2)] } }, sheets });
  const r = cust(w.model, NL).rows[0];
  assert.equal(r.state, 'labor-only'); assert.equal(r.defaultIncluded, true); assert.equal(r.sheetKeys.length, 0);
  assert.equal(r.priorBilled.length, 1);
  assert.equal(BillingModel.rowAmount(r, ctx), 300);
  assert.deepEqual(r.billedOn, [3500]);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3500 · 2 h design added after');   // this file's line() helper sets typeName = typeId
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
  assert.match(d, /1\.5 h Design/); assert.match(d, /1 sheet has no Aspire time$/);
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
  const none = draftFor({}).draft;   // absent selection = every row in (spec 2026-10-06)
  assert.deepEqual(none.sheetKeys, ['fk_NL_Arch_1', 'fk_NL_Arch_2']);
  assert.deepEqual(none.laborLineRefs, [{ jobKey: 'proj_NL_Arch', lineId: 'll1' }]);
  assert.equal(none.customerKey, NLK); assert.equal(none.number, 3604); assert.equal(none.poNumber, 'PO-7');
  const fj = none.fingerprint.jobs.proj_NL_Arch;
  assert.deepEqual([fj.labor.ll1, fj.materialKind, fj.pricePerSheet, fj.priorLabor, fj.turnaround], [{ typeId: 'design', hours: 1.5 }, 'ours', 95, {}, 'rush48']);
  assert.ok(!('readyForBilling' in fj));
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

/* ---- fix round 1 ---- */
test('draft fingerprint is the priced snapshot: world changes AFTER build() -> original values, lock refuses', () => {
  const jobs = { NL_Arch: { customer: NL, ready: true, turnaround: 'rush48', material: OURS, labor: [line('ll1', 'design', 1.5, { typeName: 'Design' })] } };
  const sheets = [{ job: 'NL_Arch', n: 1, sec: 720, cut: T }];
  const run = mutate => {
    const w = world({ jobs, sheets });
    const c = cust(w.model, NL);
    const sel = { proj_NL_Arch: { sheets: true } };
    const priced = Pricing.priceInvoice(BillingModel.pricingInput(c, sel, ctx));
    mutate(w);   // the live world moves on between render and click
    const draft = BillingModel.buildDraft({ customer: c, selection: sel, priced, lines: [], number: 3604, invoiceDate: '2026-10-05', dueDate: null, dueTerm: 'receipt', poNumber: '', throughDate: '2026-10-03',
      settings: { priceList: STANDARD, laborTypes: LABOR, qbItems: {} }, sheetsByKey: Object.fromEntries(w.sheetDocs.map(s => [s.fileKey, s])),
      completionOf: w.input.completionOf, sheetBillingOf: w.input.sheetBillingOf, jobBillingOf: w.input.jobBillingOf, csv: '' });
    const docs = { invoice: null, customer: { openInvoice: null }, sheetBilling: { fk_NL_Arch_1: w.input.sheetBillingOf('fk_NL_Arch_1') },
      completions: { fk_NL_Arch_1: w.input.completionOf('fk_NL_Arch_1') }, jobBilling: { proj_NL_Arch: w.input.jobBillingOf('proj_NL_Arch') } };
    return { draft, lock: () => InvoiceStore._plan.lock(docs, { draft, by: 'x@example.com', now: 1 }) };
  };
  const a = run(w => { w.comps.fk_NL_Arch_1.completedAt = iso(2026, 10, 2); });
  assert.equal(a.draft.fingerprint.sheets.fk_NL_Arch_1.completedAt, T, 'fingerprint keeps the priced completedAt');
  assert.equal(a.draft.perSheet.fk_NL_Arch_1.cutAt, T);
  assert.throws(a.lock, e => e.code === 'changed');
  const b = run(w => { w.jobDocs.proj_NL_Arch.turnaround = 'rush24'; });
  assert.equal(b.draft.fingerprint.jobs.proj_NL_Arch.turnaround, 'rush48');
  assert.throws(b.lock, e => e.code === 'changed');
  const ok = run(() => {});
  assert.doesNotThrow(ok.lock);
});

test('unknown sheet status is locked, never eligible', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T, status: 'weird' }, { job: 'NL_A', n: 2, sec: 600, cut: T }] });
  const c = cust(w.model, NL);
  assert.deepEqual(c.rows[0].sheetKeys, ['fk_NL_A_2']); assert.equal(c.lockedSheets.length, 1);
});

test('priceListName comes from the caller accessor', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const c = cust(BillingModel.build({ ...w.input, priceListNameOf: () => 'Studio' }), NL);
  assert.equal(c.priceListName, 'Studio');
});

test('laborAmount: labor alone, per-job minimum applied (two 0.5 h design lines bill 1 h)', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true, labor: [line('a', 'design', 0.5), line('b', 'design', 0.5)] } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.equal(BillingModel.laborAmount(r, ctx), 150);
  assert.ok(BillingModel.rowAmount(r, ctx) > 150);
});

test('before-billing-start sheets are prior-billed so a later repeat is a repeat (never listed)', () => {
  const w = world({ billingStart: '2026-10-02', jobs: { NL_A: { customer: NL, ready: true } },
    sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: iso(2026, 10, 1) }, { job: 'NL_A', n: 2, sec: 600, cut: iso(2026, 10, 2) }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.sheetKeys, ['fk_NL_A_2']);
  assert.equal(r.priorBilled.length, 1);
  const priced = BillingModel.rowPricing(r, ctx).priced;
  assert.equal(priced.perSheet.fk_NL_A_2.repeatOf, 1);
});

test('defaultThroughDate refuses a bad weekEndingDay', () => {
  assert.throws(() => BillingModel.defaultThroughDate('2026-10-05', 7));
  assert.throws(() => BillingModel.defaultThroughDate('2026-10-05', '6'));
  assert.throws(() => BillingModel.defaultThroughDate('2026-10-05', 1.5));
});

test('rowDetail counts only the row own sheets and job labor', () => {
  const w = world({ jobs: { NL_A: { customer: NL, ready: true } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  const priced = BillingModel.rowPricing(r, ctx).priced;
  priced.perSheet.other = { weekendPremium: 9 }; priced.labor = [{ jobKey: 'proj_other', typeName: 'Design', billedHours: 2 }];
  const d = BillingModel.rowDetail(r, priced);
  assert.ok(!/weekend/.test(d), d); assert.ok(/2 h Design/.test(d) === false); assert.match(d, /· no design hours$/);
});

/* ---- spec 2026-10-06: prior hours, billedOn, laborText ---- */
test('prior hours: billed lines feed priorLaborHours; 0.5 h after 0.5 h billed prices $0 (labor-only row)', () => {
  const labor = [line('old', 'design', 0.5, { status: 'billed', invoiceNumber: 3500 }), line('new', 'design', 0.5, { note: 'Revisions' })];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }] });
  const r = cust(w.model, NL).rows[0];
  assert.equal(r.state, 'labor-only'); assert.deepEqual(r.laborLineIds, ['new']);
  assert.deepEqual(r.priorLaborHours, { design: 0.5 });
  assert.equal(BillingModel.rowAmount(r, ctx), 0);
  assert.equal(BillingModel.laborAmount(r, ctx), 0);
  assert.equal(r.captured.job.priorLabor.design, 0.5);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3500 · 0.5 h design added after');
  const c = cust(w.model, NL);
  const input = BillingModel.pricingInput(c, {}, ctx);
  assert.deepEqual(input.priorLaborHours, { proj_NL_A: { design: 0.5 } });
  assert.equal(Pricing.priceInvoice(input).total, 0);
});

test('prior hours: an in-progress line on another invoice counts as prior; the unbilled 2 h bills 1.5 h', () => {
  const labor = [line('p', 'design', 0.5, { status: 'in-progress', invoiceNumber: 3601 }), line('n', 'design', 2)];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.priorLaborHours, { design: 0.5 });
  const priced = BillingModel.rowPricing(r, ctx).priced;
  assert.equal(priced.labor[0].billedHours, 1.5);
});

test('billedOn lists each billed invoice once, ascending; a job with uncut sheets and labor only reads "still to cut"', () => {
  const sheets = [{ job: 'NL_A', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3620 }, { job: 'NL_A', n: 2, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3612 },
    { job: 'NL_A', n: 3, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3612 }];
  const w = world({ jobs: { NL_A: { customer: NL, labor: [line('ll1', 'design', 1.5), line('ll2', 'cam', 0.5, { typeName: 'CAM' })] } }, sheets });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.billedOn, [3612, 3620]);
  assert.equal(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), 'Sheets billed on #3612 and #3620 · 1.5 h design, 0.5 h CAM added after');
  const uncut = world({ jobs: { NL_B: { customer: NL, labor: [line('ll1', 'design', 1, { typeName: 'Design' })] } }, sheets: [{ job: 'NL_B', n: 1, sec: 600, cut: null }, { job: 'NL_B', n: 2, sec: 600, cut: null }] });
  const rb = cust(uncut.model, NL).rows[0];
  assert.equal(rb.state, 'labor-only'); assert.deepEqual(rb.billedOn, []);
  assert.equal(BillingModel.rowDetail(rb, BillingModel.rowPricing(rb, ctx).priced), '2 still to cut · 1 h Design');
});

test('laborText: entered hours per type in line order; typeName as stored; empty = no design hours', () => {
  assert.equal(BillingModel.laborText([]), 'no design hours');
  assert.equal(BillingModel.laborText(undefined), 'no design hours');
  assert.equal(BillingModel.laborText([{ typeId: 'design', typeName: 'Design', hours: 1 }, { typeId: 'cam', typeName: 'CAM', hours: 0.25 }, { typeId: 'design', typeName: 'Design', hours: 0.5 }]), '1.5 h Design, 0.25 h CAM');
  assert.equal(BillingModel.laborText([{ typeId: 'design', hours: 2 }]), '2 h design', 'typeName missing -> the id');
});

test('every row is included by default in every state', () => {
  const w = world({ jobs: { A: { customer: NL }, B: { customer: NL, labor: [line('x', 'design', 1)] }, C: { customer: NL, labor: [line('y', 'design', 1)] } },
    sheets: [{ job: 'A', n: 1, sec: 600, cut: T }, { job: 'B', n: 1, sec: 600, cut: T }, { job: 'B', n: 2, sec: 600, cut: null }, { job: 'C', n: 1, sec: 600, cut: T, status: 'billed', cutAtBilled: T, invoiceNumber: 3500 }] });
  const c = cust(w.model, NL);
  assert.deepEqual(c.rows.map(r => [r.state, r.defaultIncluded]).sort(), [['labor-only', true], ['partly', true], ['ready', true]]);
  const input = BillingModel.pricingInput(c, {}, ctx);
  assert.equal(Object.keys(input.jobs).length, 3); assert.equal(input.sheets.length, 2);
});

/* ---- spec 2026-10-06 §3.3: Recent jobs ---- */
const DAY = 86400000;
const NOW = new Date(2026, 9, 6, 9).getTime();   // Tue Oct 6
function recentWorld({ finished, active = [], jobs = {}, sb = {}, customers = {}, projectCustomer = {} }) {
  const noteKey = n => 'proj_' + n;
  const jobDocs = {};
  Object.entries(jobs).forEach(([name, j]) => { jobDocs[noteKey(name)] = { jobName: name, customerKey: 'cust_' + j.customer, customerName: j.customer, laborLines: j.labor || [] }; });
  const fin = finished.map(s => ({ fileKey: s.fk, fileName: `${s.job} Sheet ${s.n}.html`, jobName: s.job, finished: true, finishedAt: s.at }));
  const act = active.map(s => ({ fileKey: s.fk, fileName: `${s.job} Sheet ${s.n}.html`, jobName: s.job }));
  return BillingModel.recentJobs({ finishedSheets: fin, activeSheets: act, nowMs: NOW,
    sheetBillingOf: fk => sb[fk] || null, jobBillingOf: jk => jobDocs[jk] || null, customerBillingOf: ck => customers[ck] || null,
    projectCustomerOf: jk => projectCustomer[jk] || null, customerKeyOf: n => 'cust_' + n, noteKey });
}

test('recentJobs: 30-day window on max(finishedAt), newest first, all sheets finished', () => {
  const list = recentWorld({
    finished: [
      { fk: 'a1', job: 'NL_A', n: 1, at: NOW - 2 * DAY }, { fk: 'a2', job: 'NL_A', n: 2, at: NOW - 4 * DAY },
      { fk: 'b1', job: 'NL_B', n: 1, at: NOW - 1 * DAY },
      { fk: 'c1', job: 'NL_Old', n: 1, at: NOW - 31 * DAY },
      { fk: 'd1', job: 'NL_Edge', n: 1, at: NOW - 30 * DAY },
      { fk: 'e1', job: 'NL_Part', n: 1, at: NOW - 1 * DAY },
      { fk: 'f1', job: 'NL_NoDate', n: 1, at: undefined },
    ],
    active: [{ fk: 'e2', job: 'NL_Part', n: 2 }],
    jobs: { NL_A: { customer: NL }, NL_B: { customer: NL }, NL_Old: { customer: NL }, NL_Edge: { customer: NL }, NL_Part: { customer: NL }, NL_NoDate: { customer: NL } },
  });
  assert.deepEqual(list.map(j => j.jobName), ['NL_B', 'NL_A', 'NL_Edge']);
  const a = list.find(j => j.jobName === 'NL_A');
  assert.equal(a.finishedAt, NOW - 2 * DAY); assert.equal(a.finishedText, 'Oct 4'); assert.equal(a.sheetCount, 2);
  assert.equal(a.customerName, NL); assert.equal(a.jobKey, 'proj_NL_A');
});

test('recentJobs: billing and labor wording', () => {
  const sb = { a1: { status: 'billed', invoiceNumber: 3612 }, a2: { status: 'billed', invoiceNumber: 3612 },
    b1: { status: 'billed', invoiceNumber: 3612 }, b2: { status: 'billed', invoiceNumber: 3620 }, b3: { status: 'external' },
    c1: { status: 'billed', invoiceNumber: 3612 }, d1: { status: 'external' } };
  const at = NOW - DAY;
  const list = recentWorld({
    finished: [
      { fk: 'a1', job: 'NL_All', n: 1, at }, { fk: 'a2', job: 'NL_All', n: 2, at },
      { fk: 'b1', job: 'NL_Two', n: 1, at }, { fk: 'b2', job: 'NL_Two', n: 2, at }, { fk: 'b3', job: 'NL_Two', n: 3, at },
      { fk: 'c1', job: 'NL_Some', n: 1, at }, { fk: 'c2', job: 'NL_Some', n: 2, at }, { fk: 'c3', job: 'NL_Some', n: 3, at },
      { fk: 'd1', job: 'NL_NC', n: 1, at }, { fk: 'n1', job: 'NL_None', n: 1, at },
    ],
    jobs: { NL_All: { customer: NL, labor: [line('x', 'design', 1.5, { typeName: 'Design' })] }, NL_Two: { customer: NL }, NL_Some: { customer: NL }, NL_NC: { customer: NL }, NL_None: { customer: NL } },
    sb,
  });
  const by = Object.fromEntries(list.map(j => [j.jobName, j]));
  assert.equal(by.NL_All.billingText, '2 sheets billed #3612'); assert.equal(by.NL_All.laborText, '1.5 h Design');
  assert.equal(by.NL_Two.billingText, '2 sheets billed #3612, #3620', 'external sheet left out; numbers ascending');
  assert.equal(by.NL_Some.billingText, '1 of 3 sheets billed');
  assert.equal(by.NL_NC.billingText, 'no charge');
  assert.equal(by.NL_None.billingText, 'not billed yet'); assert.equal(by.NL_None.laborText, 'no design hours');
});

test('recentJobs: outside-app customers skipped; no job details → projectCustomer name, else "No customer yet"', () => {
  const at = NOW - DAY;
  const list = recentWorld({
    finished: [{ fk: 'r1', job: 'RV_Job', n: 1, at }, { fk: 'p1', job: 'PC_Job', n: 1, at }, { fk: 'q1', job: 'Mystery', n: 1, at }],
    jobs: { RV_Job: { customer: 'Ridgeway Vans' } },
    customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true } },
    projectCustomer: { proj_PC_Job: 'Copperline Stage' },
  });
  assert.deepEqual(list.map(j => [j.jobName, j.customerName]).sort(), [['Mystery', 'No customer yet'], ['PC_Job', 'Copperline Stage']]);
  const outsideByProject = recentWorld({ finished: [{ fk: 'p1', job: 'PC_Job', n: 1, at }], projectCustomer: { proj_PC_Job: 'Ridgeway Vans' }, customers: { 'cust_Ridgeway Vans': { billedOutsideApp: true } } });
  assert.equal(outsideByProject.length, 0);
});

/* ---- final review: billed design hours shown on a sheets-only row ---- */
test('rowDetail: new cut sheets + design already billed → "design hours billed on #N"', () => {
  const labor = [line('old', 'design', 1.5, { status: 'billed', invoiceNumber: 3612 })];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.laborBilledOn, [3612]);
  const d = BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced);
  assert.match(d, /· design hours billed on #3612$/); assert.ok(!/no design hours/.test(d), d);
});

test('rowDetail: design billed on two invoices (incl. in-progress) → "#3612 and #3620", ascending, unique', () => {
  const labor = [line('a', 'design', 1, { status: 'billed', invoiceNumber: 3620 }), line('b', 'design', 1, { status: 'billed', invoiceNumber: 3612 }),
    line('c', 'cam', 1, { status: 'in-progress', invoiceNumber: 3620 })];
  const w = world({ jobs: { NL_A: { customer: NL, labor } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.laborBilledOn, [3612, 3620]);
  assert.match(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), /· design hours billed on #3612 and #3620$/);
});

test('rowDetail: no labor lines at all → "no design hours" unchanged', () => {
  const w = world({ jobs: { NL_A: { customer: NL } }, sheets: [{ job: 'NL_A', n: 1, sec: 600, cut: T }] });
  const r = cust(w.model, NL).rows[0];
  assert.deepEqual(r.laborBilledOn, []);
  assert.match(BillingModel.rowDetail(r, BillingModel.rowPricing(r, ctx).priced), /· no design hours$/);
});
