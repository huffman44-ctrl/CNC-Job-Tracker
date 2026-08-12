import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vendor/pdf-lib.min.js'), ctx);
  vm.runInContext(read('js/vendor/fontkit.umd.min.js'), ctx);
  vm.runInContext(read('js/sticker-pdf.js') + '\nthis.StickerPdf = StickerPdf;', ctx);
  return ctx.StickerPdf;
}

// Fake monospace metric: every character is 0.5*size wide.
const mono = (text, size) => text.length * size * 0.5;

// wrapText's return value is an Array built inside the vm sandbox, so its
// Array.prototype belongs to a different V8 realm than this file's even
// when the contents are identical. assert.deepEqual (strict) treats that as
// a mismatch (see test/logging-endpoint.test.mjs's `plain` helper for the
// same issue), so round-trip through JSON to compare plain data instead of
// realm identity.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('wrapText wraps greedily at the width limit', () => {
  const s = load();
  // width limit 100 at size 10 -> 20 chars per line with the mono metric
  assert.deepEqual(plain(s.wrapText('aaaa bbbb cccc dddd eeee', 100, 10, mono)),
    ['aaaa bbbb cccc dddd', 'eeee']);
});

test('a single over-long word gets its own line, not dropped', () => {
  const s = load();
  const word = 'x'.repeat(60);
  assert.deepEqual(plain(s.wrapText('short ' + word, 100, 10, mono)), ['short', word]);
});

test('fitLines shrinks until the block fits, floor 6', () => {
  const s = load();
  const short = s.fitLines('HI', 196, 52, mono);
  assert.equal(short.size, 22);
  const long = s.fitLines('For double thickness panels (A6, A7, A10, A14, A15, A16, A17, C27, C28)', 196, 52, mono);
  assert.ok(long.size < 22 && long.size >= 6);
  const widest = Math.max(...long.lines.map(l => mono(l, long.size)));
  assert.ok(widest <= 196, 'a line overflows the label');
  assert.ok(long.lines.length * long.size * 1.2 <= 52, 'block taller than label');
});

test('buildStickerPdf renders one page per label and returns a real PDF', async () => {
  const s = load();
  const fontBytes = readFileSync(join(root, 'assets/fonts/Baloo2-SemiBold.ttf'));
  const bytes = await s.buildStickerPdf(
    [['use_where_ply', 2], ['a18', 1]],
    { use_where_ply: 'USE WHERE INDICATED BY PLY', a18: 'A18' },
    fontBytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  // 2 + 1 labels -> exactly 3 pages
  assert.equal(new TextDecoder().decode(bytes).match(/\/Type\s*\/Page[^s]/g).length, 3);
});
