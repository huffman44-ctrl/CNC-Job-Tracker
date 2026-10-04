/**
 * js/log-rows.js — builds the Master Job Log row object (spec §6.2 / §10). Collin's export
 * and, in Phase 2, Billing's write-back both call build(), so the two can never disagree on
 * a column. Objects, not positional arrays: a future column never shifts anything.
 * Columns A–N: Sheet, Job, Total Time, Toolpath Count, Has V-bit, Completed Time, Operator,
 * Final Notes, Archive Link, Customer, Invoice #, PO #, Sheet Key, Billed.
 */
const LogRows = (() => {
  const P = typeof Pricing !== 'undefined' ? Pricing : require('./pricing.js');

  const COLUMNS = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed Time',
    'Operator', 'Final Notes', 'Archive Link', 'Customer', 'Invoice #', 'PO #', 'Sheet Key', 'Billed'];

  // The ONE formatter for completed-time text; app.js formatDT delegates here.
  function formatCompletedTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // billing (optional): { invoiceNumber?, poNumber?, billed? } — each key is copied ONLY when
  // present, because the Apps Script writes K/L/N only when the payload carries them.
  function build(sheet, completion, customerName, billing) {
    const row = {
      key:           sheet.fileKey,
      sheet:         sheet.sheetTitle || sheet.fileName || '',
      job:           sheet.jobName || '',
      totalTime:     sheet.totalTime || '',
      toolpathCount: Array.isArray(sheet.toolpaths) ? sheet.toolpaths.length : 0,
      hasVbit:       P.sheetHasVbit(sheet) ? 'Y' : 'N',
      completedTime: completion && completion.completedAt ? formatCompletedTime(completion.completedAt) : '',
      operator:      (completion && completion.operator) || '',
      notes:         (completion && completion.notes) || '',
      archiveLink:   sheet.archiveUrl || '',
      customer:      customerName || '',
    };
    if (billing) {
      if (billing.invoiceNumber != null) row.invoice = String(billing.invoiceNumber);
      if (billing.poNumber != null)      row.po      = String(billing.poNumber);
      if (billing.billed != null)        row.billed  = String(billing.billed);
    }
    return row;
  }

  return { COLUMNS, build, formatCompletedTime };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LogRows;
