# Print Queue — Design

**Status:** designed 2026-09-10, reviewed against the code 2026-09-10 (7 corrections
folded in, see *Review notes* at the end) — Phase 1 implemented 2026-09-10 on branch print-queue (plan: ../plans/2026-09-10-print-queue-phase1.md); Phase 3 (documents) implemented 2026-09-11 on branch print-queue-docs (plan: ../plans/2026-09-11-print-queue-phase3-documents.md) — live script redeploy pending; Phase 2 not started; Retention amendment 2026-09-23 (30-day printed window, undo, delete — plan: ../plans/2026-09-23-print-queue-retention.md)
**Brainstormed with:** Travis
**Depends on:** `js/sticker-pdf.js`, `js/endpoint.js`, `js/storage.js`, `js/auth.js`

## Goal

Give Travis a way to put work in front of Collin (who runs the shop floor) without
phoning him: a shared list inside the CNC Job Tracker that says *here is what needs
printing*. Two kinds of item go in it — batches of stickers generated from text, and
documents Travis uploads for the regular printer.

Collin opens it and sees only the list. The tools that built the list stay folded away.

This is a **print queue**, not a sticker queue. Stickers are one item type. The
header button reads **To Print**, because that is what it means to the person who
opens it most.

## Why this isn't the existing VanLab Printing panel

The header already has a **VanLab Stickers** button opening a hidden panel with
*Print Hardware Stickers*, *Print Packing List*, *Print Crate Label*. Those print
from a **fixed map**: a van number goes in, a predetermined sticker list comes out
(`STICKER_MAP`, `js/sticker-map.generated.js`).

Nothing today lets Travis author an **arbitrary** batch — `ED1`–`ED45` — and leave it
waiting for Collin. That is the gap this fills. The VanLab panel stays exactly as it
is; this sits beside it.

## Architecture

A second collapsed panel in the Projects-screen header, following the established
`vanlab-panel` pattern (`hidden` attribute toggled by a `btn-ghost btn-sm` button).
No new screens, no router changes.

```
Header:  [ VanLab Stickers ]  [ To Print (3) ]
                                    |
                         ┌──────────┴───────────────────────────┐
                         │  THE LIST         (everyone sees)    │
                         │   row · row · row                    │
                         ├──────────────────────────────────────┤
                         │  + New batch      (collapsed)        │
                         │  + Send a document(collapsed)        │
                         └──────────────────────────────────────┘
```

The badge count on the button is the whole notification system. `To Print (3)` is
the "hey, there's stickers to print" that Travis currently delivers by phone.

### Visibility: collapsed, not gated

Decided: **no role gating** (Travis, 2026-09-10 — "let's just do A for now").

The builder is a collapsed disclosure. Collin *can* open it; he has no reason to.
The app does have per-user identity available (`firebase.auth().currentUser`,
`js/auth.js`) if this ever needs to become real gating — but it does not today, and
we are not building the plumbing for a restriction nobody asked for.

**Consequence to accept knowingly:** a stray click can open the builder on the shop
computer. Nothing in the builder destroys queued work — it only creates — so the
blast radius is a confused operator, not lost data. Revisit only if that happens.

### Draft vs sent

A batch does not exist for Collin until Travis presses **Send to print list**. The
builder holds unsent work in local component state only — nothing is written to
Firestore until send.

Without this, Collin watches `ED1`…`ED45` appear one row at a time while Travis is
still typing.

## UI: the list (Collin's view)

One row per queued item, newest last. Each row shows:

| Field | Example |
|---|---|
| What it is | `ED1 – ED45` (first–last for a generated range; the filename for a document) |
| Count | `45 stickers` / `1 sheet` |
| Size | `3x1` · `4x6` · `Letter` |
| Job tag | `Order 1206` — omitted when untagged |
| Who / when | `Travis · today 9:14 AM` — name from a small email→name map in `app.js` (Travis, Collin); unknown emails show the part before the `@` |

Two buttons per row:

- **Print** — labelled with its destination: `Print 45 stickers → STICKERS 1x3`.
  Builds (or fetches) the PDF and opens it in a new tab. Beneath the button, a
  settings line: *100% scale · margins none*.
- **Printed** — removes the row from the list (see Lifecycle).

That is the entire default view. No builder controls, no size pickers, no evidence
of the authoring side.

## UI: the builder (Travis's view)

Below the list, two collapsed disclosures.

### + New batch

- **Text box** — one line per sticker. This is the source of truth; the range
  filler simply writes into it.
- **Range filler** — three small inputs (`prefix`, `start`, `end`) and a *Fill*
  button that appends generated lines to the text box. Travis can then edit them by
  hand like any other lines.
- **Size** — radio: `3x1 thermal` · `4x6 thermal`.
- **Job tag** — optional; picks from existing project names.
- **Send to print list.**

### + Send a document

- **File picker** — one PDF or image.
- **Job tag** — optional.
- **Send to print list.**

Size for documents is always `Letter`; the regular printer is the only destination
for them.

> **Superseded 2026-09-11** — documents are `4x6` or `letter`, auto-detected from the PDF.
> See *Phase 3 amendment* at the end of this document.

## Sequence generation

The single piece of real logic here, and the one most worth unit-testing. Lives in a
new `js/sequence.js` as a pure function so it can be tested without a browser.

`generateSequence(prefix, start, end) → string[]`

**Mode is auto-detected from the inputs** — there is no numeric/alpha toggle to
forget:

- Both `start` and `end` match `/^\d+$/` → **numeric**. `ED`, `1`, `45` →
  `ED1 … ED45`. No zero-padding.
- Both match `/^([A-Za-z])\1*$/` (one letter, repeated) → **alpha**. Endpoints are
  uppercased before use, so `ed`/`a`/`z` and `ED`/`A`/`Z` behave identically. The
  prefix is left exactly as typed — it is Travis's text, not a code.
- Anything else → throw with a message naming the offending input.
- `end` before `start` in either mode → throw. Ranges do not run backwards.
- More than **500** items → throw (`"That range is 100000 stickers — the limit is 500."`).
  Without a cap a typo renders a hundred thousand pages and freezes the tab.

### Alpha ordering: doubling

Decided: **doubling, not spreadsheet style** (Travis, 2026-09-10).

```
index →  0..25   A  B  C … Z
        26..51   AA BB CC … ZZ
        52..77   AAA BBB CCC … ZZZ
```

So `letter = ALPHABET[i % 26]`, repeated `floor(i / 26) + 1` times.

`ED`, `A`, `Z` → `EDA … EDZ` (26). `ED`, `A`, `CC` → 29 items, ending `EDAA`,
`EDBB`, `EDCC`.

**Rejected:** spreadsheet style (`AA, AB, AC…`). It counts higher, but `AB`/`AC`/`AD`
are exactly what gets misread on a 1-inch label across a shop. `AA` and `BB` cannot
be confused at arm's length. If a run ever needs more than 52, the prefix should
change — the letters should not get denser.

`AB` as an input is therefore **invalid** and must error clearly:
`"AB isn't a valid endpoint — letters repeat: A, B … Z, AA, BB."`

### I and O are not skipped

Some shops drop `I` and `O` because they read as `1` and `0` on a printed label. We
do not. Travis's stickers line up against cut lists and drawings that use a plain
alphabet; silently skipping two letters would put every label after `H` out of step
with its source. Plain `A`–`Z`.

## PDF rendering

### Stickers — extend `buildStickerPdf`, don't fork it

`js/sticker-pdf.js` already takes a text lookup plus quantities:

```js
buildStickerPdf(items, stickerTexts, fontBytes)   // items: [[id, qty], …]
```

It does not care where the text came from, so a queued batch maps directly:
`stickerTexts = { 0:'ED1', 1:'ED2', … }`, `items = [[0,1],[1,1], …]`.

Two module constants must become parameters:

| Constant | Today | Why it must move |
|---|---|---|
| `LABEL_W` / `LABEL_H` | `3*72 × 1*72`, hardcoded | 4x6 needs `4*72 × 6*72` |
| `START_SIZE` | `22` | Sized for long hardware descriptions; `ED1` on a 1-inch label wants far larger, and `fitLines` only shrinks from the start size, never grows |

New signature, with an options argument:

```js
buildStickerPdf(items, stickerTexts, fontBytes, opts = {})
// opts.width, opts.height, opts.startSize, opts.title
```

`fitLines` reads `START_SIZE` from module scope today, so it gains a `startSize`
parameter as well (defaulting to 22) — otherwise the option has nothing to reach.

`opts.title` is written into the PDF's Title metadata (`doc.setTitle`). See *PDF
title encodes the size* below for why this matters.

Start sizes for queued batches — `fitLines` only ever shrinks from these, so they are
ceilings, not fixed sizes. Short text like `ED1` lands at the ceiling; a long typed
line shrinks to fit as it does today:

| Batch size | `startSize` |
|---|---|
| `3x1` | `60` |
| `4x6` | `140` |

These apply only to queued batches. The VanLab hardware-sticker flow passes no
options and keeps `22`.

**Defaults must reproduce today's output byte-for-byte** — `3×1` at `startSize 22`.
The existing VanLab hardware-sticker flow calls it with no options and must be
unaffected. This is testable and is the guard on the change (see Testing).

### Documents — no new storage service

Uploaded files go to Drive through the **existing Apps Script endpoint**
(`js/endpoint.js` → `apps-script/logging-endpoint.gs`), which already archives files
to Drive and already returns PDFs as base64 (`archiveSheet`, `getPackingPdf`).

**No Firebase Storage.** No new service, no new bill, no new rules surface.

Two new endpoint actions:

- `uploadDoc` — `{ fileName, mimeType, base64, idToken }` → `{ url, fileId }`
- `getDoc` — `{ fileId, idToken }` → `{ base64 }`

Collin's **Print** button calls `getDoc`, builds a blob URL, and opens it. It does
**not** open a Drive link directly — that would depend on Collin's own Drive
permissions and drop him into Drive's viewer. The Apps Script runs as Travis, so the
file comes back regardless of what Collin can see in Drive. This mirrors the proven
`getPackingPdf` path exactly.

**Upload cap: 10 MB.** Base64 inflates by ~33% and it rides a `text/plain` POST body
through Apps Script. Reject larger files client-side with a plain message rather than
letting the POST fail opaquely.

**Timeout.** `Endpoint.post` aborts every call at 20 seconds. A 10 MB file is ~13 MB
of base64 each way, which will not make it over shop wifi in 20 seconds. `post`
gains an optional per-call timeout; `uploadDoc` and `getDoc` pass **120 seconds**.
Every existing call keeps 20.

**Drive folder.** A new `DOCS_FOLDER_ID` constant in the Apps Script, alongside
`ARCHIVE_FOLDER_ID` and `PACKING_FOLDER_ID`. Travis creates the folder and pastes
the ID into the live script.

### PDF title encodes the size

Every generated PDF carries its batch in the PDF's **Title metadata**:

```
ED1-ED45 · 3x1 · 45 stickers
```

This is a deliberate safety feature, not cosmetics. See Wrong-printer risk.

**Why the title and not a filename:** the app opens PDFs with `window.open` on a
blob URL (`app.js`, the existing sticker flow). A blob tab has no filename — the tab
shows a random UUID. Chrome's PDF viewer *does* show the document's Title metadata
in the tab and in the print dialog header, so that is the string that must carry
the size. The VanLab hardware-sticker flow passes no title and is unchanged.

Uploaded documents keep whatever title they already have; their row and button
say `Letter`, and the letter printer is the only plausible destination anyway.

## Wrong-printer risk

**A web page cannot choose a printer.** Chrome defaults to whichever printer was used
last. The shop has three: `STICKERS 1x3` (thermal), a 4x6 thermal, and the regular
sheet printer.

Chrome's print preview catches the obvious mismatches on its own — a 3x1 label sent
to the letter printer previews as one enormous blown-up `ED1`; a letter sheet sent to
the 3x1 thermal previews as a cramped strip. Nobody prints through those.

**The preview does not catch 3x1 vs 4x6.** Both are thermal, both small, and a 3x1
PDF sent to the 4x6 printer under Chrome's default *fit to page* previews as a
plausible-looking label and comes out wrong on the roll. That is the failure this
design has to mitigate, and it can only be mitigated with information, not control.

The size is therefore stated in **three** places before anything prints:

1. The row's size column.
2. The button text — `Print 45 stickers → STICKERS 1x3`.
3. The **PDF title metadata**, which Chrome shows in the browser tab *and* at the
   top of the print dialog — on screen at the exact moment the printer is chosen.

**Rejected: a local print helper** that watches the queue and prints silently to a
named printer. It is the version that actually feels like magic, and it is the right
answer *if* wrong-printer mistakes turn out to be real. It is rejected now because it
requires a program running on the shop PC at all times — which drags along the
always-on shop machine decision Travis deliberately parked — and because it fails
*silently* on reboot: stickers stop appearing and nobody knows why. A human reading a
screen is worse in theory and more reliable in practice.

**Revisit trigger:** if Collin sends a batch to the wrong printer more than about
twice, build the helper.

## Data

One new Firestore collection, `printQueue`, following the shape of `sheetNotes` and
`projectNotes` in `js/storage.js`.

> **Note:** this collection was called `stickerBatches` earlier in the brainstorm,
> before the feature widened past stickers. `printQueue` is the name.

```
printQueue/{id}
  kind:       'stickers' | 'document'
  lines:      ['ED1', 'ED2', …]     // kind: 'stickers'
  fileId:     '<drive id>'          // kind: 'document'
  fileName:   'cut-list.pdf'        // kind: 'document'
  size:       '3x1' | '4x6' | 'letter'
  jobName:    'Order 1206' | null
  createdBy:  'travis@…'
  createdAt:  <ms>
  printedAt:  <ms> | null
```

Follows two existing conventions in `storage.js` that exist for real reasons:

- **Realtime listener with client-side sort**, never a Firestore `orderBy` query —
  an `orderBy` silently drops documents missing the sort field (the bug that cost
  the sheets collection real data on 2026-07-17).
- **In-memory cache for synchronous reads**, so the UI never blocks on network.

### Lifecycle

Decided: **printed items leave the list but stay in the collection** (Travis,
2026-09-10 — option A).

`Printed` sets `printedAt`. The list filters to `printedAt == null`. The document is
never deleted, which buys two things for free:

- **Reprints.** A sticker gets peeled crooked; Collin reprints that exact batch from
  history instead of Travis rebuilding it.
- **Travis can see from anywhere whether it actually got printed**, without calling
  the shop.

History is reachable from a *Printed* toggle inside the panel. Rows there keep their
Print button and nothing else.

**Rejected:** deleting on print (loses reprints, makes Travis the janitor for a list
he isn't standing in front of); greying out in place (turns into a screen of clutter
nobody feels responsible for clearing).

### Firestore rules — a manual step, console-only

**`printQueue` writes will fail until an allow rule is added by hand in the
Firebase console.** Rules on this project are per-collection and are not deployed
from this repo. Unlike the app's other writers, Send does not swallow the failure —
the builder shows `Couldn't send — Missing or insufficient permissions` and nothing
is queued. An already-open tab's listener dies on the first permission error and
does not re-subscribe, so reload open tabs after adding the rule.

This must be done *before* testing the feature, or an afternoon disappears debugging
something that was never broken. Travis does this; it is not a code change.

The rule copies the block used by `customers`, `projectCustomer` and
`sheetAnnotations`: an **email allowlist of Travis and Collin**, not `auth != null`.
That is the convention the 2026-08-20 rules incident settled on, and it is stricter
than the five older collections still at `allow read, write: if true`. The vault
note's "any ruleset must cover all 8 collections" list becomes **9**.

## Security

- The new `uploadDoc` / `getDoc` actions **take `idToken`** and verify it, following
  the newer endpoint pattern (`lookupOrder`, `getPackingPdf`) — **not** the older
  unguarded pattern (`archiveSheet`, `appendRows`). Without this, "send Collin a
  document" means anyone holding the endpoint URL and token can write arbitrary
  files into Travis's Drive.
- The pre-existing unguarded `archiveSheet` / `appendRows` actions are a **separate
  known open item** tracked in the vault's CNC Job Tracker note. This work does not
  fix them and must not make them worse.
- `printQueue` rules use the Travis + Collin email allowlist (see *Firestore rules*
  above). Either of them may mark an item printed — that is the intent, not a gap.

## Error handling

Consistent with the app's existing approach: surface the real reason, don't map it to
custom copy.

| Case | Behaviour |
|---|---|
| Empty text box on send | Inline message, no write |
| Invalid range (`ED`, `1`, `Z`) | Inline message naming the bad input |
| Reversed range (`ED`, `45`, `1`) | Inline message; nothing generated |
| Invalid alpha endpoint (`AB`) | Inline message explaining the doubling rule |
| Upload over 10 MB | Rejected client-side before the POST |
| Endpoint down on upload | Existing `endpointError` path; batch is not queued |
| Endpoint down on Collin's Print | Row stays in the list, message says retry |

A failed send must never leave a half-written row in the list.

## Testing

`npm test` (`node --test`) — the sequence generator is pure and gets real coverage:

- numeric ranges, including `start == end` and a 1→45 run
- alpha `A`–`Z` (26 items)
- alpha crossing into doubling: `A`–`CC` ends `AA, BB, CC`
- `I` and `O` are present, not skipped
- `AB` as an endpoint throws
- mixed modes (`1`–`Z`) throw
- reversed ranges (`45`–`1`) throw

**The guard on `sticker-pdf.js`** is structural, not byte-for-byte. pdf-lib stamps
the creation and modification time into every save, so two renders of identical
input never match byte-for-byte, and there is no "pre-change code" on disk at test
time. Instead:

- `fitLines('HI', …)` with no start size still returns 22 (the existing test).
- `fitLines('ED1', …, 60)` returns 60; a long line at 60 shrinks below 60.
- `buildStickerPdf` with no options produces pages whose `/MediaBox` is
  `[0 0 216 72]`; with `{ width: 288, height: 432 }` it is `[0 0 288 432]`.
- With `{ title: 'X' }` the PDF contains a `/Title` entry (pdf-lib writes it as UTF-16BE hex, `<FEFF0058>`); with no options it has none.

`doc.save({ useObjectStreams: false })` keeps the output introspectable, which is
what makes the `/MediaBox` and `/Title` checks possible.

Manual verification (cannot be automated — real printers):

- a 3x1 batch on `STICKERS 1x3` at 100% scale
- a 4x6 batch on the 4x6 thermal
- an uploaded PDF on the sheet printer
- the badge count updating on a second device while a batch is sent

**Testing safety:** `js/firebase-config.js` points at the live production database
real operators use. Test against a copy with a `projectId` starting with `PASTE`, per
the app's CLAUDE.md.

## Phases

1. **Queue + sticker batches.** Panel, list, builder, range filler, `3x1`/`4x6`,
   Print/Printed, history. Untagged only. This alone delivers `ED1`–`ED45`.
2. **Job tagging.** Tag on send, job name on the row, badge on the project card that
   opens the panel filtered to that job.
3. **Documents.** File picker, `uploadDoc`/`getDoc` endpoint actions, letter rows.
   **Two manual steps, both Travis's:** create the Drive folder and paste its ID
   into the live script, then publish a new Apps Script deployment version
   (Deploy → Manage deployments → pencil → New version). The repo copy of the
   script has `PASTE_` placeholders and an empty `ALLOWED_UIDS`; the live one has
   the real values. **Merge the two new functions into the live script — never
   paste the repo file over it**, or the UID allowlist is gone.

## Out of scope

- Editing a sent batch — delete and resend.
- Partial print counts, per-sticker checkboxes.
- The local print helper (see Wrong-printer risk for the revisit trigger).
- Typing text to render a letter document. Likely a real want once documents exist,
  but uploading covers it for now — anything can be printed to PDF.
- Role gating.
- Skipping `I`/`O`; zero-padded numbers.
- Any change to the existing VanLab Printing panel's behaviour.

## Review notes (2026-09-10, against the code)

Corrections folded into the sections above, kept here so the reasoning survives:

1. **Filename → PDF title.** Blob-URL tabs show a UUID, not a filename. The size
   lives in the PDF Title metadata instead.
2. **Byte-identical test → structural test.** pdf-lib timestamps every save.
3. **Endpoint timeout.** The fixed 20 s abort would kill 13 MB uploads; `post`
   gets a per-call override.
4. **Range cap of 500.** No upper bound meant a typo could freeze the tab.
5. **Rules = email allowlist**, matching the post-incident convention, not any
   signed-in user.
6. **Phase 3 needs an Apps Script redeploy** and must not overwrite the live
   script's `ALLOWED_UIDS`.
7. **Collin**, not Colin — matches the operator list and the vault.

## Phase 3 amendment (2026-09-11) — documents

Approved by Travis 2026-09-11 after Phase 1 went live. Phase 3 is built **before**
Phase 2 (job tagging); nothing in this amendment depends on tagging. Where this section
disagrees with the Phase 3 text above, this section wins.

### What changed from the original Phase 3

| Original | Now | Why |
|---|---|---|
| Documents are always `Letter` | `4x6` or `letter` (plus `3x1`, added 2026-09-24), **auto-detected** from the PDF's first page; a picker appears only when the page is none of them | Travis's main case is 4x6 shipping labels emailed to him, printed on the crate printer |
| PDF or image | **PDF only** | Decided; labels arrive as PDFs |
| Travis creates a Drive folder and pastes its ID into the live script | The script **creates the folder itself** on first upload and remembers it | Removes a manual step nobody benefits from |
| Filename appears in the tab | The fetched PDF is **re-titled client-side** (`cut-list.pdf · 4x6 · 8 pages`) before it opens | Same wrong-printer guard as stickers; blob tabs have no filename |

Multi-page PDFs are allowed and the page count is shown; a batch of labels in one file is
one queue item.

### Dropping a file (Travis's side)

- The **+ Send a document** disclosure holds a dashed drop zone: *Drop a PDF here, or
  browse*. Browse is a hidden `<input type="file" accept="application/pdf">`. Dropping a
  file **anywhere on the To Print panel** also stages it and opens the disclosure — the
  disclosure is normally collapsed and the drop should still land.
- One file at a time. A second drop replaces the staged one.
- Refused before anything uploads, with a plain message: not a PDF (checked by the
  `%PDF-` header, not the extension); over **10 MB**; a PDF that pdf-lib cannot open
  (encrypted or corrupt).
- Staging reads the file in the browser with the pdf-lib already on the page:
  `pages = doc.getPageCount()`, first page `{ width, height }` in points. Size rule, either
  orientation, ±3 pt tolerance:

  | first page | size |
  |---|---|
  | 216 × 72 (3 in × 1 in) | `3x1` (added 2026-09-24: pre-built sticker PDFs) |
  | 288 × 432 (4 in × 6 in) | `4x6` |
  | 612 × 792 (Letter) | `letter` |
  | anything else | picker shown: `3x1 sticker` · `4x6 thermal` · `Letter`; Send disabled until chosen |

- The staged line reads `cut-list.pdf · 8 pages · 4x6` with **Send to print list** and a
  small clear (×). Nothing is written or uploaded until Send.

This lives in a new pure module `js/doc-info.js`:

```js
DocInfo.sizeFor(width, height)          // → '3x1' | '4x6' | 'letter' | null
DocInfo.inspectPdf(bytes)               // → Promise<{ pages, width, height }> (throws if pdf-lib can't open it)
DocInfo.isPdf(bytes)                    // → header check
DocInfo.title(fileName, size, pages)    // → 'cut-list.pdf · 4x6 · 8 pages' (pluralised)
```

Testable under `node --test` the way `sticker-pdf` is: build a PDF with pdf-lib in the
test, inspect it, assert.

### Send

1. Button disabled, status `Uploading cut-list.pdf…`.
2. `Endpoint.uploadDoc(fileName, base64, idToken)` → `{ fileId }`. Base64 via
   `FileReader.readAsDataURL`, header stripped.
3. `Storage.addPrintItem({ kind:'document', fileId, fileName, pages, size, lines: [] })`.
4. Clear the staged file, collapse the disclosure, status `cut-list.pdf sent to the print
   list.`, re-render.

If step 2 fails: nothing is queued, `Couldn't send — <message>` inline. If step 3 fails after
step 2 succeeded: same message; the uploaded file stays in the Drive folder unused. That
orphan is accepted — it costs nothing and Travis just sends again.

`Endpoint.post` gains an options argument `{ timeoutMs }`. `uploadDoc` and `getDoc` pass
**120 000**; every existing call keeps the 20 s default (`post`'s signature change must not
touch any existing caller's behaviour).

### Data

The `printQueue` document for `kind: 'document'`:

```
kind:      'document'
fileId:    '<drive id>'
fileName:  'cut-list.pdf'
pages:     8
size:      '3x1' | '4x6' | 'letter'
lines:     []                 // Storage already normalises a missing lines to []
jobName / createdBy / createdAt / printedAt as for stickers
```

### Collin's side

- Row: what = `fileName`; count = `8 pages` / `1 page`; size; who / when — same columns
  as stickers.
- Button: `Print 8 pages → CRATE LABEL 4x6` for `4x6`, `Print 8 pages → letter printer`
  for `letter`, `Print 12 pages → STICKERS 1x3` for `3x1`. Hint line under it stays `100% scale · margins none`.
- Print: `Endpoint.getDoc(fileId, idToken)` → base64 → bytes → pdf-lib `load` →
  `setTitle(DocInfo.title(…))` → `save({ useObjectStreams: false })` → blob → `window.open`.
  If pdf-lib cannot re-open the fetched bytes, open them untitled rather than fail — the
  guard is best-effort on the way out, the file must still print.
- Printed: unchanged.

`PQ_SIZES` gains `letter: { printer: 'letter printer' }` with no page geometry — documents
are never rendered by `buildStickerPdf`.

### Apps Script — two new actions

Both follow `getPackingPdf`: verify the Firebase ID token (and `ALLOWED_UIDS`) **before**
touching Drive. Both are added to the `doPost` dispatch. `TOKEN` is still checked first as
for every action.

**`uploadDoc`** `{ fileName, base64, idToken }` → `{ ok, fileId }`

- Reject: missing `fileName` or `base64`; decoded bytes not starting `%PDF-`; base64
  longer than 14 000 000 characters (≈10 MB decoded — the client cap, enforced again
  server-side).
- Folder: `printQueueFolder()` reads script property `PRINT_QUEUE_FOLDER_ID`; if unset,
  creates a folder named **`CNC Print Queue`** in the root of the executing account's My
  Drive, stores its id in the property, returns it. Wrapped in the same `LockService`
  pattern `archiveSheet` uses so two first-uploads can't create two folders.
- `folder.createFile(Utilities.newBlob(bytes, 'application/pdf', fileName))`. Duplicate
  names are allowed (Drive permits them); the queue stores the id, not the name.

**`getDoc`** `{ fileId, idToken }` → `{ ok, pdfBase64 }`

- Reject missing `fileId`.
- `DriveApp.getFileById(fileId)`; walk `file.getParents()` and require one of them to be the
  print-queue folder, else `{ ok:false, error:'not a print-queue file' }`. This is the
  scope guard: the endpoint runs as Travis, so without it any allowlisted user could fetch
  any file id in his Drive.
- Return `Utilities.base64Encode(file.getBlob().getBytes())`.

Repo copy `apps-script/logging-endpoint.gs` gets both functions and the dispatch lines.
**Deploying is manual and Travis's:** open the live script, paste the two functions and
the two dispatch lines in (do **not** replace the file — the live copy holds the real
`TOKEN`, folder ids, `FIREBASE_API_KEY` and `ALLOWED_UIDS`), then Deploy → Manage
deployments → pencil → New version. The endpoint URL does not change on a new version.
No folder to create, no id to paste.

### Error handling additions

| Case | Behaviour |
|---|---|
| Dropped file is not a PDF | Inline: `That isn't a PDF.` Nothing staged |
| Over 10 MB | Inline: `cut-list.pdf is 14.2 MB — the limit is 10 MB.` Nothing staged |
| pdf-lib can't open it | Inline: `Couldn't read cut-list.pdf — is it encrypted?` Nothing staged |
| Odd page size | Picker shown; Send disabled until a size is chosen |
| Upload fails / times out | `Couldn't send — <message>`; nothing queued |
| Queue write fails after upload | `Couldn't send — <message>`; file orphaned in Drive, accepted |
| getDoc fails on Print | Row stays; status `Couldn't fetch cut-list.pdf — <message>. Try again.` |
| Live script not yet redeployed | Endpoint answers `unknown action`; surfaced verbatim — that is the cue to redeploy |

### Testing

- `test/doc-info.test.mjs`: `sizeFor` for both orientations, tolerance edges, null for
  A4/others; `inspectPdf` on a 3-page 4x6 PDF built in the test; `isPdf`; `title` plural.
- `test/endpoint-doc.test.mjs`: `uploadDoc`/`getDoc` post the right action + `idToken`
  and honour `timeoutMs` — mirror `test/endpoint-packing.test.mjs`.
- `test/logging-endpoint.test.mjs` extension (the `.gs` is already loaded in a vm with
  fakes): `uploadDoc` rejects non-PDF and oversize; creates the folder once and reuses the
  stored id; `getDoc` refuses a file outside the folder; both reject a bad token before
  Drive is touched.
- Browser: Playwright in PASTE mode with the endpoint stubbed (`Endpoint.enabled()` is
  false when the URL is `PASTE…`, so stub `Endpoint.uploadDoc`/`getDoc` on the page) —
  drop a generated 4x6 PDF, see the staged line, Send, row, Print title.
- Real: one emailed 4x6 label through the whole path on the crate printer, after the
  script redeploy.

### Out of scope (still)

Images; editing a queued document; per-page printing; typing text to make a letter
document; any change to the existing `archiveSheet` / `appendRows` guard status.

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
