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
