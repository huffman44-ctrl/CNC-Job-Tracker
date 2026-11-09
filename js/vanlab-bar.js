/**
 * VanlabBar — pure logic for the VanLab print bar on the job screen (spec .scratch/vanlab-print-bar).
 *   forJob(fileNames)              { auto, orderNum, conflict } — auto (the bar shows by itself) only for ONE order number
 *   heading(orderNum, order)       "VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05" (order null = before/without lookup)
 *   buttonTitle(kind, opts)        "Hardware stickers (7)" / "Packing list" / "Crate label"; opts.stickerCount
 *   stickerCount(items)            total stickers in a VanlabPrint.resolveStickers list of [key, qty] pairs
 *   record(by, at) / printedFrom(jobDoc)   the { at, by } print records kept on jobs/{jobKey}.vanlabPrinted
 *   itemView(kind, rec, opts)      one button: { title: '✓ Crate label', done, action: 'Reprint', note: 'Printed by Collin, 10:42 AM', canUndo }
 *   sourceNote / customerLine / ageWords / staleNote / checkedNote / successStatus / conflictText   the lookup's wording: which source, how old the feed is, Order Log unchecked, the feed-vs-Order-Log disagreement
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

  // ── Lookup wording (sticker-feed ticket 04) ──
  const SOURCE_NAMES = { feed: 'the CRM feed', orderLog: 'the Order Log' };
  const END = 'print these now so the kit gets packed while the sheets cut.';

  function sourceNote(order) {
    const name = order && SOURCE_NAMES[order.source];
    return name ? 'from ' + name : '';
  }

  function customerLine(order) {
    const c = order && typeof order.customer === 'string' ? order.customer.trim() : '';
    return c || 'No customer on this order';
  }

  function plural(n, unit) { return n + ' ' + unit + (n === 1 ? '' : 's'); }

  // "3 days" / "2 hours" / "45 minutes"; '' when the time is missing or unreadable.
  function ageWords(updatedAt, now) {
    if (!updatedAt) return '';
    const t = new Date(updatedAt).getTime();
    if (!Number.isFinite(t)) return '';
    const ms = Math.max(0, now - t);
    if (ms < 60000) return 'less than a minute';
    if (ms < 3600000) return plural(Math.floor(ms / 60000), 'minute');
    if (ms < 86400000) return plural(Math.floor(ms / 3600000), 'hour');
    return plural(Math.floor(ms / 86400000), 'day');
  }

  function staleNote(order, now) {
    if (!order || order.feedStale !== true) return '';
    const age = ageWords(order.feedUpdatedAt, now);
    return age
      ? 'The CRM feed was last updated ' + age + ' ago, so it may be out of date.'
      : "The CRM feed's update time is unknown, so it may be out of date.";
  }

  function checkedNote(order) {
    return order && order.orderLogChecked === false
      ? "The Order Log couldn't be checked, so the feed's values were not double-checked."
      : '';
  }

  function successStatus(order, now) {
    const src = sourceNote(order);
    const head = customerLine(order) + (src ? ' (' + src + ')' : '');
    const notes = [staleNote(order, now), checkedNote(order)].filter(Boolean);
    return [head + ' — ' + END].concat(notes).join(' ');
  }

  function conflictText(conflict) {
    const side = (o) => {
      const v = (o && (o.vanKey || o.vanRaw)) || 'none';
      const k = (o && o.assembly) || 'none';
      return 'van ' + v + ', kit ' + k;
    };
    const c = conflict || {};
    return 'The CRM feed and the Order Log disagree about order ' + (c.orderNum || '') + ': the CRM feed says '
      + side(c.feed) + '; the Order Log says ' + side(c.orderLog) + '. Please check which is right and pick the van type by hand:';
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

  return { forJob, heading, buttonTitle, stickerCount, record, printedFrom, itemView, barState, sourceNote, customerLine, ageWords, staleNote, checkedNote, successStatus, conflictText, KINDS: Object.keys(TITLES) };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VanlabBar;
