# Print Queue — Phase 1 (queue + sticker batches) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **To Print** panel on the Projects screen where Travis queues a batch of text stickers (typed or range-filled, 3x1 or 4x6) and Collin prints it and marks it printed, with a live badge count on the button.

**Architecture:** One new pure module (`js/sequence.js`) for range generation; `js/sticker-pdf.js` gains an options argument (size, start font size, PDF title) with defaults that leave the VanLab flow untouched; `js/storage.js` gains a `printQueue` collection following the existing cache-plus-listener pattern; `js/app.js` gets a "Print Queue" section that wires a collapsed header panel exactly like the VanLab one. No build step, no framework, no new services.

**Tech Stack:** Vanilla JS (IIFE modules, `module.exports` shim for Node tests), Firestore compat SDK, pdf-lib + fontkit (vendored), `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-09-10-print-queue-design.md` — this plan implements **Phase 1 only** (spec § Phases). Job tagging (Phase 2) and documents (Phase 3) are separate plans.

## Global Constraints

- **Never run the app against the real Firestore.** `js/firebase-config.js` is production. Manual checks run from a temp copy with `projectId: "PASTE_DISABLED"` (repo `CLAUDE.md` → Testing safety). This plan's Task 6 shows the exact commands.
- **`master` is a live deploy.** All work stays on branch `print-queue`; nothing is pushed to `master` by this plan.
- **Do not touch the VanLab Printing panel's behaviour.** `buildStickerPdf` called with no options must behave exactly as today: 216×72 pt pages, start font size 22, no Title metadata.
- **Firestore rules are console-only and per-collection.** `printQueue` writes silently fail until Travis adds the rule by hand (copy the `sheetAnnotations` match block — Travis + Collin email allowlist — and rename it). This is a manual step in Task 6, before any live test.
- **Operator spelling is `Collin`.** Never `Colin`.
- **Range cap is 500 items.** Applies to the generator and to Send.
- **Size table (spec § PDF rendering):**

  | size | width pt | height pt | startSize | printer name in button |
  |---|---|---|---|---|
  | `3x1` | 216 | 72 | 60 | `STICKERS 1x3` |
  | `4x6` | 288 | 432 | 140 | `CRATE LABEL 4x6` |

- **PDF Title format:** `ED1-ED45 · 3x1 · 45 stickers` (range label with a plain hyphen, size, count). This is the wrong-printer guard — it shows in the Chrome tab and print dialog.
- **Error copy comes from the thrown error's `.message`**, shown inline. No custom mapping.
- **Panel lives on the Projects screen header** (spec § Architecture says "Projects-screen header"). Note the VanLab panel is actually on the *job* screen header; the spec's side-by-side sketch is not literal. The To Print panel is job-independent in Phase 1, and Phase 2's project-card badge is a Projects-screen feature, so Projects is right.
- **Script cache-busting:** every modified JS **and CSS** file's `?v=` in `index.html` must be bumped, or GitHub Pages serves the old file.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `js/sequence.js` | create | `generateSequence`, `parseLines`, `rangeLabel`, `MAX_ITEMS`. Pure, no DOM. |
| `test/sequence.test.mjs` | create | Coverage for the above. |
| `js/sticker-pdf.js` | modify | `fitLines` gains `startSize`; `buildStickerPdf` gains `opts` (`width`, `height`, `startSize`, `title`). |
| `test/sticker-pdf.test.mjs` | modify | Default-behaviour guards + option tests. |
| `js/storage.js` | modify | `printQueue` cache, `addPrintItem`, `markPrinted`, `getPrintQueue`, `getPrintedItems`, `loadPrintQueue`, `onPrintQueueChange`. |
| `test/storage-print-queue.test.mjs` | create | Offline (no `db`) behaviour of the above. |
| `index.html` | modify | `To Print` button + `#print-queue-panel` on the Projects screen; script tag for `sequence.js`; version bumps. |
| `css/style.css` | modify | `.print-queue-*` styles next to the VanLab ones. |
| `js/app.js` | modify | New "Print Queue" section (list, badge, Print, Printed, history toggle, builder); listener + load registration; shared Baloo font loader. |
| `CLAUDE.md` (repo) | modify | File-structure lines for `sequence.js` and the `printQueue` collection. |
| `Brain/Brain/Projects/CNC Job Tracker.md` (vault, `G:\My Drive\Brain\`) | modify | Collections list 8 → 9; status entry. |

---

### Task 1: `js/sequence.js` — range generator

**Files:**
- Create: `js/sequence.js`
- Create: `test/sequence.test.mjs`

**Interfaces:**
- Produces:
  - `Sequence.generateSequence(prefix: string, start: string, end: string) → string[]` — throws `Error` with a user-readable `.message` on bad input.
  - `Sequence.parseLines(text: string) → string[]` — split on newlines, trim, drop blanks.
  - `Sequence.rangeLabel(lines: string[]) → string` — `'ED1 – ED45'` (en dash, spaces) or the single line.
  - `Sequence.MAX_ITEMS` — `500`.
  - Global `Sequence` in the browser; `module.exports = Sequence` in Node (same shim as `js/storage.js`).

- [ ] **Step 1: Write the failing tests**

`test/sequence.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sequence = require('../js/sequence.js');
const gen = Sequence.generateSequence;

test('numeric range: ED 1..45 gives ED1..ED45, no zero padding', () => {
  const out = gen('ED', '1', '45');
  assert.equal(out.length, 45);
  assert.equal(out[0], 'ED1');
  assert.equal(out[8], 'ED9');
  assert.equal(out[9], 'ED10');
  assert.equal(out[44], 'ED45');
});

test('numeric range: start == end gives one item', () => {
  assert.deepEqual(gen('ED', '7', '7'), ['ED7']);
});

test('empty prefix is allowed', () => {
  assert.deepEqual(gen('', '1', '3'), ['1', '2', '3']);
});

test('alpha range: A..Z gives 26 items with I and O present', () => {
  const out = gen('ED', 'A', 'Z');
  assert.equal(out.length, 26);
  assert.equal(out[0], 'EDA');
  assert.equal(out[25], 'EDZ');
  assert.ok(out.includes('EDI'));
  assert.ok(out.includes('EDO'));
});

test('alpha range crosses into doubling: A..CC ends AA, BB, CC', () => {
  const out = gen('ED', 'A', 'CC');
  assert.equal(out.length, 29);
  assert.deepEqual(out.slice(-3), ['EDAA', 'EDBB', 'EDCC']);
});

test('alpha endpoints are case-insensitive, prefix is left as typed', () => {
  assert.deepEqual(gen('ed', 'a', 'c'), ['edA', 'edB', 'edC']);
});

test('AB as an endpoint throws with the doubling explanation', () => {
  assert.throws(() => gen('ED', 'A', 'AB'), /AB isn't a valid endpoint — letters repeat: A, B … Z, AA, BB\./);
});

test('mixed modes throw', () => {
  assert.throws(() => gen('ED', '1', 'Z'), /both ends must be numbers or both letters/);
});

test('reversed numeric range throws', () => {
  assert.throws(() => gen('ED', '45', '1'), /45 comes after 1/);
});

test('reversed alpha range throws', () => {
  assert.throws(() => gen('ED', 'Z', 'A'), /Z comes after A/);
});

test('missing endpoint throws', () => {
  assert.throws(() => gen('ED', '', '5'), /Enter both a start and an end/);
});

test('ranges over MAX_ITEMS throw and name the count', () => {
  assert.equal(Sequence.MAX_ITEMS, 500);
  assert.throws(() => gen('ED', '1', '100000'), /That range is 100000 stickers — the limit is 500\./);
  assert.equal(gen('ED', '1', '500').length, 500);
});

test('parseLines splits, trims, and drops blanks', () => {
  assert.deepEqual(Sequence.parseLines(' ED1 \r\n\nED2\n   \nED3'), ['ED1', 'ED2', 'ED3']);
  assert.deepEqual(Sequence.parseLines(''), []);
});

test('rangeLabel is first – last, or the single line', () => {
  assert.equal(Sequence.rangeLabel(['ED1', 'ED2', 'ED45']), 'ED1 – ED45');
  assert.equal(Sequence.rangeLabel(['ONLY']), 'ONLY');
  assert.equal(Sequence.rangeLabel([]), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sequence.test.mjs`
Expected: FAIL — `Cannot find module '../js/sequence.js'`

- [ ] **Step 3: Write the implementation**

`js/sequence.js`:

```js
/**
 * Sticker-text sequence generator for the print queue (spec:
 * docs/superpowers/specs/2026-09-10-print-queue-design.md § Sequence generation).
 * Pure — no DOM, no Firebase — so it runs under node --test.
 *
 * Mode is auto-detected: both endpoints numeric -> ED1..ED45; both a single
 * repeated letter -> EDA..EDZ, EDAA, EDBB ... ("doubling", deliberately NOT
 * spreadsheet AA/AB/AC — those get misread on a 1-inch label). I and O are
 * kept; skipping them would put every label after H out of step with the
 * cut lists the stickers are matched against.
 */
const Sequence = (() => {
  const MAX_ITEMS = 500;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NUM_RE = /^\d+$/;
  const ALPHA_RE = /^([A-Z])\1*$/;   // one letter, optionally repeated: A, BB, CCC

  const isNum = v => NUM_RE.test(v);
  const isAlpha = v => ALPHA_RE.test(v.toUpperCase());

  // A=0 … Z=25, AA=26 … ZZ=51, AAA=52 …
  function alphaIndex(v) {
    const u = v.toUpperCase();
    return (u.length - 1) * 26 + ALPHABET.indexOf(u[0]);
  }
  function alphaAt(i) {
    return ALPHABET[i % 26].repeat(Math.floor(i / 26) + 1);
  }

  function generateSequence(prefix, start, end) {
    const pre = String(prefix ?? '');
    const s = String(start ?? '').trim();
    const e = String(end ?? '').trim();
    if (!s || !e) throw new Error('Enter both a start and an end.');

    const numeric = isNum(s) && isNum(e);
    const alpha = isAlpha(s) && isAlpha(e);
    if (!numeric && !alpha) {
      const bad = [s, e].find(v => !isNum(v) && !isAlpha(v));
      if (bad && /^[A-Za-z]+$/.test(bad)) {
        throw new Error(`${bad} isn't a valid endpoint — letters repeat: A, B … Z, AA, BB.`);
      }
      if (bad) {
        throw new Error(`${bad} isn't a valid endpoint — use a number (1, 45) or a letter (A, Z, AA).`);
      }
      throw new Error(`Can't mix ${s} and ${e} — both ends must be numbers or both letters.`);
    }

    let count, at;
    if (numeric) {
      const a = parseInt(s, 10), b = parseInt(e, 10);
      if (b < a) throw new Error(`${s} comes after ${e} — ranges don't run backwards.`);
      count = b - a + 1;
      at = i => String(a + i);
    } else {
      const a = alphaIndex(s), b = alphaIndex(e);
      if (b < a) throw new Error(`${s.toUpperCase()} comes after ${e.toUpperCase()} — ranges don't run backwards.`);
      count = b - a + 1;
      at = i => alphaAt(a + i);
    }
    if (count > MAX_ITEMS) {
      throw new Error(`That range is ${count} stickers — the limit is ${MAX_ITEMS}.`);
    }
    return Array.from({ length: count }, (_, i) => pre + at(i));
  }

  function parseLines(text) {
    return String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }

  function rangeLabel(lines) {
    if (!lines || lines.length === 0) return '';
    if (lines.length === 1) return lines[0];
    return `${lines[0]} – ${lines[lines.length - 1]}`;
  }

  return { generateSequence, parseLines, rangeLabel, MAX_ITEMS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sequence;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/sequence.test.mjs`
Expected: 14 passing, 0 failing.

- [ ] **Step 5: Run the whole suite to be sure nothing else moved**

Run: `npm test`
Expected: all passing (the pre-existing count plus 14).

- [ ] **Step 6: Commit**

```bash
git add js/sequence.js test/sequence.test.mjs
git commit -m "feat(print-queue): sequence generator (numeric + doubling alpha, 500 cap)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `js/sticker-pdf.js` — size, start size and title options

**Files:**
- Modify: `js/sticker-pdf.js` (whole file is ~75 lines)
- Modify: `test/sticker-pdf.test.mjs` (append tests)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `StickerPdf.fitLines(text, maxWidth, maxHeight, widthFn, startSize = 22)`
  - `StickerPdf.buildStickerPdf(items, stickerTexts, fontBytes, opts = {})` where `opts = { width?: number, height?: number, startSize?: number, title?: string }`. Omitting every option reproduces today's behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `test/sticker-pdf.test.mjs` (the `load`, `mono`, `plain` helpers at the top of the file are reused; `mono` makes every character `0.5 * size` wide, and `fitLines` needs `lines * size * 1.2 <= maxHeight`):

```js
test('fitLines honours an explicit startSize and shrinks from it', () => {
  const s = load();
  // 4x6 label interior: 268 x 418. ED1 at 140 is 3*140*0.5 = 210 wide, 168 tall -> fits at the ceiling.
  assert.equal(s.fitLines('ED1', 268, 418, mono, 140).size, 140);
  // 3x1 interior: 196 x 52. Height 60*1.2 = 72 > 52, so it must shrink below 60.
  const r = s.fitLines('ED1', 196, 52, mono, 60);
  assert.ok(r.size < 60 && r.size > 6, 'expected a shrink from 60, got ' + r.size);
  assert.ok(r.size * 1.2 <= 52);
});

test('fitLines default start size is still 22', () => {
  const s = load();
  assert.equal(s.fitLines('HI', 196, 52, mono).size, 22);
});

test('buildStickerPdf with no options: 3x1 pages and no Title metadata', async () => {
  const s = load();
  const fontBytes = readFileSync(join(root, 'assets/fonts/Baloo2-SemiBold.ttf'));
  const bytes = await s.buildStickerPdf([['a', 1]], { a: 'A18' }, fontBytes);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(/MediaBox\s*\[\s*0\s+0\s+216\s+72\s*\]/.test(text), 'default page size changed');
  assert.ok(!/\/Title/.test(text), 'default output must not carry a Title');
});

test('buildStickerPdf honours width/height and writes the Title', async () => {
  const s = load();
  const fontBytes = readFileSync(join(root, 'assets/fonts/Baloo2-SemiBold.ttf'));
  const bytes = await s.buildStickerPdf([['a', 2]], { a: 'ED1' }, fontBytes,
    { width: 288, height: 432, startSize: 140, title: 'X' });
  const text = new TextDecoder('latin1').decode(bytes);
  assert.equal(text.match(/\/Type\s*\/Page[^s]/g).length, 2);
  assert.ok(/MediaBox\s*\[\s*0\s+0\s+288\s+432\s*\]/.test(text), 'wrong page size');
  // pdf-lib writes setTitle() as a UTF-16BE hex string: <FEFF0058> for "X"
  assert.ok(/\/Title\s*<feff0058>/i.test(text), 'Title metadata missing');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sticker-pdf.test.mjs`
Expected: the three new tests FAIL (`fitLines` ignores the 5th argument → returns 22, not 140; page size stays 216×72; no Title). The pre-existing tests still pass.

- [ ] **Step 3: Implement**

Replace `fitLines` and `buildStickerPdf` in `js/sticker-pdf.js`:

```js
  function fitLines(text, maxWidth, maxHeight, widthFn, startSize = START_SIZE) {
    for (let size = startSize; size > MIN_SIZE; size--) {
      const lines = wrapText(text, maxWidth, size, widthFn);
      const widest = Math.max(...lines.map(l => widthFn(l, size)));
      if (widest <= maxWidth && lines.length * size * LINE_SPACING <= maxHeight) {
        return { size, lines };
      }
    }
    return { size: MIN_SIZE, lines: wrapText(text, maxWidth, MIN_SIZE, widthFn) };
  }

  /**
   * opts (all optional — omit everything for the VanLab hardware-sticker
   * defaults, which must not change):
   *   width, height  page size in points (default 3in x 1in)
   *   startSize      ceiling font size; fitLines only shrinks from it
   *   title          PDF Title metadata — Chrome shows it in the tab and the
   *                  print dialog, which is the print queue's wrong-printer guard
   */
  async function buildStickerPdf(items, stickerTexts, fontBytes, opts = {}) {
    const W = opts.width || LABEL_W;
    const H = opts.height || LABEL_H;
    const startSize = opts.startSize || START_SIZE;
    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    if (opts.title) doc.setTitle(opts.title);
    const font = await doc.embedFont(fontBytes);
    const widthFn = (t, s) => font.widthOfTextAtSize(t, s);
    for (const [id, qty] of items) {
      const text = stickerTexts[id];
      if (!text) throw new Error('unknown sticker id: ' + id);
      for (let n = 0; n < qty; n++) {
        const page = doc.addPage([W, H]);
        const { size, lines } = fitLines(text, W - 2 * PAD, H - 2 * PAD, widthFn, startSize);
        // Same centering as the Python renderer: block centered vertically,
        // each line centered horizontally.
        let y = (H + lines.length * size * LINE_SPACING) / 2 - size;
        for (const line of lines) {
          page.drawText(line, {
            x: (W - widthFn(line, size)) / 2, y, size, font,
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
```

Also update the file's header comment first line to: `1"x3" hardware-bag sticker PDFs (and, via opts, other label sizes for the print queue), rendered with pdf-lib.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/sticker-pdf.test.mjs`
Expected: all passing, including the four pre-existing ones. If the Title regex fails, print `text.match(/\/Title[^\n]{0,40}/)` once to see pdf-lib's actual encoding and adjust the regex to match it — the requirement is "Title present with options, absent without", not a specific encoding.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all passing. `test/crate-label-pdf.test.mjs` also loads `sticker-pdf.js`; it must still pass.

- [ ] **Step 6: Commit**

```bash
git add js/sticker-pdf.js test/sticker-pdf.test.mjs
git commit -m "feat(sticker-pdf): size, startSize and title options; defaults unchanged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `js/storage.js` — `printQueue` collection

**Files:**
- Modify: `js/storage.js` — add a `/* ── Print Queue ── */` section after the Ticket History section (before the `return {…}` line), and add the new names to the `return` object.
- Create: `test/storage-print-queue.test.mjs`

**Interfaces:**
- Consumes: the module's existing `db` (null when Firebase is off).
- Produces:
  - `Storage.getPrintQueue() → Item[]` — open items (`printedAt == null`), oldest first.
  - `Storage.getPrintedItems() → Item[]` — printed items, most recently printed first.
  - `Storage.addPrintItem({ kind, lines, size, jobName, createdBy }) → Promise<string id>` — **throws** if Firestore rejects; nothing lands in the cache on failure.
  - `Storage.markPrinted(id) → Promise<void>` — **throws** if Firestore rejects.
  - `Storage.loadPrintQueue() → Promise<void>`; `Storage.onPrintQueueChange(callback)`.
  - `Item = { id, kind:'stickers'|'document', lines:string[], fileId:string|null, fileName:string|null, size:'3x1'|'4x6'|'letter', jobName:string|null, createdBy:string, createdAt:number(ms), printedAt:number|null }`

- [ ] **Step 1: Write the failing tests**

`test/storage-print-queue.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');   // no init() => db is null, cache-only

const batch = (lines, extra = {}) => ({
  kind: 'stickers', lines, size: '3x1', jobName: null, createdBy: 'travis@example.com', ...extra,
});

test('empty queue reads as empty arrays', () => {
  assert.deepEqual(Storage.getPrintQueue(), []);
  assert.deepEqual(Storage.getPrintedItems(), []);
});

test('addPrintItem returns an id and the item shows in the open queue, oldest first', async () => {
  const id1 = await Storage.addPrintItem(batch(['ED1', 'ED2']));
  const id2 = await Storage.addPrintItem(batch(['A'], { size: '4x6' }));
  assert.ok(id1 && id2 && id1 !== id2);
  const q = Storage.getPrintQueue();
  assert.deepEqual(q.map(i => i.id), [id1, id2]);
  assert.deepEqual(q[0].lines, ['ED1', 'ED2']);
  assert.equal(q[0].size, '3x1');
  assert.equal(q[0].kind, 'stickers');
  assert.equal(q[0].fileId, null);
  assert.equal(q[0].jobName, null);
  assert.equal(q[0].createdBy, 'travis@example.com');
  assert.equal(typeof q[0].createdAt, 'number');
  assert.equal(q[0].printedAt, null);
});

test('markPrinted moves the item from the open queue to printed history', async () => {
  const id = await Storage.addPrintItem(batch(['X1']));
  await Storage.markPrinted(id);
  assert.ok(!Storage.getPrintQueue().some(i => i.id === id), 'still in the open queue');
  const printed = Storage.getPrintedItems();
  assert.equal(printed[0].id, id, 'most recently printed should come first');
  assert.equal(typeof printed[0].printedAt, 'number');
});

test('markPrinted on an unknown id throws', async () => {
  await assert.rejects(() => Storage.markPrinted('nope'), /unknown print item/);
});

test('addPrintItem does not mutate the caller\'s lines array', async () => {
  const lines = ['ED1'];
  const id = await Storage.addPrintItem(batch(lines));
  Storage.getPrintQueue().find(i => i.id === id).lines.push('ED2');
  assert.deepEqual(lines, ['ED1']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/storage-print-queue.test.mjs`
Expected: FAIL — `Storage.getPrintQueue is not a function`.

- [ ] **Step 3: Implement**

Add the cache near the other caches at the top of `js/storage.js` (after `const projectCustomerCache = {};`):

```js
  const printQueueCache = {};       // { [id]: Item } — see getPrintQueue for the Item shape
  let localPrintId = 0;             // ids when Firebase is off (PASTE config / tests)
```

Add the section before `return { init, …` :

```js
  /* ── Print Queue (the "To Print" panel) ── Firestore printQueue/{id} ──
   * Item: { id, kind:'stickers'|'document', lines, fileId, fileName,
   *         size:'3x1'|'4x6'|'letter', jobName, createdBy, createdAt(ms), printedAt(ms|null) }
   * Printed items stay in the collection (reprints + "did it get printed?"
   * from anywhere); the open list is just printedAt == null.
   */

  function getPrintQueue() {
    return Object.values(printQueueCache)
      .filter(i => i.printedAt == null)
      .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
  }

  function getPrintedItems() {
    return Object.values(printQueueCache)
      .filter(i => i.printedAt != null)
      .sort((a, b) => (b.printedAt ?? 0) - (a.printedAt ?? 0));
  }

  async function addPrintItem(item) {
    // Firestore FIRST, cache second — the reverse of every other writer in
    // this file, and it does not swallow the error. A batch must never show
    // in Collin's list unless it was actually saved (spec: "a failed send
    // must never leave a half-written row in the list").
    const record = {
      kind:      item.kind || 'stickers',
      lines:     Array.isArray(item.lines) ? item.lines.slice() : [],
      fileId:    item.fileId || null,
      fileName:  item.fileName || null,
      size:      item.size,
      jobName:   item.jobName || null,
      createdBy: item.createdBy || '',
      createdAt: Date.now(),
      printedAt: null,
    };
    let id;
    if (db) {
      const ref = db.collection('printQueue').doc();
      await ref.set(record);
      id = ref.id;
    } else {
      id = 'local-' + (++localPrintId);
    }
    printQueueCache[id] = { id, ...record };
    return id;
  }

  async function markPrinted(id) {
    const item = printQueueCache[id];
    if (!item) throw new Error('unknown print item: ' + id);
    const printedAt = Date.now();
    if (db) await db.collection('printQueue').doc(id).update({ printedAt });
    item.printedAt = printedAt;
  }

  async function loadPrintQueue() {
    if (!db) return;
    try {
      const snap = await db.collection('printQueue').get();
      snap.forEach(doc => { printQueueCache[doc.id] = { id: doc.id, ...doc.data() }; });
    } catch (e) {
      console.warn('Firestore loadPrintQueue failed:', e);
    }
  }

  function onPrintQueueChange(callback) {
    if (!db) return;
    // No orderBy — a query orderBy silently drops docs missing the field
    // (see onSheetsChange). Sorting is client-side in getPrintQueue.
    db.collection('printQueue').onSnapshot(snap => {
      Object.keys(printQueueCache).forEach(k => delete printQueueCache[k]);
      snap.forEach(doc => { printQueueCache[doc.id] = { id: doc.id, ...doc.data() }; });
      callback();
    }, err => console.warn('Firestore printQueue listener error:', err));
  }
```

Append to the `return { … }` object: `getPrintQueue, getPrintedItems, addPrintItem, markPrinted, loadPrintQueue, onPrintQueueChange`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/storage-print-queue.test.mjs`
Expected: 5 passing.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all passing (the other two storage test files load the same module and must be unaffected).

- [ ] **Step 6: Commit**

```bash
git add js/storage.js test/storage-print-queue.test.mjs
git commit -m "feat(storage): printQueue collection — add, markPrinted, open/printed views, listener

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Panel, list, badge, Print and Printed (Collin's view)

**Files:**
- Modify: `index.html` — Projects header (`lines 89-95`), insert panel after the Projects `</header>` (`line 95`), script tags (`lines 416-437`).
- Modify: `css/style.css` — append after `.vanlab-van-select` (`line 1813`).
- Modify: `js/app.js` — new section inserted before `/* ═══ Helpers ═══ */` (`~line 1806`); `loadDataAndShowApp()` (`~line 1836`); extract the Baloo font loader from `vanlabPrintStickers()` (`~line 1654`).

**Interfaces:**
- Consumes: `Storage.getPrintQueue/getPrintedItems/markPrinted/loadPrintQueue/onPrintQueueChange` (Task 3); `StickerPdf.buildStickerPdf(items, texts, font, opts)` (Task 2); `Sequence.rangeLabel` (Task 1); existing `escHtml`, `formatDT`.
- Produces (used by Task 5): `renderPrintQueue()`, `pqShowError(msg)`, `PQ_SIZES`, element consts `printQueuePanel`, `printQueueStatus`.

No automated test covers DOM wiring in this repo (all tests are `node --test` on pure modules). Verification is the manual PASTE-mode run in Step 6.

- [ ] **Step 1: Markup**

In `index.html`, Projects header `header-right` — add the button after the dark toggle, before Ticket History:

```html
        <button class="btn btn-ghost btn-sm" id="print-queue-btn">To Print</button>
```

Directly after that header's closing `</header>` (before `<main class="content-main">` of the Projects screen), add:

```html
    <div id="print-queue-panel" class="print-queue-panel" hidden>
      <div class="print-queue-head">
        <span id="print-queue-status" class="vanlab-status"></span>
        <label class="print-queue-toggle">
          <input type="checkbox" id="print-queue-show-printed"> Show printed
        </label>
      </div>
      <div id="print-queue-list" class="print-queue-list"></div>
      <!-- builder disclosures are added in Task 5 -->
    </div>
```

Script tags — add `sequence.js` right after `sticker-pdf.js`, and bump versions of the files this plan changes:

```html
  <script src="js/storage.js?v=13"></script>
  …
  <script src="js/sticker-pdf.js?v=2"></script>
  <script src="js/sequence.js?v=1"></script>
  …
  <script src="js/app.js?v=27"></script>
```

- [ ] **Step 2: Styles**

Append to `css/style.css` after `.vanlab-van-select { max-width: 160px; }`:

```css
/* ── Print queue panel (projects screen) ── */
.print-queue-panel {
  padding: 10px 20px 14px; border-bottom: 1px solid var(--gray-200);
  display: flex; flex-direction: column; gap: 10px;
}
.print-queue-head { display: flex; align-items: center; gap: 12px; min-height: 20px; }
.print-queue-toggle { margin-left: auto; font-size: 0.8rem; color: var(--gray-500); display: flex; align-items: center; gap: 6px; cursor: pointer; }
.print-queue-list { display: flex; flex-direction: column; gap: 8px; }
.print-queue-empty { font-size: 0.85rem; color: var(--gray-500); }
.pq-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px;
  padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: 8px;
}
.pq-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 220px; }
.pq-row-what { font-weight: 700; font-size: 1rem; overflow-wrap: anywhere; }
.pq-row-meta { font-size: 0.8rem; color: var(--gray-500); }
.pq-row-actions { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.pq-row-hint { font-size: 0.72rem; color: var(--gray-500); margin-top: 3px; text-align: center; }
.print-queue-builder { border: 1px dashed var(--gray-300); border-radius: 8px; padding: 6px 12px; }
.print-queue-builder > summary { cursor: pointer; font-size: 0.85rem; font-weight: 600; color: var(--gray-500); list-style: none; }
.print-queue-builder > summary::-webkit-details-marker { display: none; }
.print-queue-builder-body { display: flex; flex-direction: column; gap: 10px; padding: 10px 0 6px; }
.print-queue-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.print-queue-range .form-input { max-width: 120px; }
.print-queue-size { display: flex; gap: 16px; font-size: 0.85rem; }
.print-queue-size label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
@media (max-width: 480px) {
  .print-queue-panel { padding: 10px 12px 12px; }
  .pq-row-actions { width: 100%; }
}
```

(`--gray-200`, `--gray-300`, `--gray-500`, `--red` already exist as tokens in both themes.)

- [ ] **Step 3: Shared font loader**

In `js/app.js`, inside `vanlabPrintStickers()` replace

```js
    if (!vanlabFontBytes) {
      const resp = await fetch('assets/fonts/Baloo2-SemiBold.ttf');
      if (!resp.ok) throw new Error('font file missing');
      vanlabFontBytes = new Uint8Array(await resp.arrayBuffer());
    }
    const bytes = await StickerPdf.buildStickerPdf(res.items, STICKER_MAP.stickers, vanlabFontBytes);
```

with

```js
    const bytes = await StickerPdf.buildStickerPdf(res.items, STICKER_MAP.stickers, await loadBalooFont());
```

and add, just below the `let vanlabCrateBlobUrl = null;` declaration:

```js
async function loadBalooFont() {
  if (!vanlabFontBytes) {
    const resp = await fetch('assets/fonts/Baloo2-SemiBold.ttf');
    if (!resp.ok) throw new Error('font file missing');
    vanlabFontBytes = new Uint8Array(await resp.arrayBuffer());
  }
  return vanlabFontBytes;
}
```

- [ ] **Step 4: Print Queue section**

Insert before `/* ═══ Helpers ═══ */` in `js/app.js`:

```js
/* ══════════════════════════════════════════
   Print Queue — the "To Print" panel (projects screen)
   Spec: docs/superpowers/specs/2026-09-10-print-queue-design.md
══════════════════════════════════════════ */
const printQueueBtn         = document.getElementById('print-queue-btn');
const printQueuePanel       = document.getElementById('print-queue-panel');
const printQueueStatus      = document.getElementById('print-queue-status');
const printQueueList        = document.getElementById('print-queue-list');
const printQueueShowPrinted = document.getElementById('print-queue-show-printed');
let pqLastBlobUrl = null;   // last queue-PDF object URL, revoked before a new one

// Page size / font ceiling / printer name per sticker size (spec § PDF rendering).
const PQ_SIZES = {
  '3x1': { width: 3 * 72, height: 1 * 72, startSize: 60,  printer: 'STICKERS 1x3' },
  '4x6': { width: 4 * 72, height: 6 * 72, startSize: 140, printer: 'CRATE LABEL 4x6' },
};

// Firebase only gives us the sign-in email. Map the two operators to the
// names they go by; anything else falls back to the part before the @.
const PQ_DISPLAY_NAMES = {
  // 'travis@example.com': 'Travis',
  // 'collin@example.com': 'Collin',
};
function pqDisplayName(email) {
  if (!email) return 'Someone';
  return PQ_DISPLAY_NAMES[email.toLowerCase()] || email.split('@')[0];
}

function pqSetStatus(text, isError) {
  printQueueStatus.textContent = text;
  printQueueStatus.classList.toggle('vanlab-status-error', !!isError);
}

function pqTitle(item) {
  const label = item.lines.length === 1 ? item.lines[0] : `${item.lines[0]}-${item.lines[item.lines.length - 1]}`;
  return `${label} · ${item.size} · ${item.lines.length} stickers`;
}

function renderPrintQueue() {
  const open = Storage.getPrintQueue();
  printQueueBtn.textContent = open.length ? `To Print (${open.length})` : 'To Print';
  if (printQueuePanel.hidden) return;

  const showPrinted = printQueueShowPrinted.checked;
  const items = showPrinted ? Storage.getPrintedItems() : open;
  if (!items.length) {
    printQueueList.innerHTML = `<div class="print-queue-empty">${showPrinted ? 'Nothing printed yet.' : 'Nothing waiting to print.'}</div>`;
    return;
  }
  printQueueList.innerHTML = items.map(item => {
    const spec = PQ_SIZES[item.size];
    const count = item.lines.length;
    const when = item.createdAt ? formatDT(new Date(item.createdAt)) : '';
    const printedNote = item.printedAt ? ` · printed ${formatDT(new Date(item.printedAt))}` : '';
    return `
      <div class="pq-row" data-id="${escHtml(item.id)}">
        <div class="pq-row-main">
          <span class="pq-row-what">${escHtml(Sequence.rangeLabel(item.lines))}</span>
          <span class="pq-row-meta">${count} sticker${count !== 1 ? 's' : ''} · ${escHtml(item.size)}${item.jobName ? ' · ' + escHtml(item.jobName) : ''} · ${escHtml(pqDisplayName(item.createdBy))} · ${escHtml(when)}${printedNote}</span>
        </div>
        <div class="pq-row-actions">
          <div>
            <button class="btn btn-primary btn-sm" data-action="print">Print ${count} sticker${count !== 1 ? 's' : ''} → ${escHtml(spec ? spec.printer : item.size)}</button>
            <div class="pq-row-hint">100% scale · margins none</div>
          </div>
          ${item.printedAt ? '' : '<button class="btn btn-ghost btn-sm" data-action="printed">Printed</button>'}
        </div>
      </div>`;
  }).join('');
}

async function pqPrint(item, button) {
  const spec = PQ_SIZES[item.size];
  if (!spec) { pqSetStatus(`Can't print: unknown size ${item.size}.`, true); return; }
  button.disabled = true;
  pqSetStatus('Building the sticker PDF…');
  try {
    const texts = {};
    const items = item.lines.map((line, i) => { texts[i] = line; return [i, 1]; });
    const bytes = await StickerPdf.buildStickerPdf(items, texts, await loadBalooFont(),
      { width: spec.width, height: spec.height, startSize: spec.startSize, title: pqTitle(item) });
    if (pqLastBlobUrl) URL.revokeObjectURL(pqLastBlobUrl);
    pqLastBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (!window.open(pqLastBlobUrl, '_blank')) {
      pqSetStatus('Popup blocked — allow popups for this site, then click Print again.', true);
      return;
    }
    pqSetStatus(`${item.lines.length} stickers ready — print the opened PDF on the ${spec.printer} printer at 100% scale.`);
  } catch (err) {
    pqSetStatus(`Couldn't build the sticker PDF — ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function pqMarkPrinted(item, button) {
  button.disabled = true;
  try {
    await Storage.markPrinted(item.id);
    pqSetStatus(`${Sequence.rangeLabel(item.lines)} marked printed.`);
    renderPrintQueue();
  } catch (err) {
    // Row stays in the list; the real reason is the message.
    pqSetStatus(`Couldn't mark it printed — ${err.message}. Try again.`, true);
    button.disabled = false;
  }
}

printQueueList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.pq-row').dataset.id;
  const item = [...Storage.getPrintQueue(), ...Storage.getPrintedItems()].find(i => i.id === id);
  if (!item) return;
  if (btn.dataset.action === 'print') pqPrint(item, btn);
  if (btn.dataset.action === 'printed') pqMarkPrinted(item, btn);
});

printQueueBtn.addEventListener('click', () => {
  printQueuePanel.hidden = !printQueuePanel.hidden;
  pqSetStatus('');
  renderPrintQueue();
});

printQueueShowPrinted.addEventListener('change', renderPrintQueue);
```

- [ ] **Step 5: Load + listener registration**

In `loadDataAndShowApp()`:

Add `Storage.loadPrintQueue(),` to the `Promise.all([...])` list (after `Storage.loadAnnotations(),`).

After the `Storage.onCustomersChange(…)` block, add:

```js
  Storage.onPrintQueueChange(() => {
    // Badge count on the To Print button updates everywhere; the list only
    // re-renders while the panel is open (renderPrintQueue checks).
    renderPrintQueue();
  });

  renderPrintQueue();   // initial badge from the loaded cache
```

Also make `showProjectsScreen()` (`~line 284`) call `renderPrintQueue();` after `renderProjects();` so the badge is correct whenever the screen appears.

- [ ] **Step 6: Manual verification in PASTE mode (never against production)**

From Git Bash:

```bash
SRC="/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
DST="$TEMP/cnc-pq-test"; rm -rf "$DST"; mkdir -p "$DST"
cp -r "$SRC"/{index.html,css,js,assets,package.json} "$DST"/
cat > "$DST/js/firebase-config.js" <<'EOF'
const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };
EOF
cd "$DST" && npx serve . -l 5055
```

Open http://localhost:5055. In PASTE mode there is no sign-in and Storage is cache-only, so:

1. The Projects header shows **To Print** with no count. Click it — panel opens with "Nothing waiting to print."
2. In DevTools console: `Storage.addPrintItem({kind:'stickers', lines:['ED1','ED2','ED3'], size:'3x1', createdBy:'t@x'}).then(renderPrintQueue)` — a row appears: `ED1 – ED3`, `3 stickers · 3x1 · t · <date>`, button `Print 3 stickers → STICKERS 1x3`, hint `100% scale · margins none`, button `Printed`. Badge reads `To Print (1)`.
3. Click **Print** — a new tab opens; its title is `ED1-ED3 · 3x1 · 3 stickers`; three pages, big text. Ctrl+P shows that title in the dialog header. Cancel.
4. Repeat step 2 with `size:'4x6'` — button says `→ CRATE LABEL 4x6`; the PDF is portrait 4×6 with much larger text.
5. Click **Printed** on the first row — it disappears, badge goes to `(1)`. Tick **Show printed** — the row is back with `· printed <date>`, Print button only, no Printed button.
6. Open the VanLab panel on a job screen and print hardware stickers — still 3×1, same look as before (regression check on Task 2 defaults).
7. Resize to 320px wide — rows wrap, nothing overflows horizontally.

Stop the server (Ctrl+C) and delete `$DST` when done.

- [ ] **Step 7: Run the suite, commit**

Run: `npm test` — all passing.

```bash
git add index.html css/style.css js/app.js
git commit -m "feat(print-queue): To Print panel — list, badge, Print (titled PDF), Printed, history toggle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The builder — + New batch (Travis's view)

**Files:**
- Modify: `index.html` — inside `#print-queue-panel`, replace the `<!-- builder disclosures … -->` comment.
- Modify: `js/app.js` — append to the Print Queue section from Task 4.

**Interfaces:**
- Consumes: `Sequence.generateSequence/parseLines/MAX_ITEMS` (Task 1), `Storage.addPrintItem` (Task 3), `pqSetStatus`, `renderPrintQueue` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: Markup**

Replace the comment inside `#print-queue-panel` with:

```html
      <details class="print-queue-builder" id="pq-builder">
        <summary>+ New batch</summary>
        <div class="print-queue-builder-body">
          <label class="form-label" for="pq-lines">Stickers — one per line</label>
          <textarea id="pq-lines" class="form-input form-textarea form-textarea--tall" placeholder="ED1&#10;ED2&#10;ED3 …" spellcheck="false"></textarea>
          <div class="print-queue-range">
            <span class="form-label">Fill a range:</span>
            <input id="pq-prefix" class="form-input" placeholder="prefix (ED)" autocapitalize="off">
            <input id="pq-start" class="form-input" placeholder="start (1 or A)">
            <input id="pq-end" class="form-input" placeholder="end (45 or Z)">
            <button class="btn btn-outline btn-sm" id="pq-fill-btn" type="button">Fill</button>
          </div>
          <div class="print-queue-size">
            <label><input type="radio" name="pq-size" value="3x1" checked> 3x1 thermal</label>
            <label><input type="radio" name="pq-size" value="4x6"> 4x6 thermal</label>
          </div>
          <div id="pq-error" class="vanlab-status vanlab-status-error" hidden></div>
          <div><button class="btn btn-primary btn-sm" id="pq-send-btn" type="button">Send to print list</button></div>
        </div>
      </details>
```

- [ ] **Step 2: Wiring**

Append to the Print Queue section in `js/app.js` (after the `printQueueShowPrinted.addEventListener` line):

```js
/* ── Builder: + New batch ── */
const pqBuilder = document.getElementById('pq-builder');
const pqLines   = document.getElementById('pq-lines');
const pqPrefix  = document.getElementById('pq-prefix');
const pqStart   = document.getElementById('pq-start');
const pqEnd     = document.getElementById('pq-end');
const pqError   = document.getElementById('pq-error');
const pqFillBtn = document.getElementById('pq-fill-btn');
const pqSendBtn = document.getElementById('pq-send-btn');

function pqShowError(msg) {
  pqError.textContent = msg;
  pqError.hidden = !msg;
}

function pqFill() {
  try {
    const lines = Sequence.generateSequence(pqPrefix.value, pqStart.value, pqEnd.value);
    const existing = pqLines.value.replace(/\s+$/, '');
    pqLines.value = (existing ? existing + '\n' : '') + lines.join('\n');
    pqShowError('');
    pqLines.scrollTop = pqLines.scrollHeight;
  } catch (err) {
    pqShowError(err.message);
  }
}

async function pqSend() {
  const lines = Sequence.parseLines(pqLines.value);
  if (!lines.length) { pqShowError('Type at least one sticker line, or fill a range first.'); return; }
  if (lines.length > Sequence.MAX_ITEMS) {
    pqShowError(`That's ${lines.length} stickers — the limit is ${Sequence.MAX_ITEMS} per batch.`);
    return;
  }
  const size = document.querySelector('input[name="pq-size"]:checked').value;
  const user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
  pqSendBtn.disabled = true;
  try {
    // Nothing is written until here — the textarea is the only draft state,
    // so Collin never sees a batch appear one line at a time.
    await Storage.addPrintItem({ kind: 'stickers', lines, size, jobName: null, createdBy: user ? user.email : '' });
    pqLines.value = '';
    pqShowError('');
    pqBuilder.open = false;
    pqSetStatus(`${lines.length} sticker${lines.length !== 1 ? 's' : ''} sent to the print list.`);
    renderPrintQueue();
  } catch (err) {
    // Firestore rejected (rules missing, offline…): nothing was cached, so
    // the list is untouched. Say why.
    pqShowError(`Couldn't send — ${err.message}`);
  } finally {
    pqSendBtn.disabled = false;
  }
}

pqFillBtn.addEventListener('click', pqFill);
pqSendBtn.addEventListener('click', pqSend);
[pqPrefix, pqStart, pqEnd].forEach(el => el.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); pqFill(); }
}));
```

- [ ] **Step 3: Manual verification (same PASTE-mode copy as Task 4 Step 6 — re-copy the changed files first)**

```bash
cp "$SRC"/index.html "$DST"/ && cp "$SRC"/js/app.js "$DST"/js/ && cp "$SRC"/css/style.css "$DST"/css/
```

Hard-refresh http://localhost:5055, open **To Print**:

1. Panel shows the list area and a collapsed **+ New batch**. Nothing else. Open it.
2. Prefix `ED`, start `1`, end `45`, **Fill** → the textarea holds `ED1` … `ED45` (45 lines). Fill again with `A`…`C` → three more lines appended below (`EDA EDB EDC`).
3. Delete a line by hand — it stays deleted (textarea is the source of truth).
4. Start `A`, end `AB`, Fill → red message `AB isn't a valid endpoint — letters repeat: A, B … Z, AA, BB.` Nothing appended.
5. Start `45`, end `1` → `45 comes after 1 — ranges don't run backwards.`
6. Start `1`, end `Z` → `Can't mix 1 and Z — both ends must be numbers or both letters.`
7. Start `1`, end `999` → `That range is 999 stickers — the limit is 500.`
8. Clear the textarea, click **Send** → `Type at least one sticker line, or fill a range first.`
9. Fill `ED` `1` `45`, pick **4x6 thermal**, Send → the builder collapses, status says `45 stickers sent to the print list.`, a row `ED1 – ED45 · 45 stickers · 4x6` appears, badge `To Print (1)`.
10. Print that row → PDF tab titled `ED1-ED45 · 4x6 · 45 stickers`, 45 portrait pages.
11. Nothing in the builder is visible when `+ New batch` is collapsed; Show printed toggle still works.

Stop the server and delete `$DST`.

- [ ] **Step 4: Run the suite, commit**

Run: `npm test` — all passing.

```bash
git add index.html js/app.js
git commit -m "feat(print-queue): + New batch builder — textarea, range fill, size, send

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs, rules step, and the live checklist

**Files:**
- Modify: `CLAUDE.md` (repo) — file-structure block and the `storage.js` line.
- Modify: `G:\My Drive\Brain\Brain\Projects\CNC Job Tracker.md` (vault) — collections list, status.
- Modify: `docs/superpowers/specs/2026-09-10-print-queue-design.md` — status line.

- [ ] **Step 1: Repo CLAUDE.md**

In the file-structure block, change the `js/storage.js` line to end with `…projectCustomer/, printQueue/ collections) with in-memory cache for sync reads` and add after the `js/sticker-pdf.js`-adjacent entries (the block currently lists only the core files; add these two lines after `js/path-utils.js`):

```
├── js/sequence.js               — generateSequence(prefix, start, end) for the To Print panel: numeric or doubling-alpha (A…Z, AA, BB…), cap 500; parseLines, rangeLabel
```

and in the Architecture → Screens list, under **Projects directory**, append: `; a **To Print** header button opens a collapsed print-queue panel (list of queued sticker batches for the shop floor, + New batch builder) — spec in docs/superpowers/specs/2026-09-10-print-queue-design.md`.

- [ ] **Step 2: Vault note**

In `CNC Job Tracker.md`:

- In *Follow-ups this exposed*, change `The app touches **8 collections** — sheets, completions, projectNotes, sheetNotes, ticketHistory, customers, projectCustomer, sheetAnnotations` to `**9 collections** — …, sheetAnnotations, printQueue`.
- Add a status entry at the top of the status/history area:

```
**2026-09-10 — Print queue (To Print panel), Phase 1 built on branch `print-queue`, NOT merged.**
Travis queues sticker batches (typed or range-filled, 3x1 / 4x6); Collin prints and marks printed from the Projects screen. Spec: `docs/superpowers/specs/2026-09-10-print-queue-design.md`. Plan: `docs/superpowers/plans/2026-09-10-print-queue-phase1.md`.
- [ ] **Firestore rule for `printQueue`** — console only. Copy the `sheetAnnotations` match block (Travis + Collin email allowlist), rename to `printQueue`. Without it every Send fails with a permission error (surfaced inline — this feature does not swallow it).
- [ ] Fill `PQ_DISPLAY_NAMES` in `js/app.js` with the two sign-in emails → `Travis` / `Collin` (otherwise rows show the part before the @).
- [ ] Live test on `master` after merge: one 3x1 batch on STICKERS 1x3, one 4x6 on CRATE LABEL 4x6, badge updates on a second device.
- Phase 2 (job tagging) and Phase 3 (documents via Apps Script) not started.
```

- [ ] **Step 3: Spec status line**

Change the spec's `**Status:**` line to end `— Phase 1 implemented 2026-09-10 on branch print-queue (plan: ../plans/2026-09-10-print-queue-phase1.md); Phases 2–3 not started`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-10-print-queue-design.md
git commit -m "docs: print queue phase 1 — CLAUDE.md map, spec status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The vault note is on `G:` outside this repo; it has no git.

- [ ] **Step 5: Hand-off (not merge)**

Do **not** merge to `master` — that is a live deploy. Report to Travis with the two manual steps he owns before anything can be tested live (the Firestore rule, then the display-name map), and that merge + go-live comes after his rule is in place. The **go-live** skill handles the push when he says so.

---

## Self-review

**Spec coverage (Phase 1 only):**
- Panel on the header, collapsed, `To Print (n)` badge → Task 4.
- List rows: what / count / size / who / when; Print with printer name + settings line; Printed → Task 4.
- History (Show printed toggle, Print only) → Task 4.
- Builder: textarea source of truth, range filler appends, size radio, Send; draft-only until Send → Task 5.
- Sequence generation incl. doubling, I/O kept, AB error, reversed error, mixed error, 500 cap → Task 1.
- `buildStickerPdf` opts; defaults unchanged; `fitLines` startSize; Title metadata → Task 2.
- `printQueue` collection, no orderBy, cache, printedAt lifecycle → Task 3.
- Rules manual step + allowlist → Task 6 (and Global Constraints).
- Error handling table: empty box, invalid/reversed/AB, endpoint-down on Print (N/A in Phase 1 — no endpoint), failed send leaves no row → Tasks 3 & 5.
- Testing: sequence tests, structural sticker-pdf guard, manual printer checks → Tasks 1, 2, 6.
- Job tag column: rendered if present (Task 4 handles `jobName`), always null in Phase 1. Documents: Phase 3, out of scope here.

**Placeholder scan:** none found. `PQ_DISPLAY_NAMES` is intentionally empty (Travis's emails are his to fill; the fallback works without them).

**Type consistency:** `Storage.addPrintItem` shape matches what Task 5 sends; `getPrintQueue`/`getPrintedItems` are the two reads Task 4 uses; `StickerPdf.buildStickerPdf(items, texts, font, {width,height,startSize,title})` matches Task 2; `Sequence.rangeLabel/parseLines/generateSequence/MAX_ITEMS` match Task 1; `loadBalooFont()` is defined in Task 4 Step 3 before it is used in Step 4.
