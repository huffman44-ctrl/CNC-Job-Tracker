import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
  'utf8'
);
source = source
  .replace("'PASTE_ORDER_LOG_SPREADSHEET_ID'", "'ORDERLOG1'")
  .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");

// Order Log fixture: real layout — header on sheet row 4, data from row 5.
// Columns (1-based): B=order#, C=customer, E=van, F=assembly.
// PII rule: fake names only.
function orderLogRows() {
  const blank = ['', '', '', '', '', ''];
  return [
    blank, blank, blank,
    ['', 'Order #', 'Customer', '', 'Van', 'Assembly'],          // row 4 header
    ['', '1199', 'Jane Sample', '', '39 Ford E350 SWB Pass', '3806'],
    ['', '#1204', 'Order Fixture LLC', '', 'SUV Full', ''],
    ['', '1206', 'Fake Name', '', 'not-a-van', '12'],
  ];
}

// Values built inside the .gs source belong to the vm sandbox's V8 realm, so
// their Object/Array.prototype differs from this file's even when the data
// is identical (same technique/rationale as logging-endpoint.test.mjs's
// plain() helper). Round-trip through JSON to compare plain data instead of
// realm identity.
function plain(v) { return JSON.parse(JSON.stringify(v)); }

// Evaluate the .gs file in a sandbox. Top-level `function` declarations
// attach to the context object (matches loadEndpoint() in
// logging-endpoint.test.mjs), so lookupOrder/parseVanKey are reachable
// afterwards without any extra injection line.
function makeContext({ tokenValid = true, allowedUids = null } = {}) {
  let ctxSource = source;
  if (allowedUids) {
    ctxSource = ctxSource.replace(
      'const ALLOWED_UIDS = [];',
      `const ALLOWED_UIDS = ${JSON.stringify(allowedUids)};`
    );
  }
  const sandbox = {
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, 'ORDERLOG1');
        return {
          getSheetByName(name) {
            if (name !== 'Order Log') return null;
            return { getDataRange() { return { getValues() { return orderLogRows(); } }; } };
          },
        };
      },
    },
    UrlFetchApp: {
      fetch(url, opts) {
        assert.ok(url.includes('identitytoolkit.googleapis.com'));
        assert.equal(JSON.parse(opts.payload).idToken, 'IDTOKEN1');
        return {
          getResponseCode() { return tokenValid ? 200 : 400; },
          getContentText() {
            return tokenValid ? JSON.stringify({ users: [{ localId: 'uid1' }] }) : '{}';
          },
        };
      },
    },
  };
  vm.runInNewContext(ctxSource, sandbox);
  return sandbox;
}

test('valid sign-in and known order returns the five fields', () => {
  const r = makeContext().lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1199' });
  assert.deepEqual(plain(r), {
    ok: true,
    order: {
      orderNum: '1199', customer: 'Jane Sample',
      vanRaw: '39 Ford E350 SWB Pass', vanKey: '39', assembly: '3806',
    },
  });
});

test('order numbers are normalized: "#1204" matches lookup of "1204"', () => {
  const r = makeContext().lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1204' });
  assert.equal(r.ok, true);
  assert.equal(r.order.customer, 'Order Fixture LLC');
  assert.equal(r.order.vanKey, 'SUV01');
});

test('unmappable van text yields vanKey null, still ok', () => {
  const r = makeContext().lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1206' });
  assert.equal(r.ok, true);
  assert.equal(r.order.vanKey, null);
});

test('unknown order is a clear error, not silence', () => {
  const r = makeContext().lookupOrder({ idToken: 'IDTOKEN1', orderNum: '9999' });
  assert.equal(r.ok, false);
  assert.match(r.error, /9999.*not found/);
});

test('rejected sign-in returns an error and never touches the sheet', () => {
  const ctx = makeContext({ tokenValid: false });
  ctx.SpreadsheetApp.openById = () => { throw new Error('sheet must not be read'); };
  const r = ctx.lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1199' });
  assert.deepEqual(plain(r), { ok: false, error: 'sign-in rejected' });
});

test('allowlisted uid passes', () => {
  const r = makeContext({ allowedUids: ['uid1'] }).lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1199' });
  assert.equal(r.ok, true);
  assert.equal(r.order.orderNum, '1199');
});

test('valid token but non-allowlisted uid is rejected and never touches the sheet', () => {
  const ctx = makeContext({ allowedUids: ['someone-else'] });
  ctx.SpreadsheetApp.openById = () => { throw new Error('sheet must not be read'); };
  const r = ctx.lookupOrder({ idToken: 'IDTOKEN1', orderNum: '1199' });
  assert.deepEqual(plain(r), { ok: false, error: 'sign-in rejected' });
});

test('missing idToken is rejected without a network call', () => {
  const ctx = makeContext();
  ctx.UrlFetchApp.fetch = () => { throw new Error('must not fetch'); };
  const r = ctx.lookupOrder({ orderNum: '1199' });
  assert.deepEqual(plain(r), { ok: false, error: 'missing idToken' });
});

test('parseVanKey mirrors the Python rules', () => {
  const p = makeContext().parseVanKey;
  assert.equal(p('39 Ford E350'), '39');
  assert.equal(p('  28 Promaster'), '28');
  assert.equal(p('SUV Full'), 'SUV01');
  assert.equal(p('suv bed'), 'SUV01');
  assert.equal(p('not-a-van'), null);
  assert.equal(p(''), null);
  assert.equal(p(null), null);
});
