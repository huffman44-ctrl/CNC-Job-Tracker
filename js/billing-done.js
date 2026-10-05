/**
 * js/billing-done.js — the Done screen (spec §7.6) shown after Imported OK, plus the pure text/row
 * builders Billing's "Recent invoices" block shares. DISPLAY ONLY: no money math (fmtMoney only
 * formats a total that was computed and saved on the invoice).
 * Globals at runtime: escHtml (app.js), InvoiceStore, BillingScreen (Bill the next customer).
 */
const BillingDone = (() => {
  let opts = { hideOthers() {}, onBack() {} };
  let current = null;           // invoice number being shown

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const esc = s => (typeof escHtml === 'function' ? escHtml(s == null ? '' : s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const byId = id => document.getElementById(id);

  function fmtMoney(n) {
    if (typeof BillingScreen !== 'undefined' && BillingScreen.fmtMoney) return BillingScreen.fmtMoney(n);
    const [whole, frac] = Number(n).toFixed(2).split('.');
    return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac === '00' ? '' : '.' + frac);
  }

  const isLaborOnly = inv => !((inv && inv.sheetKeys) || []).length;

  // "14 sheets billed on invoice #3612" / "1 design line billed on invoice #3612"
  function headline(inv) {
    const n = inv.number;
    if (isLaborOnly(inv)) return `${plural((inv.laborLineRefs || []).length, 'design line', 'design lines')} billed on invoice #${n}`;
    return `${plural(inv.sheetKeys.length, 'sheet', 'sheets')} billed on invoice #${n}`;
  }

  function wontShowLine(inv) {
    return isLaborOnly(inv) ? "Those lines won't show up in billing again." : "Those sheets won't show up in billing again.";
  }

  // null for a labor-only invoice (no log rows exist).
  function logLine(inv) {
    if (isLaborOnly(inv)) return null;
    if (inv.logWritten) {
      const k = inv.sheetKeys.length;
      return `The Master Job Log now has #${inv.number} on ${k === 1 ? 'its 1 row' : `all ${k} rows`}.`;
    }
    return `The log could not be updated (${inv.logError || 'unknown reason'}) — retry from Billing.`;
  }

  const POLINE = 'Add the PO number any time from Billing › Recent invoices when the customer sends it.';

  function importedText(ms) {
    const d = new Date(ms);
    return ms == null || Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // One Recent-invoices row: plain strings, escaped at paint time.
  function recentRow(inv, fmt) {
    const f = fmt || fmtMoney;
    return {
      number: inv.number,
      customer: inv.customerName || '',
      imported: importedText(inv.importedAt),
      total: inv.total == null ? '' : f(inv.total),
      po: inv.poNumber || '',
      logFailed: inv.logWritten === false && !isLaborOnly(inv),
      logNote: inv.logWritten === false ? `Log not updated: ${inv.logError || 'unknown reason'}` : '',
      laborOnly: isLaborOnly(inv),
    };
  }

  function init(options) {
    opts = { ...opts, ...options };
    const el = byId('billing-done-screen');
    if (el) el.addEventListener('click', onClick);
  }

  function show(number) {
    current = Number(number);
    opts.hideOthers();
    byId('billing-done-screen').hidden = false;
    render();
  }

  function render() {
    const el = byId('billing-done-screen');
    if (!el || el.hidden) return;
    const inv = current != null ? InvoiceStore.get(current) : null;
    let body;
    if (!inv) body = `<p class="billing-note">Invoice ${esc(current)} was not found.</p>`;
    else {
      const log = logLine(inv);
      body = `<section class="settings-card done-card">
        <h2 class="done-headline">${esc(headline(inv))}</h2>
        <p class="done-customer">${esc(inv.customerName || '')}${inv.total == null ? '' : ' · ' + esc(fmtMoney(inv.total))}</p>
        <p class="done-line">${esc(wontShowLine(inv))}</p>
        ${log ? `<p class="done-line${inv.logWritten ? '' : ' done-line--warn'}">${esc(log)}</p>` : ''}
        <p class="done-line done-line--hint">${esc(POLINE)}</p>
        <div class="done-actions">
          <button type="button" class="btn btn-primary" data-act="next">Bill the next customer</button>
          <button type="button" class="btn btn-outline" data-act="jobs">Back to Jobs</button>
        </div>
      </section>`;
    }
    el.innerHTML = `<header class="app-header"><div class="header-left">
        <span class="header-logo-badge">CNC</span><div class="header-divider"></div>
        <div class="header-titles"><span class="header-file-title">Done</span><span class="header-job-name">Owners only</span></div>
      </div></header><main class="content-main">${body}</main>`;
  }

  function onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'next') BillingScreen.show();
    else if (b.dataset.act === 'jobs') { byId('billing-done-screen').hidden = true; opts.onBack(); }
  }

  return { init, show, render, headline, wontShowLine, logLine, recentRow, importedText, POLINE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BillingDone;
