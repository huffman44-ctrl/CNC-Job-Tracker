import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SvgCodec = require('../js/svg-codec.js');

test('rounds long decimals to 3 places and trims trailing zeros', () => {
  const input = '<path d="M 54.50000000 96.12345678 L -0.00000000 1.1"/>';
  const out = SvgCodec.roundSvgPrecision(input);
  assert.equal(out, '<path d="M 54.5 96.123 L 0 1.1"/>');
});

test('leaves integers and command letters untouched', () => {
  const input = '<path d="M 5 10 H 20 Z"/>';
  assert.equal(SvgCodec.roundSvgPrecision(input), '<path d="M 5 10 H 20 Z"/>');
});

test('does not corrupt scientific notation', () => {
  const input = '<path d="M 1.50000000e-7 2.25000000e+3"/>';
  const out = SvgCodec.roundSvgPrecision(input);
  assert.equal(out, '<path d="M 1.5e-7 2.25e+3"/>');
});

test('preserves tag sequence and number count', () => {
  const input = '<svg viewBox="0 0 48 96"><g><path d="M 1.23456789 2.98765432"/></g></svg>';
  const out = SvgCodec.roundSvgPrecision(input);
  const tags = s => (s.match(/<\/?[a-zA-Z]+/g) || []).join(',');
  assert.equal(tags(out), tags(input));
  const nums = s => (s.match(/-?\d+\.?\d*/g) || []).length;
  assert.equal(nums(out), nums(input));
});

test('never emits negative zero', () => {
  assert.equal(SvgCodec.roundSvgPrecision('<path d="M -0.0001 0"/>'), '<path d="M 0 0"/>');
});

test('exposes the exact Firestore field limit', () => {
  assert.equal(SvgCodec.FIRESTORE_FIELD_LIMIT, 1048487);
  assert.equal(SvgCodec.SAFE_FIELD_BYTES, 943638);
});
