import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Markup = require('../js/markup.js');

test('normalizeDrag handles a drag toward the bottom-right (the simple case)', () => {
  assert.deepEqual(Markup.normalizeDrag(1, 2, 5, 8), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the top-left (both coords decrease)', () => {
  assert.deepEqual(Markup.normalizeDrag(5, 8, 1, 2), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the top-right (x increases, y decreases)', () => {
  assert.deepEqual(Markup.normalizeDrag(1, 8, 5, 2), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag handles a drag toward the bottom-left (x decreases, y increases)', () => {
  assert.deepEqual(Markup.normalizeDrag(5, 2, 1, 8), { x: 1, y: 2, w: 4, h: 6 });
});

test('normalizeDrag returns zero width/height for a click with no movement', () => {
  assert.deepEqual(Markup.normalizeDrag(3, 3, 3, 3), { x: 3, y: 3, w: 0, h: 0 });
});

test('COLORS lists exactly the three supported keys', () => {
  assert.deepEqual(Markup.COLORS, ['red', 'gold', 'green']);
});
