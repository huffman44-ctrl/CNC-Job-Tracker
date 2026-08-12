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
source = source
  .replace("'PASTE_PACKING_FOLDER_ID'", "'PACKFOLDER1'")
  .replace("'PASTE_FIREBASE_API_KEY'", "'APIKEY1'");

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // '%PDF-'
const KNOWN_FILE = 'Van 13_ NV200 Fitting Kit.pdf';

const plain = (v) => JSON.parse(JSON.stringify(v));

function makeContext({ tokenValid = true } = {}) {
  const sandbox = {
    DriveApp: {
      getFolderById(id) {
        assert.equal(id, 'PACKFOLDER1');
        return {
          getFilesByName(name) {
            const found = name === KNOWN_FILE;
            return {
              hasNext() { return found; },
              next() {
                return { getBlob() { return { getBytes() { return PDF_BYTES; } }; } };
              },
            };
          },
        };
      },
    },
    Utilities: {
      base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); },
    },
    UrlFetchApp: {
      fetch(url, opts) {
        assert.ok(url.includes('identitytoolkit.googleapis.com'));
        assert.equal(JSON.parse(opts.payload).idToken, 'IDTOKEN1');
        return {
          getResponseCode() { return tokenValid ? 200 : 400; },
          getContentText() {
            return tokenValid ? JSON.stringify({ users: [{ localId: 'uid1' }] }) : '{}';
          },
        };
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test('valid sign-in and known filename returns base64 PDF bytes', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1', fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: true, pdfBase64: Buffer.from(PDF_BYTES).toString('base64') });
});

test('unknown filename is a clear error, not silence', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1', fileName: 'nope.pdf' });
  assert.equal(r.ok, false);
  assert.match(r.error, /nope\.pdf.*not found/);
});

test('missing fileName is rejected', () => {
  const r = makeContext().getPackingPdf({ idToken: 'IDTOKEN1' });
  assert.deepEqual(plain(r), { ok: false, error: 'missing fileName' });
});

test('rejected sign-in returns an error and never touches Drive', () => {
  const ctx = makeContext({ tokenValid: false });
  ctx.DriveApp.getFolderById = () => { throw new Error('Drive must not be read'); };
  const r = ctx.getPackingPdf({ idToken: 'IDTOKEN1', fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: false, error: 'sign-in rejected' });
});

test('missing idToken is rejected without a network call', () => {
  const ctx = makeContext();
  ctx.UrlFetchApp.fetch = () => { throw new Error('must not fetch'); };
  const r = ctx.getPackingPdf({ fileName: KNOWN_FILE });
  assert.deepEqual(plain(r), { ok: false, error: 'missing idToken' });
});

test('doPost routes the getPackingPdf action', () => {
  // Fresh sandbox (a context can't re-run the source: top-level consts would
  // redeclare). TOKEN starts with PASTE in the template, so doPost's config
  // guard would answer before routing — swap it in-source like the other
  // constants are swapped.
  const routed = source.replace("const TOKEN              = 'PASTE_TOKEN';",
    "const TOKEN              = 'T1';");
  let payload;
  const donor = makeContext();  // reuse the mock implementations
  const sandbox = {
    DriveApp: donor.DriveApp,
    Utilities: donor.Utilities,
    UrlFetchApp: donor.UrlFetchApp,
    ContentService: {
      createTextOutput(s) { payload = JSON.parse(s); return { setMimeType() { return this; } }; },
      MimeType: { JSON: 'json' },
    },
  };
  vm.runInNewContext(routed, sandbox);
  sandbox.doPost({ postData: { contents: JSON.stringify(
    { token: 'T1', action: 'getPackingPdf', idToken: 'IDTOKEN1', fileName: KNOWN_FILE }) } });
  assert.equal(payload.ok, true);
});
