import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SheetThickness = require('../js/sheet-thickness.js');

// A sheet as parseJobSheet returns it: thickness is the Material Block Z value.
const sheet = (name, z) => ({
  fileKey: name, fileName: `${name}.html`,
  materialInfo: z == null ? [] : [{ label: 'Material Block', value: `X: 49"  Y: 97"  Z: ${z}"` }],
});

test('label turns common thicknesses into shop fractions', () => {
  assert.equal(SheetThickness.label(0.75), '3/4 in');
  assert.equal(SheetThickness.label(0.5), '1/2 in');
  assert.equal(SheetThickness.label(0.25), '1/4 in');
  assert.equal(SheetThickness.label(0.375), '3/8 in');
  assert.equal(SheetThickness.label(1), '1 in');
  assert.equal(SheetThickness.label(1.5), '1 1/2 in');
});

test('label keeps the decimal when it is not a sixteenth (metric sheet goods)', () => {
  assert.equal(SheetThickness.label(0.47), '0.47 in');
  assert.equal(SheetThickness.label(null), 'Unknown thickness');
});

test('order puts thickest first and keeps the incoming sheet-number order inside each thickness', () => {
  const sheets = [sheet('S2', 0.75), sheet('S3', 0.5), sheet('S4', 0.75), sheet('S5', 0.25), sheet('S6', 0.5)];
  assert.deepEqual(SheetThickness.order(sheets).map(s => s.fileKey), ['S2', 'S4', 'S3', 'S6', 'S5']);
});

test('order puts sheets with no readable thickness last and does not change the input array', () => {
  const sheets = [sheet('A', null), sheet('B', 0.5), sheet('C', 0.75)];
  assert.deepEqual(SheetThickness.order(sheets).map(s => s.fileKey), ['C', 'B', 'A']);
  assert.deepEqual(sheets.map(s => s.fileKey), ['A', 'B', 'C']);
});

test('summary counts sheets per thickness, thickest first', () => {
  const sheets = [sheet('a', 0.25), sheet('b', 0.75), sheet('c', 0.5), sheet('d', 0.75)];
  assert.equal(SheetThickness.summary(sheets), '3/4 in × 2 · 1/2 in × 1 · 1/4 in × 1');
});

test('summary is empty when no sheet has a readable thickness (old non-Aspire files)', () => {
  assert.equal(SheetThickness.summary([sheet('a', null), sheet('b', null)]), '');
  assert.equal(SheetThickness.summary([]), '');
});

test('summary lists unknown-thickness sheets last when some are known', () => {
  assert.equal(SheetThickness.summary([sheet('a', null), sheet('b', 0.5)]), '1/2 in × 1 · Unknown thickness × 1');
});

test('known() is true only when at least one sheet has a readable thickness', () => {
  assert.equal(SheetThickness.known([sheet('a', null)]), false);
  assert.equal(SheetThickness.known([sheet('a', null), sheet('b', 0.5)]), true);
});
