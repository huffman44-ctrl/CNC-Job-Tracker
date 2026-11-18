import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read('js/assembly-levels.js'), ctx);
  vm.runInContext(read('js/packing-map.js'), ctx);
  vm.runInContext(read('js/manual-links.js')
    + '\nthis.ManualLinks = ManualLinks; this.PackingMap = PackingMap;', ctx);
  return ctx;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('kit link only when the assembly has no wiring', () => {
  // level 07 = Panelling only
  assert.deepEqual(plain(load().ManualLinks.linksFor('21', '21-07')), [
    { kind: 'kit', caption: 'Scan for your install instructions',
      url: 'https://wearevanlab.com/instructions/sprinter-144' },
  ]);
});

test('wiring link added when the assembly includes wiring', () => {
  // level 02 = Wiring only
  const links = plain(load().ManualLinks.linksFor('37', '37-02'));
  assert.deepEqual(links.map((l) => l.url), [
    'https://wearevanlab.com/instructions/savana-155',
    'https://wearevanlab.com/instructions/wiring',
  ]);
  assert.equal(links[1].kind, 'wiring');
});

test('no wiring link when the assembly cannot be decoded (never guessed)', () => {
  const links = plain(load().ManualLinks.linksFor('21', ''));
  assert.deepEqual(links.map((l) => l.kind), ['kit']);
});

test('SUV uses the one SUV manual', () => {
  assert.equal(load().ManualLinks.linksFor('SUV01', 'SUV01 Full')[0].url,
    'https://wearevanlab.com/instructions/suv-kit');
});

test('a van with no confirmed manual gets no kit QR, but still gets wiring', () => {
  const links = plain(load().ManualLinks.linksFor('44', '44-02'));
  assert.deepEqual(links.map((l) => l.kind), ['wiring']);
});

test('unknown or missing van gives no links', () => {
  assert.deepEqual(plain(load().ManualLinks.linksFor('99', '99-07')), []);
  assert.deepEqual(plain(load().ManualLinks.linksFor(null, '')), []);
});

test('every van with a packing list except the Native kit has a manual slug', () => {
  const ctx = load();
  const missing = ctx.PackingMap.knownVanKeys()
    .filter((k) => ctx.PackingMap.resolve(k, '', 'full').status === 'matched')
    .filter((k) => !ctx.ManualLinks.linksFor(k, '').some((l) => l.kind === 'kit'));
  assert.deepEqual(plain(missing), ['44']);
});
