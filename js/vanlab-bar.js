/**
 * VanlabBar — pure logic for the VanLab print bar on the job screen (spec .scratch/vanlab-print-bar).
 *   forJob(fileNames)              { auto, orderNum, conflict } — auto (the bar shows by itself) only for ONE order number
 *   heading(orderNum, order)       "VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05" (order null = before/without lookup)
 *   buttonTitle(kind, opts)        "Hardware stickers (7)" / "Packing list" / "Crate label"; opts.stickerCount
 *   stickerCount(items)            total stickers in a VanlabPrint.resolveStickers list of [key, qty] pairs
 *   record(by, at) / printedFrom(jobDoc)   the { at, by } print records kept on jobs/{jobKey}.vanlabPrinted
 *   itemView(kind, rec, opts)      one button: { title: '✓ Crate label', done, action: 'Reprint', note: 'Printed by Collin, 10:42 AM', canUndo }
 *   barState(printed, opts)        { allDone, collapsed } — the bar folds to one line once the kit is printed
 * No DOM, no Firestore, no clock. Browser global `VanlabBar`; module.exports for node --test.
 */
const VanlabBar = (() => {
  const VP = (typeof VanlabPrint !== 'undefined') ? VanlabPrint : require('./vanlab-print.js');
  const TITLES = { stickers: 'Hardware stickers', packing: 'Packing list', crate: 'Crate label' };

  function forJob(fileNames) {
    const { orderNum, conflict } = VP.extractOrderNumber(fileNames);
    return { auto: !!orderNum && !conflict, orderNum, conflict };
  }

  function heading(orderNum, order) {
    const parts = ['VanLab order ' + orderNum];
    if (order) {
      const van = order.vanRaw || order.vanKey;
      if (van) parts.push('Van ' + van);
      if (order.assembly) parts.push('kit ' + order.assembly);
    }
    return parts.join(' · ');
  }

  function buttonTitle(kind, opts = {}) {
    if (!TITLES[kind]) throw new Error('unknown VanLab print: ' + kind);
    return kind === 'stickers' && opts.stickerCount ? TITLES[kind] + ' (' + opts.stickerCount + ')' : TITLES[kind];
  }

  function stickerCount(items) {
    return (items || []).reduce((n, [, q]) => n + q, 0);
  }

  // ── Print tracking (ticket 02): jobs/{jobKey}.vanlabPrinted = { stickers|packing|crate: { at, by } } ──

  function record(by, at) {
    return { at, by: String(by || '').trim() || 'Someone' };
  }

  function printedFrom(jobDoc) {
    const raw = (jobDoc && jobDoc.vanlabPrinted) || {};
    const out = {};
    for (const kind of Object.keys(TITLES)) {
      const r = raw[kind];
      if (r && typeof r === 'object' && Number.isFinite(r.at)) out[kind] = record(r.by, r.at);
    }
    return out;
  }

  // "10:42 AM"; another day adds "10/24 ", another year "10/24/2025 ".
  function when(at, now) {
    const d = new Date(at), n = new Date(now);
    const h = d.getHours() % 12 || 12;
    const time = h + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? ' AM' : ' PM');
    if (d.toDateString() === n.toDateString()) return time;
    const date = (d.getMonth() + 1) + '/' + d.getDate() + (d.getFullYear() === n.getFullYear() ? '' : '/' + d.getFullYear());
    return date + ' ' + time;
  }

  // One button's look. opts: { now, stickerCount, packingNone } — packingNone = this van has no packing list.
  function itemView(kind, rec, opts = {}) {
    const title = buttonTitle(kind, opts);
    if (kind === 'packing' && opts.packingNone) {
      return { title: '✓ ' + title, done: true, action: null, note: 'None needed for this van', canUndo: false };
    }
    if (!rec) return { title, done: false, action: 'Print', note: '', canUndo: false };
    return { title: '✓ ' + title, done: true, action: 'Reprint', note: 'Printed by ' + rec.by + ', ' + when(rec.at, opts.now), canUndo: true };
  }

  // ── Collapse (ticket 03) ──
  function barState(printed, { packingNone, expanded } = {}) {
    const allDone = !!(printed.stickers && printed.crate && (printed.packing || packingNone));
    return { allDone, collapsed: allDone && !expanded };
  }

  return { forJob, heading, buttonTitle, stickerCount, record, printedFrom, itemView, barState, KINDS: Object.keys(TITLES) };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VanlabBar;
