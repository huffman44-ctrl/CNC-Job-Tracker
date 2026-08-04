import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
  'utf8'
);

const HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer'];

function fakeSheet(name, rows = []) {
  return {
    _name: name,
    rows,
    frozen: 0,
    getName() { return this._name; },
    getLastRow() { return this.rows.length; },
    getRange(row, col, numRows, numCols) {
      const sheet = this;
      return {
        setValues(values) {
          assert.equal(values.length, numRows);
          for (const v of values) assert.equal(v.length, numCols);
          values.forEach((v, i) => { sheet.rows[row - 1 + i] = v.slice(); });
        },
      };
    },
    setFrozenRows(n) { this.frozen = n; },
  };
}

function fakeSpreadsheet(sheets) {
  return {
    sheets,
    getSheets() { return this.sheets.slice(); },
    insertSheet(name, index) {
      if (this.sheets.some(s => s.getName() === name)) {
        throw new Error(`A sheet named "${name}" already exists`);
      }
      const s = fakeSheet(name);
      this.sheets.splice(index, 0, s);
      return s;
    },
  };
}

// Evaluate the .gs file in a sandbox. Top-level `function` declarations
// attach to the context object, so the helpers are reachable afterwards.
function loadEndpoint(ss) {
  const sandbox = {
    SpreadsheetApp: { openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    DriveApp: {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

function row(customer, sheetName = 'Job Layout Sheet 2') {
  return [sheetName, 'SomeJob', '0:10:00', '2', 'N',
    'Aug 4, 2026, 9:00 AM', 'Collin', '', '', customer];
}

// Values built inside the .gs source (appendRows()'s return object, and
// arrays derived from its LOG_HEADER via .slice()) belong to the vm
// sandbox's V8 realm, so their Object/Array.prototype differs from this
// file's even when the data is identical. assert.deepEqual (strict) treats
// that as a mismatch, so round-trip through JSON to compare plain data
// instead of realm identity.
function plain(v) { return JSON.parse(JSON.stringify(v)); }

test('routes rows to an existing tab, matching case-insensitively with stray whitespace', () => {
  const vanlab = fakeSheet('VanLab', [HEADER.slice()]);
  const ss = fakeSpreadsheet([fakeSheet('Trio Flatmount', [HEADER.slice()]), vanlab]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('  vanlab ')] });
  assert.deepEqual(plain(out), { ok: true, appended: 1 });
  assert.equal(vanlab.rows.length, 2);
  assert.equal(vanlab.rows[1][9], '  vanlab ');   // row data untouched, only routing normalizes
  assert.equal(ss.sheets.length, 2);              // no new tab
});

test('auto-creates a missing customer tab at the end, with header and frozen row', () => {
  const ss = fakeSpreadsheet([fakeSheet('VanLab', [HEADER.slice()])]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('Acme Sets')] });
  assert.deepEqual(plain(out), { ok: true, appended: 1 });
  assert.equal(ss.sheets.length, 2);
  const created = ss.sheets[1];                   // inserted at the end
  assert.equal(created.getName(), 'Acme Sets');
  assert.deepEqual(plain(created.rows[0]), HEADER);
  assert.equal(created.frozen, 1);
  assert.equal(created.rows[1][0], 'Job Layout Sheet 2');
});

test('splits a mixed batch across tabs and sums appended', () => {
  const vanlab = fakeSheet('VanLab', [HEADER.slice()]);
  const ss = fakeSpreadsheet([vanlab]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('VanLab'), row('Acme Sets'), row('VanLab')] });
  assert.deepEqual(plain(out), { ok: true, appended: 3 });
  assert.equal(vanlab.rows.length, 3);
  assert.equal(ss.sheets[1].getName(), 'Acme Sets');
  assert.equal(ss.sheets[1].rows.length, 2);      // header + 1
});

test('9-column legacy rows and empty-customer rows land in Unassigned, padded to 10 columns', () => {
  const ss = fakeSpreadsheet([fakeSheet('VanLab', [HEADER.slice()])]);
  const g = loadEndpoint(ss);
  const legacy = row('x').slice(0, 9);            // 9 columns, no Customer
  const blank = row('   ');                       // 10 columns, blank Customer
  const out = g.appendRows({ rows: [legacy, blank] });
  assert.deepEqual(plain(out), { ok: true, appended: 2 });
  const unassigned = ss.sheets.find(s => s.getName() === 'Unassigned');
  assert.ok(unassigned, 'Unassigned tab created');
  assert.equal(unassigned.rows.length, 3);        // header + 2 (rectangular — no setValues throw)
  assert.equal(unassigned.rows[1].length, 10);
  assert.equal(unassigned.rows[1][9], '');
});

test('sanitizes forbidden tab characters on create, but only for the tab name', () => {
  const ss = fakeSpreadsheet([]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('A/B \\ Sets? *[1]')] });
  assert.deepEqual(plain(out), { ok: true, appended: 1 });
  assert.equal(ss.sheets[0].getName(), 'A-B - Sets- --1-');     // each of / \ ? * [ ] became -
  assert.equal(ss.sheets[0].rows[1][9], 'A/B \\ Sets? *[1]');   // data keeps the true name
});

test('a customer whose sanitized name matches an existing tab reuses it (no duplicate-name crash)', () => {
  const dashed = fakeSheet('A-B Sets', [HEADER.slice()]);
  const ss = fakeSpreadsheet([dashed]);
  const g = loadEndpoint(ss);
  const out = g.appendRows({ rows: [row('A/B Sets')] });
  assert.deepEqual(plain(out), { ok: true, appended: 1 });
  assert.equal(ss.sheets.length, 1);
  assert.equal(dashed.rows.length, 2);
});

test('sanitizeTabName replaces a leading apostrophe and truncates to 100 chars', () => {
  const g = loadEndpoint(fakeSpreadsheet([]));
  assert.equal(g.sanitizeTabName("'Quoted"), '-Quoted');
  assert.equal(g.sanitizeTabName("  'Quoted"), '-Quoted');
  assert.equal(g.sanitizeTabName('x'.repeat(150)).length, 100);
  assert.equal(g.sanitizeTabName('  '), 'Unassigned');
});

test('validation errors are unchanged', () => {
  const g = loadEndpoint(fakeSpreadsheet([]));
  assert.deepEqual(plain(g.appendRows({ rows: [] })), { ok: false, error: 'no rows' });
  assert.deepEqual(plain(g.appendRows({})), { ok: false, error: 'no rows' });
  assert.deepEqual(
    plain(g.appendRows({ rows: [['only', 'eight', 'c', 'o', 'l', 'u', 'm', 'n']] })),
    { ok: false, error: 'rows must be 9 or 10 columns' }
  );
});
