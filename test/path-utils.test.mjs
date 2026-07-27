import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeForPath } = require('../js/path-utils.js');

test('passes through an already-safe name', () => {
  assert.equal(sanitizeForPath('Jane Client'), 'Jane Client');
});

test('replaces Windows-illegal path characters with a dash', () => {
  assert.equal(sanitizeForPath('Jane/Client: "VIP"'), 'Jane-Client- -VIP-');
});

test('strips trailing dots and spaces', () => {
  assert.equal(sanitizeForPath('Jane Client...   '), 'Jane Client');
});

test('falls back to Unfiled for empty or illegal-only input', () => {
  assert.equal(sanitizeForPath('///'), 'Unfiled');
  assert.equal(sanitizeForPath(''), 'Unfiled');
  assert.equal(sanitizeForPath(null), 'Unfiled');
});
