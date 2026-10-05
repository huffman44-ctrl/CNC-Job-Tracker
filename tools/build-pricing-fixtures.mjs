// Builds test/fixtures/pricing/*.json from past Job Tracker job-export CSVs, with FAKE names.
// READ-ONLY on the source folder (never writes/renames/deletes there). Writes only to test/fixtures/pricing/.
// Run: node tools/build-pricing-fixtures.mjs   (generated once, committed; this repo is PUBLIC)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'G:/My Drive/CSV Exports';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'pricing');
const FAKE = [
  { name: 'Northlight Studios', prefix: 'NL' },
  { name: 'Harbor Lane Pictures', prefix: 'HL' },
  { name: 'Copperline Stage', prefix: 'CL' },
  { name: 'Ridgeway Vans', prefix: 'RV' },
];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Same helpers as js/app.js (browser code, not requirable) — keep in step with compareSheets.
function sheetNumber(fileName) {
  const m = fileName.match(/sheet\s*0*(\d+)/i) || fileName.match(/\[\s*0*(\d+)\s*\]/);
  if (m) return parseInt(m[1], 10);
  const trailing = fileName.replace(/\.\w+$/, '').match(/(\d+)\s*$/);
  return trailing ? parseInt(trailing[1], 10) : Infinity;
}
function sheetMaterial(fileName) {
  const bracket = fileName.match(/^(.*?)\s*\[\s*\d+\s*\]/);
  if (bracket) return bracket[1].trim().toLowerCase();
  const trailing = fileName.replace(/\.\w+$/, '').match(/^(.*?)\s+\d+\s*$/);
  return trailing ? trailing[1].trim().toLowerCase() : '';
}
function compareSheets(a, b) {
  const ma = sheetMaterial(a), mb = sheetMaterial(b);
  if (ma !== mb) return ma.localeCompare(mb);
  return sheetNumber(a) - sheetNumber(b);
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '') !== '');
}

// 'Sep 15, 2026, 8:00 AM' (maybe U+202F before AM/PM): read the words; never new Date(iso).
function parseCut(text) {
  const m = /^\s*([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})(?:,?\s*(\d{1,2}):(\d{2})[\s\u202f\u00a0]*([AP]M))?/i.exec(text || '');
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  let h = m[4] ? parseInt(m[4], 10) % 12 : 0;
  if (m[6] && m[6].toUpperCase() === 'PM') h += 12;
  const mo = MONTHS[m[1].toLowerCase()], d = parseInt(m[2], 10), y = parseInt(m[3], 10);
  const p = n => String(n).padStart(2, '0');
  return { ymd: `${y}-${p(mo)}-${p(d)}`, sortKey: ((y * 100 + mo) * 100 + d) * 10000 + h * 100 + (m[5] ? parseInt(m[5], 10) : 0) };
}
function timeSec(t) {
  const parts = String(t || '').trim().split(':');
  if (!parts.length || parts.some(p => !/^\d+$/.test(p))) return 0;
  return parts.reduce((a, p) => a * 60 + parseInt(p, 10), 0);
}

const files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.csv')).sort();
const HEAD = '"Sheet","Job","Total Time"';
const byJob = new Map();
let used = 0, skipped = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8');
  if (!text.replace(/^\ufeff/, '').startsWith(HEAD)) { skipped++; continue; }
  const rows = parseCsv(text); const head = rows.shift();
  const col = n => head.indexOf(n);
  const c9 = col('Customer') >= 0;
  used++;
  for (const r of rows) {
    const job = r[col('Job')]; if (!job) continue;
    const title = r[col('Sheet')];
    const cut = parseCut(r[col('Completed At')]);
    const e = byJob.get(job) || { customers: new Set(), has9: false, rows: new Map() };
    byJob.set(job, e);
    if (c9) { e.has9 = true; const cu = (r[col('Customer')] || '').trim(); if (cu) e.customers.add(cu); }
    const rec = { title, sec: timeSec(r[col('Total Time')]), tp: parseInt(r[col('Toolpath Count')], 10) || 0,
      vbit: /^y/i.test(r[col('Has V-bit')] || ''), cut: cut && cut.ymd, key: cut ? cut.sortKey : -1 };
    const old = e.rows.get(title);
    if (!old || rec.key >= old.key) e.rows.set(title, rec); // dedupe re-exports: latest Completed At wins
  }
}

const realCustomers = [...new Set([...byJob.values()].flatMap(e => [...e.customers]))].sort();
const fakeFor = new Map(realCustomers.map((n, i) => [n, FAKE[i % FAKE.length]]));
const jobNames = [...byJob.keys()].sort();
const fixtures = jobNames.map((job, i) => {
  const e = byJob.get(job);
  const legacy = !e.has9 || e.customers.size === 0;
  const cust = legacy ? null : fakeFor.get([...e.customers].sort()[0]);
  const nn = String(i + 1).padStart(2, '0');
  const sheets = [...e.rows.values()].sort((a, b) => compareSheets(a.title, b.title)).map((r, k) => ({
    order: k + 1, sheetLabel: `Sheet ${k + 1}`, totalTimeSec: r.sec, toolpathCount: r.tp, hasVbit: r.vbit, cutDate: r.cut || null }));
  return { fixture: `job-${nn}`, jobName: `${cust ? cust.prefix : 'LG'}_Fixture_${nn}`, customer: cust ? cust.name : null, legacy8Column: legacy, sheets };
});

// Self-check: no original customer or job string may survive in the output.
const blob = JSON.stringify(fixtures);
for (const s of [...realCustomers, ...jobNames]) {
  if (s.trim().length >= 3 && blob.includes(s)) { console.error('ABORT: a real name survived in the fixture output (' + s.length + ' chars). Nothing written.'); process.exit(1); }
}
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));
for (const fx of fixtures) {
  fs.writeFileSync(path.join(OUT, fx.fixture + '.json'), JSON.stringify(fx, null, 2) + '\n');
  console.log(`${fx.fixture}  ${fx.customer || '(legacy)'}  ${fx.sheets.length} sheets`);
}
console.log(`Wrote ${fixtures.length} fixtures from ${used} job CSVs (${skipped} files skipped).`);
