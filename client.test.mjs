import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekDetails } from './src/client.mjs';

const request = { entity: 'album', name: 'Album', artist: 'Artist', year: 2020, force: false };
const context = () => ({ signal: new AbortController().signal });
function fixture() {
  const calls = []; const stored = new Map();
  let key = 'example-test-key';
  let info = { title: 'Album', extract: 'Overview', language: 'zh-CN' };
  const host = { storage: { isSecure: async () => true, get: async name => name === 'api-key' ? key : structuredClone(stored.get(name) ?? null), set: async (name, value) => { stored.set(name, structuredClone(value)); } }, network: {
    cancel: async () => {},
    request: async options => {
      calls.push(options);
      const value = options.url.endsWith('/search')
        ? { results: [{ title: 'Source', url: 'https://example.org/music', summary: 'Verified background' }] }
        : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(info) } }] };
      return { ok: true, body: JSON.stringify(value) };
    },
  } };
  return { client: new DeepSeekDetails(host), host, calls, setKey: value => { key = value; }, setInfo: value => { info = { ...info, ...value }; } };
}
test('bounds sourced artist facts and album credits while searching video sources in parallel', async () => {
  const { client, calls, setInfo } = fixture();
  setInfo({ facts: Array.from({ length: 20 }, () => ({ label: '别名', value: 'a'.repeat(1000), sourceIndices: [0, 0, 9] })),
    relatedArtists: [{ name: 'Member', type: '成员', sourceIndex: 0 }, { name: 'Wrong', sourceIndex: 9 }],
    releaseDetails: { title: 'Album', date: '2020-01-01', labels: [{ name: 'Label' }] },
    releaseVersions: [{ title: 'Limited', date: '2020-01-01', sourceIndex: 0, mediaFormats: ['CD'], trackCount: 10 },
      { title: 'Unsourced', sourceIndex: 4 }],
    credits: [{ role: '作曲', people: [{ name: 'Composer' }] }] });
  const artist = await client.lookup({ entity: 'artist', name: 'Artist', force: false }, context());
  assert.equal(calls.length, 6);
  assert.equal(artist.facts.length, 12);
  assert.equal(artist.facts[0].value.length, 600);
  assert.deepEqual(artist.facts[0].sourceIndices, [0]);
  assert.deepEqual(artist.relatedArtists, [{ name: 'Member', type: '成员', sourceIndex: 0 }]);
  assert.equal(artist.releaseDetails, undefined);
  const album = await client.lookup(request, context());
  assert.equal(calls.length, 10);
  assert.equal(album.releaseDetails.date, '2020-01-01');
  assert.equal(album.releaseVersions.length, 1);
  assert.equal(album.releaseVersions[0].title, 'Limited');
  assert.equal(album.releaseVersions[0].trackCount, 10);
  assert.equal(album.credits[0].people[0].name, 'Composer');
  assert.equal(album.facts, undefined);
});
test('drops unsourced artist fields and completes both searches before generating without accepting generated URLs', async () => {
  const { client, calls, setInfo } = fixture();
  setInfo({ facts: [{ label: '成员', value: 'Member', sourceIndices: [0], url: 'javascript:alert(1)' },
    { label: '风格', value: 'Unsupported' }, { label: '经历', value: 'Wrong reference', sourceIndices: [9] }] });
  const result = await client.lookup({ entity: 'artist', name: 'Artist', force: false }, context());
  assert.deepEqual(result.facts, [{ label: '成员', value: 'Member', sourceIndices: [0] }]);
  assert.equal(calls.slice(0, 5).every(call => call.url.endsWith('/search')), true);
  assert.equal(result.sources.length, 1);
  const completion = JSON.parse(calls[5].body);
  assert.equal(completion.max_tokens, 3200);
  assert.deepEqual(completion.thinking, { type: 'disabled' });
});
test('searches before summarizing, limits remote data and caches only successful detail results', async () => {
  const { client, calls } = fixture();
  const result = await client.lookup({ ...request, path: '/private/music.flac', id: 'library-id' }, context());
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /\/v1\/tools\/search$/);
  assert.equal(JSON.parse(calls[0].body).count, 3);
  const completion = JSON.parse(calls[3].body);
  assert.deepEqual(completion.thinking, { type: 'disabled' });
  assert.equal(completion.messages[1].content.includes('/private/'), false);
  assert.equal(completion.messages[1].content.includes('library-id'), false);
  assert.deepEqual(result.sources, [{ label: 'Source', url: 'https://example.org/music' }]);
  await client.lookup(request, context());
  assert.equal(calls.length, 4);
  await client.lookup({ ...request, force: true }, context());
  assert.equal(calls.length, 8);
});
test('bounds memory to 24 while retaining public results across key changes, eviction and client restarts', async () => {
  const { client, calls, setKey, host } = fixture();
  for (let index = 0; index < 25; index++) await client.lookup({ ...request, name: String(index) }, context());
  assert.equal(client.cache.size, 24);
  setKey('replacement-example-key');
  await client.lookup({ ...request, name: '24' }, context());
  assert.equal(calls.length, 100);
  assert.equal(client.cache.size, 24);
  await client.lookup({ ...request, name: '0' }, context());
  assert.equal(calls.length, 100);
  await new DeepSeekDetails(host).lookup({ ...request, name: '0' }, context());
  assert.equal(calls.length, 100);
  client.dispose();
  assert.equal(client.cache.size, 0);
});

test('normalizes harmless case/spacing and missing years without merging distinct release titles', async () => {
  const { client, calls } = fixture();
  await client.lookup({ ...request, year: undefined }, context());
  await client.lookup({ ...request, name: '  ALBUM ', artist: ' artist ', year: null }, context());
  assert.equal(calls.length, 4);
  await client.lookup({ ...request, name: 'Album (Remastered)', year: null }, context());
  assert.equal(calls.length, 8);
});

test('returns real Bilibili and YouTube video links alongside background sources, within the six-source host limit', async () => {
  const { client, host, calls } = fixture();
  const baseRequest = host.network.request;
  host.network.request = async options => {
    const query = options.body && JSON.parse(options.body).query;
    if (!query?.includes('site:')) return baseRequest(options);
    calls.push(options);
    const results = query.includes('bilibili') ? [
      { title: 'Album 官方 MV', url: 'https://www.bilibili.com/video/BV1234567890' },
      { title: 'Album live', url: 'https://www.bilibili.com/video/av123456' },
      { title: 'not a video', url: 'https://www.bilibili.com/read/cv123' },
    ] : [{ title: 'Album official live', url: 'https://www.youtube.com/watch?v=fixture123' },
      { title: 'fake domain', url: 'https://youtube.com.example.org/watch?v=fixture123' }];
    return { ok: true, status: 200, body: JSON.stringify({ results }) };
  };
  const value = await client.lookup(request, context());
  assert.deepEqual(value.sources.map(source => source.url), ['https://example.org/music',
    'https://www.bilibili.com/video/BV1234567890', 'https://www.bilibili.com/video/av123456',
    'https://www.youtube.com/watch?v=fixture123']);
  const completion = JSON.parse(calls.at(-1).body);
  assert.deepEqual(JSON.parse(completion.messages[1].content).sources.map(source => source.url), value.sources.map(source => source.url));
  assert.ok(value.sources.length <= 6);
});
test('missing key and HTTP errors never create cached summaries or expose provider response bodies', async () => {
  const { client, host, setKey, calls } = fixture();
  setKey('');
  await assert.rejects(client.lookup(request, context()), /API Key/);
  assert.equal(calls.length, 0);
  setKey('example-test-key');
  host.network.request = async () => ({ ok: false, status: 402, body: 'sensitive upstream content' });
  await assert.rejects(client.lookup(request, context()), /账户余额不足/);
  assert.equal(client.cache.size, 0);
});
test('an abort cancels all three parallel searches and prevents a completion', async () => {
  const { client, host } = fixture();
  const controller = new AbortController();
  const releases = [];
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const cancelled = [];
  host.network.cancel = async id => { cancelled.push(id); };
  host.network.request = async () => new Promise(resolve => { releases.push(resolve); if (releases.length === 3) started(); });
  const pending = client.lookup(request, { signal: controller.signal });
  await ready;
  controller.abort();
  releases.forEach(release => release({ ok: true, body: '{"results":[]}' }));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancelled.length, 3);
  assert.equal(client.cache.size, 0);
});
