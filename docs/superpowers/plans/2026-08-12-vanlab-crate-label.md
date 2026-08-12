# VanLab Crate Label (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Print Crate Label" button to the tracker's VanLab panel that renders the 4×6 crate label client-side — a pixel-faithful port of `label_generator.py` — completing the sticker package.

**Architecture:** Pure client-side: a new `js/crate-label-pdf.js` module draws the label with pdf-lib (standard Helvetica, no fontkit), a vendored `qrcode-generator` library supplies the QR matrix (drawn as black squares, no PNG step), and the VanLab logo ships pre-trimmed as base64 in a generated `.js` global. No Apps Script changes, no Firestore changes, no console steps.

**Tech Stack:** Vanilla JS (IIFE module pattern), pdf-lib (already vendored), qrcode-generator 1.4.4 (new vendor), Node built-in test runner (`node --test`, vm-sandbox loading), Python/PIL for the one-time logo asset generation.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-vanlab-printing-design.md`, section "Crate label (4×6) — Phase 3 detail". Layout constants must match `label_generator.py` exactly (all conversions at 72 pt/inch) and stay in step with it until the Python tool retires — say so in the module header comment, as `sticker-pdf.js` and `packing-pdf.js` do.
- Colors exact: dark blue `#1F4E79`, accent/mid blue `#2E75B6`, light gray `#F2F2F2`, caption gray `#555555`.
- QR payload is the Python format **minus the `Status:` line**. Error correction M. Quiet-zone border of 2 modules (Python's `border=2`).
- No CDN/network dependencies at runtime — every library is vendored into `js/vendor/` and loaded via `<script>` tag with a `?v=N` cache-bust, matching the existing tags in `index.html`.
- PDFs are saved with `doc.save({ useObjectStreams: false })` — the test harness greps page dicts out of the raw bytes and needs them uncompressed (same choice as `sticker-pdf.js`/`packing-pdf.js`).
- **PII rule:** never a real customer name in tests, fixtures, or docs — use "Sample Customer".
- Work on branch `vanlab-crate-label` off `master` (the tracker is a live daily-use app). Commit at the end of every task. End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run tests with `npm test` (Node's built-in runner over `test/*.test.mjs`); run a single file with `node --test test/<file>.test.mjs`.
- The Python reference implementation lives at `C:\Users\Golden Boys\Documents\Agemtic Workflows\Shop Management for VanLab\CNC-Kit-Management\label_generator.py` (read-only — never modify the Python repo).

---

### Task 1: Vendor qrcode-generator

**Files:**
- Create: `js/vendor/qrcode-generator.js` (downloaded, committed verbatim)
- Test: `test/qrcode-vendor.test.mjs`
- Modify: `index.html` (one script tag)

**Interfaces:**
- Produces: global `qrcode(typeNumber, errorCorrectionLevel)` — call with `(0, 'M')` for auto-sized, M-level correction. The returned object has `.addData(text)`, `.make()`, `.getModuleCount()`, `.isDark(row, col)`. Task 3 consumes this global.

- [ ] **Step 1: Download the library**

```powershell
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js" -OutFile "js/vendor/qrcode-generator.js"
```

(Fallback mirror if jsdelivr fails: `https://unpkg.com/qrcode-generator@1.4.4/qrcode.js`.)

- [ ] **Step 2: Verify the license header survived the download**

Open the first ~20 lines of `js/vendor/qrcode-generator.js` and confirm the MIT license header comment (author Kazuhiko Arase) is present. The file must be committed unmodified.

- [ ] **Step 3: Write the smoke test**

Create `test/qrcode-vendor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = { console };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vendor/qrcode-generator.js'), ctx);
  return ctx.qrcode;
}

test('vendored qrcode-generator produces a QR matrix', () => {
  const qrcode = load();
  const qr = qrcode(0, 'M');
  qr.addData('--- VanLab Kit Info ---\nOrder:    #1234');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(n >= 21, 'module count at least version-1 size, got ' + n);
  // Top-left finder pattern corner is always dark.
  assert.equal(qr.isDark(0, 0), true);
  // Finder pattern ring: (0,7) just outside the 7x7 finder is always light.
  assert.equal(qr.isDark(0, 7), false);
});
```

- [ ] **Step 4: Run the test**

Run: `node --test test/qrcode-vendor.test.mjs`
Expected: PASS (if `ctx.qrcode` is undefined, the UMD wrapper didn't attach to the sandbox global — check that the file downloaded completely).

- [ ] **Step 5: Add the script tag**

In `index.html`, after the `fontkit.umd.min.js` line:

```html
  <script src="js/vendor/qrcode-generator.js?v=1"></script>
```

- [ ] **Step 6: Run the whole suite to confirm nothing broke**

Run: `npm test`
Expected: all existing tests still pass, plus the new one.

- [ ] **Step 7: Commit**

```bash
git add js/vendor/qrcode-generator.js test/qrcode-vendor.test.mjs index.html
git commit -m "feat: vendor qrcode-generator for the crate label QR"
```

---

### Task 2: Logo asset — `js/vanlab-logo.generated.js`

**Files:**
- Create: `tools/make_logo_asset.py`
- Create: `js/vanlab-logo.generated.js` (generated by the tool, committed)
- Test: `test/vanlab-logo.test.mjs`
- Modify: `index.html` (one script tag)

**Interfaces:**
- Produces: global `VanlabLogo = { pngBase64: '<base64 of the trimmed PNG>' }`. Task 4 decodes this with `atob` into a `Uint8Array` and hands it to Task 3's `buildCrateLabelPdf`.

- [ ] **Step 1: Write the generator tool**

Create `tools/make_logo_asset.py`. The trim logic is copied verbatim from `label_generator.py`'s `_load_trimmed_logo` (threshold < 240, 6 px pad) — the Python tool re-trims on every run; we trim once at build time and commit the result.

```python
"""One-time generator for js/vanlab-logo.generated.js.

Trims the whitespace off the VanLab logo PNG (same thresholded bbox the
Python label_generator.py applies at every run: "white" in the source
isn't pure #FFFFFF, so a zero-tolerant bbox would grab the whole canvas)
and writes it as a base64 JS global. Re-run only if the logo changes:

  python tools/make_logo_asset.py "<path to vanlab_logo.png>"
"""
import base64
import io
import os
import sys

from PIL import Image

def trimmed(path):
    img = Image.open(path).convert("RGB")
    mask = img.convert("L").point(lambda p: 255 if p < 240 else 0)
    bbox = mask.getbbox()
    if not bbox:
        return img
    pad = 6
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))

def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python tools/make_logo_asset.py <path to vanlab_logo.png>")
    img = trimmed(sys.argv[1])
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "js", "vanlab-logo.generated.js")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("// GENERATED by tools/make_logo_asset.py — do not edit by hand.\n")
        f.write("// VanLab logo, whitespace-trimmed, for the 4x6 crate label.\n")
        f.write("const VanlabLogo = {\n  pngBase64:\n")
        for i in range(0, len(b64), 100):
            f.write("    '" + b64[i:i + 100] + "' +\n")
        f.write("    '',\n};\n")
    print(f"wrote {out} ({img.width}x{img.height} px, {len(b64)} base64 chars)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the tool against the real logo**

```powershell
python tools/make_logo_asset.py "C:\Users\Golden Boys\Documents\Agemtic Workflows\Shop Management for VanLab\CNC-Kit-Management\vanlab_logo.png"
```

Expected: prints the trimmed dimensions and writes `js/vanlab-logo.generated.js`. Sanity: the source PNG is 77 KB, so expect roughly 60–110 K base64 chars.

- [ ] **Step 3: Write the asset test**

Create `test/vanlab-logo.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = { console };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vanlab-logo.generated.js') + '\nthis.VanlabLogo = VanlabLogo;', ctx);
  return ctx.VanlabLogo;
}

test('generated logo asset decodes to a real PNG', () => {
  const logo = load();
  const bytes = Buffer.from(logo.pngBase64, 'base64');
  // PNG signature: 137 80 78 71 13 10 26 10
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.length > 10000, 'logo suspiciously small: ' + bytes.length + ' bytes');
});
```

- [ ] **Step 4: Run the test**

Run: `node --test test/vanlab-logo.test.mjs`
Expected: PASS

- [ ] **Step 5: Add the script tag**

In `index.html`, after the `sticker-map.generated.js` line:

```html
  <script src="js/vanlab-logo.generated.js?v=1"></script>
```

- [ ] **Step 6: Commit**

```bash
git add tools/make_logo_asset.py js/vanlab-logo.generated.js test/vanlab-logo.test.mjs index.html
git commit -m "feat: pre-trimmed VanLab logo asset for the crate label"
```

---

### Task 3: `js/crate-label-pdf.js` — the label renderer

**Files:**
- Create: `js/crate-label-pdf.js`
- Test: `test/crate-label-pdf.test.mjs`
- Modify: `index.html` (one script tag)

**Interfaces:**
- Consumes: globals `PDFLib` (vendored pdf-lib), `qrcode` (Task 1), `StickerPdf.wrapText(text, maxWidth, size, widthFn)` from `js/sticker-pdf.js` — the existing greedy word-wrap, which is the same algorithm as the Python `_wrap_value`.
- Produces: global `CrateLabelPdf` with:
  - `qrText(order)` → `string` — the QR payload.
  - `buildCrateLabelPdf(order, logoPngBytes)` → `Promise<Uint8Array>` — one-page 288×432 pt PDF. `logoPngBytes` is a `Uint8Array` or `null`; `null` or un-embeddable bytes fall back to the placeholder box (the print must never fail over the logo).
  - `order` shape (all strings): `{ orderNum, vanName, assembly, customer, datePacked }`. Blank `assembly` renders as `—` on the label and `N/A` in the QR. `datePacked` is preformatted `MM/DD/YYYY` (caller's job).

- [ ] **Step 1: Write the failing tests**

Create `test/crate-label-pdf.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function load() {
  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array };
  ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/vendor/pdf-lib.min.js'), ctx);
  vm.runInContext(read('js/vendor/qrcode-generator.js'), ctx);
  vm.runInContext(read('js/sticker-pdf.js') + '\nthis.StickerPdf = StickerPdf;', ctx);
  vm.runInContext(read('js/crate-label-pdf.js') + '\nthis.CrateLabelPdf = CrateLabelPdf;', ctx);
  return ctx.CrateLabelPdf;
}

const ORDER = {
  orderNum: '#1234',
  vanName: '21: Mercedes Sprinter 144" (2018-Present)',
  assembly: '3806',
  customer: 'Sample Customer',
  datePacked: '08/12/2026',
};

test('qrText matches the Python payload format, minus the Status line', () => {
  const c = load();
  assert.equal(c.qrText(ORDER),
    '--- VanLab Kit Info ---\n' +
    'Order:    #1234\n' +
    'Van:      21: Mercedes Sprinter 144" (2018-Present)\n' +
    'Assembly: 3806\n' +
    'Customer: Sample Customer\n' +
    'Packed:   08/12/2026\n' +
    '-----------------------');
});

test('qrText: blank assembly becomes N/A, blank customer stays blank', () => {
  const c = load();
  const t = c.qrText({ ...ORDER, assembly: '', customer: '' });
  assert.ok(t.includes('Assembly: N/A\n'));
  assert.ok(t.includes('Customer: \n'));
});

test('buildCrateLabelPdf renders one 4x6 page', async () => {
  const c = load();
  const bytes = await c.buildCrateLabelPdf(ORDER, null);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.equal(text.slice(0, 5), '%PDF-');
  assert.equal(text.match(/\/Type\s*\/Page[^s]/g).length, 1);
  // 4in x 6in at 72pt/in
  assert.ok(/MediaBox\s*\[\s*0\s+0\s+288\s+432\s*\]/.test(text), 'wrong page size');
});

test('real logo bytes embed without error', async () => {
  const c = load();
  const ctx2 = { console };
  ctx2.self = ctx2; ctx2.window = ctx2; ctx2.globalThis = ctx2;
  vm.createContext(ctx2);
  vm.runInContext(read('js/vanlab-logo.generated.js') + '\nthis.VanlabLogo = VanlabLogo;', ctx2);
  const logoBytes = new Uint8Array(Buffer.from(ctx2.VanlabLogo.pngBase64, 'base64'));
  const bytes = await c.buildCrateLabelPdf(ORDER, logoBytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('garbage logo bytes fall back to the placeholder instead of throwing', async () => {
  const c = load();
  const bytes = await c.buildCrateLabelPdf(ORDER, new Uint8Array([1, 2, 3, 4]));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/crate-label-pdf.test.mjs`
Expected: FAIL — `crate-label-pdf.js` doesn't exist yet.

- [ ] **Step 3: Write the module**

Create `js/crate-label-pdf.js`. Every constant is the `label_generator.py` value converted at 72 pt/inch — keep the Python expressions in comments so drift is auditable.

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/crate-label-pdf.test.mjs`
Expected: PASS (all five)

- [ ] **Step 5: Add the script tag**

In `index.html`, after the `packing-pdf.js` line (crate-label-pdf.js must load before app.js):

```html
  <script src="js/crate-label-pdf.js?v=1"></script>
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add js/crate-label-pdf.js test/crate-label-pdf.test.mjs index.html
git commit -m "feat: 4x6 crate label renderer (port of label_generator.py)"
```

---

### Task 4: Panel wiring — button, manual fields, status messages

**Files:**
- Modify: `index.html` (VanLab panel markup, ~lines 226–240; bump `js/app.js?v=24` → `?v=25`)
- Modify: `js/app.js` (VanLab Printing section, ~lines 1553–1747)

**Interfaces:**
- Consumes: `CrateLabelPdf.buildCrateLabelPdf(order, logoPngBytes)` and global `VanlabLogo.pngBase64` (Tasks 2–3); existing panel state: `vanlabOrder` (lookup result `{orderNum, customer, vanRaw, vanKey, assembly}` or `null`), `vanlabVanSelect`, `vanlabSetStatus(text, isError)`, `vanlabShowManualPicker()`, `vanlabOpenPanel()`.
- Produces: the user-facing "Print Crate Label" button; no new exports.

- [ ] **Step 1: Add the panel markup**

In `index.html`, inside `.vanlab-actions`, after the `vanlab-packing-btn` button, add:

```html
        <button class="btn btn-primary btn-sm" id="vanlab-crate-btn" disabled>Print Crate Label</button>
        <span id="vanlab-manual-fields" hidden>
          <label class="form-label" for="vanlab-manual-order">Order #</label>
          <input id="vanlab-manual-order" class="form-input vanlab-van-select" placeholder="e.g. 1234">
          <label class="form-label" for="vanlab-manual-customer">Customer</label>
          <input id="vanlab-manual-customer" class="form-input vanlab-van-select" placeholder="for the QR code">
          <label class="form-label" for="vanlab-manual-assembly">Assembly #</label>
          <input id="vanlab-manual-assembly" class="form-input vanlab-van-select" placeholder="blank if none">
        </span>
```

(The manual fields feed only the crate label — stickers and packing lists never needed them — so they live with the crate button and appear only in manual-fallback mode.)

- [ ] **Step 2: Wire it in app.js**

All edits are inside the `VanLab Printing` section of `js/app.js`.

**2a.** With the other element lookups (after the `vanlabPackingBtn` line), add:

```js
const vanlabCrateBtn      = document.getElementById('vanlab-crate-btn');
const vanlabManualFields  = document.getElementById('vanlab-manual-fields');
const vanlabManualOrder   = document.getElementById('vanlab-manual-order');
const vanlabManualCustomer = document.getElementById('vanlab-manual-customer');
const vanlabManualAssembly = document.getElementById('vanlab-manual-assembly');
let vanlabCrateBlobUrl = null;  // last crate-label object URL, revoked before a new one
```

**2b.** In `vanlabShowManualPicker()`: add `vanlabCrateBtn.disabled = true;` and `vanlabManualFields.hidden = false;` next to the existing disables, and extend the `onchange` handler with `vanlabCrateBtn.disabled = !vanlabVanSelect.value;`.

**2c.** In `vanlabOpenPanel()`'s reset block (next to `vanlabPackingBtn.disabled = true;`): add

```js
  vanlabCrateBtn.disabled = true;
  vanlabManualFields.hidden = true;
  vanlabManualOrder.value = '';
  vanlabManualCustomer.value = '';
  vanlabManualAssembly.value = '';
```

and where a successful lookup enables the other buttons (`vanlabPackingBtn.disabled = false;`), add `vanlabCrateBtn.disabled = false;`.

**2d.** Add the print handler and its date helper after `vanlabPrintPacking`:

```js
function vanlabToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear();
}

async function vanlabPrintCrate() {
  let order;
  if (vanlabOrder) {
    order = {
      orderNum: vanlabOrder.orderNum || '',
      vanName: vanlabOrder.vanRaw || ('Van ' + vanlabOrder.vanKey),
      assembly: vanlabOrder.assembly || '',
      customer: vanlabOrder.customer || '',
      datePacked: vanlabToday(),
    };
  } else {
    const orderNum = vanlabManualOrder.value.trim();
    if (!orderNum) {
      vanlabSetStatus('Type the order number first — the crate label prints it and encodes it in the QR.', true);
      return;
    }
    order = {
      orderNum,
      vanName: 'Van ' + vanlabVanSelect.value,
      assembly: vanlabManualAssembly.value.trim(),
      customer: vanlabManualCustomer.value.trim(),
      datePacked: vanlabToday(),
    };
  }
  vanlabCrateBtn.disabled = true;
  vanlabSetStatus('Building the crate label…');
  try {
    let logoBytes = null;
    try {
      logoBytes = Uint8Array.from(atob(VanlabLogo.pngBase64), (c) => c.charCodeAt(0));
    } catch {
      // buildCrateLabelPdf falls back to its placeholder box; the label
      // must never fail to print over the logo.
    }
    const bytes = await CrateLabelPdf.buildCrateLabelPdf(order, logoBytes);
    if (vanlabCrateBlobUrl) URL.revokeObjectURL(vanlabCrateBlobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    vanlabCrateBlobUrl = url;
    if (!window.open(url, '_blank')) {
      vanlabSetStatus('Popup blocked — allow popups for this site, then click Print Crate Label again.', true);
      return;
    }
    vanlabSetStatus(`Crate label for order ${order.orderNum} ready — print the opened PDF on the CRATE LABEL 4x6 printer at 100% scale.`);
  } catch (err) {
    vanlabSetStatus(`Couldn't build the crate label — ${err.message}`, true);
  } finally {
    vanlabCrateBtn.disabled = false;
  }
}
```

**2e.** With the other listeners at the bottom of the section:

```js
vanlabCrateBtn.addEventListener('click', vanlabPrintCrate);
```

**2f.** Update the section banner comment from `(Phase 1: hardware stickers)` to `(hardware stickers, packing lists, crate label)`.

- [ ] **Step 3: Bump the cache-bust version**

In `index.html`: `js/app.js?v=24` → `js/app.js?v=25`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all pass (this task adds no unit tests — the handler is DOM glue, and the app has no DOM harness; behavior is covered by the manual matrix below).

- [ ] **Step 5: Manual browser test matrix**

Run `npm run serve`, open the printed URL, sign in, then verify:

1. **Lookup path:** open a VanLab job whose sheets carry an order number → panel shows the order line → click Print Crate Label → a 4×6 PDF opens: logo, Kit/Assembly/Order/Date block, QR, blue footer. Scan the QR with a phone: five fields, no Status line.
2. **Manual path:** open a job with no order number in its filenames → manual picker + the three new fields appear → pick a van, type an order number → label opens with "Van NN" as the Kit line.
3. **Manual path, no order number:** click Print Crate Label with the order field empty → red status message, no PDF.
4. **Long van name:** use a job (or manual entry is fine — the wrap runs on whatever Kit text renders) whose van name exceeds one line, e.g. van 21's `21: Mercedes Sprinter 144" (2018-Present)` → the Kit value wraps to two lines without clipping the right edge.
5. **Popup blocker:** with popups blocked for the site, click Print Crate Label → the "allow popups" status appears.

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: Print Crate Label button with manual-fallback fields"
```

---

### Task 5: Ship gates (not code — tracked so nothing silently skips)

**Files:** none (verification only)

- [ ] **Step 1: Full suite green** — `npm test`, all tests pass.
- [ ] **Step 2: Final whole-branch review** — adversarial review of the complete `vanlab-crate-label` diff before merge (this review caught the real bugs in Phases 1 and 2 both).
- [ ] **Step 3: Parity print** — generate the same real order's label from the web panel and from `python label_generator.py --order "#NNNN"`; print both, compare side by side. Expected differences only: no Status line when the QR is scanned; square placeholder corners (only visible if the logo ever fails).
- [ ] **Step 4: Merge + go-live** — merge to master, then the **go-live skill** (push, confirm the Pages build finished, hard-refresh the shop-floor PC).
- [ ] **Step 5: Floor test** — a real crate label printed on the CRATE LABEL 4x6 thermal (D450BT) at 100% scale, QR scans from the printed label. Phase 3 is "done" only after this. **Do not floor-print vans 39/42** (sticker quantities still unconfirmed with VanLab — unrelated to the label, but the panel prints all three documents, so steer the test to a different van's order).
