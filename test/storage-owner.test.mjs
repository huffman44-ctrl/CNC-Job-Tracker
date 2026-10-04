import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OwnerStore = require('../js/storage-owner.js');   // no init() => cache-only

// Minimal fake Firestore: opts.getFails / opts.setFails; records writes.
function fakeDb(opts = {}) {
  const store = opts.docs || {};   // { collection: { id: data } }
  const writes = [];
  return {
    writes,
    async runTransaction(fn) {
      if (opts.setFails) throw new Error('write-denied');
      const tx = {
        get: async ref => ({ exists: !!opts.existsAtCommit }),
        set: (ref, d) => writes.push({ name: 'settings', id: ref.id, d }),
      };
      return fn(tx);
    },
    collection(name) {
      return {
        async get() {
          if (opts.getFails) throw new Error('permission-denied');
          const entries = Object.entries(store[name] || {});
          return { metadata: { fromCache: !!opts.fromCache }, forEach: cb => entries.forEach(([id, d]) => cb({ id, data: () => d })) };
        },
        onSnapshot() {},
        doc(id) {
          return { id, async set(d) {
            if (opts.setFails) throw new Error('write-denied');
            writes.push({ name, id, d });
          } };
        },
      };
    },
  };
}
const quiet = fn => { const w = console.warn; console.warn = () => {}; return Promise.resolve(fn()).finally(() => { console.warn = w; }); };

test('seeds: labor types carry the 2026-10-04 rates and estimator minimums, materials start empty', () => {
  assert.deepEqual(OwnerStore.SEEDS.laborTypes.types, [
    { id: 'design', name: 'Design', rate: 150, minHours: 1,   qbItem: 'Digital Design' },
    { id: 'cam',    name: 'CAM',    rate: 85,  minHours: 0.5, qbItem: 'Digital Design' },
  ]);
  assert.deepEqual(OwnerStore.SEEDS.materials, { items: [] });
});

test('loadAll offline seeds settings into the cache once; laborTypes()/materials() read them', async () => {
  OwnerStore._resetForTests();
  await OwnerStore.loadAll();
  assert.equal(OwnerStore.laborTypes().length, 2);
  assert.deepEqual(OwnerStore.materials(), []);
  assert.equal(await OwnerStore.ensureSeeded('laborTypes', { types: [] }), false, 'already present → not reseeded');
  assert.equal(OwnerStore.laborTypes().length, 2);
});

test('P17: seeds are written when the load succeeded and the docs are confirmed missing', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb();
  OwnerStore.init(db);
  await OwnerStore.loadAll();
  assert.deepEqual(db.writes.map(w => w.id).sort(), ['laborTypes', 'materials']);
  assert.equal(OwnerStore.laborTypes().length, 2);
});

test('P17: a FAILED/denied load never seeds or writes defaults over real settings', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb({ getFails: true });
  OwnerStore.init(db);
  await quiet(() => OwnerStore.loadAll());
  assert.equal(db.writes.length, 0, 'no seed write after a failed load');
  assert.deepEqual(OwnerStore.laborTypes(), []);
  assert.equal(await quiet(() => OwnerStore.ensureSeeded('laborTypes', OwnerStore.SEEDS.laborTypes)), false);
  assert.equal(db.writes.length, 0);
});

test('P17: existing settings are not overwritten by the seed', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb({ docs: { settings: { laborTypes: { types: [{ id: 'design', name: 'Design', rate: 175, minHours: 1, qbItem: 'X' }] }, materials: { items: [] } } } });
  OwnerStore.init(db);
  await OwnerStore.loadAll();
  assert.equal(db.writes.length, 0);
  assert.equal(OwnerStore.laborTypes()[0].rate, 175);
});

test('P18: writers return the write promise and reject (with a console.warn) on a failed write', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb({ setFails: true });
  OwnerStore.init(db);
  const warns = [];
  const w = console.warn; console.warn = (...a) => warns.push(a);
  try {
    await assert.rejects(() => OwnerStore.setJobBilling('p1', { jobName: 'x' }, 'a'), /write-denied/);
    await assert.rejects(() => OwnerStore.setCustomerBilling('c1', { name: 'x' }, 'a'), /write-denied/);
    await assert.rejects(() => OwnerStore.setSetting('invoicing', { a: 1 }, 'a'), /write-denied/);
    await assert.rejects(() => OwnerStore.setCutDateOverride('f1', '2026-10-02', {}, 'a'), /write-denied/);
  } finally { console.warn = w; }
  assert.equal(warns.length, 4);
});

test('P18: writers resolve to the doc after a successful write', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb();
  OwnerStore.init(db);
  const doc = await OwnerStore.setJobBilling('p1', { jobName: 'x' }, 'a');
  assert.equal(doc.jobName, 'x');
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].name, 'jobBilling');
});

test('job billing: new doc defaults, hasJobDetails flips when customer+material+turnaround are set', async () => {
  OwnerStore._resetForTests();
  assert.equal(OwnerStore.getJobBilling('proj_1'), null);
  assert.equal(OwnerStore.hasJobDetails('proj_1'), false);
  const fresh = OwnerStore.newJobBilling('Northlight Wall Panels');
  assert.equal(fresh.turnaround, 'standard');
  assert.equal(fresh.material.kind, 'customer');
  assert.equal(fresh.readyForBilling, false);
  assert.deepEqual(fresh.laborLines, []);
  await OwnerStore.setJobBilling('proj_1', { jobName: 'Northlight Wall Panels', customerKey: 'cust_n', customerName: 'Northlight Studios',
    material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 }, turnaround: 'rush48', thicknessIn: 0.75 }, 'travis@example.com');
  assert.equal(OwnerStore.hasJobDetails('proj_1'), true);
  const doc = OwnerStore.getJobBilling('proj_1');
  assert.equal(doc.updatedBy, 'travis@example.com');
  assert.equal(typeof doc.updatedAt, 'number');
  await OwnerStore.setJobBilling('proj_1', { noDesignTime: true }, 'eva@example.com');
  assert.equal(OwnerStore.getJobBilling('proj_1').turnaround, 'rush48', 'partial patch keeps the rest');
  assert.equal(OwnerStore.getJobBilling('proj_1').noDesignTime, true);
});

test('labor lines carry their own billed status and a typeName snapshot', () => {
  const line = OwnerStore.newLaborLine('design', 1.5, 'Bridge wall panels', 'travis@example.com', 'Design');
  assert.match(line.id, /^ll_/);
  assert.equal(line.hours, 1.5);
  assert.equal(line.typeName, 'Design');
  assert.equal(line.status, 'unbilled');
  assert.equal(line.invoiceNumber, null);
  assert.equal(line.enteredBy, 'travis@example.com');
});

test('cut-date override: creates an unbilled sheetBilling doc, refuses once priced', async () => {
  OwnerStore._resetForTests();
  const doc = await OwnerStore.setCutDateOverride('fk1', '2026-10-02', { jobKey: 'proj_1', customerKey: 'cust_n' }, 'travis@example.com');
  assert.equal(doc.status, 'unbilled');
  assert.equal(doc.cutDateOverride, '2026-10-02');
  assert.equal(doc.jobKey, 'proj_1');
  assert.equal(OwnerStore.getSheetBilling('fk1').cutDateOverride, '2026-10-02');
  await OwnerStore.setCutDateOverride('fk1', null, { jobKey: 'proj_1', customerKey: 'cust_n' }, 'travis@example.com');
  assert.equal(OwnerStore.getSheetBilling('fk1').cutDateOverride, null);
  OwnerStore._seedForTests('sheetBilling', 'fk2', { status: 'billed', invoiceNumber: 3612 });
  await assert.rejects(() => OwnerStore.setCutDateOverride('fk2', '2026-10-01', { jobKey: 'proj_1' }, 'x'), /already priced/);
  OwnerStore._seedForTests('sheetBilling', 'fk3', { status: 'in-progress' });
  await assert.rejects(() => OwnerStore.setCutDateOverride('fk3', '2026-10-01', {}, 'x'), /already priced/);
});

test('customer billing: billed-outside flag and remembered material defaults by thickness', async () => {
  OwnerStore._resetForTests();
  await OwnerStore.setCustomerBilling('cust_r', { name: 'Ridgeway Vans', billedOutsideApp: true }, 'travis@example.com');
  assert.equal(OwnerStore.getCustomerBilling('cust_r').billedOutsideApp, true);
  assert.equal(OwnerStore.getCustomerBilling('cust_r').priceList, 'standard');
  await OwnerStore.rememberMaterialDefault('cust_n', 'Northlight Studios', 0.75, { kind: 'customer', materialId: null, name: '' });
  assert.deepEqual(OwnerStore.getCustomerBilling('cust_n').defaultMaterialByThickness, { '0.75': { kind: 'customer', materialId: null, name: '' } });
  await OwnerStore.rememberMaterialDefault('cust_n', 'Northlight Studios', null, { kind: 'ours' });
  assert.deepEqual(Object.keys(OwnerStore.getCustomerBilling('cust_n').defaultMaterialByThickness), ['0.75'], 'unknown thickness remembers nothing');
});

test('onChange fires on every write', async () => {
  OwnerStore._resetForTests();
  let n = 0;
  OwnerStore.onChange(() => n++);
  await OwnerStore.setSetting('invoicing', { weekEndingDay: 6 }, 'travis@example.com');
  await OwnerStore.setJobBilling('proj_9', { jobName: 'x' }, 'travis@example.com');
  assert.equal(n, 2);
  assert.equal(OwnerStore.getSetting('invoicing').savedBy, 'travis@example.com');
});

test('P17: a cache-only get (offline, metadata.fromCache) counts as a failed load — no seed', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb({ fromCache: true });
  OwnerStore.init(db);
  await quiet(() => OwnerStore.loadAll());
  assert.equal(db.writes.length, 0);
  assert.deepEqual(OwnerStore.laborTypes(), []);
});

test('P17: seed transaction does not overwrite a doc that exists at commit time', async () => {
  OwnerStore._resetForTests();
  const db = fakeDb({ existsAtCommit: true });
  OwnerStore.init(db);
  await OwnerStore.loadAll();
  assert.equal(db.writes.length, 0, 'transaction saw the doc → no set');
  assert.deepEqual(OwnerStore.laborTypes(), [], 'optimistic seed rolled back');
});

test('newLaborLine with 4 args defaults typeName from the seeded labor types', async () => {
  OwnerStore._resetForTests();
  await OwnerStore.loadAll();
  assert.equal(OwnerStore.newLaborLine('cam', 2, 'n', 'a').typeName, 'CAM');
  assert.equal(OwnerStore.newLaborLine('nope', 2, 'n', 'a').typeName, '');
});
