import { modelResponse } from './test-support.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekResearch } from './src/research.mjs';
import { DeepSeekExploration } from './src/exploration.mjs';

function fixture() {
  const stored = new Map(); const posts = []; const searches = []; let matches = true;
  const host = { storage: { isSecure: async () => true, get: async key => key === 'api-key' ? 'fixture' : structuredClone(stored.get(key) ?? null), set: async (key, value) => stored.set(key, structuredClone(value)) },
    network: { cancel: async () => {}, request: async options => {
      const input = JSON.parse(options.body);
      let data;
      if (options.url.endsWith('/search')) {
        searches.push(input.query);
        const url = input.query.includes('site:bilibili') ? 'https://www.bilibili.com/video/BV1234567' : input.query.includes('site:youtube') ? 'https://www.youtube.com/watch?v=video' : 'https://example.org/credits';
        data = { results: [{ title: 'Credits', url, summary: 'Verified credits' }] };
      } else {
        posts.push(input); const request = JSON.parse(input.messages.at(-1).content);
        data = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Verified credits', items: [],
          people: request.kind === 'track' ? Array.from({ length: 5 }, (_, i) => ({ name: 'Composer' + i, role: '作曲', sourceIndex: 0 })) : [],
          works: request.kind === 'contributor' ? [{ title: 'Song', artist: 'Artist', relation: '作曲', sourceIndex: 0 },
            { title: 'Other Song', artist: 'Artist', relation: '作曲', sourceIndex: 0 }] : [] }) } }] };
      }
      return modelResponse(data);
    } }, library: { getTracks: async () => ({ items: matches ? [{ id: 'private-id', title: 'Other Song', artist: 'Artist', album: 'Private album', path: '/private/song', unavailable: false }] : [] }) } };
  return { host, stored, posts, searches, unmatch: () => { matches = false; }, client: new DeepSeekExploration(host, new DeepSeekResearch(host)) };
}

test('exploration follows at most two evidenced contributors, deduplicates works, and attaches real videos', async () => {
  const { client, posts, searches, stored } = fixture();
  const result = await client.lookup({ name: 'Song — Artist' }, { signal: new AbortController().signal });
  assert.equal(posts.length, 3); assert.equal(searches.length, 5); assert.equal(result.people.length, 2);
  assert.equal(result.works.length, 1); assert.equal(result.works[0].track.id, 'private-id');
  assert.equal(result.works[0].title, 'Other Song');
  assert.match(result.works[0].relation, /Composer0/);
  assert.ok(result.sources.some(source => source.url.includes('bilibili.com/video/')));
  assert.ok(result.sources.some(source => source.url.includes('youtube.com/watch')));
  assert.ok(result.sources.length <= 8);
  for (const entry of [...result.people, ...result.works]) assert.ok(result.sources[entry.sourceIndex]);
  const exported = JSON.stringify([posts, [...stored.values()]]);
  for (const privateValue of ['private-id', '/private/song', 'Private album']) assert.equal(exported.includes(privateValue), false);
});

test('reopening exploration reuses every paid request and rematches the current library', async () => {
  const { client, host, posts, searches, unmatch } = fixture();
  await client.lookup({ name: 'Song — Artist' }, { signal: new AbortController().signal }); unmatch();
  const result = await new DeepSeekExploration(host, new DeepSeekResearch(host)).lookup({ name: ' song — artist ' }, { signal: new AbortController().signal });
  assert.equal(posts.length, 3); assert.equal(searches.length, 5); assert.equal(result.works[0].track, null);
});

test('missing verified credits never trigger a guessed contributor query', async () => {
  const { host, posts } = fixture();
  const research = { lookup: async () => ({ summary: '署名未确认', items: [], people: [], works: [], sources: [], fetchedAt: '2026-10-21' }) };
  const result = await new DeepSeekExploration(host, research).lookup({ name: 'Unknown' }, { signal: new AbortController().signal });
  assert.equal(posts.length, 0); assert.equal(result.people.length, 0); assert.equal(result.works.length, 0);
});

test('cancelling after a contributor query prevents the remaining stages', async () => {
  const { host, searches } = fixture(); const controller = new AbortController(); let lookups = 0;
  const research = { lookup: async () => {
    if (++lookups > 1) { controller.abort(); controller.signal.throwIfAborted(); }
    return { summary: 'Credits', items: [], people: [{ name: 'Composer', role: '作曲', sourceIndex: 0 }], sources: [{ url: 'https://example.org/credits' }] };
  } };
  await assert.rejects(new DeepSeekExploration(host, research).lookup({ name: 'Song' }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(searches.length, 0);
});
