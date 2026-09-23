# Print Queue — Retention (delete, undo, 30-day window) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The printed list becomes *recent* history rather than all-time history. The app loads open items plus items printed in the last **30 days** (Travis approved 2026-09-23); anything older is deleted by an explicit "Clear printed older than 30 days" action, not merely hidden. A misclicked **Printed** can be undone, and a single printed row can be deleted after a confirm.

**Architecture:** `js/storage.js` swaps the one whole-collection `get()`/`onSnapshot()` for **two single-field queries** (`printedAt == null` and `printedAt >= cutoff`) whose results are kept in two source maps and merged into the existing `printQueueCache`, so neither listener can wipe the other's items. Four new storage functions (`unmarkPrinted`, `deletePrintItem`, `countPrintedBefore`, `clearPrintedBefore`) and two exported retention helpers. `js/app.js` adds Undo (head-row button after a Printed click, plus an **Undo printed** button on printed rows), a **Delete** button on printed rows behind the repo's standard `confirm()`, and a **Clear printed older than 30 days** button in the printed view behind a count-then-confirm. No new modules, no endpoint change, no rules change.

**Tech Stack:** Vanilla JS (IIFE modules, `module.exports` shim), Firestore compat SDK 10.12.0 (`index.html` line 18), `node --test` (159 tests passing at plan time — `npm test`).

**Spec:** `docs/superpowers/specs/2026-09-10-print-queue-design.md` — binding. This plan **amends** its *Lifecycle* section ("the document is never deleted") via a dated *Retention amendment* appended in Task 5, mirroring how the *Phase 3 amendment* was added.

## Travis's decisions (2026-09-23) — settled, do not re-open

1. **Retention window = 30 days.**
2. **No auto-purge.** Ship the button only; nothing deletes silently on Collin's PC.
3. **No Delete on open rows.** Destructive controls stay out of Collin's default view. Mis-sent batch path stays: Printed → Show printed → Delete.
4. **Drive PDFs are left in place** when a `document` row is deleted. No new endpoint action, no Apps Script redeploy.
5. **Button wording on printed rows is `Undo printed`** (not "Not printed").

## Global Constraints

- **Never run the app against the real Firestore.** `js/firebase-config.js` is production. Manual checks run from a temp copy with `projectId: "PASTE_DISABLED"` **and** `js/endpoint-config.js` blanked to `PASTE_URL` (repo `CLAUDE.md` → Testing safety). Task 4 has the exact commands.
- **`master` is a live deploy** (GitHub Pages, no CI). All work on branch `print-queue-retention`; a push to `master` is the deploy, and a push is not a finished deploy until the Pages build says `built` (Task 6).
- **No Firestore rules change and no rules deploy.** `C:\Users\Golden Boys\Documents\Agemtic Workflows\HQ\firestore.rules` line 45: `match /printQueue/{id} { allow read, write: if request.auth != null && request.auth.token.email in ['huffman44@gmail.com', '777litch777@gmail.com']; }`. In Firestore rules `write` is shorthand for `create`, `update` **and `delete`**, so both operators can already delete. Do not edit rules (they live in HQ and deploy from there; console edits get wiped).
- **No composite index is needed** — see Task 1 Step 0 for the reasoning and the live check in Task 6. If a `failed-precondition` / "requires an index" error ever appears, the index must be recorded in `HQ/firestore.indexes.json` (exists) and deployed from HQ, never created console-only.
- **Never `orderBy` on `printQueue`.** House rule since 2026-07-17: a query `orderBy` silently drops docs missing the field. Sorting stays client-side in `getPrintQueue`/`getPrintedItems`. Adding an `orderBy` to the `>=` query is also exactly what *would* require a composite index.
- **`printedAt` is always written as a literal `null` or a ms number.** Never `FieldValue.delete()` it — `where('printedAt', '==', null)` matches only docs that *have* the field set to null, so a doc with the field removed would vanish from both queries.
- **Do not touch** `js/sticker-map.generated.js` (generated; history of being clobbered), `pqPrint`, `pqPrintDocument`, `PQ_SIZES`, `pqTitle`, or anything in the two print paths verified on the shop floor today (3x1 stickers → `STICKERS 1x3`; 4x6 documents → `CRATE LABEL 4x6`). Task 6 checks `git diff` for zero hunks in those functions.
- **Cache-busting is mandatory:** `js/storage.js?v=14→15`, `js/app.js?v=33→34`, `css/style.css?v=22→23` in `index.html` (lines 471, 488, 9). Bump in the same commit as the file edit.
- **Operator spelling is `Collin`.** Collin is the shop-floor operator who marks things printed; every destructive control assumes a busy person may misclick.
- **Ordering is preserved:** open items oldest-first by `createdAt`, printed items most-recently-printed first (existing `getPrintQueue`/`getPrintedItems` sorts stay verbatim).
- **Retention constant lives in one place:** `Storage.PRINT_RETENTION_DAYS = 30`. All UI copy reads it; nothing hard-codes "30".

---

## Design decisions (and why)

1. **Two single-field queries, not one `Filter.or` and not a client-side filter over the whole collection.** `where('printedAt','==',null)` and `where('printedAt','>=',cutoff)` are each served by Firestore's automatic single-field index, so no composite index is needed and no index deploy can be forgotten. Compat 10.12.0 does support `Filter.or`, but one OR listener buys nothing here and makes the cache bookkeeping implicit; two listeners make "which query owns which items" explicit and unit-testable with the repo's existing fake-`db` pattern.
2. **Cache = merge of two source maps.** Today the single snapshot handler wipes `printQueueCache` and rebuilds it. With two listeners that would be a bug: the printed listener firing would wipe every open item. So each handler replaces only its own source map, then the cache is rebuilt from both. Printed is merged after open so that when an id momentarily sits in both (the two listeners fire back to back on a mark-printed), the just-printed copy wins and the item never flashes back into Collin's open list.
3. **`getPrintedItems()` also applies the 30-day window client-side.** The `>=` cutoff is frozen when the listener is registered, and the shop PC's tab lives for days. The client filter keeps the displayed window honest without a reload, and it makes the boundary testable in Node with no `db` at all.
4. **Undo is non-destructive, so it has no confirm.** `unmarkPrinted` writes `printedAt: null` — the exact reverse of `markPrinted`. Two entry points: the head-row **Undo** button that appears right after a Printed click (the misclick case), and an **Undo printed** button on printed rows (the "noticed later" case).
5. **Delete uses `confirm()`, on printed rows only, Firestore-first.** `confirm()` is the repo's established destructive pattern (app.js lines 438, 587, 645, 1516, 1528). Firestore-first with the error re-thrown (like `markPrinted`, unlike the cache-first writers) because a delete that didn't happen must not look like it did. If Chrome has suppressed dialogs for the site, `confirm()` returns `false` and nothing is deleted — the safe direction. Delete is visually separated (red, extra gap) from Print / Undo printed so a thumb reaching for Print doesn't land on it.
6. **Bulk clear queries Firestore directly, counts first, then confirms with the count.** Items older than 30 days are *not* in the cache by design, so the clear must run its own `where('printedAt','<',cutoff)` query. It shows the count before the confirm, batch-deletes in chunks of 500 (Firestore's write-batch limit; `clearSheets` uses one batch, which is fine for its size but not for a queue that has accumulated for months), and — belt and braces — only deletes docs whose `printedAt` is a **number** below the cutoff, so an open item can never be swept up regardless of how the range filter treats nulls.
7. **No automatic purge** (Travis, 2026-09-23). This plan ships the button only. Note that the feature went live 2026-09-11, so on go-live day nothing is older than 30 days yet — the first real purge falls around 2026-10-11, and until then the button will correctly report nothing to clear.
8. **Drive PDFs are left alone** (Travis, 2026-09-23). Deleting a `document` item removes the Firestore doc only; the PDF stays in the `CNC Print Queue` Drive folder. Removing it would need a new `deleteDoc` Apps Script action plus a live redeploy — the 2026-09-11 redeploy took all endpoint actions down for ~15 minutes — and the spec already accepts orphaned uploads. The confirm text says so.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `js/storage.js` | modify | Retention constants; two scoped queries; source-map cache rebuild; `unmarkPrinted`, `deletePrintItem`, `countPrintedBefore`, `clearPrintedBefore`; header comment. |
| `test/storage-print-queue-retention.test.mjs` | create | Fake-`db` coverage: query shape, no `orderBy`, cache isolation, transitions, 30-day boundary, undo, delete, bulk clear (chunking, null guard). |
| `test/storage-print-queue.test.mjs` | modify | One existing fake `db` must gain `.where()` (it will otherwise break). |
| `js/app.js` | modify | Print Queue section: Undo, Undo printed, Delete, Clear-older, copy that reads `PRINT_RETENTION_DAYS`. |
| `index.html` | modify | Two buttons in `.print-queue-head`; toggle label; three `?v=` bumps. |
| `css/style.css` | modify | `.pq-row-delete`. |
| `docs/superpowers/specs/2026-09-10-print-queue-design.md` | modify | Status line + *Retention amendment (2026-09-23)*. |
| `CLAUDE.md` (repo) | modify | `js/storage.js` line mentions the 30-day window. |
| `G:\My Drive\Brain\Brain\Projects\CNC Job Tracker.md` (vault) | modify | Status entry under the Print queue section. |

---

### Task 0: Branch

- [ ] `git checkout -b print-queue-retention` from `master` (`a75d850`). Nothing in this plan touches `master` until Task 6.

---

### Task 1: `js/storage.js` — scoped load + listener, merged cache, retention helpers

**Files:**
- Modify: `js/storage.js` — the `/* ── Print Queue ── */` section (lines 438–520) and the `return {…}` (line 522); `index.html` line 471 `storage.js?v=15`.
- Create: `test/storage-print-queue-retention.test.mjs`
- Modify: `test/storage-print-queue.test.mjs` (the `loadPrintQueue tolerates a doc with no lines array` fake).

**Interfaces:**
- Produces:
  - `Storage.PRINT_RETENTION_DAYS` — `30`.
  - `Storage.printRetentionCutoff(now = Date.now()) → number` — `now - 30 days` in ms.
  - `Storage.loadPrintQueue()` / `Storage.onPrintQueueChange(cb)` — same signatures, now scoped. The listener registers **two** `onSnapshot`s; `cb` fires on either.
  - `Storage.getPrintedItems()` — additionally filters to `printedAt >= printRetentionCutoff()`; sort unchanged.
  - `Storage.getPrintQueue()`, `addPrintItem`, `markPrinted` — unchanged.

- [ ] **Step 0: Confirm no composite index is needed (reasoning, no action)**

Firestore needs a composite index when a query filters on one field and orders by another, or combines range filters across fields. Both queries here filter on the single field `printedAt` with no `orderBy` (the `>=` query is implicitly ordered by `printedAt` itself). Single-field filters are served by the automatic single-field indexes, which exist for every field unless exempted. **No index to create, no deploy.** The live check is Task 6 Step 3: if the console ever shows `FirebaseError: … The query requires an index …`, stop — the listener error handler only `console.warn`s and the panel would silently show empty. That would mean someone added an `orderBy`, which this plan forbids.

- [ ] **Step 1: Write the failing tests**

`test/storage-print-queue-retention.test.mjs` — a fresh `node --test` process, so the module-level cache starts empty:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

const DAY = 24 * 60 * 60 * 1000;
const doc = (id, data = {}) => ({
  id, ref: { id },
  data: () => ({ kind: 'stickers', lines: ['X'], size: '3x1', createdAt: 1, printedAt: null, ...data }),
});
const snapOf = docs => ({ size: docs.length, empty: !docs.length, docs, forEach: fn => docs.forEach(fn) });

// Minimal Firestore-compat fake for the printQueue collection. `results` maps a
// where() operator ('==', '>=', '<') to the docs that query returns. Records every
// where(), doc update/delete and batch; lets a test fire either listener by hand.
// Any unscoped get()/onSnapshot() or any orderBy() throws — both are forbidden.
function fakeDb(results = {}) {
  const log = { wheres: [], updates: [], deletes: [], batches: [], listeners: {} };
  const docsFor = w => (typeof results[w.op] === 'function' ? results[w.op](w) : results[w.op]) || [];
  const query = w => ({
    orderBy: () => { throw new Error('orderBy is forbidden on printQueue'); },
    get: async () => snapOf(docsFor(w)),
    onSnapshot: onNext => { log.listeners[w.op] = onNext; onNext(snapOf(docsFor(w))); },
  });
  const db = {
    collection: name => {
      assert.equal(name, 'printQueue');
      return {
        where: (field, op, value) => { const w = { field, op, value }; log.wheres.push(w); return query(w); },
        get: () => { throw new Error('unscoped get() on printQueue'); },
        onSnapshot: () => { throw new Error('unscoped onSnapshot() on printQueue'); },
        doc: id => ({
          update: async data => { log.updates.push({ id, data }); },
          delete: async () => { if (results.failDelete) throw new Error('boom'); log.deletes.push(id); },
        }),
      };
    },
    batch: () => {
      const ids = [];
      return { delete: ref => ids.push(ref.id), commit: async () => { if (results.failBatch) throw new Error('batch boom'); log.batches.push(ids); } };
    },
  };
  return { db, log, fire: (op, docs) => log.listeners[op](snapOf(docs)) };
}

// Reset the shared cache between tests: a scoped load with empty results rebuilds
// both sources empty.
async function reset() {
  Storage.init(fakeDb().db);
  await Storage.loadPrintQueue();
  Storage.init(null);
}

test('retention constants: 30 days, cutoff is now minus 30 days', () => {
  assert.equal(Storage.PRINT_RETENTION_DAYS, 30);
  assert.equal(Storage.printRetentionCutoff(1_000_000_000_000), 1_000_000_000_000 - 30 * DAY);
});

test('loadPrintQueue issues exactly two single-field queries and never an orderBy', async () => {
  const { db, log } = fakeDb({ '==': [doc('o1')], '>=': [doc('p1', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    const before = Date.now();
    await Storage.loadPrintQueue();
    assert.deepEqual(log.wheres.map(w => [w.field, w.op]), [['printedAt', '=='], ['printedAt', '>=']]);
    assert.equal(log.wheres[0].value, null);
    const cutoff = log.wheres[1].value;
    assert.ok(Math.abs(cutoff - Storage.printRetentionCutoff(before)) < 1000, 'cutoff is not 30 days ago');
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o1']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p1']);
  } finally { Storage.init(null); }
});

test('printed listener firing does not wipe open items, and vice versa', async () => {
  const { db, log, fire } = fakeDb({ '==': [doc('o1'), doc('o2')], '>=': [doc('p1', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    let calls = 0;
    Storage.onPrintQueueChange(() => calls++);
    assert.equal(Object.keys(log.listeners).length, 2, 'two listeners registered');
    assert.equal(calls, 2, 'callback fired once per initial snapshot');
    // Remote change on the printed side: p1 gone, p2 arrives. Open items untouched.
    fire('>=', [doc('p2', { printedAt: Date.now() - 2 * DAY })]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o1', 'o2']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p2']);
    // Remote delete on the open side: o1 gone. Printed untouched.
    fire('==', [doc('o2')]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o2']);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['p2']);
    assert.equal(calls, 4);
  } finally { Storage.init(null); }
});

test('an item moving from open to printed ends up printed exactly once, whichever listener fires first', async () => {
  const { db, fire } = fakeDb({ '==': [doc('x')], '>=': [] });
  Storage.init(db);
  try {
    Storage.onPrintQueueChange(() => {});
    const t = Date.now() - 1000;
    // printed listener first: x is momentarily in both sources — printed wins
    fire('>=', [doc('x', { printedAt: t })]);
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), []);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['x']);
    fire('==', []);
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['x']);
    assert.equal(Storage.getPrintedItems()[0].printedAt, t);
  } finally { Storage.init(null); }
});

test('getPrintedItems shows 29d23h59m-old items and hides 30d0h1m-old ones, newest first', async () => {
  const now = Date.now();
  const { db } = fakeDb({ '==': [], '>=': [
    doc('edge-in',  { printedAt: now - 30 * DAY + 60_000 }),
    doc('edge-out', { printedAt: now - 30 * DAY - 60_000 }),   // a stale tab's listener could still hold this
    doc('recent',   { printedAt: now - DAY }),
  ] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    assert.deepEqual(Storage.getPrintedItems().map(i => i.id), ['recent', 'edge-in']);
  } finally { Storage.init(null); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/storage-print-queue-retention.test.mjs`
Expected: FAIL — `PRINT_RETENTION_DAYS` undefined; `unscoped get() on printQueue` thrown from `loadPrintQueue` (caught and warned, so the list assertions fail).

- [ ] **Step 3: Implement**

Replace the section header comment and `getPrintedItems`, `loadPrintQueue`, `onPrintQueueChange` in `js/storage.js`:

```js
  /* ── Print Queue (the "To Print" panel) ── Firestore printQueue/{id} ──
   * Item: { id, kind:'stickers'|'document', lines, fileId, fileName, pages,
   *         size:'3x1'|'4x6'|'letter', jobName, createdBy, createdAt(ms), printedAt(ms|null) }
   * Open items (printedAt == null) live until printed. Printed items are RECENT
   * history only: the app loads the last PRINT_RETENTION_DAYS of them and
   * clearPrintedBefore() deletes the rest (retention amendment, 2026-09-23).
   * Two single-field queries, never an orderBy (see onSheetsChange).
   */
  const PRINT_RETENTION_DAYS = 30;
  const PRINT_RETENTION_MS = PRINT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  function printRetentionCutoff(now = Date.now()) { return now - PRINT_RETENTION_MS; }

  // printQueueCache is the MERGE of two query results. Each snapshot handler
  // replaces only its own source and the merge is rebuilt, so the printed
  // listener firing can never wipe open items and vice versa.
  const printQueueSources = { open: {}, printed: {} };

  function printQueueQueries() {
    const col = db.collection('printQueue');
    return {
      // `== null` matches only docs that HAVE printedAt set to null. Every
      // writer below sets it explicitly (null or a number). Never
      // FieldValue.delete() it — the doc would drop out of both queries.
      open:    col.where('printedAt', '==', null),
      printed: col.where('printedAt', '>=', printRetentionCutoff()),
    };
  }

  function applyPrintSnapshot(source, snap) {
    const next = {};
    snap.forEach(doc => { next[doc.id] = printItemFromDoc(doc); });
    printQueueSources[source] = next;
    Object.keys(printQueueCache).forEach(k => delete printQueueCache[k]);
    // Open first, printed second: when an id sits in both for an instant (the two
    // listeners fire back to back on a mark-printed) the printed copy wins, so a
    // just-marked item never flashes back into Collin's open list.
    Object.assign(printQueueCache, printQueueSources.open, printQueueSources.printed);
  }
```

`getPrintedItems` becomes (sort verbatim; only the filter grows):

```js
  function getPrintedItems() {
    // The query cutoff is frozen when the listener starts and the shop PC's tab
    // lives for days — re-apply the window here so the list stays honest.
    const cutoff = printRetentionCutoff();
    return Object.values(printQueueCache)
      .filter(i => i.printedAt != null && i.printedAt >= cutoff)
      .sort((a, b) => (b.printedAt ?? 0) - (a.printedAt ?? 0));
  }
```

`loadPrintQueue` / `onPrintQueueChange`:

```js
  async function loadPrintQueue() {
    if (!db) return;
    try {
      const q = printQueueQueries();
      const [open, printed] = await Promise.all([q.open.get(), q.printed.get()]);
      applyPrintSnapshot('open', open);
      applyPrintSnapshot('printed', printed);
    } catch (e) {
      console.warn('Firestore loadPrintQueue failed:', e);
    }
  }

  function onPrintQueueChange(callback) {
    if (!db) return;
    const q = printQueueQueries();
    for (const source of ['open', 'printed']) {
      q[source].onSnapshot(snap => {
        applyPrintSnapshot(source, snap);
        callback();
      }, err => console.warn(`Firestore printQueue (${source}) listener error:`, err));
    }
  }
```

Add `PRINT_RETENTION_DAYS, printRetentionCutoff` to the `return {…}` object.

Fix the existing test in `test/storage-print-queue.test.mjs` (`loadPrintQueue tolerates a doc with no lines array`): its fake is `{ collection: () => ({ get }) }` and will now throw inside `loadPrintQueue`. Change it to `{ collection: () => ({ where: () => ({ get: async () => ({ forEach: fn => fn({ id: 'odd', … }) }) }) }) }` — both queries return the same odd doc; the assertion is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/storage-print-queue-retention.test.mjs test/storage-print-queue.test.mjs`
Expected: all passing (5 new + the existing 7).

- [ ] **Step 5: Bump and run the whole suite**

`index.html` line 471 → `js/storage.js?v=15`. Run `npm test` — expected 164 passing.

- [ ] **Step 6: Commit**

```bash
git add js/storage.js index.html test/storage-print-queue-retention.test.mjs test/storage-print-queue.test.mjs
git commit -m "feat(storage): printQueue loads open + last-30-day printed only; two scoped listeners merged into the cache"
```

---

### Task 2: `js/storage.js` — undo, delete, count and bulk clear

**Files:**
- Modify: `js/storage.js` (same section); `test/storage-print-queue-retention.test.mjs` (append).

**Interfaces:**
- Produces:
  - `Storage.unmarkPrinted(id) → Promise<void>` — `update({ printedAt: null })`; throws on unknown id or Firestore rejection.
  - `Storage.deletePrintItem(id) → Promise<void>` — Firestore delete **first**, throws on rejection, cache entry removed only on success.
  - `Storage.countPrintedBefore(cutoff) → Promise<number>` — count of docs with a numeric `printedAt < cutoff`.
  - `Storage.clearPrintedBefore(cutoff) → Promise<number>` — batch-deletes those docs (chunks of 500), removes any of them from the cache, returns the count; throws on failure.

- [ ] **Step 1: Write the failing tests** (append to the retention test file)

```js
test('unmarkPrinted puts the item back in the open queue with a literal null', async () => {
  await reset();
  const id = await Storage.addPrintItem({ kind: 'stickers', lines: ['U1'], size: '3x1' });
  await Storage.markPrinted(id);
  assert.ok(Storage.getPrintedItems().some(i => i.id === id));
  await Storage.unmarkPrinted(id);
  assert.ok(Storage.getPrintQueue().some(i => i.id === id), 'not back in the open queue');
  assert.ok(!Storage.getPrintedItems().some(i => i.id === id), 'still in printed');
  assert.equal(Storage.getPrintQueue().find(i => i.id === id).printedAt, null);
  await assert.rejects(() => Storage.unmarkPrinted('nope'), /unknown print item/);
});

test('unmarkPrinted writes { printedAt: null } to Firestore (never a field delete)', async () => {
  const { db, log } = fakeDb({ '==': [], '>=': [doc('p', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await Storage.unmarkPrinted('p');
    assert.deepEqual(log.updates, [{ id: 'p', data: { printedAt: null } }]);
  } finally { Storage.init(null); }
});

test('deletePrintItem removes the item from the cache and from Firestore', async () => {
  const { db, log } = fakeDb({ '==': [doc('o')], '>=': [doc('p', { printedAt: Date.now() - DAY })] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await Storage.deletePrintItem('p');
    assert.deepEqual(log.deletes, ['p']);
    assert.ok(!Storage.getPrintedItems().some(i => i.id === 'p'));
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['o'], 'open item must survive');
    await assert.rejects(() => Storage.deletePrintItem('nope'), /unknown print item/);
  } finally { Storage.init(null); }
});

test('deletePrintItem keeps the cache entry when Firestore rejects', async () => {
  const { db } = fakeDb({ '==': [], '>=': [doc('p', { printedAt: Date.now() - DAY })], failDelete: true });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await assert.rejects(() => Storage.deletePrintItem('p'), /boom/);
    assert.ok(Storage.getPrintedItems().some(i => i.id === 'p'), 'a failed delete must not look like it happened');
  } finally { Storage.init(null); }
});

test('countPrintedBefore / clearPrintedBefore query printedAt < cutoff, chunk at 500, and never touch open items', async () => {
  const cutoff = Date.now() - 30 * DAY;
  const old = Array.from({ length: 1001 }, (_, i) => doc('old' + i, { printedAt: cutoff - 1 - i }));
  // A null-printedAt doc smuggled into the '<' result must be ignored, whatever Firestore does with nulls.
  const { db, log } = fakeDb({ '==': [doc('open')], '>=': [], '<': [...old, doc('open')] });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    assert.equal(await Storage.countPrintedBefore(cutoff), 1001);
    const n = await Storage.clearPrintedBefore(cutoff);
    assert.equal(n, 1001);
    assert.deepEqual(log.batches.map(b => b.length), [500, 500, 1]);
    assert.ok(!log.batches.flat().includes('open'), 'open item was batched for deletion');
    assert.deepEqual(Storage.getPrintQueue().map(i => i.id), ['open']);
    assert.ok(log.wheres.some(w => w.op === '<' && w.value === cutoff));
  } finally { Storage.init(null); }
});

test('clearPrintedBefore rethrows a batch failure', async () => {
  const cutoff = Date.now() - 30 * DAY;
  const { db } = fakeDb({ '==': [], '>=': [], '<': [doc('old', { printedAt: cutoff - 1 })], failBatch: true });
  Storage.init(db);
  try {
    await Storage.loadPrintQueue();
    await assert.rejects(() => Storage.clearPrintedBefore(cutoff), /batch boom/);
  } finally { Storage.init(null); }
});
```

- [ ] **Step 2: Run to verify they fail** — `node --test test/storage-print-queue-retention.test.mjs` → `Storage.unmarkPrinted is not a function` etc.

- [ ] **Step 3: Implement** (after `markPrinted`):

```js
  async function unmarkPrinted(id) {
    const item = printQueueCache[id];
    if (!item) throw new Error('unknown print item: ' + id);
    // A literal null, never FieldValue.delete() — see printQueueQueries.
    if (db) await db.collection('printQueue').doc(id).update({ printedAt: null });
    item.printedAt = null;
  }

  async function deletePrintItem(id) {
    if (!printQueueCache[id]) throw new Error('unknown print item: ' + id);
    // Firestore FIRST and the error is NOT swallowed: a delete that didn't
    // happen must not look like it did. Deleting a 'document' item does not
    // touch its PDF in the CNC Print Queue Drive folder (retention amendment).
    if (db) await db.collection('printQueue').doc(id).delete();
    delete printQueueCache[id];
  }

  // Docs older than the window are NOT in the cache (that is the point), so
  // these two go to Firestore directly. Only a numeric printedAt below the
  // cutoff counts — an open item (null) must never be swept up, whatever the
  // range filter does with nulls.
  const isPrintedBefore = (data, cutoff) => typeof data.printedAt === 'number' && data.printedAt < cutoff;

  async function countPrintedBefore(cutoff) {
    if (!db) return Object.values(printQueueCache).filter(i => isPrintedBefore(i, cutoff)).length;
    const snap = await db.collection('printQueue').where('printedAt', '<', cutoff).get();
    return snap.docs.filter(d => isPrintedBefore(d.data() || {}, cutoff)).length;
  }

  async function clearPrintedBefore(cutoff) {
    if (!db) {
      const ids = Object.keys(printQueueCache).filter(id => isPrintedBefore(printQueueCache[id], cutoff));
      ids.forEach(id => delete printQueueCache[id]);
      return ids.length;
    }
    const snap = await db.collection('printQueue').where('printedAt', '<', cutoff).get();
    const docs = snap.docs.filter(d => isPrintedBefore(d.data() || {}, cutoff));
    for (let i = 0; i < docs.length; i += 500) {          // Firestore write-batch limit
      const batch = db.batch();
      docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    docs.forEach(d => delete printQueueCache[d.id]);
    return docs.length;
  }
```

Add `unmarkPrinted, deletePrintItem, countPrintedBefore, clearPrintedBefore` to the `return {…}` object.

- [ ] **Step 4: Run** the retention file, then `npm test` — expected 170 passing.

- [ ] **Step 5: Commit**

```bash
git add js/storage.js test/storage-print-queue-retention.test.mjs
git commit -m "feat(storage): printQueue unmarkPrinted, deletePrintItem, countPrintedBefore, clearPrintedBefore (chunked, null-guarded)"
```

---

### Task 3: Panel UI — Undo, Undo printed, Delete, Clear older

**Files:**
- Modify: `index.html` — `.print-queue-head` (lines 98–103); line 9 `style.css?v=23`; line 488 `app.js?v=34`.
- Modify: `css/style.css` — append after `.pq-doc-staged` (line 1852).
- Modify: `js/app.js` — Print Queue section (lines 1815–1982 only). **No edits to `pqPrint`, `pqPrintDocument`, `PQ_SIZES`, `pqTitle`.**

**Interfaces:**
- Consumes: Task 1–2 storage API; existing `escHtml`, `formatDT`, `Sequence.rangeLabel`, `confirm()`.

No automated test covers DOM wiring in this repo; verification is Task 4.

- [ ] **Step 1: Markup**

Replace `.print-queue-head` in `index.html`:

```html
      <div class="print-queue-head">
        <span id="print-queue-status" class="vanlab-status"></span>
        <button class="btn btn-outline btn-sm" id="print-queue-undo" type="button" hidden>Undo</button>
        <label class="print-queue-toggle">
          <input type="checkbox" id="print-queue-show-printed"> Show printed (last 30 days)
        </label>
        <button class="btn btn-ghost btn-sm" id="print-queue-clear-old" type="button" hidden>Clear printed older than 30 days</button>
      </div>
```

Bump line 9 to `css/style.css?v=23` and line 488 to `js/app.js?v=34`.

- [ ] **Step 2: Styles** — append to `css/style.css` after `.pq-doc-staged`:

```css
.pq-row-delete { color: var(--red); margin-left: 12px; }   /* kept apart from Print / Undo printed — a thumb on the shop floor */
```

- [ ] **Step 3: app.js — element refs, status helper, shared label**

After `const printQueueShowPrinted = …` (line 1819):

```js
const printQueueUndo     = document.getElementById('print-queue-undo');
const printQueueClearOld = document.getElementById('print-queue-clear-old');
let pqUndoId = null;   // item the head-row Undo reverts; any other status change clears it
```

Replace `pqSetStatus` so every status change retires the Undo offer:

```js
function pqSetStatus(text, isError) {
  printQueueStatus.textContent = text;
  printQueueStatus.classList.toggle('vanlab-status-error', !!isError);
  pqUndoId = null;
  printQueueUndo.hidden = true;
}

function pqWhat(item) {
  return item.kind === 'document' ? (item.fileName || 'document') : Sequence.rangeLabel(item.lines);
}
```

(`pqMarkPrinted` line 1956 computes the same `what` inline; switch it to `pqWhat(item)`.)

- [ ] **Step 4: app.js — `renderPrintQueue` changes** (three edits, nothing else in the function moves)

After `const showPrinted = printQueueShowPrinted.checked;`:
```js
  printQueueClearOld.hidden = !showPrinted;
```
Empty-state copy:
```js
    printQueueList.innerHTML = `<div class="print-queue-empty">${showPrinted ? `Nothing printed in the last ${Storage.PRINT_RETENTION_DAYS} days.` : 'Nothing waiting to print.'}</div>`;
```
Row buttons (replaces the `${item.printedAt ? '' : '<button … data-action="printed">Printed</button>'}` line):
```js
          ${item.printedAt
            ? '<button class="btn btn-ghost btn-sm" data-action="unprint">Undo printed</button><button class="btn btn-ghost btn-sm pq-row-delete" data-action="delete">Delete</button>'
            : '<button class="btn btn-ghost btn-sm" data-action="printed">Printed</button>'}
```

- [ ] **Step 5: app.js — handlers**

In `pqMarkPrinted`, after `pqSetStatus(\`${what} marked printed.\`);` add:
```js
    pqUndoId = item.id;
    printQueueUndo.disabled = false;   // a previous Undo click leaves it disabled
    printQueueUndo.hidden = false;
```

New functions after `pqMarkPrinted`:

```js
async function pqUnmarkPrinted(id, button) {
  button.disabled = true;
  const item = [...Storage.getPrintQueue(), ...Storage.getPrintedItems()].find(i => i.id === id);
  try {
    await Storage.unmarkPrinted(id);
    pqSetStatus(`${item ? pqWhat(item) : 'Item'} is back in the queue.`);
    renderPrintQueue();
  } catch (err) {
    pqSetStatus(`Couldn't undo — ${err.message}. Try again.`, true);
    button.disabled = false;
  }
}

async function pqDelete(item, button) {
  // Irreversible. confirm() is the repo's destructive-action pattern; if Chrome
  // has suppressed dialogs for the site it returns false and nothing happens.
  const printed = item.printedAt ? `, printed ${formatDT(new Date(item.printedAt))}` : '';
  const drive = item.kind === 'document' ? ' The PDF itself stays in the CNC Print Queue Drive folder.' : '';
  if (!confirm(`Delete "${pqWhat(item)}"${printed}? This removes it for everyone and can't be undone.${drive}`)) return;
  button.disabled = true;
  try {
    await Storage.deletePrintItem(item.id);
    pqSetStatus(`${pqWhat(item)} deleted.`);
    renderPrintQueue();
  } catch (err) {
    pqSetStatus(`Couldn't delete — ${err.message}. Try again.`, true);
    button.disabled = false;
  }
}

async function pqClearOld() {
  const days = Storage.PRINT_RETENTION_DAYS;
  const cutoff = Storage.printRetentionCutoff();
  printQueueClearOld.disabled = true;
  try {
    pqSetStatus('Counting…');
    const n = await Storage.countPrintedBefore(cutoff);
    if (!n) { pqSetStatus(`Nothing printed more than ${days} days ago.`); return; }
    if (!confirm(`Permanently delete ${n} printed item${n !== 1 ? 's' : ''} older than ${days} days? They aren't shown in this list and can't be recovered.`)) {
      pqSetStatus('');
      return;
    }
    const deleted = await Storage.clearPrintedBefore(cutoff);
    pqSetStatus(`Deleted ${deleted} printed item${deleted !== 1 ? 's' : ''}.`);
    renderPrintQueue();
  } catch (err) {
    pqSetStatus(`Couldn't clear — ${err.message}. Try again.`, true);
  } finally {
    printQueueClearOld.disabled = false;
  }
}
```

Extend the list click delegate (lines 1972–1973):
```js
  if (btn.dataset.action === 'unprint') pqUnmarkPrinted(item.id, btn);
  if (btn.dataset.action === 'delete')  pqDelete(item, btn);
```
Wire the two head buttons after `printQueueShowPrinted.addEventListener('change', renderPrintQueue);`:
```js
printQueueUndo.addEventListener('click', () => { if (pqUndoId) pqUnmarkPrinted(pqUndoId, printQueueUndo); });
printQueueClearOld.addEventListener('click', pqClearOld);
```

- [ ] **Step 6: Confirm the print paths are untouched**

Run: `git diff master -- js/app.js | grep -E '^[-+]' | grep -E 'pqPrint|PQ_SIZES|pqTitle|buildStickerPdf|getDoc'`
Expected: no output. Then `npm test` — 170 passing.

- [ ] **Step 7: Commit**

```bash
git add index.html css/style.css js/app.js
git commit -m "feat(print-queue): Undo / Undo printed, Delete on printed rows (confirm), Clear printed older than 30 days"
```

---

### Task 4: Manual verification in PASTE mode (never against production)

From Git Bash:

```bash
SRC="/c/Users/Golden Boys/Documents/Agemtic Workflows/CNC_WebApp"
DST="$TEMP/cnc-pq-retention"; rm -rf "$DST"; mkdir -p "$DST"
cp -r "$SRC"/{index.html,css,js,assets,package.json} "$DST"/
cat > "$DST/js/firebase-config.js" <<'EOF'
const FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'PASTE_DISABLED', appId: 'x' };
EOF
cat > "$DST/js/endpoint-config.js" <<'EOF'
const ENDPOINT_CONFIG = { url: 'PASTE_URL', token: 'x' };
EOF
cd "$DST" && npx serve . -l 5055
```

Open http://localhost:5055 (cache-only, no listeners), open **To Print**, DevTools console:

- [ ] 1. `await Storage.addPrintItem({kind:'stickers', lines:['ED1','ED2','ED3'], size:'3x1', createdBy:'huffman44@x'}); await Storage.addPrintItem({kind:'stickers', lines:['A'], size:'4x6', createdBy:'777litch777@x'}); renderPrintQueue()` — two rows, badge `To Print (2)`. Rows show only Print + **Printed** (no Delete on open rows).
- [ ] 2. **Regression:** Print on the 3x1 row → tab titled `ED1-ED3 · 3x1 · 3 stickers`, three 3x1 pages; Print on the 4x6 row → `A · 4x6 · 1 stickers`, one portrait 4x6 page. (The document path `pqPrintDocument` has no diff — Step 6 of Task 3 — and gets its real check on the shop PC in Task 6.)
- [ ] 3. Click **Printed** on `ED1 – ED3` → status `ED1 – ED3 marked printed.` with an **Undo** button beside it; badge `(1)`. Click **Undo** → status `ED1 – ED3 is back in the queue.`, Undo hidden, row back, badge `(2)`.
- [ ] 4. Printed again; tick **Show printed (last 30 days)** → row shows `· printed <time>`, buttons Print / **Undo printed** / **Delete** (red). Clear-older button visible in the head only while the toggle is ticked. Click **Undo printed** → row leaves the printed view, badge `(2)`.
- [ ] 5. Printed again, Show printed, click **Delete** → confirm names the batch and the printed time; **Cancel** → nothing changes. Delete → **OK** → row gone, status `ED1 – ED3 deleted.`, badge `(1)`, `Storage.getPrintedItems().length === 0`.
- [ ] 6. 30-day boundary: mark the `A` row printed, then in the console age it in place: `const it = Storage.getPrintedItems()[0]; it.printedAt = Date.now() - 31*86400000; renderPrintQueue()` → printed view reads `Nothing printed in the last 30 days.` Click **Clear printed older than 30 days** → confirm `Permanently delete 1 printed item older than 30 days?` → OK → `Deleted 1 printed item.` Click again → `Nothing printed more than 30 days ago.` (no confirm).
- [ ] 7. Any status change (e.g. click Print) hides a pending Undo.
- [ ] 8. Open the VanLab panel on a job screen and print hardware stickers — unchanged (shared `sticker-pdf.js` untouched, but it's the cheap regression check).
- [ ] 9. Resize to 320px — the head row wraps; Delete stays visually separate from Print.

Stop the server, `rm -rf "$DST"`.

---

### Task 5: Docs

**Files:** the spec, repo `CLAUDE.md`, vault note.

- [ ] **Step 1: Spec** — `docs/superpowers/specs/2026-09-10-print-queue-design.md`. Status line: append `; Retention amendment 2026-09-23 (30-day printed window, undo, delete — plan: ../plans/2026-09-23-print-queue-retention.md)`. Append a section:

```
## Retention amendment (2026-09-23) — printed history is recent, not all-time

Approved by Travis 2026-09-23. Where this disagrees with *Lifecycle* above, this wins.

| Original | Now | Why |
|---|---|---|
| Printed items stay in the collection forever; `loadPrintQueue`/listener read the whole collection | The app loads **open items + items printed in the last 30 days**; older printed items are **deleted** by *Clear printed older than 30 days* | Every batch ever printed was loading on every app start, unbounded |
| `Printed` is permanent | **Undo** right after the click, and **Undo printed** on any printed row | Collin marks things printed on a busy shop floor; a misclick was permanent |
| No delete | **Delete** on printed rows, behind a confirm | Nothing could be removed from the list |

- Two single-field queries (`printedAt == null`, `printedAt >= now − 30 d`), no `orderBy`, no composite index. The cache is the merge of both; each listener replaces only its own half.
- `printedAt` is always a literal `null` or a ms number — never removed from the doc.
- Deleting a `document` item does **not** delete its PDF from the `CNC Print Queue` Drive folder (would need a new endpoint action and a live redeploy). Travis prunes the folder by hand if it ever matters.
- Firestore rules: `allow read, write` on `printQueue` already covers delete. No rules change.
- Reprints are therefore possible for 30 days, not forever.
- No automatic purge: the clear runs only when the button is pressed (Travis, 2026-09-23).
- No Delete on open rows: destructive controls stay out of the default view (Travis, 2026-09-23).
```

- [ ] **Step 2: Repo `CLAUDE.md`** — `js/storage.js` line: append ` — printQueue loads open items + printed-in-last-30-days only (two scoped listeners merged into one cache; older printed items are deleted by "Clear printed older than 30 days")`.

- [ ] **Step 3: Vault note** — `G:\My Drive\Brain\Brain\Projects\CNC Job Tracker.md`, in the *Print queue* section after the "Badge updates on a second device" line:

```
- [ ] **Retention (2026-09-23) — built on branch `print-queue-retention`, NOT merged.** Printed list = last 30 days (Travis approved 9/23); older items deleted by "Clear printed older than 30 days"; Undo / Undo printed; Delete on printed rows. No rules change (`write` covers delete). Plan: `docs/superpowers/plans/2026-09-23-print-queue-retention.md`.
  - [ ] Live check after go-live: console shows no "requires an index" error; badge correct; Undo works; one real delete; Clear-older reports 0 (nothing is older than 30 d until ~10/11).
  - [ ] Re-run 3x1 → STICKERS 1x3 and 4x6 doc → CRATE LABEL 4x6 on the shop PC (both passed 9/23 before this change).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-10-print-queue-design.md docs/superpowers/plans/2026-09-23-print-queue-retention.md
git commit -m "docs: print queue retention amendment — spec, CLAUDE.md, plan"
```

---

### Task 6: Merge, go-live, confirm the live build

A push is not a deploy. Pages must report the build finished and the live site must serve the new `?v=` files.

- [ ] **Step 1:** `npm test` on the branch → 170 passing. `git checkout master && git merge --no-ff print-queue-retention`.
- [ ] **Step 2:** Use the **go-live** skill (it pushes and waits for the Pages build to report `built`). Otherwise: `git push origin master`, then `gh api repos/huffman44-ctrl/CNC-Job-Tracker/pages/builds/latest --jq '.status'` until `built`, then `curl -s https://huffman44-ctrl.github.io/CNC-Job-Tracker/ | grep -E 'app\.js\?v=|storage\.js\?v=|style\.css\?v='` shows `v=34`, `v=15`, `v=23`.
- [ ] **Step 3: Live check (Travis, office PC, DevTools open, hard refresh Ctrl+Shift+R):**
  1. Console: no `FirebaseError` mentioning `index` or `failed-precondition`; no `printQueue (open|printed) listener error`.
  2. Badge shows today's real open count; Show printed lists only items printed since ~2026-08-24 (i.e. everything since go-live on 9/11 — the list should look unchanged today).
  3. Send a 1-line test batch `RETENTION-TEST`, mark Printed, click **Undo** → back in the open list; mark Printed again, Show printed → **Delete** → OK → gone. On a second device/tab the row disappears live.
  4. **Clear printed older than 30 days** → `Nothing printed more than 30 days ago.` (Optional full-path check: mark a 1-line test batch printed, edit its `printedAt` in the Firestore console to `Date.now() - 31 days`, hard refresh → it is absent from Show printed; Clear-older → confirm `1` → deleted. Delete nothing else.)
  5. **Shop PC regression (Collin or Travis):** one 3x1 batch printed on `STICKERS 1x3` and one 4x6 document printed on `CRATE LABEL 4x6`, both from the queue. Both passed 2026-09-23 before this change and must pass after.
- [ ] **Step 4:** Tick the vault-note checkboxes with the date and the commit hash; `git branch -d print-queue-retention`.

---

## Risks

| Risk | Where it bites | Mitigation |
|---|---|---|
| Printed listener's snapshot wipes open items (or vice versa) | The whole-cache wipe in the old handler | Source maps + `applyPrintSnapshot`; isolation test in Task 1 |
| Item momentarily in both sources during mark/undo | Two listeners fire back to back | Printed merged last; transition test in Task 1; both events fire from the local write within the same turn |
| Bulk clear sweeps open items if `<` matches nulls | `clearPrintedBefore` | Client-side `typeof printedAt === 'number'` guard; test smuggles an open doc into the `<` result |
| Accidental single delete by a busy operator | Delete button | Printed rows only; `confirm()` with the item named; red and spaced from Print; Firestore-first so a failure can't masquerade as success |
| Frozen query cutoff in a days-old tab | `printQueueQueries()` | Client-side window in `getPrintedItems`; reload refreshes the listener |
| `printedAt` field removed by a console edit | Both queries | All writers set a literal null; comment at the query; spec note |
| A future `orderBy` on the `>=` query needs a composite index and fails only in prod | Task 1 Step 0 | Forbidden by Global Constraints; console check in Task 6 Step 3 |
| Existing test breaks (`loadPrintQueue tolerates…`) | Fake `db` lacks `.where` | Updated in Task 1 |
| Stale cached JS/CSS on GitHub Pages | Everything | Three `?v=` bumps, verified by `curl` in Task 6 |
| >500 docs in one batch | `clearPrintedBefore` | Chunked; test asserts `[500, 500, 1]` |
| Reprints of a batch older than 30 days are no longer possible | By design (Travis approved) | Spec amendment says so explicitly |
| Orphaned Drive PDFs | Deleting document items | Left in place (Travis, 9/23); called out in the confirm and the spec |
