// UploadBatch — what happens to every file in a drop (spec .scratch/upload-guard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UploadBatch = require('../js/upload-batch.js');
const Keys = require('../js/keys.js');

// A parsed Aspire sheet (the parser is DOM-only; tests feed its output through a fake parse).
const SHEET = { jobName: 'NL_Bridge_Wall_Panels', sheetTitle: 'Sheet 1', totalTime: '00:12:00', toolpaths: [{ name: 'Profile' }], materialInfo: [], layoutSvg: '' };
const EMPTY = { jobName: '', sheetTitle: 'Sheet', totalTime: '', toolpaths: [], materialInfo: [], layoutSvg: '' };

const file = (name, text = 'aspire') => ({ name, read: async () => text });
const unreadable = (name) => ({ name, read: async () => { throw new Error('NotReadableError'); } });

// Fake world: a board, a database of sheet docs, and logs of what was saved / archived.
function world({ board = [], docs = {}, parse = () => ({ ...SHEET }), getSheetDoc, saveSheet, archiveUrl = 'https://drive/x' } = {}) {
  const w = { board: new Set(board), docs, saved: [], archived: [], urls: {} };
  w.deps = {
    parse,
    onBoard: k => w.board.has(k),
    addToBoard: s => w.board.add(s.fileKey),
    removeFromBoard: k => w.board.delete(k),
    getSheetDoc: getSheetDoc || (async k => w.docs[k] || null),
    saveSheet: saveSheet || (async s => { w.saved.push(s.fileKey); return { ok: true, mode: 'plain' }; }),
    archive: async (name, jobName, text) => { w.archived.push({ name, jobName, text }); return archiveUrl; },
    setArchiveUrl: (k, url) => { w.urls[k] = url; },
  };
  return w;
}
const settle = () => new Promise(r => setTimeout(r, 0));   // let the fire-and-forget archive attach its URL

test('a new sheet is saved, put on the board, archived with its link, and grouped by job', async () => {
  const w = world();
  const res = await UploadBatch.run([file('NL Sheet 1.html', '<html>one</html>')], w.deps);
  const k = Keys.sheet('NL Sheet 1.html');
  assert.equal(res.saved.length, 1);
  assert.equal(res.saved[0].sheet.fileKey, k);
  assert.equal(res.saved[0].sheet.fileName, 'NL Sheet 1.html');
  assert.deepEqual(w.saved, [k]);
  assert.ok(w.board.has(k));
  assert.deepEqual([...res.savedByJob], [['NL_Bridge_Wall_Panels', [k]]]);
  assert.deepEqual(w.archived, [{ name: 'NL Sheet 1.html', jobName: 'NL_Bridge_Wall_Panels', text: '<html>one</html>' }]);
  await settle();
  assert.equal(w.urls[k], 'https://drive/x');
  assert.equal(UploadBatch.notice(res, String), null);
});

test('already on this board: nothing read, saved or archived', async () => {
  const k = Keys.sheet('NL Sheet 2.html');
  let reads = 0;
  const w = world({ board: [k], getSheetDoc: async () => { reads++; return null; } });
  const res = await UploadBatch.run([file('NL Sheet 2.html')], w.deps);
  assert.deepEqual(res.alreadyLoaded, ['NL Sheet 2.html']);
  assert.equal(reads, 0);
  assert.deepEqual(w.saved, []);
  assert.deepEqual(w.archived, []);
});

test('the same name twice in one drop saves once; the second is already loaded', async () => {
  const w = world({ getSheetDoc: (k) => new Promise(r => setTimeout(() => r(null), 20)) });
  const res = await UploadBatch.run([file('NL Sheet 3.html'), file('NL Sheet 3.html')], w.deps);
  assert.equal(w.saved.length, 1);
  assert.deepEqual(res.alreadyLoaded, ['NL Sheet 3.html']);
});

test('a second drop while the first is still checking sees the claim', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const w = world({ getSheetDoc: async () => { await gate; return null; } });
  const first = UploadBatch.run([file('NL Sheet 4.html')], w.deps);
  await settle();
  const second = await UploadBatch.run([file('NL Sheet 4.html')], w.deps);
  release();
  await first;
  assert.deepEqual(second.alreadyLoaded, ['NL Sheet 4.html']);
  assert.equal(w.saved.length, 1);
});

test('finished in the database: refused, never overwritten', async () => {
  const k = Keys.sheet('NL Sheet 5.html');
  const doc = { finished: true, finishedAt: 1000, jobName: 'Old Job' };
  const w = world({ docs: { [k]: doc } });
  const res = await UploadBatch.run([file('NL Sheet 5.html')], w.deps);
  assert.deepEqual(res.finishedBefore, [{ name: 'NL Sheet 5.html', doc }]);
  assert.deepEqual(w.saved, []);
  assert.equal(UploadBatch.notice(res, () => 'Oct 1'), '"NL Sheet 5.html" was already cut and finished on Oct 1 (job Old Job). If this is a new cut, save it from Aspire under a new file name.');
});

test('in the database unfinished but not on this board yet: already loaded, never overwritten', async () => {
  const k = Keys.sheet('NL Sheet 6.html');
  const w = world({ docs: { [k]: { finished: false, archiveUrl: 'https://drive/old' } } });
  const res = await UploadBatch.run([file('NL Sheet 6.html')], w.deps);
  assert.deepEqual(res.alreadyLoaded, ['NL Sheet 6.html']);
  assert.deepEqual(w.saved, []);
  assert.deepEqual(w.archived, []);
  assert.equal(UploadBatch.notice(res, String), '"NL Sheet 6.html" is already loaded — it\'s on the board, so nothing was changed.');
});

test('the database read fails: blocked as could-not-check, not saved', async () => {
  const w = world({ getSheetDoc: async () => { throw new Error('offline'); } });
  const warn = console.warn; console.warn = () => {};
  let res;
  try { res = await UploadBatch.run([file('NL Sheet 7.html')], w.deps); } finally { console.warn = warn; }
  assert.deepEqual(res.unchecked, ['NL Sheet 7.html']);
  assert.deepEqual(w.saved, []);
  assert.equal(UploadBatch.notice(res, String), 'Couldn\'t check whether "NL Sheet 7.html" was already cut — check your connection and drop it again.');
});

test('an unreadable file is reported and the rest of the drop still finishes', async () => {
  const w = world();
  const warn = console.warn; console.warn = () => {};
  let res;
  try { res = await UploadBatch.run([unreadable('NL Sheet 8.html'), file('NL Sheet 9.html')], w.deps); } finally { console.warn = warn; }
  assert.deepEqual(res.unreadable, ['NL Sheet 8.html']);
  assert.deepEqual(w.saved, [Keys.sheet('NL Sheet 9.html')]);
  assert.equal(UploadBatch.notice(res, String), 'Couldn\'t read "NL Sheet 8.html" — drop it again.');
});

test('a file that is not an Aspire setup sheet is refused before any database read', async () => {
  let reads = 0;
  const w = world({ parse: () => ({ ...EMPTY }), getSheetDoc: async () => { reads++; return null; } });
  const res = await UploadBatch.run([file('saved-web-page.html')], w.deps);
  assert.deepEqual(res.notSheets, ['saved-web-page.html']);
  assert.equal(reads, 0);
  assert.deepEqual(w.saved, []);
  assert.equal(UploadBatch.notice(res, String), '"saved-web-page.html" isn\'t an Aspire setup sheet, so it wasn\'t added.');
});

test('isAspireSheet: any one of job title, toolpaths, material setup or drawing is enough', () => {
  assert.equal(UploadBatch.isAspireSheet(EMPTY), false);
  assert.equal(UploadBatch.isAspireSheet({ ...EMPTY, jobName: 'J' }), true);
  assert.equal(UploadBatch.isAspireSheet({ ...EMPTY, toolpaths: [{}] }), true);
  assert.equal(UploadBatch.isAspireSheet({ ...EMPTY, materialInfo: [{}] }), true);
  assert.equal(UploadBatch.isAspireSheet({ ...EMPTY, layoutSvg: '<svg/>' }), true);
});

test('save fails: taken off the board, reported with its message, still archived', async () => {
  const w = world({ saveSheet: async () => ({ ok: false, mode: 'plain', error: new Error('quota exceeded') }) });
  const res = await UploadBatch.run([file('NL Sheet 10.html')], w.deps);
  assert.deepEqual(res.saveFailed, [{ name: 'NL Sheet 10.html', message: 'quota exceeded' }]);
  assert.equal(w.board.has(Keys.sheet('NL Sheet 10.html')), false);
  assert.equal(res.savedByJob.size, 0);
  assert.equal(w.archived.length, 1);
});

test('oversize drawing: saved, and the mode is reported for the banner', async () => {
  const w = world({ saveSheet: async () => ({ ok: true, mode: 'oversize' }) });
  const res = await UploadBatch.run([file('NL Sheet 11.html')], w.deps);
  assert.equal(res.saved[0].mode, 'oversize');
});

test('the combined notice keeps today\'s order and the many-sheets wording', async () => {
  const res = { saved: [], alreadyLoaded: ['a.html', 'b.html'], finishedBefore: [{ name: 'c.html', doc: {} }], unchecked: ['d.html'], unreadable: ['e.html'], notSheets: ['f.html'], saveFailed: [], savedByJob: new Map() };
  assert.equal(UploadBatch.notice(res, String), [
    '2 sheets were already loaded, so they were left unchanged.',
    '"c.html" was already cut and finished on an earlier export (job unknown). If this is a new cut, save it from Aspire under a new file name.',
    'Couldn\'t check whether "d.html" was already cut — check your connection and drop it again.',
    'Couldn\'t read "e.html" — drop it again.',
    '"f.html" isn\'t an Aspire setup sheet, so it wasn\'t added.',
  ].join('\n\n'));
});
