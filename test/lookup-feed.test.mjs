import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Sticker feed (ticket 03). Fake names and fake sheet ids only: the repo is public.
// Feed layout matches the Order Log: tab "Order Log", A1 = last updated,
// header on row 4, data from row 5; B order, C customer, E van, F kit.

const rawSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
  'utf8'
);
const baseSource = rawSource
  .replace("'PASTE_ORDER_LOG_SPREADSHEET_ID'", "'ORDERLOG1'")
  .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");
const FEED_ID = 'FEED1';
const HOUR = 3600 * 1000;

function plain(v) { return JSON.parse(JSON.stringify(v)); }

function sheetRows(a1, rows) {
  const blank = ['', '', '', '', '', ''];
  return [[a1, '', '', '', '', ''], blank, blank,
    ['', 'Order #', 'Customer', '', 'Van', 'Kit'],
    ...rows.map(r => ['', r[0], r[1], '', r[2], r[3]])];
}

const ORDER_LOG = sheetRows('', [
  ['1199', 'Jane Sample', '39 Ford E350 SWB Pass', '3806'],
  ['#1204', 'Order Fixture LLC', 'SUV Full', ''],
  ['1206', 'Fake Name', 'not-a-van', '12'],
]);

// opts: feed / orderLog = rows array | 'throw' | 'notab'; feedId overrides the constant
function makeCtx(opts = {}) {
  const feedId = opts.feedId === undefined ? FEED_ID : opts.feedId;
  const src = feedId === null ? baseSource
    : baseSource.replace("'PASTE_FEED_SPREADSHEET_ID'", `'${feedId}'`);
  const opened = [];
  const sandbox = {
    SpreadsheetApp: {
      openById(id) {
        opened.push(id);
        const which = id === FEED_ID ? 'feed' : id === 'ORDERLOG1' ? 'orderLog' : null;
        assert.ok(which, 'unexpected sheet id');
        const data = which === 'feed' ? opts.feed : (opts.orderLog === undefined ? ORDER_LOG : opts.orderLog);
        if (data === 'throw') throw new Error(which + ' no access');
        return {
          getSheetByName(name) {
            if (data === 'notab' || name !== 'Order Log') return null;
            return { getDataRange() { return { getValues() { return data; } }; } };
          },
        };
      },
    },
    UrlFetchApp: {
      fetch() {
        return {
          getResponseCode() { return opts.badToken ? 400 : 200; },
          getContentText() { return opts.badToken ? '{}' : JSON.stringify({ users: [{ localId: 'uid1' }] }); },
        };
      },
    },
  };
  vm.runInNewContext(src, sandbox);
  sandbox.opened = opened;
  return sandbox;
}
const ask = (ctx, n) => plain(ctx.lookupOrder({ idToken: 'IDTOKEN1', orderNum: n }));
const fresh = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();
const FEED_PAT = [['1199', 'Pat Sample', '39: Ford Transit 148"', '3806']];

test('placeholder feed id: feed never opened, result has no new fields', () => {
  const ctx = makeCtx({ feedId: null });
  const r = ask(ctx, '1199');
  assert.deepEqual(r, { ok: true, order: {
    orderNum: '1199', customer: 'Jane Sample',
    vanRaw: '39 Ford E350 SWB Pass', vanKey: '39', assembly: '3806' } });
  assert.deepEqual(ctx.opened, ['ORDERLOG1']);
});

test('feed row wins: source feed, customer from feed, orderLogChecked true', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), FEED_PAT) }), '1199');
  assert.equal(r.ok, true);
  assert.equal(r.order.source, 'feed');
  assert.equal(r.order.customer, 'Pat Sample');
  assert.equal(r.order.vanRaw, '39: Ford Transit 148"');
  assert.equal(r.order.vanKey, '39');
  assert.equal(r.order.assembly, '3806');
  assert.equal(r.order.orderLogChecked, true);
  assert.equal(r.order.feedStale, false);
  assert.match(r.order.feedUpdatedAt, /^\d{4}-\d\d-\d\dT/);
});

test('feed with blank customer takes the Order Log customer', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['1199', '', '39: Ford Transit', '3806']]) }), '1199');
  assert.equal(r.order.customer, 'Jane Sample');
});

test('SUV text in the feed gives SUV01', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['1204', 'Pat Sample', 'SUV01: SUV01', 'A1']]) }), '1204');
  assert.equal(r.order.vanKey, 'SUV01');
  assert.equal(r.order.source, 'feed');
});

test('# prefix is normalized in the feed', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['#1199', 'Pat Sample', '39: Ford', '3806']]) }), '1199');
  assert.equal(r.order.source, 'feed');
});

test('INVOICE 1030 is not order 1030 in the feed', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['INVOICE 1030', 'Pat Sample', '39: Ford', '1']]) }), '1030');
  assert.equal(r.ok, false);
  assert.match(r.error, /1030/);
});

test('feed row with blank van, blank kit or unparseable van counts as not found', () => {
  for (const row of [['1199', 'Pat', '', '3806'], ['1199', 'Pat', '39: Ford', ''], ['1199', 'Pat', 'not-a-van', '3806']]) {
    const r = ask(makeCtx({ feed: sheetRows(fresh(), [row]) }), '1199');
    assert.equal(r.ok, true);
    assert.equal(r.order.source, 'orderLog');
    assert.equal(r.order.customer, 'Jane Sample');
    assert.equal(r.order.vanKey, '39');
    assert.equal(r.order.orderLogChecked, true);
  }
});

test('feed errors (throw, missing tab) fall back to the Order Log and report stale', () => {
  for (const feed of ['throw', 'notab']) {
    const r = ask(makeCtx({ feed }), '1199');
    assert.equal(r.ok, true);
    assert.equal(r.order.source, 'orderLog');
    assert.equal(r.order.feedStale, true);
    assert.equal(r.order.feedUpdatedAt, '');
    assert.equal(r.order.orderLogChecked, true);
  }
});

test('Order Log fallback still reports feedUpdatedAt and feedStale', () => {
  const when = new Date(Date.now() - 5 * HOUR).toISOString();
  const r = ask(makeCtx({ feed: sheetRows(when, []) }), '1199');
  assert.equal(r.order.source, 'orderLog');
  assert.equal(r.order.feedStale, true);
  assert.equal(r.order.feedUpdatedAt, when);
});

test('feedStale: 1 hour is fresh, 3 hours stale, empty and garbage stale', () => {
  const stale = (a1) => ask(makeCtx({ feed: sheetRows(a1, FEED_PAT) }), '1199').order.feedStale;
  assert.equal(stale(new Date(Date.now() - HOUR).toISOString()), false);
  assert.equal(stale(new Date(Date.now() - 3 * HOUR).toISOString()), true);
  assert.equal(stale(''), true);
  assert.equal(stale('not a time'), true);
});

test('A1 as a Date (vm realm, not instanceof outer Date) parses', () => {
  const inner = vm.runInNewContext('new Date(' + (Date.now() - HOUR) + ')');
  assert.equal(inner instanceof Date, false);
  const r = ask(makeCtx({ feed: sheetRows(inner, FEED_PAT) }), '1199');
  assert.equal(r.order.feedStale, false);
  assert.equal(r.order.feedUpdatedAt, new Date(inner.getTime()).toISOString());
  const old = vm.runInNewContext('new Date(' + (Date.now() - 4 * HOUR) + ')');
  assert.equal(ask(makeCtx({ feed: sheetRows(old, FEED_PAT) }), '1199').order.feedStale, true);
});

test('A1 as a Date from the outer realm parses too', () => {
  const r = ask(makeCtx({ feed: sheetRows(new Date(Date.now() - HOUR), FEED_PAT) }), '1199');
  assert.equal(r.order.feedStale, false);
});

test('feed usable, Order Log has no such order: feed, orderLogChecked true', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['5555', 'Pat Sample', '12: Ram Promaster', '77']]) }), '5555');
  assert.equal(r.order.source, 'feed');
  assert.equal(r.order.orderLogChecked, true);
  assert.equal(r.order.customer, 'Pat Sample');
});

test('feed usable, Order Log unreadable: feed, orderLogChecked false', () => {
  for (const orderLog of ['throw', 'notab']) {
    const r = ask(makeCtx({ orderLog, feed: sheetRows(fresh(), [['5555', 'Pat Sample', '12: Ram Promaster', '77']]) }), '5555');
    assert.equal(r.ok, true);
    assert.equal(r.order.source, 'feed');
    assert.equal(r.order.orderLogChecked, false);
  }
});

test('van key disagreement returns a conflict and no order', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['1199', 'Pat Sample', '22: Ford Transit 148"', '3806']]) }), '1199');
  assert.equal(r.ok, true);
  assert.equal(r.order, null);
  assert.equal(r.conflict.orderNum, '1199');
  assert.equal(r.conflict.customer, 'Pat Sample');
  assert.deepEqual(r.conflict.feed, { vanRaw: '22: Ford Transit 148"', vanKey: '22', assembly: '3806' });
  assert.deepEqual(r.conflict.orderLog, { vanRaw: '39 Ford E350 SWB Pass', vanKey: '39', assembly: '3806' });
  assert.equal(r.conflict.feedStale, false);
  assert.ok('feedUpdatedAt' in r.conflict);
});

test('conflict customer falls back to the Order Log when the feed has none', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), [['1199', '', '22: Ford', '3806']]) }), '1199');
  assert.equal(r.conflict.customer, 'Jane Sample');
});

test('kit disagreement is a conflict; trim and case do not matter', () => {
  const ol = sheetRows('', [['2000', 'Ola Sample', '12 Promaster', 'ab-1']]);
  const conf = ask(makeCtx({ orderLog: ol, feed: sheetRows(fresh(), [['2000', '', '12: Ram', 'AB-2']]) }), '2000');
  assert.equal(conf.order, null);
  assert.equal(conf.conflict.customer, 'Ola Sample');
  const same = ask(makeCtx({ orderLog: ol, feed: sheetRows(fresh(), [['2000', '', '12: Ram', ' AB-1 ']]) }), '2000');
  assert.equal(same.order.source, 'feed');
});

test('a blank on one side is not a disagreement; van wording is never compared', () => {
  const ol = sheetRows('', [['2001', 'Ola Sample', 'not-a-van', ''], ['2002', 'Ola Sample', '39 Ford E350 SWB Pass', '3806']]);
  const blank = ask(makeCtx({ orderLog: ol, feed: sheetRows(fresh(), [['2001', 'Pat', '12: Ram', '55']]) }), '2001');
  assert.equal(blank.order.source, 'feed');
  const wording = ask(makeCtx({ orderLog: ol, feed: sheetRows(fresh(), [['2002', 'Pat', '39: Totally Different Words', '3806']]) }), '2002');
  assert.equal(wording.order.source, 'feed');
});

test('neither source has it: error names both', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), []) }), '9999');
  assert.equal(r.ok, false);
  assert.match(r.error, /9999/);
  assert.match(r.error, /feed/i);
  assert.match(r.error, /Order Log/);
});

test('Order Log unreadable and no feed row: today\'s error', () => {
  const r = ask(makeCtx({ feed: sheetRows(fresh(), []), orderLog: 'notab' }), '9999');
  assert.deepEqual(r, { ok: false, error: 'Order Log tab not found' });
});

test('bad token reads neither sheet', () => {
  const ctx = makeCtx({ feed: sheetRows(fresh(), FEED_PAT), badToken: true });
  assert.deepEqual(ask(ctx, '1199'), { ok: false, error: 'sign-in rejected' });
  assert.deepEqual(ctx.opened, []);
});

test('response carries only the one order: no other rows, customers or sheet ids', () => {
  const feed = sheetRows(fresh(), [...FEED_PAT, ['1300', 'Zed Other', '12: Ram', '9']]);
  const text = JSON.stringify(ask(makeCtx({ feed }), '1199'));
  assert.ok(!text.includes('Zed Other'));
  assert.ok(!text.includes('1300'));
  assert.ok(!text.includes(FEED_ID));
});
