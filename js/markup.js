/**
 * Layout diagram markup: rectangle/ellipse highlights drawn on top of a
 * sheet's Material Border SVG. See js/storage.js's sheetAnnotations
 * functions for persistence; this module owns the drawing/toolbar UI.
 */
const Markup = (() => {
  const COLORS = ['red', 'gold', 'green'];

  // Drag can start from any corner; always normalize to a top-left
  // origin with positive width/height so stored shapes are consistent
  // regardless of which direction the operator dragged.
  function normalizeDrag(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  return { COLORS, normalizeDrag };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Markup;
