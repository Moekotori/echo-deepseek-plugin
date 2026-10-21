import { modelResponse } from './test-support.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekChat } from './src/chat.mjs';
import { savePlaylist } from './src/playlist.mjs';

const tool = (name, input) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(input) } });
const options = () => ({ signal: new AbortController().signal, shareLibrary: true });
test('whole-library recommendations use aggregate context, page past 8 candidates, and create the selected 50-track playlist', async () => {
  const posts = []; const queries = []; const writes = [];
  const tracks = Array.from({ length: 1205 }, (_, i) => ({ id: 'private-' + i, mediaType: 'local', title: 'Song ' + i,
    artist: 'Artist ' + i % 8, album: 'Album', genre: 'Electronic', year: 2025, durationSeconds: 180, unavailable: false, path: '/private/music' }));
  const messages = [
    { tool_calls: [tool('get_library_overview', {})] },
    { tool_calls: [tool('query_library', { genres: ['Electronic'], page: 1 })] },
    { tool_calls: [tool('query_library', { genres: ['Electronic'], page: 2 })] },
    { tool_calls: [tool('propose_playlist', { name: '曲库推荐', tracks: Array.from({ length: 50 }, (_, i) => ({ ref: 'r' + (i + 1) })) })] },
    { content: '已从曲库筛选并准备50首推荐歌单，请预览后创建。' }, { content: '还可以继续查下一页。' },
  ];
  const host = { storage: { isSecure: async () => true, get: async () => 'fixture' },
    network: { cancel: async () => {}, request: async request => {
      posts.push(JSON.parse(request.body)); const message = messages.shift();
      return modelResponse({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] });
    } }, library: {
      getSummary: async () => ({ trackCount: 1205, albumCount: 12, artistCount: 8, privatePath: '/private/db' }),
      getGenres: async () => ({ items: [{ id: 'private-genre', name: 'Electronic', trackCount: 1205 }], hasMore: false }),
      getArtists: async () => ({ items: [{ id: 'private-artist', name: 'Artist', trackCount: 150 }], hasMore: true }),
      searchTracks: async (input, query) => { queries.push({ input, query }); const offset = (query.page - 1) * query.pageSize;
        return { ...query, total: 1205, hasMore: true, items: tracks.slice(offset, offset + query.pageSize) }; },
      createPlaylist: async input => { writes.push(['create', input]); return { id: 'created' }; },
      addTracksToPlaylist: async (id, ids) => { writes.push(['add', id, ids]); },
    } };
  const chat = new DeepSeekChat(host); const result = await chat.send('基于我的整个曲库推荐一份50首歌单', options());
  assert.deepEqual(queries.map(value => value.query), [{ page: 1, pageSize: 40 }, { page: 2, pageSize: 40 }]);
  assert.equal(result.draft.tracks.length, 50); assert.equal(result.draft.tracks.at(-1).id, 'private-49');
  assert.equal(JSON.parse(posts[1].messages.at(-1).content).trackCount, 1205);
  assert.equal(JSON.parse(posts[2].messages.at(-1).content).hasMore, true);
  assert.equal(writes.length, 0);
  for (const secret of ['/private/', 'private-0', 'private-genre', 'private-artist']) assert.equal(JSON.stringify(posts).includes(secret), false);
  await savePlaylist(host, result.draft, result.draft.tracks.map(track => track.id));
  assert.equal(writes[1][2].length, 50); assert.equal(result.draft.saved, true);
  await chat.send('继续下一页', options());
  assert.match(posts.at(-1).messages.at(-1).content, /上次曲库查询/);
  chat.clear(); assert.equal(chat.libraryQuery, null);
});

test('overview and paged search do not access any library data before sharing is enabled', async () => {
  for (const name of ['get_library_overview', 'query_library', 'search_library']) {
    let reads = 0;
    const host = { storage: { isSecure: async () => true, get: async () => 'fixture' },
      network: { cancel: async () => {}, request: async () => (modelResponse({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [tool(name, { search: '' })] } }] })) },
      library: { getSummary: async () => { reads++; }, getTracks: async () => { reads++; }, searchTracks: async () => { reads++; } } };
    await assert.rejects(new DeepSeekChat(host).send('推荐', { ...options(), shareLibrary: false }), /尚未允许/);
    assert.equal(reads, 0);
  }
});
