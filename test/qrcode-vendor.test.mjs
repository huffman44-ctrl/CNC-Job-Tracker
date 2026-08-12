import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = { console };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vendor/qrcode-generator.js'), ctx);
  return ctx.qrcode;
}

test('vendored qrcode-generator produces a QR matrix', () => {
  const qrcode = load();
  const qr = qrcode(0, 'M');
  qr.addData('--- VanLab Kit Info ---\nOrder:    #1234');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(n >= 21, 'module count at least version-1 size, got ' + n);
  // Top-left finder pattern corner is always dark.
  assert.equal(qr.isDark(0, 0), true);
  // Finder pattern ring: (0,7) just outside the 7x7 finder is always light.
  assert.equal(qr.isDark(0, 7), false);
});
