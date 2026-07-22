/**
 * SVG size codec for Firestore storage.
 *
 * VCarve writes coordinates at 8 decimal places (e.g. "54.50000000"). On a
 * complex sheet that is ~80% of the SVG's bytes, which pushes the layoutSvg
 * field past Firestore's 1 MiB per-field limit and makes the whole sheet
 * fail to save. Rounding to 0.001" plus gzip gets a 2.15 MB drawing down to
 * ~375 KB with no visible change (0.001" is 0.003px at display size).
 *
 * Pure functions only — no DOM, no Firestore — so this is unit-testable
 * under `node --test`.
 */
const SvgCodec = (() => {
  // Firestore rejects any single string field larger than this many bytes.
  const FIRESTORE_FIELD_LIMIT = 1048487;
  // Budget against 90% — the document carries other fields, and Firestore
  // also caps total document size at 1 MiB.
  const SAFE_FIELD_BYTES = 943638;

  /**
   * Rounds every decimal number to `decimals` places and trims trailing
   * zeros. Only matches <digits>.<digits>, so path command letters, bare
   * integers, and exponent suffixes ("e-7") are left alone.
   */
  function roundSvgPrecision(svgString, decimals = 3) {
    if (!svgString) return '';
    return svgString.replace(/-?\d+\.\d+/g, match => {
      let v = parseFloat(match).toFixed(decimals);
      if (v.includes('.')) v = v.replace(/0+$/, '').replace(/\.$/, '');
      return (v === '-0' || v === '') ? '0' : v;
    });
  }

  return { roundSvgPrecision, FIRESTORE_FIELD_LIMIT, SAFE_FIELD_BYTES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SvgCodec;
