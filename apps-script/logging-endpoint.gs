/**
 * CNC Job Tracker endpoint — paste into script.google.com, fill the three
 * constants, then Deploy > New deployment > Web app:
 *   Execute as: Me   |   Who has access: Anyone
 * Redeploying creates a fresh URL (rotate if the endpoint is ever abused).
 */
const TOKEN              = 'PASTE_TOKEN';
const ARCHIVE_FOLDER_ID  = 'PASTE_ARCHIVE_FOLDER_ID';
const LOG_SPREADSHEET_ID = 'PASTE_LOG_SPREADSHEET_ID';
const ORDER_LOG_SPREADSHEET_ID = 'PASTE_ORDER_LOG_SPREADSHEET_ID';
const FIREBASE_API_KEY         = 'PASTE_FIREBASE_API_KEY';
// Optional allowlist: empty = any signed-in user of this Firebase project;
// non-empty = only these uids (paste from Firebase console → Authentication
// → Users) — recommended because Email/Password signup may be open.
const ALLOWED_UIDS = [];
const ORDER_LOG_TAB        = 'Order Log';
const ORDER_LOG_HEADER_ROW = 4;   // data starts on sheet row 5

// Rows route to the tab named after each row's Customer (10th column),
// created on first use. Rows with no customer land in UNASSIGNED_TAB.
const LOG_HEADER = ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit',
  'Completed Time', 'Operator', 'Final Notes', 'Archive Link', 'Customer'];
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
    if (body.action === 'lookupOrder') return jsonOut(lookupOrder(body));
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
