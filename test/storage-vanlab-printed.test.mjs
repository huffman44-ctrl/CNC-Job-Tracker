// Storage: the VanLab print records on jobs/{jobKey}.vanlabPrinted (spec .scratch/vanlab-print-bar, ticket 02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DELETE = { __delete: true };
globalThis.firebase = { firestore: { FieldValue: { delete: () => DELETE } } };
const Storage = require('../js/storage.js');

function fakeDb() {
  const writes = [];
  const listeners = [];
  return {
    writes, listeners,
    collection: (name) => ({
      doc: (id) => ({
        async set(data, opts) { writes.push({ op: 'set', path: `${name}/${id}`, data, opts }); },
        onSnapshot(cb) {
          const l = { path: `${name}/${id}`, cb, off: false };
          listeners.push(l);
          return () => { l.off = true; };
        },
      }),
    }),
  };
}

test('setVanlabPrinted merges ONE item into the job doc (never the whole doc)', async () => {
  const db = fakeDb();
  Storage.init(db);
  await Storage.setVanlabPrinted('proj_a', 'Order 1210 Job', 'crate', { at: 5, by: 'Collin' });
  assert.deepEqual(db.writes, [{ op: 'set', path: 'jobs/proj_a', data: { jobName: 'Order 1210 Job', vanlabPrinted: { crate: { at: 5, by: 'Collin' } } }, opts: { merge: true } }]);
});

test('clearVanlabPrinted deletes just that one item', async () => {
  const db = fakeDb();
  Storage.init(db);
  await Storage.clearVanlabPrinted('proj_a', 'packing');
  assert.deepEqual(db.writes, [{ op: 'set', path: 'jobs/proj_a', data: { vanlabPrinted: { packing: DELETE } }, opts: { merge: true } }]);
});

test('an unknown item is refused before anything is written', async () => {
  const db = fakeDb();
  Storage.init(db);
  await assert.rejects(Storage.setVanlabPrinted('proj_a', 'J', 'labels', { at: 1, by: 'C' }));
  await assert.rejects(Storage.clearVanlabPrinted('proj_a', '__proto__'));
  assert.equal(db.writes.length, 0);
});

test('onJobDocChange listens to the one job doc and hands back the data (null when missing)', () => {
  const db = fakeDb();
  Storage.init(db);
  const seen = [];
  const off = Storage.onJobDocChange('proj_a', d => seen.push(d));
  assert.equal(db.listeners.length, 1);
  assert.equal(db.listeners[0].path, 'jobs/proj_a');
  db.listeners[0].cb({ exists: true, data: () => ({ jobName: 'J' }) });
  db.listeners[0].cb({ exists: false, data: () => undefined });
  assert.deepEqual(seen, [{ jobName: 'J' }, null]);
  off();
  assert.equal(db.listeners[0].off, true);
});

test('with no database (test copy) the records live in this tab and listeners still hear them', async () => {
  Storage.init(null);
  const seen = [];
  const off = Storage.onJobDocChange('proj_b', d => seen.push(d));
  assert.deepEqual(seen, [null], 'a listener hears the current state at once, like onSnapshot');
  await Storage.setVanlabPrinted('proj_b', 'J', 'stickers', { at: 1, by: 'Someone' });
  await Storage.setVanlabPrinted('proj_b', 'J', 'crate', { at: 2, by: 'Someone' });
  await Storage.setVanlabPrinted('proj_other', 'K', 'crate', { at: 3, by: 'Someone' });
  await Storage.clearVanlabPrinted('proj_b', 'stickers');
  assert.deepEqual(seen.at(-1), { jobName: 'J', vanlabPrinted: { crate: { at: 2, by: 'Someone' } } });
  assert.equal(seen.length, 4, 'another job does not wake this listener');
  off();
  await Storage.setVanlabPrinted('proj_b', 'J', 'packing', { at: 4, by: 'Someone' });
  assert.equal(seen.length, 4, 'unsubscribed');
});
