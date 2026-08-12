/**
 * VanLab printing logic that needs no DOM: order-number extraction from
 * sheet filenames, and van -> sticker-list resolution (port of
 * van_stickers.resolve_stickers). UI wiring lives in app.js.
 */
const VanlabPrint = (() => {
  // Anchored on the word "order" so date prefixes (260611) and model
  // numbers (3806) in VanLab filenames can never be mistaken for it.
  const ORDER_RE = /order[\s_#]*(\d+)/i;

  function extractOrderNumber(fileNames) {
    const seen = [];
    for (const name of fileNames || []) {
      const m = String(name).match(ORDER_RE);
      if (m && !seen.includes(m[1])) seen.push(m[1]);
    }
    if (seen.length === 0) return { orderNum: null, conflict: null };
    if (seen.length > 1) return { orderNum: null, conflict: seen };
    return { orderNum: seen[0], conflict: null };
  }

  function resolveStickers(vanKey, map) {
    const vans = (map && map.vanStickers) || {};
    if (!vanKey || !vans[vanKey]) {
      return { status: 'unknown', items: [],
        reason: 'no hardware sticker list mapped for van ' + String(vanKey) };
    }
    return { status: 'matched', items: vans[vanKey].map(pair => pair.slice()), reason: '' };
  }

  return { extractOrderNumber, resolveStickers };
})();
