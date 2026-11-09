// VanlabBar — what the VanLab print bar on the job screen shows: whether it shows by itself, its heading, its buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const VanlabBar = require('../js/vanlab-bar.js');

test('a job whose sheets name one order gets the bar by itself', () => {
  const names = ['260611_transit_148_Order 1210_Sheet01.html', '260611_transit_148_Order 1210_Sheet02.html'];
  assert.deepEqual(VanlabBar.forJob(names), { auto: true, orderNum: '1210', conflict: null });
});

test('a job with no order number does not get the bar by itself', () => {
  assert.deepEqual(VanlabBar.forJob(['Harbor Lane Sheet 1.html']), { auto: false, orderNum: null, conflict: null });
  assert.deepEqual(VanlabBar.forJob([]), { auto: false, orderNum: null, conflict: null });
});

test('sheets that disagree about the order do not get the bar by itself', () => {
  const names = ['x_Order 1210_Sheet01.html', 'x_Order 1211_Sheet02.html'];
  assert.deepEqual(VanlabBar.forJob(names), { auto: false, orderNum: null, conflict: ['1210', '1211'] });
});

test('heading names the order, the van and the kit', () => {
  const order = { orderNum: '1210', vanRaw: '15 Transit 148 Passenger', vanKey: '15', assembly: '15-05', customer: 'Pat Sample' };
  assert.equal(VanlabBar.heading('1210', order), 'VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05');
});

test('heading leaves out what the Order Log does not have, and works before the lookup', () => {
  assert.equal(VanlabBar.heading('1210', null), 'VanLab order 1210');
  assert.equal(VanlabBar.heading('1210', { orderNum: '1210', vanRaw: '', vanKey: '15', assembly: '' }), 'VanLab order 1210 · Van 15');
  assert.equal(VanlabBar.heading('1210', { orderNum: '1210', vanRaw: '', vanKey: '', assembly: '3806' }), 'VanLab order 1210 · kit 3806');
});

test('button titles, with the sticker count on the stickers button', () => {
  assert.equal(VanlabBar.buttonTitle('stickers', { stickerCount: 7 }), 'Hardware stickers (7)');
  assert.equal(VanlabBar.buttonTitle('stickers', {}), 'Hardware stickers');
  assert.equal(VanlabBar.buttonTitle('stickers'), 'Hardware stickers');
  assert.equal(VanlabBar.buttonTitle('packing'), 'Packing list');
  assert.equal(VanlabBar.buttonTitle('crate'), 'Crate label');
});

test('an unknown button is refused', () => {
  assert.throws(() => VanlabBar.buttonTitle('labels'));
});

test('stickerCount adds up the quantities of a resolved sticker list', () => {
  assert.equal(VanlabBar.stickerCount([['a', 2], ['b', 1], ['c', 4]]), 7);
  assert.equal(VanlabBar.stickerCount([]), 0);
  assert.equal(VanlabBar.stickerCount(null), 0);
});

test('stickerCount is right for the real van 15 list (#1210: 7 stickers, 6 kinds)', () => {
  // The generated map is a plain browser global (never hand-edited, so no module.exports): load it in a sandbox.
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../js/sticker-map.generated.js', import.meta.url), 'utf8') + '\nthis.STICKER_MAP = STICKER_MAP;', ctx);
  const STICKER_MAP = ctx.STICKER_MAP;
  const VanlabPrint = require('../js/vanlab-print.js');
  const res = VanlabPrint.resolveStickers('15', STICKER_MAP);
  assert.equal(res.items.length, 6);
  assert.equal(VanlabBar.stickerCount(res.items), 7);
});

// ── Ticket 02: who printed what, and when (vanlabPrinted on the jobs/ doc) ──

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();   // local time, so the test is TZ-safe

test('printedFrom reads the three records off the job doc and drops malformed ones', () => {
  const doc = { jobName: 'x', vanlabPrinted: {
    stickers: { at: 100, by: 'Collin' },
    packing: { at: 'yesterday', by: 'Collin' },   // not a time
    crate: { at: 200 },                           // no name
    labels: { at: 300, by: 'Travis' },            // not one of ours
  } };
  assert.deepEqual(VanlabBar.printedFrom(doc), { stickers: { at: 100, by: 'Collin' }, crate: { at: 200, by: 'Someone' } });
  assert.deepEqual(VanlabBar.printedFrom(null), {});
  assert.deepEqual(VanlabBar.printedFrom({ jobName: 'x' }), {});
  assert.deepEqual(VanlabBar.printedFrom({ vanlabPrinted: { stickers: null, crate: 'yes' } }), {});
});

test('record keeps the name and time; a blank name is Someone', () => {
  assert.deepEqual(VanlabBar.record('Collin', 123), { at: 123, by: 'Collin' });
  assert.deepEqual(VanlabBar.record('  ', 123), { at: 123, by: 'Someone' });
  assert.deepEqual(VanlabBar.record(null, 123), { at: 123, by: 'Someone' });
});

test('a button not printed yet just prints', () => {
  assert.deepEqual(VanlabBar.itemView('crate', null, { now: at(2026, 10, 26, 11, 0) }),
    { title: 'Crate label', done: false, action: 'Print', note: '', canUndo: false });
  assert.equal(VanlabBar.itemView('stickers', null, { stickerCount: 7 }).title, 'Hardware stickers (7)');
});

test('a printed button shows a check, who and when, Reprint and Undo', () => {
  const now = at(2026, 10, 26, 15, 0);
  assert.deepEqual(VanlabBar.itemView('crate', { at: at(2026, 10, 26, 10, 42), by: 'Collin' }, { now }),
    { title: '✓ Crate label', done: true, action: 'Reprint', note: 'Printed by Collin, 10:42 AM', canUndo: true });
  assert.equal(VanlabBar.itemView('stickers', { at: at(2026, 10, 26, 0, 5), by: 'Travis' }, { now, stickerCount: 7 }).title, '✓ Hardware stickers (7)');
  assert.equal(VanlabBar.itemView('stickers', { at: at(2026, 10, 26, 0, 5), by: 'Travis' }, { now }).note, 'Printed by Travis, 12:05 AM');
  assert.equal(VanlabBar.itemView('packing', { at: at(2026, 10, 26, 12, 30), by: 'Collin' }, { now }).note, 'Printed by Collin, 12:30 PM');
});

test('a print from another day also shows the date', () => {
  const now = at(2026, 10, 26, 9, 0);
  assert.equal(VanlabBar.itemView('packing', { at: at(2026, 10, 24, 14, 5), by: 'Collin' }, { now }).note, 'Printed by Collin, 10/24 2:05 PM');
  assert.equal(VanlabBar.itemView('packing', { at: at(2025, 10, 26, 14, 5), by: 'Collin' }, { now }).note, 'Printed by Collin, 10/26/2025 2:05 PM');
});

test('an unknown item is refused', () => {
  assert.throws(() => VanlabBar.itemView('labels', null, {}));
});

// ── Ticket 03: collapse the bar once the kit is printed ──

test('a van with no packing list counts the packing list as done, with nothing to undo', () => {
  assert.deepEqual(VanlabBar.itemView('packing', null, { packingNone: true }),
    { title: '✓ Packing list', done: true, action: null, note: 'None needed for this van', canUndo: false });
  // An old record on such a van is ignored — there is nothing to undo.
  assert.equal(VanlabBar.itemView('packing', { at: 1, by: 'Collin' }, { packingNone: true }).canUndo, false);
});

test('barState: collapsed only when all three are done and the bar was not expanded', () => {
  const r = { at: 1, by: 'Collin' };
  assert.deepEqual(VanlabBar.barState({ stickers: r, crate: r }, {}), { allDone: false, collapsed: false });
  assert.deepEqual(VanlabBar.barState({ stickers: r, packing: r, crate: r }, {}), { allDone: true, collapsed: true });
  assert.deepEqual(VanlabBar.barState({ stickers: r, packing: r, crate: r }, { expanded: true }), { allDone: true, collapsed: false });
  assert.deepEqual(VanlabBar.barState({ stickers: r, crate: r }, { packingNone: true }), { allDone: true, collapsed: true });
  assert.deepEqual(VanlabBar.barState({}, { packingNone: true }), { allDone: false, collapsed: false });
});

// ── Lookup wording (sticker-feed ticket 04) ──
const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

test('sourceNote names the source used; an old script (no source) adds nothing', () => {
  assert.equal(VanlabBar.sourceNote({ source: 'feed' }), 'from the CRM feed');
  assert.equal(VanlabBar.sourceNote({ source: 'orderLog' }), 'from the Order Log');
  assert.equal(VanlabBar.sourceNote({}), '');
  assert.equal(VanlabBar.sourceNote(null), '');
});

test('customerLine is the customer, else a plain fallback', () => {
  assert.equal(VanlabBar.customerLine({ customer: 'Pat Sample' }), 'Pat Sample');
  assert.equal(VanlabBar.customerLine({ customer: '  ' }), 'No customer on this order');
  assert.equal(VanlabBar.customerLine({}), 'No customer on this order');
});

test('ageWords says how old in plain words', () => {
  assert.equal(VanlabBar.ageWords(ago(20 * 1000), NOW), 'less than a minute');
  assert.equal(VanlabBar.ageWords(ago(1 * MIN), NOW), '1 minute');
  assert.equal(VanlabBar.ageWords(ago(45 * MIN), NOW), '45 minutes');
  assert.equal(VanlabBar.ageWords(ago(1 * HOUR), NOW), '1 hour');
  assert.equal(VanlabBar.ageWords(ago(5 * HOUR + 10 * MIN), NOW), '5 hours');
  assert.equal(VanlabBar.ageWords(ago(1 * DAY), NOW), '1 day');
  assert.equal(VanlabBar.ageWords(ago(3 * DAY + HOUR), NOW), '3 days');
  assert.equal(VanlabBar.ageWords('', NOW), '');
  assert.equal(VanlabBar.ageWords('not a date', NOW), '');
});

test('staleNote shows only when the feed is stale, whichever source was used', () => {
  assert.equal(VanlabBar.staleNote({ feedStale: false, feedUpdatedAt: ago(DAY) }, NOW), '');
  assert.equal(VanlabBar.staleNote({}, NOW), '');
  assert.equal(VanlabBar.staleNote({ source: 'orderLog', feedStale: true, feedUpdatedAt: ago(3 * DAY) }, NOW),
    'The CRM feed was last updated 3 days ago, so it may be out of date.');
  assert.equal(VanlabBar.staleNote({ source: 'feed', feedStale: true, feedUpdatedAt: ago(2 * HOUR) }, NOW),
    'The CRM feed was last updated 2 hours ago, so it may be out of date.');
  assert.equal(VanlabBar.staleNote({ feedStale: true, feedUpdatedAt: '' }, NOW),
    "The CRM feed's update time is unknown, so it may be out of date.");
  assert.equal(VanlabBar.staleNote({ feedStale: true }, NOW),
    "The CRM feed's update time is unknown, so it may be out of date.");
});

test('checkedNote appears only when orderLogChecked is exactly false', () => {
  assert.match(VanlabBar.checkedNote({ orderLogChecked: false }), /Order Log couldn't be checked.*not double-checked/);
  assert.equal(VanlabBar.checkedNote({ orderLogChecked: true }), '');
  assert.equal(VanlabBar.checkedNote({}), '');
});

test('successStatus joins customer, source and notes and keeps the print ending', () => {
  const s = VanlabBar.successStatus({ customer: 'Pat Sample', source: 'feed', feedStale: true, feedUpdatedAt: ago(2 * HOUR), orderLogChecked: false }, NOW);
  assert.match(s, /^Pat Sample \(from the CRM feed\)/);
  assert.match(s, /2 hours ago/);
  assert.match(s, /couldn't be checked/);
  assert.match(s, /print these now so the kit gets packed while the sheets cut\./);
  assert.equal(VanlabBar.successStatus({ customer: 'Pat Sample' }, NOW),
    'Pat Sample \u2014 print these now so the kit gets packed while the sheets cut.');
  assert.equal(VanlabBar.successStatus({ source: 'orderLog' }, NOW),
    'No customer on this order (from the Order Log) \u2014 print these now so the kit gets packed while the sheets cut.');
});

test('conflictText names both sources and says to pick by hand; blanks read as none', () => {
  const t = VanlabBar.conflictText({
    orderNum: '1195', customer: 'Pat Sample',
    feed: { vanRaw: '15 Transit', vanKey: '15', assembly: '15-05' },
    orderLog: { vanRaw: '40 Sprinter', vanKey: '40', assembly: '' },
  });
  assert.match(t, /1195/);
  assert.match(t, /CRM feed says van 15, kit 15-05/);
  assert.match(t, /Order Log says van 40, kit none/);
  assert.match(t, /check which is right and pick the van type by hand/);
  const blank = VanlabBar.conflictText({ orderNum: '1', feed: {}, orderLog: undefined });
  assert.ok(!/undefined|null/.test(blank));
  assert.match(blank, /CRM feed says van none, kit none/);
});

test('staleNote works on a disagreement object too', () => {
  assert.match(VanlabBar.staleNote({ orderNum: '1', feed: {}, orderLog: {}, feedStale: true, feedUpdatedAt: ago(2 * DAY) }, NOW), /2 days ago/);
  assert.equal(VanlabBar.staleNote({ orderNum: '1', feed: {}, orderLog: {}, feedStale: false }, NOW), '');
});
