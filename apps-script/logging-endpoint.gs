/**
 * CNC Job Tracker endpoint — paste into script.google.com, fill the three
 * constants, then Deploy > New deployment > Web app:
 *   Execute as: Me   |   Who has access: Anyone
 * Later edits: Deploy > Manage deployments > pencil > Version: New version (a "New deployment" mints a new URL the app does not know).
 * Redeploying creates a fresh URL (rotate if the endpoint is ever abused).
 * Print-queue documents (uploadDoc/getDoc) need no constants — the folder is self-created.
 */
const TOKEN              = 'PASTE_TOKEN';
const ARCHIVE_FOLDER_ID  = 'PASTE_ARCHIVE_FOLDER_ID';
const LOG_SPREADSHEET_ID = 'PASTE_LOG_SPREADSHEET_ID';
const ORDER_LOG_SPREADSHEET_ID = 'PASTE_ORDER_LOG_SPREADSHEET_ID';
const FIREBASE_API_KEY         = 'PASTE_FIREBASE_API_KEY';
const PACKING_FOLDER_ID = 'PASTE_PACKING_FOLDER_ID';
// Optional allowlist: empty = any signed-in user of this Firebase project;
// non-empty = only these uids (paste from Firebase console → Authentication
// → Users) — recommended because Email/Password signup may be open.
const ALLOWED_UIDS = [];
// Owners (Travis, Eva): the only uids whose rows may carry Invoice # / PO # / Billed
// (columns K, L, N). Paste from Firebase console → Authentication → Users. Empty = nobody.
const OWNER_UIDS = [];
const ORDER_LOG_TAB        = 'Order Log';
const ORDER_LOG_HEADER_ROW = 4;   // data starts on sheet row 5

// Rows route to the tab named after each row's Customer, created on first use. Rows with no
// customer land in UNASSIGNED_TAB. Columns are only ever ADDED at the right-hand end: the
// Orville mirror (Orville - Season 4!A:L) and this script both address columns by position.
const LOG_HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer',
  'Invoice #', 'PO #', 'Sheet Key', 'Billed'];
// 0-based column positions in a LOG_HEADER-wide row.
const COL = { sheet: 0, job: 1, totalTime: 2, toolpathCount: 3, hasVbit: 4, completedTime: 5, operator: 6,
  notes: 7, archiveLink: 8, customer: 9, invoice: 10, po: 11, key: 12, billed: 13 };
const UNASSIGNED_TAB = 'Unassigned';

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: 'invalid JSON' });
  }
  if (TOKEN.startsWith('PASTE')) {
    return jsonOut({ ok: false, error: 'endpoint not configured: TOKEN is still a placeholder' });
  }
  if (!body || body.token !== TOKEN) {
    return jsonOut({ ok: false, error: 'bad token' });
  }
  try {
    if (body.action === 'archive')     return jsonOut(archiveSheet(body));
    if (body.action === 'appendRows')  return jsonOut(appendRowsLocked(body));
    if (body.action === 'upsertRows')  return jsonOut(upsertRowsLocked(body));
    if (body.action === 'lookupOrder') return jsonOut(lookupOrder(body));
    if (body.action === 'getPackingPdf') return jsonOut(getPackingPdf(body));
    if (body.action === 'uploadDoc')   return jsonOut(uploadDoc(body));
    if (body.action === 'getDoc')      return jsonOut(getDoc(body));
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function archiveSheet(body) {
  if (!body.fileName || !body.html) {
    return { ok: false, error: 'missing fileName or html' };
  }
  const root    = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  const jobName = String(body.jobName || '').trim() || 'Unknown Job';
  // Lock only the find-or-create-folder step — the only part that races when
  // multiple sheets from the same job upload in parallel. The file write
  // itself (the slow part) runs unlocked so a big batch upload doesn't queue
  // every sheet behind one global lock and blow the client's 20s timeout.
  const lock = LockService.getScriptLock();
  let jobFolder;
  try {
    lock.waitLock(30000);
    const folders = root.getFoldersByName(jobName);
    jobFolder = folders.hasNext() ? folders.next() : root.createFolder(jobName);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  // Overwrite in place so the Drive file ID (and any links already exported
  // into old log rows) survives a re-upload of the same sheet.
  const existing = jobFolder.getFilesByName(body.fileName);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
    file.setContent(body.html);
  } else {
    file = jobFolder.createFile(body.fileName, body.html, 'text/html');
  }
  // Direct-download link, not file.getUrl() — Drive's preview page shows HTML
  // files as source code rather than rendering them, so a "view" link can't
  // open them as a page. This link downloads the file instead; opening the
  // download does render correctly (the sheets are self-contained HTML).
  return { ok: true, url: 'https://drive.google.com/uc?export=download&id=' + file.getId() };
}

function appendRowsLocked(body) {
  // Full-duration lock here, unlike archiveSheet — concurrent exports must
  // not race on the same getLastRow()/setValues() range.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    return appendRows(body);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function appendRows(body) {
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'no rows' };
  }
  if (!rows.every(function (r) { return Array.isArray(r) && (r.length === 9 || r.length === 10); })) {
    return { ok: false, error: 'rows must be 9 or 10 columns' };
  }
  // Pad legacy 9-column rows (pre-Customer clients) to 10 so every group is
  // rectangular for setValues; the Customer cell just stays blank.
  const padded = rows.map(function (r) { return r.length === 9 ? r.concat(['']) : r; });
  const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  const groups = groupRowsByCustomer(padded);
  let appended = 0;
  // Real exports carry one customer per batch (one group); multi-group writes are not atomic on failure.
  Object.keys(groups).forEach(function (customer) {
    const sheet = findOrCreateCustomerTab(ss, customer);
    const values = groups[customer].map(function (r) { return r.map(String); });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
    appended += values.length;
  });
  return { ok: true, appended: appended };
}

function groupRowsByCustomer(rows) {
  const groups = Object.create(null);
  rows.forEach(function (r) {
    const customer = String(r[9] == null ? '' : r[9]).trim() || UNASSIGNED_TAB;
    (groups[customer] || (groups[customer] = [])).push(r);
  });
  return groups;
}

/**
 * upsertRows — Phase 1 of the customer-billing redesign (CNC_WebApp spec 2026-10-04 §6.2).
 * ONE row per sheet, matched by Sheet Key (column M); a pre-Phase-1 row with blank M is
 * matched on exact (Job, Sheet) and claimed. Verifies the Firebase ID token; rows that carry
 * invoice / po / billed are accepted only from OWNER_UIDS. Full-duration lock like appendRows.
 */
function upsertRowsLocked(body) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    return upsertRows(body);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function upsertRows(body) {
  if (FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'no rows' };
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r) || !str(r.key)) return { ok: false, error: 'row ' + (i + 1) + ' has no key' };
  }
  const carriesBilling = rows.some(function (r) { return hasValue(r.invoice) || hasValue(r.po) || hasValue(r.billed); });
  if (carriesBilling && OWNER_UIDS.indexOf(auth.uid) === -1) return { ok: false, error: 'owner only' };

  const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  const groups = Object.create(null);
  rows.forEach(function (r) {
    const customer = str(r.customer) || UNASSIGNED_TAB;
    (groups[customer] || (groups[customer] = [])).push(r);
  });
  var updated = 0, appended = 0, claimed = 0;
  Object.keys(groups).forEach(function (customer) {
    const sheet = findOrCreateCustomerTab(ss, customer);
    ensureLogHeaders(sheet);
    const values = sheet.getDataRange().getValues();          // values[i] is sheet row i + 1
    const byKey = Object.create(null), byJobSheet = Object.create(null);
    for (var i = 1; i < values.length; i++) {
      const key = str(values[i][COL.key]);
      if (key) { if (byKey[key] === undefined) byKey[key] = i; }
      else { const js = jobSheetKey(values[i][COL.job], values[i][COL.sheet]); if (byJobSheet[js] === undefined) byJobSheet[js] = i; }
    }
    groups[customer].forEach(function (r) {
      const key = str(r.key);
      var idx = byKey[key], isClaim = false;
      if (idx === undefined) {
        const js = jobSheetKey(r.job, r.sheet);
        idx = byJobSheet[js];
        if (idx !== undefined) { isClaim = true; delete byJobSheet[js]; }   // one claim per legacy row
      }
      if (idx === undefined) {
        const fresh = newLogRow(r);
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, LOG_HEADER.length).setValues([fresh]);
        values.push(fresh);
        byKey[key] = values.length - 1;
        appended++;
      } else {
        const merged = mergeLogRow(values[idx], r);
        sheet.getRange(idx + 1, 1, 1, LOG_HEADER.length).setValues([merged]);
        values[idx] = merged;
        byKey[key] = idx;
        if (isClaim) claimed++; else updated++;
      }
    });
  });
  return { ok: true, updated: updated, appended: appended, claimed: claimed };
}

// On an EXISTING tab: appends columns at the right end if it is narrower than LOG_HEADER, and
// fills only BLANK header cells K1–N1. Never touches A1–J1, never inserts mid-sheet, never renames.
function ensureLogHeaders(sheet) {
  const need = LOG_HEADER.length;
  const have = sheet.getMaxColumns();
  if (have < need) sheet.insertColumnsAfter(have, need - have);
  const range = sheet.getRange(1, 1, 1, need);
  const header = range.getValues()[0];
  var changed = false;
  for (var i = COL.invoice; i < need; i++) {
    if (str(header[i]) === '') { header[i] = LOG_HEADER[i]; changed = true; }
  }
  if (changed) range.setValues([header]);
}

function str(v) { return v == null ? '' : String(v).trim(); }
function hasValue(v) { return v !== undefined && v !== null; }
function jobSheetKey(job, sheetName) { return str(job) + '\u0000' + str(sheetName); }

function newLogRow(r) {
  const row = [];
  for (var i = 0; i < LOG_HEADER.length; i++) row.push('');
  writeCoreCells(row, r);
  row[COL.completedTime] = str(r.completedTime);
  row[COL.notes] = str(r.notes);
  writeBillingCells(row, r);
  return row;
}

// A–E, G, I, J, M: always from the payload.
function writeCoreCells(row, r) {
  row[COL.sheet] = str(r.sheet);
  row[COL.job] = str(r.job);
  row[COL.totalTime] = str(r.totalTime);
  row[COL.toolpathCount] = str(r.toolpathCount);
  row[COL.hasVbit] = str(r.hasVbit);
  row[COL.operator] = str(r.operator);
  row[COL.archiveLink] = str(r.archiveLink);
  row[COL.customer] = str(r.customer);
  row[COL.key] = str(r.key);
}

// K, L, N: only when the payload carries them (owner-only, checked above).
function writeBillingCells(row, r) {
  if (hasValue(r.invoice)) row[COL.invoice] = str(r.invoice);
  if (hasValue(r.po)) row[COL.po] = str(r.po);
  if (hasValue(r.billed)) row[COL.billed] = str(r.billed);
}

// Returns exactly LOG_HEADER.length (A–N) cells: a tab wider than N keeps its extra columns
// untouched because callers write back only that many.
function mergeLogRow(existing, r) {
  const row = existing.slice(0, LOG_HEADER.length);
  while (row.length < LOG_HEADER.length) row.push('');
  writeCoreCells(row, r);
  const invoiceSet = str(row[COL.invoice]) !== '';
  if (!invoiceSet) {
    row[COL.completedTime] = str(r.completedTime);
    row[COL.notes] = str(r.notes);
  } else {
    // Billed row: the cut time it was priced on is frozen. A different incoming time is a
    // re-cut — record it in the notes without moving F (spec §6.2).
    const incoming = str(r.completedTime);
    if (incoming && !sameMoment(row[COL.completedTime], incoming)) {
      const note = 'Re-cut ' + incoming;
      const notes = str(row[COL.notes]);
      if (notes.indexOf(note) === -1) row[COL.notes] = notes ? notes + ' · ' + note : note;
    }
  }
  writeBillingCells(row, r);
  return row;
}

// Sheets may have auto-converted a typed "Oct 1, 2026, 9:12 AM" into a Date; Chrome writes a
// narrow no-break space before AM/PM. Compare as moments when both parse, else as text.
// (isDate uses toString, not instanceof, so it also works across script realms.)
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function sameMoment(cell, incoming) {
  const a = toMoment(cell), b = toMoment(incoming);
  if (a !== null && b !== null) return Math.abs(a - b) < 60000;
  return normalizeTimeText(cell) === normalizeTimeText(incoming);
}
function normalizeTimeText(v) {
  return (isDate(v) ? v.toString() : str(v)).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toMoment(v) {
  if (isDate(v)) return isNaN(v.getTime()) ? null : v.getTime();
  const t = new Date(normalizeTimeText(v)).getTime();
  return isNaN(t) ? null : t;
}

function findOrCreateCustomerTab(ss, customer) {
  // Match on the sanitized name: tabs only ever exist under sanitized names,
  // so this also lets "A/B Sets" find a previously created "A-B Sets" tab.
  const wanted = sanitizeTabName(customer);
  const target = wanted.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === target) return sheets[i];
  }
  const sheet = ss.insertSheet(wanted, sheets.length);
  sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]);
  sheet.setFrozenRows(1);
  return sheet;
}

function sanitizeTabName(name) {
  // Sheets forbids / \ ? * [ ] in tab names and a leading apostrophe; caps at 100 chars.
  const cleaned = String(name)
    .trim()
    .replace(/[\/\\?*\[\]]/g, '-')
    .replace(/^'/, '-');
  return (cleaned || UNASSIGNED_TAB).slice(0, 100);
}

/**
 * Look up ONE order in the live VanLab Order Log. Auth note: the repo (and
 * ENDPOINT_CONFIG.token) is public, so this action additionally demands a
 * Firebase ID token and verifies it with Google before reading anything.
 * Returns only the five fields printing needs — no bulk read exists.
 */
function lookupOrder(body) {
  if (ORDER_LOG_SPREADSHEET_ID.startsWith('PASTE') || FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: order-log constants are still placeholders' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const wanted = normalizeOrderId(body.orderNum);
  if (!wanted) return { ok: false, error: 'missing orderNum' };
  const sheet = SpreadsheetApp.openById(ORDER_LOG_SPREADSHEET_ID).getSheetByName(ORDER_LOG_TAB);
  if (!sheet) return { ok: false, error: 'Order Log tab not found' };
  const values = sheet.getDataRange().getValues();
  for (let i = ORDER_LOG_HEADER_ROW; i < values.length; i++) {
    const row = values[i];
    const orderNum = String(row[1] == null ? '' : row[1]).trim();   // column B
    if (!orderNum || normalizeOrderId(orderNum) !== wanted) continue;
    const vanRaw = String(row[4] == null ? '' : row[4]).trim();      // column E
    return { ok: true, order: {
      orderNum: orderNum,
      customer: String(row[2] == null ? '' : row[2]).trim(),         // column C
      vanRaw: vanRaw,
      vanKey: parseVanKey(vanRaw),
      assembly: String(row[5] == null ? '' : row[5]).trim(),         // column F
    } };
  }
  return { ok: false, error: 'order ' + String(body.orderNum) + ' not found in Order Log' };
}

function normalizeOrderId(id) {
  return String(id == null ? '' : id).trim().replace(/^#/, '').toLowerCase();
}

// Mirrors parse_van_key in the Python tools' order_data.py.
function parseVanKey(vanRaw) {
  const text = String(vanRaw == null ? '' : vanRaw).trim();
  if (!text) return null;
  const m = text.match(/^\s*(\d+)/);
  if (m) return m[1];
  if (text.toUpperCase().indexOf('SUV') === 0) return 'SUV01';
  return null;
}

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

/**
 * Print-queue documents (the Job Tracker's "To Print" panel). Files live in
 * one Drive folder this script creates on first use and remembers in a script
 * property — nothing to paste. Both actions verify the Firebase ID token
 * before touching Drive, like getPackingPdf. getDoc only serves files whose
 * parent is that folder: the script runs as the owner, so without that guard
 * any allowlisted user could pull any file id in the owner's Drive.
 */
const PRINT_QUEUE_FOLDER_NAME = 'CNC Print Queue';
const PRINT_QUEUE_FOLDER_PROP = 'PRINT_QUEUE_FOLDER_ID';
const DOC_MAX_BASE64_CHARS    = 14000000;   // ≈10 MB decoded — the same cap the client enforces

function printQueueFolder() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PRINT_QUEUE_FOLDER_PROP);
  if (id) return DriveApp.getFolderById(id);
  // Same lock pattern as archiveSheet: only the create step races.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    id = props.getProperty(PRINT_QUEUE_FOLDER_PROP);   // re-check under the lock
    if (!id) {
      const folder = DriveApp.createFolder(PRINT_QUEUE_FOLDER_NAME);
      props.setProperty(PRINT_QUEUE_FOLDER_PROP, folder.getId());
      return folder;
    }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  return DriveApp.getFolderById(id);
}

function uploadDoc(body) {
  if (FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const fileName = String(body.fileName == null ? '' : body.fileName).trim();
  const base64   = String(body.base64 == null ? '' : body.base64);
  if (!fileName || !base64) return { ok: false, error: 'missing fileName or base64' };
  if (base64.length > DOC_MAX_BASE64_CHARS) return { ok: false, error: fileName + ' is over the 10 MB limit' };
  const bytes = Utilities.base64Decode(base64);
  // Apps Script bytes are signed (-128..127); mask before comparing.
  const head = bytes.slice(0, 5).map(function (b) { return String.fromCharCode(b & 0xff); }).join('');
  if (head !== '%PDF-') return { ok: false, error: fileName + " isn't a PDF" };
  const file = printQueueFolder().createFile(Utilities.newBlob(bytes, 'application/pdf', fileName));
  return { ok: true, fileId: file.getId() };
}

function getDoc(body) {
  if (FIREBASE_API_KEY.startsWith('PASTE')) {
    return { ok: false, error: 'endpoint not configured: FIREBASE_API_KEY is still a placeholder' };
  }
  const auth = verifyFirebaseIdToken(body.idToken);
  if (!auth.ok) return auth;
  const fileId = String(body.fileId == null ? '' : body.fileId).trim();
  if (!fileId) return { ok: false, error: 'missing fileId' };
  const folderId = printQueueFolder().getId();
  let file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { return { ok: false, error: 'document not found' }; }
  const parents = file.getParents();
  let inFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) { inFolder = true; break; }
  }
  if (!inFolder) return { ok: false, error: 'not a print-queue file' };
  return { ok: true, pdfBase64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function verifyFirebaseIdToken(idToken) {
  if (!idToken) return { ok: false, error: 'missing idToken' };
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'sign-in rejected' };
  let data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { return { ok: false, error: 'sign-in rejected' }; }
  if (!data.users || !data.users.length) return { ok: false, error: 'sign-in rejected' };
  const uid = data.users[0].localId;
  if (ALLOWED_UIDS.length && ALLOWED_UIDS.indexOf(uid) === -1) return { ok: false, error: 'sign-in rejected' };
  return { ok: true, uid: uid };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
