/**
 * js/invoice-lines.js — words and QuickBooks columns only — no arithmetic; money is
 * Pricing.priceInvoice(). Turns priced lines into QuickBooks-ready lines (description,
 * item name, Taxable) through a registry of line types, and builds the QuickBooks CSV
 * (ported from the estimator's buildQuickBooksCsv). Later line types register themselves.
 */
const InvoiceLines = (() => {
  const PU = typeof PathUtils !== 'undefined' ? PathUtils : require('./path-utils.js');

  const BOM = '\ufeff';
  const DUE_TERMS = { receipt: 0, net15: 15, net30: 30 };
  const MIXED_MSG = 'Materials on this bill are taxed differently — bill those jobs separately.';

  const registry = {};
  function register(type, handlers) { registry[type] = handlers; }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const taxFlag = v => (v === 'Y' || v === true ? 'Y' : 'N');
  const taxSetting = (ctx, key) => taxFlag(((ctx && ctx.qbItems && ctx.qbItems.taxable) || {})[key]);
  const cncItem = ctx => (ctx && ctx.qbItems && ctx.qbItems.cnc) || '';

  register('cutSheets', {
    describe(line) {
      const f = line.facts || {};
      let s = `CNC cutting — ${plural(f.sheetCount, 'sheet', 'sheets')} (${(f.perJob || []).map(p => `${p.jobName} ${p.count}`).join(', ')})`;
      (f.rush || []).forEach(r => { s += `, ${r.label} on ${r.jobName}`; });
      if (f.weekendSheets > 0) s += `, Weekend (+${Math.round(f.weekendRate * 100)}%) on ${plural(f.weekendSheets, 'sheet', 'sheets')}`;
      if (f.minimumApplied) s += ', Cut minimum';
      return s;
    },
    qbItem: (line, ctx) => cncItem(ctx),
    taxable: (line, ctx) => taxSetting(ctx, 'cnc'),
  });

  register('labor', {
    describe(line) {
      const f = line.facts || {};
      let s = f.typeName + (f.note ? ' — ' + f.note : '');
      const inc = f.topUpHours > 0 ? `, includes ${f.minHours}-hr minimum` : '';
      s += ` (${f.billedHours} ${f.billedHours === 1 ? 'hr' : 'hrs'} @ $${f.rate}/hr${inc})`;
      if (f.rushPct > 0) s += ` + Rush (+${Math.round(f.rushPct * 100)}%)`;
      return s;
    },
    qbItem(line, ctx) {
      const t = ((ctx && ctx.laborTypes) || []).find(x => x.id === (line.facts || {}).typeId);
      return (t && t.qbItem) || cncItem(ctx);
    },
    taxable: (line, ctx) => taxSetting(ctx, 'labor'),
  });

  register('material', {
    describe(line) {
      const f = line.facts || {};
      return `Materials — ${plural(f.sheetCount, 'sheet', 'sheets')} (${(f.names || []).join(', ')})`;
    },
    qbItem: (line, ctx) => (ctx && ctx.qbItems && ctx.qbItems.materials) || '',
    taxable(line) {
      const t = (line.facts || {}).taxable;
      if (t === 'mixed') { const e = new Error(MIXED_MSG); e.code = 'mixed-taxable'; throw e; }
      return t === true ? 'Y' : 'N';
    },
  });

  function finalize(priced, ctx) {
    return priced.lines.map(line => {
      const h = registry[line.type];
      if (!h) throw new Error(`InvoiceLines: no handler registered for line type "${line.type}"`);
      return {
        type: line.type,
        qbItem: h.qbItem(line, ctx),
        description: h.describe(line, ctx),
        quantity: line.quantity,
        rate: line.rate,
        amount: line.amount,
        taxable: taxFlag(h.taxable(line, ctx)),
        serviceDate: line.serviceDate,
        jobKeys: line.jobKeys,
      };
    });
  }

  // ---- dates (local math only; 'YYYY-MM-DD' strings) ----
  const pad = x => String(x).padStart(2, '0');
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  function dueDateFor(invoiceYmd, term, customYmd) {
    if (term === 'custom') return customYmd;
    return addDays(invoiceYmd, DUE_TERMS[term] || 0);
  }
  function mdy(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
  }

  // ---- QuickBooks CSV (no BOM; the BOM is added at download) ----
  function csvField(value) {
    const s = String(value == null ? '' : value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildQuickBooksCsv({ number, customerName, invoiceDate, dueDate, lines }) {
    const headers = ['Invoice No.', 'Customer', 'Invoice Date', 'Due Date', 'Item(Product/Service)', 'Item Description', 'Item Quantity', 'Item Rate', 'Item Amount', 'Taxable', 'Service Date'];
    const rows = lines.map(l => {
      const qty = l.quantity || 1;
      return [number, customerName, mdy(invoiceDate), mdy(dueDate), l.qbItem, l.description, qty, l.rate, l.amount, l.taxable, mdy(l.serviceDate)];
    });
    return [headers].concat(rows).map(r => r.map(csvField).join(',')).join('\r\n');
  }
  function downloadName(customerName, number) {
    return 'QuickBooks Exports/' + PU.sanitizeForPath(customerName) + '/' + number + '.csv';
  }

  return { register, finalize, buildQuickBooksCsv, BOM, downloadName, addDays, DUE_TERMS, dueDateFor };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InvoiceLines;
