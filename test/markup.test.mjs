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

const SHAPE = { x: 2, y: 3, w: 4, h: 5 }; // corners: nw(2,3) ne(6,3) sw(2,8) se(6,8)

test('resizeAnchor: dragging the nw handle anchors at the opposite (se) corner', () => {
  assert.deepEqual(Markup.resizeAnchor(SHAPE, 'nw'), { x: 6, y: 8 });
});

test('resizeAnchor: dragging the ne handle anchors at the opposite (sw) corner', () => {
  assert.deepEqual(Markup.resizeAnchor(SHAPE, 'ne'), { x: 2, y: 8 });
});

test('resizeAnchor: dragging the sw handle anchors at the opposite (ne) corner', () => {
  assert.deepEqual(Markup.resizeAnchor(SHAPE, 'sw'), { x: 6, y: 3 });
});

test('resizeAnchor: dragging the se handle anchors at the opposite (nw) corner', () => {
  assert.deepEqual(Markup.resizeAnchor(SHAPE, 'se'), { x: 2, y: 3 });
});
