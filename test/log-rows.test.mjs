import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LogRows = require('../js/log-rows.js');

const sheet = {
  fileKey: 'fk_1', fileName: 'NL_Bridge_Wall_Panels_Summary_Sheet 2.html', sheetTitle: 'Job Layout Sheet 2',
  jobName: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
  toolpaths: [{ name: 'Profile' }, { name: 'V-Carve Logo' }], archiveUrl: 'https://drive.google.com/uc?export=download&id=X',
};
const when = new Date(2026, 9, 1, 9, 12).toISOString();
const completion = { status: 'complete', completedAt: when, operator: 'Collin', notes: 'tear-out on 2' };

test('COLUMNS is the 14-column header, new ones at the right end', () => {
  assert.deepEqual(LogRows.COLUMNS, ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time',
    'Operator', 'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed']);
});

test('build: a cut sheet, no billing — the same values the CSV shows, keyed by fileKey', () => {
  const row = LogRows.build(sheet, completion, 'Northlight Studios');
  assert.deepEqual(row, {
    key: 'fk_1', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
    toolpathCount: 2, hasVbit: 'Y',
    completedTime: new Date(when).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    operator: 'Collin', notes: 'tear-out on 2',
    archiveLink: 'https://drive.google.com/uc?export=download&id=X', customer: 'Northlight Studios',
  });
  assert.ok(!('invoice' in row) && !('po' in row) && !('billed' in row), 'no billing keys unless carried');
});

test('build: not cut yet — blank time/operator/notes, title falls back to the file name', () => {
  const row = LogRows.build({ fileKey: 'fk_2', fileName: 'Sheet 3.html', toolpaths: [] }, null, '');
  assert.equal(row.sheet, 'Sheet 3.html');
  assert.equal(row.completedTime, '');
  assert.equal(row.operator, '');
  assert.equal(row.notes, '');
  assert.equal(row.hasVbit, 'N');
  assert.equal(row.toolpathCount, 0);
  assert.equal(row.customer, '');
  assert.equal(row.archiveLink, '');
});

test('build: an in-progress record has no completedAt and shows blank, like the CSV', () => {
  const row = LogRows.build(sheet, { status: 'in-progress' }, 'Northlight Studios');
  assert.equal(row.completedTime, '');
});

test('build: billing fields are carried as strings only when given', () => {
  const row = LogRows.build(sheet, completion, 'Northlight Studios', { invoiceNumber: 3612, poNumber: 'PO-77', billed: 'Y' });
  assert.equal(row.invoice, '3612');
  assert.equal(row.po, 'PO-77');
  assert.equal(row.billed, 'Y');
  const partial = LogRows.build(sheet, completion, 'Northlight Studios', { poNumber: 'PO-78' });
  assert.ok(!('invoice' in partial));
  assert.equal(partial.po, 'PO-78');
});

test('formatCompletedTime tolerates garbage', () => {
  assert.equal(LogRows.formatCompletedTime(''), '');
  assert.equal(LogRows.formatCompletedTime('not a date'), '');
});
