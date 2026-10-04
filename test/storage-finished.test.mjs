import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// saveSheet reaches for firebase.firestore.FieldValue inside its try block; give it a stub so
// the fake-db test below exercises the write instead of the catch.
globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TS', increment: (n) => ({ increment: n }) } } };
const Storage = require('../js/storage.js');

// Minimal compat-API fake: records set/update calls per collection/doc, answers get().
function fakeDb(docs = {}) {
  const writes = [];
  const col = (name) => ({
    doc: (id) => ({
      async get() { const d = docs[`${name}/${id}`]; return { exists: !!d, data: () => d, id }; },
      async set(data, opts) { writes.push({ op: 'set', path: `${name}/${id}`, data, opts }); docs[`${name}/${id}`] = opts && opts.merge ? { ...(docs[`${name}/${id}`] || {}), ...data } : data; },
      async update(data) { writes.push({ op: 'update', path: `${name}/${id}`, data }); Object.assign(docs[`${name}/${id}`] = docs[`${name}/${id}`] || {}, data); },
    }),
    where() { return { async get() { return { docs: [], size: 0 }; }, onSnapshot() {} }; },
    async get() { const entries = Object.entries(docs).filter(([k]) => k.startsWith(name + '/')); return { size: entries.length, docs: entries.map(([k, v]) => ({ id: k.split('/')[1], data: () => v, ref: col(name).doc(k.split('/')[1]) })) }; },
    onSnapshot() {},
  });
  return { collection: col, batch() { const ops = []; return { update(ref, data) { ops.push(() => ref.update(data)); }, async commit() { for (const op of ops) await op(); writes.push({ op: 'commit', n: ops.length }); } }; }, writes, docs };
}

test('filterActive keeps unfinished AND legacy docs (no field), drops finished', () => {
  const docs = [{ fileKey: 'a', finished: false }, { fileKey: 'legacy' }, { fileKey: 'done', finished: true }];
  assert.deepEqual(Storage.filterActive(docs).map(d => d.fileKey), ['a', 'legacy']);
});

test('sortByUploadedAt: pending/missing timestamps sort last, never vanish', () => {
  const ts = (ms) => ({ toMillis: () => ms });
  const sorted = Storage.sortByUploadedAt([{ k: 'late', uploadedAt: ts(300) }, { k: 'none' }, { k: 'early', uploadedAt: ts(100) }]);
  assert.deepEqual(sorted.map(d => d.k), ['early', 'late', 'none']);
});

test('finishPatch clears the drawing only when an archive copy exists', () => {
  const by = 'collin@example.com';
  assert.deepEqual(Storage.finishPatch({ fileKey: 'a', archiveUrl: 'https://drive/x' }, by, 1000),
    { finished: true, finishedAt: 1000, finishedBy: by, layoutSvg: '', layoutSvgGz: '', layoutOversize: false });
  assert.deepEqual(Storage.finishPatch({ fileKey: 'b' }, by, 1000),
    { finished: true, finishedAt: 1000, finishedBy: by });
});

test('before any migration: filter not ready, state null; offline finish/unfinish are no-ops that resolve', async () => {
  assert.equal(Storage.sheetsFilterReady(), false);
  assert.equal(Storage.migrationState(), null);
  assert.deepEqual(await Storage.finishSheets([{ fileKey: 'a' }], 'x'), { count: 1 });
  await Storage.unfinishSheets(['a']);
  assert.equal(await Storage.getSheetDoc('a'), null);
  assert.deepEqual(await Storage.loadFinishedSheets(), []);
});

test('with a db: saveSheet writes finished:false; getSheetDoc reads it back; finishSheets updates in a batch', async () => {
  const db = fakeDb();
  Storage.init(db);
  const res = await Storage.saveSheet({ fileKey: 'fk1', fileName: 'Sheet 1.html', jobName: 'Northlight Wall', layoutSvg: '' });
  assert.equal(res.ok, true);
  const saved = db.writes.find(w => w.path === 'sheets/fk1' && w.op === 'set').data;
  assert.equal(saved.finished, false);
  assert.equal(saved.fileName, 'Sheet 1.html');
  assert.deepEqual(await Storage.getSheetDoc('fk1'), saved);
  assert.equal(await Storage.getSheetDoc('nope'), null);
  await Storage.finishSheets([{ fileKey: 'fk1', archiveUrl: 'https://drive/x' }], 'collin@example.com');
  assert.equal(db.docs['sheets/fk1'].finished, true);
  assert.equal(db.docs['sheets/fk1'].layoutSvgGz, '');
  assert.ok(db.writes.some(w => w.op === 'commit' && w.n === 1));
  await Storage.unfinishSheets(['fk1']);
  assert.equal(db.docs['sheets/fk1'].finished, false);
});

test('getSheetDoc: a failed read rejects (never looks like "not found")', async () => {
  const boom = new Error('permission-denied');
  Storage.init({ collection: () => ({ doc: () => ({ async get() { throw boom; } }) }) });
  await assert.rejects(() => Storage.getSheetDoc('fk1'), (e) => e === boom);
});

test('jobs: upsertJob creates once, finishJob stamps + increments, reopenJob clears', async () => {
  const db = fakeDb();
  Storage.init(db);
  await Storage.upsertJob('proj_1', 'Northlight Wall', 'travis@example.com');
  await Storage.upsertJob('proj_1', 'Northlight Wall', 'travis@example.com');
  const creates = db.writes.filter(w => w.path === 'jobs/proj_1' && w.op === 'set' && !(w.opts && w.opts.merge));
  assert.equal(creates.length, 1, 'second upsert does not rewrite createdAt');
  assert.equal(db.docs['jobs/proj_1'].finished, false);
  assert.equal(db.docs['jobs/proj_1'].exportCount, 0);
  await Storage.finishJob('proj_1', 'Northlight Wall', 'collin@example.com');
  assert.equal(db.docs['jobs/proj_1'].finished, true);
  assert.equal(db.docs['jobs/proj_1'].finishedBy, 'collin@example.com');
  assert.deepEqual(db.docs['jobs/proj_1'].exportCount, { increment: 1 });
  await Storage.reopenJob('proj_1');
  assert.equal(db.docs['jobs/proj_1'].finished, false);
});

test('migrateFinishedFlag stamps only docs lacking the field, writes the flag, is idempotent', async () => {
  const db = fakeDb({ 'sheets/a': { fileKey: 'a' }, 'sheets/b': { fileKey: 'b', finished: true }, 'sheets/c': { fileKey: 'c' } });
  Storage.init(db);
  const progress = [];
  const first = await Storage.migrateFinishedFlag((done, total) => progress.push([done, total]));
  assert.deepEqual(first, { stamped: 2, total: 3 });
  assert.equal(db.docs['sheets/a'].finished, false);
  assert.equal(db.docs['sheets/b'].finished, true, 'an already-finished doc is untouched');
  assert.equal(db.docs['sheets/c'].finished, false);
  assert.deepEqual(progress, [[2, 2]]);
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.done, true);
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.count, 2);
  assert.equal(Storage.sheetsFilterReady(), true);
  const second = await Storage.migrateFinishedFlag();
  assert.deepEqual(second, { stamped: 0, total: 3 });
  assert.equal(db.docs['settings/migrations'].sheetsFinishedFlag.count, 2, 'count is the running total, not reset');
});

test('upsertJobForUpload: creates once with createdAt/createdBy kept, and always ends finished:false', async () => {
  const db = fakeDb({ 'jobs/proj_9': { jobName: 'Old Job', finished: true, finishedBy: 'collin@example.com', createdAt: 111, createdBy: 'first@example.com' } });
  Storage.init(db);
  await Storage.upsertJobForUpload('proj_9', 'Old Job', 'travis@example.com');
  assert.equal(db.docs['jobs/proj_9'].finished, false, 'a re-uploaded finished job is open again');
  assert.equal(db.docs['jobs/proj_9'].createdAt, 111, 'createdAt untouched');
  assert.equal(db.docs['jobs/proj_9'].createdBy, 'first@example.com');
  await Storage.upsertJobForUpload('proj_new', 'New Job', 'travis@example.com');
  assert.equal(db.docs['jobs/proj_new'].finished, false);
  assert.equal(db.docs['jobs/proj_new'].createdBy, 'travis@example.com');
});
