/**
 * Van -> packing-list template resolution, with the Python tool's honesty
 * rules: none-needed vans say so, the van-39 numbering conflict stays
 * blocked, SUVs without a variant are ambiguous (never guessed). Port of
 * packing_map.py — keep the two in step until the Python tool retires.
 * Pure logic, no DOM, no fetch; the bridge checks actual file existence.
 */
const PackingMap = (() => {
  // van_key -> exact PDF filename in the Drive library folder.
  const VAN_TO_PDF = {
    '13': 'Van 13_ NV200 Fitting Kit.pdf',
    '15': 'Van 15_ Transit 148 Passenger.pdf',
    '21': 'Van 21_ Mercedes Sprinter 144_ Cargo.pdf',
    '22': 'Van 22_ Transit 148_ Cargo.pdf',
    '25': 'Van 25_ Transit 148_ Cargo Extended WIDE.pdf',
    '27': 'Van 27_ Transit 148_ Cargo Extended.pdf',
    '28': 'Van 28_ Ram Promaster 159_ N_S.pdf',
    '29': 'Van 29_ Ram Promaster 159_  EW.pdf',
    '30': 'Van 30_ Mercedes Sprinter 170_ N_S.pdf',
    '31': 'Van 31_ Ram Promaster 159_  EW CREW.pdf',
    '32': 'Van 32_ Ford ESeries 350 EXT CARGO.pdf',
    '33': 'Van 33_ Ford ESeries 350 EXT PASSENGER.pdf',
    '34': 'Van 34_ Ford ESeries 350 REG CARGO.pdf',
    '35': 'Van 35_ GMC Savana_Chevy Express 135 Cargo.pdf',
    '36': 'Van 36_ GMC Savana_Chevy Express 135 PASSENGER.pdf',
    '37': 'Van 37_ GMC Savana_Chevy Express 155_ Cargo.pdf',
    '39': 'Van 39_ Ford ESeries SWB PASSENGER.pdf',
    '42': 'Van 42_ Ford Transit Connect.pdf',
    '44': 'Van44_Native Fitting Kit_Kit 2-5 - Fitting Kit Check List.pdf',
  };

  // Vans that intentionally have no packing list (install-only jobs).
  const NONE_NEEDED_VANS = {
    '40': 'panel-install / no packing list required',
  };

  // Van numbering conflicts — flag for a human instead of guessing.
  // (Same wording as packing_map.py; delete the entry when VanLab confirms.)
  const CONFLICTED_VANS = {
    '39': 'van numbering conflict: Order Log says Transit Connect, PDF library '
        + 'says ESeries SWB Passenger - verify with VanLab before packing',
  };

  const SUV_VARIANTS = {
    full: 'SUV01  SUV01 Full Kit.pdf',
    bed: 'SUV01  SUV01 Bed Only.pdf',
    kitchen: 'SUV01  SUV01 kITCHEN Only.pdf',
  };

  // Whole-word search, kitchen > bed > full precedence, so substrings like
  // 'bedding' or 'fully' don't false-match (mirrors _find_variant_keyword).
  function findVariantKeyword(text) {
    const s = String(text || '').toLowerCase();
    for (const keyword of ['kitchen', 'bed', 'full']) {
      if (new RegExp('\\b' + keyword + '\\b').test(s)) return keyword;
    }
    return null;
  }

  function resolve(vanKey, assembly, suvChoice) {
    if (!vanKey) {
      return { status: 'missing', file: null, reason: 'van not recognized from the Order Log entry' };
    }
    if (vanKey === 'SUV01') {
      const keyword = suvChoice || findVariantKeyword(assembly);
      if (!keyword) {
        return { status: 'ambiguous', file: null, reason: 'SUV order does not specify Full/Bed/Kitchen' };
      }
      return { status: 'matched', file: SUV_VARIANTS[keyword], reason: '' };
    }
    if (NONE_NEEDED_VANS[vanKey]) {
      return { status: 'none_needed', file: null, reason: NONE_NEEDED_VANS[vanKey] };
    }
    if (CONFLICTED_VANS[vanKey]) {
      return { status: 'missing', file: null, reason: CONFLICTED_VANS[vanKey] };
    }
    if (VAN_TO_PDF[vanKey]) {
      return { status: 'matched', file: VAN_TO_PDF[vanKey], reason: '' };
    }
    return { status: 'missing', file: null, reason: 'no packing list mapped for van ' + vanKey };
  }

  return { resolve, SUV_VARIANTS };
})();
