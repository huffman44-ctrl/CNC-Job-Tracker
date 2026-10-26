/**
 * VanlabBar — pure logic for the VanLab print bar on the job screen (spec .scratch/vanlab-print-bar).
 *   forJob(fileNames)              { auto, orderNum, conflict } — auto (the bar shows by itself) only for ONE order number
 *   heading(orderNum, order)       "VanLab order 1210 · Van 15 Transit 148 Passenger · kit 15-05" (order null = before/without lookup)
 *   buttonTitle(kind, opts)        "Hardware stickers (7)" / "Packing list" / "Crate label"; opts.stickerCount
 *   stickerCount(items)            total stickers in a VanlabPrint.resolveStickers list of [key, qty] pairs
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

  return { forJob, heading, buttonTitle, stickerCount };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VanlabBar;
