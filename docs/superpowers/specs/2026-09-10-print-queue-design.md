# Print Queue — Design

**Status:** designed 2026-09-10, not implemented
**Brainstormed with:** Travis
**Depends on:** `js/sticker-pdf.js`, `js/endpoint.js`, `js/storage.js`, `js/auth.js`

## Goal

Give Travis a way to put work in front of Colin (who runs the shop floor) without
phoning him: a shared list inside the CNC Job Tracker that says *here is what needs
printing*. Two kinds of item go in it — batches of stickers generated from text, and
documents Travis uploads for the regular printer.

Colin opens it and sees only the list. The tools that built the list stay folded away.

This is a **print queue**, not a sticker queue. Stickers are one item type. The
header button reads **To Print**, because that is what it means to the person who
opens it most.

## Why this isn't the existing VanLab Printing panel

The header already has a **VanLab Stickers** button opening a hidden panel with
*Print Hardware Stickers*, *Print Packing List*, *Print Crate Label*. Those print
from a **fixed map**: a van number goes in, a predetermined sticker list comes out
(`STICKER_MAP`, `js/sticker-map.generated.js`).

Nothing today lets Travis author an **arbitrary** batch — `ED1`–`ED45` — and leave it
waiting for Colin. That is the gap this fills. The VanLab panel stays exactly as it
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

The builder is a collapsed disclosure. Colin *can* open it; he has no reason to.
The app does have per-user identity available (`firebase.auth().currentUser`,
`js/auth.js`) if this ever needs to become real gating — but it does not today, and
we are not building the plumbing for a restriction nobody asked for.

**Consequence to accept knowingly:** a stray click can open the builder on the shop
computer. Nothing in the builder destroys queued work — it only creates — so the
blast radius is a confused operator, not lost data. Revisit only if that happens.

### Draft vs sent

A batch does not exist for Colin until Travis presses **Send to print list**. The
builder holds unsent work in local component state only — nothing is written to
Firestore until send.

Without this, Colin watches `ED1`…`ED45` appear one row at a time while Travis is
still typing.

## UI: the list (Colin's view)

One row per queued item, newest last. Each row shows:

| Field | Example |
|---|---|
| What it is | `ED1 – ED45` (first–last for a generated range; the filename for a document) |
| Count | `45 stickers` / `1 sheet` |
| Size | `3x1` · `4x6` · `Letter` |
| Job tag | `Order 1206` — omitted when untagged |
| Who / when | `Travis · today 9:14 AM` |

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
// opts.width, opts.height, opts.startSize
```

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

Colin's **Print** button calls `getDoc`, builds a blob URL, and opens it. It does
**not** open a Drive link directly — that would depend on Colin's own Drive
permissions and drop him into Drive's viewer. The Apps Script runs as Travis, so the
file comes back regardless of what Colin can see in Drive. This mirrors the proven
`getPackingPdf` path exactly.

**Upload cap: 10 MB.** Base64 inflates by ~33% and it rides a `text/plain` POST body
through Apps Script. Reject larger files client-side with a plain message rather than
letting the POST fail opaquely.

### Filename encodes the size

Every generated PDF is named for its batch:

```
ED1-ED45__3x1__45-stickers.pdf
```

This is a deliberate safety feature, not cosmetics. See Wrong-printer risk.

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
3. The **PDF filename**, which appears in the browser tab *and* at the top of
   Chrome's print dialog — on screen at the exact moment the printer is chosen.

**Rejected: a local print helper** that watches the queue and prints silently to a
named printer. It is the version that actually feels like magic, and it is the right
answer *if* wrong-printer mistakes turn out to be real. It is rejected now because it
requires a program running on the shop PC at all times — which drags along the
always-on shop machine decision Travis deliberately parked — and because it fails
*silently* on reboot: stickers stop appearing and nobody knows why. A human reading a
screen is worse in theory and more reliable in practice.

**Revisit trigger:** if Colin sends a batch to the wrong printer more than about
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

- **Reprints.** A sticker gets peeled crooked; Colin reprints that exact batch from
  history instead of Travis rebuilding it.
- **Travis can see from anywhere whether it actually got printed**, without calling
  the shop.

History is reachable from a *Printed* toggle inside the panel. Rows there keep their
Print button and nothing else.

**Rejected:** deleting on print (loses reprints, makes Travis the janitor for a list
he isn't standing in front of); greying out in place (turns into a screen of clutter
nobody feels responsible for clearing).

### Firestore rules — a manual step, console-only

**`printQueue` writes will silently no-op until an allow rule is added by hand in the
Firebase console.** Rules on this project are per-collection and are not deployed
from this repo. There is no error surfaced — the sticker simply never appears.

This must be done *before* testing the feature, or an afternoon disappears debugging
something that was never broken. Travis does this; it is not a code change.

## Security

- The new `uploadDoc` / `getDoc` actions **take `idToken`** and verify it, following
  the newer endpoint pattern (`lookupOrder`, `getPackingPdf`) — **not** the older
  unguarded pattern (`archiveSheet`, `appendRows`). Without this, "send Colin a
  document" means anyone holding the endpoint URL and token can write arbitrary
  files into Travis's Drive.
- The pre-existing unguarded `archiveSheet` / `appendRows` actions are a **separate
  known open item** tracked in the vault's CNC Job Tracker note. This work does not
  fix them and must not make them worse.
- `printQueue` rules should require an authenticated user for read and write. Any
  signed-in operator may mark an item printed — that is the intent, not a gap.

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
| Endpoint down on Colin's Print | Row stays in the list, message says retry |

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

**The byte-identical guard on `sticker-pdf.js`:** render a known hardware-sticker
batch with the pre-change code and with the post-change code called without options,
and assert the bytes match. If the existing VanLab flow changes at all, the
refactor broke something. `doc.save({ useObjectStreams: false })` keeps the output
introspectable, which is what makes this test possible.

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

## Out of scope

- Editing a sent batch — delete and resend.
- Partial print counts, per-sticker checkboxes.
- The local print helper (see Wrong-printer risk for the revisit trigger).
- Typing text to render a letter document. Likely a real want once documents exist,
  but uploading covers it for now — anything can be printed to PDF.
- Role gating.
- Skipping `I`/`O`; zero-padded numbers.
- Any change to the existing VanLab Printing panel's behaviour.
