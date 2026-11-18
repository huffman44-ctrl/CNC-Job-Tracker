/**
 * Van -> QR links printed on the packing list: the kit's install manual, plus
 * the wiring manual when the assembly number says wiring was ordered.
 *
 * Each link is a short wearevanlab.com/instructions/<slug> address. Those are
 * Shopify URL redirects (Online Store -> Navigation -> URL Redirects), so the
 * manual a printed QR opens can be changed there without reprinting anything.
 * Created 2026-11-18. Some vans share a manual today but get their own slug so
 * they can be split later in Shopify alone.
 *
 * Pure logic, no DOM. Requires AssemblyLevels (js/assembly-levels.js).
 */
const ManualLinks = (() => {
  const BASE = 'https://wearevanlab.com/instructions/';

  const VAN_TO_SLUG = {
    '13': 'nv200',
    '15': 'transit-148-passenger',
    '21': 'sprinter-144',
    '22': 'transit-148-cargo',
    '25': 'transit-148-cargo-extended-wide',
    '27': 'transit-148-cargo-extended',
    '28': 'promaster-159-ns',
    '29': 'promaster-159-ew',
    '30': 'sprinter-170',
    '31': 'promaster-159-ew-crew',
    '32': 'e-series-ext-cargo',
    '33': 'e-series-ext-passenger',
    '34': 'e-series',
    '35': 'savana-135-cargo',
    '36': 'savana-135-passenger',
    '37': 'savana-155',
    '39': 'e-series-swb-passenger',
    '42': 'transit-connect',
    'SUV01': 'suv-kit',
    // '44' (Native fitting kit): no confirmed manual yet - no kit QR.
  };

  const WIRING_SLUG = 'wiring';

  function hasWiring(assembly) {
    const decoded = AssemblyLevels.decode(assembly);
    if (decoded === null) return false;   // unknown options: don't guess
    return decoded.some(([name, included]) => name === 'Wiring' && included);
  }

  // Returns [{kind, caption, url}] in print order (kit first). Empty for an
  // unknown van, so the packing list prints exactly as it did before.
  function linksFor(vanKey, assembly) {
    if (!vanKey) return [];
    const links = [];
    const slug = VAN_TO_SLUG[vanKey];
    if (slug) {
      links.push({ kind: 'kit', caption: 'Scan for your install instructions', url: BASE + slug });
    }
    if ((slug || vanKey === '44') && hasWiring(assembly)) {
      links.push({ kind: 'wiring', caption: 'Scan for the wiring manual', url: BASE + WIRING_SLUG });
    }
    return links;
  }

  return { linksFor };
})();
