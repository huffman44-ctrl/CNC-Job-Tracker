import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

test('getAnnotations returns an empty array when nothing is stored', () => {
  assert.deepEqual(Storage.getAnnotations('sheet_none'), []);
});

test('setAnnotations/getAnnotations round-trip through the cache', async () => {
  const shapes = [{ type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red' }];
  await Storage.setAnnotations('sheet_a', shapes);
  assert.deepEqual(Storage.getAnnotations('sheet_a'), shapes);
});

test('setAnnotations with an empty array clears the cache entry', async () => {
  await Storage.setAnnotations('sheet_b', [{ type: 'ellipse', x: 0, y: 0, w: 1, h: 1, color: 'gold' }]);
  await Storage.setAnnotations('sheet_b', []);
  assert.deepEqual(Storage.getAnnotations('sheet_b'), []);
});
