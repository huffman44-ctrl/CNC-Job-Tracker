/**
 * Packing-list stamping: dark-blue header band on page 1 with
 * "order | customer | Assembly N" and the decoded options line.
 * Port of stamp.py — layout constants must stay in step with the Python
 * tool until it retires. Requires globals: PDFLib (js/vendor/pdf-lib.min.js)
 * and AssemblyLevels (js/assembly-levels.js). Standard Helvetica only —
 * no fontkit needed here.
 */
const PackingPdf = (() => {
  const BAND_H = 42;
  const WARN_NO_LEVEL = '! Options not specified - check the order sheet';

  function stampText(order) {
    const parts = [order.orderNum, order.customer];
    if (order.assembly) parts.push('Assembly ' + order.assembly);
    return parts.filter(Boolean).join('  |  ');
  }

  function optionsText(order) {
    const decoded = AssemblyLevels.decode(order.assembly);
    if (decoded === null) return WARN_NO_LEVEL;
    return decoded
      .map(([name, included]) => name + ': ' + (included ? 'YES' : 'no'))
      .join('    ');
  }

  async function stampPdf(templateBytes, order) {
    const doc = await PDFLib.PDFDocument.load(templateBytes);
    const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    const darkBlue = PDFLib.rgb(0x1F / 255, 0x4E / 255, 0x79 / 255);
    page.drawRectangle({ x: 0, y: height - BAND_H, width, height: BAND_H, color: darkBlue });
    page.drawText(stampText(order), {
      x: 10, y: height - 17, size: 11, font: bold, color: PDFLib.rgb(1, 1, 1),
    });
    page.drawText(optionsText(order), {
      x: 10, y: height - 33, size: 9, font: regular, color: PDFLib.rgb(1, 1, 1),
    });
    // Same uncompressed-objects choice as sticker-pdf.js: keeps the PDF
    // introspectable by the page-count test and plain-text tooling.
    return doc.save({ useObjectStreams: false });
  }

  return { stampText, optionsText, stampPdf };
})();
