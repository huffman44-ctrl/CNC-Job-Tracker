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
  vm.runInContext(read('js/assembly-levels.js'), ctx);
  vm.runInContext(read('js/packing-pdf.js')
    + '\nthis.PackingPdf = PackingPdf; this.PDFLibRef = PDFLib;', ctx);
  return ctx;
}

async function makeTemplate(ctx, pages) {
  const doc = await ctx.PDFLibRef.PDFDocument.create();
  // pdf-lib's addPage type-checks its dimensions arg against the vm
  // context's own Array constructor (identity, not Array.isArray), so the
  // array literal has to be built inside that same realm or the check
  // fails cross-realm with a confusing "type NaN" TypeError.
  const letterSize = vm.runInContext('[612, 792]', ctx);
  for (let i = 0; i < pages; i++) doc.addPage(letterSize);
  return doc.save({ useObjectStreams: false });
}

const ORDER = { orderNum: '1204', customer: 'Jane Sample', assembly: '21-08' };

test('stampText joins order, customer, assembly with pipes', () => {
  assert.equal(load().PackingPdf.stampText(ORDER),
    '1204  |  Jane Sample  |  Assembly 21-08');
});

test('stampText drops missing parts instead of printing blanks', () => {
  assert.equal(load().PackingPdf.stampText({ orderNum: '1204', customer: '', assembly: '' }),
    '1204');
});

test('optionsText decodes a known level', () => {
  assert.equal(load().PackingPdf.optionsText(ORDER),
    'Panelling: YES    Sink: no    Hex Flooring: no    Wiring: YES');
});

test('optionsText warns when the assembly cannot be decoded', () => {
  assert.equal(load().PackingPdf.optionsText({ orderNum: '1204', customer: 'x', assembly: '3806' }),
    '! Options not specified - check the order sheet');
});

test('stampPdf keeps every page and returns a real PDF', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 3);
  const out = await ctx.PackingPdf.stampPdf(template, ORDER);
  assert.equal(new TextDecoder().decode(out.slice(0, 5)), '%PDF-');
  // 3 pages in -> 3 pages out (band is an overlay, not a new page)
  assert.equal(new TextDecoder().decode(out).match(/\/Type\s*\/Page[^s]/g).length, 3);
  // The stamped file must be bigger: band rectangle + two text runs + fonts.
  assert.ok(out.length > template.length);
});

test('stampPdf tolerates an order with only a number (manual fallback path)', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 1);
  const out = await ctx.PackingPdf.stampPdf(template, { orderNum: '', customer: '', assembly: '' });
  assert.equal(new TextDecoder().decode(out.slice(0, 5)), '%PDF-');
});

// ── QR codes for the manuals (2026-11-18) ──

const KIT = { kind: 'kit', caption: 'Scan for your install instructions', url: 'https://wearevanlab.com/instructions/sprinter-144' };
const WIRING = { kind: 'wiring', caption: 'Scan for the wiring manual', url: 'https://wearevanlab.com/instructions/wiring' };

async function makeSized(ctx, w, h) {
  const doc = await ctx.PDFLibRef.PDFDocument.create();
  doc.addPage(vm.runInContext(`[${w}, ${h}]`, ctx));
  return doc.save({ useObjectStreams: false });
}

test('qrLayout keeps every QR and caption on the page, without overlaps (landscape + SUV portrait)', () => {
  const { PackingPdf } = load();
  for (const [w, h] of [[842, 595], [612, 792]]) {
    for (const n of [1, 2]) {
      const boxes = JSON.parse(JSON.stringify(PackingPdf.qrLayout(w, h, n)));
      assert.equal(boxes.length, n);
      for (const b of boxes) {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.size <= w && b.y + b.size <= h, `QR off page ${w}x${h}`);
        assert.ok(b.size >= 60, 'QR too small to scan reliably off paper');
      }
      if (n === 2) {
        const [a, c] = boxes;
        const apart = a.x + a.size <= c.x || c.x + c.size <= a.x || a.y + a.size <= c.y || c.y + c.size <= a.y;
        assert.ok(apart, 'QRs overlap');
      }
    }
  }
});

test('qrLayout stays in the free corner (bottom-right; below the parts table on landscape)', () => {
  const { PackingPdf } = load();
  for (const b of JSON.parse(JSON.stringify(PackingPdf.qrLayout(842, 595, 2)))) {
    assert.ok(b.y + b.size <= 105, 'landscape QR rises into the parts table');
    assert.ok(b.x >= 480, 'landscape QR runs into the Signed line');
  }
  for (const b of JSON.parse(JSON.stringify(PackingPdf.qrLayout(612, 792, 2)))) {
    assert.ok(b.x >= 460, 'portrait QR runs into the SUV table');
    assert.ok(b.y + b.size <= 525, 'portrait QR runs into the logo');
    assert.ok(b.y >= 120, 'portrait QR sits on the Packed and Signed area');
  }
});

test('stampPdf with links adds the QRs and still keeps every page', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 2);
  const plainOut = await ctx.PackingPdf.stampPdf(template, ORDER);
  const withQr = await ctx.PackingPdf.stampPdf(template, ORDER, [KIT, WIRING]);
  assert.equal(new TextDecoder().decode(withQr).match(/\/Type\s*\/Page[^s]/g).length, 2);
  assert.ok(withQr.length > plainOut.length + 1000, 'QR modules should add real content');
});

test('stampPdf with no links prints exactly what it did before', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 1);
  const a = await ctx.PackingPdf.stampPdf(template, ORDER);
  const b = await ctx.PackingPdf.stampPdf(template, ORDER, []);
  assert.equal(a.length, b.length);
});

test('stampPdf handles the portrait SUV template size', async () => {
  const ctx = load();
  const out = await ctx.PackingPdf.stampPdf(await makeSized(ctx, 612, 792), ORDER, [KIT, WIRING]);
  assert.equal(new TextDecoder().decode(out.slice(0, 5)), '%PDF-');
});
