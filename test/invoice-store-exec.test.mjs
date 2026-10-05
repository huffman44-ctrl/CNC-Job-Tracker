import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/pricing.js');
const LogRows = require('../js/log-rows.js');
const OwnerStore = require('../js/storage-owner.js');
const InvoiceStore = require('../js/invoice-store.js');
const { makeDb } = require('./helpers/fake-firestore.cjs');

const BY = 'travis@example.com';
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
    csv: 'a,b', ...over,
  };
}
const sheetDoc = (extra = {}) => ({ status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null, ...extra });
const jobDoc = () => ({
  jobName: 'NL_Bridge_Wall_Panels', customerKey: 'cust_nl', customerName: 'Northlight Studios',
  material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false },
  turnaround: 'standard', noDesignTime: false, readyForBilling: true, readyAt: 1, readyBy: BY, thicknessIn: 0.75,
  laborLines: [
    { id: 'll_1', typeId: 'design', typeName: 'Design', hours: 2, note: 'Layout', status: 'unbilled', invoiceNumber: null, billedAt: null, enteredAt: 1, enteredBy: BY },
    { id: 'll_2', typeId: 'cam', typeName: 'CAM', hours: 1, note: '', enteredAt: 1, enteredBy: BY },
  ],
});
const customerDoc = () => ({ name: 'Northlight Studios', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null });
const completions = { s1: { status: 'complete', completedAt: cut1 }, s2: { status: 'complete', completedAt: cut2 } };

function seedDb(db) {
  db._seed('customerBilling', 'cust_nl', customerDoc());
  db._seed('sheetBilling', 's1', sheetDoc()); db._seed('sheetBilling', 's2', sheetDoc());
  db._seed('jobBilling', 'proj_a', jobDoc());
  db._seed('completions', 's1', completions.s1); db._seed('completions', 's2', completions.s2);
}
const dataOf = (db, col, id) => db._data[col] && db._data[col][id] && db._data[col][id].data;
let calls, upsertImpl, hasDatabase;
function setup(withDb = true) {
  OwnerStore._resetForTests(); InvoiceStore._resetForTests();
  calls = []; upsertImpl = async () => ({ ok: true }); hasDatabase = withDb;
  completions.s1 = { status: 'complete', completedAt: cut1 };
  const db = makeDb();
  const deps = { getIdToken: async () => 'tok', upsertLogRows: (rows, t) => { calls.push({ rows, t }); return upsertImpl(rows, t); }, hasDatabase: () => hasDatabase, getCompletion: k => completions[k] || null };
  InvoiceStore.init(withDb ? db : null, deps);
  if (withDb) seedDb(db);
  else {
    OwnerStore._seedForTests('customerBilling', 'cust_nl', customerDoc());
    OwnerStore._seedForTests('sheetBilling', 's1', sheetDoc()); OwnerStore._seedForTests('sheetBilling', 's2', sheetDoc());
    OwnerStore._seedForTests('jobBilling', 'proj_a', jobDoc());
  }
  return db;
}
const rejectsWith = async (p, code) => assert.rejects(p, e => e.code === code);

test('lock happy path writes invoice, sheets, labor line, customer', async () => {
  const db = setup();
  const inv = await InvoiceStore.lockAndCreate(draft(), BY);
  assert.equal(inv.status, 'in-progress');
  assert.equal(dataOf(db, 'invoices', '3598').status, 'in-progress');
  assert.equal(dataOf(db, 'sheetBilling', 's1').invoiceNumber, 3598);
  assert.equal(dataOf(db, 'sheetBilling', 's2').status, 'in-progress');
  assert.equal(dataOf(db, 'jobBilling', 'proj_a').laborLines[0].status, 'in-progress');
  assert.equal(dataOf(db, 'jobBilling', 'proj_a').laborLines[1].status, undefined);
  assert.equal(dataOf(db, 'customerBilling', 'cust_nl').openInvoice, 3598);
  assert.equal(InvoiceStore.get(3598).status, 'in-progress');
  assert.equal(OwnerStore.getCustomerBilling('cust_nl').openInvoice, 3598);
});

test('concurrent lock on a shared sheet: second rejects sheet-taken, one invoice', async () => {
  const db = setup();
  db._seed('customerBilling', 'cust_b', customerDoc());
  const base = draft();
  const d1 = draft({ sheetKeys: ['s1'], laborLineRefs: [], perSheet: { s1: base.perSheet.s1 }, fingerprint: { sheets: { s1: base.fingerprint.sheets.s1 }, jobs: { proj_a: { ...base.fingerprint.jobs.proj_a, labor: {} } } } });
  const d2 = draft({ number: 3599, customerKey: 'cust_b', sheetKeys: ['s1'], laborLineRefs: [], perSheet: { s1: base.perSheet.s1 }, fingerprint: { sheets: { s1: base.fingerprint.sheets.s1 }, jobs: { proj_a: { ...base.fingerprint.jobs.proj_a, labor: {} } } } });
  let second;
  db._hooks.beforeCommit = async () => { second = InvoiceStore.lockAndCreate(d2, BY); second.catch(() => {}); };
  const first = await InvoiceStore.lockAndCreate(d1, BY);
  assert.equal(first.number, 3598);
  await rejectsWith(second, 'sheet-taken');
  assert.deepEqual(Object.keys(db._data.invoices), ['3598']);
});

test('same number from another owner: number-used', async () => {
  const db = setup();
  await InvoiceStore.lockAndCreate(draft(), BY);
  db._seed('customerBilling', 'cust_b', customerDoc());
  await rejectsWith(InvoiceStore.lockAndCreate(draft({ customerKey: 'cust_b', sheetKeys: [], laborLineRefs: [], perSheet: {}, fingerprint: { sheets: {}, jobs: {} } }), 'eva@example.com'), 'number-used');
});

test('fingerprint mismatch rejects changed and writes nothing', async () => {
  const db = setup();
  const moved = { status: 'complete', completedAt: '2026-10-03T00:00:00.000Z' };
  db._seed('completions', 's1', moved); completions.s1 = moved;
  await rejectsWith(InvoiceStore.lockAndCreate(draft(), BY), 'changed');
  assert.equal(db._data.invoices, undefined);
  assert.equal(dataOf(db, 'sheetBilling', 's1').status, 'unbilled');
});

test('import bills the sheets and writes the log back; failure keeps imported, retry clears', async () => {
  const db = setup();
  await InvoiceStore.lockAndCreate(draft(), BY);
  upsertImpl = async () => { throw new Error('Apps Script timed out'); };
  const inv = await InvoiceStore.markImported(3598, BY);
  assert.equal(calls.length, 1); assert.equal(calls[0].rows.length, 2); assert.equal(calls[0].t, 'tok');
  assert.equal(inv.status, 'imported'); assert.equal(inv.logWritten, false); assert.match(inv.logError, /timed out/);
  assert.equal(dataOf(db, 'invoices', '3598').logWritten, false);
  assert.equal(dataOf(db, 'sheetBilling', 's1').status, 'billed');
  assert.equal(dataOf(db, 'jobBilling', 'proj_a').laborLines[0].status, 'billed');
  assert.equal(dataOf(db, 'customerBilling', 'cust_nl').openInvoice, null);
  upsertImpl = async () => ({ ok: true });
  const again = await InvoiceStore.writeBack(3598, BY);
  assert.equal(again.logWritten, true); assert.equal(again.logError, null); assert.ok(again.logWrittenAt);
  assert.equal(again.status, 'imported');
  assert.equal(dataOf(db, 'invoices', '3598').logWritten, true);
});

test('offline result with a database is a failure with the exact reason; without one it is success', async () => {
  setup();
  await InvoiceStore.lockAndCreate(draft(), BY);
  upsertImpl = async () => ({ ok: true, offline: true });
  const inv = await InvoiceStore.markImported(3598, BY);
  assert.equal(inv.logWritten, false);
  assert.equal(inv.logError, "Master Job Log connection isn't set up on this computer");
  hasDatabase = false;
  assert.equal((await InvoiceStore.writeBack(3598, BY)).logWritten, true);
});

test('labor-only invoice: logWritten true with no call', async () => {
  setup();
  const d = draft({ sheetKeys: [], perSheet: {}, fingerprint: { sheets: {}, jobs: { proj_a: draft().fingerprint.jobs.proj_a } } });
  await InvoiceStore.lockAndCreate(d, BY);
  const inv = await InvoiceStore.markImported(3598, BY);
  assert.equal(calls.length, 0); assert.equal(inv.logWritten, true);
});

test('addPo updates the invoice and sheets and rewrites the log rows', async () => {
  const db = setup();
  await InvoiceStore.lockAndCreate(draft(), BY);
  await InvoiceStore.markImported(3598, BY);
  const inv = await InvoiceStore.addPo(3598, ' PO-77 ', BY);
  assert.equal(inv.poNumber, 'PO-77'); assert.equal(dataOf(db, 'sheetBilling', 's1').poNumber, 'PO-77');
  assert.equal(calls.length, 2);
  assert.ok(JSON.stringify(calls[1].rows[0]).includes('PO-77'));
  assert.equal(inv.logWritten, true);
});

test('cancel releases sheets; re-lock with the same number keeps createdAt', async () => {
  const db = setup();
  const first = await InvoiceStore.lockAndCreate(draft(), BY);
  const c = await InvoiceStore.cancel(3598, BY);
  assert.equal(c.status, 'cancelled');
  assert.equal(dataOf(db, 'sheetBilling', 's1').status, 'unbilled');
  assert.equal(dataOf(db, 'customerBilling', 'cust_nl').openInvoice, null);
  assert.equal(dataOf(db, 'jobBilling', 'proj_a').laborLines[0].status, 'unbilled');
  const again = await InvoiceStore.lockAndCreate(draft(), BY);
  assert.equal(again.createdAt, first.createdAt); assert.equal(again.history.length, 1);
});

test('suggestNumber and checkNumber', async () => {
  const db = setup();
  assert.equal(InvoiceStore.suggestNumber(), 3604);
  db._seed('invoices', '3611', { number: 3611, status: 'imported', customerName: 'X', sheetKeys: [] });
  db._seed('invoices', '3605', { number: 3605, status: 'cancelled', customerName: 'X', sheetKeys: [] });
  await InvoiceStore.loadAll();
  assert.equal(InvoiceStore.loaded(), true);
  assert.equal(InvoiceStore.suggestNumber(), 3612);
  assert.equal((await InvoiceStore.checkNumber('abc')).state, 'invalid');
  assert.equal((await InvoiceStore.checkNumber('0')).state, 'invalid');
  assert.equal((await InvoiceStore.checkNumber('3611')).state, 'used');
  assert.equal((await InvoiceStore.checkNumber('3605')).state, 'cancelled');
  assert.equal((await InvoiceStore.checkNumber('9999')).state, 'free');
  assert.deepEqual(InvoiceStore.recentImported().map(i => i.number), [3611]);
});

test('no-db mode: lock, import, cancel against the caches', async () => {
  setup(false);
  const inv = await InvoiceStore.lockAndCreate(draft(), BY);
  assert.equal(inv.status, 'in-progress');
  assert.equal(OwnerStore.getSheetBilling('s1').status, 'in-progress');
  assert.equal(InvoiceStore.inProgress().length, 1);
  const imp = await InvoiceStore.markImported(3598, BY);
  assert.equal(imp.status, 'imported'); assert.equal(imp.logWritten, true);
  assert.equal(OwnerStore.getSheetBilling('s1').status, 'billed');
  await rejectsWith(InvoiceStore.cancel(3598, BY), 'state');
  setup(false);
  await InvoiceStore.lockAndCreate(draft(), BY);
  await InvoiceStore.cancel(3598, BY);
  assert.equal(OwnerStore.getSheetBilling('s1').status, 'unbilled');
  assert.equal(OwnerStore.getCustomerBilling('cust_nl').openInvoice, null);
});
