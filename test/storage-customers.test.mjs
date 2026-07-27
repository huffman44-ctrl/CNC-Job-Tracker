import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Storage = require('../js/storage.js');

test('addCustomer/getCustomers work offline (no Firestore db) and sort alphabetically', async () => {
  await Storage.addCustomer('cust_1', 'Jane Client');
  await Storage.addCustomer('cust_2', 'Bob Vans');
  const names = Storage.getCustomers().map(c => c.name);
  assert.deepEqual(names, ['Bob Vans', 'Jane Client']);
});

test('renameCustomer moves the cache entry to the new key/name', async () => {
  await Storage.addCustomer('cust_3', 'Old Name');
  await Storage.renameCustomer('cust_3', 'cust_4', 'New Name');
  const entries = Storage.getCustomers();
  assert.ok(!entries.some(c => c.key === 'cust_3'));
  assert.ok(entries.some(c => c.key === 'cust_4' && c.name === 'New Name'));
});

test('removeCustomer deletes the cache entry', async () => {
  await Storage.addCustomer('cust_5', 'Temp Customer');
  await Storage.removeCustomer('cust_5');
  assert.ok(!Storage.getCustomers().some(c => c.key === 'cust_5'));
});

test('getProjectCustomer/setProjectCustomer round-trip through the cache', async () => {
  assert.equal(Storage.getProjectCustomer('proj_abc'), null);
  await Storage.setProjectCustomer('proj_abc', 'Jane Client');
  assert.equal(Storage.getProjectCustomer('proj_abc'), 'Jane Client');
});
