import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryLibrary } from './src/library-query.mjs';
import { DeepSeekChat } from './src/chat.mjs';

const signal = () => new AbortController().signal;
const track = { id: 'private-id', mediaType: 'local', title: 'Song', artist: 'Artist', album: 'Album', genre: 'Electronic', year: 2025,
  durationSeconds: 240, unavailable: false, path: '/private/song', coverUrl: 'private-cover' };
const call = (name, input) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(input) } });

test('structured criteria reach the database as AND conditions with OR genres, without scanning pages', async () => {
  let request;
  const host = { library: { playlists: { previewRules: async input => { request = input; return { items: [track, { ...track, mediaType: 'remote' }, { ...track, unavailable: true }] }; } } } };
  assert.deepEqual(await queryLibrary(host, { genres: ['Electronic', 'Techno'], artist: 'Artist', bpmMin: 120, bpmMax: 160, instrumental: true, durationMax: 300 }, signal()), [track]);
  assert.equal(request.rules.limit, 8); assert.equal(request.rules.condition.match, 'all');
  assert.deepEqual(request.rules.condition.children.find(rule => rule.type === 'group').children.map(rule => rule.value), ['Electronic', 'Techno']);
  assert.ok(request.rules.condition.children.some(rule => rule.field === 'bpm' && rule.operator === 'atLeast' && rule.value === 120));
  assert.ok(request.rules.condition.children.some(rule => rule.field === 'duration' && rule.value === 300));
  assert.ok(request.rules.condition.children.some(rule => rule.field === 'instrumental' && rule.value === true));
});

test('invalid ranges, counts and cancellation never become reads; playback deferral is not an empty success', async () => {
  let reads = 0; const controller = new AbortController(); controller.abort();
  const host = { library: { playlists: { previewRules: async () => { reads++; return { items: [], deferredForPlayback: true }; } } } };
  for (const input of [{ bpmMin: 150, bpmMax: 100 }, { limit: 100 }, { instrumental: 'true' }, { genres: [''] }, { yearMin: NaN }]) {
    await assert.rejects(queryLibrary(host, input, signal()));
  }
  await assert.rejects(queryLibrary(host, {}, controller.signal), { name: 'AbortError' }); assert.equal(reads, 0);
  await assert.rejects(queryLibrary(host, {}, signal()), /播放保护/);
});

test('natural-language chat queries structured candidates, makes a duration-bounded preview, and transmits no identities', async () => {
  const posts = []; const queries = []; let reads = 0;
  const replies = [ { tool_calls: [call('query_library', { instrumental: true, genres: ['Electronic'], bpmMin: 100 })] },
    { tool_calls: [call('propose_playlist', { name: '半小时', durationMinutes: 30, tracks: Array.from({ length: 8 }, (_, i) => ({ ref: 'r' + (i + 1) })) })] }, { content: '已准备28分钟预览。' } ];
  const host = { storage: { isSecure: async () => true, get: async () => 'fixture' }, network: { cancel: async () => {}, request: async request => {
    posts.push(JSON.parse(request.body)); const message = replies.shift();
    return { ok: true, body: JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }) };
  } }, library: { playlists: { previewRules: async input => { queries.push(input); return { items: Array.from({ length: 8 }, (_, i) => ({ ...track, id: 'private-' + i })) }; } },
    getTracks: async () => { reads++; throw new Error('unexpected scan'); } } };
  const result = await new DeepSeekChat(host).send('来半小时电子纯音乐，BPM至少100', { signal: signal(), shareLibrary: true });
  assert.equal(queries.length, 1); assert.equal(reads, 0); assert.equal(result.draft.tracks.length, 7);
  const candidates = JSON.parse(posts[1].messages.at(-1).content);
  assert.equal(candidates[0].durationSeconds, 240); assert.equal(candidates[0].genre, 'Electronic');
  assert.equal(JSON.parse(posts[2].messages.at(-1).content).durationSeconds, 1680);
  for (const secret of [track.path, track.coverUrl, 'private-0']) assert.equal(JSON.stringify(posts).includes(secret), false);
  assert.equal(posts[0].tools.some(tool => tool.function.name === 'query_library'), true);
  assert.equal(result.draft.saved, false);
});

test('structured tool cannot query before library sharing is enabled', async () => {
  let reads = 0;
  const host = { storage: { isSecure: async () => true, get: async () => 'fixture' },
    network: { cancel: async () => {}, request: async () => ({ ok: true, body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [call('query_library', {})] } }] }) }) },
    library: { playlists: { previewRules: async () => { reads++; } } } };
  await assert.rejects(new DeepSeekChat(host).send('找曲', { signal: signal() }), /尚未允许/); assert.equal(reads, 0);
});
