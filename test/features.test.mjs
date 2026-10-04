import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Features = require('../js/features.js');

const T = 'travis@example.com', E = 'eva@example.com';

// Fake compat db. existing = doc contents on the server (null = missing).
// fromCache = the plain get() answers from the local cache. appearsAtCommit = a doc another
// owner created between our get() and the transaction re-read.
function fakeDb({ existing = null, denied = false, fromCache = false, appearsAtCommit = null, txFails = false } = {}) {
  const calls = { set: [], txSet: [], tx: 0, listeners: 0 };
  const ref = {
    async get() {
      if (denied) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      return { exists: !!existing, data: () => existing, metadata: { fromCache } };
    },
    async set(d) { calls.set.push(d); },
    onSnapshot() { calls.listeners++; },
  };
  return {
    calls,
    collection: () => ({ doc: () => ref }),
    async runTransaction(fn) {
      calls.tx++;
      if (txFails) throw new Error('aborted');
      const tx = {
        async get() { const d = appearsAtCommit || existing; return { exists: !!d, data: () => d }; },
        set(_r, d) { calls.txSet.push(d); },
      };
      return fn(tx);
    },
  };
}

test('defaults: settings + jobDetails on for the signing-in owner only', () => {
  assert.deepEqual(Features.defaults(T), {
    jobDetails: { on: true, users: [T] }, jobCard: { on: false, users: [] },
    billing: { on: false, users: [] }, settings: { on: true, users: [T] },
  });
});

test('load: a denied read = operator, not owner, every screen off, nothing written', async () => {
  const db = fakeDb({ denied: true });
  assert.equal(await Features.load(db, 'collin@example.com'), false);
  assert.equal(Features.isOwner(), false);
  for (const s of Features.SCREENS) assert.equal(Features.on(s.key), false, s.key);
  assert.deepEqual(db.calls.set, []);
  assert.equal(db.calls.tx, 0);
});

test('load (P22): a cache-only read is UNKNOWN, every switch off, never writes, even if it shows no doc', async () => {
  const db = fakeDb({ existing: null, fromCache: true });
  assert.equal(await Features.load(db, T), false);
  assert.equal(Features.isOwner(), false);
  for (const s of Features.SCREENS) assert.equal(Features.on(s.key), false, s.key);
  assert.deepEqual(db.calls.set, []);
  assert.deepEqual(db.calls.txSet, []);
  assert.equal(db.calls.tx, 0);
});

test('load (P22): a cache-only read that DOES show the doc is still ignored (policy: unknown = all off)', async () => {
  const db = fakeDb({ existing: Features.defaults(T), fromCache: true });
  assert.equal(await Features.load(db, T), false);
  assert.equal(Features.on('settings'), false);
  assert.equal(db.calls.listeners, 0);
});

test('load (P22): any other failed read (e.g. unavailable) = unknown, all off, no write', async () => {
  const db = fakeDb();
  db.collection = () => ({ doc: () => ({ get: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); }, set: async () => { throw new Error('no'); }, onSnapshot() {} }) });
  assert.equal(await Features.load(db, T), false);
  assert.equal(Features.isOwner(), false);
});

test('load (P22): missing doc on a real server read is created inside a transaction for the signed-in owner only', async () => {
  const db = fakeDb({ existing: null });
  assert.equal(await Features.load(db, T.toUpperCase()), true);
  assert.equal(Features.isOwner(), true);
  assert.equal(db.calls.tx, 1);
  assert.deepEqual(db.calls.txSet, [Features.defaults(T)]);
  assert.deepEqual(db.calls.set, [], 'no plain set outside the transaction');
  assert.equal(Features.on('settings'), true);
  assert.equal(Features.on('jobDetails'), true);
  assert.equal(Features.on('jobCard'), false);
  assert.deepEqual(Features.owners(), [T]);
  assert.equal(db.calls.listeners, 1);
});

test('load (P22): doc appears before commit, so it is not overwritten and what is there is used', async () => {
  const theirs = { jobDetails: { on: true, users: [E] }, jobCard: { on: true, users: [E] }, billing: { on: false, users: [] }, settings: { on: true, users: [E] } };
  const db = fakeDb({ existing: null, appearsAtCommit: theirs });
  assert.equal(await Features.load(db, T), true);
  assert.deepEqual(db.calls.txSet, [], 'no write when the doc exists at commit');
  assert.equal(Features.on('settings'), false, 'that account is not listed in the doc that was there');
  assert.deepEqual(Features.getState(), theirs);
});

test('load (P22): a failed transaction = unknown, all off', async () => {
  const db = fakeDb({ existing: null, txFails: true });
  assert.equal(await Features.load(db, T), false);
  assert.equal(Features.isOwner(), false);
});

test('load: existing doc, a screen is on only for the emails listed, case-insensitively', async () => {
  const state = { jobDetails: { on: true, users: [T] }, jobCard: { on: true, users: [E] }, billing: { on: false, users: [T] }, settings: { on: true, users: [T, E] } };
  const db = fakeDb({ existing: state });
  await Features.load(db, E.toUpperCase());
  assert.equal(Features.on('jobCard'), true);
  assert.equal(Features.on('jobDetails'), false);
  assert.equal(Features.on('billing'), false, 'on:false hides it even when listed');
  assert.equal(Features.on('settings'), true);
  assert.deepEqual(Features.owners(), [E, T]);
  assert.deepEqual(db.calls.set, [], 'an existing doc is never rewritten on load');
  assert.equal(db.calls.tx, 0);
});

test('applySwitch: pure, adds/removes an email, on follows the user list, settings keeps one owner', () => {
  const s0 = Features.defaults(T);
  const s1 = Features.applySwitch(s0, 'jobCard', E, true);
  assert.deepEqual(s1.jobCard, { on: true, users: [E] });
  assert.deepEqual(s0.jobCard, { on: false, users: [] }, 'input not mutated');
  const s2 = Features.applySwitch(s1, 'jobCard', E, false);
  assert.deepEqual(s2.jobCard, { on: false, users: [] });
  assert.throws(() => Features.applySwitch(s0, 'settings', T, false), /Settings must stay on for at least one owner/);
  const s3 = Features.applySwitch(s0, 'settings', E, true);
  assert.deepEqual(Features.applySwitch(s3, 'settings', T, false).settings, { on: true, users: [E] });
  assert.throws(() => Features.applySwitch(s0, 'nope', T, true), /Unknown screen/);
});

test('setSwitch writes the whole doc and notifies', async () => {
  const db = fakeDb({ existing: Features.defaults(T) });
  await Features.load(db, T);
  let fired = 0;
  Features.onChange(() => fired++);
  await Features.setSwitch('jobCard', T, true);
  assert.equal(Features.on('jobCard'), true);
  assert.deepEqual(db.calls.set.at(-1).jobCard, { on: true, users: [T] });
  assert.equal(fired, 1);
});

test('_setForTests drives owner state with no db (PASTE-mode browser checks)', () => {
  Features._setForTests(Features.defaults(T), T);
  assert.equal(Features.isOwner(), true);
  assert.equal(Features.on('settings'), true);
  Features._setForTests(null, 'collin@example.com');
  assert.equal(Features.isOwner(), false);
});

test('getState returns a copy (null for operators)', () => {
  Features._setForTests(Features.defaults(T), T);
  const s = Features.getState();
  s.jobCard.on = true; s.jobCard.users.push(T);
  assert.equal(Features.on('jobCard'), false, 'mutating the copy changes nothing');
  Features._setForTests(null, 'collin@example.com');
  assert.equal(Features.getState(), null);
});

test('fix: setSwitch with no loaded owner state rejects and leaves state null', async () => {
  Features._setForTests(null, 'collin@example.com');
  await assert.rejects(() => Features.setSwitch('jobCard', 'collin@example.com', true), /Owner settings not loaded/);
  assert.equal(Features.isOwner(), false);
  assert.equal(Features.on('jobCard'), false);
});

test('fix: applySwitch refuses a doc with no settings key, and turning off the last Settings user', () => {
  assert.throws(() => Features.applySwitch(null, 'jobCard', T, true), /Settings must stay on/);
  assert.throws(() => Features.applySwitch({ jobCard: { on: false, users: [] } }, 'jobCard', T, true), /Settings must stay on/);
  assert.throws(() => Features.applySwitch(Features.defaults(T), 'settings', T, false), /Settings must stay on/);
  assert.deepEqual(Features.applySwitch(Features.defaults(T), 'billing', T, true).billing, { on: true, users: [T] });
});

test('fix: a failed write restores the previous state and rethrows', async () => {
  const db = fakeDb({ existing: Features.defaults(T) });
  await Features.load(db, T);
  db.collection = () => ({ doc: () => ({ set: async () => { throw new Error('denied'); } }) });
  await assert.rejects(() => Features.setSwitch('jobCard', T, true), /denied/);
  assert.equal(Features.on('jobCard'), false);
});

test('fix: empty or missing email = all off, no read, no write', async () => {
  for (const e of ['', '  ', undefined, null]) {
    const db = fakeDb({ existing: null });
    let reads = 0;
    const orig = db.collection;
    db.collection = (...a) => { reads++; return orig(...a); };
    assert.equal(await Features.load(db, e), false);
    assert.equal(Features.isOwner(), false);
    assert.equal(reads, 0);
    assert.deepEqual(db.calls.set, []);
    assert.equal(db.calls.tx, 0);
  }
});
