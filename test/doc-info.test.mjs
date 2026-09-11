import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Same sandbox recipe as test/sticker-pdf.test.mjs: pdf-lib defines the
// PDFLib global, then doc-info.js reads it.
function load() {
  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vendor/pdf-lib.min.js'), ctx);
  vm.runInContext(read('js/doc-info.js') + '\nthis.DocInfo = DocInfo;', ctx);
  return ctx;
}

async function makePdf(ctx, pageCount, w, h) {
  const doc = await ctx.PDFLib.PDFDocument.create();
  // pdf-lib's addPage type-checks its dimensions arg against the vm
  // context's own Array constructor (identity, not Array.isArray), so the
  // array literal has to be built inside that same realm or the check fails
  // cross-realm with a confusing "type NaN" TypeError. Same fix as
  // test/packing-pdf.test.mjs's makeTemplate.
  const size = vm.runInContext(`[${w}, ${h}]`, ctx);
  for (let i = 0; i < pageCount; i++) doc.addPage(size);
  return doc.save({ useObjectStreams: false });
}

test('sizeFor: 4x6 either way round, within 3pt', () => {
  const { DocInfo } = load();
  assert.equal(DocInfo.sizeFor(288, 432), '4x6');
  assert.equal(DocInfo.sizeFor(432, 288), '4x6');
  assert.equal(DocInfo.sizeFor(290.5, 429), '4x6');
  assert.equal(DocInfo.sizeFor(292, 432), null, '4pt off is not 4x6');
});

test('sizeFor: letter either way round; A4 and odd sizes are null', () => {
  const { DocInfo } = load();
  assert.equal(DocInfo.sizeFor(612, 792), 'letter');
  assert.equal(DocInfo.sizeFor(792, 612), 'letter');
  assert.equal(DocInfo.sizeFor(595.28, 841.89), null, 'A4');
  assert.equal(DocInfo.sizeFor(216, 72), null, '3x1 is a sticker, not a document size');
  assert.equal(DocInfo.TOLERANCE, 3);
});

test('isPdf checks the %PDF- header, not the name', () => {
  const { DocInfo } = load();
  assert.equal(DocInfo.isPdf(new TextEncoder().encode('%PDF-1.7 junk')), true);
  assert.equal(DocInfo.isPdf(new TextEncoder().encode('<html>')), false);
  assert.equal(DocInfo.isPdf(new Uint8Array(0)), false);
  assert.equal(DocInfo.isPdf(null), false);
});

test('inspectPdf reports page count and first-page size', async () => {
  const ctx = load();
  const bytes = await makePdf(ctx, 3, 288, 432);
  const info = await ctx.DocInfo.inspectPdf(bytes);
  assert.equal(info.pages, 3);
  assert.equal(Math.round(info.width), 288);
  assert.equal(Math.round(info.height), 432);
});

test('inspectPdf rejects bytes pdf-lib cannot open', async () => {
  const ctx = load();
  await assert.rejects(() => ctx.DocInfo.inspectPdf(new TextEncoder().encode('%PDF-1.4 but not really')));
});

test('title pluralises pages', () => {
  const { DocInfo } = load();
  assert.equal(DocInfo.title('cut-list.pdf', '4x6', 8), 'cut-list.pdf · 4x6 · 8 pages');
  assert.equal(DocInfo.title('label.pdf', 'letter', 1), 'label.pdf · letter · 1 page');
});
