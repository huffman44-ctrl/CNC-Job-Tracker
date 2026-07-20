/**
 * CNC Job Tracker endpoint — paste into script.google.com, fill the four
 * constants, then Deploy > New deployment > Web app:
 *   Execute as: Me   |   Who has access: Anyone
 * Redeploying creates a fresh URL (rotate if the endpoint is ever abused).
 */
const TOKEN              = 'PASTE_TOKEN';
const ARCHIVE_FOLDER_ID  = 'PASTE_ARCHIVE_FOLDER_ID';
const LOG_SPREADSHEET_ID = 'PASTE_LOG_SPREADSHEET_ID';
const LOG_SHEET_NAME     = 'PASTE_LOG_SHEET_NAME';

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
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (body.action === 'archive')    return jsonOut(archiveSheet(body));
    if (body.action === 'appendRows') return jsonOut(appendRows(body));
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function archiveSheet(body) {
  if (!body.fileName || !body.html) {
    return { ok: false, error: 'missing fileName or html' };
  }
  const root      = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  const jobName   = String(body.jobName || '').trim() || 'Unknown Job';
  const folders   = root.getFoldersByName(jobName);
  const jobFolder = folders.hasNext() ? folders.next() : root.createFolder(jobName);
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

function appendRows(body) {
  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: 'no rows' };
  }
  if (!rows.every(function (r) { return Array.isArray(r) && r.length === 9; })) {
    return { ok: false, error: 'rows must be 9 columns' };
  }
  const sheet = SpreadsheetApp.openById(LOG_SPREADSHEET_ID).getSheetByName(LOG_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'log sheet not found' };
  const values = rows.map(function (r) { return r.map(String); });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 9).setValues(values);
  return { ok: true, appended: values.length };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
