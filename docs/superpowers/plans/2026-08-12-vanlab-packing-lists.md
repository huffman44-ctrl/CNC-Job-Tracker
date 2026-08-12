# VanLab Packing Lists in the Job Tracker — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collin prints an order's stamped packing list from the VanLab panel — the template PDF is fetched from a Google Drive folder through the sign-in-verified Apps Script bridge and stamped in the browser with the order's header band.

**Architecture:** The bridge (`apps-script/logging-endpoint.gs`) gains a `getPackingPdf` action that verifies the caller's Firebase ID token (same helper as `lookupOrder`) and serves one exact-named PDF from a designated Drive folder as base64. Client-side: a hand-ported packing map (van → template filename, honesty rules included), a port of the Python assembly-level decoder, and a pdf-lib stamper that draws the blue header band on page 1. The existing VanLab panel gains a **Print Packing List** button and an SUV variant picker.

**Tech Stack:** Vanilla JS (IIFE modules, browser globals — no bundler), pdf-lib 1.17.1 (already vendored; standard Helvetica fonts, **no fontkit needed for stamping**), Google Apps Script, `node --test` (`.mjs` tests, `vm` sandbox pattern).

**Spec:** `docs/superpowers/specs/2026-08-11-vanlab-printing-design.md` (Phase 2 scope; revised 2026-08-12: Drive-via-bridge instead of Firebase Storage).

## Global Constraints

- One repo is touched: the tracker at `C:\Users\Golden Boys\Documents\Agemtic Workflows\CNC_WebApp\` (public GitHub repo — **no secrets, no real customer names, ever**). All paths below are relative to `CNC_WebApp\`. The Python tools repo is NOT modified in this phase.
- Test fixtures use fake customer names only (PII rule). `Jane Sample`, `Order Fixture LLC` are fine.
- No new JS libraries. pdf-lib is already vendored at `js/vendor/pdf-lib.min.js`.
- Endpoint requests keep `Content-Type: text/plain;charset=utf-8` (anything else breaks Apps Script CORS — see `js/endpoint.js` header comment).
- The `.gs` file in the repo is a TEMPLATE with `PASTE_*` placeholder constants. Never put real IDs/keys in it. The live script (script.google.com) carries the real values; Task 7 syncs it. **Never paste the repo template wholesale over the live script** — it would wipe the real constants. Add only the new lines.
- Existing bridge actions (`archive`, `appendRows`, `lookupOrder`) and their tests must keep passing untouched.
- `index.html` script tags use `?v=N` cache-busting — bump the version of every JS file you modify, and give new files `?v=1`.
- JS files are browser globals loaded by script tag (IIFE pattern like `Auth`, `Endpoint`, `VanlabPrint`) — no `export`/`import` in `js/*.js`. Tests load them with `vm` (see `test/vanlab-print.test.mjs` for the pattern, and its `plain()` JSON round-trip helper for comparing values across V8 realms).
- Run tests with `node --test` from `CNC_WebApp\`.
- Commit messages are plain sentences describing the change (repo style: `add VanLab hardware sticker printing panel to the job view`).

## File Structure

| File | Responsibility |
|---|---|
| `js/assembly-levels.js` (new) | Decode a `van-level` assembly number into the four YES/no options. Port of `assembly_levels.py`. |
| `js/packing-map.js` (new) | Van key → template PDF filename, with none-needed / conflicted / ambiguous-SUV honesty rules. Port of `packing_map.py`'s tables and `resolve`. |
| `js/packing-pdf.js` (new) | Stamp the blue header band onto page 1 of a template PDF with pdf-lib. Port of `stamp.py`. Depends on `AssemblyLevels`. |
| `apps-script/logging-endpoint.gs` (modify) | New `getPackingPdf` action: ID-token-verified, single exact-named file from the designated Drive folder, base64 out. |
| `js/endpoint.js` (modify) | New `Endpoint.getPackingPdf(fileName, idToken)` client call. |
| `index.html` + `js/app.js` (modify) | Print Packing List button, SUV variant picker, status wiring in the existing VanLab panel. |

The Python sources being ported (read them before porting): `C:\Users\Golden Boys\Documents\Agemtic Workflows\Shop Management for VanLab\CNC-Kit-Management\packing_map.py`, `assembly_levels.py`, `stamp.py`.

---

### Task 1: `js/assembly-levels.js` — assembly-level decoder

**Files:**
- Create: `js/assembly-levels.js`
- Test: `test/assembly-levels.test.mjs`

**Interfaces:**
- Produces: browser global `AssemblyLevels` with `decode(assembly)` → `[[featureName, includedBool], ...]` (4 pairs, order Panelling/Sink/Hex Flooring/Wiring) or `null` when the assembly can't be decoded. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `test/assembly-levels.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/assembly-levels.js'), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.AssemblyLevels = AssemblyLevels;', ctx);
  return ctx.AssemblyLevels;
}

// vm-realm data compared via JSON round-trip (same rationale as vanlab-print.test.mjs).
const plain = (v) => JSON.parse(JSON.stringify(v));

test('decodes 21-08 (Panelling YES, Sink no, Hex no, Wiring YES)', () => {
  assert.deepEqual(plain(load().decode('21-08')), [
    ['Panelling', true], ['Sink', false], ['Hex Flooring', false], ['Wiring', true],
  ]);
});

test('single-digit level is zero-padded: 13-1 means level 01 (all no)', () => {
  assert.deepEqual(plain(load().decode('13-1')), [
    ['Panelling', false], ['Sink', false], ['Hex Flooring', false], ['Wiring', false],
  ]);
});

test('unknown level number decodes to null', () => {
  assert.equal(load().decode('21-99'), null);
});

test('non-matching shapes decode to null: bare model number, garbage, blank, null', () => {
  const a = load();
  assert.equal(a.decode('3806'), null);
  assert.equal(a.decode('garbage'), null);
  assert.equal(a.decode(''), null);
  assert.equal(a.decode(null), null);
});

test('surrounding whitespace is tolerated', () => {
  assert.notEqual(load().decode('  21-08  '), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/assembly-levels.test.mjs`
Expected: FAIL — cannot read `js/assembly-levels.js` (file does not exist).

- [ ] **Step 3: Implement `js/assembly-levels.js`**

```js
/**
 * Assembly-level decoding: the "-NN" suffix of an assembly number -> which of
 * the four kit options are included. Port of assembly_levels.py — keep the
 * two level tables in step until the Python tool retires.
 */
const AssemblyLevels = (() => {
  // Display order for the four options (columns J-M of the Order Log's
  // "Assembly Numbering" tab).
  const FEATURES = ['Panelling', 'Sink', 'Hex Flooring', 'Wiring'];

  // Level -> the four options, in FEATURES order. Hardcoded source of truth;
  // update here (and in the Python tool) if VanLab revises the definitions.
  const ASSEMBLY_LEVELS = {
    '01': [false, false, false, false],
    '02': [false, false, false, true],
    '03': [false, false, true,  true],
    '04': [false, true,  true,  true],
    '05': [false, true,  false, true],
    '06': [false, true,  false, false],
    '07': [true,  false, false, false],
    '08': [true,  false, false, true],
    '09': [true,  false, true,  true],
    '10': [true,  true,  true,  true],
    '11': [true,  true,  false, true],
    '12': [true,  true,  false, false],
    '13': [false, true,  true,  false],
    '14': [true,  true,  true,  false],
  };

  function parseLevel(assembly) {
    if (!assembly) return null;
    const m = String(assembly).match(/^\s*\d{1,2}-(\d{1,2})\s*$/);
    if (!m) return null;
    const level = m[1].padStart(2, '0');
    return ASSEMBLY_LEVELS[level] ? level : null;
  }

  function decode(assembly) {
    const level = parseLevel(assembly);
    if (level === null) return null;
    return FEATURES.map((name, i) => [name, ASSEMBLY_LEVELS[level][i]]);
  }

  return { decode };
})();
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/assembly-levels.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/assembly-levels.js test/assembly-levels.test.mjs
git commit -m "add assembly-level decoder for VanLab packing list stamps"
```

---

### Task 2: `js/packing-map.js` — van → template resolution

**Files:**
- Create: `js/packing-map.js`
- Test: `test/packing-map.test.mjs`

**Interfaces:**
- Produces: browser global `PackingMap` with:
  - `resolve(vanKey, assembly, suvChoice)` → `{ status: 'matched'|'none_needed'|'missing'|'ambiguous', file: string|null, reason: string }`. `suvChoice` is `'full'|'bed'|'kitchen'|null` (the panel picker's answer; overrides auto-detection).
  - `SUV_VARIANTS` → `{ full: <filename>, bed: <filename>, kitchen: <filename> }` (Task 6 builds the picker from its keys).
- Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `test/packing-map.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/packing-map.js'), 'utf8');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.PackingMap = PackingMap;', ctx);
  return ctx.PackingMap;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('mapped van resolves to its exact template filename', () => {
  assert.deepEqual(plain(load().resolve('13', '', null)), {
    status: 'matched', file: 'Van 13_ NV200 Fitting Kit.pdf', reason: '',
  });
});

test('van 40 is none_needed with a visible reason, not a failure', () => {
  const r = load().resolve('40', '', null);
  assert.equal(r.status, 'none_needed');
  assert.equal(r.file, null);
  assert.match(r.reason, /no packing list required/);
});

test('van 39 stays blocked on the numbering conflict', () => {
  const r = load().resolve('39', '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /numbering conflict/);
  assert.match(r.reason, /verify with VanLab/);
});

test('unmapped van says which van has no mapping', () => {
  const r = load().resolve('99', '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /van 99/);
});

test('null vanKey is missing with a clear reason', () => {
  const r = load().resolve(null, '', null);
  assert.equal(r.status, 'missing');
  assert.match(r.reason, /not recognized/);
});

test('SUV with a variant keyword in the assembly field auto-matches', () => {
  assert.equal(load().resolve('SUV01', 'SUV Full Kit', null).file,
    'SUV01  SUV01 Full Kit.pdf');
  assert.equal(load().resolve('SUV01', 'kitchen build', null).file,
    'SUV01  SUV01 kITCHEN Only.pdf');
});

test('keyword match is whole-word: "bedding"/"fully" do not match', () => {
  const r = load().resolve('SUV01', 'bedding fully loaded', null);
  assert.equal(r.status, 'ambiguous');
});

test('keyword precedence is kitchen > bed > full (mirrors the Python tool)', () => {
  assert.equal(load().resolve('SUV01', 'full kitchen', null).file,
    'SUV01  SUV01 kITCHEN Only.pdf');
});

test('SUV with no keyword is ambiguous until the picker answers', () => {
  const r = load().resolve('SUV01', '', null);
  assert.equal(r.status, 'ambiguous');
  assert.match(r.reason, /Full\/Bed\/Kitchen/);
});

test('an explicit picker choice overrides auto-detection', () => {
  assert.equal(load().resolve('SUV01', 'full kit', 'bed').file,
    'SUV01  SUV01 Bed Only.pdf');
});

test('every SUV_VARIANTS value is a .pdf filename', () => {
  const v = load().SUV_VARIANTS;
  assert.deepEqual(Object.keys(plain(v)).sort(), ['bed', 'full', 'kitchen']);
  for (const f of Object.values(plain(v))) assert.match(f, /\.pdf$/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/packing-map.test.mjs`
Expected: FAIL — cannot read `js/packing-map.js`.

- [ ] **Step 3: Implement `js/packing-map.js`**

The filenames below are copied verbatim from `packing_map.py` (`VAN_TO_PDF`, `SUV_VARIANTS`) and must match the PDFs in the Drive folder byte-for-byte — including double spaces and the lowercase-k `kITCHEN`.

```js
/**
 * Van -> packing-list template resolution, with the Python tool's honesty
 * rules: none-needed vans say so, the van-39 numbering conflict stays
 * blocked, SUVs without a variant are ambiguous (never guessed). Port of
 * packing_map.py — keep the two in step until the Python tool retires.
 * Pure logic, no DOM, no fetch; the bridge checks actual file existence.
 */
const PackingMap = (() => {
  // van_key -> exact PDF filename in the Drive library folder.
  const VAN_TO_PDF = {
    '13': 'Van 13_ NV200 Fitting Kit.pdf',
    '15': 'Van 15_ Transit 148 Passenger.pdf',
    '21': 'Van 21_ Mercedes Sprinter 144_ Cargo.pdf',
    '22': 'Van 22_ Transit 148_ Cargo.pdf',
    '25': 'Van 25_ Transit 148_ Cargo Extended WIDE.pdf',
    '27': 'Van 27_ Transit 148_ Cargo Extended.pdf',
    '28': 'Van 28_ Ram Promaster 159_ N_S.pdf',
    '29': 'Van 29_ Ram Promaster 159_  EW.pdf',
    '30': 'Van 30_ Mercedes Sprinter 170_ N_S.pdf',
    '31': 'Van 31_ Ram Promaster 159_  EW CREW.pdf',
    '32': 'Van 32_ Ford ESeries 350 EXT CARGO.pdf',
    '33': 'Van 33_ Ford ESeries 350 EXT PASSENGER.pdf',
    '34': 'Van 34_ Ford ESeries 350 REG CARGO.pdf',
    '35': 'Van 35_ GMC Savana_Chevy Express 135 Cargo.pdf',
    '36': 'Van 36_ GMC Savana_Chevy Express 135 PASSENGER.pdf',
    '37': 'Van 37_ GMC Savana_Chevy Express 155_ Cargo.pdf',
    '39': 'Van 39_ Ford ESeries SWB PASSENGER.pdf',
    '42': 'Van 42_ Ford Transit Connect.pdf',
    '44': 'Van44_Native Fitting Kit_Kit 2-5 - Fitting Kit Check List.pdf',
  };

  // Vans that intentionally have no packing list (install-only jobs).
  const NONE_NEEDED_VANS = {
    '40': 'panel-install / no packing list required',
  };

  // Van numbering conflicts — flag for a human instead of guessing.
  // (Same wording as packing_map.py; delete the entry when VanLab confirms.)
  const CONFLICTED_VANS = {
    '39': 'van numbering conflict: Order Log says Transit Connect, PDF library '
        + 'says ESeries SWB Passenger - verify with VanLab before packing',
  };

  const SUV_VARIANTS = {
    full: 'SUV01  SUV01 Full Kit.pdf',
    bed: 'SUV01  SUV01 Bed Only.pdf',
    kitchen: 'SUV01  SUV01 kITCHEN Only.pdf',
  };

  // Whole-word search, kitchen > bed > full precedence, so substrings like
  // 'bedding' or 'fully' don't false-match (mirrors _find_variant_keyword).
  function findVariantKeyword(text) {
    const s = String(text || '').toLowerCase();
    for (const keyword of ['kitchen', 'bed', 'full']) {
      if (new RegExp('\\b' + keyword + '\\b').test(s)) return keyword;
    }
    return null;
  }

  function resolve(vanKey, assembly, suvChoice) {
    if (!vanKey) {
      return { status: 'missing', file: null, reason: 'van not recognized from the Order Log entry' };
    }
    if (vanKey === 'SUV01') {
      const keyword = suvChoice || findVariantKeyword(assembly);
      if (!keyword) {
        return { status: 'ambiguous', file: null, reason: 'SUV order does not specify Full/Bed/Kitchen' };
      }
      return { status: 'matched', file: SUV_VARIANTS[keyword], reason: '' };
    }
    if (NONE_NEEDED_VANS[vanKey]) {
      return { status: 'none_needed', file: null, reason: NONE_NEEDED_VANS[vanKey] };
    }
    if (CONFLICTED_VANS[vanKey]) {
      return { status: 'missing', file: null, reason: CONFLICTED_VANS[vanKey] };
    }
    if (VAN_TO_PDF[vanKey]) {
      return { status: 'matched', file: VAN_TO_PDF[vanKey], reason: '' };
    }
    return { status: 'missing', file: null, reason: 'no packing list mapped for van ' + vanKey };
  }

  return { resolve, SUV_VARIANTS };
})();
```

Note: `CONFLICTED_VANS` is checked before `VAN_TO_PDF`, so van 39 blocks even though it has a mapping — same as the Python tool.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/packing-map.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/packing-map.js test/packing-map.test.mjs
git commit -m "add van-to-packing-list resolution with the Python tool's honesty rules"
```

---

### Task 3: `js/packing-pdf.js` — header-band stamping

**Files:**
- Create: `js/packing-pdf.js`
- Test: `test/packing-pdf.test.mjs`

**Interfaces:**
- Consumes: `AssemblyLevels.decode(assembly)` (Task 1); globals `PDFLib` (vendored).
- Produces: browser global `PackingPdf` with:
  - `stampText(order)` → `'1204  |  Jane Sample  |  Assembly 21-08'` (empty parts dropped).
  - `optionsText(order)` → `'Panelling: YES    Sink: no    Hex Flooring: no    Wiring: YES'` or the warning string when undecodable.
  - `stampPdf(templateBytes, order)` → `Promise<Uint8Array>`; `order` is `{ orderNum, customer, assembly }` (the lookup result shape; missing fields tolerated).
- Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `test/packing-pdf.test.mjs`. The vm context loads pdf-lib the same way `test/sticker-pdf.test.mjs` does; a 2-page blank "template" is built inside the same context so realm types match.

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
  vm.runInContext(read('js/assembly-levels.js'), ctx);
  vm.runInContext(read('js/packing-pdf.js')
    + '\nthis.PackingPdf = PackingPdf; this.PDFLibRef = PDFLib;', ctx);
  return ctx;
}

async function makeTemplate(ctx, pages) {
  const doc = await ctx.PDFLibRef.PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]); // letter
  return doc.save({ useObjectStreams: false });
}

const ORDER = { orderNum: '1204', customer: 'Jane Sample', assembly: '21-08' };

test('stampText joins order, customer, assembly with pipes', () => {
  assert.equal(load().PackingPdf.stampText(ORDER),
    '1204  |  Jane Sample  |  Assembly 21-08');
});

test('stampText drops missing parts instead of printing blanks', () => {
  assert.equal(load().PackingPdf.stampText({ orderNum: '1204', customer: '', assembly: '' }),
    '1204');
});

test('optionsText decodes a known level', () => {
  assert.equal(load().PackingPdf.optionsText(ORDER),
    'Panelling: YES    Sink: no    Hex Flooring: no    Wiring: YES');
});

test('optionsText warns when the assembly cannot be decoded', () => {
  assert.equal(load().PackingPdf.optionsText({ orderNum: '1204', customer: 'x', assembly: '3806' }),
    '! Options not specified - check the order sheet');
});

test('stampPdf keeps every page and returns a real PDF', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 3);
  const out = await ctx.PackingPdf.stampPdf(template, ORDER);
  assert.equal(new TextDecoder().decode(out.slice(0, 5)), '%PDF-');
  // 3 pages in -> 3 pages out (band is an overlay, not a new page)
  assert.equal(new TextDecoder().decode(out).match(/\/Type\s*\/Page[^s]/g).length, 3);
  // The stamped file must be bigger: band rectangle + two text runs + fonts.
  assert.ok(out.length > template.length);
});

test('stampPdf tolerates an order with only a number (manual fallback path)', async () => {
  const ctx = load();
  const template = await makeTemplate(ctx, 1);
  const out = await ctx.PackingPdf.stampPdf(template, { orderNum: '', customer: '', assembly: '' });
  assert.equal(new TextDecoder().decode(out.slice(0, 5)), '%PDF-');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/packing-pdf.test.mjs`
Expected: FAIL — cannot read `js/packing-pdf.js`.

- [ ] **Step 3: Implement `js/packing-pdf.js`**

Layout constants are ports of `stamp.py`: 42pt band, `#1F4E79`, bold 11pt at `(10, height-17)`, regular 9pt at `(10, height-33)`. reportlab's `drawString` and pdf-lib's `drawText` both position by baseline, so the coordinates carry over unchanged.

```js
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/packing-pdf.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/packing-pdf.js test/packing-pdf.test.mjs
git commit -m "add packing-list header-band stamping with pdf-lib"
```

---

### Task 4: bridge `getPackingPdf` action

**Files:**
- Modify: `apps-script/logging-endpoint.gs` (constants block ~line 7-17, action routing in `doPost` ~line 39-42, new function after `lookupOrder`)
- Test: `test/get-packing-pdf.test.mjs`

**Interfaces:**
- Consumes: existing `verifyFirebaseIdToken(idToken)` and `jsonOut(obj)` in the same file.
- Produces: bridge action `{ action: 'getPackingPdf', fileName, idToken, token }` → `{ ok: true, pdfBase64: <string> }` or `{ ok: false, error: <string> }`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `test/get-packing-pdf.test.mjs` (sandbox pattern copied from `test/lookup-order.test.mjs`; `DriveApp` and `Utilities` are the new mocks):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../apps-script/logging-endpoint.gs'),
  'utf8'
);
source = source
  .replace("'PASTE_PACKING_FOLDER_ID'", "'PACKFOLDER1'")
  .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
const KNOWN_FILE = 'Van 13_ NV200 Fitting Kit.pdf';

const plain = (v) => JSON.parse(JSON.stringify(v));

function makeContext({ tokenValid = true } = {}) {
  const sandbox = {
    DriveApp: {
      getFolderById(id) {
        assert.equal(id, 'PACKFOLDER1');
        return {
          getFilesByName(name) {
            const found = name === KNOWN_FILE;
            return {
              hasNext() { return found; },
              next() {
                return { getBlob() { return { getBytes() { return PDF_BYTES; } }; } };
              },
            };
          },
        };
      },
    },
    Utilities: {
      base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
    },
    UrlFetchApp: {
      fetch(url, opts) {
        assert.ok(url.includes('identitytoolkit.googleapis.com'));
        assert.equal(JSON.parse(opts.payload).idToken, 'IDTOKEN1');
        return {
          getResponseCode() { return tokenValid ? 200 : 400; },
          getContentText() {
            return tokenValid ? JSON.stringify({ users: [{ localId: 'uid1' }] }) : '{}';
          },
        };
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test('valid sign-in and known filename returns base64 PDF bytes', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1', fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: true, pdfBase64: Buffer.from(PDF_BYTES).toString('base64') });
});

test('unknown filename is a clear error, not silence', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1', fileName: 'nope.pdf' });
  assert.equal(r.ok, false);
  assert.match(r.error, /nope\.pdf.*not found/);
});

test('missing fileName is rejected', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1' });
  assert.deepEqual(plain(r), { ok: false, error: 'missing fileName' });
});

test('rejected sign-in returns an error and never touches Drive', () => {
  const ctx = makeContext({ tokenValid: false });
  ctx.DriveApp.getFolderById = () => { throw new Error('Drive must not be read'); };
  const r = ctx.getPackingPdf({ idToken: 'IDTOKEN1', fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: false, error: 'sign-in rejected' });
});

test('missing idToken is rejected without a network call', () => {
  const ctx = makeContext();
  ctx.UrlFetchApp.fetch = () => { throw new Error('must not fetch'); };
  const r = ctx.getPackingPdf({ fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: false, error: 'missing idToken' });
});

test('doPost routes the getPackingPdf action', () => {
  // Fresh sandbox (a context can't re-run the source: top-level consts would
  // redeclare). TOKEN starts with PASTE in the template, so doPost's config
  // guard would answer before routing — swap it in-source like the other
  // constants are swapped.
  const routed = source.replace("const TOKEN              = 'PASTE_TOKEN';",
    "const TOKEN              = 'T1';");
  let payload;
  const donor = makeContext();  // reuse the mock implementations
  const sandbox = {
    DriveApp: donor.DriveApp,
    Utilities: donor.Utilities,
    UrlFetchApp: donor.UrlFetchApp,
    ContentService: {
      createTextOutput(s) { payload = JSON.parse(s); return { setMimeType() { return this; } }; },
      MimeType: { JSON: 'json' },
    },
  };
  vm.runInNewContext(routed, sandbox);
  sandbox.doPost({ postData: { contents: JSON.stringify(
    { token: 'T1', action: 'getPackingPdf', idToken: 'IDTOKEN1', fileName: KNOWN_FILE }) } });
  assert.equal(payload.ok, true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/get-packing-pdf.test.mjs`
Expected: FAIL — `getPackingPdf is not a function` (and the PASTE_PACKING_FOLDER_ID replace finds nothing).

- [ ] **Step 3: Implement the bridge changes**

In `apps-script/logging-endpoint.gs`:

1. Add to the constants block (after `FIREBASE_API_KEY`):

```js
const PACKING_FOLDER_ID = 'PASTE_PACKING_FOLDER_ID';
```

2. Add to the action routing in `doPost` (after the `lookupOrder` line):

```js
    if (body.action === 'getPackingPdf') return jsonOut(getPackingPdf(body));
```

3. Add after `lookupOrder`'s helpers (below `parseVanKey`):

```js
/**
 * Serve ONE packing-list template PDF from the designated Drive folder.
 * Same auth posture as lookupOrder: the repo-public TOKEN is junk filtering
 * only, so a Firebase ID token is verified before Drive is touched. Serves
 * by exact filename, only from PACKING_FOLDER_ID — no listing action exists
 * (the templates are VanLab's proprietary product docs).
 */
function getPackingPdf(body) {
  if (PACKING_FOLDER_ID.startsWith('PASTE') || FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: packing constants are still placeholders' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const fileName = String(body.fileName == null ? '' : body.fileName).trim();
  if (!fileName) return { ok: false, error: 'missing fileName' };
  const files = DriveApp.getFolderById(PACKING_FOLDER_ID).getFilesByName(fileName);
  if (!files.hasNext()) {
    return { ok: false, error: "packing list '" + fileName + "' not found in the library folder" };
  }
  return { ok: true, pdfBase64: Utilities.base64Encode(files.next().getBlob().getBytes()) };
}
```

- [ ] **Step 4: Run the new tests AND the existing bridge tests**

Run: `node --test test/get-packing-pdf.test.mjs test/lookup-order.test.mjs test/logging-endpoint.test.mjs`
Expected: all PASS (existing actions untouched).

- [ ] **Step 5: Commit**

```bash
git add apps-script/logging-endpoint.gs test/get-packing-pdf.test.mjs
git commit -m "add sign-in-verified getPackingPdf bridge action serving one template from the Drive library folder"
```

---

### Task 5: `Endpoint.getPackingPdf` client

**Files:**
- Modify: `js/endpoint.js` (add one method to the IIFE, include it in the return object)
- Test: `test/endpoint-packing.test.mjs`

**Interfaces:**
- Consumes: bridge action from Task 4; existing `post()` / `enabled()` in `endpoint.js`.
- Produces: `Endpoint.getPackingPdf(fileName, idToken)` → `Promise<string|null>` — base64 PDF, or `null` when the endpoint isn't configured. Throws with `err.endpointError === true` when the server answers `ok:false` (existing `post()` behavior). Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

First read `test/endpoint-lookup.test.mjs` and mirror its context/mocking style exactly. The test below follows the same shape (adjust only if that file's helpers differ):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'), 'utf8');

function load({ response }) {
  const calls = [];
  const ctx = {
    ENDPOINT_CONFIG: { url: 'https://script.example/exec', token: 'T1' },
    AbortSignal: { timeout: () => null },
    fetch: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body), contentType: opts.headers['Content-Type'] });
      return { json: async () => response };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.Endpoint = Endpoint;', ctx);
  return { endpoint: ctx.Endpoint, calls };
}

test('getPackingPdf posts the action with fileName, idToken, and text/plain', async () => {
  const { endpoint, calls } = load({ response: { ok: true, pdfBase64: 'QUJD' } });
  const b64 = await endpoint.getPackingPdf('Van 13_ NV200 Fitting Kit.pdf', 'IDTOKEN1');
  assert.equal(b64, 'QUJD');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contentType, 'text/plain;charset=utf-8');
  assert.deepEqual(calls[0].body, {
    token: 'T1', action: 'getPackingPdf',
    fileName: 'Van 13_ NV200 Fitting Kit.pdf', idToken: 'IDTOKEN1',
  });
});

test('a server no is thrown as an endpointError with the server message', async () => {
  const { endpoint } = load({ response: { ok: false, error: 'sign-in rejected' } });
  await assert.rejects(() => endpoint.getPackingPdf('x.pdf', 'IDTOKEN1'), (err) => {
    assert.equal(err.message, 'sign-in rejected');
    assert.equal(err.endpointError, true);
    return true;
  });
});

test('unconfigured endpoint returns null without fetching', async () => {
  // PASTE-placeholder url means enabled() is false; fetch must never run.
  const ctx = {
    ENDPOINT_CONFIG: { url: 'PASTE_URL', token: 'T1' },
    fetch: async () => { throw new Error('must not fetch'); },
  };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.Endpoint = Endpoint;', ctx);
  assert.equal(await ctx.Endpoint.getPackingPdf('x.pdf', 'IDTOKEN1'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/endpoint-packing.test.mjs`
Expected: FAIL — `endpoint.getPackingPdf is not a function`.

- [ ] **Step 3: Implement the client method**

In `js/endpoint.js`, after `lookupOrder`:

```js
  async function getPackingPdf(fileName, idToken) {
    if (!enabled()) return null;
    const data = await post({ action: 'getPackingPdf', fileName, idToken });
    return data.pdfBase64;
  }
```

and extend the return object:

```js
  return { enabled, archiveSheet, appendLogRows, lookupOrder, getPackingPdf };
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/endpoint-packing.test.mjs test/endpoint-lookup.test.mjs test/endpoint-error.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/endpoint.js test/endpoint-packing.test.mjs
git commit -m "add Endpoint.getPackingPdf client call"
```

---

### Task 6: panel UI — Print Packing List button and SUV picker

**Files:**
- Modify: `index.html` (VanLab panel markup ~line 226-233; script tags ~line 409-413)
- Modify: `js/app.js` (VanLab section, ~line 1554-1663)

**Interfaces:**
- Consumes: `PackingMap.resolve/SUV_VARIANTS` (Task 2), `PackingPdf.stampPdf` (Task 3), `Endpoint.getPackingPdf` (Task 5), existing `Auth.getIdToken()`, `vanlabOrder`, `vanlabEpoch`, `vanlabSetStatus`, `vanlabVanSelect`.
- Produces: the user-visible feature. No downstream consumers.

No unit test for this task (app.js DOM wiring has no test harness in this repo — same as Phase 1's panel task); verification is the manual browser checklist in Step 4 and the floor test in Task 7.

- [ ] **Step 1: index.html markup and script tags**

In the `vanlab-actions` div (after the stickers button), add:

```html
        <label class="form-label vanlab-suv-label" for="vanlab-suv-select" hidden>SUV kit</label>
        <select id="vanlab-suv-select" class="form-input vanlab-van-select" hidden>
          <option value="">— pick the SUV kit —</option>
          <option value="full">Full Kit</option>
          <option value="bed">Bed Only</option>
          <option value="kitchen">Kitchen Only</option>
        </select>
        <button class="btn btn-primary btn-sm" id="vanlab-packing-btn" disabled>Print Packing List</button>
```

In the script-tag block, load the three new files after `vanlab-print.js` (order matters: `assembly-levels.js` before `packing-pdf.js`), and bump `app.js`'s `?v=` by one:

```html
  <script src="js/assembly-levels.js?v=1"></script>
  <script src="js/packing-map.js?v=1"></script>
  <script src="js/packing-pdf.js?v=1"></script>
```

- [ ] **Step 2: app.js wiring**

In the VanLab section of `js/app.js`. New element handles and state next to the existing ones (~line 1556-1565):

```js
const vanlabSuvSelect  = document.getElementById('vanlab-suv-select');
const vanlabSuvLabel   = document.querySelector('.vanlab-suv-label');
const vanlabPackingBtn = document.getElementById('vanlab-packing-btn');
let vanlabPackingBlobUrl = null;  // last packing-PDF object URL, revoked before a new one
```

In `vanlabOpenPanel()`, alongside the existing reset lines (`vanlabVanSelect.hidden = true;` etc.), reset the new controls:

```js
  vanlabSuvSelect.hidden = true;
  vanlabSuvLabel.hidden = true;
  vanlabSuvSelect.value = '';
  vanlabPackingBtn.disabled = true;
```

…and enable `vanlabPackingBtn` wherever `vanlabPrintBtn` is enabled: after a successful lookup (`vanlabPrintBtn.disabled = false;` → add `vanlabPackingBtn.disabled = false;`), and in `vanlabShowManualPicker()`'s `onchange` handler:

```js
  vanlabVanSelect.onchange = () => {
    vanlabPrintBtn.disabled = !vanlabVanSelect.value;
    vanlabPackingBtn.disabled = !vanlabVanSelect.value;
  };
```

The print handler, after `vanlabPrintStickers()`:

```js
async function vanlabPrintPacking() {
  const ep = vanlabEpoch;
  const vanKey = vanlabOrder ? vanlabOrder.vanKey : vanlabVanSelect.value;
  const order = vanlabOrder || { orderNum: '', customer: '', assembly: '' };
  const suvChoice = vanlabSuvSelect.hidden ? null : (vanlabSuvSelect.value || null);
  const res = PackingMap.resolve(vanKey, order.assembly, suvChoice);

  if (res.status === 'ambiguous') {
    vanlabSuvSelect.hidden = false;
    vanlabSuvLabel.hidden = false;
    vanlabSetStatus('This SUV order doesn\'t say which kit — pick Full/Bed/Kitchen, then click Print Packing List again.', true);
    return;
  }
  if (res.status === 'none_needed') {
    vanlabSetStatus(`No packing list for van ${vanKey} — ${res.reason}. Nothing to print (that's expected).`);
    return;
  }
  if (res.status === 'missing') {
    vanlabSetStatus(`NEEDS ATTENTION — can't print a packing list: ${res.reason}`, true);
    return;
  }

  vanlabPackingBtn.disabled = true;
  vanlabSetStatus(`Fetching the packing list for van ${vanKey}…`);
  try {
    const idToken = await Auth.getIdToken();
    if (ep !== vanlabEpoch) return;
    const b64 = await Endpoint.getPackingPdf(res.file, idToken);
    if (ep !== vanlabEpoch) return;
    if (!b64) {
      vanlabSetStatus('Packing-list fetch is not configured on this copy.', true);
      return;
    }
    const template = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    vanlabSetStatus('Stamping the packing list…');
    const bytes = await PackingPdf.stampPdf(template, order);
    if (ep !== vanlabEpoch) return;
    if (vanlabPackingBlobUrl) URL.revokeObjectURL(vanlabPackingBlobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    vanlabPackingBlobUrl = url;
    if (!window.open(url)) {
      vanlabSetStatus('Popup blocked — allow popups for this site, then click Print Packing List again.', true);
      return;
    }
    vanlabSetStatus(`Packing list${order.orderNum ? ' for order ' + order.orderNum : ''} ready — print the opened PDF on the shop-floor letter printer at 100% scale.`);
  } catch (err) {
    const why = err.endpointError ? err.message : 'network problem — is the internet up?';
    vanlabSetStatus(`Couldn't fetch the packing list — ${why}`, true);
  } finally {
    if (ep === vanlabEpoch) vanlabPackingBtn.disabled = false;
  }
}
```

Register the listener next to the existing ones (~line 1662):

```js
vanlabPackingBtn.addEventListener('click', vanlabPrintPacking);
```

Note the epoch pattern: `vanlabPrintStickers` doesn't guard with epochs, but this handler awaits a network fetch, so it uses the same `ep !== vanlabEpoch` bail-outs as `vanlabOpenPanel` to drop stale results after a job switch.

- [ ] **Step 3: Run the full test suite**

Run: `node --test`
Expected: all PASS (this task adds no tests but must break none).

- [ ] **Step 4: Manual browser check (local, before deploy)**

Serve the app locally the way the repo usually does (open `index.html` via the local server used in development). The live bridge doesn't have the action yet, so the expected result is the **honest failure path**:

1. Open a VanLab job → panel shows the order lookup as before.
2. Click **Print Packing List** → status shows "Fetching…" then the endpointError message (`unknown action` from the live bridge). No silent failure, button re-enables.
3. Open a non-VanLab job → panel behaves as in Phase 1 (no regression, packing button disabled until lookup/manual pick).

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "add packing-list printing with SUV kit picker to the VanLab panel"
```

---

### Task 7: live deploy and floor verification

**Files:** none in the repo (live Apps Script + Drive + Pages deploy). This task is operator work driven by Claude + Travis together.

**Interfaces:**
- Consumes: everything above, merged and pushed.

- [ ] **Step 1: Create the Drive library folder**

Travis (in Drive web, his account): create a folder named `VanLab Packing Lists (Tracker)` in My Drive, then drag in the 22 PDFs from `C:\Users\Golden Boys\Documents\Agemtic Workflows\Shop Management for VanLab\CNC-Kit-Management\packing_lists\`. Filenames must not be edited — the map matches them byte-for-byte. Sharing stays private to Travis's account (the Apps Script executes as him; nobody else needs access).

- [ ] **Step 2: Update the live Apps Script**

At script.google.com, open the live endpoint script (the one behind `ENDPOINT_CONFIG.url`):

1. Add the `PACKING_FOLDER_ID` constant with the real folder ID (from the folder's URL: `drive.google.com/drive/folders/<THIS PART>`).
2. Add the `doPost` routing line and the `getPackingPdf` function from Task 4 — **add only these; do not paste the repo template over the live script** (it would wipe the real constants).
3. No new OAuth scopes: `appsscript.json` already lists `drive` (the archive action uses DriveApp). If the editor still prompts for authorization, run `getPackingPdf` once in-editor with a dummy body → Advanced → "Go to … (unsafe)" → Allow (same dance as Phase 1).
4. Deploy: **Manage deployments → pencil → New version** (NOT "New deployment" — that mints a new URL and breaks the app).

- [ ] **Step 3: Manual test matrix (browser console on the live app, signed in)**

- Signed in + real VanLab order with a mapped van → packing list opens, band shows order | customer | Assembly, options line decoded.
- Signed out (incognito, no login) → the panel isn't reachable; direct `fetch` with junk idToken → `{ok:false, error:'sign-in rejected'}`.
- Order with van 40 → "no packing list required" message, nothing opens.
- SUV order without a variant → picker appears; picking one prints the right variant.
- A filename not in the folder (temporarily rename one file in Drive, request it, rename back) → visible "not found in the library folder" error.

- [ ] **Step 4: Parity + floor print (the phase gate)**

- Run the Python tool for the same order (`python packing_list_printer.py --order <N>` per `PACKING_LISTS_README.md`) and print both outputs. Compare: band color/height, text content, page count. They should be visually identical.
- Print the web version on the shop-floor letter printer at 100% scale. **Not vans 39 or 42** (numbering conflict still open with VanLab).

- [ ] **Step 5: Go-live**

Use the **go-live** skill: commit anything outstanding, push, confirm the GitHub Pages build actually finished, and remind Travis to hard-refresh the shop-floor PC.

---

## Self-review notes

- Spec coverage: Drive folder + bridge action (Tasks 4, 7), packing-map/assembly-levels ports with honesty rules (Tasks 1-2), pdf-lib stamping port (Task 3), SUV picker + panel UI + every failure mode visible (Task 6), manual test matrix + parity + floor gate (Task 7). Van 39 conflict preserved (Task 2). No notes-based SUV fallback, by design (spec revision 2026-08-12).
- The Python tools repo is intentionally untouched; `packing-map.js`/`assembly-levels.js` carry "keep in step" header comments instead (dual maintenance ends when the Python tool retires).
- Type consistency: `resolve()` returns `{status, file, reason}` (Tasks 2 and 6 agree); `stampPdf(templateBytes, order)` with `order = {orderNum, customer, assembly}` (Tasks 3 and 6 agree); bridge returns `pdfBase64` (Tasks 4 and 5 agree).
