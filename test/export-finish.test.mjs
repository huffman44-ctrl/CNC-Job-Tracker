import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExportFinish = require('../js/export-finish.js');

// Fake names only (public repo).
const sheetA = { fileKey: 'fk_a', fileName: 'Harbor_Sign_Summary_Sheet 1.html', sheetTitle: 'Sheet 1', jobName: 'Harbor_Sign', totalTime: '00:20:00', toolpaths: [{ name: 'Profile' }] };
const sheetB = { fileKey: 'fk_b', fileName: 'Harbor_Sign_Summary_Sheet 2.html', sheetTitle: 'Sheet 2', jobName: 'Harbor_Sign', totalTime: '00:10:00', toolpaths: [] };
const job = { jobName: 'Harbor_Sign', jobSheets: [sheetA, sheetB], customerName: 'Harbor Lane Pictures', by: 'op@example.test' };

// Every collaborator faked; `calls` records what happened, in order.
function fakeDeps(over = {}) {
  const calls = [];
  const deps = {
    logEnabled: () => true,
    getIdToken: async () => 'tok',
    upsertLogRows: async (rows, token) => { calls.push(['log', rows.map(r => r.key), token]); return { ok: true }; },
    completionOf: () => null,
    hasDatabase: () => true,
    finishJob: async (jobName, by) => { calls.push(['finishJob', jobName, by]); },
    finishSheets: async (sheets, by) => { calls.push(['finishSheets', sheets.map(s => s.fileKey), by]); },
    ...over,
  };
  return { deps, calls };
}

test('log written -> job finished, then its sheets', async () => {
  const { deps, calls } = fakeDeps();
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: true });
  assert.deepEqual(calls, [
    ['log', ['fk_a', 'fk_b'], 'tok'],
    ['finishJob', 'Harbor_Sign', 'op@example.test'],
    ['finishSheets', ['fk_a', 'fk_b'], 'op@example.test'],
  ]);
});

const keptMessage = reason => `Master Job Log was NOT updated${reason}. The CSV still downloaded. The job was kept so you can export it again later.`;
const finishCalls = calls => calls.filter(c => c[0] !== 'log');

test('log endpoint unreachable -> job kept, nothing finished', async () => {
  const { deps, calls } = fakeDeps({ upsertLogRows: async () => { throw new TypeError('Failed to fetch'); } });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: keptMessage(' (endpoint unreachable)') });
  assert.deepEqual(finishCalls(calls), []);
});

test('sign-in token fails -> job kept, told to sign out and back in, log never called', async () => {
  const { deps, calls } = fakeDeps({ getIdToken: async () => { throw new Error('auth/network-request-failed'); } });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: keptMessage(': could not confirm your sign-in - sign out and back in') });
  assert.deepEqual(calls, []);
});

test('log endpoint returns an error -> job kept, message carries the endpoint text', async () => {
  const err = Object.assign(new Error('Tab "Harbor Lane Pictures" is protected'), { endpointError: true });
  const { deps, calls } = fakeDeps({ upsertLogRows: async () => { throw err; } });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: keptMessage(': Tab "Harbor Lane Pictures" is protected') });
  assert.deepEqual(finishCalls(calls), []);
});

test('log not set up on a real-database computer -> job kept, nothing was written', async () => {
  const { deps, calls } = fakeDeps({ logEnabled: () => false, upsertLogRows: async () => ({ ok: true, offline: true }) });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: keptMessage(": the Master Job Log connection isn't set up on this computer") });
  assert.deepEqual(finishCalls(calls), []);
});

test('log not set up in PASTE test mode (no database) -> counts as logged, job finished', async () => {
  const { deps, calls } = fakeDeps({ logEnabled: () => false, hasDatabase: () => false, upsertLogRows: async () => ({ ok: true, offline: true }) });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: true });
  assert.equal(finishCalls(calls).length, 2);
});

test('log answers without ok -> job kept, reported as unreachable', async () => {
  const { deps, calls } = fakeDeps({ upsertLogRows: async () => ({ ok: false }) });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: keptMessage(' (endpoint unreachable)') });
  assert.deepEqual(finishCalls(calls), []);
});

const finishFailedMessage = why => `The Master Job Log was updated, but the job could not be marked finished (${why}). It stays on the board - export it again once the connection is back; the log rows will not be duplicated.`;

test('job doc finish fails after the log write -> kept, sheets never touched', async () => {
  const { deps, calls } = fakeDeps({ finishJob: async () => { throw new Error('unavailable'); } });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: finishFailedMessage('unavailable') });
  assert.deepEqual(finishCalls(calls), []);
});

test('sheets finish fails after the log write -> kept, same message', async () => {
  const { deps } = fakeDeps({ finishSheets: async () => { throw new Error('permission-denied'); } });
  const out = await ExportFinish.logAndFinish(job, deps);
  assert.deepEqual(out, { finished: false, message: finishFailedMessage('permission-denied') });
});

test('no job name -> sheets finished without a job doc', async () => {
  const { deps, calls } = fakeDeps();
  const out = await ExportFinish.logAndFinish({ ...job, jobName: null }, deps);
  assert.deepEqual(out, { finished: true });
  assert.deepEqual(finishCalls(calls), [['finishSheets', ['fk_a', 'fk_b'], 'op@example.test']]);
});

test('log rows carry the customer and each sheet\'s own completion', async () => {
  let sent = null;
  const done = { fk_a: { status: 'complete', completedAt: new Date(2026, 9, 9, 14, 5).toISOString(), operator: 'Collin', notes: 'clean cut' } };
  const { deps } = fakeDeps({
    completionOf: k => done[k] || null,
    upsertLogRows: async rows => { sent = rows; return { ok: true }; },
  });
  await ExportFinish.logAndFinish(job, deps);
  assert.equal(sent.length, 2);
  assert.deepEqual([sent[0].operator, sent[0].notes, sent[0].customer], ['Collin', 'clean cut', 'Harbor Lane Pictures']);
  assert.deepEqual([sent[1].operator, sent[1].completedTime, sent[1].customer], ['', '', 'Harbor Lane Pictures']);
});

// ── csvFile: the 9-column Estimating App import file ──
const at = new Date(2026, 9, 9, 14, 5).toISOString();
const atText = new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

test('csvFile: header, a cut V-bit sheet and an uncut sheet, CRLF rows, every cell quoted', () => {
  const vbit = { ...sheetA, toolpaths: [{ name: 'Profile' }, { name: 'V-Carve Logo' }] };
  const done = { fk_a: { status: 'complete', completedAt: at, operator: 'Collin', notes: 'clean cut' } };
  const { text } = ExportFinish.csvFile([vbit, sheetB], k => done[k] || null, 'Harbor Lane Pictures');
  assert.equal(text, [
    '"Sheet","Job","Total Time","Toolpath Count","Has V-bit","Completed At","Operator","Notes","Customer"',
    `"Sheet 1","Harbor_Sign","00:20:00","2","Y","${atText}","Collin","clean cut","Harbor Lane Pictures"`,
    '"Sheet 2","Harbor_Sign","00:10:00","0","N","","","","Harbor Lane Pictures"',
  ].join('\r\n'));
});

test('csvFile: named under the customer folder after the first sheet, "_Summary…" dropped', () => {
  const { name } = ExportFinish.csvFile([sheetA, sheetB], () => null, 'Harbor Lane Pictures');
  assert.equal(name, 'CNC Job Exports/Harbor Lane Pictures/Harbor_Sign.csv');
});

test('csvFile: a customer name with path characters is made folder-safe', () => {
  const { name } = ExportFinish.csvFile([sheetA], () => null, 'North/Light: Studios');
  assert.equal(name, 'CNC Job Exports/North-Light- Studios/Harbor_Sign.csv');
});

test('csvFile: quotes in notes are doubled and line breaks become one space', () => {
  const done = { fk_a: { status: 'complete', completedAt: at, operator: 'Collin', notes: 'used the "new" bit\r\n\r\nrecut 2\nok' } };
  const { text } = ExportFinish.csvFile([sheetA], k => done[k] || null, '');
  assert.equal(text.split('\r\n')[1], `"Sheet 1","Harbor_Sign","00:20:00","1","N","${atText}","Collin","used the ""new"" bit recut 2 ok",""`);
});

test('csvFile: a sheet with no title falls back to its file name; no toolpath list -> blank count', () => {
  const bare = { fileKey: 'fk_c', fileName: 'Loose_Sheet.html' };
  const { text, name } = ExportFinish.csvFile([bare], () => null, 'Harbor Lane Pictures');
  assert.equal(text.split('\r\n')[1], '"Loose_Sheet.html","","","","N","","","","Harbor Lane Pictures"');
  assert.equal(name, 'CNC Job Exports/Harbor Lane Pictures/Loose_Sheet.csv');
});
