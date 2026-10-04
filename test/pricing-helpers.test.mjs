import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Pricing = require('../js/pricing.js');

const sheet = (fileKey, totalTime, names, extra = {}) =>
  ({ fileKey, totalTime, toolpaths: names.map(name => ({ name })), ...extra });

test('parseTimeSec reads HH:MM:SS, MM:SS and blanks', () => {
  assert.equal(Pricing.parseTimeSec('00:15:09'), 909);
  assert.equal(Pricing.parseTimeSec('3:09:00'), 11340);
  assert.equal(Pricing.parseTimeSec('12:30'), 750);
  assert.equal(Pricing.parseTimeSec(''), 0);
  assert.equal(Pricing.parseTimeSec('n/a'), 0);
});

test('formatDuration', () => {
  assert.equal(Pricing.formatDuration(11340), '3 h 09 m');
  assert.equal(Pricing.formatDuration(720), '12 m');
  assert.equal(Pricing.formatDuration(0), '0 m');
});

test('sheetHasVbit matches the log rule, case-insensitively', () => {
  assert.equal(Pricing.sheetHasVbit(sheet('a', '', ['Profile', 'V-Carve Letters'])), true);
  assert.equal(Pricing.sheetHasVbit(sheet('b', '', ['v groove'])), true);
  assert.equal(Pricing.sheetHasVbit(sheet('c', '', ['Pocket', 'Drill'])), false);
  assert.equal(Pricing.sheetHasVbit({}), false);
});

test('signature: same time + count + vbit is the same design; a V-bit sheet of equal time is NOT', () => {
  const a = sheet('a', '00:15:09', ['Profile', 'Pocket']);
  const b = sheet('b', '00:15:09', ['Pocket', 'Profile']);
  const v = sheet('v', '00:15:09', ['Profile', 'V-Carve']);
  assert.equal(Pricing.signature(a), '909|2|-');
  assert.equal(Pricing.signature(a), Pricing.signature(b));
  assert.notEqual(Pricing.signature(a), Pricing.signature(v));
});

test('repeatGroups: first of a design is null, repeats point at its 1-based position', () => {
  const s1 = sheet('k1', '00:15:09', ['P', 'Q']);
  const s2 = sheet('k2', '00:12:00', ['P']);
  const s3 = sheet('k3', '00:15:09', ['P', 'Q']);
  const s4 = sheet('k4', '00:15:09', ['P', 'Q']);
  const g = Pricing.repeatGroups([s1, s2, s3, s4]);
  assert.equal(g.k1.repeatOf, null);
  assert.equal(g.k2.repeatOf, null);
  assert.equal(g.k3.repeatOf, 1);
  assert.equal(g.k4.repeatOf, 1);
  assert.equal(Pricing.repeatCount([s1, s2, s3, s4]), 2);
  assert.equal(Pricing.repeatCount([s1, s2]), 0);
});

test('localDate uses the local calendar day, not the UTC one', () => {
  // 23:30 local on Oct 3 — whatever the zone, the local day must come back.
  const d = new Date(2026, 9, 3, 23, 30);
  assert.equal(Pricing.localDate(d.toISOString()), '2026-10-03');
  assert.equal(Pricing.localDate(null), null);
  assert.equal(Pricing.localDate('garbage'), null);
});

test('isWeekendDate: Sat Oct 3 and Sun Oct 4 2026 are weekend, Mon Oct 5 is not', () => {
  assert.equal(Pricing.isWeekendDate('2026-10-03'), true);
  assert.equal(Pricing.isWeekendDate('2026-10-04'), true);
  assert.equal(Pricing.isWeekendDate('2026-10-05'), false);
  assert.equal(Pricing.isWeekendDate(''), false);
});

test('effectiveCutDate: owner override wins; not-cut sheets have none', () => {
  const done = { status: 'complete', completedAt: new Date(2026, 9, 3, 9, 12).toISOString() };
  assert.equal(Pricing.effectiveCutDate(done, null), '2026-10-03');
  assert.equal(Pricing.effectiveCutDate(done, { cutDateOverride: '2026-10-02' }), '2026-10-02');
  assert.equal(Pricing.effectiveCutDate({ status: 'in-progress' }, null), null);
  assert.equal(Pricing.effectiveCutDate(null, null), null);
});
