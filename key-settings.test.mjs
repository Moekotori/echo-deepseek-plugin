import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDeepSeekKey, validateDeepSeekKey, deepSeekKeyError } from './src/key-settings.mjs';
function fixture(status = 200, available = true) {
  const writes = []; const requests = [];
  const host = { storage: { isSecure: async () => true, set: async (...args) => writes.push(args) }, network: {
    request: async request => { requests.push(request); return { ok: status === 200, status,
      body: JSON.stringify({ is_available: available, balance_infos: [{ currency: 'CNY', total_balance: available ? '12.3456' : '0.00' }] }) }; },
    cancel: async () => {},
  } };
  return { host, requests, writes };
}
test('tests authentication and balance before saving, without sending prompts or billing a completion', async () => {
  const { host, requests, writes } = fixture();
  assert.deepEqual(await saveDeepSeekKey(host, ' fixture-key ', new AbortController().signal),
    { available: true, balances: [{ currency: 'CNY', total: '12.3456' }] });
  assert.equal(requests[0].url, 'https://api.deepseek.com/user/balance');
  assert.equal(requests[0].method, 'GET'); assert.equal(requests[0].body, undefined);
  assert.deepEqual(writes, [['api-key', 'fixture-key']]);
});
test('invalid credentials and connection failures never replace the saved key; valid zero-balance keys are remembered', async () => {
  const bad = fixture(401);
  await assert.rejects(saveDeepSeekKey(bad.host, 'bad-key', new AbortController().signal), /API Key 无效/);
  assert.equal(bad.writes.length, 0);
  const offline = fixture(); offline.host.network.request = async () => { throw Error('private network details'); };
  await assert.rejects(saveDeepSeekKey(offline.host, 'fixture-key', new AbortController().signal));
  assert.equal(offline.writes.length, 0);
  const empty = fixture(200, false);
  assert.deepEqual(await saveDeepSeekKey(empty.host, 'fixture-key', new AbortController().signal),
    { available: false, balances: [{ currency: 'CNY', total: '0.00' }] });
  assert.equal(empty.writes.length, 1);
  assert.equal(deepSeekKeyError(new Error('private network details')), '连接验证失败，请检查网络后重试');
});
test('rechecking a remembered key does not save it again and aborting validation cannot write it', async () => {
  const { host, writes } = fixture();
  await validateDeepSeekKey(host, 'fixture-key', new AbortController().signal);
  assert.equal(writes.length, 0);
  const controller = new AbortController();
  host.network.request = async () => { controller.abort(); return { ok: true, status: 200, body: '{"is_available":true}' }; };
  await assert.rejects(saveDeepSeekKey(host, 'fixture-key', controller.signal), { name: 'AbortError' });
  assert.equal(writes.length, 0);
});

test('refuses to persist credentials on a host without secure storage support', async () => {
  const { host, writes, requests } = fixture(); host.storage.isSecure = async () => false;
  await assert.rejects(saveDeepSeekKey(host, 'fixture-key', new AbortController().signal), /安全 Key 存储/);
  assert.equal(writes.length, 0); assert.equal(requests.length, 0);
});

test('rejects malformed balance data instead of claiming success or inventing a zero balance', async () => {
  const { host, writes } = fixture();
  host.network.request = async () => ({ ok: true, status: 200,
    body: JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 'unknown' }] }) });
  await assert.rejects(saveDeepSeekKey(host, 'fixture-key', new AbortController().signal), /验证结果无效/);
  assert.equal(writes.length, 0);
});
