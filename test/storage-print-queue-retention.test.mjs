import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

const DAY = 24 * 60 * 60 * 1000;
const doc = (id, data = {}) => ({
  id, ref: { id },
  data: () => ({ kind: 'stickers', lines: ['X'], size: '3x1', createdAt: 1, printedAt: null, ...data }),
});
const snapOf = docs => ({ size: docs.length, empty: !docs.length, docs, forEach: fn => docs.forEach(fn) });

// Minimal Firestore-compat fake for the printQueue collection. `results` maps a
// where() operator ('==', '>=', '<') to the docs that query returns. Records every
// where(), doc update/delete and batch; lets a test fire either listener by hand.
// Any unscoped get()/onSnapshot() or any orderBy() throws — both are forbidden.
function fakeDb(results = {}) {
  const log = { wheres: [], updates: [], deletes: [], batches: [], listeners: {} };
  const docsFor = w => (typeof results[w.op] === 'function' ? results[w.op](w) : results[w.op]) || [];
  const query = w => ({
    orderBy: () => { throw new Error('orderBy is forbidden on printQueue'); },
    get: async () => snapOf(docsFor(w)),
    onSnapshot: onNext => { log.listeners[w.op] = onNext; onNext(snapOf(docsFor(w))); },
  });
  const db = {
    collection: name => {
      assert.equal(name, 'printQueue');
      return {
        where: (field, op, value) => { const w = { field, op, value }; log.wheres.push(w); return query(w); },
        get: () => { throw new Error('unscoped get() on printQueue'); },
        onSnapshot: () => { throw new Error('unscoped onSnapshot() on printQueue'); },
        doc: id => ({
          update: async data => { log.updates.push({ id, data }); },
          delete: async () => { if (results.failDelete) throw new Error('boom'); log.deletes.push(id); },
        }),
      };
    },
    batch: () => {
      const ids = [];
      return { delete: ref => ids.push(ref.id), commit: async () => { if (results.failBatch) throw new Error('batch boom'); log.batches.push(ids); } };
    },
  };
  return { db, log, fire: (op, docs) => log.listeners[op](snapOf(docs)) };
}

// Reset the shared cache between tests: a scoped load with empty results rebuilds
// both sources empty.
async function reset() {
  Storage.init(fakeDb().db);
  await Storage.loadPrintQueue();
  Storage.init(null);
}

test('retention constants: 30 days, cutoff is now minus 30 days', () => {
  assert.equal(Storage.PRINT_RETENTION_DAYS, 30);
  assert.equal(Storage.printRetentionCutoff(1_000_000_000_000), 1_000_000_000_000 - 30 * DAY);
});

test('loadPrintQueue issues exactly two single-field queries and never an orderBy', async () => {
  const { db, log } = fakeDb({ '==': [doc('o1')], '>=': [doc('p1', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    const before = Date.now();
    await Storage.loadPrintQueue();
    assert.deepEqual(log.wheres.map(w => [w.field, w.op]), [['printedAt', '=='], ['printedAt', '>=']]);
    assert.equal(log.wheres[0].value, null);
    const cutoff = log.wheres[1].value;
    assert.ok(Math.abs(cutoff - Storage.printRetentionCutoff(before)) < 1000, 'cutoff is not 30 days ago');
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o1']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p1']);
  } finally { Storage.init(null); }
});

test('printed listener firing does not wipe open items, and vice versa', async () => {
  const { db, log, fire } = fakeDb({ '==': [doc('o1'), doc('o2')], '>=': [doc('p1', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    let calls = 0;
    Storage.onPrintQueueChange(() => calls++);
    assert.equal(Object.keys(log.listeners).length, 2, 'two listeners registered');
    assert.equal(calls, 2, 'callback fired once per initial snapshot');
    // Remote change on the printed side: p1 gone, p2 arrives. Open items untouched.
    fire('>=', [doc('p2', { printedAt: Date.now() - 2 * DAY })]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o1', 'o2']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p2']);
    // Remote delete on the open side: o1 gone. Printed untouched.
    fire('==', [doc('o2')]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o2']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p2']);
    assert.equal(calls, 4);
  } finally { Storage.init(null); }
});

test('an item moving from open to printed ends up printed exactly once, whichever listener fires first', async () => {
  const { db, fire } = fakeDb({ '==': [doc('x')], '>=': [] });
  Storage.init(db);
  try {
    Storage.onPrintQueueChange(() => {});
    const t = Date.now() - 1000;
    // printed listener first: x is momentarily in both sources — printed wins
    fire('>=', [doc('x', { printedAt: t })]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), []);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['x']);
    fire('==', []);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['x']);
    assert.equal(Storage.getPrintedItems()[0].printedAt, t);
  } finally { Storage.init(null); }
});

test('getPrintedItems shows 29d23h59m-old items and hides 30d0h1m-old ones, newest first', async () => {
  const now = Date.now();
  const { db } = fakeDb({ '==': [], '>=': [
    doc('edge-in',  { printedAt: now - 30 * DAY + 60_000 }),
    doc('edge-out', { printedAt: now - 30 * DAY - 60_000 }),   // a stale tab's listener could still hold this
    doc('recent',   { printedAt: now - DAY }),
  ] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['recent', 'edge-in']);
  } finally { Storage.init(null); }
});

test('unmarkPrinted puts the item back in the open queue with a literal null', async () => {
  await reset();
  const id = await Storage.addPrintItem({ kind: 'stickers', lines: ['U1'], size: '3x1' });
  await Storage.markPrinted(id);
  assert.ok(Storage.getPrintedItems().some(i => i.id === id));
  await Storage.unmarkPrinted(id);
  assert.ok(Storage.getPrintQueue().some(i => i.id === id), 'not back in the open queue');
  assert.ok(!Storage.getPrintedItems().some(i => i.id === id), 'still in printed');
  assert.equal(Storage.getPrintQueue().find(i => i.id === id).printedAt, null);
  await assert.rejects(() => Storage.unmarkPrinted('nope'), /unknown print item/);
});

test('unmarkPrinted writes { printedAt: null } to Firestore (never a field delete)', async () => {
  const { db, log } = fakeDb({ '==': [], '>=': [doc('p', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await Storage.unmarkPrinted('p');
    assert.deepEqual(log.updates, [{ id: 'p', data: { printedAt: null } }]);
  } finally { Storage.init(null); }
});

test('deletePrintItem removes the item from the cache and from Firestore', async () => {
  const { db, log } = fakeDb({ '==': [doc('o')], '>=': [doc('p', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await Storage.deletePrintItem('p');
    assert.deepEqual(log.deletes, ['p']);
    assert.ok(!Storage.getPrintedItems().some(i => i.id === 'p'));
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o'], 'open item must survive');
    await assert.rejects(() => Storage.deletePrintItem('nope'), /unknown print item/);
  } finally { Storage.init(null); }
});

test('deletePrintItem keeps the cache entry when Firestore rejects', async () => {
  const { db } = fakeDb({ '==': [], '>=': [doc('p', { printedAt: Date.now() - DAY })], failDelete: true });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await assert.rejects(() => Storage.deletePrintItem('p'), /boom/);
    assert.ok(Storage.getPrintedItems().some(i => i.id === 'p'), 'a failed delete must not look like it happened');
  } finally { Storage.init(null); }
});

test('countPrintedBefore / clearPrintedBefore query printedAt < cutoff, chunk at 500, and never touch open items', async () => {
  const cutoff = Date.now() - 30 * DAY;
  const old = Array.from({ length: 1001 }, (_, i) => doc('old' + i, { printedAt: cutoff - 1 - i }));
  // A null-printedAt doc smuggled into the '<' result must be ignored, whatever Firestore does with nulls.
  const { db, log } = fakeDb({ '==': [doc('open')], '>=': [], '<': [...old, doc('open')] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    assert.equal(await Storage.countPrintedBefore(cutoff), 1001);
    const n = await Storage.clearPrintedBefore(cutoff);
    assert.equal(n, 1001);
    assert.deepEqual(log.batches.map(b => b.length), [500, 500, 1]);
    assert.ok(!log.batches.flat().includes('open'), 'open item was batched for deletion');
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['open']);
    assert.ok(log.wheres.some(w => w.op === '<' && w.value === cutoff));
  } finally { Storage.init(null); }
});

test('clearPrintedBefore rethrows a batch failure', async () => {
  const cutoff = Date.now() - 30 * DAY;
  const { db } = fakeDb({ '==': [], '>=': [], '<': [doc('old', { printedAt: cutoff - 1 })], failBatch: true });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await assert.rejects(() => Storage.clearPrintedBefore(cutoff), /batch boom/);
  } finally { Storage.init(null); }
});
