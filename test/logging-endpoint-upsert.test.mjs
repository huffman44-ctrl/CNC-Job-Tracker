import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rawSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'), 'utf8');

const HEADER14 = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time', 'Operator',
  'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed'];
const HEADER12 = HEADER14.slice(0, 12);   // the Orville tab today: K and L added by hand, no M/N

// A fake Sheets tab rich enough for getDataRange / getRange(...).getValues / setValues /
// getMaxColumns / insertColumnsAfter. rows[0] is the header. Cells may hold Date objects,
// exactly as Sheets hands them back when it auto-converted a typed time.
function fakeSheet(name, rows, maxColumns) {
  return {
    _name: name, rows, frozen: 0, maxColumns: maxColumns || Math.max(26, ...rows.map(r => r.length)),
    getName() { return this._name; },
    getLastRow() { return this.rows.length; },
    getMaxColumns() { return this.maxColumns; },
    insertColumnsAfter(after, n) { assert.equal(after, this.maxColumns, 'columns must be appended at the right end'); this.maxColumns += n; },
    getDataRange() {
      const width = Math.max(1, ...this.rows.map(r => r.length));
      const rows = this.rows.map(r => { const c = r.slice(); while (c.length < width) c.push(''); return c; });
      return { getValues: () => rows.map(r => r.slice()) };
    },
    getRange(row, col, numRows, numCols) {
      const sheet = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const r = sheet.rows[row - 1 + i] || [];
            out.push(Array.from({ length: numCols }, (_, j) => (r[col - 1 + j] === undefined ? '' : r[col - 1 + j])));
          }
          return out;
        },
        setValues(values) {
          assert.equal(values.length, numRows);
          for (const v of values) assert.equal(v.length, numCols);
          assert.ok(col - 1 + numCols <= sheet.maxColumns, 'write past the last column');
          values.forEach((v, i) => {
            const r = sheet.rows[row - 1 + i] || (sheet.rows[row - 1 + i] = []);
            v.forEach((cell, j) => { r[col - 1 + j] = cell; });
          });
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
      if (this.sheets.some(s => s.getName() === name)) throw new Error(`A sheet named "${name}" already exists`);
      const s = fakeSheet(name, []);
      this.sheets.splice(index, 0, s);
      return s;
    },
  };
}

// uid the fake Identity Toolkit answers with; OWNER_UIDS filled by source substitution,
// the same trick test/print-queue-docs-endpoint.test.mjs uses for the API key.
function loadEndpoint(ss, { uid = 'collin-uid', owners = ['travis-uid', 'eva-uid'], transform } = {}) {
  let source = rawSource
    .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'")
    .replace('const OWNER_UIDS = [];', `const OWNER_UIDS = ${JSON.stringify(owners)};`);
  assert.ok(source.includes(`const OWNER_UIDS = ${JSON.stringify(owners)};`), 'OWNER_UIDS constant must exist in the template');
  if (transform) source = transform(source);
  const sandbox = {
    SpreadsheetApp: { openById: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: () => ({ setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ users: [{ localId: uid }] }) }) },
    DriveApp: {},
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}
const plain = v => JSON.parse(JSON.stringify(v));

const T1 = 'Oct 1, 2026, 9:12 AM';
function row(over = {}) {
  return { key: 'fk_a', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00',
    toolpathCount: 2, hasVbit: 'N', completedTime: T1, operator: 'Collin', notes: '', archiveLink: 'https://x/a',
    customer: 'Northlight Studios', ...over };
}

test('new key on an existing 14-column tab → appended with 14 cells, Sheet Key in M', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row()] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  assert.equal(tab.rows.length, 2);
  assert.deepEqual(plain(tab.rows[1]), ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', T1, 'Collin', '', 'https://x/a', 'Northlight Studios', '', '', 'fk_a', '']);
});

test('same key again → updated in place, no new row (export twice never duplicates)', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row()] });
  const out = g.upsertRows({ idToken: 'T', rows: [row({ notes: 'second pass', operator: 'Travis' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 1, appended: 0, claimed: 0 });
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.rows[1][7], 'second pass');
  assert.equal(tab.rows[1][6], 'Travis');
});

test('legacy row with blank M matching (Job, Sheet) → claimed: Sheet Key filled, no new row', () => {
  const legacy = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', 'Sep 30, 2026, 4:00 PM', 'Collin', 'old', 'https://x/old', 'Northlight Studios', '', ''];
  const tab = fakeSheet('Northlight Studios', [HEADER12.slice(), legacy], 12);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row()] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 0, claimed: 1 });
  assert.equal(tab.rows.length, 2);
  assert.equal(tab.rows[1][12], 'fk_a');
  assert.equal(tab.rows[1][5], T1, 'K blank → F overwritten by the fresh export');
  assert.deepEqual(plain(tab.rows[0]), HEADER14, 'blank header cells M1/N1 filled, K1/L1 kept');
  assert.equal(tab.maxColumns, 14, 'two columns appended at the right end');
});

test('P9: one legacy row is claimed once — a second same-batch (Job, Sheet) row appends instead of re-claiming', () => {
  const legacy = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', 'Sep 30, 2026, 4:00 PM', 'Collin', 'old', 'https://x/old', 'Northlight Studios', '', '', '', ''];
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice(), legacy]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row({ key: 'fk_a' }), row({ key: 'fk_b', notes: 'twin' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 1, claimed: 1 });
  assert.equal(tab.rows.length, 3);
  assert.equal(tab.rows[1][12], 'fk_a', 'the claimed row keeps the first key');
  assert.equal(tab.rows[2][12], 'fk_b');
  assert.equal(tab.rows[2][7], 'twin');
});

test('a tab that already has K–N headers is left alone; headers are never renamed', () => {
  const custom = HEADER14.slice(); custom[10] = 'Inv';   // someone typed a different K header
  const tab = fakeSheet('Harbor Lane Pictures', [custom]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ customer: 'Harbor Lane Pictures' })] });
  assert.equal(tab.rows[0][10], 'Inv');
});

test('P11: logEnsureHeaders_ fills only blank K1–N1 on an existing tab — A1–J1 never touched, no column inserted mid-sheet', () => {
  const odd = HEADER12.slice();
  odd[0] = '';            // blank A1 must stay blank
  odd[4] = 'Vbit?';       // renamed E1 must stay
  odd[10] = '';           // blank K1 → filled
  const tab = fakeSheet('Copperline Stage', [odd.slice()], 12);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ customer: 'Copperline Stage' })] });
  assert.equal(tab.rows[0][0], '', 'A1 stays blank');
  assert.equal(tab.rows[0][4], 'Vbit?', 'E1 not renamed');
  assert.equal(tab.rows[0][10], 'Invoice #', 'blank K1 filled');
  assert.equal(tab.rows[0][11], 'PO #');
  assert.equal(tab.rows[0][12], 'Sheet Key');
  assert.equal(tab.rows[0][13], 'Billed');
  assert.equal(tab.maxColumns, 14, 'only appended at the right end');
});

test('P16: a tab wider than N keeps its extra columns untouched (update and append)', () => {
  const header = HEADER14.concat(['Shop Extra', 'Memo']);
  const existing = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', 'Sep 30, 2026, 4:00 PM', 'Collin', 'old', 'https://x/old', 'Northlight Studios', '', '', 'fk_a', '', 'keep-O', 'keep-P'];
  const tab = fakeSheet('Northlight Studios', [header.slice(), existing.slice()], 16);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  const out = g.upsertRows({ idToken: 'T', rows: [row({ notes: 'again' }), row({ key: 'fk_new', sheet: 'Sheet 7' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 1, appended: 1, claimed: 0 });
  assert.equal(tab.rows[1][7], 'again');
  assert.equal(tab.rows[1][14], 'keep-O');
  assert.equal(tab.rows[1][15], 'keep-P');
  assert.deepEqual(plain(tab.rows[0].slice(14)), ['Shop Extra', 'Memo']);
  assert.equal(tab.rows[2][12], 'fk_new');
  assert.equal(tab.rows[2].length, 14, 'appended row writes exactly A–N');
});

test('billed row (K set) re-exported with a DIFFERENT time → F kept, H gets Re-cut; same time → nothing', () => {
  const billed = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', T1, 'Collin', 'ok', 'https://x/a', 'Northlight Studios', '3612', 'PO-1', 'fk_a', 'Y'];
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice(), billed.slice()]);
  const g = loadEndpoint(fakeSpreadsheet([tab]));
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 6, 2026, 2:00 PM', notes: 'recut' })] });
  assert.equal(tab.rows[1][5], T1, 'billed cut time frozen');
  assert.equal(tab.rows[1][7], 'ok · Re-cut Oct 6, 2026, 2:00 PM');
  assert.equal(tab.rows[1][10], '3612', 'K untouched by a non-owner export');
  assert.equal(tab.rows[1][13], 'Y', 'N untouched');
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 6, 2026, 2:00 PM' })] });
  assert.equal(tab.rows[1][7], 'ok · Re-cut Oct 6, 2026, 2:00 PM', 'same re-cut time twice does not double the note');
});

function dateCellRun(loadOpts) {
  const asDate = new Date(2026, 9, 1, 9, 12);   // a REAL Date in column F, the same moment as T1
  // toString is NOT round-trippable here, so only genuine Date handling (getTime) can call it the same moment;
  // a text comparison or Date.parse(String(date)) would not.
  asDate.toString = () => 'Thursday the first, nine twelve in the morning';
  const billed = ['Job Layout Sheet 2', 'NL_Bridge_Wall_Panels', '00:18:00', '2', 'N', asDate, 'Collin', 'ok', 'https://x/a', 'Northlight Studios', '3612', '', 'fk_a', 'Y'];
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice(), billed.slice()]);
  assert.ok(tab.rows[1][5] instanceof Date, 'precondition: F holds a Date object');
  const g = loadEndpoint(fakeSpreadsheet([tab]), loadOpts);
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: T1 })] });
  return { tab, asDate, g };
}

test('Sheets auto-converted F to a Date: same moment is NOT a re-cut (Review Focus 3)', () => {
  const { tab, asDate, g } = dateCellRun();
  assert.equal(tab.rows[1][7], 'ok', 'no Re-cut note for the same moment');
  assert.equal(tab.rows[1][5], asDate, 'F left exactly as it was');
  // Chrome's toLocaleString uses U+202F before AM/PM; that must still read as the same moment.
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 1, 2026, 9:12 AM' })] });
  assert.equal(tab.rows[1][7], 'ok');
  // And a genuinely different moment against the same Date cell IS a re-cut.
  g.upsertRows({ idToken: 'T', rows: [row({ completedTime: 'Oct 6, 2026, 2:00 PM' })] });
  assert.equal(tab.rows[1][7], 'ok · Re-cut Oct 6, 2026, 2:00 PM');
  assert.equal(tab.rows[1][5], asDate);
});

test('the Date test really exercises the Date branch: with Date handling stripped it records a false Re-cut', () => {
  // Mutation proof: make the Date check always false (as if the code did not handle Dates).
  const { tab } = dateCellRun({ transform: s => s.replace("=== '[object Date]'", "=== '[object NeverADate]'") });
  assert.notEqual(tab.rows[1][7], 'ok', 'without Date handling the same moment is wrongly flagged');
  assert.match(tab.rows[1][7], /Re-cut/);
});

test('invoice/po/billed from an owner uid → K/L/N written; from Collin → refused, nothing written', () => {
  const tab = fakeSheet('Northlight Studios', [HEADER14.slice()]);
  const ss = fakeSpreadsheet([tab]);
  const owner = loadEndpoint(ss, { uid: 'travis-uid' });
  const out = owner.upsertRows({ idToken: 'T', rows: [row({ invoice: '3612', billed: 'Y' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  assert.equal(tab.rows[1][10], '3612');
  assert.equal(tab.rows[1][11], '', 'L not carried → left blank');
  assert.equal(tab.rows[1][13], 'Y');
  const collin = loadEndpoint(ss, { uid: 'collin-uid' });
  const refused = collin.upsertRows({ idToken: 'T', rows: [row({ po: 'PO-9' })] });
  assert.deepEqual(plain(refused), { ok: false, error: 'owner only' });
  assert.equal(tab.rows[1][11], '');
  const ok = collin.upsertRows({ idToken: 'T', rows: [row({ notes: 'plain export' })] });
  assert.equal(ok.ok, true, 'rows without billing fields are fine from Collin');
  assert.equal(tab.rows[1][10], '3612', 'K survives a plain re-export');
});

test('token required, rows validated, customer routes to its tab (new tab gets the 14-col header)', () => {
  const ss = fakeSpreadsheet([]);
  const g = loadEndpoint(ss);
  assert.deepEqual(plain(g.upsertRows({ rows: [row()] })), { ok: false, error: 'missing idToken' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [] })), { ok: false, error: 'no rows' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [['positional']] })), { ok: false, error: 'row 1 has no key' });
  assert.deepEqual(plain(g.upsertRows({ idToken: 'T', rows: [row({ key: '' })] })), { ok: false, error: 'row 1 has no key' });
  const out = g.upsertRows({ idToken: 'T', rows: [row(), row({ key: 'fk_b', sheet: 'Sheet 3', customer: '' })] });
  assert.deepEqual(plain(out), { ok: true, updated: 0, appended: 2, claimed: 0 });
  const nl = ss.sheets.find(s => s.getName() === 'Northlight Studios');
  const un = ss.sheets.find(s => s.getName() === 'Unassigned');
  assert.deepEqual(plain(nl.rows[0]), HEADER14);
  assert.equal(nl.frozen, 1);
  assert.equal(un.rows[1][12], 'fk_b');
});

test('doPost dispatches upsertRows and still knows appendRows', () => {
  const g = loadEndpoint(fakeSpreadsheet([fakeSheet('Northlight Studios', [HEADER14.slice()])]));
  const src = rawSource.replace("'PASTE_TOKEN'", "'TOK'").replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");
  const sandbox = { ...g, __out: null };
  sandbox.ContentService = { createTextOutput: (s) => { sandbox.__out = JSON.parse(s); return { setMimeType() { return this; } }; }, MimeType: { JSON: 'json' } };
  vm.runInNewContext(src, sandbox);
  sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', action: 'upsertRows', idToken: 'T', rows: [row()] }) } });
  assert.deepEqual(plain(sandbox.__out), { ok: true, updated: 0, appended: 1, claimed: 0 });
  sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', action: 'appendRows', rows: [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'Northlight Studios']] }) } });
  assert.equal(sandbox.__out.ok, true);
});
