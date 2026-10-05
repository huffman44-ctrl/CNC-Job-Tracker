import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../js/settings.js');

const priceForm = (o = {}) => ({ handlingFirst: '60', handlingRepeat: '40', hourlyRate: '135', rush48Pct: '50', rush24Pct: '75', weekendPct: '50', cutMinimum: '150', roundTo: '5', ...o });

/* ── Prices ── */
test('prices: percent round-trip 50 -> 0.5 -> 50 and the full list shape', () => {
  const r = V.validatePrices(priceForm());
  assert.equal(r.ok, true);
  assert.equal(r.list.rush.rush48, 0.5);
  assert.equal(r.list.rush.rush24, 0.75);
  assert.equal(r.list.weekendRate, 0.5);
  assert.equal(r.list.rush.standard, 0);
  assert.equal(V.fractionToPct(r.list.rush.rush48), 50);
  assert.equal(V.fractionToPct(V.pctToFraction(33.33)), 33.33);
  for (const k of ['handlingFirst', 'handlingRepeat', 'hourlyRate', 'weekendRate', 'cutMinimum', 'roundTo']) assert.ok(Number.isFinite(r.list[k]), k);
});
test('prices: keeps rush.standard from the base list', () => {
  const r = V.validatePrices(priceForm(), { rush: { standard: 0.1, rush48: 9, rush24: 9 } });
  assert.equal(r.list.rush.standard, 0.1);
});
test('prices: negative, blank, non-number, zero round-to and >300% are refused', () => {
  assert.equal(V.validatePrices(priceForm({ hourlyRate: '-1' })).ok, false);
  assert.equal(V.validatePrices(priceForm({ cutMinimum: '' })).ok, false);
  assert.equal(V.validatePrices(priceForm({ handlingFirst: 'abc' })).ok, false);
  assert.equal(V.validatePrices(priceForm({ roundTo: '0' })).ok, false);
  assert.equal(V.validatePrices(priceForm({ rush24Pct: '301' })).ok, false);
  assert.equal(V.validatePrices(priceForm({ weekendPct: '300' })).ok, true);
  assert.match(V.validatePrices(priceForm({ hourlyRate: '-1' })).error, /Hourly rate/);
});

/* ── Labor types ── */
const row = (o = {}) => ({ id: 'design', name: 'Design', rate: '150', minHours: '1', qbItem: 'Digital Design', ...o });
test('labor types: valid rows pass, numbers coerced, new row gets lt_<slug>_<4> id', () => {
  const r = V.validateLaborTypes([row(), row({ id: null, name: 'Site Visit', rate: '95.5', minHours: '0' })], {});
  assert.equal(r.ok, true);
  assert.equal(r.types[0].id, 'design');
  assert.equal(r.types[0].rate, 150);
  assert.match(r.types[1].id, /^lt_site_visit_[a-z0-9]{4}$/);
  assert.equal(r.types[1].rate, 95.5);
});
test('labor types: empty/duplicate name, bad rate/min/item refused', () => {
  assert.equal(V.validateLaborTypes([row({ name: ' ' })], {}).ok, false);
  assert.equal(V.validateLaborTypes([row(), row({ id: 'cam', name: 'design' })], {}).ok, false);
  assert.equal(V.validateLaborTypes([row({ rate: '-5' })], {}).ok, false);
  assert.equal(V.validateLaborTypes([row({ minHours: '' })], {}).ok, false);
  assert.equal(V.validateLaborTypes([row({ qbItem: '' })], {}).ok, false);
});
test('labor types: removing a type still used on unbilled jobs is refused', () => {
  const r = V.validateLaborTypes([row({ removed: true })], { design: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "Design is used on 2 jobs that aren't billed yet.");
  assert.equal(V.validateLaborTypes([row({ removed: true })], { design: 1 }).error, "Design is used on 1 job that isn't billed yet.");
  const ok = V.validateLaborTypes([row({ removed: true })], {});
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.types, []);
});

/* ── QuickBooks ── */
test('qb items: names required, taxable Y/N only', () => {
  const r = V.validateQbItems({ cnc: 'CNC Router Work', materials: 'Materials', taxableCnc: 'Y', taxableLabor: 'N' });
  assert.deepEqual(r.doc, { cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'Y', labor: 'N' } });
  assert.equal(V.validateQbItems({ cnc: '', materials: 'M', taxableCnc: 'Y', taxableLabor: 'N' }).ok, false);
  assert.equal(V.validateQbItems({ cnc: 'a', materials: ' ', taxableCnc: 'Y', taxableLabor: 'N' }).ok, false);
  assert.equal(V.validateQbItems({ cnc: 'a', materials: 'b', taxableCnc: 'maybe', taxableLabor: 'N' }).ok, false);
});

/* ── Invoicing ── */
const inv = (o = {}) => ({ seedNumber: '3603', weekEndingDay: '6', defaultDue: 'receipt', billingStartDate: '', ...o });
test('invoicing: valid doc; blank billing start is null', () => {
  const r = V.validateInvoicing(inv());
  assert.deepEqual(r.doc, { seedNumber: 3603, weekEndingDay: 6, defaultDue: 'receipt', billingStartDate: null });
  assert.equal(V.validateInvoicing(inv({ billingStartDate: '2026-10-12' })).doc.billingStartDate, '2026-10-12');
});
test('invoicing: seed number must be a positive whole number', () => {
  for (const bad of ['', '0', '-3', '12.5', 'abc', '3 603']) assert.equal(V.validateInvoicing(inv({ seedNumber: bad })).ok, false, bad);
});
test('invoicing: billing start must be a real date or blank; day 0-6; due list', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '10/12/2026', 'soon']) assert.equal(V.validateInvoicing(inv({ billingStartDate: bad })).ok, false, bad);
  assert.equal(V.validateInvoicing(inv({ weekEndingDay: '7' })).ok, false);
  assert.equal(V.validateInvoicing(inv({ weekEndingDay: '0' })).ok, true);
  assert.equal(V.validateInvoicing(inv({ defaultDue: 'net45' })).ok, false);
  assert.equal(V.validateInvoicing(inv({ defaultDue: 'net30' })).doc.defaultDue, 'net30');
});

/* ── Non-finite numbers ── */
test('numbers: a huge digit string (Infinity) is rejected', () => {
  const huge = '9'.repeat(400);
  assert.equal(V.validatePrices(priceForm({ hourlyRate: huge })).ok, false);
  assert.equal(V.validateMaterials([{ name: 'Birch', thicknessIn: '0.75', pricePerSheet: huge, taxable: false }]).ok, false);
});

/* ── Materials ── */
const mat = (o = {}) => ({ id: 'mat_abc123', name: '3/4 in Baltic birch', thicknessIn: '0.75', pricePerSheet: '95', taxable: false, ...o });
test('materials: valid rows keep the id, coerce numbers, store taxable as a real boolean', () => {
  const r = V.validateMaterials([mat(), mat({ id: '', name: 'MDF', thicknessIn: 0.5, pricePerSheet: '0', taxable: 'on' })], []);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].id, 'mat_abc123');
  assert.equal(r.items[0].thicknessIn, 0.75);
  assert.equal(r.items[0].pricePerSheet, 95);
  assert.strictEqual(r.items[0].taxable, false);
  assert.strictEqual(r.items[1].taxable, true);
  assert.match(r.items[1].id, /^mat_[a-z0-9]{6}$/);
});
test('materials: name required, thickness > 0, price >= 0, ids never reused', () => {
  assert.equal(V.validateMaterials([mat({ name: '  ' })]).ok, false);
  assert.equal(V.validateMaterials([mat({ thicknessIn: '0' })]).ok, false);
  assert.equal(V.validateMaterials([mat({ thicknessIn: 'x' })]).ok, false);
  assert.equal(V.validateMaterials([mat({ pricePerSheet: '-1' })]).ok, false);
  assert.equal(V.validateMaterials([mat({ pricePerSheet: '' })]).ok, false);
  const id = V.newMaterialId(['mat_aaaaaa']);
  assert.match(id, /^mat_[a-z0-9]{6}$/);
  assert.notEqual(id, 'mat_aaaaaa');
});
test('materials: an empty list is valid', () => {
  assert.deepEqual(V.validateMaterials([]).items, []);
});
