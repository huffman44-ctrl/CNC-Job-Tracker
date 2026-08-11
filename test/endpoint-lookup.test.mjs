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

test('lookupOrder posts action, order number and idToken, returns order', async () => {
  const order = { orderNum: '1199', customer: 'Jane Sample', vanRaw: '39 Ford', vanKey: '39', assembly: '3806' };
  const { Endpoint, calls } = loadEndpoint({
    config: LIVE,
    fetchImpl: async () => ({ json: async () => ({ ok: true, order }) }),
  });
  const got = await Endpoint.lookupOrder('1199', 'IDTOKEN1');
  assert.deepEqual(got, order);
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'lookupOrder');
  assert.equal(sent.orderNum, '1199');
  assert.equal(sent.idToken, 'IDTOKEN1');
  assert.equal(sent.token, 'JUNKTOKEN');
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
});

test('server rejection surfaces as endpointError', async () => {
  const { Endpoint } = loadEndpoint({
    config: LIVE,
    fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'sign-in rejected' }) }),
  });
  await assert.rejects(() => Endpoint.lookupOrder('1199', 'BAD'), (err) => {
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
  assert.equal(await Endpoint.lookupOrder('1199', 'T'), null);
  assert.equal(calls.length, 0);
});
