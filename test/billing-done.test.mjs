import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BD = require('../js/billing-done.js');

const sheetsInv = (o = {}) => ({ number: 3612, customerName: 'Ridgeway Vans', total: 1865, sheetKeys: Array.from({ length: 14 }, (_, i) => 'k' + i), laborLineRefs: [], logWritten: true, ...o });
const laborInv = (n, o = {}) => ({ number: 3612, customerName: 'Ridgeway Vans', total: 120, sheetKeys: [], laborLineRefs: Array.from({ length: n }, (_, i) => ({ jobKey: 'j', lineId: 'l' + i })), ...o });

test('headline: sheets, singular sheet, labor-only lines', () => {
  assert.equal(BD.headline(sheetsInv()), '14 sheets billed on invoice #3612');
  assert.equal(BD.headline(sheetsInv({ sheetKeys: ['a'] })), '1 sheet billed on invoice #3612');
  assert.equal(BD.headline(laborInv(1)), '1 design line billed on invoice #3612');
  assert.equal(BD.headline(laborInv(2)), '2 design lines billed on invoice #3612');
});

test('logLine: written, failed, none for labor-only', () => {
  assert.equal(BD.logLine(sheetsInv()), 'The Master Job Log now has #3612 on all 14 rows.');
  assert.equal(BD.logLine(sheetsInv({ logWritten: false, logError: 'timeout' })), 'The log could not be updated (timeout) — retry from Billing.');
  assert.equal(BD.logLine(laborInv(1, { logWritten: true })), null);
  assert.equal(BD.logLine(laborInv(1, { logWritten: false, logError: 'x' })), null);
});

test('wontShowLine and PO line wording', () => {
  assert.equal(BD.wontShowLine(sheetsInv()), "Those sheets won't show up in billing again.");
  assert.match(BD.POLINE, /^Add the PO number any time from Billing › Recent invoices/);
});

test('recentRow: plain imported invoice', () => {
  const r = BD.recentRow(sheetsInv({ importedAt: new Date(2026, 9, 5, 12).getTime(), poNumber: 'PO-1' }), n => '$' + n);
  assert.deepEqual(r, { number: 3612, customer: 'Ridgeway Vans', imported: 'Oct 5', total: '$1865', po: 'PO-1', logFailed: false, logNote: '', laborOnly: false });
});

test('recentRow: failed log shows the reason; missing fields do not throw', () => {
  const r = BD.recentRow(sheetsInv({ logWritten: false, logError: 'offline' }), String);
  assert.equal(r.logFailed, true);
  assert.equal(r.logNote, 'Log not updated: offline');
  const e = BD.recentRow({ number: 1 }, String);
  assert.equal(e.po, ''); assert.equal(e.total, ''); assert.equal(e.imported, '');
});
