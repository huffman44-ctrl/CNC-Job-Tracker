import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.InvoiceLines = require('../js/invoice-lines.js');
globalThis.Pricing = require('../js/pricing.js');
globalThis.LogRows = require('../js/log-rows.js');
globalThis.BillingModel = require('../js/billing-model.js');
const IS = require('../js/invoice-screen.js');

const err = (code, message = 'x') => Object.assign(new Error(message), { code });

test('lockThenSave: the file is saved only after the lock resolved', async () => {
  const order = [];
  const res = await IS.lockThenSave({ n: 1 }, 'a@x', {
    lock: async () => { order.push('lock'); return { number: 1 }; },
    save: () => order.push('save'),
  });
  assert.deepEqual(order, ['lock', 'save']);
  assert.equal(res.saveError, null);
});

test('lockThenSave: a rejected lock never calls save (no Blob, no anchor)', async () => {
  let saved = 0;
  for (const code of ['sheet-taken', 'number-used', 'changed', 'customer-busy', 'too-big', undefined]) {
    await assert.rejects(IS.lockThenSave({}, 'a@x', { lock: () => Promise.reject(err(code)), save: () => { saved++; } }), e => e.code === code);
    await assert.rejects(IS.lockThenSave({}, 'a@x', { lock: () => { throw err(code); }, save: () => { saved++; } }));
  }
  assert.equal(saved, 0);
});

test('lockThenSave: a save failure after the lock is reported, not thrown', async () => {
  const res = await IS.lockThenSave({}, 'a@x', { lock: async () => ({ number: 5 }), save: () => { throw new Error('boom'); } });
  assert.equal(res.invoice.number, 5);
  assert.equal(res.saveError.message, 'boom');
});

test('refusalInfo maps the codes to the brief texts', () => {
  assert.equal(IS.refusalInfo(err('number-used', '3598 is already on Harbor Lane Pictures (Sep 24). Use another number.')).kind, 'number');
  for (const c of ['sheet-taken', 'customer-busy']) {
    const r = IS.refusalInfo(err(c));
    assert.equal(r.text, 'Another owner just billed some of these. Back to Billing.');
    assert.equal(r.back, true);
  }
  const out = IS.refusalInfo(err('outside', 'Ridgeway Vans is billed outside this app (Settings › Customers).'));
  assert.equal(out.text, 'Ridgeway Vans is billed outside this app (Settings › Customers). Nothing was downloaded.');
  assert.equal(out.back, true);
  assert.match(IS.refusalInfo(err('changed')).text, /^Something changed since this screen was drawn — the total has been refreshed; check it and click again\.$/);
  assert.equal(IS.refusalInfo(err('mixed-taxable', 'Materials on this bill are taxed differently — bill those jobs separately.')).text, 'Materials on this bill are taxed differently — bill those jobs separately.');
  assert.equal(IS.refusalInfo(err('too-big', 'That is 401 sheets')).text, "Couldn't lock the sheets — That is 401 sheets. Nothing was downloaded.");
  assert.equal(IS.refusalInfo(new Error('offline')).text, "Couldn't lock the sheets — offline. Nothing was downloaded.");
});

test('dueState: picks and custom validation', () => {
  assert.deepEqual(IS.dueState({ term: 'receipt', invoiceYmd: '2026-10-05' }), { ok: true, dueDate: '2026-10-05', message: '' });
  assert.equal(IS.dueState({ term: 'net15', invoiceYmd: '2026-10-05' }).dueDate, '2026-10-20');
  assert.equal(IS.dueState({ term: 'net30', invoiceYmd: '2026-10-05' }).dueDate, '2026-11-04');
  assert.equal(IS.dueState({ term: 'custom', customYmd: '2026-12-01', invoiceYmd: '2026-10-05' }).dueDate, '2026-12-01');
  assert.equal(IS.dueState({ term: 'custom', customYmd: '', invoiceYmd: '2026-10-05' }).ok, false);
  assert.equal(IS.dueState({ term: 'custom', customYmd: '2026-02-30', invoiceYmd: '2026-10-05' }).ok, false);
  assert.equal(IS.dueState({ term: 'custom', customYmd: 'soon', invoiceYmd: '2026-10-05' }).ok, false);
  assert.equal(IS.dueState({ term: 'weird', invoiceYmd: '2026-10-05' }).ok, false);
});

test('numberMessage: each state reads as in the brief', () => {
  const m = (state, extra = {}) => IS.numberMessage({ forText: '3598', state, ...extra }, '3598');
  assert.equal(m('invalid').text, 'Type a whole number.');
  assert.equal(m('cancelled').text, '3598 was cancelled earlier — you can use it again.');
  assert.equal(m('free').text, '');
  assert.equal(m('unknown').text, "Couldn't check this number — check your connection.");
  const used = m('used', { invoice: { customerName: 'Harbor Lane Pictures', invoiceDate: '2026-09-24' } });
  assert.equal(used.text, '3598 is already on Harbor Lane Pictures (Sep 24). Use another number.');
  assert.equal(used.kind, 'error');
  assert.equal(IS.numberMessage({ forText: '1', state: 'free' }, '12').text, 'Checking…');   // stale answer
});

test('readiness: Download needs a checked free number, a real due date, owner data and a clean view', () => {
  const ok = { ownerOk: true, check: { forText: '3612', state: 'free' }, numberText: '3612', due: { ok: true }, view: { sheetCount: 14, lines: [] }, busy: false };
  assert.equal(IS.readiness(ok).enabled, true);
  assert.equal(IS.readiness({ ...ok, check: { forText: '3612', state: 'cancelled' } }).enabled, true);
  assert.equal(IS.readiness({ ...ok, check: { forText: '3612', state: 'unknown' } }).enabled, false);
  assert.equal(IS.readiness({ ...ok, check: { forText: '3612', state: 'used' } }).enabled, false);
  assert.equal(IS.readiness({ ...ok, check: { forText: '361', state: 'free' } }).enabled, false);
  assert.equal(IS.readiness({ ...ok, ownerOk: false }).reason, "Owner data didn't load — reload the page.");
  const bad = IS.readiness({ ...ok, due: { ok: false, message: 'Pick a due date.' } });
  assert.equal(bad.enabled, false); assert.equal(bad.reason, 'Pick a due date.');
  assert.equal(IS.readiness({ ...ok, view: { sheetCount: 401 } }).enabled, false);
  assert.equal(IS.readiness({ ...ok, view: { note: 'mixed' } }).enabled, false);
  assert.equal(IS.readiness({ ...ok, busy: true }).enabled, false);
});

test('fmtMoney: negatives read −$0.88', () => {
  assert.equal(IS.fmtMoney(-0.88), '−$0.88');
  assert.equal(IS.fmtMoney(1527.5), '$1,527.50');
  assert.equal(IS.fmtMoney(1865), '$1,865');
});

test('attemptDownload: a price change between paint and click -> no lock, no save', async () => {
  const calls = [];
  const r = await IS.attemptDownload({
    shown: 230, by: 'a@x',
    computeView: () => ({ total: 245, sheetCount: 2, lines: [] }),   // the fresh price differs from what was shown
    buildDraft: () => { calls.push('draft'); return { csv: 'c' }; },
    lock: async () => { calls.push('lock'); return {}; },
    save: () => calls.push('save'),
  });
  assert.equal(r.kind, 'changed');
  assert.equal(r.view.total, 245);          // the caller repaints with this new total
  assert.deepEqual(calls, []);
  assert.match(IS.refusalInfo({ code: 'changed' }).text, /^Something changed since this screen was drawn/);
});

test('attemptDownload: unchanged total -> lock, then save, in that order', async () => {
  const calls = [];
  const r = await IS.attemptDownload({
    shown: 230, by: 'a@x',
    computeView: () => ({ total: 230, sheetCount: 2, lines: [] }),
    buildDraft: () => ({ csv: 'c', number: 1 }),
    lock: async () => { calls.push('lock'); return { number: 1 }; },
    save: () => calls.push('save'),
  });
  assert.equal(r.kind, 'locked');
  assert.deepEqual(calls, ['lock', 'save']);
});

test('attemptDownload: a rejected lock throws and never saves; view problems never lock', async () => {
  let saved = 0, locked = 0;
  const base = { shown: 1, by: 'a', buildDraft: () => ({}), lock: async () => { locked++; }, save: () => { saved++; } };
  await assert.rejects(IS.attemptDownload({ ...base, computeView: () => ({ total: 1, sheetCount: 1 }), lock: () => Promise.reject(err('sheet-taken')) }), e => e.code === 'sheet-taken');
  assert.equal((await IS.attemptDownload({ ...base, computeView: () => ({ error: 'x' }) })).kind, 'view-error');
  assert.equal((await IS.attemptDownload({ ...base, computeView: () => ({ note: 'mixed', total: 1 }) })).kind, 'note');
  assert.equal((await IS.attemptDownload({ ...base, computeView: () => ({ total: 1, sheetCount: 401 }) })).kind, 'too-big');
  assert.equal(saved + locked, 0);
});

test('linesCtx: a Weekly customer billed through a Saturday gets the Week ending wording; toDate / non-Saturday do not', () => {
  const base = { weekEndingDay: 6, qbItems: { cnc: 'x' }, laborTypes: [] };
  assert.equal(IS.linesCtx({ ...base, customerBilling: null, throughDate: '2026-10-10' }).weekEnding, '2026-10-10');
  assert.equal(IS.linesCtx({ ...base, customerBilling: { cadence: 'weekly' }, throughDate: '2026-10-10' }).weekEnding, '2026-10-10');
  assert.equal(IS.linesCtx({ ...base, customerBilling: { cadence: 'toDate' }, throughDate: '2026-10-10' }).weekEnding, null);
  assert.equal(IS.linesCtx({ ...base, customerBilling: null, throughDate: '2026-10-14' }).weekEnding, null);
  assert.equal(IS.linesCtx({ ...base, weekEndingDay: undefined, customerBilling: null, throughDate: '2026-10-10' }).weekEnding, null);
});
