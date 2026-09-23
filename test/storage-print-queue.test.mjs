import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');   // no init() => db is null, cache-only

const batch = (lines, extra = {}) => ({
  kind: 'stickers', lines, size: '3x1', jobName: null, createdBy: 'travis@example.com', ...extra,
});

test('empty queue reads as empty arrays', () => {
  assert.deepEqual(Storage.getPrintQueue(), []);
  assert.deepEqual(Storage.getPrintedItems(), []);
});

test('addPrintItem returns an id and the item shows in the open queue, oldest first', async () => {
  const id1 = await Storage.addPrintItem(batch(['ED1', 'ED2']));
  const id2 = await Storage.addPrintItem(batch(['A'], { size: '4x6' }));
  assert.ok(id1 && id2 && id1 !== id2);
  const q = Storage.getPrintQueue();
  assert.deepEqual(q.map(i => i.id), [id1, id2]);
  assert.deepEqual(q[0].lines, ['ED1', 'ED2']);
  assert.equal(q[0].size, '3x1');
  assert.equal(q[0].kind, 'stickers');
  assert.equal(q[0].fileId, null);
  assert.equal(q[0].jobName, null);
  assert.equal(q[0].createdBy, 'travis@example.com');
  assert.equal(typeof q[0].createdAt, 'number');
  assert.equal(q[0].printedAt, null);
});

test('markPrinted moves the item from the open queue to printed history', async () => {
  const id = await Storage.addPrintItem(batch(['X1']));
  await Storage.markPrinted(id);
  assert.ok(!Storage.getPrintQueue().some(i => i.id === id), 'still in the open queue');
  const printed = Storage.getPrintedItems();
  assert.equal(printed[0].id, id, 'most recently printed should come first');
  assert.equal(typeof printed[0].printedAt, 'number');
});

test('markPrinted on an unknown id throws', async () => {
  await assert.rejects(() => Storage.markPrinted('nope'), /unknown print item/);
});

test('addPrintItem does not mutate the caller\'s lines array', async () => {
  const lines = ['ED1'];
  const id = await Storage.addPrintItem(batch(lines));
  Storage.getPrintQueue().find(i => i.id === id).lines.push('ED2');
  assert.deepEqual(lines, ['ED1']);
});

test('addPrintItem records pages for documents and null for stickers', async () => {
  const docId = await Storage.addPrintItem({ kind: 'document', fileId: 'F1', fileName: 'cut-list.pdf', pages: 8, size: '4x6', lines: [] });
  const doc = Storage.getPrintQueue().find(i => i.id === docId);
  assert.equal(doc.kind, 'document');
  assert.equal(doc.pages, 8);
  assert.equal(doc.fileId, 'F1');
  assert.equal(doc.fileName, 'cut-list.pdf');
  assert.deepEqual(doc.lines, []);
  const stId = await Storage.addPrintItem(batch(['ED1']));
  assert.equal(Storage.getPrintQueue().find(i => i.id === stId).pages, null);
});

test('loadPrintQueue tolerates a doc with no lines array', async () => {
  const fakeDb = { collection: () => ({ where: () => ({ get: async () => ({
    forEach: fn => fn({ id: 'odd', data: () => ({ kind: 'stickers', size: '3x1', createdAt: 1, printedAt: null }) }),
  }) }) }) };
  Storage.init(fakeDb);
  try {
    await Storage.loadPrintQueue();
    const item = Storage.getPrintQueue().find(i => i.id === 'odd');
    assert.deepEqual(item.lines, []);
  } finally {
    Storage.init(null);
  }
});
