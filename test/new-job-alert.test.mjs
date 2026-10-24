// NewJobAlert — which board changes count as "a new job / new sheets arrived", and the banner wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NewJobAlert = require('../js/new-job-alert.js');

const T0 = 1_000_000;
// uploadedAt shaped like a Firestore Timestamp, as the sheets listener hands it over.
const sheet = (fileKey, jobName, ms = T0 + 60_000) => ({ fileKey, jobName, fileName: fileKey + '.html', uploadedAt: { toMillis: () => ms } });

function tracker(board = []) {
  const t = NewJobAlert.create({ sinceMs: T0 });
  t.baseline(board);
  return t;
}

test('the board at load raises nothing', () => {
  const t = tracker([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane')]);
  assert.deepEqual(t.alerts(), []);
});

test('a job uploaded elsewhere raises a new-job alert with its sheet count', () => {
  const t = tracker([sheet('a1', 'Harbor Lane')]);
  const arrived = t.observe([sheet('a1', 'Harbor Lane'), sheet('b1', 'Copperline'), sheet('b2', 'Copperline')]);
  assert.equal(arrived, 2);
  assert.deepEqual(t.alerts(), [{ jobName: 'Copperline', count: 2, newJob: true }]);
  assert.equal(NewJobAlert.message(t.alerts()[0]), 'New job loaded: Copperline · 2 sheets');
});

test('sheets added to a job already on the board say "added"', () => {
  const t = tracker([sheet('a1', 'Harbor Lane')]);
  t.observe([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane')]);
  assert.deepEqual(t.alerts(), [{ jobName: 'Harbor Lane', count: 1, newJob: false }]);
  assert.equal(NewJobAlert.message(t.alerts()[0]), '1 new sheet added to Harbor Lane');
  t.observe([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane'), sheet('a3', 'Harbor Lane'), sheet('a4', 'Harbor Lane')]);
  assert.equal(NewJobAlert.message(t.alerts()[0]), '3 new sheets added to Harbor Lane');
});

test('a big drop arriving one sheet at a time stays one new-job alert', () => {
  const t = tracker();
  t.observe([sheet('b1', 'Copperline')]);
  t.observe([sheet('b1', 'Copperline'), sheet('b2', 'Copperline')]);
  t.observe([sheet('b1', 'Copperline'), sheet('b2', 'Copperline'), sheet('b3', 'Copperline')]);
  assert.deepEqual(t.alerts(), [{ jobName: 'Copperline', count: 3, newJob: true }]);
});

test('sheets this computer uploaded raise nothing', () => {
  const t = tracker();
  const own = new Set(['b1']);
  assert.equal(t.observe([sheet('b1', 'Copperline', null)], own), 0);
  assert.deepEqual(t.alerts(), []);
});

test('a job put back on the board (uploaded before this page opened) raises nothing', () => {
  const t = tracker();
  assert.equal(t.observe([sheet('old1', 'Old Job', T0 - 1)]), 0);
  assert.equal(t.observe([sheet('x1', 'No Time', null)]), 0);
  assert.deepEqual(t.alerts(), []);
});

test('a sheet without a job name is filed under its file name, like the board', () => {
  const t = tracker();
  t.observe([{ fileKey: 'k', fileName: 'loose.html', uploadedAt: { toMillis: () => T0 + 1 } }]);
  assert.equal(t.alerts()[0].jobName, 'loose.html');
});

test('a job deleted before anyone looked drops out of the banner and loses its NEW tag', () => {
  const t = tracker();
  t.observe([sheet('b1', 'Copperline')]);
  assert.equal(t.fresh('Copperline') !== null, true);
  t.observe([]);
  assert.deepEqual(t.alerts(), []);
  assert.equal(t.fresh('Copperline'), null);
});

test('dismiss clears the banner but the job keeps its NEW tag until opened', () => {
  const t = tracker();
  t.observe([sheet('b1', 'Copperline')]);
  t.dismiss();
  assert.deepEqual(t.alerts(), []);
  assert.equal(t.fresh('Copperline') !== null, true);
  t.opened('Copperline');
  assert.equal(t.fresh('Copperline'), null);
});

test('opening one job clears only that job', () => {
  const t = tracker();
  t.observe([sheet('b1', 'Copperline'), sheet('c1', 'Dock Sign')]);
  t.opened('Copperline');
  assert.deepEqual(t.alerts().map(a => a.jobName), ['Dock Sign']);
  assert.equal(t.fresh('Dock Sign') !== null, true);
});

test('the card tag says NEW for a new job and counts sheets added to an old one', () => {
  const t = tracker([sheet('a1', 'Harbor Lane')]);
  t.observe([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane'), sheet('a3', 'Harbor Lane'), sheet('b1', 'Copperline')]);
  assert.equal(NewJobAlert.tag(t.fresh('Copperline')), 'NEW');
  assert.equal(NewJobAlert.tag(t.fresh('Harbor Lane')), '2 NEW SHEETS');
  t.observe([sheet('a1', 'Harbor Lane'), sheet('b1', 'Copperline')]);
  assert.equal(NewJobAlert.tag(t.fresh('Harbor Lane')), null);
  assert.equal(NewJobAlert.tag(null), null);
});

test('a sheet deleted and uploaded again elsewhere alerts again', () => {
  const t = tracker([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane')]);
  t.observe([sheet('a1', 'Harbor Lane')]);
  t.observe([sheet('a1', 'Harbor Lane'), sheet('a2', 'Harbor Lane')]);
  assert.deepEqual(t.alerts(), [{ jobName: 'Harbor Lane', count: 1, newJob: false }]);
});
