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
