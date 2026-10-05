/**
 * js/invoice-screen.js — the Invoice screen (spec §7.5, Phase 2 Task 15): check the invoice number,
 * lock-THEN-download the QuickBooks file, then Imported OK / Cancel. Owners only; opened by Billing
 * (InvoiceScreen.show({ customerKey, selection, throughDate })) or for an existing in-progress
 * invoice (InvoiceScreen.show({ number })).
 *
 * THE rule: the file is served only AFTER `InvoiceStore.lockAndCreate` resolved. lockThenSave() is
 * the only path to saveCsv() for a new invoice, and saveCsv() (the Blob and the anchor) is never
 * reached when the lock rejects.
 *
 * DISPLAY ONLY. Money comes from Pricing.priceInvoice() (via BillingModel); this file only formats
 * numbers that are already computed and compares totals.
 * Globals at runtime: escHtml (app.js), hideAllScreens / currentUserEmail (app.js), OwnerStore,
 * InvoiceStore, InvoiceLines, Pricing, BillingModel, BillingScreen; BillingDone is optional (Task 16).
 */
const InvoiceScreen = (() => {
  const NOT_LOADED = "Owner data didn't load — reload the page.";
  const MAX_SHEETS = 400;
  const TOO_BIG = "That's more than 400 sheets — bill it in two parts (use the cut-through date).";
  const CHANGED_TEXT = 'Something changed since this screen was drawn — the total has been refreshed; check it and click again.';
  const TAKEN_TEXT = 'Another owner just billed some of these. Back to Billing.';
  const TERMS = [['receipt', 'Due upon receipt'], ['net15', 'Net 15'], ['net30', 'Net 30']];

  const esc = s => (typeof escHtml === 'function' ? escHtml(s == null ? '' : s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ── Pure helpers (exported for tests) ── */

  // Display formatting only: 1865 -> $1,865, 885.25 -> $885.25, -0.88 -> −$0.88.
  function fmtMoney(n) {
    const v = Number(n);
    const [whole, frac] = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '−' : '') + '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === '00' ? '' : '.' + frac);
  }
  function localYmd(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function realYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  }
  function shortDate(inv) {
    const v = inv && (inv.invoiceDate || inv.createdAt);
    let d = null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) d = new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10));
    else if (v != null) d = new Date(v);
    return (!d || Number.isNaN(d.getTime())) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // The due date for a pick. { ok, dueDate, message }
  function dueState({ term, customYmd, invoiceYmd }) {
    if (term === 'custom') {
      if (!customYmd) return { ok: false, dueDate: null, message: 'Pick a due date, or choose Due upon receipt, Net 15 or Net 30.' };
      if (!realYmd(customYmd)) return { ok: false, dueDate: null, message: "That due date isn't a real date." };
      return { ok: true, dueDate: customYmd, message: '' };
    }
    if (!(term in InvoiceLines.DUE_TERMS)) return { ok: false, dueDate: null, message: 'Choose when the invoice is due.' };
    return { ok: true, dueDate: InvoiceLines.dueDateFor(invoiceYmd, term, null), message: '' };
  }

  // What step 1 says about the number. check = { forText, state, invoice? } | null
  function numberMessage(check, text) {
    const t = String(text == null ? '' : text).trim();
    if (!check || check.forText !== t) return { kind: 'info', text: t ? 'Checking…' : '' };
    switch (check.state) {
      case 'free': return { kind: 'ok', text: '' };
      case 'used': return { kind: 'error', text: check.message || `${t} is already on ${(check.invoice && check.invoice.customerName) || 'another customer'}${check.invoice && shortDate(check.invoice) ? ` (${shortDate(check.invoice)})` : ''}. Use another number.` };
      case 'cancelled': return { kind: 'note', text: `${t} was cancelled earlier — you can use it again.` };
      case 'invalid': return { kind: 'error', text: 'Type a whole number.' };
      default: return { kind: 'error', text: "Couldn't check this number — check your connection." };
    }
  }

  // Can Download be clicked, and if not, why (a plain line; '' = nothing to say).
  function readiness({ ownerOk, check, numberText, due, view, busy }) {
    if (!ownerOk) return { enabled: false, reason: NOT_LOADED };
    if (!view || view.error || view.note) return { enabled: false, reason: '' };
    if (view.sheetCount > MAX_SHEETS) return { enabled: false, reason: '' };
    const t = String(numberText == null ? '' : numberText).trim();
    if (!check || check.forText !== t) return { enabled: false, reason: t ? 'Checking the number…' : 'Type the invoice number first.' };
    if (check.state !== 'free' && check.state !== 'cancelled') return { enabled: false, reason: '' };   // step 1 already says why
    if (!due.ok) return { enabled: false, reason: due.message };
    return { enabled: !busy, reason: '' };
  }

  // A refusal from lockAndCreate -> what to show.
  function refusalInfo(e) {
    const code = e && e.code;
    const msg = (e && e.message) || String(e || 'unknown error');
    if (code === 'number-used') return { kind: 'number', text: msg };
    if (code === 'sheet-taken' || code === 'customer-busy') return { kind: 'taken', text: TAKEN_TEXT, back: true };
    if (code === 'changed') return { kind: 'changed', text: CHANGED_TEXT };
    if (code === 'mixed-taxable') return { kind: 'mixed', text: msg };
    return { kind: 'other', text: `Couldn't lock the sheets — ${msg}. Nothing was downloaded.` };
  }

  // THE ORDER. The lock first; the file only if the lock resolved. A rejection propagates and `save`
  // is never called, so no Blob and no anchor exist. A failure of `save` itself comes back as saveError
  // (the sheets ARE locked by then — the screen says so and offers Download again).
  async function lockThenSave(draft, by, deps) {
    const invoice = await deps.lock(draft, by);
    let saveError = null;
    try { deps.save(draft); } catch (e) { saveError = e; }
    return { invoice, saveError };
  }

  function saveCsv(csv, customerName, number) {
    const url = URL.createObjectURL(new Blob([InvoiceLines.BOM + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = InvoiceLines.downloadName(customerName || '', number);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── State ── */
  let els = null;
  let st = null;        // null until show()
  let checkToken = 0;
  let checkTimer = null;

  const byId = id => document.getElementById(id);
  const ownerOk = () => OwnerStore.loaded('jobBilling') && OwnerStore.loaded('sheetBilling') && OwnerStore.loaded('settings') && InvoiceStore.loaded();
  const by = () => (typeof currentUserEmail === 'function' ? currentUserEmail() : '');

  function bind() {
    if (els) return;
    els = {
      screen: byId('invoice-screen'), status: byId('invoice-status'), sub: byId('invoice-header-sub'),
      left: byId('invoice-left'), number: byId('invoice-number'), caption: byId('invoice-number-caption'),
      check: byId('invoice-number-check'), po: byId('invoice-po'), date: byId('invoice-date'),
      picks: byId('invoice-due-picks'), due: byId('invoice-due-date'), dueMsg: byId('invoice-due-msg'),
      step2: byId('invoice-step2'), step3: byId('invoice-step3'),
    };
    byId('invoice-back-btn').addEventListener('click', backToBilling);
    els.number.addEventListener('input', () => {
      if (!st || st.locked) return;
      st.numberText = els.number.value.trim();
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => runCheck(st.numberText), 300);
      paint();
    });
    els.po.addEventListener('input', () => { if (st && !st.locked) st.po = els.po.value; });
    els.picks.addEventListener('click', e => {
      const b = e.target.closest('button[data-term]');
      if (!b || b.disabled || !st || st.locked) return;
      st.term = b.dataset.term; paint();
    });
    els.due.addEventListener('input', () => {
      if (!st || st.locked) return;
      st.term = 'custom'; st.customYmd = els.due.value; paint();
    });
    els.screen.addEventListener('click', onClick);
  }

  function openNew(d) {
    const inv = OwnerStore.invoicing();
    const defaultDue = inv && inv.defaultDue in InvoiceLines.DUE_TERMS ? inv.defaultDue : 'receipt';
    const suggested = InvoiceStore.suggestNumber();
    st = {
      mode: 'new', customerKey: d.customerKey, selection: d.selection || {}, throughDate: d.throughDate || null,
      numberText: String(suggested), suggested, po: '', term: defaultDue, customYmd: '',
      invoiceDate: localYmd(new Date()), check: null, locked: false, number: null, busy: false,
      msg: null, shownTotal: null, view: null,
    };
  }
  function openExisting(number) {
    const inv = InvoiceStore.get(number);
    st = {
      mode: 'existing', customerKey: inv && inv.customerKey, selection: {}, throughDate: null,
      numberText: String(number), suggested: null, po: (inv && inv.poNumber) || '', term: (inv && inv.dueTerm) || 'receipt',
      customYmd: (inv && inv.dueDate) || '', invoiceDate: (inv && inv.invoiceDate) || localYmd(new Date()),
      check: null, locked: true, number: Number(number), busy: false, msg: null, shownTotal: null, view: null,
    };
  }

  function show(d) {
    bind();
    if (typeof hideAllScreens === 'function') hideAllScreens();
    els.screen.hidden = false;
    clearTimeout(checkTimer);
    checkToken++;
    if (d && d.number != null) openExisting(d.number); else openNew(d || {});
    els.number.value = st.numberText;
    els.po.value = st.po;
    els.due.value = '';
    paint();
    if (st.mode === 'new') runCheck(st.numberText);
  }

  function backToBilling(status) {
    clearTimeout(checkTimer);
    checkToken++;
    if (typeof BillingScreen !== 'undefined') BillingScreen.show(typeof status === 'string' ? { status } : undefined);
  }

  /* ── The view (what the invoice is) ── */
  function fromInvoice(inv, number) {
    if (!inv) return { error: `Invoice ${number} wasn't found.` };
    return {
      customerName: inv.customerName || '', breakdown: inv.breakdown || [], total: inv.total, lines: inv.lines || [],
      sheetCount: (inv.sheetKeys || []).length, status: inv.status, stored: inv,
    };
  }

  // Rebuild the model from the current caches, exactly as Billing does, and price it.
  function computeView() {
    if (st.locked) return fromInvoice(InvoiceStore.get(st.number), st.number);
    let m;
    try { m = BillingScreen.buildModel(st.throughDate); }
    catch (e) { return { error: `Couldn't work out what is billable — ${e.message}.` }; }
    const customer = m.customers.find(c => c.customerKey === st.customerKey);
    if (!customer || !customer.rows.length) return { error: 'There is nothing to bill for this customer any more.' };
    if (customer.busyInvoice != null) return { error: `Finish invoice ${customer.busyInvoice} first (Imported OK or Cancel).` };
    const laborTypes = OwnerStore.laborTypes();
    const ctx = { priceList: customer.priceList, laborTypes };
    let priced;
    try { priced = Pricing.priceInvoice(BillingModel.pricingInput(customer, st.selection, ctx)); }
    catch (e) { return { error: e.message || String(e) }; }
    const base = { customer, ctx, priced, customerName: customer.customerName, breakdown: priced.breakdown, total: priced.total, sheetCount: Object.keys(priced.perSheet || {}).length };
    if (base.sheetCount > MAX_SHEETS) return { ...base, lines: [] };
    try { base.lines = InvoiceLines.finalize(priced, { qbItems: OwnerStore.qbItems(), laborTypes }); }
    catch (e) {
      if (e && e.code === 'mixed-taxable') return { ...base, lines: [], note: e.message };
      return { error: (e && e.message) || String(e) };
    }
    return base;
  }

  function buildDraft(view, due, number) {
    const csv = InvoiceLines.buildQuickBooksCsv({ number, customerName: view.customerName, invoiceDate: st.invoiceDate, dueDate: due.dueDate, lines: view.lines });
    return BillingModel.buildDraft({
      customer: view.customer, selection: st.selection, priced: view.priced, lines: view.lines, number,
      invoiceDate: st.invoiceDate, dueDate: due.dueDate, dueTerm: st.term, poNumber: (st.po || '').trim(),
      throughDate: st.throughDate, settings: { priceList: view.customer.priceList, laborTypes: view.ctx.laborTypes, qbItems: OwnerStore.qbItems() }, csv,
    });
  }

  /* ── Checking the number ── */
  async function runCheck(text) {
    const mine = ++checkToken;
    let res;
    try { res = await InvoiceStore.checkNumber(text); }
    catch (e) { res = { state: 'unknown' }; }
    if (mine !== checkToken || !st || st.locked || st.numberText !== text) return;
    st.check = { forText: text, state: res.state, invoice: res.invoice };
    paint();
  }

  /* ── Painting (never touches what the owner typed) ── */
  function dueNow() { return dueState({ term: st.term, customYmd: st.customYmd, invoiceYmd: st.invoiceDate }); }

  function paint() {
    if (!els || !st) return;
    const view = computeView();
    st.view = view;
    st.shownTotal = view.error ? null : view.total;
    const due = st.locked && st.mode === 'existing' ? { ok: true, dueDate: st.customYmd || null, message: '' } : dueNow();

    // status line
    els.status.textContent = st.msg ? st.msg.text : '';
    els.status.hidden = !(st.msg && st.msg.text);
    els.status.classList.toggle('vanlab-status-error', !!(st.msg && st.msg.kind !== 'ok'));
    els.sub.textContent = view.customerName ? `${view.customerName}${st.locked ? ` · Invoice ${st.number}` : ''}` : '';

    // left panel
    els.left.innerHTML = leftHtml(view);

    // step 1 (fields are persistent; only state is mirrored)
    els.number.disabled = st.locked || st.busy;
    els.po.disabled = st.locked && st.mode === 'existing';
    els.date.textContent = longDate(st.invoiceDate);
    els.caption.textContent = st.suggested != null && !st.locked
      ? `Suggested ${st.suggested} — the last number used here was ${st.suggested - 1}. Check it's the next number in QuickBooks (VanLab invoices use the same numbers).`
      : '';
    const nm = st.locked ? { kind: 'ok', text: '' } : numberMessage(st.check, st.numberText);
    els.check.textContent = nm.text;
    els.check.className = 'invoice-check invoice-check--' + nm.kind;
    els.picks.querySelectorAll('button[data-term]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.term === st.term);
      b.disabled = st.locked;
    });
    els.due.disabled = st.locked;
    if (st.term !== 'custom') els.due.value = due.dueDate || '';
    else if (st.locked && els.due.value !== st.customYmd) els.due.value = st.customYmd;
    els.dueMsg.textContent = st.locked ? '' : due.message;

    const ready = readiness({ ownerOk: ownerOk(), check: st.check, numberText: st.numberText, due, view, busy: st.busy });
    els.step2.innerHTML = step2Html(view, ready);
    els.step3.innerHTML = step3Html(view);
  }
  const render = () => { if (els && !els.screen.hidden) paint(); };

  function longDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function leftHtml(view) {
    if (view.error) return `<p class="billing-note billing-note--error">${esc(view.error)}</p>`;
    const rows = (view.breakdown || []).map(r => `<div class="invoice-row"><span>${esc(r.label)}</span><span class="invoice-amt">${esc(fmtMoney(r.amount))}</span></div>`).join('');
    const sub = view.sheetCount ? plural(view.sheetCount, 'sheet', 'sheets') : 'labor only';
    return `<p class="settings-card-hint invoice-sub">${esc(view.customerName)} · ${esc(sub)}</p>${rows}
      <div class="invoice-row invoice-row--total"><span>Total</span><span class="invoice-amt" id="invoice-total">${esc(fmtMoney(view.total))}</span></div>`;
  }

  function step2Html(view, ready) {
    const head = '<h2 class="settings-card-title"><span class="invoice-step-n">2</span> Download the QuickBooks file</h2>';
    if (view.error) return `${head}<p class="billing-card-note">${esc(view.error)}</p><button type="button" class="btn btn-outline btn-sm" data-act="back">Back to Billing</button>`;
    if (view.sheetCount > MAX_SHEETS) return `${head}<p class="billing-row-error">${esc(TOO_BIG)}</p>`;
    if (view.note) return `${head}<p class="billing-card-note">${esc(view.note)}</p>`;
    const preview = (view.lines || []).map(l => `<div class="invoice-preview-line"><span>${esc(l.description)}</span><span class="invoice-amt">${esc(fmtMoney(l.amount))}</span></div>`).join('');
    const n = st.locked ? st.number : String(st.numberText || '').trim();
    const sheets = view.sheetCount ? plural(view.sheetCount, 'sheet', 'sheets') : 'labor lines';
    if (st.locked) {
      return `${head}<div class="invoice-preview">${preview}</div>
        <button type="button" class="btn btn-outline" data-act="again"${st.busy ? ' disabled' : ''}>Download again</button>
        <p class="settings-card-hint">Invoice ${esc(n)} is locked — ${esc(sheets)}, in progress, so nothing else can bill them. In QuickBooks: Sales › Invoices › Import, pick this file.</p>`;
    }
    const label = n ? `Download QuickBooks file for #${esc(n)}` : 'Download QuickBooks file';
    const back = st.msg && st.msg.back ? '<button type="button" class="btn btn-outline btn-sm" data-act="back">Back to Billing</button>' : '';
    return `${head}<div class="invoice-preview">${preview}</div>
      <button type="button" class="btn btn-primary" id="invoice-download-btn" data-act="download"${ready.enabled ? '' : ' disabled'}>${label}</button>
      ${ready.reason ? `<p class="invoice-reason">${esc(ready.reason)}</p>` : ''}
      <p class="settings-card-hint">The file already has ${esc(n || 'the number')} in it. The moment you download, these ${esc(sheets)} lock as Invoice ${esc(n || 'N')} — in progress, so nothing else can bill them. Then in QuickBooks: Sales › Invoices › Import, pick this file.</p>${back}`;
  }

  function step3Html(view) {
    const head = '<h2 class="settings-card-title"><span class="invoice-step-n">3</span> Did it import into QuickBooks?</h2>';
    const open = st.locked && ownerOk() && !st.busy && !view.error;
    const dis = open ? '' : ' disabled';
    const n = st.number;
    const what = view.sheetCount ? `mark ${plural(view.sheetCount, 'sheet', 'sheets')} billed` : 'mark the invoice billed';
    if (!st.locked) return `${head}<p class="settings-card-hint">Available once the file has been downloaded.</p>
      <div class="invoice-step3-actions"><button type="button" class="btn btn-primary" disabled>Imported OK — ${esc(what)}</button></div>`;
    return `${head}<div class="invoice-step3-actions">
      <button type="button" class="btn btn-primary" id="invoice-imported-btn" data-act="imported"${dis}>Imported OK — ${esc(what)}</button>
      <button type="button" class="btn btn-outline" id="invoice-cancel-btn" data-act="cancel"${dis}>Cancel ${esc(n)}</button></div>
      ${ownerOk() ? '' : `<p class="invoice-reason">${esc(NOT_LOADED)}</p>`}`;
  }

  /* ── Actions ── */
  function onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled || !st) return;
    const act = b.dataset.act;
    if (act === 'download') return onDownload();
    if (act === 'again') return downloadAgain();
    if (act === 'imported') return onImported();
    if (act === 'cancel') return onCancel();
    if (act === 'back') return backToBilling();
  }

  function setMsg(text, kind, extra) { st.msg = text ? { text, kind: kind || 'error', ...(extra || {}) } : null; }

  async function onDownload() {
    if (st.busy || st.locked) return;
    const due = dueNow();
    const gate = readiness({ ownerOk: ownerOk(), check: st.check, numberText: st.numberText, due, view: st.view, busy: st.busy });
    if (!gate.enabled) return;
    st.busy = true; setMsg(''); paint();
    try {
      // 1. rebuild from the current caches and compare with what is on screen
      const view = computeView();
      if (view.error) { setMsg(view.error, 'error', { back: true }); return; }
      if (view.note) { setMsg(view.note, 'error'); return; }
      if (view.sheetCount > MAX_SHEETS) { setMsg(TOO_BIG, 'error'); return; }
      if (view.total !== st.shownTotal) { setMsg(CHANGED_TEXT, 'error'); return; }   // finally{} repaints with the new total
      const number = Number(st.numberText);
      const draft = buildDraft(view, due, number);
      // 2 + 3. lock, and only then the file
      const res = await lockThenSave(draft, by(), {
        lock: (d, b) => InvoiceStore.lockAndCreate(d, b),
        save: d => saveCsv(d.csv, d.customerName, d.number),
      });
      st.locked = true; st.number = number;
      st.msg = res.saveError
        ? { text: `Invoice ${number} is locked, but the file couldn't be saved (${(res.saveError && res.saveError.message) || res.saveError}). Use Download again.`, kind: 'error' }
        : null;
    } catch (e) {
      // 4. rejected (or thrown before the lock): nothing was created, nothing downloaded
      const info = refusalInfo(e);
      setMsg(info.text, 'error', info.back ? { back: true } : undefined);
      if (info.kind === 'number') st.check = { forText: st.numberText, state: 'used', message: info.text };
    } finally {
      st.busy = false; paint();
      if (st.check && st.check.state === 'used' && !st.locked) { try { els.number.focus(); } catch (e) { /* ignore */ } }
    }
  }

  function downloadAgain() {
    const inv = InvoiceStore.get(st.number);
    if (!inv || typeof inv.csv !== 'string') { setMsg(`Invoice ${st.number} has no saved CSV to download.`); paint(); return; }
    saveCsv(inv.csv, inv.customerName, inv.number);
  }

  async function onImported() {
    if (st.busy || !st.locked || !ownerOk()) return;
    const n = st.number;
    st.busy = true; setMsg(''); paint();
    try {
      await InvoiceStore.markImported(n, by());
      st.busy = false;
      if (typeof BillingDone !== 'undefined') { BillingDone.show(n); return; }
      backToBilling(`Invoice ${n} is marked imported.`);
      return;
    } catch (e) {
      setMsg(`Couldn't mark invoice ${n} imported — ${(e && e.message) || e}`, 'error');
    }
    st.busy = false; paint();
  }

  async function onCancel() {
    if (st.busy || !st.locked || !ownerOk()) return;
    const n = st.number;
    if (!window.confirm(`Cancel invoice ${n}? Its sheets go back to ready to bill.`)) return;
    st.busy = true; setMsg(''); paint();
    try {
      await InvoiceStore.cancel(n, by());
      st.busy = false;
      backToBilling(`Invoice ${n} cancelled — its sheets are ready to bill again.`);
      return;
    } catch (e) {
      setMsg(`Couldn't cancel invoice ${n} — ${(e && e.message) || e}`, 'error');
    }
    st.busy = false; paint();
  }

  return { show, render, fmtMoney, dueState, numberMessage, readiness, refusalInfo, lockThenSave, saveCsv, MAX_SHEETS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InvoiceScreen;
