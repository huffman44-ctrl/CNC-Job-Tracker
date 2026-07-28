/**
 * Layout diagram markup: rectangle/ellipse highlights drawn on top of a
 * sheet's Material Border SVG. See js/storage.js's sheetAnnotations
 * functions for persistence; this module owns the drawing/toolbar UI.
 */
const Markup = (() => {
  const COLORS = ['red', 'gold', 'green'];

  // Below this size (in viewBox inches), a drag is treated as an accidental
  // click/jitter rather than a deliberate mark, and is discarded. Also the
  // floor a resize-drag can shrink a mark to before it's deleted instead.
  const MIN_DRAG_SIZE = 0.25;

  // Side length (viewBox inches) of a resize-corner grab handle.
  const HANDLE_SIZE = 0.6;

  const OPPOSITE_CORNER = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

  function cornerPoint(shape, corner) {
    return {
      x: corner.includes('w') ? shape.x : shape.x + shape.w,
      y: corner.includes('n') ? shape.y : shape.y + shape.h,
    };
  }

  // The point diagonally opposite the corner being dragged. Resizing from a
  // corner is just re-dragging from that fixed opposite point, so this feeds
  // straight into normalizeDrag() the same way the initial draw does.
  function resizeAnchor(shape, corner) {
    return cornerPoint(shape, OPPOSITE_CORNER[corner]);
  }

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

  // Zoom is expressed as a multiplier on top of the fit-to-container scale
  // (see fitScale below): 1 = fully zoomed out (the whole sheet visible,
  // which is also the floor — you can't zoom out past "whole sheet fits").
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;

  // px-per-viewBox-unit so a (vbW x vbH) box fits entirely inside a
  // (containerW x containerH) box, preserving aspect ratio.
  function fitScale(vbW, vbH, containerW, containerH) {
    return Math.min(containerW / vbW, containerH / vbH);
  }

  // The default view: fully zoomed out and centered in the container.
  function centeredView(fitW, fitH, containerW, containerH) {
    return { scale: MIN_ZOOM, tx: (containerW - fitW) / 2, ty: (containerH - fitH) / 2 };
  }

  // Zoom by `factor`, keeping the canvas-space point under the cursor
  // (cx, cy — container-relative screen coords) visually fixed in place,
  // the way map/PDF viewers zoom toward the cursor rather than the center.
  function zoomAt(view, cx, cy, factor) {
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
    const applied = newScale / view.scale;
    return {
      scale: newScale,
      tx: cx - (cx - view.tx) * applied,
      ty: cy - (cy - view.ty) * applied,
    };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // armedIndex/onHandleMouseDown are optional: pass them to draw resize
  // handles on the shape at that index (the just-drawn, still-live mark).
  function renderShapes(overlaySvg, shapes, armedIndex, onHandleMouseDown) {
    overlaySvg.innerHTML = '';
    shapes.forEach((shape, i) => {
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
      overlaySvg.appendChild(el);

      if (i === armedIndex && onHandleMouseDown) {
        for (const corner of ['nw', 'ne', 'sw', 'se']) {
          const p = cornerPoint(shape, corner);
          const handle = document.createElementNS(SVG_NS, 'rect');
          handle.setAttribute('x', p.x - HANDLE_SIZE / 2);
          handle.setAttribute('y', p.y - HANDLE_SIZE / 2);
          handle.setAttribute('width', HANDLE_SIZE);
          handle.setAttribute('height', HANDLE_SIZE);
          handle.classList.add('markup-resize-handle');
          handle.dataset.corner = corner;
          handle.addEventListener('mousedown', evt => onHandleMouseDown(corner, evt));
          overlaySvg.appendChild(handle);
        }
      }
    });
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
      state.shapeIndex = null; // switching tools locks in whatever was still resizable
      onToolChange();
    });

    const ellipseBtn = document.createElement('button');
    ellipseBtn.type = 'button';
    ellipseBtn.className = 'markup-tool-btn';
    ellipseBtn.textContent = '◯';
    ellipseBtn.title = 'Draw ellipse';
    ellipseBtn.addEventListener('click', () => {
      state.tool = state.tool === 'ellipse' ? null : 'ellipse';
      state.shapeIndex = null;
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
        state.shapeIndex = null;
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
      state.shapeIndex = null;
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
    if (!toolState.has(fileKey)) toolState.set(fileKey, { tool: null, color: COLORS[0], shapeIndex: null, view: null });
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
    if (!viewBox) return;

    const canvas = document.createElement('div');
    canvas.className = 'layout-svg-canvas';
    baseSvg.replaceWith(canvas);
    canvas.appendChild(baseSvg);

    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('viewBox', viewBox);
    overlay.classList.add('layout-svg-overlay');
    canvas.appendChild(overlay);

    // Fit the sheet to the (fixed-size) scroll container so the whole
    // diagram is visible with no inner scrollbar; scroll-wheel zoom and
    // click-drag pan (below) go beyond this from here.
    const [, , vbW, vbH] = viewBox.trim().split(/\s+/).map(Number);
    const armed = getToolState(sheet.fileKey);
    let containerW, containerH, fitW, fitH;

    function applyView() {
      canvas.style.transform = `translate(${armed.view.tx}px, ${armed.view.ty}px) scale(${armed.view.scale})`;
    }

    // mount() runs while svgWrapEl is still detached (buildSheetDetail
    // builds the sheet's DOM before its caller appends it to the document),
    // so clientWidth/clientHeight read 0 here — defer to the next frame,
    // after insertion, when the container has real layout dimensions.
    function computeFit() {
      containerW = scrollEl.clientWidth;
      containerH = scrollEl.clientHeight;
      const scale0 = fitScale(vbW, vbH, containerW, containerH);
      fitW = vbW * scale0;
      fitH = vbH * scale0;
      baseSvg.style.width = `${fitW}px`;
      baseSvg.style.height = `${fitH}px`;
      overlay.style.width = `${fitW}px`;
      overlay.style.height = `${fitH}px`;
      if (!armed.view) armed.view = centeredView(fitW, fitH, containerW, containerH);
      applyView();
    }
    if (scrollEl.clientWidth > 0) computeFit();
    else requestAnimationFrame(computeFit);
    const state = {
      fileKey: sheet.fileKey,
      shapes: Storage.getAnnotations(sheet.fileKey),
      get tool() { return armed.tool; },
      set tool(v) { armed.tool = v; },
      get color() { return armed.color; },
      set color(v) { armed.color = v; },
      get shapeIndex() { return armed.shapeIndex; },
      set shapeIndex(v) { armed.shapeIndex = v; },
    };
    // shapeIndex may point at a shape that no longer exists (e.g. another
    // tab cleared marks while this one still thought a shape was armed).
    if (state.shapeIndex != null && !state.shapes[state.shapeIndex]) state.shapeIndex = null;

    function redraw() {
      renderShapes(overlay, state.shapes, state.shapeIndex, onHandleMouseDown);
    }

    let resizeDrag = null; // { corner, anchor } while a resize-handle drag is in progress

    function onHandleMouseDown(corner, evt) {
      if (evt.button !== 0) return;
      evt.preventDefault();
      evt.stopPropagation(); // don't let this bubble to the overlay's mousedown below (would start a new draw)
      resizeDrag = { corner, anchor: resizeAnchor(state.shapes[state.shapeIndex], corner) };
    }

    redraw();

    function updateCursor() {
      overlay.classList.toggle('markup-drawing', !!state.tool);
      overlay.classList.toggle('markup-pannable', !state.tool);
    }

    const els = buildToolbar(state, () => {
      updateToolbarUI(els, state);
      updateCursor();
      redraw();
    });
    updateToolbarUI(els, state);
    updateCursor();
    svgWrapEl.insertBefore(els.bar, scrollEl);

    scrollEl.addEventListener('wheel', evt => {
      evt.preventDefault();
      if (!armed.view) return; // computeFit() hasn't run yet (still pending its deferred frame)
      const rect = scrollEl.getBoundingClientRect();
      const factor = Math.pow(1.0015, -evt.deltaY);
      armed.view = zoomAt(armed.view, evt.clientX - rect.left, evt.clientY - rect.top, factor);
      applyView();
    }, { passive: false });

    overlay.addEventListener('dblclick', () => {
      if (fitW === undefined) return;
      armed.view = centeredView(fitW, fitH, containerW, containerH);
      applyView();
    });

    let dragStart = null;
    let panDrag = null; // { startX, startY, startTx, startTy } while panning with no tool armed
    overlay.addEventListener('mousedown', evt => {
      if (evt.button !== 0) return;
      if (state.tool) {
        evt.preventDefault(); // avoid native text-selection/drag over the SVG mid-mark
        dragStart = screenToPoint(overlay, evt);
        return;
      }
      if (!armed.view) return;
      evt.preventDefault();
      panDrag = { startX: evt.clientX, startY: evt.clientY, startTx: armed.view.tx, startTy: armed.view.ty };
      overlay.classList.add('markup-panning');
    });
    overlay.addEventListener('mousemove', evt => {
      if (evt.buttons === 0 && (dragStart || resizeDrag || panDrag)) {
        // The button was released somewhere this tab never saw a mouseup
        // for (e.g. outside the browser window) — self-heal instead of
        // leaving a ghost preview shape that tracks the cursor forever.
        dragStart = null;
        resizeDrag = null;
        panDrag = null;
        overlay.classList.remove('markup-panning');
        redraw();
        return;
      }
      if (panDrag) {
        armed.view = {
          ...armed.view,
          tx: panDrag.startTx + (evt.clientX - panDrag.startX),
          ty: panDrag.startTy + (evt.clientY - panDrag.startY),
        };
        applyView();
        return;
      }
      if (resizeDrag) {
        const p = screenToPoint(overlay, evt);
        const original = state.shapes[state.shapeIndex];
        const preview = { ...original, ...normalizeDrag(resizeDrag.anchor.x, resizeDrag.anchor.y, p.x, p.y) };
        const shapes = state.shapes.slice();
        shapes[state.shapeIndex] = preview;
        renderShapes(overlay, shapes, null, onHandleMouseDown); // hide handles while actively dragging
        return;
      }
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      renderShapes(overlay, [...state.shapes, shape], null, onHandleMouseDown);
    });

    if (activeMouseupHandler) window.removeEventListener('mouseup', activeMouseupHandler);
    activeMouseupHandler = evt => {
      if (panDrag) {
        panDrag = null;
        overlay.classList.remove('markup-panning');
        return;
      }
      if (resizeDrag) {
        const p = screenToPoint(overlay, evt);
        const original = state.shapes[state.shapeIndex];
        const resized = { ...original, ...normalizeDrag(resizeDrag.anchor.x, resizeDrag.anchor.y, p.x, p.y) };
        resizeDrag = null;
        const shapes = state.shapes.slice();
        if (resized.w < MIN_DRAG_SIZE || resized.h < MIN_DRAG_SIZE) {
          // Shrunk past the same jitter threshold a fresh draw uses — remove it.
          shapes.splice(state.shapeIndex, 1);
          state.shapeIndex = null;
        } else {
          shapes[state.shapeIndex] = resized;
        }
        state.shapes = shapes;
        redraw();
        Storage.setAnnotations(state.fileKey, state.shapes);
        return;
      }
      if (!state.tool || !dragStart) return;
      const p = screenToPoint(overlay, evt);
      const shape = { type: state.tool, color: state.color, ...normalizeDrag(dragStart.x, dragStart.y, p.x, p.y) };
      dragStart = null;
      if (shape.w < MIN_DRAG_SIZE || shape.h < MIN_DRAG_SIZE) return; // jitter click, not a deliberate drag — discard
      state.shapes = [...state.shapes, shape];
      state.shapeIndex = state.shapes.length - 1; // stays resizable until the next draw/tool/color change
      redraw();
      Storage.setAnnotations(state.fileKey, state.shapes);
    };
    // Bound on window, not the overlay: marks and pan drags routinely end
    // with the cursor outside the (fixed-size, often zoomed-in) overlay. A
    // window-level listener still fires wherever the cursor is released.
    window.addEventListener('mouseup', activeMouseupHandler);
  }

  return { COLORS, normalizeDrag, resizeAnchor, fitScale, centeredView, zoomAt, mount };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Markup;
