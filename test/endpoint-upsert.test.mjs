import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../js/endpoint.js'), 'utf8');

// Same recipe as test/endpoint-doc.test.mjs: evaluate with `;Endpoint` appended and record fetches.
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

// Objects built inside the vm context are a different realm, so deepEqual would fail on prototypes.
const plain = (x) => JSON.parse(JSON.stringify(x));

const LIVE = { url: 'https://example.test/exec', token: 'JUNKTOKEN' };
const ok = (body) => async () => ({ json: async () => ({ ok: true, ...body }) });
const rows = [{ key: 'fk1', sheet: 'Job Layout Sheet 2', job: 'NL_Bridge', customer: 'Northlight Studios' }];

test('upsertLogRows posts action, rows (objects) and idToken with a 60 s timeout', async () => {
  const { Endpoint, calls, timeouts } = loadEndpoint({ config: LIVE, fetchImpl: ok({ updated: 1, appended: 0, claimed: 0 }) });
  const res = await Endpoint.upsertLogRows(rows, 'IDTOKEN1');
  assert.deepEqual(plain(res), { ok: true, updated: 1, appended: 0, claimed: 0 });
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.action, 'upsertRows');
  assert.equal(sent.idToken, 'IDTOKEN1');
  assert.equal(sent.token, 'JUNKTOKEN');
  assert.deepEqual(sent.rows, rows);
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(plain(timeouts), [60000]);
});

test('PASTE-disabled: resolves ok/offline without touching the network', async () => {
  const { Endpoint, calls } = loadEndpoint({ config: { url: 'PASTE_URL', token: 'x' }, fetchImpl: ok({}) });
  const res = await Endpoint.upsertLogRows(rows, null);
  assert.deepEqual(plain(res), { ok: true, updated: 0, appended: 0, claimed: 0, offline: true });
  assert.equal(calls.length, 0);
});

test('a server refusal surfaces as endpointError with the server message', async () => {
  const { Endpoint } = loadEndpoint({ config: LIVE, fetchImpl: async () => ({ json: async () => ({ ok: false, error: 'owner only' }) }) });
  await assert.rejects(() => Endpoint.upsertLogRows(rows, 'T'), (err) => err.endpointError === true && err.message === 'owner only');
});

test('appendLogRows is unchanged (old shop tabs keep working)', async () => {
  const { Endpoint, calls } = loadEndpoint({ config: LIVE, fetchImpl: ok({ appended: 1 }) });
  assert.equal(await Endpoint.appendLogRows([['a']]), true);
  assert.equal(JSON.parse(calls[0].opts.body).action, 'appendRows');
});
