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
