/**
 * js/billing.js — Billing screen B (spec §7.4, Phase 2 Task 14): reminders for invoices still in
 * progress, jobs that need details, the "bill work cut through" box, and one card per customer
 * with ready / partly cut / waiting rows and a Bill button. Owners only (app.js shows the header
 * button only when Features.on('billing')).
 *
 * DISPLAY ONLY. No money math lives here: every figure comes from Pricing.priceInvoice() (the
 * Bill total) or BillingModel (rows). fmtMoney() only formats a number that is already computed.
 * Globals used at runtime: escHtml (app.js), Storage, OwnerStore, InvoiceStore, InvoiceLines,
 * Pricing, BillingModel; BillingDone / InvoiceScreen are optional (later tasks).
 */
const BillingScreen = (() => {
  let opts = {
    hideOthers() {}, onBack() {}, activeSheets: () => [], loadFinishedSheets: async () => [],
    noteKey: s => s, customerKey: s => s, compareSheets: () => 0, openJob() {}, currentEmail: () => '', openInvoice() {},
  };
  const NOT_LOADED = "Owner data didn't load — reload the page.";

  let els = null;
  let finished = null;          // finished sheets, loaded once per visit
  let loadState = 'idle';       // idle | loading | ok | error
  let loadError = '';
  let loadToken = 0;
  let through = null;           // 'YYYY-MM-DD' or null (= everything to date)
  let selection = {};           // { [customerKey]: { [jobKey]: { sheets: bool } } }
  let statusText = '';
  let statusIsError = false;
  let busy = false;             // an Imported OK / Cancel is running

  const byId = id => document.getElementById(id);
  const esc = s => escHtml(s == null ? '' : s);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Display formatting only: 1865 -> $1,865, 885.25 -> $885.25.
  function fmtMoney(n) {
    const [whole, frac] = Number(n).toFixed(2).split('.');
    return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === '00' ? '' : '.' + frac);
  }
  function localYmd(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function longDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  }
  function dayText(ms) {
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  }

  function init(options) {
    opts = { ...opts, ...options };
    els = {
      screen: byId('billing-screen'), status: byId('billing-status'), reminders: byId('billing-reminders'),
      needs: byId('billing-needs'), date: byId('billing-through-date'), caption: byId('billing-through-caption'),
      everything: byId('billing-everything-btn'), refresh: byId('billing-refresh-btn'),
      customers: byId('billing-customers'), recent: byId('billing-recent'),
    };
    byId('billing-back-btn').addEventListener('click', () => opts.onBack());
    els.date.addEventListener('change', () => { through = els.date.value || null; render(); });
    els.everything.addEventListener('click', () => { through = null; els.date.value = ''; render(); });
    els.refresh.addEventListener('click', () => loadFinished());
    els.screen.addEventListener('click', onClick);
  }

  function ownerDataOk() {
    return OwnerStore.loaded('jobBilling') && OwnerStore.loaded('sheetBilling') && OwnerStore.loaded('settings') && InvoiceStore.loaded();
  }

  function setStatus(text, isError) { statusText = text || ''; statusIsError = !!isError; paintStatus(); }
  function paintStatus() {
    if (!els) return;
    els.status.textContent = statusText;
    els.status.hidden = !statusText;
    els.status.classList.toggle('vanlab-status-error', statusIsError);
  }

  /* ── Loading ── */
  async function loadFinished() {
    const token = ++loadToken;
    loadState = 'loading'; loadError = '';
    render();
    try {
      const list = await opts.loadFinishedSheets();
      if (token !== loadToken) return;
      finished = Array.isArray(list) ? list : [];
      loadState = 'ok';
    } catch (e) {
      if (token !== loadToken) return;
      finished = null; loadState = 'error';
      loadError = (e && e.message) ? e.message : String(e || 'unknown error');
    }
    render();
  }

  // `o.status` (optional): a line to show on arrival, e.g. after the Invoice screen cancels an invoice.
  function show(o) {
    opts.hideOthers();
    els.screen.hidden = false;
    selection = {};
    setStatus('');
    const inv = OwnerStore.invoicing();
    try { through = BillingModel.defaultThroughDate(localYmd(new Date()), inv.weekEndingDay); }
    catch (e) { through = null; setStatus(`Week-ending day in Settings › Invoicing isn't valid (${e.message}); showing everything to date.`, true); }
    els.date.value = through || '';
    if (o && o.status) setStatus(o.status);
    loadFinished();
  }

  /* ── The model ── */
  // `throughDate` (optional) overrides the screen's own date: the Invoice screen rebuilds the model
  // for the date it was opened with, from the very same inputs this screen uses.
  function model(throughDate) {
    const through_ = throughDate === undefined ? through : throughDate;
    const inv = OwnerStore.invoicing();
    const active = opts.activeSheets() || [];
    const sheets = active.concat(finished || []);
    return BillingModel.build({
      sheets,
      completionOf: k => Storage.get(k),
      sheetBillingOf: k => OwnerStore.getSheetBilling(k),
      jobBillingOf: k => OwnerStore.getJobBilling(k),
      customerBillingOf: k => OwnerStore.getCustomerBilling(k),
      projectCustomerOf: jk => Storage.getProjectCustomer(jk),
      customerKeyOf: opts.customerKey, noteKey: opts.noteKey, compare: opts.compareSheets,
      laborTypes: OwnerStore.laborTypes(), throughDate: through_, billingStart: inv.billingStartDate || null,
      inProgressInvoices: InvoiceStore.inProgress(),
      priceListFor: ck => OwnerStore.priceListFor(ck),
      priceListNameOf: ck => { const cb = OwnerStore.getCustomerBilling(ck); return (cb && cb.priceList) || OwnerStore.pricing().defaultList; },
    });
  }

  const isOn = (customer, row) => {
    const sel = selection[customer.customerKey] && selection[customer.customerKey][row.jobKey];
    return sel && typeof sel.sheets === 'boolean' ? sel.sheets : row.defaultIncluded;
  };
  function resolvedSelection(customer) {
    const out = {};
    customer.rows.forEach(r => { out[r.jobKey] = { sheets: isOn(customer, r) }; });
    return out;
  }

  /* ── Rendering ── */
  function render() {
    if (!els || els.screen.hidden) return;
    paintStatus();
    renderCaption();
    if (loadState === 'idle' || loadState === 'loading') {
      els.reminders.innerHTML = ''; els.needs.innerHTML = ''; els.customers.innerHTML = '<p class="billing-note">Loading…</p>';
      return;
    }
    const dataOk = ownerDataOk();
    els.reminders.innerHTML = remindersHtml(dataOk);
    if (loadState === 'error') {
      els.needs.innerHTML = '';
      els.customers.innerHTML = `<p class="billing-note billing-note--error">${esc(`Couldn't load finished jobs — ${loadError}. Nothing is billable until this loads.`)}</p>`;
      return;
    }
    let m;
    try { m = model(); }
    catch (e) {
      els.needs.innerHTML = '';
      els.customers.innerHTML = `<p class="billing-note billing-note--error">${esc(`Couldn't work out what is billable — ${e.message}.`)}</p>`;
      return;
    }
    els.needs.innerHTML = needsHtml(m);
    els.customers.innerHTML = dataOk ? '' : `<p class="billing-note billing-note--error">${esc(NOT_LOADED)}</p>`;
    const ctxLabor = OwnerStore.laborTypes();
    els.customers.innerHTML += m.customers.length
      ? m.customers.map(c => customerHtml(c, ctxLabor, dataOk)).join('')
      : '<p class="billing-note">Nothing to bill right now.</p>';
  }

  function renderCaption() {
    if (!through) { els.caption.textContent = 'Everything cut so far.'; return; }
    const d = longDate(through);
    let weekEnd = false;
    try { weekEnd = BillingModel.defaultThroughDate(through, OwnerStore.invoicing().weekEndingDay) === through; } catch (e) { /* not a valid setting */ }
    els.caption.textContent = weekEnd
      ? `Week ending ${d}. Sheets cut after it wait for next week's bill.`
      : `Cut through ${d}. Sheets cut after it wait for the next bill.`;
  }

  function remindersHtml(dataOk) {
    return InvoiceStore.inProgress().map(inv => {
      const n = (inv.sheetKeys || []).length;
      const what = n ? plural(n, 'sheet', 'sheets') : 'labor only';
      const dis = (!dataOk || busy) ? ' disabled' : '';
      return `<div class="billing-reminder" data-number="${esc(inv.number)}">
        <div class="billing-reminder-text">Invoice ${esc(inv.number)} is still in progress · ${esc(inv.customerName || '')} · ${esc(what)} · downloaded ${esc(dayText(inv.downloadedAt))}. Did it import into QuickBooks?</div>
        <div class="billing-reminder-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="imported" data-number="${esc(inv.number)}"${dis}>Imported OK</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="cancel" data-number="${esc(inv.number)}"${dis}>Cancel ${esc(inv.number)}</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="download" data-number="${esc(inv.number)}"${dis}>Download again</button>
        </div>
      </div>`;
    }).join('');
  }

  function needsHtml(m) {
    const item = (n, text) => `<div class="billing-need"><span>${esc(n.jobName)} — ${esc(text)}</span>
      <button type="button" class="btn btn-outline btn-sm" data-act="open-job" data-job="${esc(n.jobName)}">Open job card</button></div>`;
    const a = m.needsDetails.map(n => item(n, `missing ${n.missing.join(', ')}`));
    const b = m.needsAttention.map(n => item(n, n.reason));
    if (!a.length && !b.length) return '';
    return `<section class="billing-needs">${a.length ? '<h3 class="billing-h">Needs job details</h3>' + a.join('') : ''}${b.length ? '<h3 class="billing-h">Needs attention</h3>' + b.join('') : ''}</section>`;
  }

  // The Bill button's state for one card: { total } | { note } | { none: true }
  function billState(customer, ctx) {
    if (customer.busyInvoice != null) return { note: `Finish invoice ${customer.busyInvoice} first (Imported OK or Cancel).` };
    const input = BillingModel.pricingInput(customer, selection[customer.customerKey], ctx);
    if (!Object.keys(input.jobs).length) return { none: true };
    let priced;
    try { priced = Pricing.priceInvoice(input); } catch (e) { return { error: e.message || String(e) }; }
    try { InvoiceLines.finalize(priced, { qbItems: OwnerStore.qbItems(), laborTypes: ctx.laborTypes }); }
    catch (e) { return e && e.code === 'mixed-taxable' ? { note: e.message } : { error: (e && e.message) || String(e) }; }
    return { total: priced.total };
  }

  function rowHtml(customer, row, ctx, dataOk) {
    const on = isOn(customer, row);
    const rp = BillingModel.rowPricing(row, ctx);
    const detail = BillingModel.rowDetail(row, rp.priced);
    const n = row.sheetKeys.length;
    let state, label;
    if (row.state === 'ready') { state = 'Ready'; label = on ? 'Remove' : 'Add'; }
    else if (row.state === 'labor-only') { state = 'Design / CAM hours only'; label = on ? 'Remove' : 'Add'; }
    else if (row.state === 'partly') { state = `${plural(n, 'cut sheet', 'cut sheets')}, ${row.uncutCount} still to cut`; label = on ? 'Remove them' : `Bill the ${plural(n, 'cut sheet', 'cut sheets')} anyway`; }
    else { state = 'Cut, but the job is not marked ready yet'; label = on ? 'Remove them' : `Add the ${plural(n, 'cut sheet', 'cut sheets')}`; }
    const later = row.laterCount ? ` · ${plural(row.laterCount, 'sheet', 'sheets')} cut later wait` : '';
    const amount = rp.error ? `<span class="billing-row-error">${esc(rp.error)}</span>` : `<span class="billing-row-amt">${esc(fmtMoney(rp.amount))}</span>`;
    return `<div class="billing-row billing-row--${esc(row.state)}${on ? '' : ' is-off'}">
      <div class="billing-row-main">
        <div><strong>${esc(row.jobName)}</strong> <span class="billing-row-state">${esc(state)}${esc(later)}</span></div>
        <div class="billing-row-detail">${esc(detail)}</div>
      </div>
      ${amount}
      <button type="button" class="btn btn-outline btn-sm" data-act="toggle" data-ck="${esc(customer.customerKey)}" data-jk="${esc(row.jobKey)}"${dataOk && !rp.error ? '' : ' disabled'}>${esc(label)}</button>
    </div>`;
  }

  function customerHtml(c, laborTypes, dataOk) {
    const empty = !c.rows.length;
    const ctx = { priceList: c.priceList, laborTypes };
    let action = '';
    if (!empty || c.busyInvoice != null) {
      let st;
      try { st = billState(c, ctx); } catch (e) { st = { error: e.message || String(e) }; }
      if (st.total != null) {
        action = `<button type="button" class="btn btn-primary" data-act="bill" data-ck="${esc(c.customerKey)}"${dataOk && !busy ? '' : ' disabled'}>Bill ${esc(c.customerName)} · ${esc(fmtMoney(st.total))}</button>`;
      } else if (st.note) action = `<span class="billing-card-note">${esc(st.note)}</span>`;
      else if (st.error) action = `<span class="billing-row-error">${esc(st.error)}</span>`;
    }
    let rows = '';
    if (!empty) {
      try { rows = c.rows.map(r => rowHtml(c, r, ctx, dataOk)).join(''); }
      catch (e) { rows = `<p class="billing-note billing-note--error">${esc(e.message || String(e))}</p>`; }
    }
    return `<section class="settings-card billing-card${empty ? ' billing-card--empty' : ''}">
      <div class="billing-card-head">
        <div><h2 class="settings-card-title">${esc(c.customerName)}</h2><p class="settings-card-hint billing-card-summary">${esc(c.summary)}</p></div>
        <div class="billing-card-action">${action}</div>
      </div>${rows}</section>`;
  }

  /* ── Actions ── */
  function onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'toggle') return toggle(b.dataset.ck, b.dataset.jk);
    if (act === 'bill') return bill(b.dataset.ck);
    if (act === 'open-job') return opts.openJob(b.dataset.job, finished || []);
    if (act === 'imported') return imported(Number(b.dataset.number));
    if (act === 'cancel') return cancelInvoice(Number(b.dataset.number));
    if (act === 'download') return downloadAgain(Number(b.dataset.number));
  }

  function toggle(ck, jk) {
    let m;
    try { m = model(); } catch (e) { return; }
    const c = m.customers.find(x => x.customerKey === ck);
    const row = c && c.rows.find(r => r.jobKey === jk);
    if (!row) return;
    selection[ck] = { ...(selection[ck] || {}), [jk]: { sheets: !isOn(c, row) } };
    render();
  }

  function bill(ck) {
    if (!ownerDataOk()) { setStatus(NOT_LOADED, true); return; }
    let m;
    try { m = model(); } catch (e) { setStatus(e.message, true); return; }
    const c = m.customers.find(x => x.customerKey === ck);
    if (!c) return;
    setStatus('');
    opts.openInvoice({ customerKey: ck, selection: resolvedSelection(c), throughDate: through });
  }

  async function imported(number) {
    if (busy || !ownerDataOk()) return;
    busy = true; render();
    try {
      await InvoiceStore.markImported(number, opts.currentEmail());
      busy = false;
      if (typeof BillingDone !== 'undefined') { BillingDone.show(number); return; }
      setStatus(`Invoice ${number} is marked imported.`);
    } catch (e) {
      setStatus(`Couldn't mark invoice ${number} imported — ${(e && e.message) || e}`, true);
    }
    busy = false; render();
  }

  async function cancelInvoice(number) {
    if (busy || !ownerDataOk()) return;
    if (!window.confirm(`Cancel invoice ${number}? Its sheets go back to ready to bill.`)) return;
    busy = true; render();
    try {
      await InvoiceStore.cancel(number, opts.currentEmail());
      setStatus(`Invoice ${number} cancelled — its sheets are ready to bill again.`);
    } catch (e) {
      setStatus(`Couldn't cancel invoice ${number} — ${(e && e.message) || e}`, true);
    }
    busy = false; render();
  }

  function downloadAgain(number) {
    const inv = InvoiceStore.get(number);
    if (!inv || typeof inv.csv !== 'string') { setStatus(`Invoice ${number} has no saved CSV to download.`, true); return; }
    const url = URL.createObjectURL(new Blob([InvoiceLines.BOM + inv.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = InvoiceLines.downloadName(inv.customerName || '', inv.number);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  // An active job that left the board (exported) must stay billable: reload the finished list.
  function boardChanged() {
    if (!els || els.screen.hidden) return;
    if (loadState === 'ok') loadFinished(); else render();
  }

  return { init, show, render, fmtMoney, boardChanged, buildModel: model };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BillingScreen;
