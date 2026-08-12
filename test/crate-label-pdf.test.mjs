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
  vm.runInContext(read('js/vendor/qrcode-generator.js'), ctx);
  vm.runInContext(read('js/sticker-pdf.js') + '\nthis.StickerPdf = StickerPdf;', ctx);
  vm.runInContext(read('js/crate-label-pdf.js') + '\nthis.CrateLabelPdf = CrateLabelPdf;', ctx);
  return ctx.CrateLabelPdf;
}

const ORDER = {
  orderNum: '#1234',
  vanName: '21: Mercedes Sprinter 144" (2018-Present)',
  assembly: '3806',
  customer: 'Sample Customer',
  datePacked: '08/12/2026',
};

test('qrText matches the Python payload format, minus the Status line', () => {
  const c = load();
  assert.equal(c.qrText(ORDER),
    '--- VanLab Kit Info ---\n' +
    'Order:    #1234\n' +
    'Van:      21: Mercedes Sprinter 144" (2018-Present)\n' +
    'Assembly: 3806\n' +
    'Customer: Sample Customer\n' +
    'Packed:   08/12/2026\n' +
    '-----------------------');
});

test('qrText: blank assembly becomes N/A, blank customer stays blank', () => {
  const c = load();
  const t = c.qrText({ ...ORDER, assembly: '', customer: '' });
  assert.ok(t.includes('Assembly: N/A\n'));
  assert.ok(t.includes('Customer: \n'));
});

test('buildCrateLabelPdf renders one 4x6 page', async () => {
  const c = load();
  const bytes = await c.buildCrateLabelPdf(ORDER, null);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.equal(text.slice(0, 5), '%PDF-');
  assert.equal(text.match(/\/Type\s*\/Page[^s]/g).length, 1);
  // 4in x 6in at 72pt/in
  assert.ok(/MediaBox\s*\[\s*0\s+0\s+288\s+432\s*\]/.test(text), 'wrong page size');
});

test('real logo bytes embed without error', async () => {
  const c = load();
  const ctx2 = { console };
  ctx2.self = ctx2; ctx2.window = ctx2; ctx2.globalThis = ctx2;
  vm.createContext(ctx2);
  vm.runInContext(read('js/vanlab-logo.generated.js') + '\nthis.VanlabLogo = VanlabLogo;', ctx2);
  const logoBytes = new Uint8Array(Buffer.from(ctx2.VanlabLogo.pngBase64, 'base64'));
  const bytes = await c.buildCrateLabelPdf(ORDER, logoBytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('garbage logo bytes fall back to the placeholder instead of throwing', async () => {
  const c = load();
  const bytes = await c.buildCrateLabelPdf(ORDER, new Uint8Array([1, 2, 3, 4]));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});
