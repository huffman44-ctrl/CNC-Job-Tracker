import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/assembly-levels.js'), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.AssemblyLevels = AssemblyLevels;', ctx);
  return ctx.AssemblyLevels;
}

// vm-realm data compared via JSON round-trip (same rationale as vanlab-print.test.mjs).
const plain = (v) => JSON.parse(JSON.stringify(v));

test('decodes 21-08 (Panelling YES, Sink no, Hex no, Wiring YES)', () => {
  assert.deepEqual(plain(load().decode('21-08')), [
    ['Panelling', true], ['Sink', false], ['Hex Flooring', false], ['Wiring', true],
  ]);
});

test('single-digit level is zero-padded: 13-1 means level 01 (all no)', () => {
  assert.deepEqual(plain(load().decode('13-1')), [
    ['Panelling', false], ['Sink', false], ['Hex Flooring', false], ['Wiring', false],
  ]);
});

test('unknown level number decodes to null', () => {
  assert.equal(load().decode('21-99'), null);
});

test('non-matching shapes decode to null: bare model number, garbage, blank, null', () => {
  const a = load();
  assert.equal(a.decode('3806'), null);
  assert.equal(a.decode('garbage'), null);
  assert.equal(a.decode(''), null);
  assert.equal(a.decode(null), null);
});

test('surrounding whitespace is tolerated', () => {
  assert.notEqual(load().decode('  21-08  '), null);
});
