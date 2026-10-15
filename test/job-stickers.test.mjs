// JobStickers — which print-queue items belong to a job, how many wait, and their order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JobStickers = require('../js/job-stickers.js');

const item = (id, jobName, createdAt, printedAt = null) => ({ id, jobName, createdAt, printedAt });

test('same job name matches', () => {
  const items = [item('a', 'Harbor Lane', 1), item('b', 'Copperline Stage Set', 2)];
  assert.deepEqual(JobStickers.forJob(items, 'Harbor Lane').map(i => i.id), ['a']);
});

test('different inner spacing is a different job', () => {
  const items = [item('a', 'Harbor  Lane', 1)];
  assert.deepEqual(JobStickers.forJob(items, 'Harbor Lane'), []);
});

test('leading/trailing spaces are a different job (never trimmed)', () => {
  const items = [item('a', ' Harbor Lane ', 1), item('b', 'Harbor Lane', 2)];
  assert.deepEqual(JobStickers.forJob(items, 'Harbor Lane').map(i => i.id), ['b']);
  assert.deepEqual(JobStickers.forJob(items, ' Harbor Lane ').map(i => i.id), ['a']);
});

test('null item jobName never matches; null/empty query matches nothing', () => {
  const items = [item('a', null, 1), item('b', '', 2), item('c', 'Harbor Lane', 3)];
  assert.deepEqual(JobStickers.forJob(items, 'Harbor Lane').map(i => i.id), ['c']);
  assert.deepEqual(JobStickers.forJob(items, null), []);
  assert.deepEqual(JobStickers.forJob(items, ''), []);
  assert.deepEqual(JobStickers.forJob(items, undefined), []);
});

test('waitingCount ignores printed items and other jobs', () => {
  const items = [
    item('a', 'Harbor Lane', 1),
    item('b', 'Harbor Lane', 2),
    item('c', 'Harbor Lane', 3, 99),
    item('d', 'Copperline Stage Set', 4),
    item('e', null, 5),
  ];
  assert.equal(JobStickers.waitingCount(items, 'Harbor Lane'), 2);
  assert.equal(JobStickers.waitingCount(items, 'Copperline Stage Set'), 1);
  assert.equal(JobStickers.waitingCount(items, null), 0);
});

test('ordered: waiting oldest first (missing createdAt last), then printed newest first; input untouched', () => {
  const items = [
    item('p1', 'Harbor Lane', 1, 10),
    item('w2', 'Harbor Lane', 20),
    item('p2', 'Harbor Lane', 2, 30),
    item('wNone', 'Harbor Lane', undefined),
    item('w1', 'Harbor Lane', 5),
  ];
  const before = items.map(i => i.id);
  const out = JobStickers.ordered(items);
  assert.deepEqual(out.map(i => i.id), ['w1', 'w2', 'wNone', 'p2', 'p1']);
  assert.deepEqual(items.map(i => i.id), before);
  assert.notEqual(out, items);
});
