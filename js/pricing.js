/**
 * js/pricing.js — the ONE place that knows what makes two sheets "the same design", how an
 * Aspire time is read, and what a sheet's cut date is. Phase 1 (2026-10-04 spec §8.1, §12.1)
 * ships only these helpers; Phase 2 adds priceInvoice() here and NOTHING ELSE in the app does
 * price math. Pure: no DOM, no Firestore, no Date.now() — callers pass dates.
 * Browser global `Pricing`; module.exports for node --test.
 */
const Pricing = (() => {
  // Moved here from app.js so the log's "Has V-bit" column and the repeat rule read one list.
  const VBIT_KEYWORDS = ['V-Carve', 'V-carve', 'V Carve', 'VCarve', 'V-Groove', 'V-groove', 'V Groove'];

  function sheetHasVbit(sheet) {
    const toolpaths = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths : [];
    return toolpaths.some(tp => VBIT_KEYWORDS.some(kw => new RegExp(kw, 'i').test((tp && tp.name) || '')));
  }

  // 'HH:MM:SS' (Aspire) or 'MM:SS' -> seconds. Anything unreadable is 0, never NaN.
  function parseTimeSec(text) {
    const parts = String(text || '').trim().split(':');
    if (!parts.length || parts.some(p => !/^\d+$/.test(p))) return 0;
    return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
  }

  // Spec §8.1: signature = totalTimeSec | toolpathCount | V-bit flag. Two sheets of one job with
  // the same signature are one design (the first pays handlingFirst, the rest handlingRepeat).
  function signature(sheet) {
    const count = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths.length : 0;
    return `${parseTimeSec(sheet && sheet.totalTime)}|${count}|${sheetHasVbit(sheet) ? 'V' : '-'}`;
  }

  // orderedSheets = one job's sheets in display order (app.js compareSheets).
  function repeatGroups(orderedSheets) {
    const firstPosition = {};
    const out = {};
    (orderedSheets || []).forEach((sheet, i) => {
      const sig = signature(sheet);
      if (firstPosition[sig] === undefined) {
        firstPosition[sig] = i + 1;
        out[sheet.fileKey] = { signature: sig, repeatOf: null };
      } else {
        out[sheet.fileKey] = { signature: sig, repeatOf: firstPosition[sig] };
      }
    });
    return out;
  }

  function repeatCount(orderedSheets) {
    return Object.values(repeatGroups(orderedSheets)).filter(g => g.repeatOf !== null).length;
  }

  // ISO timestamp -> local 'YYYY-MM-DD'. Never slice the ISO string: it is UTC and shifts the
  // weekday in US zones (spec §12.1 "weekday fixture trap").
  function localDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 'YYYY-MM-DD' parsed as LOCAL parts (new Date('2026-10-03') would be UTC midnight).
  function isWeekendDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return false;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return day === 0 || day === 6;
  }

  // The owner's correction (sheetBilling.cutDateOverride) wins over Collin's completion time.
  function effectiveCutDate(completion, sheetBilling) {
    if (sheetBilling && sheetBilling.cutDateOverride) return sheetBilling.cutDateOverride;
    if (completion && completion.status === 'complete' && completion.completedAt) return localDate(completion.completedAt);
    return null;
  }

  return { VBIT_KEYWORDS, sheetHasVbit, parseTimeSec, formatDuration, signature, repeatGroups, repeatCount, localDate, isWeekendDate, effectiveCutDate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pricing;
