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

  function byteLength(str) {
    return new TextEncoder().encode(str).length;
  }

  async function streamThrough(transform, bytes) {
    const writer = transform.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(transform.readable).arrayBuffer());
  }

  function bytesToBase64(bytes) {
    // Chunked so a multi-hundred-KB array doesn't blow the argument limit
    // on String.fromCharCode.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function compressSvg(svgString) {
    const input = new TextEncoder().encode(svgString);
    const gz = await streamThrough(new CompressionStream('gzip'), input);
    return bytesToBase64(gz);
  }

  async function decompressSvg(base64) {
    const bytes = base64ToBytes(base64);
    const out = await streamThrough(new DecompressionStream('gzip'), bytes);
    return new TextDecoder().decode(out);
  }

  /**
   * Decides how a drawing gets stored:
   *   'plain'    — rounded SVG fits as readable text (no decompress on read)
   *   'gzip'     — too big as text, but gzip+base64 fits
   *   'oversize' — even compressed it won't fit; caller stores a marker and
   *                points the operator at the archived HTML instead
   */
  async function packLayoutSvg(svgString) {
    const empty = { layoutSvg: '', layoutSvgGz: '', originalBytes: 0, storedBytes: 0 };
    if (!svgString) return { mode: 'plain', ...empty };

    const originalBytes = byteLength(svgString);
    const rounded = roundSvgPrecision(svgString);
    const roundedBytes = byteLength(rounded);

    if (roundedBytes <= SAFE_FIELD_BYTES) {
      return { mode: 'plain', layoutSvg: rounded, layoutSvgGz: '',
               originalBytes, storedBytes: roundedBytes };
    }

    const gz = await compressSvg(rounded);
    const gzBytes = byteLength(gz);
    if (gzBytes <= SAFE_FIELD_BYTES) {
      return { mode: 'gzip', layoutSvg: '', layoutSvgGz: gz,
               originalBytes, storedBytes: gzBytes };
    }

    return { mode: 'oversize', ...empty, originalBytes };
  }

  return { roundSvgPrecision, compressSvg, decompressSvg, packLayoutSvg,
           FIRESTORE_FIELD_LIMIT, SAFE_FIELD_BYTES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SvgCodec;
