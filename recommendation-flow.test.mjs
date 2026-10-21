import { modelResponse } from './test-support.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DeepSeekChat } from './src/chat.mjs';
import { MusicProfile } from './src/music-profile.mjs';
import { mountChat } from './src/chat-panel.js';
import { mountPersonalization } from './src/personalization-panel.js';
import { startDailyRuntime } from './src/daily-runtime.mjs';
import { DailyRecommendations } from './src/daily-recommendations.mjs';
import { mountResearch } from './src/research-panel.js';

let dom; const runtimes = [];
beforeEach(() => {
  dom = new JSDOM(readFileSync(new URL('./src/panel.html', import.meta.url), 'utf8'));
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.CustomEvent = dom.window.CustomEvent;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(async () => {
  window.dispatchEvent(new window.Event('pagehide'));
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  dom.window.close(); delete globalThis.window; delete globalThis.document;
});
const byId = id => document.getElementById(id);
const until = async predicate => {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('UI did not reach the expected state: ' + byId('chat-status').textContent + ' ' + byId('personal-status').textContent);
};
const call = (name, input) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(input) } });
const tracks = [0, 1].map(i => ({ id: 'private-id-' + i, mediaType: 'local', title: 'Song ' + i, artist: 'Artist', album: 'Jazz Album',
  genre: 'Jazz', durationSeconds: 180, unavailable: false, path: '/private/music' }));
function fixture(replies = []) {
  const data = new Map(); const agents = new Map(); const posts = []; const plays = []; const timers = new Map(); let timerId = 0;
  const host = {
    storage: { isSecure: async () => true, get: async key => key === 'api-key' ? 'fixture' : structuredClone(data.get(key) ?? null),
      set: async (key, value) => data.set(key, structuredClone(value)), remove: async key => data.delete(key) },
    agents: { register: (id, _meta, handler) => agents.set(id, handler), run: async (id, input) => agents.get(id)(input) },
    queue: { playTrack: async (id, ids) => { plays.push({ id, ids }); } },
    playback: { getStatus: async () => ({ currentTrackId: 'authoritative-current' }) },
    library: { getTrack: async () => ({ ...tracks[0], title: 'Actual Current' }), getTracks: async query => ({ page: query.page, pageSize: query.pageSize, total: 2, hasMore: false,
      items: query.search.startsWith('Song') ? tracks.filter(track => track.title === query.search) : tracks }) },
    network: { cancel: async () => {}, request: async request => {
      const input = JSON.parse(request.body); posts.push(input);
      if (request.url.endsWith('/search')) return modelResponse({ results: [{ title: 'Composer credits', url: 'https://example.org/credits', summary: 'Verified composer credit' }] });
      const message = replies.shift(); assert.ok(message, 'unexpected model call');
      return modelResponse({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] });
    } },
  };
  const profile = new MusicProfile(host);
  const start = service => {
    const runtime = startDailyRuntime(host, { service, schedule: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, unschedule: id => timers.delete(id) });
    runtimes.push(runtime); return runtime;
  };
  return { host, profile, data, posts, plays, replies, start, timers };
}
async function mount(value, service) {
  const runtime = value.start(service); await runtime.ready;
  const chat = mountChat(value.host, { profile: value.profile });
  chat.connectResearch({ setExternalBusy() {}, getContext: () => null, showChatSources: async () => {} });
  const personal = mountPersonalization(value.host, value.profile, chat); chat.connectPersonalization(personal);
  await personal.ready; chat.setConfigured(true); personal.setConfigured(true);
  return { chat, personal };
}
function send(text) { byId('prompt').value = text; byId('prompt').dispatchEvent(new window.Event('input')); byId('send-message').click(); }

test('chat remembers an explicit taste, renders reasons, plays real local identities and carries a selected song into a sourced follow-up', async () => {
  const value = fixture([
    { tool_calls: [call('remember_music_preference', { kind: 'genre', value: '爵士', preference: 'like', evidence: '我喜欢爵士' }), call('search_library', { search: 'Jazz' })] },
    { tool_calls: [call('recommend_tracks', { tracks: [{ ref: 'r1', reason: '这首的爵士标签符合你明确表达的偏好。' }, { ref: 'r2', reason: '同为爵士曲风，可以对照聆听。' }] })] },
    { content: '已记住爵士偏好，下面两首可以直接播放。' },
    { tool_calls: [call('search_music', { query: 'Song 0 Artist composer credits' })] },
    { content: '根据署名资料介绍这首歌曲 [1]。' }, { content: '记得你喜欢爵士。' },
  ]);
  await value.profile.settings({ shareLibrary: true }); const { chat } = await mount(value);
  send('我喜欢爵士，推荐两首音乐'); await until(() => !chat.isBusy() && document.querySelectorAll('.recommendation-list > li').length === 2);
  assert.match(document.querySelector('.recommendation-list').textContent, /符合你明确表达的偏好/);
  assert.equal((await new MusicProfile(value.host).load()).memories[0].value, '爵士');
  document.querySelector('.recommendation-list [data-play]').click(); await until(() => value.plays.length === 1 && !byId('chat-track-context').hidden);
  assert.deepEqual(value.plays, [{ id: 'private-id-0', ids: ['private-id-0', 'private-id-1'] }]);
  assert.match(byId('chat-track-label').textContent, /Song 0/);
  send('这首歌是谁作曲的？'); await until(() => !chat.isBusy() && value.replies.length === 1);
  const follow = value.posts.find(post => post.messages?.at(-1)?.role === 'user' && post.messages.at(-1).content.includes('这首歌是谁作曲'));
  assert.match(follow.messages.at(-1).content, /Song 0/);
  const reopened = new DeepSeekChat(value.host, { profile: new MusicProfile(value.host) });
  await reopened.send('还记得我的偏好吗', { signal: new AbortController().signal });
  assert.match(value.posts.at(-1).messages.at(-1).content, /爵士/);
  for (const secret of ['private-id-', '/private/music']) assert.equal(JSON.stringify(value.posts).includes(secret), false);
  const research = mountResearch(value.host, { onDraft: chat.preview, onBusy: chat.setExternalBusy, isBusy: chat.isBusy, onTrackSelected: chat.selectRecommendation });
  research.setConfigured(true); byId('use-current-track').click(); await until(() => byId('chat-track-label').textContent.includes('Actual Current'));
  document.querySelector('#music-memories button').click(); await until(() => !byId('remember-music').disabled && !byId('music-memories').children.length);
  assert.deepEqual((await new MusicProfile(value.host).load()).memories, []);
  assert.equal(byId('transcript').children.length, 0);
});

test('daily panel reuses today’s result, supports playback and stops automatic generation when sharing is switched off', async () => {
  const value = fixture(); await value.profile.settings({ shareLibrary: true }); let generated = 0;
  const service = new DailyRecommendations(value.host, { createChat: () => ({ send: async () => {
    generated++; return { reply: '今日爵士推荐', recommendations: tracks.map(track => ({ title: track.title, artist: track.artist, reason: '按曲库中的爵士标签推荐。', track })) };
  } }) });
  await mount(value, service);
  byId('show-daily').click(); await until(() => !byId('show-daily').disabled && !byId('daily-results').hidden);
  assert.equal(generated, 1); assert.equal(document.querySelectorAll('#daily-results .recommendation-list > li').length, 2);
  document.querySelector('#daily-results [data-play]').click(); await until(() => value.plays.length === 1);
  byId('show-daily').click(); await until(() => !byId('show-daily').disabled); assert.equal(generated, 1);
  byId('automatic-daily').click(); await until(() => !byId('automatic-daily').disabled && value.timers.size === 1);
  assert.equal((await new MusicProfile(value.host).load()).dailyEnabled, true);
  byId('share-library').click(); await until(() => !byId('automatic-daily').disabled && value.timers.size === 0);
  assert.equal((await new MusicProfile(value.host).load()).dailyEnabled, false);
});
