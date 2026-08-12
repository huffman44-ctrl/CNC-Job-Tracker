# VanLab Printing in the CNC Job Tracker — Design

**Date:** 2026-08-11
**Status:** Approved direction, spec pending Travis's review
**Phase 2 revision (2026-08-12, approved):** packing templates are served from Google Drive via the existing bridge (not Firebase Storage — avoids the Blaze billing requirement); packing lists print at the shop floor; SUV variant detection uses the assembly field only (no notes fallback — the picker covers the gap).
**Phase 3 design (2026-08-12, approved):** crate label is purely client-side — no Apps Script or Firestore changes. QR code kept but its Status line dropped (status isn't in the lookup response and was only a print-time snapshot). Per-job persisted fields (deferred through Phases 1–2) are **dropped**, not implemented. Details in the "Crate label (4×6)" section.
**Replaces:** the three local Python tools' *operation* (hardware_sticker_printer.py, packing_list_printer.py, label_generator.py in `Shop Management for VanLab/CNC-Kit-Management`) — the Python tools stay untouched until the web version reaches parity.

## Goal

Shop-floor staff (Collin) print a VanLab order's full paper package — hardware-bag stickers, 4×6 crate label, packing list — straight from the CNC Job Tracker, without Travis, a terminal, or a spreadsheet download. The small QR crate ID sticker is retired (Travis, 8/11): the 4×6 crate label replaced it.

Success looks like: Collin opens the VanLab job he's already tracking, punches in the order number, and prints three documents to three named network printers. Wrong data is impossible to print silently — every failure mode says so on screen.

## Architecture

```
Tracker (browser, GitHub Pages — PUBLIC repo)
  │  order number + Firebase ID token
  ▼
Apps Script bridge (existing logging-endpoint.gs, new "lookupOrder" action)
  │  verifies ID token, reads live VanLab Order Log sheet
  ▼
{ orderNum, customer, vanRaw, vanKey, assembly }
  │
  ├─ vanKey → sticker list  (generated JSON, committed to repo)
  ├─ vanKey → packing PDF   (Drive folder via bridge "getPackingPdf", sign-in verified)
  └─ order fields → 4×6 crate label
  ▼
pdf-lib in the browser renders/stamps three PDFs → browser print dialog
→ named network printers ("STICKERS 1x3", "CRATE LABEL 4x6", "OFFICE")
```

### UI: print panel on a job

A "VanLab Printing" panel inside a job's project view. Flow:

1. **Order number is auto-detected from the job's sheet filenames** — VanLab sheet files carry it, e.g. `260611_ford_e350_swb_Pass_3806_order1199_Summary_Sheet 5.html` and `260520_..._Order_1195_Summary_Sheet 9.html`. Extraction matches `order`/`Order` + optional `_`/`#` + digits (`/order[\s_#]*(\d+)/i`), anchored on the word "order" so date prefixes (`260611`) and other numbers (`3806`) can't be mistaken for it. If the job's sheets disagree with each other about the order number, the panel flags the conflict instead of silently picking one. An editable manual field remains as the escape hatch for filenames without the pattern.
2. Lookup runs automatically once an order number is detected → the panel shows what came back (order #, customer, van, assembly) so Collin confirms it's the right order *before* printing. His normal path is: open job, glance, print ×3 — no typing.
3. Three buttons: **Hardware Stickers**, **Crate Label**, **Packing List**. Each generates its PDF client-side and opens it for printing. The print dialog's printer choice is manual by design (browsers can't auto-route); printer names make it foolproof.

Fallback: if lookup fails (order not in log, bridge down), a manual van-type picker appears as the escape hatch — stickers and packing list can print from van type alone; the crate label needs the order fields, so without a lookup it falls back to manual entry of customer/assembly.

### Order lookup (the new bridge action)

Extend `apps-script/logging-endpoint.gs` with `action: 'lookupOrder'`:

- Reads the live VanLab Order Log Google Sheet (same columns the Python `order_data.py` reads: order #, customer, van, assembly — sheet "Order Log", header row 4). Van key parsing mirrors `parse_van_key` (leading digits, or `SUV01`).
- Returns **only** `{ orderNum, customer, vanRaw, vanKey, assembly }` for **one order number per call**. No bulk/dump action exists.
- **Auth (mandatory):** the repo is public, so `ENDPOINT_CONFIG.token` is world-readable and is explicitly junk-filtering, not auth. `lookupOrder` therefore additionally requires the caller's **Firebase Auth ID token**, which the Apps Script verifies server-side via Google's Identity Toolkit `accounts:lookup` endpoint (the Firebase web API key it needs is already public in firebase-config.js; validity of the ID token is what's being proven). Invalid/missing ID token → `{ok:false}`, no data. Existing `archive`/`appendRows` actions are unchanged.
- Client side: `Endpoint.lookupOrder(orderNum)` follows the existing `endpoint.js` pattern (text/plain POST, 20s timeout, `endpointError` distinction between "server said no" and "network down").

### Sticker map pipeline (Travis's workflow unchanged)

Travis keeps editing `VanLab Sticker Map.xlsx` in Google Sheets. `import_sticker_map.py` gains a second output: alongside `sticker_map_data.py` it writes `js/sticker-map.generated.js` into this repo (a `.js` global like the existing config files — loads without fetch/CORS concerns) — `STICKERS` (id → label text) and `VAN_STICKERS` (van key → [sticker id, count]). Publishing a map change = re-run importer, commit, push (go-live ritual). Sticker texts are generic hardware phrases — safe in a public repo. The blank-vs-NO STICKER distinction survives: blanks surface as "undecided" warnings in the panel, mirroring the importer's NEEDS ATTENTION report.

### Packing lists

The 22 per-van template PDFs (`VAN_TO_PDF` in packing_map.py; 1.5 MB total, largest 174 KB) live in a **Google Drive folder Travis owns** — *not* the public repo (they're VanLab's proprietary product docs) and *not* Firebase Storage (enabling Storage now requires the billed Blaze plan; the files are far too small to justify it). The bridge gains a `getPackingPdf` action: verifies the caller's Firebase ID token (same helper as `lookupOrder`), accepts one exact filename, serves base64 PDF bytes **only from the designated folder** (folder ID is a live-script constant, `PASTE_*` placeholder in the repo template). No listing/enumeration action. Client resolution: `js/packing-map.js` ports packing_map.py's tables and honesty rules — VAN_TO_PDF, none-needed (van 40), conflicted (van 39 stays blocked until VanLab confirms numbering), SUV variants; header comment marks it as mirroring packing_map.py until the Python tool retires. The browser fetches the template and stamps it with pdf-lib, replicating `stamp.py`'s output (blue band, order | customer | Assembly, options line via a JS port of assembly_levels.py, same undecodable-assembly warning). Statuses mirror the Python tool: matched / none-needed / MISSING / AMBIGUOUS (SUV needs Full/Bed/Kitchen — panel shows a picker; auto-detected from the assembly field only, since the lookup deliberately doesn't return notes) / NOT FOUND. Nothing silently skipped. Template updates: replace the file in Drive — nothing to redeploy.

### Crate label (4×6) — Phase 3 detail (designed 2026-08-12)

Pure client-side port of `label_generator.py`'s `draw_label`. No bridge changes, no new Firestore collections/fields, no console steps — ship is merge + go-live push. Completes the sticker package and retires the Python crate-label ritual for VanLab orders once floor-verified.

- **`js/crate-label-pdf.js`** (module pattern of `sticker-pdf.js`): 288×432 pt page. Top logo band, thin `#F2F2F2` rule, info block of four label/value lines — Kit (van name, 14 pt), Assembly # ("—" when blank, 12 pt), Order #, Date Packed — with the Python tool's greedy word-wrap for long values (e.g. the Sprinter 144" van name), gray divider, centered QR (1.9"), "Scan for full kit details" caption, dark-blue `#1F4E79` footer bar reading `Generated MM/DD/YYYY  |  VanLab`. Colors exact: `#1F4E79`, `#2E75B6`, `#F2F2F2`. Fonts: Helvetica / Helvetica-Bold via pdf-lib **StandardFonts** — no fontkit, no TTF embedding for this document. Date Packed = print date (client clock), matching the Python behavior.
- **QR code:** vendor `qrcode-generator` (MIT, ~10 KB, zero deps) into `js/vendor/`, draw the module matrix directly as black squares with pdf-lib (no PNG encoding — less code, crisp at print resolution). Payload is the Python QR text **minus the `Status:` line**: order, van, assembly (or `N/A`), customer, packed date, same framing lines. Error correction M, matching the Python settings.
- **Logo:** one-time prep step trims the whitespace off `vanlab_logo.png` (same <240 threshold + 6 px pad the Python tool applies at every run) and commits the result as base64 in `js/vanlab-logo.generated.js`; embedded via `embedPng`. Aspect-fit sizing ported as-is (max width W−0.6", max height 0.7"). VanLab's public branding — safe in the public repo, unlike the packing PDFs. If the logo bytes fail to embed, render the Python tool's "LOGO placeholder" box instead of failing the print.
- **Panel wiring:** the Crate Label button activates when a lookup result is present; generates client-side and opens for printing on "CRATE LABEL 4x6". Lookup-failure fallback (as specced): manual van pick plus typed customer + assembly, since the label prints order fields; blank assembly renders "—".
- **Persisted per-job fields: dropped** (decision 2026-08-12). Re-detect-on-open has cost nothing across two live phases; saving state would add Firestore writes plus the console-only rules gotcha for pure convenience.
- **Tests:** wrap behavior on the long van name, exact QR payload string, layout constants and page size, logo-placeholder path when bytes are absent. Standing gates apply: side-by-side parity print vs. a Python-generated label for one real order, floor print on the real D450BT before Phase 3 is done.

### PDF rendering

One library, **pdf-lib**, for all three documents (drawing + stamping + font embedding), vendored into the repo (no CDN — matches the app's self-contained pattern). Layouts are ported from the Python renderers (`sticker_render.py`, `label_generator.py`) using their existing PDFs as the visual reference. Fonts embedded as TTF (OFL-licensed, repo-safe); default is whatever the Python tools print with at build time — the Baloo 2 trial (order 1206) resolves in the Python tool first, and the web port copies the winner. Page sizes are exact: 1"×3" per sticker page, 4"×6" label, letter packing list — sized-to-stock PDFs print correctly at 100% scale on the dedicated printers.

### Data & rules

- New per-job persisted fields (van-type override, resolved order number): **dropped** (Phase 3 decision, 2026-08-12) — the panel re-detects on every open, and a manual van pick lasts one panel session; two live phases showed that's enough. ⚠️ CNC Firestore rules are **per-collection and console-only** — if a new collection is ever introduced, its allow line must be added manually in the console or writes silently no-op. Prefer extending an existing ruled collection.
- No Firebase Storage and no new Firestore collections in Phase 2 — the only console-side deploy steps are pasting the Drive folder ID into the live Apps Script and redeploying it (Manage deployments → pencil → New version, NOT "New deployment").

### Error handling

Every failure mode is a visible message, never a silent skip (the Python tools' honesty carries over): order not found (with "check the Order Log" hint), bridge down vs. rejected (existing endpointError split), van with no sticker mapping, undecided sticker rows, missing packing PDF, ambiguous SUV, template fetch failure. The panel never prints from stale or guessed data without saying so.

## Hardware (Travis's side, not code)

Two 4×6-capable thermal printers (Omezizy D450BT, a Phomemo-family unit) — one permanently loaded with 1"×3" sticker stock, one with 4×6 label stock (roll-swapping eliminated) — USB into the shop-floor PC, plus a regular letter-size printer at the shop floor for packing lists (Travis's decision 8/12: packing lists print at the floor, not the office). Named unmistakably. Any signed-in PC with the printers installed can print. The 1×3 path was floor-proven 8/12 with a test page.

## Security summary

- Order Log sharing stays specific-people-only; 2FA on Google accounts with access (Travis's checklist, independent of build).
- Lookup requires a verified Firebase sign-in; returns 5 fields for one order; no enumeration endpoint.
- No secrets in the public repo (the existing junk-filter token is acknowledged as public; nothing new relies on secrecy of repo contents).
- Packing PDFs behind the sign-in-verified bridge (Drive folder, single-file-by-exact-name, no enumeration), not in the repo.
- Customer PII on printed output: customer name appears on the 4×6 crate label only (as today). No addresses/contacts anywhere.

## Testing

- Unit tests (existing `test/` harness): order-number extraction from real filename shapes (`order1199`, `Order_1195`, no-match, conflicting sheets), van-key parsing, sticker list resolution incl. blank/NO STICKER/undecided, packing status resolution, order-number normalization (`#1204` vs `1204`).
- Bridge: manual test matrix — valid token, missing token, bad order, real order (with a fixture/anonymized row; never commit real customer rows — PII rule).
- Visual parity: side-by-side print of web output vs. Python output for one real van before each phase ships.
- **Phase gate:** each phase is floor-verified on the real printers before the next starts.

## Phases

1. **Hardware stickers** — bridge lookup + auth, sticker map export, 1×3 PDF rendering, print panel v1, real print test on the 1×3 thermal printer. Proves the whole pipeline.
2. **Packing lists** — Drive folder upload, bridge `getPackingPdf` action, packing-map/assembly-levels JS ports, template fetch + stamping, SUV disambiguation picker.
3. **Crate label (4×6)** — port label_generator layout, QR kept (no Status line), logo embedded, retire the Python ritual for VanLab orders. Client-side only — no bridge or console changes. (Detail: "Crate label (4×6)" section above.)

## Out of scope

- Removing the QR crate sticker from the Python tool (separate small cleanup, whenever that tool is next touched).
- Deleting/retiring the Python tools (kept as fallback until floor-confirmed parity).
- Any Order Log *write* capability from the tracker.
- Kanban/Brain OS integration.
