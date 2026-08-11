import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/sticker-map.generated.js'),
  'utf8'
);

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.STICKER_MAP = STICKER_MAP;', ctx);
  return ctx.STICKER_MAP;
}

test('every van sticker id exists in the sticker text table', () => {
  const map = load();
  assert.ok(Object.keys(map.vanStickers).length > 0, 'no vans in map');
  for (const [van, items] of Object.entries(map.vanStickers)) {
    for (const [id, qty] of items) {
      assert.ok(map.stickers[id], `van ${van}: unknown sticker id ${id}`);
      assert.ok(Number.isInteger(qty) && qty > 0, `van ${van}: bad qty for ${id}`);
    }
  }
});
