import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultCache, resultTtl } from './src/result-cache.mjs';

function fixture() {
  const stored = new Map();
  const host = { storage: {
    get: async key => structuredClone(stored.get(key) ?? null),
    set: async (key, value) => { stored.set(key, structuredClone(value)); },
  } };
  return { host, stored, cache: new ResultCache(host, 'details') };
}
const options = (extra = {}) => ({ signal: new AbortController().signal, ttlMs: resultTtl.album, ...extra });

test('persisted results survive disposal and restart; expiry and force each start exactly one new load', async t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const { cache, host } = fixture(); let calls = 0;
  const load = async () => ({ title: 'Result ' + ++calls });
  await cache.lookup('album', options(), load); cache.dispose();
  const reopened = new ResultCache(host, 'details');
  assert.equal((await reopened.lookup('album', options(), load)).title, 'Result 1');
  assert.equal(calls, 1);
  now += resultTtl.album;
  assert.equal((await reopened.lookup('album', options(), load)).title, 'Result 2');
  assert.equal((await reopened.lookup('album', options({ force: true }), load)).title, 'Result 3');
  assert.equal(calls, 3);
  await assert.rejects(reopened.lookup('album', options({ force: true }), async () => { throw Error('upstream failed'); }));
  assert.equal((await reopened.lookup('album', options(), load)).title, 'Result 3');
});

test('joins duplicate work while cancelling one visitor leaves the other visitor and its paid result intact', async () => {
  const { cache } = fixture(); const visitor = new AbortController();
  let release, started; let calls = 0; let activeSignal;
  const ready = new Promise(resolve => { started = resolve; });
  const load = signal => { calls++; activeSignal = signal; started(); return new Promise(resolve => { release = resolve; }); };
  const first = cache.lookup('album', options({ signal: visitor.signal }), load);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await ready;
  const second = cache.lookup('album', options(), load);
  // Wait for the second digest/subscription to finish, without a timer or network request.
  while (cache.pending.values().next().value.users.size < 2) await new Promise(resolve => setImmediate(resolve));
  visitor.abort(); await rejected;
  assert.equal(activeSignal.aborted, false);
  release({ title: 'Shared' });
  assert.deepEqual(await second, { title: 'Shared' }); assert.equal(calls, 1);
});

test('cancelling every visitor retires the load without retaining or persisting it', async () => {
  const { cache, stored } = fixture(); const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = cache.lookup('album', options({ signal: controller.signal }), signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await ready; controller.abort(); await rejected;
  await Promise.allSettled([...cache.pending.values()].map(job => job.promise));
  assert.equal(cache.size, 0); assert.equal(stored.size, 0);
  assert.deepEqual(await cache.lookup('album', options(), async () => ({ title: 'Next visit' })), { title: 'Next visit' });
});

test('bounds both persistent and resident results and returns independent values to consumers', async () => {
  const { cache, stored, host } = fixture();
  for (let index = 0; index < 110; index++) await cache.lookup(index, options(), async () => ({ text: 'a'.repeat(5000), index }));
  assert.ok(cache.size <= 24);
  const snapshot = stored.get(cache.indexKey);
  assert.ok(snapshot.length <= 96); assert.ok(JSON.stringify(snapshot).length <= 384_000);
  assert.equal(stored.size, 1);
  const reopened = new ResultCache(host, 'details');
  const first = await reopened.lookup(109, options(), async () => { throw Error('unexpected paid request'); });
  first.text = 'changed by consumer';
  assert.equal((await reopened.lookup(109, options(), async () => {})).text.length, 5000);
});
