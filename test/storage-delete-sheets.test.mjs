// Storage.deleteSheets — one complete delete for a list of sheets (spec .scratch/complete-sheet-delete).
// The sheet doc goes first; its completion, note and markup only after that worked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');
const { makeDb } = require('./helpers/fake-firestore.cjs');

const RECORD = ['completions', 'sheetNotes', 'sheetAnnotations'];

// A db holding each key's full record (sheet + the three per-sheet docs), with Storage's caches
// loaded from it the way the app loads them at start-up.
async function seeded(keys) {
  const db = makeDb();
  for (const k of keys) {
    db._seed('sheets', k, { fileKey: k, fileName: `${k}.html`, jobName: 'Northlight Wall', finished: false });
    db._seed('completions', k, { status: 'complete', operator: 'Collin', completedAt: 1000 });
    db._seed('sheetNotes', k, { text: `note for ${k}` });
    db._seed('sheetAnnotations', k, { shapes: [{ type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red' }] });
  }
  Storage.init(db);
  await Promise.all([Storage.loadCompletions(), Storage.loadSheetNotes(), Storage.loadAnnotations()]);
  return db;
}
const has = (db, col, id) => !!(db._data[col] && db._data[col][id]);
const cached = (k) => ({ completion: Storage.get(k, 'sheet') !== null, note: Storage.getSheetNote(k) !== null, markup: Storage.getAnnotations(k).length > 0 });
const allCached = { completion: true, note: true, markup: true };
const noneCached = { completion: false, note: false, markup: false };

test('one sheet: the sheet and its completion, note and markup are all gone, reported deleted', async () => {
  const db = await seeded(['a1']);
  const res = await Storage.deleteSheets(['a1']);
  assert.deepEqual(res, { deleted: ['a1'], blocked: [], failed: [] });
  for (const col of ['sheets', ...RECORD]) assert.equal(has(db, col, 'a1'), false, `${col}/a1 left behind`);
  assert.deepEqual(cached('a1'), noneCached);
});

test('sheet delete refused (permission-denied = on an invoice): blocked, and its record survives', async () => {
  const db = await seeded(['b1']);
  db._hooks.failWrites = (col) => col === 'sheets';
  const res = await Storage.deleteSheets(['b1']);
  assert.deepEqual(res, { deleted: [], blocked: ['b1'], failed: [] });
  for (const col of ['sheets', ...RECORD]) assert.equal(has(db, col, 'b1'), true, `${col}/b1 was removed`);
  assert.deepEqual(cached('b1'), allCached);
});

test('sheet delete fails for another reason: failed with its message, record untouched', async () => {
  const db = await seeded(['c1']);
  db._hooks.failWrites = (col) => col === 'sheets' && Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
  const res = await Storage.deleteSheets(['c1']);
  assert.deepEqual(res, { deleted: [], blocked: [], failed: [{ fileKey: 'c1', message: 'Failed to get document because the client is offline.' }] });
  for (const col of ['sheets', ...RECORD]) assert.equal(has(db, col, 'c1'), true, `${col}/c1 was removed`);
  assert.deepEqual(cached('c1'), allCached);
});

test('a job of three, one blocked: two deleted and one blocked, reported together; caches follow', async () => {
  const db = await seeded(['d1', 'd2', 'd3']);
  db._hooks.failWrites = (col, id) => col === 'sheets' && id === 'd2';
  const res = await Storage.deleteSheets(['d1', 'd2', 'd3']);
  assert.deepEqual(res, { deleted: ['d1', 'd3'], blocked: ['d2'], failed: [] });
  assert.equal(has(db, 'sheets', 'd1') || has(db, 'sheets', 'd3'), false);
  assert.equal(has(db, 'completions', 'd2'), true, 'the blocked sheet keeps its cut record');
  assert.deepEqual(cached('d1'), noneCached);
  assert.deepEqual(cached('d3'), noneCached);
  assert.deepEqual(cached('d2'), allCached);
});

test('the sheet goes but its note delete fails: still reported deleted', async () => {
  const db = await seeded(['e1']);
  db._hooks.failWrites = (col) => col === 'sheetNotes';
  const warn = console.warn; console.warn = () => {};
  let res;
  try { res = await Storage.deleteSheets(['e1']); } finally { console.warn = warn; }
  assert.deepEqual(res, { deleted: ['e1'], blocked: [], failed: [] });
  assert.equal(has(db, 'sheets', 'e1'), false);
  assert.equal(has(db, 'completions', 'e1'), false);
  assert.equal(has(db, 'sheetAnnotations', 'e1'), false);
});

test('PASTE mode (no database): everything reported deleted and the caches cleared', async () => {
  Storage.init(null);
  await Storage.set('p1', 'sheet', { status: 'complete', operator: 'Collin', completedAt: 1 });
  await Storage.setSheetNote('p1', 'cut the pocket first');
  await Storage.setAnnotations('p1', [{ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' }]);
  assert.deepEqual(cached('p1'), allCached);
  const res = await Storage.deleteSheets(['p1', 'p2']);
  assert.deepEqual(res, { deleted: ['p1', 'p2'], blocked: [], failed: [] });
  assert.deepEqual(cached('p1'), noneCached);
});

test('an empty list deletes nothing', async () => {
  await seeded([]);
  assert.deepEqual(await Storage.deleteSheets([]), { deleted: [], blocked: [], failed: [] });
});
