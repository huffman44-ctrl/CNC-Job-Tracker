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
