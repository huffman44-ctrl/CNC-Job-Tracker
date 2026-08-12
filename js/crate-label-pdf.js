/**
 * 4"x6" VanLab crate label, rendered with pdf-lib.
 * Port of label_generator.py's draw_label; layout constants must stay in
 * step with the Python tool until it retires. One deliberate difference:
 * the QR payload has no "Status:" line (the tracker's lookup doesn't
 * return status, and it was only ever a print-time snapshot).
 * Requires globals: PDFLib (js/vendor/pdf-lib.min.js), qrcode
 * (js/vendor/qrcode-generator.js), StickerPdf (js/sticker-pdf.js, for
 * wrapText — the same greedy wrap _wrap_value uses). Standard Helvetica
 * only — no fontkit needed here.
 */
const CrateLabelPdf = (() => {
  const LABEL_W = 4 * 72;               // LABEL_W = 4*inch = 288
  const LABEL_H = 6 * 72;               // LABEL_H = 6*inch = 432
  const MARGIN = 0.18 * 72;             // side margin used throughout
  const HEADER_H = 1.0 * 72;            // header_h = 1.0*inch
  const FOOTER_H = 0.28 * 72;           // footer_h
  const QR_SIZE = 1.9 * 72;             // qr_size = 1.9*inch
  const QR_Y = 0.55 * 72;               // qr_y
  const QR_QUIET = 2;                   // qrcode.QRCode(border=2)
  const LINE_H_FACTOR = 1.15;           // line_h = value_size * 1.15

  const DARK_BLUE = () => PDFLib.rgb(0x1F / 255, 0x4E / 255, 0x79 / 255);
  const MID_BLUE = () => PDFLib.rgb(0x2E / 255, 0x75 / 255, 0xB6 / 255);
  const LIGHT_GRAY = () => PDFLib.rgb(0xF2 / 255, 0xF2 / 255, 0xF2 / 255);
  const CAPTION_GRAY = () => PDFLib.rgb(0x55 / 255, 0x55 / 255, 0x55 / 255);
  const BLACK = () => PDFLib.rgb(0, 0, 0);
  const WHITE = () => PDFLib.rgb(1, 1, 1);

  function qrText(order) {
    return [
      '--- VanLab Kit Info ---',
      'Order:    ' + order.orderNum,
      'Van:      ' + order.vanName,
      'Assembly: ' + (order.assembly || 'N/A'),
      'Customer: ' + order.customer,
      'Packed:   ' + order.datePacked,
      '-----------------------',
    ].join('\n');
  }

  function drawRule(page, y) {
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: LABEL_W - MARGIN, y },
      thickness: 1.5, color: LIGHT_GRAY(),
    });
  }

  function drawPlaceholder(page, bold, regular) {
    // _draw_logo_placeholder (square corners; reportlab's roundRect r=4 is
    // a cosmetic nicety pdf-lib's drawRectangle doesn't offer).
    page.drawRectangle({
      x: 0.15 * 72, y: LABEL_H - HEADER_H + 0.18 * 72,
      width: 1.1 * 72, height: 0.72 * 72, color: MID_BLUE(),
    });
    const centered = (font, text, size, y) => page.drawText(text, {
      x: 0.7 * 72 - font.widthOfTextAtSize(text, size) / 2, y,
      size, font, color: WHITE(),
    });
    centered(bold, 'LOGO', 9, LABEL_H - HEADER_H + 0.49 * 72);
    centered(regular, 'placeholder', 7, LABEL_H - HEADER_H + 0.28 * 72);
  }

  async function buildCrateLabelPdf(order, logoPngBytes) {
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([LABEL_W, LABEL_H]);
    const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const boldWidth = (t, s) => bold.widthOfTextAtSize(t, s);

    // ── Top logo band ──
    let logo = null;
    if (logoPngBytes) {
      try { logo = await doc.embedPng(logoPngBytes); } catch { logo = null; }
    }
    if (logo) {
      const aspect = logo.width / logo.height;
      const maxW = LABEL_W - 0.6 * 72;          // max_logo_w
      const maxH = HEADER_H - 0.3 * 72;         // max_logo_h
      let w = maxW, h = maxW / aspect;
      if (h > maxH) { h = maxH; w = h * aspect; }
      page.drawImage(logo, {
        x: (LABEL_W - w) / 2, y: LABEL_H - 0.2 * 72 - h, width: w, height: h,
      });
    } else {
      drawPlaceholder(page, bold, regular);
    }
    drawRule(page, LABEL_H - HEADER_H);

    // ── Kit info block (port of the line() closure) ──
    let y = LABEL_H - HEADER_H - MARGIN;
    const maxValueWidth = LABEL_W - 2 * MARGIN;
    const infoLine = (labelText, valueText, valueSize, gap) => {
      y -= gap;
      page.drawText(labelText.toUpperCase(), {
        x: MARGIN, y, size: 9, font: bold, color: MID_BLUE(),
      });
      const wrapped = StickerPdf.wrapText(valueText, maxValueWidth, valueSize, boldWidth);
      const lineH = valueSize * LINE_H_FACTOR;
      wrapped.forEach((line, i) => {
        page.drawText(line, {
          x: MARGIN, y: y - MARGIN - i * lineH, size: valueSize,
          font: bold, color: BLACK(),
        });
      });
      y -= MARGIN + (wrapped.length - 1) * lineH;
    };
    infoLine('Kit', order.vanName, 14, 0.30 * 72);
    infoLine('Assembly #', order.assembly || '—', 12, 0.35 * 72);
    infoLine('Order #', order.orderNum, 12, 0.32 * 72);
    infoLine('Date Packed', order.datePacked, 12, 0.32 * 72);

    y -= 0.12 * 72;
    drawRule(page, y);

    // ── QR code: module matrix drawn straight onto the page ──
    const qr = qrcode(0, 'M');
    qr.addData(qrText(order));
    qr.make();
    const count = qr.getModuleCount();
    const cell = QR_SIZE / (count + 2 * QR_QUIET);
    const qrX = (LABEL_W - QR_SIZE) / 2;
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!qr.isDark(row, col)) continue;
        page.drawRectangle({
          x: qrX + (QR_QUIET + col) * cell,
          y: QR_Y + QR_SIZE - (QR_QUIET + row + 1) * cell,
          width: cell, height: cell, color: BLACK(),
        });
      }
    }
    const caption = 'Scan for full kit details';
    page.drawText(caption, {
      x: (LABEL_W - regular.widthOfTextAtSize(caption, 8)) / 2,
      y: QR_Y - 0.2 * 72, size: 8, font: regular, color: CAPTION_GRAY(),
    });

    // ── Footer bar ──
    page.drawRectangle({ x: 0, y: 0, width: LABEL_W, height: FOOTER_H, color: DARK_BLUE() });
    const footer = 'Generated ' + order.datePacked + '  |  VanLab';
    page.drawText(footer, {
      x: (LABEL_W - regular.widthOfTextAtSize(footer, 7)) / 2,
      y: 0.09 * 72, size: 7, font: regular, color: WHITE(),
    });

    // Same uncompressed-objects choice as sticker-pdf.js: keeps the PDF
    // introspectable by the page-size/count tests and plain-text tooling.
    return doc.save({ useObjectStreams: false });
  }

  return { qrText, buildCrateLabelPdf };
})();
