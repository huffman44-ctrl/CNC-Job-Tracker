import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'),
  'utf8'
);

// Same recipe as test/endpoint-packing.test.mjs, plus an AbortSignal fake
// that records the timeout each call asked for.
function loadEndpoint({ config, fetchImpl }) {
  const calls = [];
  const timeouts = [];
  const sandbox = {
    ENDPOINT_CONFIG: config,
    fetch: async (url, opts) => { calls.push({ url, opts }); return fetchImpl(); },
    AbortSignal: { timeout: (ms) => { timeouts.push(ms); return undefined; } },
  };
  const Endpoint = vm.runInNewContext(source + ';Endpoint', sandbox);
  return { Endpoint, calls, timeouts };
}

const LIVE = { url: 'https://example.test/exec', token: 'JUNKTOKEN' };
const ok = (body) => async () => ({ json: async () => ({ ok: true, ...body }) });

test('uploadDoc posts action, fileName, base64, idToken with the 120 s timeout', async () => {
  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ fileId: 'FILE1' }) });
  const got = await Endpoint.uploadDoc('cut-list.pdf', 'JVBERi0=', 'IDTOKEN1');
  assert.equal(got, 'FILE1');
  const sent = JSON.parse(calls[0].opts.body);
  assert.deepEqual(
    { action: sent.action, fileName: sent.fileName, base64: sent.base64, idToken: sent.idToken, token: sent.token },
    { action: 'uploadDoc', fileName: 'cut-list.pdf', base64: 'JVBERi0=', idToken: 'IDTOKEN1', token: 'JUNKTOKEN' });
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(timeouts, [120000]);
  assert.equal(Endpoint.DOC_TIMEOUT_MS, 120000);
});

test('getDoc posts action, fileId, idToken with the 120 s timeout and returns pdfBase64', async () => {
  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ pdfBase64: 'QUJD' }) });
  assert.equal(await Endpoint.getDoc('FILE1', 'IDTOKEN1'), 'QUJD');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'getDoc');
  assert.equal(sent.fileId, 'FILE1');
  assert.equal(sent.idToken, 'IDTOKEN1');
  assert.deepEqual(timeouts, [120000]);
});

test('existing calls keep the 20 s default timeout', async () => {
  const { Endpoint, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ pdfBase64: 'QUJD', order: {} }) });
  await Endpoint.getPackingPdf('x.pdf', 'T');
  await Endpoint.lookupOrder('1206', 'T');
  assert.deepEqual(timeouts, [20000, 20000]);
});

test('server rejection surfaces as endpointError for both actions', async () => {
  const { Endpoint } = loadEndpoint({
    config: LIVE,
    fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'not a print-queue file' }) }),
  });
  await assert.rejects(() => Endpoint.getDoc('X', 'T'), (err) => err.endpointError === true && err.message === 'not a print-queue file');
  await assert.rejects(() => Endpoint.uploadDoc('a.pdf', 'AA==', 'T'), (err) => err.endpointError === true);
});

test('unconfigured endpoint returns null without fetching', async () => {
  const { Endpoint, calls } = loadEndpoint({ config: { url: 'PASTE_URL', token: 'x' }, fetchImpl: ok({}) });
  assert.equal(await Endpoint.uploadDoc('a.pdf', 'AA==', 'T'), null);
  assert.equal(await Endpoint.getDoc('X', 'T'), null);
  assert.equal(calls.length, 0);
});
