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

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function renderShapes(overlaySvg, shapes) {
    overlaySvg.innerHTML = '';
    for (const shape of shapes) {
      const el = document.createElementNS(SVG_NS, shape.type === 'ellipse' ? 'ellipse' : 'rect');
      if (shape.type === 'ellipse') {
        el.setAttribute('cx', shape.x + shape.w / 2);
        el.setAttribute('cy', shape.y + shape.h / 2);
        el.setAttribute('rx', shape.w / 2);
        el.setAttribute('ry', shape.h / 2);
      } else {
        el.setAttribute('x', shape.x);
        el.setAttribute('y', shape.y);
        el.setAttribute('width', shape.w);
        el.setAttribute('height', shape.h);
      }
      el.style.fill = `var(--${shape.color})`;
      el.style.fillOpacity = '0.3';
      el.style.stroke = `var(--${shape.color})`;
      el.style.strokeWidth = '0.15';
      overlaySvg.appendChild(el);
    }
  }

  function buildToolbar(state, onToolChange) {
    const bar = document.createElement('div');
    bar.className = 'layout-markup-toolbar';

    const rectBtn = document.createElement('button');
    rectBtn.type = 'button';
    rectBtn.className = 'markup-tool-btn';
    rectBtn.textContent = '▭';
    rectBtn.title = 'Draw rectangle';
    rectBtn.addEventListener('click', () => {
      state.tool = state.tool === 'rect' ? null : 'rect';
      onToolChange();
    });

    const ellipseBtn = document.createElement('button');
    ellipseBtn.type = 'button';
    ellipseBtn.className = 'markup-tool-btn';
    ellipseBtn.textContent = '◯';
    ellipseBtn.title = 'Draw ellipse';
    ellipseBtn.addEventListener('click', () => {
      state.tool = state.tool === 'ellipse' ? null : 'ellipse';
      onToolChange();
    });

    bar.appendChild(rectBtn);
    bar.appendChild(ellipseBtn);

    for (const color of COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'markup-color-swatch';
      swatch.style.background = `var(--${color})`;
      swatch.title = color;
      swatch.addEventListener('click', () => {
        state.color = color;
        onToolChange();
      });
      bar.appendChild(swatch);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-muted btn-sm markup-clear-btn';
    clearBtn.textContent = 'Clear marks';
    clearBtn.addEventListener('click', () => {
      state.shapes = [];
      Storage.setAnnotations(state.fileKey, state.shapes);
      onToolChange();
    });
    bar.appendChild(clearBtn);

    return { bar, rectBtn, ellipseBtn, clearBtn, swatches: [...bar.querySelectorAll('.markup-color-swatch')] };
  }

  function updateToolbarUI(els, state) {
    els.rectBtn.classList.toggle('active', state.tool === 'rect');
    els.ellipseBtn.classList.toggle('active', state.tool === 'ellipse');
    els.swatches.forEach((el, i) => el.classList.toggle('active', COLORS[i] === state.color));
  }

  function screenToPoint(svg, evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const inverse = svg.getScreenCTM().inverse();
    const local = pt.matrixTransform(inverse);
    return { x: local.x, y: local.y };
  }

  // Armed tool + active color, keyed by fileKey, kept outside mount()'s
  // per-call state so they survive the full-teardown re-renders triggered
  // by Storage.onAnnotationsChange (Task 4) — including re-renders caused
  // by this tab's own writes. Shapes themselves are NOT cached here; they
  // always come fresh from Storage.getAnnotations on every mount().
  const toolState = new Map();

  function getToolState(fileKey) {
    if (!toolState.has(fileKey)) toolState.set(fileKey, { tool: null, color: COLORS[0] });
    return toolState.get(fileKey);
  }

  // Only one sheet-detail overlay is ever mounted at a time, but window
  // keeps a strong reference to whatever mouseup listener we last added
  // (unlike an element-scoped listener, it won't get garbage-collected
  // when the overlay is torn down on the next re-render) — track it so
  // each mount() call can remove its predecessor instead of leaking one
  // listener per render.
  let activeMouseupHandler = null;

  function mount(svgWrapEl, scrollEl, sheet) {
    const baseSvg = scrollEl.querySelector('svg');
    if (!baseSvg) return;

    const viewBox = baseSvg.getAttribute('viewBox');

    const canvas = document.createElement('div');
    canvas.className = 'layout-svg-canvas';
    baseSvg.replaceWith(canvas);
    canvas.appendChild(baseSvg);

    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('viewBox', viewBox);
    overlay.classList.add('layout-svg-overlay');
    canvas.appendChild(overlay);

    const armed = getToolState(sheet.fileKey);
    const state = {
      fileKey: sheet.fileKey,
      shapes: Storage.getAnnotations(sheet.fileKey),
      get tool() { return armed.tool; },
      set tool(v) { armed.tool = v; },
      get color() { return armed.color; },
      set color(v) { armed.color = v; },
    };
    renderShapes(overlay, state.shapes);

    const els = buildToolbar(state, () => {
      updateToolbarUI(els, state);
      renderShapes(overlay, state.shapes);
    });
    updateToolbarUI(els, state);
    svgWrapEl.insertBefore(els.bar, scrollEl);

    let dragStart = null;
    overlay.addEventListener('mousedown', evt => {
      if (!state.tool || evt.button !== 0) return;
      evt.preventDefault(); // avoid native text-selection/drag over the SVG mid-mark
      dragStart = screenToPoint(overlay, evt);
    });
    overlay.addEventListener('mousemove', evt => {
      if (dragStart && evt.buttons === 0) {
        // The button was released somewhere this tab never saw a mouseup
        // for (e.g. outside the browser window) — self-heal instead of
        // leaving a ghost preview shape that tracks the cursor forever.
        dragStart = null;
        renderShapes(overlay, state.shapes);
        return;
      }
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      renderShapes(overlay, [...state.shapes, shape]);
    });

    if (activeMouseupHandler) window.removeEventListener('mouseup', activeMouseupHandler);
    activeMouseupHandler = evt => {
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      dragStart = null;
      if (shape.w < 0.25 || shape.h < 0.25) return; // jitter click, not a deliberate drag — discard
      state.shapes = [...state.shapes, shape];
      renderShapes(overlay, state.shapes);
      Storage.setAnnotations(state.fileKey, state.shapes);
    };
    // Bound on window, not the overlay: the overlay is only 280px wide
    // while marks can be dragged to the diagram's edges, so releasing the
    // mouse outside the overlay during a normal drag is routine. A
    // window-level listener still fires wherever the cursor is released.
    window.addEventListener('mouseup', activeMouseupHandler);
  }

  return { COLORS, normalizeDrag, mount };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Markup;
