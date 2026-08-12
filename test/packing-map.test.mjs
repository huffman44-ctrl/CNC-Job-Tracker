import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/packing-map.js'), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.PackingMap = PackingMap;', ctx);
  return ctx.PackingMap;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('mapped van resolves to its exact template filename', () => {
  assert.deepEqual(plain(load().resolve('13', '', null)), {
    status: 'matched', file: 'Van 13_ NV200 Fitting Kit.pdf', reason: '',
  });
});

test('van 40 is none_needed with a visible reason, not a failure', () => {
  const r = load().resolve('40', '', null);
  assert.equal(r.status, 'none_needed');
  assert.equal(r.file, null);
  assert.match(r.reason, /no packing list required/);
});

test('van 39 stays blocked on the numbering conflict', () => {
  const r = load().resolve('39', '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /numbering conflict/);
  assert.match(r.reason, /verify with VanLab/);
});

test('unmapped van says which van has no mapping', () => {
  const r = load().resolve('99', '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /van 99/);
});

test('null vanKey is missing with a clear reason', () => {
  const r = load().resolve(null, '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /not recognized/);
});

test('SUV with a variant keyword in the assembly field auto-matches', () => {
  assert.equal(load().resolve('SUV01', 'SUV Full Kit', null).file,
    'SUV01  SUV01 Full Kit.pdf');
  assert.equal(load().resolve('SUV01', 'kitchen build', null).file,
    'SUV01  SUV01 kITCHEN Only.pdf');
});

test('keyword match is whole-word: "bedding"/"fully" do not match', () => {
  const r = load().resolve('SUV01', 'bedding fully loaded', null);
  assert.equal(r.status, 'ambiguous');
});

test('keyword precedence is kitchen > bed > full (mirrors the Python tool)', () => {
  assert.equal(load().resolve('SUV01', 'full kitchen', null).file,
    'SUV01  SUV01 kITCHEN Only.pdf');
});

test('SUV with no keyword is ambiguous until the picker answers', () => {
  const r = load().resolve('SUV01', '', null);
  assert.equal(r.status, 'ambiguous');
  assert.match(r.reason, /Full\/Bed\/Kitchen/);
});

test('an explicit picker choice overrides auto-detection', () => {
  assert.equal(load().resolve('SUV01', 'full kit', 'bed').file,
    'SUV01  SUV01 Bed Only.pdf');
});

test('every SUV_VARIANTS value is a .pdf filename', () => {
  const v = load().SUV_VARIANTS;
  assert.deepEqual(Object.keys(plain(v)).sort(), ['bed', 'full', 'kitchen']);
  for (const f of Object.values(plain(v))) assert.match(f, /\.pdf$/);
});
