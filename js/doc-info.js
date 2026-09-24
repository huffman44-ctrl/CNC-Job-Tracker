/**
 * Print-queue document inspection: is this a PDF, what size is its first page,
 * how many pages, and the title string that guards against the wrong printer.
 * Pure apart from the PDFLib global (js/vendor/pdf-lib.min.js), so it runs
 * under node --test in a vm the same way sticker-pdf.js does.
 * Spec: docs/superpowers/specs/2026-09-10-print-queue-design.md § Phase 3 amendment.
 */
const DocInfo = (() => {
  const TOLERANCE = 3;   // points; scanners and label generators are rarely exact
  const SIZES = { '3x1': [3 * 72, 1 * 72], '4x6': [4 * 72, 6 * 72], 'letter': [8.5 * 72, 11 * 72] };
  const near = (a, b) => Math.abs(a - b) <= TOLERANCE;

  // Either orientation counts: a rotated label is still a 4x6 label. 3x1 is a
  // pre-built sticker PDF (e.g. the stickers skill's output) for STICKERS 1x3.
  function sizeFor(width, height) {
    for (const [name, [w, h]] of Object.entries(SIZES)) {
      if ((near(width, w) && near(height, h)) || (near(width, h) && near(height, w))) return name;
    }
    return null;
  }

  function isPdf(bytes) {
    if (!bytes || bytes.length < 5) return false;
    // '%PDF-'
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }

  async function inspectPdf(bytes) {
    // ignoreEncryption stays false: an encrypted PDF should be refused at
    // staging with a clear message, not queued and then fail on the shop PC.
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    if (!pages) throw new Error('the PDF has no pages');
    const { width, height } = doc.getPage(0).getSize();
    return { pages, width, height };
  }

  function title(fileName, size, pages) {
    return `${fileName} · ${size} · ${pages} page${pages === 1 ? '' : 's'}`;
  }

  return { isPdf, sizeFor, inspectPdf, title, TOLERANCE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DocInfo;
