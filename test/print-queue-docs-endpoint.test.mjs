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
source = source.replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");
source = source.replace("'PASTE_TOKEN'", "'TOK'");

const PDF_B64 = Buffer.from('%PDF-1.4 hello').toString('base64');
const HTML_B64 = Buffer.from('<html>nope</html>').toString('base64');
const plain = (v) => JSON.parse(JSON.stringify(v));

// Fakes for the Apps Script services the two actions touch. `state` lets a
// test see what Drive and the script properties ended up holding.
function makeContext({ tokenValid = true, storedFolderId = null, files = {} } = {}) {
  const state = { props: {}, files: { ...files }, folderCreates: 0, driveTouched: false };
  if (storedFolderId) state.props.PRINT_QUEUE_FOLDER_ID = storedFolderId;
  const folder = (id) => ({
    getId: () => id,
    createFile(blob) {
      state.driveTouched = true;
      const fid = 'FILE' + (Object.keys(state.files).length + 1);
      state.files[fid] = { parent: id, bytes: blob.bytes, mime: blob.mime, name: blob.name };
      return { getId: () => fid };
    },
  });
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => state.props[k] || null,
      setProperty: (k, v) => { state.props[k] = v; },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      createFolder(name) { state.driveTouched = true; state.folderCreates++; assert.equal(name, 'CNC Print Queue'); return folder('NEWFOLDER'); },
      getFolderById(id) { state.driveTouched = true; return folder(id); },
      getFileById(id) {
        state.driveTouched = true;
        const f = state.files[id];
        if (!f) throw new Error('File not found: ' + id);
        return {
          getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => f.parent }; } }; },
          getBlob: () => ({ getBytes: () => f.bytes }),
        };
      },
    },
    Utilities: {
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    UrlFetchApp: {
      fetch(url, opts) {
        assert.ok(url.includes('identitytoolkit.googleapis.com'));
        return {
          getResponseCode() { return tokenValid ? 200 : 400; },
          getContentText() { return tokenValid ? JSON.stringify({ users: [{ localId: 'uid1' }] }) : '{}'; },
        };
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return { ctx: sandbox, state };
}

test('uploadDoc: valid PDF lands in the folder and returns its id', () => {
  const { ctx, state } = makeContext();
  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'cut-list.pdf', base64: PDF_B64 });
  assert.deepEqual(plain(r), { ok: true, fileId: 'FILE1' });
  assert.equal(state.files.FILE1.parent, 'NEWFOLDER');
  assert.equal(state.files.FILE1.mime, 'application/pdf');
  assert.equal(state.files.FILE1.name, 'cut-list.pdf');
});

test('uploadDoc: folder is created once and remembered in script properties', () => {
  const { ctx, state } = makeContext();
  ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 });
  ctx.uploadDoc({ idToken: 'T', fileName: 'b.pdf', base64: PDF_B64 });
  assert.equal(state.folderCreates, 1);
  assert.equal(state.props.PRINT_QUEUE_FOLDER_ID, 'NEWFOLDER');
});

test('uploadDoc: a stored folder id is reused, nothing is created', () => {
  const { ctx, state } = makeContext({ storedFolderId: 'OLDFOLDER' });
  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 });
  assert.equal(r.ok, true);
  assert.equal(state.folderCreates, 0);
  assert.equal(state.files.FILE1.parent, 'OLDFOLDER');
});

test('uploadDoc: non-PDF bytes are refused by header, not by name', () => {
  const { ctx, state } = makeContext();
  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'looks-like.pdf', base64: HTML_B64 });
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't a PDF/);
  assert.deepEqual(state.files, {});
});

test('uploadDoc: over the 10 MB cap is refused before decoding', () => {
  const { ctx, state } = makeContext();
  const r = ctx.uploadDoc({ idToken: 'T', fileName: 'big.pdf', base64: 'A'.repeat(14000001) });
  assert.equal(r.ok, false);
  assert.match(r.error, /10 MB/);
  assert.deepEqual(state.files, {});
});

test('uploadDoc: missing fields are rejected', () => {
  const { ctx } = makeContext();
  assert.equal(ctx.uploadDoc({ idToken: 'T', fileName: '', base64: PDF_B64 }).ok, false);
  assert.equal(ctx.uploadDoc({ idToken: 'T', fileName: 'a.pdf', base64: '' }).ok, false);
});

test('uploadDoc and getDoc: bad sign-in is rejected before Drive is touched', () => {
  const a = makeContext({ tokenValid: false });
  assert.deepEqual(plain(a.ctx.uploadDoc({ idToken: 'BAD', fileName: 'a.pdf', base64: PDF_B64 })), { ok: false, error: 'sign-in rejected' });
  assert.equal(a.state.driveTouched, false);
  const b = makeContext({ tokenValid: false, storedFolderId: 'F', files: { FILE1: { parent: 'F', bytes: [1] } } });
  assert.deepEqual(plain(b.ctx.getDoc({ idToken: 'BAD', fileId: 'FILE1' })), { ok: false, error: 'sign-in rejected' });
  assert.equal(b.state.driveTouched, false);
  assert.deepEqual(plain(a.ctx.uploadDoc({ fileName: 'a.pdf', base64: PDF_B64 })), { ok: false, error: 'missing idToken' });
});

test('getDoc: a file in the print-queue folder comes back as base64', () => {
  const bytes = Array.from(Buffer.from('%PDF-1.4 hello'));
  const { ctx } = makeContext({ storedFolderId: 'F', files: { FILE1: { parent: 'F', bytes } } });
  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'FILE1' })), { ok: true, pdfBase64: PDF_B64 });
});

test('getDoc: a file outside the folder is refused; unknown ids and missing fileId are clear errors', () => {
  const { ctx } = makeContext({ storedFolderId: 'F', files: { ELSEWHERE: { parent: 'SOMEOTHER', bytes: [1] } } });
  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'ELSEWHERE' })), { ok: false, error: 'not a print-queue file' });
  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: 'NOPE' })), { ok: false, error: 'document not found' });
  assert.deepEqual(plain(ctx.getDoc({ idToken: 'T', fileId: '' })), { ok: false, error: 'missing fileId' });
});

test('doPost dispatches both actions', () => {
  // NOTE: adjusted from the brief's literal test — the brief re-ran the .gs
  // source a second time in the same vm context (`vm.runInNewContext(src2, ctx)`)
  // to swap in a real TOKEN, but a vm context keeps its top-level `const`
  // bindings across runs, so re-running throws "Identifier 'TOKEN' has
  // already been declared". Fixed here (test fake only, not the .gs) by
  // patching PASTE_TOKEN once in the shared `source` string before the first
  // (and only) run, and just adding ContentService to the existing context.
  const { ctx } = makeContext({ storedFolderId: 'F' });
  ctx.ContentService = { createTextOutput: (s) => ({ setMimeType() { return { text: s }; } }), MimeType: { JSON: 'json' } };
  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', ...body }) } }).text);
  assert.equal(call({ action: 'uploadDoc', idToken: 'T', fileName: 'a.pdf', base64: PDF_B64 }).ok, true);
  assert.equal(call({ action: 'getDoc', idToken: 'T', fileId: 'FILE1' }).ok, true);
});
