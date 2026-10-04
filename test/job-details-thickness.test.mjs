import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JobDetails = require('../js/job-details.js');   // DOM is touched only inside init()

test('thickness comes from the Material Block Z value (what VCarve actually writes)', () => {
  const info = [{ label: 'Material Block', value: 'X: 48"  Y: 96"  Z: 0.47"' }, { label: 'Home / Start Position', value: 'X: 0"  Y: 0"  Z: 0.76"' }];
  assert.equal(JobDetails.thicknessFromMaterialInfo(info), 0.47);
  assert.equal(JobDetails.sheetSizeLabel(info), '48×96');
});

test('an explicit Thickness line wins; Material Size falls back to its last number', () => {
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Material Size', value: '48 x 96 x 0.75' }, { label: 'Thickness', value: '0.5 in' }]), 0.5);
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Material Size', value: '48 x 96 x 0.75' }]), 0.75);
});

test('nothing usable → null / empty, never NaN', () => {
  assert.equal(JobDetails.thicknessFromMaterialInfo([]), null);
  assert.equal(JobDetails.thicknessFromMaterialInfo(null), null);
  assert.equal(JobDetails.thicknessFromMaterialInfo([{ label: 'Datum Position', value: '' }]), null);
  assert.equal(JobDetails.sheetSizeLabel([{ label: 'Z-Zero', value: 'Top of Material' }]), '');
});
