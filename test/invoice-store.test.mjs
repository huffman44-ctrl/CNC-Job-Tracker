import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/pricing.js');
const LogRows = require('../js/log-rows.js');
const InvoiceStore = require('../js/invoice-store.js');
const P = InvoiceStore._plan;

const NOW = 1790000000000, BY = 'travis@example.com';
const cut1 = '2026-10-01T16:12:00.000Z', cut2 = '2026-10-02T17:00:00.000Z';
const mkSheet = (k) => ({ fileKey: k, sheetTitle: 'Sheet ' + k, jobName: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00', toolpaths: [{ name: 'Profile' }], archiveUrl: '' });
const rowFor = (k, cutAt) => LogRows.build(mkSheet(k), { completedAt: cutAt, operator: 'Collin' }, 'Northlight Studios');
const priced = (n) => ({ handling: 10, timeCharge: n, weekendPremium: 0, repeatOf: null, hourlyRate: 80, priceList: 'standard' });

function draft(over = {}) {
  return {
    number: 3598, customerKey: 'cust_nl', customerName: 'Northlight Studios', throughDate: '2026-10-04', invoiceDate: '2026-10-05',
    dueDate: null, dueTerm: 'receipt', poNumber: '', sheetKeys: ['s1', 's2'], laborLineRefs: [{ jobKey: 'proj_a', lineId: 'll_1' }],
    lines: [], breakdown: {}, total: 480, priceListName: 'Standard',
    settingsSnapshot: { priceList: {}, laborTypes: [], qbItems: [] },
    perSheet: {
      s1: { jobKey: 'proj_a', cutAt: cut1, cutDate: '2026-10-01', operator: 'Collin', priced: priced(24), row: rowFor('s1', cut1) },
      s2: { jobKey: 'proj_a', cutAt: cut2, cutDate: '2026-10-02', operator: 'Collin', priced: priced(30), row: rowFor('s2', cut2) },
    },
    fingerprint: {
      sheets: { s1: { completedAt: cut1, cutDateOverride: null }, s2: { completedAt: cut2, cutDateOverride: null } },
      jobs: { proj_a: { turnaround: 'standard', materialKind: 'ours', materialId: 'mat_bb', pricePerSheet: 95, readyForBilling: true, labor: { ll_1: { typeId: 'design', hours: 2 } } } },
    },
    csv: 'a,b',
    ...over,
  };
}
const sheetDoc = (extra = {}) => ({ status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null, ...extra });
const jobDoc = (extra = {}) => ({
  jobName: 'NL_Bridge_Wall_Panels', customerKey: 'cust_nl', customerName: 'Northlight Studios',
  material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false },
  turnaround: 'standard', noDesignTime: false, readyForBilling: true, readyAt: 1, readyBy: BY, thicknessIn: 0.75,
  laborLines: [
    { id: 'll_1', typeId: 'design', typeName: 'Design', hours: 2, note: 'Layout', status: 'unbilled', invoiceNumber: null, billedAt: null, enteredAt: 1, enteredBy: BY },
    { id: 'll_2', typeId: 'cam', typeName: 'CAM', hours: 1, note: '', enteredAt: 1, enteredBy: BY },
  ], ...extra,
});
const customerDoc = (extra = {}) => ({ name: 'Northlight Studios', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null, ...extra });
function lockDocs(over = {}) {
  return {
    invoice: null, customer: customerDoc(),
    sheetBilling: { s1: null, s2: sheetDoc() },
    completions: { s1: { completedAt: cut1 }, s2: { completedAt: cut2 } },
    jobBilling: { proj_a: jobDoc() }, ...over,
  };
}
const lock = (docs = lockDocs(), d = draft()) => P.lock(docs, { draft: d, by: BY, now: NOW });
const thrown = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected throw'); };
const find = (plan, col, id) => plan.writes.find(w => w.col === col && w.id === id);
const changedKeys = (before, after) => Object.keys({ ...before, ...after }).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

/* ── lock ── */
test('lock: writes the invoice, every sheet, the job lines and the customer', () => {
  const plan = lock();
  assert.equal(plan.writes.length, 1 + 2 + 1 + 1);
  const inv = find(plan, 'invoices', '3598').doc;
  assert.equal(inv.status, 'in-progress'); assert.equal(inv.createdAt, NOW); assert.equal(inv.createdBy, BY);
  assert.equal(inv.downloadedAt, NOW); assert.equal(inv.downloadedBy, BY);
  assert.deepEqual([inv.importedAt, inv.cancelledAt, inv.poAddedAt, inv.logWritten, inv.logError, inv.logWrittenAt], [null, null, null, false, null, null]);
  assert.deepEqual(inv.history, []);
  assert.ok(!('fingerprint' in inv));
  assert.equal(inv.number, 3598); assert.equal(inv.total, 480); assert.ok(inv.perSheet.s1.row);
  assert.equal(plan.invoice, inv);
  const s1 = find(plan, 'sheetBilling', 's1').doc;
  assert.deepEqual(s1, { ...sheetDoc(), status: 'in-progress', invoiceNumber: 3598, jobKey: 'proj_a', customerKey: 'cust_nl', lockedAt: NOW, lockedBy: BY, updatedAt: NOW, updatedBy: BY });
  const job = find(plan, 'jobBilling', 'proj_a').doc;
  assert.equal(job.laborLines[0].status, 'in-progress'); assert.equal(job.laborLines[0].invoiceNumber, 3598);
  assert.deepEqual(job.laborLines[1], jobDoc().laborLines[1], 'unreferenced line untouched');
  assert.equal(job.material.pricePerSheet, 95);
  assert.equal(find(plan, 'customerBilling', 'cust_nl').doc.openInvoice, 3598);
});

test('lock: keeps cutDateOverride on a sheet and never drops fields it was given', () => {
  const d = draft(); d.fingerprint.sheets.s2.cutDateOverride = '2026-10-03';
  const docs = lockDocs({ sheetBilling: { s1: null, s2: sheetDoc({ cutDateOverride: '2026-10-03', extraField: 1 }) } });
  const s2 = find(lock(docs, d), 'sheetBilling', 's2').doc;
  assert.equal(s2.cutDateOverride, '2026-10-03'); assert.equal(s2.extraField, 1);
});

test('lock: number-used when an invoice exists and is not cancelled', () => {
  const e = thrown(() => lock(lockDocs({ invoice: { number: 3598, status: 'imported', customerName: 'Harbor Lane Pictures', createdAt: new Date(2026, 8, 24, 12).getTime() } })));
  assert.equal(e.code, 'number-used');
  assert.equal(e.message, '3598 is already on Harbor Lane Pictures (Sep 24). Use another number.');
  assert.equal(thrown(() => lock(lockDocs({ invoice: { number: 3598, status: 'in-progress', customerName: 'X', createdAt: NOW } }))).code, 'number-used');
});

test('lock: customer-busy when another invoice is open (Decision 2); the same number is fine', () => {
  const e = thrown(() => lock(lockDocs({ customer: customerDoc({ openInvoice: 3611 }) })));
  assert.equal(e.code, 'customer-busy');
  assert.equal(e.message, 'Finish invoice 3611 first — Imported OK or Cancel.');
  lock(lockDocs({ customer: customerDoc({ openInvoice: 3598 }), invoice: { number: 3598, status: 'cancelled', createdAt: 5, createdBy: 'x', customerName: 'N', history: [] } }));
});

test('lock: sheet-taken when any sheet is no longer unbilled', () => {
  const docs = lockDocs({ sheetBilling: { s1: sheetDoc({ status: 'in-progress', invoiceNumber: 3613 }), s2: sheetDoc({ status: 'billed', invoiceNumber: 3613 }) } });
  const e = thrown(() => lock(docs));
  assert.equal(e.code, 'sheet-taken'); assert.equal(e.message, '2 of these sheets were just put on invoice 3613.');
  assert.equal(thrown(() => lock(lockDocs({ sheetBilling: { s1: sheetDoc({ status: 'external' }), s2: null } }))).code, 'sheet-taken');
});

test('lock: changed on any fingerprint mismatch', () => {
  const msg = 'Something changed since this screen was drawn — check the total and click again.';
  const l0 = jobDoc().laborLines[0], l1 = jobDoc().laborLines[1];
  const cases = {
    recut: lockDocs({ completions: { s1: { completedAt: cut2 }, s2: { completedAt: cut2 } } }),
    uncut: lockDocs({ completions: { s1: null, s2: { completedAt: cut2 } } }),
    override: lockDocs({ sheetBilling: { s1: sheetDoc({ cutDateOverride: '2026-10-09' }), s2: null } }),
    turnaround: lockDocs({ jobBilling: { proj_a: jobDoc({ turnaround: 'rush24' }) } }),
    kind: lockDocs({ jobBilling: { proj_a: jobDoc({ material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 } }) } }),
    matId: lockDocs({ jobBilling: { proj_a: jobDoc({ material: { kind: 'ours', materialId: 'mat_x', name: '', pricePerSheet: 95 } }) } }),
    price: lockDocs({ jobBilling: { proj_a: jobDoc({ material: { kind: 'ours', materialId: 'mat_bb', name: '', pricePerSheet: 99 } }) } }),
    ready: lockDocs({ jobBilling: { proj_a: jobDoc({ readyForBilling: false }) } }),
    noJob: lockDocs({ jobBilling: { proj_a: null } }),
    hours: lockDocs({ jobBilling: { proj_a: jobDoc({ laborLines: [{ ...l0, hours: 3 }] }) } }),
    type: lockDocs({ jobBilling: { proj_a: jobDoc({ laborLines: [{ ...l0, typeId: 'cam' }] }) } }),
    missing: lockDocs({ jobBilling: { proj_a: jobDoc({ laborLines: [l1] }) } }),
    lineTaken: lockDocs({ jobBilling: { proj_a: jobDoc({ laborLines: [{ ...l0, status: 'in-progress', invoiceNumber: 3600 }] }) } }),
  };
  for (const [name, docs] of Object.entries(cases)) {
    const e = thrown(() => lock(docs));
    assert.equal(e.code, 'changed', name); assert.equal(e.message, msg, name);
  }
});

test('lock: readyForBilling only matters when labor is included', () => {
  const d = draft({ laborLineRefs: [] }); d.fingerprint.jobs.proj_a.labor = {};
  lock(lockDocs({ jobBilling: { proj_a: jobDoc({ readyForBilling: false }) } }), d);
});

test('lock: too-big over 400 sheets', () => {
  const d = draft({ sheetKeys: Array.from({ length: 401 }, (_, i) => 'k' + i) });
  assert.equal(thrown(() => lock(lockDocs(), d)).code, 'too-big');
});

test('lock: a re-used cancelled number keeps createdAt/createdBy and appends history', () => {
  const prev = { number: 3598, status: 'cancelled', createdAt: 111, createdBy: 'eva@example.com', customerName: 'Harbor Lane Pictures', total: 300, sheetKeys: ['z1'],
    cancelledAt: 222, cancelledBy: 'eva@example.com', history: [{ status: 'cancelled', total: 1 }], strayField: 'keep' };
  const inv = find(lock(lockDocs({ invoice: prev })), 'invoices', '3598').doc;
  assert.equal(inv.createdAt, 111); assert.equal(inv.createdBy, 'eva@example.com');
  assert.equal(inv.status, 'in-progress'); assert.equal(inv.cancelledAt, null); assert.equal(inv.strayField, 'keep');
  assert.deepEqual(inv.history, [{ status: 'cancelled', total: 1 }, { status: 'cancelled', customerName: 'Harbor Lane Pictures', total: 300, sheetKeys: ['z1'], cancelledAt: 222, cancelledBy: 'eva@example.com' }]);
  assert.equal(inv.customerName, 'Northlight Studios');
});

/* ── import ── */
function lockedState() {
  const plan = lock();
  const g = (col, id) => find(plan, col, id).doc;
  return { invoice: g('invoices', '3598'), customer: g('customerBilling', 'cust_nl'),
    sheetBilling: { s1: g('sheetBilling', 's1'), s2: g('sheetBilling', 's2') }, jobBilling: { proj_a: g('jobBilling', 'proj_a') } };
}
const INV_IMPORT_KEYS = ['status', 'importedAt', 'importedBy', 'updatedAt', 'updatedBy'];
const IMPORT_ARGS = { number: 3598, by: 'eva@example.com', now: NOW + 1000 };

test('import: invoice write changes only the rule-allowed keys; sheets go billed keeping invoiceNumber', () => {
  const st = lockedState();
  const plan = P.import(st, IMPORT_ARGS);
  const inv = find(plan, 'invoices', '3598').doc;
  assert.equal(inv.status, 'imported'); assert.equal(inv.importedAt, NOW + 1000); assert.equal(inv.importedBy, 'eva@example.com');
  for (const k of changedKeys(st.invoice, inv)) assert.ok(INV_IMPORT_KEYS.includes(k), 'invoice key ' + k);
  for (const k of ['s1', 's2']) {
    const s = find(plan, 'sheetBilling', k).doc;
    assert.equal(s.status, 'billed'); assert.equal(s.invoiceNumber, 3598); assert.equal(s.billedAt, NOW + 1000);
    assert.equal(s.poNumber, null);
    for (const f of ['jobKey', 'customerKey', 'cutDateOverride']) assert.equal(s[f], st.sheetBilling[k][f]);
  }
  assert.equal(find(plan, 'sheetBilling', 's2').doc.cutAtBilled, cut2);
  assert.deepEqual(find(plan, 'sheetBilling', 's1').doc.priced, priced(24));
  const lines = find(plan, 'jobBilling', 'proj_a').doc.laborLines;
  assert.equal(lines[0].status, 'billed'); assert.equal(lines[0].billedAt, NOW + 1000); assert.equal(lines[0].invoiceNumber, 3598);
  assert.equal(find(plan, 'customerBilling', 'cust_nl').doc.openInvoice, null);
});

test('import: cutAtBilled/priced come from the lock-time snapshot, not the live completion; PO is carried', () => {
  const st = lockedState();
  st.invoice = { ...st.invoice, poNumber: 'PO-9' };
  st.completions = { s1: { completedAt: 'LIVE-DIFFERENT' } };
  const plan = P.import(st, IMPORT_ARGS);
  const s1 = find(plan, 'sheetBilling', 's1').doc;
  assert.equal(s1.cutAtBilled, cut1); assert.equal(s1.poNumber, 'PO-9');
});

test('import: state errors', () => {
  const st = lockedState();
  assert.equal(thrown(() => P.import({ ...st, invoice: { ...st.invoice, status: 'imported' } }, IMPORT_ARGS)).code, 'state');
  assert.equal(thrown(() => P.import({ ...st, invoice: { ...st.invoice, status: 'cancelled' } }, IMPORT_ARGS)).code, 'state');
  assert.equal(thrown(() => P.import({ ...st, invoice: null }, IMPORT_ARGS)).code, 'state');
  assert.equal(thrown(() => P.import({ ...st, sheetBilling: { ...st.sheetBilling, s1: { ...st.sheetBilling.s1, invoiceNumber: 3700 } } }, IMPORT_ARGS)).code, 'state');
  assert.equal(thrown(() => P.import({ ...st, sheetBilling: { ...st.sheetBilling, s2: sheetDoc() } }, IMPORT_ARGS)).code, 'state');
});

test('import: openInvoice left alone when it is another number', () => {
  const st = lockedState(); st.customer = { ...st.customer, openInvoice: 3999 };
  const plan = P.import(st, IMPORT_ARGS);
  const w = find(plan, 'customerBilling', 'cust_nl');
  assert.ok(!w || w.doc.openInvoice === 3999);
});

/* ── cancel ── */
const INV_CANCEL_KEYS = ['status', 'cancelledAt', 'cancelledBy', 'updatedAt', 'updatedBy'];
test('cancel: releases this invoice only; writes only rule-allowed invoice keys', () => {
  const st = lockedState();
  st.sheetBilling.s2 = { ...st.sheetBilling.s2, invoiceNumber: 3700 };   // moved to another invoice
  st.jobBilling.proj_a = { ...st.jobBilling.proj_a, laborLines: st.jobBilling.proj_a.laborLines.map(l => l.id === 'll_1' ? { ...l, invoiceNumber: 3700 } : l) };
  const plan = P.cancel(st, { number: 3598, by: BY, now: NOW + 5 });
  const inv = find(plan, 'invoices', '3598').doc;
  assert.equal(inv.status, 'cancelled'); assert.equal(inv.cancelledAt, NOW + 5); assert.equal(inv.cancelledBy, BY);
  for (const k of changedKeys(st.invoice, inv)) assert.ok(INV_CANCEL_KEYS.includes(k), 'invoice key ' + k);
  const s1 = find(plan, 'sheetBilling', 's1').doc;
  assert.equal(s1.status, 'unbilled'); assert.equal(s1.invoiceNumber, null); assert.equal(s1.lockedAt, null); assert.equal(s1.lockedBy, null);
  assert.equal(s1.cutDateOverride, null);
  assert.ok(!find(plan, 'sheetBilling', 's2'), 'sheet on another invoice left alone');
  assert.ok(!find(plan, 'jobBilling', 'proj_a'), 'the only referenced line is on another invoice: no job write');
  assert.equal(find(plan, 'customerBilling', 'cust_nl').doc.openInvoice, null);
});

test('cancel: releases lines on this invoice; refuses a non-in-progress invoice', () => {
  const st = lockedState();
  const plan = P.cancel(st, { number: 3598, by: BY, now: NOW });
  const l = find(plan, 'jobBilling', 'proj_a').doc.laborLines[0];
  assert.equal(l.status, 'unbilled'); assert.equal(l.invoiceNumber, null);
  const args = { number: 3598, by: BY, now: NOW };
  assert.equal(thrown(() => P.cancel({ ...st, invoice: { ...st.invoice, status: 'imported' } }, args)).code, 'state');
  assert.equal(thrown(() => P.cancel({ ...st, invoice: { ...st.invoice, status: 'cancelled' } }, args)).code, 'state');
});

/* ── add PO ── */
const INV_PO_KEYS = ['poNumber', 'poAddedAt', 'poAddedBy', 'logWritten', 'logError', 'logWrittenAt', 'updatedAt', 'updatedBy'];
test('addPo: imported only; invoice + billed sheets get the PO; changed keys within rule list', () => {
  const st = lockedState();
  const imp = P.import(st, IMPORT_ARGS);
  const billed = { invoice: find(imp, 'invoices', '3598').doc, sheetBilling: { s1: find(imp, 'sheetBilling', 's1').doc, s2: find(imp, 'sheetBilling', 's2').doc } };
  const plan = P.addPo(billed, { number: 3598, po: ' PO-42 ', by: BY, now: NOW + 9 });
  const inv = find(plan, 'invoices', '3598').doc;
  assert.equal(inv.poNumber, 'PO-42'); assert.equal(inv.poAddedAt, NOW + 9); assert.equal(inv.poAddedBy, BY); assert.equal(inv.status, 'imported');
  for (const k of changedKeys(billed.invoice, inv)) assert.ok(INV_PO_KEYS.includes(k), 'invoice key ' + k);
  for (const k of ['s1', 's2']) {
    const s = find(plan, 'sheetBilling', k).doc;
    assert.equal(s.poNumber, 'PO-42');
    for (const f of ['invoiceNumber', 'billedAt', 'cutAtBilled', 'priced', 'jobKey', 'customerKey', 'cutDateOverride', 'status']) assert.deepEqual(s[f], billed.sheetBilling[k][f]);
  }
  assert.equal(plan.writes.length, 3);
});

test('addPo: state error on an in-progress or cancelled invoice; empty PO refused', () => {
  const st = lockedState();
  assert.equal(thrown(() => P.addPo(st, { number: 3598, po: 'X', by: BY, now: NOW })).code, 'state');
  assert.equal(thrown(() => P.addPo({ ...st, invoice: { ...st.invoice, status: 'cancelled' } }, { number: 3598, po: 'X', by: BY, now: NOW })).code, 'state');
  const imp = { ...st, invoice: { ...st.invoice, status: 'imported' } };
  assert.equal(thrown(() => P.addPo(imp, { number: 3598, po: '  ', by: BY, now: NOW })).code, 'po-empty');
});

/* ── logRowsFor ── */
test('logRowsFor: K = number, N = Y, L only with a PO, F = the lock-time cut', () => {
  const inv = find(lock(), 'invoices', '3598').doc;
  const rows = InvoiceStore.logRowsFor(inv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].invoice, '3598'); assert.equal(rows[0].billed, 'Y'); assert.ok(!('po' in rows[0]));
  assert.equal(rows[0].completedTime, LogRows.formatCompletedTime(cut1));
  assert.equal(rows[1].completedTime, LogRows.formatCompletedTime(cut2));
  assert.equal(rows[0].key, 's1');
  const withPo = InvoiceStore.logRowsFor({ ...inv, poNumber: 'PO-5' });
  assert.equal(withPo[0].po, 'PO-5');
  assert.ok(!('invoice' in inv.perSheet.s1.row), 'stored lock-time row is not mutated');
});
