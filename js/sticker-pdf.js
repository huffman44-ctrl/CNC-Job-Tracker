/**
 * 1"x3" hardware-bag sticker PDFs, rendered with pdf-lib.
 * Port of sticker_render.py (_wrap / fit_lines / draw_hardware_sticker);
 * layout constants must stay in step with the Python tool until it retires.
 * Requires globals: PDFLib (js/vendor/pdf-lib.min.js) and fontkit
 * (js/vendor/fontkit.umd.min.js).
 */
const StickerPdf = (() => {
  const LABEL_W = 3 * 72;          // 3in x 1in at 72pt/in
  const LABEL_H = 1 * 72;
  const PAD = 0.10 * 72;
  const LINE_SPACING = 1.2;
  const START_SIZE = 22;
  const MIN_SIZE = 6;

  function wrapText(text, maxWidth, size, widthFn) {
    const lines = [];
    let current = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const trial = current ? current + ' ' + word : word;
      if (current && widthFn(trial, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = trial;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function fitLines(text, maxWidth, maxHeight, widthFn) {
    for (let size = START_SIZE; size > MIN_SIZE; size--) {
      const lines = wrapText(text, maxWidth, size, widthFn);
      const widest = Math.max(...lines.map(l => widthFn(l, size)));
      if (widest <= maxWidth && lines.length * size * LINE_SPACING <= maxHeight) {
        return { size, lines };
      }
    }
    return { size: MIN_SIZE, lines: wrapText(text, maxWidth, MIN_SIZE, widthFn) };
  }

  async function buildStickerPdf(items, stickerTexts, fontBytes) {
    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes);
    const widthFn = (t, s) => font.widthOfTextAtSize(t, s);
    for (const [id, qty] of items) {
      const text = stickerTexts[id];
      if (!text) throw new Error('unknown sticker id: ' + id);
      for (let n = 0; n < qty; n++) {
        const page = doc.addPage([LABEL_W, LABEL_H]);
        const { size, lines } = fitLines(text, LABEL_W - 2 * PAD, LABEL_H - 2 * PAD, widthFn);
        // Same centering as the Python renderer: block centered vertically,
        // each line centered horizontally.
        let y = (LABEL_H + lines.length * size * LINE_SPACING) / 2 - size;
        for (const line of lines) {
          page.drawText(line, {
            x: (LABEL_W - widthFn(line, size)) / 2, y, size, font,
            color: PDFLib.rgb(0, 0, 0),
          });
          y -= size * LINE_SPACING;
        }
      }
    }
    // pdf-lib defaults to compressed object streams, which bury each page's
    // /Type /Page dict inside a zlib stream where plain-text tooling (and
    // this codebase's own page-count check) can't see it. Keep objects
    // uncompressed so the PDF stays easy to introspect.
    return doc.save({ useObjectStreams: false });
  }

  return { wrapText, fitLines, buildStickerPdf };
})();
