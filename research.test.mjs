import { modelResponse } from './test-support.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekResearch, normalizeResearch } from './src/research.mjs';
import { DeepSeekChat } from './src/chat.mjs';

const signal = () => new AbortController().signal;
const source = { title: 'Artist official news', url: 'https://example.org/news', date: '2026-10-20T00:00:00+00:00', summary: 'Verified artist releases and songwriter credits.' };
function fixture() {
  const calls = []; const reads = []; const stored = new Map();
  const host = { storage: { isSecure: async () => true, get: async name => name === 'api-key' ? 'test-only-key' : structuredClone(stored.get(name) ?? null), set: async (name, value) => { stored.set(name, structuredClone(value)); } }, network: { cancel: async () => {}, request: async request => {
    const body = JSON.parse(request.body); calls.push({ url: request.url, body });
    const value = request.url.endsWith('/search') ? { results: [source, { title: 'unsafe', url: 'javascript:alert(1)' }] }
      : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Verified facts',
        items: [{ title: 'Past show', type: 'concert', date: '2025-01-01', sourceIndex: 0 }],
        works: [{ title: 'Song', artist: 'Artist', relation: '作曲', sourceIndex: 0 }], people: [] }) } }] };
    return modelResponse(value);
  } }, library: { getTracks: async query => { reads.push(query); return { items: [{ id: 'private-id', title: 'Song', artist: 'Artist', album: 'Private album', path: '/private/music', unavailable: false }] }; } } };
  return { host, calls, reads, stored, client: new DeepSeekResearch(host) };
}
test('research keeps source and event dates separate and matches works locally without sending local IDs', async () => {
  const { client, calls, reads } = fixture();
  const result = await client.lookup({ kind: 'contributor', name: 'Composer' }, { signal: signal() });
  assert.equal(calls.length, 2); assert.equal(reads.length, 1);
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].publishedAt, '2026-10-20');
  assert.equal(result.items[0].date, '2025-01-01');
  assert.equal(result.works[0].track.id, 'private-id');
  assert.equal(JSON.stringify(calls).includes('private-id'), false);
  assert.equal(JSON.stringify(calls).includes('/private/'), false);
  assert.equal(JSON.stringify(calls).includes('Private album'), false);
});
test('news uses exactly two bounded live queries and one generation without matching unrelated generated works', async () => {
  const { client, calls, reads } = fixture();
  const result = await client.lookup({ kind: 'news', name: 'Artist' }, { signal: signal() });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.url.endsWith('/search')).length, 2);
  assert.ok(calls[0].body.query.includes('after:'));
  assert.equal(calls[0].body.count, 3);
  assert.equal(result.works.length, 0); assert.equal(reads.length, 0);
});

test('reopened research reuses paid facts but rematches the current library without persisting local track data', async () => {
  const { client, host, calls, stored } = fixture();
  const first = await client.lookup({ kind: 'contributor', name: 'Composer' }, { signal: signal() });
  assert.equal(first.works[0].track.id, 'private-id');
  const saved = JSON.stringify([...stored.values()]);
  assert.equal(saved.includes('private-id'), false); assert.equal(saved.includes('/private/'), false);
  assert.equal(saved.includes('Private album'), false); assert.equal(saved.includes('test-only-key'), false);
  host.library.getTracks = async () => ({ items: [] });
  const next = await new DeepSeekResearch(host).lookup({ kind: 'contributor', name: ' composer ' }, { signal: signal() });
  assert.equal(calls.length, 2); assert.equal(next.works[0].track, null);
});
test('track background discards model works outside its mode instead of matching release variants to the same local song', async () => {
  const { client, reads } = fixture();
  const result = await client.lookup({ kind: 'track', name: 'Song' }, { signal: signal() });
  assert.equal(result.works.length, 0); assert.equal(reads.length, 0);
});
test('normalizes bounds and rejects unsupported relationships without inventing dates or URLs', () => {
  const result = normalizeResearch({ summary: 'Summary', items: [{ title: 'Unknown date', sourceIndex: 0 }],
    works: [{ title: 'No evidence', artist: 'Artist', relation: 'sample', sourceIndex: 5 },
      { title: 'Missing relation', artist: 'Artist', sourceIndex: 0 }],
    people: Array.from({ length: 20 }, () => ({ name: 'Composer', role: '作曲', sourceIndex: 0, url: 'file:///private' })),
  }, 1);
  assert.equal(result.items[0].date, null); assert.equal(result.works.length, 0); assert.equal(result.people.length, 8);
  assert.equal('url' in result.people[0], false);
});
test('aborting search prevents generation and local queries', async () => {
  const { client, host, calls, reads } = fixture(); const controller = new AbortController();
  host.network.request = async () => { controller.abort(); return modelResponse({ results: [source] }); };
  await assert.rejects(client.lookup({ kind: 'track', name: 'Song' }, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls.length, 0); assert.equal(reads.length, 0);
});
test('chat uses live music search and exposes only a user-selected song display context', async () => {
  const { host, calls } = fixture(); let completions = 0;
  const request = host.network.request;
  host.network.request = async options => {
    if (options.url.endsWith('/search')) return request(options);
    calls.push({ url: options.url, body: JSON.parse(options.body) });
    const message = completions++ === 0 ? { tool_calls: [{ id: 'web', type: 'function', function: { name: 'search_music', arguments: '{"query":"Song Artist interview"}' } }] } : { content: 'Background [1]' };
    return modelResponse({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] });
  };
  const result = await new DeepSeekChat(host).send('这首歌有什么背景？', { signal: signal(), trackContext: { title: 'Song', artist: 'Artist', album: 'Album', path: '/private/music', id: 'private-track' } });
  assert.equal(result.sources[0].publishedAt, '2026-10-20');
  assert.equal(JSON.stringify(calls).includes('/private/music'), false);
  assert.equal(JSON.stringify(calls).includes('private-track'), false);
  assert.equal(calls[0].body.messages.at(-1).content.includes('Song'), true);
});
