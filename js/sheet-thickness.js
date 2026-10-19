/**
 * js/sheet-thickness.js — group a job's sheets by material thickness for the board.
 * Each Aspire sheet file carries its own thickness (Material Block Z), read by
 * JobDetails.thicknessFromMaterialInfo. Pure, no DOM, so node --test can load it.
 * Board display order only: the CSV export, billing and the notes window keep compareSheets.
 */
const SheetThickness = (() => {
  const JD = typeof JobDetails !== 'undefined' ? JobDetails : require('./job-details.js');

  function of(sheet) {
    return JD.thicknessFromMaterialInfo(sheet && sheet.materialInfo);
  }

  // 0.75 -> "3/4 in", 1.5 -> "1 1/2 in"; anything that is not a sixteenth keeps its decimal.
  function label(t) {
    if (t == null) return 'Unknown thickness';
    const whole = Math.floor(t);
    const sixteenths = Math.round((t - whole) * 16);
    if (Math.abs(t - (whole + sixteenths / 16)) > 0.005) return `${t} in`;
    if (sixteenths === 0) return `${whole} in`;
    if (sixteenths === 16) return `${whole + 1} in`;
    let n = sixteenths, d = 16;
    while (n % 2 === 0) { n /= 2; d /= 2; }
    return `${whole ? whole + ' ' : ''}${n}/${d} in`;
  }

  // Thickest first, unknown last. Stable: inside one thickness the incoming order is kept.
  const rank = t => (t == null ? -Infinity : t);
  function order(sheets) {
    return (sheets || []).map((s, i) => ({ s, i, t: rank(of(s)) }))
      .sort((a, b) => (b.t - a.t) || (a.i - b.i))
      .map(x => x.s);
  }

  function known(sheets) {
    return (sheets || []).some(s => of(s) != null);
  }

  // "3/4 in × 7 · 1/2 in × 13"; '' when no sheet has a readable thickness.
  function summary(sheets) {
    if (!known(sheets)) return '';
    const counts = new Map();
    for (const s of order(sheets)) { const t = of(s); counts.set(t, (counts.get(t) || 0) + 1); }
    return [...counts].map(([t, n]) => `${label(t)} × ${n}`).join(' · ');
  }

  return { of, label, order, known, summary };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SheetThickness;
