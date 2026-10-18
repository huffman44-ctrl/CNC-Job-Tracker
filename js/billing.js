/**
 * js/billing.js — Billing screen B (spec §7.4, Phase 2 Task 14): reminders for invoices still in
 * progress, jobs that need details, the "bill work cut through" box, and one card per customer
 * with ready / partly cut / design-hours-only rows (every row included by default; job names open
 * the job card), a Bill button, Recent jobs, Recent invoices. Owners only (app.js shows the header
 * button only when Features.on('billing')).
 *
 * DISPLAY ONLY. No money math lives here: every figure comes from Pricing.priceInvoice() (the
 * Bill total) or BillingModel (rows). fmtMoney() only formats a number that is already computed.
 * Globals used at runtime: escHtml (app.js), Storage, OwnerStore, InvoiceStore, InvoiceLines,
 * Pricing, BillingModel, Keys; BillingDone / InvoiceScreen are optional (later tasks).
 */
const BillingScreen = (() => {
  const K = typeof Keys !== 'undefined' ? Keys : require('./keys.js');
  let opts = {
    hideOthers() {}, onBack() {}, activeSheets: () => [], loadFinishedSheets: async () => [],
    compareSheets: () => 0, openJob() {}, currentEmail: () => '', openInvoice() {},
  };
  const NOT_LOADED = "Owner data didn't load — reload the page.";

  let els = null;
  let finished = null;          // finished sheets, loaded once per visit
  let loadState = 'idle';       // idle | loading | ok | error
  let loadError = '';
  let loadToken = 0;
  let boardKeys = null;         // the board's fileKeys at the last change (see boardChanged)
  let reloadAgain = false;      // a sheet left/returned to the board while a load was running
  // null = rhythm mode (the default): a Weekly customer is billed a finished week at a time, an Everything-to-date
  // customer through today. 'YYYY-MM-DD' or 'all' = hand mode ("Pick a date yourself"): one date for every customer.
  let handDate = null;
  let selection = {};           // hand mode / Everything-to-date cards: { [customerKey]: { [jobKey]: { sheets: bool } } }
  let weekSelection = {};       // Weekly cards: { [customerKey]: { [weekEnding]: { [jobKey]: { sheets: bool } } } } - a job in two weeks never shares a choice
  let statusText = '';
  let statusIsError = false;
  let busy = false;             // an Imported OK / Cancel is running
  let poEdit = null;            // { number, text } while a Recent-invoices PO box is open
  const recentBusy = new Set(); // invoice numbers with an Add PO / Retry in flight

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
      pick: byId('billing-pick-btn'), weekly: byId('billing-weekly-btn'), throughTitle: byId('billing-through-title'),
      customers: byId('billing-customers'), recentJobs: byId('billing-recent-jobs'), recent: byId('billing-recent'),
    };
    byId('billing-back-btn').addEventListener('click', () => opts.onBack());
    els.date.addEventListener('change', () => { handDate = els.date.value || 'all'; render(); });
    els.everything.addEventListener('click', () => { handDate = 'all'; els.date.value = ''; render(); });
    els.pick.addEventListener('click', () => {
      handDate = pickPrefill() || 'all';
      selection = {}; weekSelection = {};
      els.date.value = handDate === 'all' ? '' : handDate;
      render();
    });
    els.weekly.addEventListener('click', () => { handDate = null; selection = {}; weekSelection = {}; render(); });
    els.refresh.addEventListener('click', () => loadFinished());
    els.screen.addEventListener('click', onClick);
    els.recent.addEventListener('input', e => { if (poEdit && e.target.matches('input[data-po]')) poEdit.text = e.target.value; });
    els.recent.addEventListener('keydown', e => {
      if (!poEdit || !e.target.matches('input[data-po]')) return;
      if (e.key === 'Enter') { e.preventDefault(); savePo(poEdit.number); }
      else if (e.key === 'Escape') { poEdit = null; render(); }
    });
  }

  // The last FINISHED week-ending day (a week is finished once its last day is before today). Throws when
  // Settings > Invoicing > week-ending day isn't usable.
  function lastWeekEnd() { return BillingModel.lastFinishedWeekEnd(localYmd(new Date()), OwnerStore.invoicing().weekEndingDay); }
  function pickPrefill() { try { return lastWeekEnd(); } catch (e) { return null; } }

  function ownerDataOk() {
    return OwnerStore.loaded('jobBilling') && OwnerStore.loaded('sheetBilling') && OwnerStore.loaded('customerBilling') && OwnerStore.loaded('settings') && InvoiceStore.loaded();
  }

  function setStatus(text, isError) { statusText = text || ''; statusIsError = !!isError; paintStatus(); }
  function paintStatus() {
    if (!els) return;
    els.status.textContent = statusText;
    els.status.hidden = !statusText;
    els.status.classList.toggle('vanlab-status-error', statusIsError);
  }

  /* ── Loading ── */
  // `quiet`: a background refresh keeps the current list on screen until the new one arrives.
  // A failed quiet refresh keeps the list it had (never a shorter one the Invoice screen could bill
  // from) and says so. A board change during a load asks for one more quiet load when it settles.
  async function loadFinished(quiet) {
    const token = ++loadToken;
    const wasQuiet = quiet && loadState === 'ok';
    if (!wasQuiet) { loadState = 'loading'; loadError = ''; render(); }
    try {
      const list = await opts.loadFinishedSheets();
      if (token !== loadToken) return;
      finished = Array.isArray(list) ? list : [];
      loadState = 'ok';
    } catch (e) {
      if (token !== loadToken) return;
      const msg = (e && e.message) ? e.message : String(e || 'unknown error');
      if (wasQuiet) { setStatus(`Couldn't refresh finished jobs (${msg}). Click Refresh before billing.`, true); reloadAgain = false; }
      else { finished = null; loadState = 'error'; loadError = msg; }
    }
    if (reloadAgain && loadState === 'ok') { reloadAgain = false; loadFinished(true); return; }
    reloadAgain = false;
    render();
    if (opts.onFinishedLoaded) opts.onFinishedLoaded();   // the Invoice screen prices from this list too
  }

  // `o.status` (optional): a line to show on arrival, e.g. after the Invoice screen cancels an invoice.
  // `o.resume`: coming back from a job card opened here — keep the date and the choices, no reload
  // when the finished list is already in hand: render it now, then quietly reload it (a job exported while the card was open).
  function show(o) {
    opts.hideOthers();
    els.screen.hidden = false;
    if (o && o.resume && loadState === 'ok') { boardKeys = activeKeys(); render(); loadFinished(true); return; }
    selection = {}; weekSelection = {};
    setStatus('');
    handDate = null;   // every fresh visit starts in rhythm mode
    els.date.value = '';
    try { lastWeekEnd(); }
    catch (e) { handDate = 'all'; setStatus(`Week-ending day in Settings › Invoicing isn't valid (${e.message}); showing everything to date.`, true); }
    if (o && o.status) setStatus(o.status);
    boardKeys = activeKeys();
    loadFinished();
  }

  /* ── The model ── */
  // `throughDate` (optional) overrides the screen's own date: the Invoice screen rebuilds the model
  // for the date it was opened with, from the very same inputs this screen uses.
  // Rhythm mode (no explicit date, no hand date): a Weekly customer gets the last finished week-ending day, an
  // Everything-to-date customer gets null (everything cut). Hand mode / an explicit date: one date for everyone.
  function model(throughDate) {
    let through_, throughDateOf;
    if (throughDate !== undefined) through_ = throughDate;
    else if (handDate !== null) through_ = handDate === 'all' ? null : handDate;
    else {
      const lw = lastWeekEnd();
      through_ = lw;
      throughDateOf = ck => (BillingModel.cadenceOf(OwnerStore.getCustomerBilling(ck)) === 'toDate' ? null : lw);
    }
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
      customerKeyOf: K.customer, jobKeyOf: K.job, compare: opts.compareSheets,
      laborTypes: OwnerStore.laborTypes(), throughDate: through_, throughDateOf, billingStart: inv.billingStartDate || null,
      inProgressInvoices: InvoiceStore.inProgress(),
      priceListFor: ck => OwnerStore.priceListFor(ck),
      priceListNameOf: ck => { const cb = OwnerStore.getCustomerBilling(ck); return (cb && cb.priceList) || OwnerStore.pricing().defaultList; },
    });
  }

  // The choices for one list of rows: a customer's whole card (we == null) or one week section of a Weekly card.
  const selOf = (ck, we) => (we ? (weekSelection[ck] || {})[we] : selection[ck]) || {};
  const isOnIn = (sel, row) => {
    const s = sel && sel[row.jobKey];
    return s && typeof s.sheets === 'boolean' ? s.sheets : row.defaultIncluded;
  };
  function resolvedSelection(rows, sel) {
    const out = {};
    rows.forEach(r => { out[r.jobKey] = { sheets: isOnIn(sel, r) }; });
    return out;
  }
  const isYmd = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rhythmMode = () => handDate === null;
  const isWeekly = ck => BillingModel.cadenceOf(OwnerStore.getCustomerBilling(ck)) === 'weekly';
  function weekSectionsOf(c, laborTypes) {
    return BillingModel.weekSections(c, { weekEndingDay: OwnerStore.invoicing().weekEndingDay, priceList: c.priceList, laborTypes });
  }

  /* ── Rendering ── */
  function render() {
    if (!els || els.screen.hidden) return;
    paintStatus();
    renderCaption();
    if (loadState === 'idle' || loadState === 'loading') {
      els.reminders.innerHTML = ''; els.needs.innerHTML = ''; els.recentJobs.innerHTML = ''; els.customers.innerHTML = '<p class="billing-note">Loading…</p>';
      return;
    }
    const dataOk = ownerDataOk();
    els.reminders.innerHTML = remindersHtml(dataOk);
    renderRecent(dataOk);
    if (loadState === 'error') {
      els.needs.innerHTML = ''; els.recentJobs.innerHTML = '';
      els.customers.innerHTML = `<p class="billing-note billing-note--error">${esc(`Couldn't load finished jobs — ${loadError}. Nothing is billable until this loads.`)}</p>`;
      return;
    }
    let m;
    try { m = model(); }
    catch (e) {
      els.needs.innerHTML = ''; els.recentJobs.innerHTML = '';
      els.customers.innerHTML = `<p class="billing-note billing-note--error">${esc(`Couldn't work out what is billable — ${e.message}.`)}</p>`;
      return;
    }
    els.needs.innerHTML = needsHtml(m);
    els.customers.innerHTML = dataOk ? '' : `<p class="billing-note billing-note--error">${esc(NOT_LOADED)}</p>`;
    const ctxLabor = OwnerStore.laborTypes();
    els.customers.innerHTML += m.customers.length
      ? m.customers.map(c => customerHtml(c, ctxLabor, dataOk)).join('')
      : '<p class="billing-note">Nothing to bill right now.</p>';
    els.recentJobs.innerHTML = recentJobsHtml(BillingModel.recentJobs({
      finishedSheets: finished || [], activeSheets: opts.activeSheets() || [], nowMs: Date.now(),
      sheetBillingOf: k => OwnerStore.getSheetBilling(k), jobBillingOf: k => OwnerStore.getJobBilling(k),
      customerBillingOf: k => OwnerStore.getCustomerBilling(k), projectCustomerOf: jk => Storage.getProjectCustomer(jk),
      customerKeyOf: K.customer, jobKeyOf: K.job,
    }));
  }

  // Recent jobs (spec 2026-10-06 §3.3): every line's job name opens its card; Back comes back here.
  function recentJobsHtml(list) {
    if (!list.length) return '';
    const rows = list.map(j => `<div class="billing-recent-job">
        <button type="button" class="billing-job-link" data-act="open-job" data-job="${esc(j.jobName)}">${esc(j.jobName)}</button>
        <span class="billing-recent-job-text">${esc(`${j.customerName} · finished ${j.finishedText} · ${j.billingText} · ${j.laborText}`)}</span>
      </div>`).join('');
    return `<section class="settings-card billing-recent-jobs-card"><h2 class="settings-card-title">Recent jobs</h2>
      <p class="settings-card-hint">Finished in the last 30 days. Click one to add design or CAM hours.</p>${rows}</section>`;
  }

  function renderCaption() {
    const rhythm = rhythmMode();
    els.date.hidden = rhythm; els.everything.hidden = rhythm; els.weekly.hidden = rhythm; els.pick.hidden = !rhythm;
    els.throughTitle.textContent = rhythm ? 'Weekly bills' : 'Bill work cut through';
    if (rhythm) { els.caption.textContent = 'Weekly customers: one bill per finished week. Others: everything cut to date.'; return; }
    if (handDate === 'all') { els.caption.textContent = 'Everything cut so far.'; return; }
    const through = handDate;
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

  /* ── Recent invoices (imported): Add PO + Retry log update ── */
  function renderRecent(dataOk) {
    const a = document.activeElement;
    const keep = !!(poEdit && a && els.recent.contains(a) && a.matches('input[data-po]'));
    const list = InvoiceStore.recentImported(20);
    els.recent.innerHTML = list.length ? recentHtml(list, dataOk) : '';
    if (keep) {
      const i = els.recent.querySelector('input[data-po]');
      if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) { /* ignore */ } }
    }
  }

  function recentHtml(list, dataOk) {
    const rows = list.map(inv => {
      const r = BillingDone.recentRow(inv, fmtMoney);
      const n = esc(r.number);
      const dis = (!dataOk || recentBusy.has(Number(r.number))) ? ' disabled' : '';
      let po;
      if (poEdit && Number(poEdit.number) === Number(r.number)) {
        po = `<span class="billing-recent-po"><input type="text" class="form-input billing-recent-po-input" data-po="${n}" value="${esc(poEdit.text)}" placeholder="PO number" aria-label="PO number for invoice ${n}" autocomplete="off">
          <button type="button" class="btn btn-primary btn-sm" data-act="save-po" data-number="${n}"${dis}>Save</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="cancel-po" data-number="${n}">Cancel</button></span>`;
      } else {
        po = `<span class="billing-recent-po">${r.po ? `<span class="billing-recent-po-text">PO ${esc(r.po)}</span>` : '<span class="billing-recent-none">no PO</span>'}
          <button type="button" class="btn btn-outline btn-sm" data-act="add-po" data-number="${n}" data-po="${esc(r.po)}"${dis}>${r.po ? 'Change PO' : 'Add PO'}</button></span>`;
      }
      const note = r.logFailed
        ? `<div class="billing-recent-note"><span>${esc(r.logNote)}</span> <button type="button" class="btn btn-outline btn-sm" data-act="retry-log" data-number="${n}"${dis}>Retry log update</button></div>` : '';
      return `<div class="billing-recent-row" data-number="${n}">
        <span class="billing-recent-num">#${n}</span><span class="billing-recent-cust">${esc(r.customer)}</span>
        <span class="billing-recent-date">${esc(r.imported)}</span><span class="billing-recent-total">${esc(r.total)}</span>${po}${note}
      </div>`;
    }).join('');
    return `<section class="settings-card billing-recent-card"><h2 class="settings-card-title">Recent invoices</h2>${rows}</section>`;
  }

  async function savePo(number) {
    if (!poEdit || recentBusy.has(number) || !ownerDataOk()) return;
    const text = poEdit.text;
    recentBusy.add(number); render();
    try {
      await InvoiceStore.addPo(number, text, opts.currentEmail());
      poEdit = null; setStatus('');
    } catch (e) {
      setStatus(e && e.code === 'po-empty' ? e.message : `Couldn't save the PO on invoice ${number} — ${(e && e.message) || e}`, true);
    }
    recentBusy.delete(number); render();
  }

  async function retryLog(number) {
    if (recentBusy.has(number) || !ownerDataOk()) return;
    recentBusy.add(number); render();
    try {
      const r = await InvoiceStore.writeBack(number, opts.currentEmail());
      const failed = !!(r && r.logWritten === false);
      setStatus(failed ? `The log still could not be updated: ${r.logError || 'unknown reason'}` : `The Master Job Log is updated for invoice ${number}.`, failed);
    } catch (e) {
      setStatus(`Couldn't retry the log update for invoice ${number} — ${(e && e.message) || e}`, true);
    }
    recentBusy.delete(number); render();
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
  function billState(customer, ctx, sel) {
    if (customer.busyInvoice != null) return { note: `Finish invoice ${customer.busyInvoice} first (Imported OK or Cancel).` };
    const input = BillingModel.pricingInput(customer, sel, ctx);
    if (!Object.keys(input.jobs).length) return { none: true };
    let priced;
    try { priced = Pricing.priceInvoice(input); } catch (e) { return { error: e.message || String(e) }; }
    try { InvoiceLines.finalize(priced, { qbItems: OwnerStore.qbItems(), laborTypes: ctx.laborTypes }); }
    catch (e) { return e && e.code === 'mixed-taxable' ? { note: e.message } : { error: (e && e.message) || String(e) }; }
    return { total: priced.total };
  }

  // `o`: { sel } the choices for these rows; toggle: false = no Remove button (a later week); hideAmount: true = no
  // dollars (an invoice is in progress, so a repeat of its sheets would be priced as a first copy); we: the week section.
  function rowHtml(customer, row, ctx, dataOk, o) {
    o = o || {};
    const canToggle = o.toggle !== false;
    const on = canToggle ? isOnIn(o.sel, row) : true;
    const rp = BillingModel.rowPricing(row, ctx);
    const detail = BillingModel.rowDetail(row, rp.priced);
    const n = row.sheetKeys.length;
    let state;
    if (row.state === 'ready') state = 'Ready';
    else if (row.state === 'labor-only') state = 'Design hours only';
    else state = `${plural(n, 'cut sheet', 'cut sheets')}, ${row.uncutCount} still to cut`;
    const label = on ? 'Remove' : 'Add back';
    const later = row.laterCount ? ` · ${plural(row.laterCount, 'sheet', 'sheets')} cut later wait` : '';
    const amount = o.hideAmount ? '<span class="billing-row-amt">—</span>'
      : (rp.error ? `<span class="billing-row-error">${esc(rp.error)}</span>` : `<span class="billing-row-amt">${esc(fmtMoney(rp.amount))}</span>`);
    const button = canToggle
      ? `<button type="button" class="btn btn-outline btn-sm" data-act="toggle" data-ck="${esc(customer.customerKey)}" data-jk="${esc(row.jobKey)}"${o.we ? ` data-we="${esc(o.we)}"` : ''}${dataOk && !rp.error && !o.hideAmount ? '' : ' disabled'}>${esc(label)}</button>` : '';
    return `<div class="billing-row billing-row--${esc(row.state)}${on ? '' : ' is-off'}">
      <div class="billing-row-main">
        <div><button type="button" class="billing-job-link" data-act="open-job" data-job="${esc(row.jobName)}">${esc(row.jobName)}</button> <span class="billing-row-state">${esc(state)}${esc(later)}</span></div>
        <div class="billing-row-detail">${esc(detail)}</div>
      </div>
      ${amount}
      ${button}
    </div>`;
  }

  // A Weekly customer's card in rhythm mode: one block per finished unbilled week, oldest first. Only the oldest
  // has Remove / Add back and a Bill button; a later week shows its total and "Bill after week ending ...".
  function weeklyCardHtml(c, laborTypes, dataOk) {
    const ctx = { priceList: c.priceList, laborTypes };
    const invBusy = c.busyInvoice != null;
    let sections = [], failure = '';
    try { sections = weekSectionsOf(c, laborTypes); } catch (e) { failure = e.message || String(e); }
    // An invoice in progress means sheets are locked, not billed: later weeks' repeats would be priced as first
    // copies, so NO dollars are shown on this card until it is finished.
    const wait = `Total shown after invoice ${c.busyInvoice} is finished`;
    const body = sections.map((sec, i) => {
      const we = sec.weekEnding;
      const title = we ? `Week ending ${longDate(we)}` : 'Design hours only';
      const billable = !!sec.billable && isYmd(we);
      const sel = selOf(c.customerKey, we);
      let rows;
      try {
        rows = sec.rows.map(r => rowHtml({ customerKey: c.customerKey }, r, ctx, dataOk, { sel, toggle: billable && !invBusy, hideAmount: invBusy, we })).join('');
      } catch (e) { rows = `<p class="billing-note billing-note--error">${esc(e.message || String(e))}</p>`; }
      let side = '';
      if (invBusy) {
        if (billable) side = `<button type="button" class="btn btn-primary" disabled>Bill week ending ${esc(longDate(we))}</button>`;
        side += `<span class="billing-week-wait">${esc(wait)}</span>`;
      } else if (billable) {
        const pc = { customerKey: c.customerKey, rows: sec.rows, busyInvoice: null };
        let st;
        try { st = billState(pc, ctx, sel); } catch (e) { st = { error: e.message || String(e) }; }
        if (st.total != null) side = `<button type="button" class="btn btn-primary" data-act="bill" data-ck="${esc(c.customerKey)}" data-we="${esc(we)}"${dataOk && !busy ? '' : ' disabled'}>Bill week ending ${esc(longDate(we))} · ${esc(fmtMoney(st.total))}</button>`;
        else if (st.note) side = `<span class="billing-card-note">${esc(st.note)}</span>`;
        else if (st.error) side = `<span class="billing-row-error">${esc(st.error)}</span>`;
      } else {
        const prev = i > 0 ? sections[i - 1].weekEnding : null;
        if (sec.total != null) side += `<span class="billing-week-total">${esc(fmtMoney(sec.total))}</span>`;
        if (sec.error) side += `<span class="billing-row-error">${esc(sec.error)}</span>`;
        if (prev) side += `<span class="billing-week-wait">Bill after week ending ${esc(longDate(prev))}</span>`;
      }
      return `<div class="billing-week" data-week="${esc(we || '')}"><div class="billing-week-head"><h3 class="billing-week-title">${esc(title)}</h3><div class="billing-week-side">${side}</div></div>${rows}</div>`;
    }).join('');
    let note = '';
    if (invBusy) note = `<span class="billing-card-note">${esc(`Finish invoice ${c.busyInvoice} first (Imported OK or Cancel).`)}</span>`;
    else if (failure) note = `<span class="billing-row-error">${esc(failure)}</span>`;
    return `<section class="settings-card billing-card${c.rows.length ? '' : ' billing-card--empty'}" data-cadence="weekly">
      <div class="billing-card-head">
        <div><h2 class="settings-card-title">${esc(c.customerName)}</h2><p class="settings-card-hint billing-card-summary">${esc(c.summary)}</p></div>
        <div class="billing-card-action">${note}</div>
      </div>${body}</section>`;
  }

  function customerHtml(c, laborTypes, dataOk) {
    if (rhythmMode() && isWeekly(c.customerKey)) return weeklyCardHtml(c, laborTypes, dataOk);
    const empty = !c.rows.length;
    const ctx = { priceList: c.priceList, laborTypes };
    let action = '';
    if (!empty || c.busyInvoice != null) {
      let st;
      try { st = billState(c, ctx, selection[c.customerKey]); } catch (e) { st = { error: e.message || String(e) }; }
      if (st.total != null) {
        action = `<button type="button" class="btn btn-primary" data-act="bill" data-ck="${esc(c.customerKey)}"${dataOk && !busy ? '' : ' disabled'}>Bill ${esc(c.customerName)} · ${esc(fmtMoney(st.total))}</button>`;
      } else if (st.note) action = `<span class="billing-card-note">${esc(st.note)}</span>`;
      else if (st.error) action = `<span class="billing-row-error">${esc(st.error)}</span>`;
    }
    let rows = '';
    if (!empty) {
      try { rows = c.rows.map(r => rowHtml(c, r, ctx, dataOk, { sel: selection[c.customerKey] })).join(''); }
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
    if (act === 'toggle') return toggle(b.dataset.ck, b.dataset.jk, b.dataset.we);
    if (act === 'bill') return bill(b.dataset.ck, b.dataset.we);
    if (act === 'open-job') return opts.openJob(b.dataset.job, finished || []);
    if (act === 'imported') return imported(Number(b.dataset.number));
    if (act === 'cancel') return cancelInvoice(Number(b.dataset.number));
    if (act === 'download') return downloadAgain(Number(b.dataset.number));
    if (act === 'add-po') { poEdit = { number: Number(b.dataset.number), text: b.dataset.po || '' }; render(); const i = els.recent.querySelector('input[data-po]'); if (i) i.focus(); return; }
    if (act === 'cancel-po') { poEdit = null; render(); return; }
    if (act === 'save-po') return savePo(Number(b.dataset.number));
    if (act === 'retry-log') return retryLog(Number(b.dataset.number));
  }

  function toggle(ck, jk, we) {
    let m;
    try { m = model(); } catch (e) { return; }
    const c = m.customers.find(x => x.customerKey === ck);
    if (!c) return;
    if (we) {   // a Weekly card's oldest week: the choice belongs to that week only
      if (!rhythmMode() || c.busyInvoice != null) return;
      let sec;
      try { sec = weekSectionsOf(c, OwnerStore.laborTypes()).find(x => x.weekEnding === we); } catch (e) { return; }
      const row = sec && sec.billable && sec.rows.find(r => r.jobKey === jk);
      if (!row) return;
      const cur = selOf(ck, we);
      weekSelection[ck] = { ...(weekSelection[ck] || {}), [we]: { ...cur, [jk]: { sheets: !isOnIn(cur, row) } } };
      render();
      return;
    }
    const row = c.rows.find(r => r.jobKey === jk);
    if (!row) return;
    selection[ck] = { ...(selection[ck] || {}), [jk]: { sheets: !isOnIn(selection[ck], row) } };
    render();
  }

  // Bill: a Weekly card's oldest week passes exactly that week's Saturday; an Everything-to-date customer passes null
  // (everything cut); hand mode passes the one date. A weekly bill is never sent without a valid week-ending date.
  function bill(ck, we) {
    if (!ownerDataOk()) { setStatus(NOT_LOADED, true); return; }
    let m;
    try { m = model(); } catch (e) { setStatus(e.message, true); return; }
    const c = m.customers.find(x => x.customerKey === ck);
    if (!c) return;
    setStatus('');
    if (rhythmMode() && isWeekly(ck)) {
      let sec = null;
      try { sec = weekSectionsOf(c, OwnerStore.laborTypes()).find(x => x.weekEnding === we); } catch (e) { sec = null; }
      if (!we || !sec || !sec.billable || !isYmd(sec.weekEnding)) { setStatus("That week can't be billed from here — use Pick a date yourself.", true); return; }
      opts.openInvoice({ customerKey: ck, selection: resolvedSelection(sec.rows, selOf(ck, sec.weekEnding)), throughDate: sec.weekEnding });
      return;
    }
    const throughDate = rhythmMode() ? null : (handDate === 'all' ? null : handDate);
    opts.openInvoice({ customerKey: ck, selection: resolvedSelection(c.rows, selection[ck]), throughDate });
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

  // An active job that left the board (exported) must stay billable, and a Put back job must not be
  // counted twice: reload the finished list — quietly — only when the board's set of sheets moved
  // that way. Uploads, archive links and other sheet edits only repaint. Billing and the Invoice
  // screen (which prices from this list) both count as open.
  function activeKeys() { return new Set((opts.activeSheets() || []).map(s => s.fileKey)); }
  function boardChanged() {
    if (!els) return;
    const keys = activeKeys();
    const prev = boardKeys; boardKeys = keys;
    const invoiceOpen = !!(opts.invoiceOpen && opts.invoiceOpen());
    if (els.screen.hidden && !invoiceOpen) return;
    const left = !!prev && [...prev].some(k => !keys.has(k));
    const back = (finished || []).some(s => keys.has(s.fileKey));
    if (left || back) {
      if (loadState === 'ok') { loadFinished(true); return; }
      if (loadState === 'loading') reloadAgain = true;
    }
    render();
    if (invoiceOpen && opts.onFinishedLoaded) opts.onFinishedLoaded();
  }

  return { init, show, render, fmtMoney, boardChanged, buildModel: model };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BillingScreen;
