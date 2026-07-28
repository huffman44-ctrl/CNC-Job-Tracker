# Job Layout Sheet Markup — Design Spec

Date: 2026-07-28
Status: Approved by Travis (brainstorming session)

## Goal

Let Travis highlight areas directly on a sheet's Material Border layout diagram — e.g. flagging a spot that needs attention — so the shop floor operator sees it when he opens that sheet. Marks are shared/synced like the rest of the app's per-sheet data, not exported or printed anywhere, and clear themselves out once they've served their purpose.

## Tool

Two shapes — rectangle and ellipse — drawn by click-drag directly on the diagram: press at one corner, drag to the opposite corner, the shape grows live, release locks it in. Three fixed highlight colors reusing the app's existing status palette (`--red`, `--gold`, `--green` — already meaningful elsewhere in the UI, e.g. complete/in-progress/error), semi-transparent fill so the diagram underneath stays visible (a highlight, not an opaque cover). Mouse-only; no touch/pointer handling needed.

Rejected: freehand drawing — more flexible but unnecessary given "highlight an area" is the actual need, and shapes are simpler to build and always look tidy.

## Storage

New Firestore collection **`sheetAnnotations/{fileKey}`** — one doc per sheet, keyed by the same `fileKey` (`simpleHash(filename)`) that namespaces `sheets/`, `completions/`, and `sheetNotes/`. Shape:

```js
{
  shapes: [
    { type: 'rect' | 'ellipse', x, y, w, h, color: 'red' | 'gold' | 'green' }
  ]
}
```

`x`/`y`/`w`/`h` are in the diagram's own SVG `viewBox` coordinate space (inches), not screen pixels, so a mark lands in the same place on the diagram regardless of the viewing device's window size or zoom.

`js/storage.js` gains `getAnnotations` / `setAnnotations` / `loadAnnotations` / `onAnnotationsChange`, copied from the `sheetNotes` pattern: in-memory cache for synchronous reads, cache-first async writes, `onSnapshot` live sync across devices. Saving an empty shape list deletes the doc. Deleting a project deletes its sheet annotations along with its sheets, completions, and notes. The `PASTE` offline-testing escape hatch applies as usual.

## UI

A small toolbar sits above the layout diagram, next to the existing "Material Border" label: a rectangle tool button, an ellipse tool button, three color swatches, and a **Clear marks** button.

- Clicking a shape tool arms it; clicking a swatch sets the active color. With a tool armed, dragging on the diagram draws that shape in the active color at ~30% opacity.
- With no tool armed (the default), the diagram behaves exactly as it does today — the overlay only intercepts mouse events while a tool is actively selected, so normal scrolling/interaction isn't affected.
- Technically: a transparent `<svg>` is layered directly on top of the existing `layout-svg-wrap` diagram, sized identically and sharing its `viewBox`, so coordinates map 1:1. Mouse position is converted from screen pixels to that shared space via the SVG's `getScreenCTM().inverse()`. Each completed drag appends one shape to the sheet's in-memory list, re-renders the overlay, and calls `setAnnotations`.
- **Clear marks** empties the sheet's shape list (`setAnnotations(fileKey, [])`).
- Sheets with `layoutOversize: true` (diagram too large to store even after compression — only a link to the archived file is shown) get no markup toolbar; there's no diagram to draw on.

## Auto-clear on Complete

`applySheetCompletion()` (app.js ~line 659) calls `setAnnotations(fileKey, [])` immediately after a successful **In Progress → Complete** write. This is the only automatic trigger — marks are untouched by the earlier Incomplete → In Progress step, so they survive while a sheet is actively being worked. Reverting a sheet via Clear Record does not restore marks; once cleared, they're gone.

## Error handling

Same regime as `sheetNotes`/`completions`: writes are cache-first so the UI never blocks; Firestore failures log a console warning, nothing more. Live listeners re-render the open sheet's overlay on remote changes, matching `onSheetNoteChange`/`onCompletionChange`.

## Dark mode

No special handling needed — the diagram area (`.layout-svg-scroll`) already forces a white background in dark mode, so the three highlight colors render consistently regardless of app theme.

## Testing

Offline copy with `PASTE` projectId per `CLAUDE.md` (Firebase skipped, in-memory only): draw each shape/color, confirm sync across two browser tabs, confirm Clear marks empties the list, confirm marks auto-clear on the Complete transition but not on the In Progress transition, confirm Clear Record does not restore marks, confirm sheets with `layoutOversize: true` show no toolbar. Browser click-through with screenshots before touching prod.

## Non-goals

- Freehand drawing (rectangle/ellipse only, per Tool section above).
- Touch/tablet input — mouse only.
- Per-shape undo or delete-single-mark — only whole-sheet Clear marks and auto-clear-on-Complete.
- Any export path: marks never appear in CSV export, the printed job ticket, or the archived HTML — purely an in-app, on-screen overlay.
- Any change to `sheetNotes`, completions, or the CSV/archive/Master Job Log pipeline.
