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

test('fitScale: picks the height-constrained scale for a tall/narrow sheet', () => {
  // vb 48x96 in a 730x420 container: width allows 15.2x, height only 4.375x
  assert.equal(Markup.fitScale(48, 96, 730, 420), 420 / 96);
});

test('fitScale: picks the width-constrained scale for a wide/short sheet', () => {
  assert.equal(Markup.fitScale(200, 48, 730, 420), 730 / 200);
});

test('centeredView: scale is 1 (fully zoomed out) and the box is centered in the container', () => {
  assert.deepEqual(Markup.centeredView(210, 420, 730, 420), { scale: 1, tx: (730 - 210) / 2, ty: 0 });
});

test('zoomAt: zooming in keeps the cursor point fixed on screen', () => {
  const view = { scale: 1, tx: 10, ty: 20 };
  const next = Markup.zoomAt(view, 100, 100, 2);
  assert.equal(next.scale, 2);
  // canvas-space point under the cursor before zoom: (100-10)/1=90, (100-20)/1=80
  // after zoom it must map back to the same screen point: tx + 90*2 === 100
  assert.equal(next.tx + 90 * next.scale, 100);
  assert.equal(next.ty + 80 * next.scale, 100);
});

test('zoomAt: clamps to MAX_ZOOM (8) instead of zooming past it', () => {
  const next = Markup.zoomAt({ scale: 7, tx: 0, ty: 0 }, 0, 0, 5);
  assert.equal(next.scale, 8);
});

test('zoomAt: clamps to MIN_ZOOM (1) instead of zooming out past the fitted view', () => {
  const next = Markup.zoomAt({ scale: 1, tx: 0, ty: 0 }, 0, 0, 0.5);
  assert.equal(next.scale, 1);
});
