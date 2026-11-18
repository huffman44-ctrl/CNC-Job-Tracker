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

  // ── Manual QR codes (2026-11-18) ──
  // Bottom-right corner of page 1, which is empty on every template.
  // Landscape van sheets: QRs side by side under the parts table, captions
  // below each. The SUV sheets are portrait pages whose content is turned
  // 90 deg (reads bottom-to-top), so there the QRs stack up the right edge
  // and the captions are turned to match.
  const QR_SIZE = 66;      // ~0.92" - plenty for a short URL off paper
  const QR_QUIET = 2;      // quiet-zone modules, same as the crate label
  const QR_MARGIN = 20;
  const SLOT = 190;        // room along the reading direction per QR + caption
  const CAPTION_SIZE = 7;
  const URL_SIZE_MAX = 6;

  // Returns [{x, y, size, slotStart, portrait}] in print order (kit first).
  function qrLayout(width, height, n) {
    const portrait = height > width;
    const boxes = [];
    for (let i = 0; i < n; i++) {
      if (!portrait) {
        const slotStart = width - QR_MARGIN - (n - i) * SLOT;
        boxes.push({ x: slotStart + (SLOT - QR_SIZE) / 2, y: 30, size: QR_SIZE, slotStart, portrait });
      } else {
        const slotStart = QR_MARGIN + i * SLOT;
        boxes.push({ x: width - QR_MARGIN - 24 - QR_SIZE, y: slotStart + (SLOT - QR_SIZE) / 2,
          size: QR_SIZE, slotStart, portrait });
      }
    }
    return boxes;
  }

  function drawQr(page, text, x, y, size) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / (count + 2 * QR_QUIET);
    page.drawRectangle({ x, y, width: size, height: size, color: PDFLib.rgb(1, 1, 1) });
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!qr.isDark(row, col)) continue;
        page.drawRectangle({
          x: x + (QR_QUIET + col) * cell,
          y: y + size - (QR_QUIET + row + 1) * cell,
          width: cell, height: cell, color: PDFLib.rgb(0, 0, 0),
        });
      }
    }
  }

  function drawQrs(page, links, bold, regular) {
    const { width, height } = page.getSize();
    const boxes = qrLayout(width, height, links.length);
    const gray = PDFLib.rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
    links.forEach((link, i) => {
      const b = boxes[i];
      drawQr(page, link.url, b.x, b.y, b.size);
      const shortUrl = link.url.replace(/^https?:\/\//, '');
      let urlSize = URL_SIZE_MAX;
      while (urlSize > 4 && regular.widthOfTextAtSize(shortUrl, urlSize) > SLOT - 6) urlSize -= 0.5;
      const lines = [
        { text: link.caption, font: bold, size: CAPTION_SIZE, color: PDFLib.rgb(0, 0, 0) },
        { text: shortUrl, font: regular, size: urlSize, color: gray },
      ];
      lines.forEach((ln, j) => {
        const along = (SLOT - ln.font.widthOfTextAtSize(ln.text, ln.size)) / 2;
        if (!b.portrait) {
          page.drawText(ln.text, { x: b.slotStart + along, y: b.y - 9 - j * 9, size: ln.size, font: ln.font, color: ln.color });
        } else {
          // Turned 90 deg: reads bottom-to-top, "below" the QR = to its right.
          page.drawText(ln.text, { x: b.x + b.size + 9 + j * 9, y: b.slotStart + along, size: ln.size,
            font: ln.font, color: ln.color, rotate: PDFLib.degrees(90) });
        }
      });
    });
  }

  async function stampPdf(templateBytes, order, links = []) {
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
    if (links && links.length) drawQrs(page, links, bold, regular);
    // Same uncompressed-objects choice as sticker-pdf.js: keeps the PDF
    // introspectable by the page-count test and plain-text tooling.
    return doc.save({ useObjectStreams: false });
  }

  return { stampText, optionsText, stampPdf, qrLayout };
})();
