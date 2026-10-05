import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OwnerStore = require('../js/storage-owner.js');
const { makeDb } = require('./helpers/fake-firestore.cjs');

const quiet = async fn => { const w = console.warn; const warns = []; console.warn = (...a) => warns.push(a); try { return { result: await fn(), warns }; } finally { console.warn = w; } };
const dataOf = (db, col, id) => db._data[col] && db._data[col][id] && db._data[col][id].data;

/* ── the fake itself ── */
test('fake: a transaction whose read doc changes before commit re-runs fn and keeps both writes', async () => {
  const db = makeDb();
  db._seed('c', 'a', { n: 1, tags: ['x'] });
  db._hooks.beforeCommit = async () => { await db.collection('c').doc('a').set({ n: 1, tags: ['x', 'concurrent'] }); };
  let calls = 0;
  await db.runTransaction(async tx => {
    calls++;
    const snap = await tx.get(db.collection('c').doc('a'));
    const d = snap.data();
    tx.set(db.collection('c').doc('a'), { ...d, tags: [...d.tags, 'mine'] });
  });
  assert.equal(calls, 2);
  assert.deepEqual(dataOf(db, 'c', 'a').tags, ['x', 'concurrent', 'mine']);
});

test('fake: persistent contention aborts after 5 attempts', async () => {
  const db = makeDb();
  db._seed('c', 'a', { n: 0 });
  const ref = db.collection('c').doc('a');
  await assert.rejects(() => db.runTransaction(async tx => {
    await tx.get(ref);
    await ref.set({ n: Math.random() });   // always changes the doc we read
    tx.set(ref, { n: 1 });
  }), e => e.code === 'aborted');
});

test('fake: failWrites makes set reject with permission-denied; transactions work across collections', async () => {
  const db = makeDb();
  db._hooks.failWrites = (col) => col === 'locked';
  await assert.rejects(() => db.collection('locked').doc('x').set({ a: 1 }), e => e.code === 'permission-denied');
  await db.runTransaction(async tx => {
    await tx.get(db.collection('a').doc('1'));
    tx.set(db.collection('a').doc('1'), { v: 1 });
    tx.set(db.collection('b').doc('2'), { v: 2 });
  });
  assert.equal(dataOf(db, 'b', '2').v, 2);
  await assert.rejects(() => db.runTransaction(async tx => { tx.set(db.collection('locked').doc('x'), { a: 1 }); }), e => e.code === 'permission-denied');
  assert.equal(dataOf(db, 'locked', 'x'), undefined);
});

test('fake: where/orderBy/limit, onSnapshot fires on write', async () => {
  const db = makeDb();
  db._seed('c', 'a', { f: false, t: 2 }); db._seed('c', 'b', { f: false, t: 1 }); db._seed('c', 'z', { f: true, t: 0 });
  const snap = await db.collection('c').where('f', '==', false).orderBy('t', 'asc').limit(5).get();
  assert.deepEqual(snap.docs.map(d => d.id), ['b', 'a']);
  let fires = 0;
  db.collection('c').onSnapshot(() => fires++);
  await db.collection('c').doc('q').set({ f: false });
  assert.equal(fires, 2);
});

/* ── OwnerStore transactional writers ── */
function fresh(db) { OwnerStore._resetForTests(); OwnerStore.init(db); return db; }

test('lost-update guard: a labor line landed concurrently by Billing survives mutateJobBilling', async () => {
  const db = fresh(makeDb());
  const line = id => ({ id, typeId: 'design', hours: 1, status: 'unbilled', invoiceNumber: null, billedAt: null });
  db._seed('jobBilling', 'proj_n', { ...OwnerStore.newJobBilling('N'), laborLines: [line('ll_1')] });
  const billingLine = { ...line('ll_2'), status: 'in-progress', invoiceNumber: 3610 };
  db._hooks.beforeCommit = async () => {
    const cur = dataOf(db, 'jobBilling', 'proj_n');
    await db.collection('jobBilling').doc('proj_n').set({ ...cur, laborLines: [...cur.laborLines, billingLine] });
  };
  await OwnerStore.mutateJobBilling('proj_n', cur => ({ ...cur, laborLines: [...cur.laborLines, line('ll_3')] }), 'a');
  const lines = dataOf(db, 'jobBilling', 'proj_n').laborLines;
  assert.deepEqual(lines.map(l => l.id), ['ll_1', 'll_2', 'll_3']);
  assert.deepEqual(lines[1], billingLine, 'the in-progress line is untouched');
  assert.deepEqual(OwnerStore.getJobBilling('proj_n').laborLines.map(l => l.id), ['ll_1', 'll_2', 'll_3'], 'cache reflects the committed doc');
});

test('setJobBilling refuses laborLines in the patch', () => {
  fresh(makeDb());
  assert.throws(() => OwnerStore.setJobBilling('k', { laborLines: [] }, 'a'), /laborLines/);
});

test('mutateJobBilling: fn can abort by throwing; no write, no warn for ownerRefusal', async () => {
  const db = fresh(makeDb());
  const { warns } = await quiet(async () => {
    await assert.rejects(() => OwnerStore.mutateJobBilling('k', () => { throw Object.assign(new Error('nope'), { ownerRefusal: true }); }, 'a'), /nope/);
  });
  assert.equal(warns.length, 0);
  assert.equal(dataOf(db, 'jobBilling', 'k'), undefined);
});

test('setCutDateOverride: refuses when the server doc became billed during the transaction; doc unchanged', async () => {
  const db = fresh(makeDb());
  db._seed('sheetBilling', 'f1', { status: 'unbilled', invoiceNumber: null, cutDateOverride: null });
  const billed = { status: 'billed', invoiceNumber: 3612, cutDateOverride: null };
  db._hooks.beforeCommit = async () => { await db.collection('sheetBilling').doc('f1').set(billed); };
  const { warns } = await quiet(async () => {
    await assert.rejects(() => OwnerStore.setCutDateOverride('f1', '2026-10-02', {}, 'a'), /already priced/);
  });
  assert.equal(warns.length, 0, 'a refusal is shown, not warned');
  assert.deepEqual(dataOf(db, 'sheetBilling', 'f1'), billed);
});

test('setCutDateOverride: bad dates reject; external sheets may still be corrected; new docs carry every field', async () => {
  const db = fresh(makeDb());
  await assert.rejects(() => OwnerStore.setCutDateOverride('f1', '2026-13-01', {}, 'a'), /date/i);
  await assert.rejects(() => OwnerStore.setCutDateOverride('f1', '2026-02-30', {}, 'a'), /date/i);
  await assert.rejects(() => OwnerStore.setCutDateOverride('f1', 'tomorrow', {}, 'a'), /date/i);
  assert.equal(dataOf(db, 'sheetBilling', 'f1'), undefined);
  db._seed('sheetBilling', 'fx', { status: 'external', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: 'j', customerKey: 'c' });
  const d = await OwnerStore.setCutDateOverride('fx', '2026-10-02', {}, 'a');
  assert.equal(d.status, 'external'); assert.equal(d.cutDateOverride, '2026-10-02');
  const n = await OwnerStore.setCutDateOverride('fnew', '2026-10-03', { jobKey: 'proj_1', customerKey: 'cust_n' }, 'a');
  assert.deepEqual(Object.keys(n).sort(), ['billedAt', 'customerKey', 'cutAtBilled', 'cutDateOverride', 'invoiceNumber', 'jobKey', 'poNumber', 'priced', 'status', 'updatedAt', 'updatedBy']);
  assert.equal((await OwnerStore.setCutDateOverride('fnew', null, {}, 'a')).cutDateOverride, null);
});

test('setNoCharge: on -> external, off -> unbilled, refusals', async () => {
  const db = fresh(makeDb());
  let d = await OwnerStore.setNoCharge('s1', true, { jobKey: 'j', customerKey: 'c' }, 'a');
  assert.equal(d.status, 'external'); assert.equal(d.jobKey, 'j');
  await assert.rejects(() => OwnerStore.setNoCharge('s1', true, {}, 'a'), /unbilled|no charge/i);
  d = await OwnerStore.setNoCharge('s1', false, {}, 'a');
  assert.equal(d.status, 'unbilled');
  await assert.rejects(() => OwnerStore.setNoCharge('s1', false, {}, 'a'), /no charge|external/i);
  db._seed('sheetBilling', 's2', { status: 'in-progress' });
  await assert.rejects(() => OwnerStore.setNoCharge('s2', true, {}, 'a'), /unbilled|priced|invoice/i);
  db._seed('sheetBilling', 's3', { status: 'billed' });
  await assert.rejects(() => OwnerStore.setNoCharge('s3', true, {}, 'a'), /unbilled|priced|invoice/i);
  assert.equal(dataOf(db, 'sheetBilling', 's2').status, 'in-progress');
});

test('mutateCustomerBilling keeps openInvoice set by a concurrent writer', async () => {
  const db = fresh(makeDb());
  db._seed('customerBilling', 'cust_a', { name: 'A', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null });
  db._hooks.beforeCommit = async () => {
    const cur = dataOf(db, 'customerBilling', 'cust_a');
    await db.collection('customerBilling').doc('cust_a').set({ ...cur, openInvoice: 3615 });
  };
  const d = await OwnerStore.setCustomerBilling('cust_a', { notes: 'hi' }, 'travis');
  assert.equal(d.openInvoice, 3615); assert.equal(d.notes, 'hi'); assert.equal(d.updatedBy, 'travis');
  assert.equal(dataOf(db, 'customerBilling', 'cust_a').openInvoice, 3615);
});

test('rememberMaterialDefault stamps updatedBy', async () => {
  const db = fresh(makeDb());
  await OwnerStore.rememberMaterialDefault('cust_n', 'N', 0.75, { kind: 'ours', materialId: 'm1', name: 'MDF' }, 'eva');
  assert.equal(dataOf(db, 'customerBilling', 'cust_n').updatedBy, 'eva');
  assert.equal(dataOf(db, 'customerBilling', 'cust_n').openInvoice, null);
});

test('setSetting merges top-level keys: a partial pricing write keeps defaultList; stamps savedBy', async () => {
  const db = fresh(makeDb());
  await OwnerStore.loadAll();
  await OwnerStore.setSetting('pricing', { lists: { standard: { hourlyRate: 140 } } }, 'travis');
  const d = dataOf(db, 'settings', 'pricing');
  assert.equal(d.defaultList, 'standard');
  assert.deepEqual(d.lists, { standard: { hourlyRate: 140 } }, 'top-level keys replace');
  assert.equal(d.savedBy, 'travis');
});

test('loadAll on an empty db seeds five settings docs; priceListFor returns the standard list or null', async () => {
  const db = fresh(makeDb());
  await OwnerStore.loadAll();
  assert.deepEqual(Object.keys(db._data.settings).sort(), ['invoicing', 'laborTypes', 'materials', 'pricing', 'qbItems']);
  const l = OwnerStore.priceListFor('cust_x');
  assert.equal(l.handlingFirst, 60); assert.equal(l.cutMinimum, 150); assert.deepEqual(l.rush, { standard: 0, rush48: 0.5, rush24: 0.75 });
  assert.deepEqual(OwnerStore.qbItems().taxable, { cnc: 'N', labor: 'N' });
  assert.equal(OwnerStore.invoicing().seedNumber, 3603);
  assert.equal(OwnerStore.invoicing().billingStartDate, null);
  OwnerStore._seedForTests('customerBilling', 'cust_y', { priceList: 'wholesale' });
  assert.equal(OwnerStore.priceListFor('cust_y'), null, 'a named list that is missing is never guessed');
  OwnerStore._resetForTests();
  assert.equal(OwnerStore.priceListFor('cust_x'), null, 'no pricing doc -> null');
  assert.equal(OwnerStore.invoicing().seedNumber, 3603, 'readers fall back to seed-shaped defaults');
  assert.equal(OwnerStore.qbItems().cnc, 'CNC Router Work');
});

test('readers merge seed defaults under a stored doc missing keys', () => {
  OwnerStore._resetForTests();
  OwnerStore._seedForTests('settings', 'invoicing', { seedNumber: 4000 });
  const inv = OwnerStore.invoicing();
  assert.equal(inv.seedNumber, 4000); assert.equal(inv.weekEndingDay, 6); assert.equal(inv.defaultDue, 'receipt');
});

test('a failed transaction rejects, warns once, leaves the cache unchanged and emits nothing', async () => {
  const db = fresh(makeDb());
  db._hooks.failWrites = () => true;
  let emits = 0; OwnerStore.onChange(() => emits++);
  const { warns } = await quiet(async () => {
    await assert.rejects(() => OwnerStore.setJobBilling('p1', { jobName: 'x' }, 'a'), e => e.code === 'permission-denied');
  });
  assert.equal(warns.length, 1);
  assert.equal(OwnerStore.getJobBilling('p1'), null);
  assert.equal(emits, 0);
});

test('_putLocal writes the cache only and emits', () => {
  const db = fresh(makeDb());
  let n = 0; OwnerStore.onChange(() => n++);
  OwnerStore._putLocal('sheetBilling', 'f9', { status: 'unbilled' });
  assert.equal(OwnerStore.getSheetBilling('f9').status, 'unbilled');
  assert.equal(n, 1);
  assert.equal(db._data.sheetBilling, undefined);
});

test('no-db mutate applies to the cache and emits', async () => {
  OwnerStore._resetForTests();
  let n = 0; OwnerStore.onChange(() => n++);
  const d = await OwnerStore.mutateSheetBilling('f1', cur => ({ ...cur, poNumber: 'PO1' }), 'a');
  assert.equal(d.poNumber, 'PO1'); assert.equal(d.status, 'unbilled'); assert.equal(n, 1);
});
