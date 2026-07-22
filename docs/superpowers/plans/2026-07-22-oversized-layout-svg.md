# Oversized Layout SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let job sheets whose Material Border SVG exceeds Firestore's 1 MB per-field limit upload successfully — compressed when possible, saved without the drawing when not — and never let a save failure silently remove a sheet from the screen again.

**Architecture:** A new pure-function module `js/svg-codec.js` rounds SVG coordinates to 0.001" and gzips them to base64 via the browser's native `CompressionStream`. `Storage.saveSheet` writes the compressed blob to a new `layoutSvgGz` field, falls back to an oversize marker if even that doesn't fit, and returns a result object instead of swallowing errors. The render path decompresses **lazily** — only for the one sheet actually being viewed — and memoizes the result. A new app-level banner surfaces any save failure to the operator.

**Tech Stack:** Plain browser JS (no build step, no framework), Firestore compat SDK, native `CompressionStream`/`DecompressionStream`, `node --test` for unit tests (Node 24, no dependencies).

## Global Constraints

- **Firestore per-field limit is 1,048,487 bytes.** Use this exact number as the constant `FIRESTORE_FIELD_LIMIT`. Budget against a 90% safety threshold (`943,638`), not the raw limit — a document also carries other fields and Firestore counts the whole document against 1 MiB too.
- **Coordinate rounding is 3 decimal places** (0.001"). Verified on the real 2.3 MB file: max drift 0.0005", identical tag sequence, identical number count, 0 scientific-notation tokens altered.
- **No new runtime dependencies.** No npm packages ship to the browser. `CompressionStream` is native. Tests use `node --test`, built into Node 24.
- **Backward compatibility is mandatory.** Sheets already in the production `sheets/` collection have a plain `layoutSvg` string field. Never rewrite, migrate, or delete them. The read path must render both old (`layoutSvg`) and new (`layoutSvgGz`) records.
- **⚠️ NEVER run against production Firestore.** `js/firebase-config.js` points at the live `cnc-job-tracker` database used by real operators. All browser testing happens in a **copy** of the app whose `js/firebase-config.js` has `projectId: "PASTE_DISABLED"`, which makes `initApp()` skip Firebase entirely. See "Test Environment Setup" below.
- **`master` is a live deploy.** Pushing to `master` publishes to GitHub Pages immediately, to whatever operators have open. Do all work on a branch; do not push to `master` as part of this plan.
- **Do not commit large fixtures.** `samples/` is gitignored — real 2.3 MB sheets go there and nowhere else. Committed tests must generate their own synthetic fixtures.
- **Script tags are cache-busted with `?v=N` query strings** (`index.html:283-288`). Any file you modify MUST have its `?v=` number incremented in the same commit, or operators' browsers will keep serving the cached old copy after deploy and the fix will appear not to work. This plan touches `storage.js` (`?v=9` → `?v=10`) and `app.js` (`?v=11` → `?v=12`); the new `svg-codec.js` ships as `?v=1`.
- **Use the real CSS custom properties.** `:root` in `css/style.css` defines `--gray-500` (muted text), `--gray-200`/`--gray-300` (borders), `--orange` (accent), `--red`, `--text-inverse`, `--radius`, `--shadow-lg`. There is no `--text-muted`, `--border`, or `--accent` — do not invent tokens.
- **`buildSheetDetail(sheet, idx)` takes two arguments.** `idx` renders the sheet number as `idx + 1`; calling it with one argument displays `NaN`. Always pass an index in verification snippets.

---

## Test Environment Setup

Do this once before Task 3. It is required for every browser-based verification step in this plan.

```bash
cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
mkdir -p samples
cp "/g/My Drive/Job Sheet Archive/V4_Mount_Prototype/V4_Mount_Prototype_Summary_Sheet 2.html" samples/
```

Create the safe sandbox copy (outside the repo so it can never be committed):

```bash
SANDBOX="$TMPDIR/cnc-sandbox"
rm -rf "$SANDBOX" && mkdir -p "$SANDBOX"
cp -r "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp/"* "$SANDBOX/"
cat > "$SANDBOX/js/firebase-config.js" <<'EOF'
const FIREBASE_CONFIG = { projectId: "PASTE_DISABLED" };
EOF
cat > "$SANDBOX/js/endpoint-config.js" <<'EOF'
const ENDPOINT_CONFIG = { url: "PASTE_DISABLED", token: "PASTE_DISABLED" };
EOF
```

Verify the sandbox is inert before using it:

```bash
grep -c "PASTE_DISABLED" "$SANDBOX/js/firebase-config.js"
```
Expected: `1`

Serve it with `cd "$SANDBOX" && npx serve .` and open the printed URL. Re-run the `cp -r` line (then the two `cat` overwrites) after each code change.

---

## File Structure

| File | Responsibility |
|---|---|
| `js/svg-codec.js` **(create)** | Pure, DOM-free functions: `roundSvgPrecision`, `compressSvg`, `decompressSvg`, `packLayoutSvg`, plus `FIRESTORE_FIELD_LIMIT` / `SAFE_FIELD_BYTES`. No Firestore, no DOM — this is the only file with unit tests. |
| `test/svg-codec.test.mjs` **(create)** | `node --test` unit tests for the codec. Generates its own synthetic fixtures; optionally exercises the real sample if present. |
| `js/storage.js` **(modify)** | `saveSheet` packs the SVG and returns a result object rather than swallowing failures. |
| `js/app.js` **(modify)** | Awaits `saveSheet`, shows a save-failure banner, lazily decompresses the SVG at render time, orders `setArchiveUrl` after the save. |
| `index.html` **(modify)** | Adds the global `#save-banner` element. |
| `css/style.css` **(modify)** | Styles for `#save-banner` and the oversize-layout notice. |

`js/svg-codec.js` must be loaded **before** `js/storage.js` and `js/app.js` in `index.html`, and must expose its API via a `const SvgCodec = (() => { ... })()` IIFE matching the existing `Storage` pattern, plus a guarded `module.exports` so Node tests can import it.

---

### Task 1: SVG codec — rounding

**Files:**
- Create: `js/svg-codec.js`
- Create: `test/svg-codec.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `SvgCodec.roundSvgPrecision(svgString, decimals = 3) -> string`; constants `SvgCodec.FIRESTORE_FIELD_LIMIT = 1048487`, `SvgCodec.SAFE_FIELD_BYTES = 943638`

- [ ] **Step 1: Write the failing test**

Create `test/svg-codec.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SvgCodec = require('../js/svg-codec.js');

test('rounds long decimals to 3 places and trims trailing zeros', () => {
  const input = '<path d="M 54.50000000 96.12345678 L -0.00000000 1.1"/>';
  const out = SvgCodec.roundSvgPrecision(input);
  assert.equal(out, '<path d="M 54.5 96.123 L 0 1.1"/>');
});

test('leaves integers and command letters untouched', () => {
  const input = '<path d="M 5 10 H 20 Z"/>';
  assert.equal(SvgCodec.roundSvgPrecision(input), '<path d="M 5 10 H 20 Z"/>');
});

test('does not corrupt scientific notation', () => {
  const input = '<path d="M 1.50000000e-7 2.25000000e+3"/>';
  const out = SvgCodec.roundSvgPrecision(input);
  assert.equal(out, '<path d="M 1.5e-7 2.25e+3"/>');
});

test('preserves tag sequence and number count', () => {
  const input = '<svg viewBox="0 0 48 96"><g><path d="M 1.23456789 2.98765432"/></g></svg>';
  const out = SvgCodec.roundSvgPrecision(input);
  const tags = s => (s.match(/<\/?[a-zA-Z]+/g) || []).join(',');
  assert.equal(tags(out), tags(input));
  const nums = s => (s.match(/-?\d+\.?\d*/g) || []).length;
  assert.equal(nums(out), nums(input));
});

test('never emits negative zero', () => {
  assert.equal(SvgCodec.roundSvgPrecision('<path d="M -0.0001 0"/>'), '<path d="M 0 0"/>');
});

test('exposes the exact Firestore field limit', () => {
  assert.equal(SvgCodec.FIRESTORE_FIELD_LIMIT, 1048487);
  assert.equal(SvgCodec.SAFE_FIELD_BYTES, 943638);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" && npm test`
Expected: FAIL — `Cannot find module '../js/svg-codec.js'`

- [ ] **Step 3: Write minimal implementation**

Create `js/svg-codec.js`:

```javascript
/**
 * SVG size codec for Firestore storage.
 *
 * VCarve writes coordinates at 8 decimal places (e.g. "54.50000000"). On a
 * complex sheet that is ~80% of the SVG's bytes, which pushes the layoutSvg
 * field past Firestore's 1 MiB per-field limit and makes the whole sheet
 * fail to save. Rounding to 0.001" plus gzip gets a 2.15 MB drawing down to
 * ~375 KB with no visible change (0.001" is 0.003px at display size).
 *
 * Pure functions only — no DOM, no Firestore — so this is unit-testable
 * under `node --test`.
 */
const SvgCodec = (() => {
  // Firestore rejects any single string field larger than this many bytes.
  const FIRESTORE_FIELD_LIMIT = 1048487;
  // Budget against 90% — the document carries other fields, and Firestore
  // also caps total document size at 1 MiB.
  const SAFE_FIELD_BYTES = 943638;

  /**
   * Rounds every decimal number to `decimals` places and trims trailing
   * zeros. Only matches <digits>.<digits>, so path command letters, bare
   * integers, and exponent suffixes ("e-7") are left alone.
   */
  function roundSvgPrecision(svgString, decimals = 3) {
    if (!svgString) return '';
    return svgString.replace(/-?\d+\.\d+/g, match => {
      let v = parseFloat(match).toFixed(decimals);
      if (v.includes('.')) v = v.replace(/0+$/, '').replace(/\.$/, '');
      return (v === '-0' || v === '') ? '0' : v;
    });
  }

  return { roundSvgPrecision, FIRESTORE_FIELD_LIMIT, SAFE_FIELD_BYTES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SvgCodec;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" && npm test`
Expected: PASS — `# pass 6`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git checkout -b fix/oversized-layout-svg
git add js/svg-codec.js test/svg-codec.test.mjs
git commit -m "Add SVG coordinate-precision rounding codec"
```

---

### Task 2: SVG codec — compression and packing

**Files:**
- Modify: `js/svg-codec.js`
- Modify: `test/svg-codec.test.mjs`

**Interfaces:**
- Consumes: `SvgCodec.roundSvgPrecision`, `SvgCodec.SAFE_FIELD_BYTES` (Task 1)
- Produces:
  - `async SvgCodec.compressSvg(svgString) -> string` (base64 gzip)
  - `async SvgCodec.decompressSvg(base64) -> string`
  - `async SvgCodec.packLayoutSvg(svgString) -> { mode, layoutSvg, layoutSvgGz, originalBytes, storedBytes }` where `mode` is one of `'plain'`, `'gzip'`, `'oversize'`

`packLayoutSvg` decides how a drawing gets stored:
- empty input → `mode: 'plain'`, `layoutSvg: ''`, `layoutSvgGz: ''`
- rounded SVG already under `SAFE_FIELD_BYTES` → `mode: 'plain'` (store readable text, skip the decompress cost on read)
- otherwise gzip+base64; if under `SAFE_FIELD_BYTES` → `mode: 'gzip'`
- still over → `mode: 'oversize'`, both fields empty (caller stores an oversize marker)

- [ ] **Step 1: Write the failing test**

Append to `test/svg-codec.test.mjs`:

```javascript
test('gzip round-trip is lossless', async () => {
  const svg = '<svg viewBox="0 0 48 96"><path d="M 1.5 2.5 L 3.5 4.5"/></svg>';
  const packed = await SvgCodec.compressSvg(svg);
  assert.equal(typeof packed, 'string');
  assert.equal(await SvgCodec.decompressSvg(packed), svg);
});

test('packLayoutSvg keeps small drawings as plain text', async () => {
  const svg = '<svg viewBox="0 0 48 96"><path d="M 1.50000000 2.50000000"/></svg>';
  const r = await SvgCodec.packLayoutSvg(svg);
  assert.equal(r.mode, 'plain');
  assert.equal(r.layoutSvg, '<svg viewBox="0 0 48 96"><path d="M 1.5 2.5"/></svg>');
  assert.equal(r.layoutSvgGz, '');
});

test('packLayoutSvg gzips drawings that exceed the safe budget', async () => {
  // ~1.6 MB of highly-compressible path data
  const big = '<svg viewBox="0 0 48 96">'
    + '<path d="' + 'M 12.34567890 45.67890123 '.repeat(60000) + '"/></svg>';
  assert.ok(Buffer.byteLength(big) > SvgCodec.SAFE_FIELD_BYTES);
  const r = await SvgCodec.packLayoutSvg(big);
  assert.equal(r.mode, 'gzip');
  assert.equal(r.layoutSvg, '');
  assert.ok(r.storedBytes < SvgCodec.SAFE_FIELD_BYTES);
  // and it must survive the trip back
  const back = await SvgCodec.decompressSvg(r.layoutSvgGz);
  assert.ok(back.startsWith('<svg viewBox="0 0 48 96">'));
  assert.ok(back.includes('M 12.346 45.679'));
});

test('packLayoutSvg reports oversize when even gzip will not fit', async () => {
  // Incompressible: random hex defeats gzip, so base64 stays over budget.
  let noise = '';
  while (noise.length < 3_000_000) noise += Math.random().toString(16).slice(2);
  const r = await SvgCodec.packLayoutSvg('<svg>' + noise + '</svg>');
  assert.equal(r.mode, 'oversize');
  assert.equal(r.layoutSvg, '');
  assert.equal(r.layoutSvgGz, '');
});

test('packLayoutSvg handles empty input', async () => {
  const r = await SvgCodec.packLayoutSvg('');
  assert.equal(r.mode, 'plain');
  assert.equal(r.layoutSvg, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `SvgCodec.compressSvg is not a function`

- [ ] **Step 3: Write minimal implementation**

In `js/svg-codec.js`, add these functions inside the IIFE, before the `return`:

```javascript
  function byteLength(str) {
    return new TextEncoder().encode(str).length;
  }

  async function streamThrough(transform, bytes) {
    const writer = transform.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(transform.readable).arrayBuffer());
  }

  function bytesToBase64(bytes) {
    // Chunked so a multi-hundred-KB array doesn't blow the argument limit
    // on String.fromCharCode.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function compressSvg(svgString) {
    const input = new TextEncoder().encode(svgString);
    const gz = await streamThrough(new CompressionStream('gzip'), input);
    return bytesToBase64(gz);
  }

  async function decompressSvg(base64) {
    const bytes = base64ToBytes(base64);
    const out = await streamThrough(new DecompressionStream('gzip'), bytes);
    return new TextDecoder().decode(out);
  }

  async function packLayoutSvg(svgString) {
    const empty = { layoutSvg: '', layoutSvgGz: '', originalBytes: 0, storedBytes: 0 };
    if (!svgString) return { mode: 'plain', ...empty };

    const originalBytes = byteLength(svgString);
    const rounded = roundSvgPrecision(svgString);
    const roundedBytes = byteLength(rounded);

    if (roundedBytes <= SAFE_FIELD_BYTES) {
      return { mode: 'plain', layoutSvg: rounded, layoutSvgGz: '',
               originalBytes, storedBytes: roundedBytes };
    }

    const gz = await compressSvg(rounded);
    const gzBytes = byteLength(gz);
    if (gzBytes <= SAFE_FIELD_BYTES) {
      return { mode: 'gzip', layoutSvg: '', layoutSvgGz: gz,
               originalBytes, storedBytes: gzBytes };
    }

    return { mode: 'oversize', ...empty, originalBytes };
  }
```

Node 24 has `btoa`/`atob` globally, so the same code runs in tests and in the browser.

Update the `return` line to:

```javascript
  return { roundSvgPrecision, compressSvg, decompressSvg, packLayoutSvg,
           FIRESTORE_FIELD_LIMIT, SAFE_FIELD_BYTES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `# pass 11`, `# fail 0`

- [ ] **Step 5: Verify against the real 2.3 MB file**

```bash
node -e "
const fs=require('fs');
const S=require('./js/svg-codec.js');
const h=fs.readFileSync('samples/V4_Mount_Prototype_Summary_Sheet 2.html','utf8');
const svg=h.slice(h.indexOf('id=\"vectorcenter\"')).match(/<svg[\s\S]*?<\/svg>/i)[0];
S.packLayoutSvg(svg).then(async r=>{
  console.log('mode', r.mode, '| original', r.originalBytes, '-> stored', r.storedBytes);
  console.log('under safe budget?', r.storedBytes < S.SAFE_FIELD_BYTES);
  console.log('lossless?', (await S.decompressSvg(r.layoutSvgGz)) === S.roundSvgPrecision(svg));
});"
```
Expected: `mode gzip | original 2152025 -> stored 375488`, `under safe budget? true`, `lossless? true`

- [ ] **Step 6: Commit**

```bash
git add js/svg-codec.js test/svg-codec.test.mjs
git commit -m "Add gzip compression and layout-SVG packing strategy"
```

---

### Task 3: Storage writes compressed SVG and reports failures

**Files:**
- Modify: `js/storage.js:158-190` (`saveSheet`, `setArchiveUrl`)
- Modify: `index.html` (script tag order)

**Interfaces:**
- Consumes: `SvgCodec.packLayoutSvg` (Task 2)
- Produces: `async Storage.saveSheet(sheet) -> { ok: boolean, mode: string, storedBytes: number, error: Error|null }`

`saveSheet` must stop swallowing errors. Callers need to know whether the sheet actually persisted, because the realtime listener will otherwise wipe it off screen with no explanation.

- [ ] **Step 1: Load the codec before storage.js**

In `index.html`, find the `<script src="js/storage.js?v=9">` tag (line 286) and add immediately **above** it:

```html
  <script src="js/svg-codec.js?v=1"></script>
```

In the same edit, bump the cache-buster on the file this task modifies:

```html
  <script src="js/storage.js?v=10"></script>
```

Verify order and versions:
```bash
grep -n "js/svg-codec.js\|js/storage.js\|js/parser.js\|js/app.js" index.html
```
Expected: `svg-codec.js?v=1` on a lower line number than `storage.js?v=10` and `app.js`.

- [ ] **Step 2: Rewrite saveSheet**

Replace the whole `saveSheet` function in `js/storage.js` with:

```javascript
  async function saveSheet(sheet) {
    if (!db) return { ok: true, mode: 'plain', storedBytes: 0, error: null };

    let packed;
    try {
      packed = await SvgCodec.packLayoutSvg(sheet.layoutSvg || '');
    } catch (e) {
      console.warn('SVG packing failed, storing sheet without drawing:', e);
      packed = { mode: 'oversize', layoutSvg: '', layoutSvgGz: '',
                 originalBytes: 0, storedBytes: 0 };
    }

    try {
      await db.collection('sheets').doc(sheet.fileKey).set({
        fileKey:      sheet.fileKey,
        fileName:     sheet.fileName     || '',
        sheetTitle:   sheet.sheetTitle   || '',
        jobName:      sheet.jobName      || '',
        totalTime:    sheet.totalTime    || '',
        toolpaths:    sheet.toolpaths    || [],
        materialInfo: sheet.materialInfo || [],
        layoutSvg:    packed.layoutSvg,
        layoutSvgGz:  packed.layoutSvgGz,
        // Tells the render path to show the "too large" notice instead of
        // silently rendering nothing.
        layoutOversize: packed.mode === 'oversize',
        uploadedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, mode: packed.mode, storedBytes: packed.storedBytes, error: null };
    } catch (e) {
      console.warn('Firestore saveSheet failed:', e);
      return { ok: false, mode: packed.mode, storedBytes: packed.storedBytes, error: e };
    }
  }
```

- [ ] **Step 3: Verify the browser path end-to-end in the sandbox**

Rebuild the sandbox (see "Test Environment Setup"), serve it, open the browser console and run:

```javascript
const h = await (await fetch('/samples/V4_Mount_Prototype_Summary_Sheet 2.html')).text();
const svg = h.slice(h.indexOf('id="vectorcenter"')).match(/<svg[\s\S]*?<\/svg>/i)[0];
const r = await SvgCodec.packLayoutSvg(svg);
console.log(r.mode, r.originalBytes, '->', r.storedBytes, r.storedBytes < SvgCodec.SAFE_FIELD_BYTES);
```
Expected: `gzip 2152025 -> 375488 true`

This confirms `CompressionStream` and the chunked base64 encoder work in the real browser, not just Node.

- [ ] **Step 4: Commit**

```bash
git add js/storage.js index.html
git commit -m "Store layout SVG compressed; return save result instead of swallowing errors"
```

---

### Task 4: Render path decompresses lazily

**Files:**
- Modify: `js/app.js:783-799` (`buildSheetDetail` SVG block)
- Modify: `css/style.css` (append oversize-notice styles)

**Interfaces:**
- Consumes: `SvgCodec.decompressSvg` (Task 2); sheet docs carrying `layoutSvg` (legacy or plain), `layoutSvgGz`, or `layoutOversize` (Task 3)
- Produces: nothing consumed by later tasks

Decompression must **not** happen in the `onSheetsChange` listener — that fires on every remote change and would decompress every sheet in the project each time. Only the one selected sheet is ever rendered, so decompress there and memoize.

- [ ] **Step 1: Add the memo cache**

Near the other module-level state at the top of `js/app.js` (alongside `let sheets`), add:

```javascript
// fileKey -> decompressed SVG string. Decompressing a large drawing costs
// ~100ms, and re-selecting a sheet is common, so keep the result.
const svgCache = new Map();
```

- [ ] **Step 2: Replace the SVG render block**

Replace `js/app.js:783-799` (the `if (sheet.layoutSvg) { ... }` block) with:

```javascript
  if (sheet.layoutOversize) {
    const notice = document.createElement('div');
    notice.className = 'layout-svg-oversize';
    notice.textContent = 'Layout preview is too large to store. ';
    if (sheet.archiveUrl) {
      const link = document.createElement('a');
      link.href = sheet.archiveUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open the original sheet';
      notice.appendChild(link);
    }
    wrap.appendChild(notice);
  } else if (sheet.layoutSvg || sheet.layoutSvgGz) {
    try {
      const svgWrap = document.createElement('div');
      svgWrap.className = 'layout-svg-wrap';
      const label = document.createElement('div');
      label.className = 'layout-svg-label';
      label.textContent = 'Material Border';
      svgWrap.appendChild(label);
      const scrollEl = document.createElement('div');
      scrollEl.className = 'layout-svg-scroll';
      svgWrap.appendChild(scrollEl);
      wrap.appendChild(svgWrap);

      if (sheet.layoutSvg) {
        scrollEl.innerHTML = sheet.layoutSvg;
      } else if (svgCache.has(sheet.fileKey)) {
        scrollEl.innerHTML = svgCache.get(sheet.fileKey);
      } else {
        // Async: the panel is already in the DOM, fill the drawing in when
        // it decodes. Guard against the operator selecting another sheet
        // mid-decompress.
        const renderingKey = sheet.fileKey;
        scrollEl.textContent = 'Loading layout…';
        SvgCodec.decompressSvg(sheet.layoutSvgGz)
          .then(svg => {
            svgCache.set(renderingKey, svg);
            if (selectedSheetKey !== renderingKey) return;
            if (!scrollEl.isConnected) return;
            scrollEl.innerHTML = svg;
          })
          .catch(err => {
            console.error('SVG decompress failed:', err);
            scrollEl.textContent = 'Layout preview could not be loaded.';
          });
      }
    } catch (err) {
      console.error('SVG render failed:', err);
    }
  }
```

- [ ] **Step 3: Add the styles**

Append to `css/style.css`:

```css
.layout-svg-oversize {
  padding: 12px 14px;
  margin: 12px 0;
  border: 1px dashed var(--gray-300);
  border-radius: var(--radius);
  color: var(--gray-500);
  font-size: 13px;
}
.layout-svg-oversize a { color: var(--orange); }
```

These are the real tokens from `:root` (see Global Constraints). Confirm they resolve:
```bash
grep -n -- "--gray-300:\|--gray-500:\|--orange:\|--radius:" css/style.css | head -5
```
Expected: four matches.

- [ ] **Step 4: Verify all three render paths in the sandbox**

Rebuild and serve the sandbox. In the browser console, exercise each case directly:

```javascript
// Render into the page so you can actually see the result.
const probe = el => { document.body.innerHTML = ''; document.body.appendChild(el); };

// legacy plain-text sheet still renders
selectedSheetKey = 'a';
probe(buildSheetDetail({ fileKey:'a', sheetTitle:'Legacy', layoutSvg:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', toolpaths:[] }, 0));

// compressed sheet renders after decompress
const gz = await SvgCodec.compressSvg('<svg viewBox="0 0 10 10"><rect width="8" height="8"/></svg>');
selectedSheetKey = 'b';
probe(buildSheetDetail({ fileKey:'b', sheetTitle:'Compressed', layoutSvgGz: gz, toolpaths:[] }, 1));

// oversize sheet shows the notice + link
selectedSheetKey = 'c';
probe(buildSheetDetail({ fileKey:'c', sheetTitle:'Oversize', layoutOversize:true, archiveUrl:'https://example.com', toolpaths:[] }, 2));
```

Note both the second argument (`idx`) and the `selectedSheetKey` assignment — the lazy decompress in Step 2 bails out if `selectedSheetKey` doesn't match the sheet being rendered, so without it the compressed case would stay stuck on "Loading layout…". Reload the page between probes to restore the real UI.
Expected: circle renders; rectangle renders after a brief "Loading layout…"; third shows the dashed notice with a working link.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/style.css
git commit -m "Render compressed layout SVGs lazily; add oversize notice"
```

---

### Task 5: Surface save failures to the operator

**Files:**
- Modify: `index.html` (add `#save-banner`)
- Modify: `css/style.css` (banner styles)
- Modify: `js/app.js:161-189` (`handleFiles` upload loop), plus new banner helpers

**Interfaces:**
- Consumes: `Storage.saveSheet(...) -> { ok, mode, storedBytes, error }` (Task 3)
- Produces: `showSaveBanner(message)`, `hideSaveBanner()`

The existing `#upload-error` lives inside the upload screen, so it is invisible when an operator adds sheets from the content or projects screen. This banner is screen-independent.

- [ ] **Step 1: Add the banner element**

In `index.html`, immediately after the opening `<body>` tag, add:

```html
  <div id="save-banner" class="save-banner" hidden>
    <span id="save-banner-text"></span>
    <button type="button" id="save-banner-close" class="save-banner-close" aria-label="Dismiss">&times;</button>
  </div>
```

- [ ] **Step 2: Add banner styles**

Append to `css/style.css`:

```css
.save-banner {
  position: fixed;
  top: 16px; left: 50%; transform: translateX(-50%);
  z-index: 9999;
  max-width: min(560px, calc(100vw - 32px));
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--red); color: var(--text-inverse);
  box-shadow: var(--shadow-lg);
  font-size: 14px; line-height: 1.4;
}
.save-banner-close {
  background: none; border: none; color: inherit;
  font-size: 20px; line-height: 1; cursor: pointer; padding: 0;
}
```

- [ ] **Step 3: Add the banner helpers**

In `js/app.js`, next to `showUploadError`/`hideUploadError` (~line 219), add:

```javascript
const saveBannerEl     = document.getElementById('save-banner');
const saveBannerTextEl = document.getElementById('save-banner-text');
document.getElementById('save-banner-close').addEventListener('click', hideSaveBanner);

function showSaveBanner(msg) { saveBannerTextEl.textContent = msg; saveBannerEl.hidden = false; }
function hideSaveBanner()    { saveBannerEl.hidden = true; }
```

- [ ] **Step 4: Await the save and report failures**

In `handleFiles`, replace the body of `reader.onload` (`js/app.js:165-186`) with:

```javascript
    reader.onload = async e => {
      const parsed = parseJobSheet(e.target.result);
      const key    = simpleHash(file.name);
      if (!sheets.find(s => s.fileKey === key)) {
        const sheet = { fileKey: key, fileName: file.name, ...parsed };
        if (!firstNewJobName) firstNewJobName = projectKey(sheet);
        sheets.push(sheet);

        const result = await Storage.saveSheet(sheet);
        if (!result.ok) {
          // The sheets listener will drop this sheet from the screen on the
          // next snapshot — say why, so it isn't a silent disappearance.
          const idx = sheets.findIndex(s => s.fileKey === key);
          if (idx !== -1) sheets.splice(idx, 1);
          showSaveBanner(`Couldn't save "${file.name}" — ${result.error?.message || 'unknown error'}. The file was still archived to Drive.`);
        } else if (result.mode === 'oversize') {
          showSaveBanner(`"${file.name}" was saved, but its layout drawing is too large to store. Everything else tracks normally — use the archive link to view the drawing.`);
        }

        // Archive after the save resolves, so setArchiveUrl's update() has a
        // document to attach to.
        Endpoint.archiveSheet(file.name, sheet.jobName || '', e.target.result)
          .then(url => { if (url) Storage.setArchiveUrl(key, url); })
          .catch(err => console.warn('Archive upload failed:', err));
      }
      loadedCount++;
      if (loadedCount === htmlFiles.length && sheets.length) {
        if (isFirstLoad) {
          showProjectsScreen();
        } else {
          renderAllSheets();
        }
      }
    };
```

Also call `hideSaveBanner()` alongside the existing `hideUploadError()` at `js/app.js:144`.

- [ ] **Step 4b: Bump the app.js cache-buster**

This task modified `js/app.js`, so in `index.html` change `js/app.js?v=11` to `js/app.js?v=12`. Without this, operators keep running the cached old `app.js` after deploy and see no banner.

Verify: `grep -n "js/app.js" index.html` → expected `js/app.js?v=12`.

- [ ] **Step 5: Verify the failure path in the sandbox**

Rebuild and serve the sandbox. In the console, force a failure and confirm the banner appears:

```javascript
const real = Storage.saveSheet;
Storage.saveSheet = async () => ({ ok:false, mode:'plain', storedBytes:0, error:new Error('simulated failure') });
document.getElementById('file-input').click(); // pick any sample sheet
```
Expected: red banner reads `Couldn't save "…" — simulated failure. The file was still archived to Drive.`, and the sheet does not linger on screen. Restore with `Storage.saveSheet = real;`.

- [ ] **Step 6: Commit**

```bash
git add index.html css/style.css js/app.js
git commit -m "Show a banner when a sheet fails to save or loses its drawing"
```

---

### Task 6: Full-app verification against the real file

**Files:** none modified — this task is verification only.

- [ ] **Step 1: Rebuild the sandbox and confirm it is inert**

```bash
grep -c "PASTE_DISABLED" "$TMPDIR/cnc-sandbox/js/firebase-config.js"
```
Expected: `1`. **Do not proceed if this prints 0** — you would be writing to production.

- [ ] **Step 2: Run the unit suite**

Run: `cd "/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp" && npm test`
Expected: `# pass 11`, `# fail 0`

- [ ] **Step 3: Upload the 2.3 MB sheet through the real UI**

Serve the sandbox, drag `samples/V4_Mount_Prototype_Summary_Sheet 2.html` onto the drop zone.

Expected, in order:
1. Sheet appears in the projects directory and **stays** (no disappearance)
2. No red banner
3. Opening the project and selecting the sheet shows "Loading layout…" then the Material Border drawing
4. Console shows **no** `Firestore saveSheet failed` and **no** `longer than 1048487 bytes`

- [ ] **Step 4: Measure render performance**

With the sheet's detail panel open, run in the console:

```javascript
const target = sheets.find(s => s.fileName.startsWith('V4_Mount'));
selectedSheetKey = target.fileKey;
svgCache.delete(target.fileKey);          // measure a cold render, not the memo
const t0 = performance.now();
buildSheetDetail(target, 0);
console.log('render ms', performance.now() - t0);
```

Record the number. The drawing holds ~98,000 points. If render exceeds ~1000ms the preview will feel sluggish on the shop PC — note it in the handoff for a follow-up (e.g. render the SVG only on demand behind a "Show layout" toggle). **Do not** fix it in this plan; it is a separate concern.

- [ ] **Step 5: Confirm regression-free behavior on a normal sheet**

Upload `260520_gmc_savana_3500_155wb_ew_cargo_Order_1195_Summary_Sheet 9.html` (repo root, 217 KB).

Expected: uploads and renders exactly as before; its drawing stores as `mode: 'plain'` (verify via `SvgCodec.packLayoutSvg` in the console), so normal sheets take on no decompression cost.

- [ ] **Step 6: Confirm backward compatibility with legacy records**

In the console, simulate a pre-existing production record (plain `layoutSvg`, no `layoutSvgGz`, no `layoutOversize`):

```javascript
selectedSheetKey = 'legacy';
document.body.innerHTML = '';
document.body.appendChild(buildSheetDetail({ fileKey:'legacy', sheetTitle:'Legacy record',
  layoutSvg:'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', toolpaths:[] }, 0));
```
Expected: circle renders immediately, no "Loading layout…", no console error. This is the path every one of the existing production sheets takes.

- [ ] **Step 7: Commit any fixes and summarize**

If Steps 3–6 surfaced defects, fix them, re-run Step 2, and commit. Then report to the user:
- unit test result
- whether the 2.3 MB sheet uploaded and rendered
- the render time from Step 4
- confirmation that normal and legacy sheets are unaffected

**Do not push to `master`.** `master` deploys live to operators. Hand the branch back to the user and let them decide when to deploy via the `go-live` skill.

---

## Rollback

If a deploy from this branch misbehaves in production, the storage change is additive — `layoutSvgGz` and `layoutOversize` are new fields and old records are untouched. Reverting the commits restores the previous behavior for all legacy sheets. Sheets uploaded **after** the deploy that stored `layoutSvgGz` would lose their drawing on a revert (the old code reads only `layoutSvg`), but the sheets themselves, their completions, and their archive links all survive. Re-uploading those files after a revert restores nothing new — they would fail again the way they do today.
