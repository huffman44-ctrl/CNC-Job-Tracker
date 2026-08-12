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
  vm.runInContext(read('js/vanlab-logo.generated.js') + '\nthis.VanlabLogo = VanlabLogo;', ctx);
  return ctx.VanlabLogo;
}

test('generated logo asset decodes to a real PNG', () => {
  const logo = load();
  const bytes = Buffer.from(logo.pngBase64, 'base64');
  // PNG signature: 137 80 78 71 13 10 26 10
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.length > 10000, 'logo suspiciously small: ' + bytes.length + ' bytes');
});
