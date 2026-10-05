import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.PathUtils = require('../js/path-utils.js');
globalThis.Pricing = require('../js/pricing.js');
const InvoiceLines = require('../js/invoice-lines.js');
const Pricing = globalThis.Pricing;

const STANDARD = { handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135, rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5 };
const LABOR = [
  { id: 'design', name: 'Design', rate: 150, minHours: 1, qbItem: 'Digital Design' },
  { id: 'cam', name: 'CAM', rate: 85, minHours: 0.5, qbItem: 'Digital Design' },
];
const QB = { cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'N', labor: 'N' } };
const CUSTOMER_SUPPLIED = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0, taxable: false };
const job = (jobName, extra = {}) => ({ jobName, turnaround: 'standard', material: CUSTOMER_SUPPLIED, includeLabor: false, laborLines: [], ...extra });
let n = 0;
const sheet = (jobKey, order, totalTimeSec, cutDate, extra = {}) =>
  ({ fileKey: `fk${++n}`, jobKey, order, sheetLabel: `Job Layout Sheet ${order}`, totalTimeSec, toolpathCount: 3, hasVbit: false, cutDate, ...extra });

function exampleA() {
  const t = [909, 909, 909, 909, 1200, 1200, 1200, 1368, 1368, 1368];
  return { jobs: { A: job('NL_Bridge_Wall_Panels') }, sheets: t.map((sec, i) => sheet('A', i + 1, sec, '2026-10-01')) };
}
function exampleB() {
  const t = [720, 1080, 540, 1620];
  return {
    jobs: { B: job('NL_Corridor_Arches', { turnaround: 'rush48', includeLabor: true, laborLines: [{ id: 'll1', typeId: 'design', hours: 1.5, note: 'Corridor arch drawings' }] }) },
    sheets: t.map((sec, i) => sheet('B', i + 2, sec, i === 3 ? '2026-10-03' : '2026-10-01')),
  };
}
const price = (parts, extra = {}) => Pricing.priceInvoice({ priceList: STANDARD, laborTypes: LABOR, priorBilled: [], ...parts, ...extra });
const merge = (...ps) => ({ jobs: Object.assign({}, ...ps.map(p => p.jobs)), sheets: ps.flatMap(p => p.sheets) });
const ctx = { qbItems: QB, laborTypes: LABOR };
const mat = (name, taxable) => ({ kind: 'ours', materialId: 'm_' + name, name, pricePerSheet: 95, taxable });
const laborJob = (lines) => ({ jobs: { L: job('L_Job', { includeLabor: true, laborLines: lines }) }, sheets: [sheet('L', 1, 3600, '2026-10-01')] });

test('Example C CSV is byte-exact', () => {
  const priced = price(merge(exampleA(), exampleB()));
  const lines = InvoiceLines.finalize(priced, ctx);
  const csv = InvoiceLines.buildQuickBooksCsv({ number: 3612, customerName: 'Northlight Studios', invoiceDate: '2026-10-06', dueDate: '2026-10-06', lines });
  const EXPECTED = [
    'Invoice No.,Customer,Invoice Date,Due Date,Item(Product/Service),Item Description,Item Quantity,Item Rate,Item Amount,Taxable,Service Date',
    '3612,Northlight Studios,10/06/2026,10/06/2026,CNC Router Work,"CNC cutting — 14 sheets (NL_Bridge_Wall_Panels 10, NL_Corridor_Arches 4), 48-hour rush on NL_Corridor_Arches, Weekend (+50%) on 1 sheet",1,1527.5,1527.5,N,10/03/2026',
    '3612,Northlight Studios,10/06/2026,10/06/2026,Digital Design,Design — Corridor arch drawings (1.5 hrs @ $150/hr) + Rush (+50%),1,337.5,337.5,N,',
  ].join('\r\n');
  assert.equal(csv, EXPECTED);
  assert.ok(!csv.startsWith(InvoiceLines.BOM));
});

test('Example D: material first, taxable flips, cut minimum', () => {
  const D = (taxable) => ({ jobs: { D: job('RV_Cabinet_Fronts', { material: mat('3/4 in Baltic birch', taxable) }) }, sheets: [sheet('D', 1, 480, '2026-09-29')] });
  const ls = InvoiceLines.finalize(price(D(false)), ctx);
  assert.equal(ls[0].description, 'Materials — 1 sheet (3/4 in Baltic birch)');
  assert.equal(ls[0].qbItem, 'Materials');
  assert.equal(ls[0].taxable, 'N');
  assert.ok(ls[1].description.endsWith(', Cut minimum'));
  assert.equal(ls[1].amount, 150);
  assert.equal(InvoiceLines.finalize(price(D(true)), ctx)[0].taxable, 'Y');
});

test('labor wording: singular, top-up includes, no includes when met', () => {
  const one = InvoiceLines.finalize(price(laborJob([{ id: 'a', typeId: 'design', hours: 1, note: '' }])), ctx).find(l => l.type === 'labor');
  assert.equal(one.description, 'Design (1 hr @ $150/hr)');
  const cam = InvoiceLines.finalize(price(laborJob([{ id: 'a', typeId: 'cam', hours: 0.25, note: '' }])), ctx).find(l => l.type === 'labor');
  assert.equal(cam.description, 'CAM (0.5 hrs @ $85/hr, includes 0.5-hr minimum)');
  assert.equal(cam.qbItem, 'Digital Design');
  const two = InvoiceLines.finalize(price(laborJob([{ id: 'a', typeId: 'design', hours: 0.5, note: '' }, { id: 'b', typeId: 'design', hours: 0.5, note: '' }])), ctx).filter(l => l.type === 'labor');
  assert.equal(two.length, 2);
  two.forEach(l => assert.equal(l.description, 'Design (0.5 hrs @ $150/hr)'));
});

test('two materials: same taxable merges; differing taxable throws mixed-taxable', () => {
  const mk = (t2) => ({ jobs: { A: job('A_Job', { material: mat('3/4 in Baltic birch', false) }), B: job('B_Job', { material: mat('1/2 in Sintra', t2) }) },
    sheets: [sheet('A', 1, 600, '2026-10-01'), sheet('B', 1, 600, '2026-10-01')] });
  const ls = InvoiceLines.finalize(price(mk(false)), ctx);
  assert.equal(ls.filter(l => l.type === 'material').length, 1);
  assert.equal(ls[0].description, 'Materials — 2 sheets (3/4 in Baltic birch, 1/2 in Sintra)');
  assert.throws(() => InvoiceLines.finalize(price(mk(true)), ctx), e => e.code === 'mixed-taxable' && /taxed differently — bill those jobs separately\./.test(e.message));
});

test('CSV quoting: comma quoted, quote doubled', () => {
  const csv = InvoiceLines.buildQuickBooksCsv({ number: 1, customerName: 'Smith, Jones', invoiceDate: '2026-10-06', dueDate: '2026-10-06',
    lines: [{ qbItem: 'X', description: 'say "hi"', quantity: 1, amount: 10, taxable: 'N', serviceDate: '' }] });
  const row = csv.split('\r\n')[1];
  assert.ok(row.includes('"Smith, Jones"'));
  assert.ok(row.includes('"say ""hi"""'));
});

test('downloadName', () => {
  assert.equal(InvoiceLines.downloadName('Northlight Studios', 3612), 'QuickBooks Exports/Northlight Studios/3612.csv');
  assert.equal(InvoiceLines.downloadName('A/B Co', 7), 'QuickBooks Exports/A-B Co/7.csv');
  assert.equal(InvoiceLines.BOM, '﻿');
});

test('due dates', () => {
  const d = InvoiceLines.dueDateFor;
  assert.equal(d('2026-10-06', 'receipt'), '2026-10-06');
  assert.equal(d('2026-10-06', 'net15'), '2026-10-21');
  assert.equal(d('2026-10-06', 'net30'), '2026-11-05');
  assert.equal(d('2026-12-20', 'net15'), '2027-01-04');
  assert.equal(d('2026-10-06', 'custom', '2026-11-30'), '2026-11-30');
  assert.equal(InvoiceLines.addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(InvoiceLines.DUE_TERMS, { receipt: 0, net15: 15, net30: 30 });
});

test('unknown type throws; register adds a type', () => {
  const bad = { lines: [{ type: 'sanding', amount: 5, rate: 5, quantity: 1, serviceDate: '', jobKeys: [], facts: {} }] };
  assert.throws(() => InvoiceLines.finalize(bad, ctx), /sanding/);
  InvoiceLines.register('sanding', { describe: () => 'Sanding', qbItem: () => 'Sanding Svc', taxable: () => 'N' });
  const out = InvoiceLines.finalize(bad, ctx);
  assert.equal(out[0].description, 'Sanding');
  assert.equal(out[0].qbItem, 'Sanding Svc');
});

test('no money: amounts pass through untouched', () => {
  const priced = price(merge(exampleA(), exampleB()));
  const out = InvoiceLines.finalize(priced, ctx);
  out.forEach((l, i) => {
    assert.ok(l.amount === priced.lines[i].amount);
    assert.ok(l.rate === priced.lines[i].rate);
    assert.ok(l.quantity === priced.lines[i].quantity);
  });
});
