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

// Same pattern as endpoint-error.test.mjs: evaluate the file with `;Endpoint`
// appended and take the completion value, since `const Endpoint = (...)()`
// doesn't attach to the vm context.
function loadEndpoint({ config, fetchImpl }) {
  const calls = [];
  const sandbox = {
    ENDPOINT_CONFIG: config,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return fetchImpl();
    },
    AbortSignal,
  };
  const Endpoint = vm.runInNewContext(source + ';Endpoint', sandbox);
  return { Endpoint, calls };
}

const LIVE = { url: 'https://example.test/exec', token: 'JUNKTOKEN' };

test('getPackingPdf posts action, fileName and idToken, returns pdfBase64', async () => {
  const { Endpoint, calls } = loadEndpoint({
    config: LIVE,
    fetchImpl: async () => ({ json: async () => ({ ok: true, pdfBase64: 'QUJD' }) }),
  });
  const got = await Endpoint.getPackingPdf('Van 13_ NV200 Fitting Kit.pdf', 'IDTOKEN1');
  assert.equal(got, 'QUJD');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'getPackingPdf');
  assert.equal(sent.fileName, 'Van 13_ NV200 Fitting Kit.pdf');
  assert.equal(sent.idToken, 'IDTOKEN1');
  assert.equal(sent.token, 'JUNKTOKEN');
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('server rejection surfaces as endpointError', async () => {
  const { Endpoint } = loadEndpoint({
    config: LIVE,
    fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'sign-in rejected' }) }),
  });
  await assert.rejects(() => Endpoint.getPackingPdf('x.pdf', 'BAD'), (err) => {
    assert.equal(err.endpointError, true);
    assert.equal(err.message, 'sign-in rejected');
    return true;
  });
});

test('unconfigured endpoint returns null without fetching', async () => {
  const { Endpoint, calls } = loadEndpoint({
    config: { url: 'PASTE_URL', token: 'x' },
    fetchImpl: async () => ({ json: async () => ({ ok: true }) }),
  });
  assert.equal(await Endpoint.getPackingPdf('x.pdf', 'T'), null);
  assert.equal(calls.length, 0);
});
