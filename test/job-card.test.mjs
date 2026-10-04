import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

let records = {};
let sheetBilling = {};
globalThis.Pricing = Pricing;
globalThis.Storage = { get: (k) => records[k] || null };
globalThis.OwnerStore = { getSheetBilling: (k) => sheetBilling[k] || null };
const JobCard = require('../js/job-card.js');

beforeEach(() => { records = {}; sheetBilling = {}; });

const done = (iso, op = 'Collin') => ({ status: 'complete', completedAt: new Date(iso).getTime(), operator: op });

test('sheetStatus: not cut, cut, in progress invoice, billed', () => {
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Not cut yet');
  records.a = { status: 'in-progress' };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Not cut yet');
  records.a = done('2026-10-02T15:00:00');
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Cut');
  sheetBilling.a = { status: 'in-progress', invoiceNumber: 1042 };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'On invoice 1042 (in progress)');
  sheetBilling.a = { status: 'billed', invoiceNumber: 1042 };
  assert.equal(JobCard.sheetStatus({ fileKey: 'a' }), 'Billed · #1042');
});

test('sheetTags: Weekend from a Saturday cut, repeat, override', () => {
  records.a = done('2026-10-03T12:00:00'); // Saturday
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'a' }, {}), ['Weekend']);
  records.b = done('2026-10-02T12:00:00'); // Friday
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'b' }, { b: { repeatOf: 2 } }), ['Repeat of sheet 2']);
  sheetBilling.b = { status: 'unbilled', cutDateOverride: '2026-10-03' };
  const tags = JobCard.sheetTags({ fileKey: 'b' }, {});
  assert.equal(tags[0], 'Weekend');
  assert.match(tags[1], /^cut date corrected to /);
});

test('sheetTags: re-cut after billing', () => {
  records.a = done('2026-10-06T12:00:00');
  sheetBilling.a = { status: 'billed', invoiceNumber: 7, cutAtBilled: new Date('2026-10-01T12:00:00').getTime() };
  assert.match(JobCard.sheetTags({ fileKey: 'a' }, {})[0], /^Re-cut /);
  delete records.a;
  assert.deepEqual(JobCard.sheetTags({ fileKey: 'a' }, {}), ['Re-cut (record cleared)']);
});

test('validYmd accepts only real local dates', () => {
  assert.equal(JobCard.validYmd('2026-10-03'), true);
  assert.equal(JobCard.validYmd('2026-02-30'), false);
  assert.equal(JobCard.validYmd('2026-13-01'), false);
  assert.equal(JobCard.validYmd('10/03/2026'), false);
  assert.equal(JobCard.validYmd('2026-1-3'), false);
  assert.equal(JobCard.validYmd(''), false);
  assert.equal(JobCard.validYmd(null), false);
});
