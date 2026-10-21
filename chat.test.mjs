import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekChat } from './src/chat.mjs';
import { preparePlaylist, savePlaylist } from './src/playlist.mjs';

export const track = { id: 'private-local-id', title: 'Snow halation', artist: "μ's", album: 'Private album name',
  path: '/private/music.mp3', coverUrl: 'private-cover', unavailable: false };
export const proposal = { name: '雪色歌单', tracks: [{ title: track.title, artist: track.artist }] };
const call = (name, input) => ({ type: 'function', id: 'call1', function: { name, arguments: JSON.stringify(input) } });
export function fixture(replies = [ { tool_calls: [call('propose_playlist', proposal)] }, { content: '请预览后创建。' } ]) {
  const posts = []; const writes = []; const reads = [];
  const host = { storage: { isSecure: async () => true, get: async () => 'test-only-key' }, network: {
    cancel: async () => {}, request: async options => {
      posts.push(JSON.parse(options.body)); const reply = replies.shift();
      assert.ok(reply, 'unexpected extra API call');
      return { ok: true, body: JSON.stringify({ choices: [{ finish_reason: reply.tool_calls ? 'tool_calls' : 'stop', message: reply }] }) };
    },
  }, library: {
    getTracks: async query => { reads.push(query); return { items: [track] }; },
    createPlaylist: async input => { writes.push(['create', input]); return { id: 'playlist' }; },
    addTracksToPlaylist: async (id, ids) => { writes.push(['add', id, ids]); return []; },
  } };
  return { host, posts, writes, reads, client: new DeepSeekChat(host) };
}
const options = () => ({ signal: new AbortController().signal });

test('private mode matches locally, never transmits library results, and saves only after explicit action', async () => {
  const { client, posts, writes, reads, host } = fixture();
  const result = await client.send('请创建雪色歌单', options());
  assert.equal(writes.length, 0);
  assert.equal(reads.length, 1);
  assert.equal(result.draft.tracks[0].id, track.id);
  const remote = JSON.stringify(posts);
  for (const privateValue of [track.id, track.path, track.album, track.coverUrl]) assert.equal(remote.includes(privateValue), false);
  assert.deepEqual(posts[0].tools.map(tool => tool.function.name), ['search_music', 'propose_playlist']);
  await savePlaylist(host, result.draft, [track.id, 'fabricated-id']);
  assert.deepEqual(writes, [['create', { name: proposal.name, description: '' }], ['add', 'playlist', [track.id]]]);
  await assert.rejects(savePlaylist(host, result.draft, [track.id]), /已创建/);
});

test('opted-in library tools share only display metadata and resolve ephemeral references', async () => {
  const { client, posts, writes } = fixture([
    { tool_calls: [call('search_library', { search: "μ's" })] },
    { tool_calls: [call('propose_playlist', { name: '成员精选', tracks: [{ ref: 'r1' }] })] },
    { content: '选曲已准备好。' },
  ]);
  const result = await client.send('从曲库选一首', { ...options(), shareLibrary: true });
  assert.deepEqual(JSON.parse(posts[1].messages.at(-1).content).items, [{ ref: 'r1', title: track.title, artist: track.artist, album: track.album, genre: null }]);
  assert.equal(JSON.stringify(posts).includes(track.id), false);
  assert.equal(JSON.stringify(posts).includes(track.path), false);
  assert.equal(result.draft.tracks.length, 1);
  assert.equal(writes.length, 0);
});

test('rejects unauthorized searches and unknown song references without writing', async () => {
  const { client, writes, reads } = fixture([{ tool_calls: [call('search_library', { search: '' })] }]);
  await assert.rejects(client.send('选曲', options()), /尚未允许/);
  assert.equal(reads.length, 0); assert.equal(writes.length, 0);
  await assert.rejects(preparePlaylist({}, { name: 'Bad', tracks: [{ ref: 'forged' }] }, new Map(), options().signal), /引用已失效/);
});

test('unmatched titles remain visible and cannot create empty playlists', async () => {
  const { host, writes } = fixture();
  const draft = await preparePlaylist(host, { name: 'Missing', tracks: [{ title: 'Other', artist: 'Other' }] }, new Map(), options().signal);
  assert.equal(draft.missing.length, 1); assert.equal(draft.tracks.length, 0);
  await assert.rejects(savePlaylist(host, draft, []), /选择歌曲/);
  assert.equal(writes.length, 0);
});

test('preserves the draft for follow-up instructions while bounding history and clearing it on reset', async () => {
  const { client, posts, host } = fixture();
  await client.send('准备一张歌单', options());
  host.network.request = async request => {
    posts.push(JSON.parse(request.body));
    return { ok: true, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '好的。' } }] }) };
  };
  for (let i = 0; i < 12; i++) await client.send('继续 ' + i, options());
  assert.equal(client.turns.length, 8);
  assert.equal(JSON.stringify(posts.at(-1)).includes(proposal.name), true);
  assert.equal(JSON.stringify(posts.at(-1)).includes(track.id), false);
  assert.equal(posts[0].messages[0].content, posts.at(-1).messages[0].content);
  client.clear(); assert.equal(client.turns.length, 0); assert.equal(client.proposal, null);
});

test('keeps completed plain conversation prefixes identical when the selected track changes', async () => {
  const { client, posts } = fixture([{ content: 'First answer' }, { content: 'Second answer' }]);
  await client.send('解释这首', { ...options(), trackContext: { title: 'First song', artist: 'Artist', album: 'Album' } });
  await client.send('再解释另一首', { ...options(), trackContext: { title: 'Next song', artist: 'Artist', album: 'Album' } });
  assert.deepEqual(posts[1].messages.slice(0, 2), posts[0].messages);
  assert.deepEqual(posts[1].messages[2], { role: 'assistant', content: 'First answer' });
  assert.ok(posts[1].messages.at(-1).content.includes('Next song'));
});

test('cancelled library reads cannot send results or produce a draft', async () => {
  const { client, host, posts } = fixture([{ tool_calls: [call('search_library', { search: '' })] }]);
  const controller = new AbortController();
  host.library.getTracks = async () => { controller.abort(); return { items: [track] }; };
  await assert.rejects(client.send('选曲', { signal: controller.signal, shareLibrary: true }), error => error.name === 'AbortError');
  assert.equal(posts.length, 1); assert.equal(client.turns.length, 0);
});

test('manual retry after adding fails reuses its created playlist', async () => {
  const { host, writes } = fixture();
  const draft = await preparePlaylist(host, proposal, new Map(), options().signal);
  host.library.addTracksToPlaylist = async () => { throw new Error('write failed'); };
  await assert.rejects(savePlaylist(host, draft, [track.id]), /write failed/);
  assert.equal(draft.playlistId, 'playlist'); assert.equal(draft.saved, false);
  host.library.addTracksToPlaylist = async () => [];
  await savePlaylist(host, draft, [track.id]);
  assert.equal(writes.filter(([action]) => action === 'create').length, 1);
});
