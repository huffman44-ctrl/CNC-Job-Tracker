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

// `const Endpoint = (...)()` doesn't attach to the vm context, so evaluate
// the file with `;Endpoint` appended and take the completion value.
function loadEndpoint(fetchImpl) {
  const sandbox = {
    ENDPOINT_CONFIG: { url: 'https://example.invalid/exec', token: 'test-token' },
    fetch: fetchImpl,
    AbortSignal,
  };
  return vm.runInNewContext(source + ';Endpoint', sandbox);
}

test('endpoint {ok:false} replies throw with endpointError=true and the real message', async () => {
  const Endpoint = loadEndpoint(async () => ({
    json: async () => ({ ok: false, error: 'log sheet not found' }),
  }));
  await assert.rejects(
    Endpoint.appendLogRows([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]),
    (err) => err.endpointError === true && err.message === 'log sheet not found'
  );
});

test('network failures throw without the endpointError flag', async () => {
  const Endpoint = loadEndpoint(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(
    Endpoint.appendLogRows([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]),
    (err) => err.endpointError === undefined && err instanceof TypeError
  );
});
