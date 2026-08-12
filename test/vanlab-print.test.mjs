import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/vanlab-print.js'), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.VanlabPrint = VanlabPrint;', ctx);
  return ctx.VanlabPrint;
}

// Values created inside the .js source belong to the vm sandbox's V8 realm,
// so their Object/Array.prototype differs from this file's even when the data
// is identical. assert.deepEqual (strict) treats that as a mismatch, so
// round-trip through JSON to compare plain data instead of realm identity.
function plain(v) { return JSON.parse(JSON.stringify(v)); }

// Real filename shapes from live VanLab jobs (customer-free by design).
const LOWER = '260611_ford_e350_swb_Pass_3806_order1199_Summary_Sheet 5.html';
const UPPER = '260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html';

test('finds lowercase order1199 despite date and model numbers in the name', () => {
  assert.deepEqual(plain(load().extractOrderNumber([LOWER])), { orderNum: '1199', conflict: null });
});

test('finds underscore Order_1195 variant', () => {
  assert.deepEqual(plain(load().extractOrderNumber([UPPER])), { orderNum: '1195', conflict: null });
});

test('same order across many sheets is not a conflict', () => {
  const names = [LOWER, LOWER.replace('Sheet 5', 'Sheet 6'), LOWER.replace('Sheet 5', 'Sheet 12')];
  assert.deepEqual(plain(load().extractOrderNumber(names)), { orderNum: '1199', conflict: null });
});

test('disagreeing sheets flag a conflict instead of guessing', () => {
  const r = load().extractOrderNumber([LOWER, UPPER]);
  assert.equal(r.orderNum, null);
  assert.deepEqual(plain(r.conflict), ['1199', '1195']);
});

test('no pattern -> null, no conflict (manual mode)', () => {
  assert.deepEqual(plain(load().extractOrderNumber(['Sheet3.html', 'Job Layout 0.25_MDF 6.html'])),
    { orderNum: null, conflict: null });
  assert.deepEqual(plain(load().extractOrderNumber([])), { orderNum: null, conflict: null });
});

test('resolveStickers matches a mapped van and copies the list', () => {
  const map = { stickers: { a: 'A' }, vanStickers: { '39': [['a', 2]] } };
  const r = load().resolveStickers('39', map);
  assert.equal(r.status, 'matched');
  assert.deepEqual(plain(r.items), [['a', 2]]);
  r.items.push(['tamper', 1]);
  assert.equal(map.vanStickers['39'].length, 1, 'must not alias the map');
});

test('unmapped or null van is unknown with a reason', () => {
  const map = { stickers: {}, vanStickers: {} };
  assert.equal(load().resolveStickers('99', map).status, 'unknown');
  assert.match(load().resolveStickers('99', map).reason, /van/);
  assert.equal(load().resolveStickers(null, map).status, 'unknown');
});
