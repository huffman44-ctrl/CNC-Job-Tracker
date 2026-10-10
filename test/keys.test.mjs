// Keys — the ID formulas every live record is filed under (spec .scratch/shared-key-helpers).
// LOCKED: these expected values are what production already uses as document ids. If one of these
// tests fails, the change is wrong — never "update the expected value".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Keys = require('../js/keys.js');

test('job IDs are locked (no trimming, ever)', () => {
  assert.equal(Keys.job('NL_Bridge_Wall_Panels'), 'proj_litwmp');
  assert.equal(Keys.job('Copperline Stage Set'), 'proj_m1ww4z');
  assert.equal(Keys.job(' Harbor Lane '), 'proj_gn2egw');
  assert.equal(Keys.job(''), 'proj_0');
});

test('customer IDs are locked (the name is trimmed first)', () => {
  assert.equal(Keys.customer('Copperline Stage Set'), 'cust_m1ww4z');
  assert.equal(Keys.customer(' Harbor Lane '), 'cust_4oydxc');
  assert.equal(Keys.customer('Harbor Lane'), 'cust_4oydxc');
});

test('sheet IDs (fileKey) are locked', () => {
  assert.equal(Keys.sheet('260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html'), 'yndke5');
  assert.equal(Keys.sheet('NL_Bridge_Wall_Panels'), 'litwmp');
});

test('jobOf: job name, else file name, else Unknown Job', () => {
  assert.equal(Keys.jobOf({ jobName: 'NL_Arch', fileName: 'Sheet 1.html' }), 'NL_Arch');
  assert.equal(Keys.jobOf({ jobName: '', fileName: 'Sheet 1.html' }), 'Sheet 1.html');
  assert.equal(Keys.jobOf({}), 'Unknown Job');
});
