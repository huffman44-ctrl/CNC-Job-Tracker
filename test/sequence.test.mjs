import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sequence = require('../js/sequence.js');
const gen = Sequence.generateSequence;

test('numeric range: ED 1..45 gives ED1..ED45, no zero padding', () => {
  const out = gen('ED', '1', '45');
  assert.equal(out.length, 45);
  assert.equal(out[0], 'ED1');
  assert.equal(out[8], 'ED9');
  assert.equal(out[9], 'ED10');
  assert.equal(out[44], 'ED45');
});

test('numeric range: start == end gives one item', () => {
  assert.deepEqual(gen('ED', '7', '7'), ['ED7']);
});

test('empty prefix is allowed', () => {
  assert.deepEqual(gen('', '1', '3'), ['1', '2', '3']);
});

test('alpha range: A..Z gives 26 items with I and O present', () => {
  const out = gen('ED', 'A', 'Z');
  assert.equal(out.length, 26);
  assert.equal(out[0], 'EDA');
  assert.equal(out[25], 'EDZ');
  assert.ok(out.includes('EDI'));
  assert.ok(out.includes('EDO'));
});

test('alpha range crosses into doubling: A..CC ends AA, BB, CC', () => {
  const out = gen('ED', 'A', 'CC');
  assert.equal(out.length, 29);
  assert.deepEqual(out.slice(-3), ['EDAA', 'EDBB', 'EDCC']);
});

test('alpha endpoints are case-insensitive, prefix is left as typed', () => {
  assert.deepEqual(gen('ed', 'a', 'c'), ['edA', 'edB', 'edC']);
});

test('AB as an endpoint throws with the doubling explanation', () => {
  assert.throws(() => gen('ED', 'A', 'AB'), /AB isn't a valid endpoint — letters repeat: A, B … Z, AA, BB\./);
});

test('mixed modes throw', () => {
  assert.throws(() => gen('ED', '1', 'Z'), /both ends must be numbers or both letters/);
});

test('reversed numeric range throws', () => {
  assert.throws(() => gen('ED', '45', '1'), /45 comes after 1/);
});

test('reversed alpha range throws', () => {
  assert.throws(() => gen('ED', 'Z', 'A'), /Z comes after A/);
});

test('missing endpoint throws', () => {
  assert.throws(() => gen('ED', '', '5'), /Enter both a start and an end/);
});

test('ranges over MAX_ITEMS throw and name the count', () => {
  assert.equal(Sequence.MAX_ITEMS, 500);
  assert.throws(() => gen('ED', '1', '100000'), /That range is 100000 stickers — the limit is 500\./);
  assert.equal(gen('ED', '1', '500').length, 500);
});

test('parseLines splits, trims, and drops blanks', () => {
  assert.deepEqual(Sequence.parseLines(' ED1 \r\n\nED2\n   \nED3'), ['ED1', 'ED2', 'ED3']);
  assert.deepEqual(Sequence.parseLines(''), []);
});

test('rangeLabel is first – last, or the single line', () => {
  assert.equal(Sequence.rangeLabel(['ED1', 'ED2', 'ED45']), 'ED1 – ED45');
  assert.equal(Sequence.rangeLabel(['ONLY']), 'ONLY');
  assert.equal(Sequence.rangeLabel([]), '');
});
