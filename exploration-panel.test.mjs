import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountResearch } from './src/research-panel.js';
import { mountChat } from './src/chat-panel.js';

let dom;
beforeEach(() => {
  dom = new JSDOM(readFileSync(new URL('./src/panel.html', import.meta.url), 'utf8'));
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.CustomEvent = dom.window.CustomEvent;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); delete globalThis.window; delete globalThis.document; });
const waitFor = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('UI action did not finish');
};
const track = { id: 'local', mediaType: 'local', title: 'Other Song', artist: 'Artist', album: 'Album', durationSeconds: 240, unavailable: false };
function hostFixture() {
  const stored = new Map(); const published = []; const drafts = []; let paid = 0;
  const host = { storage: { isSecure: async () => true, get: async key => key === 'api-key' ? 'fixture' : stored.get(key) ?? null, set: async (key, value) => stored.set(key, structuredClone(value)) },
    ui: { setPanelPresentation: async value => { published.push(value); } }, playback: { getStatus: async () => ({ currentTrackId: 'seed' }) },
    library: { getTrack: async () => ({ ...track, title: 'Seed' }), getTracks: async () => ({ items: [track] }) },
    network: { cancel: async () => {}, request: async options => {
      paid++; const input = JSON.parse(options.body); let value;
      if (options.url.endsWith('/search')) value = { results: [{ title: 'Credits', url: input.query.includes('site:bilibili') ? 'https://www.bilibili.com/video/BV1234567' : 'https://example.org/credits', summary: 'Credits' }] };
      else { const request = JSON.parse(input.messages.at(-1).content); value = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Verified background', items: [],
        people: request.kind === 'track' ? [{ name: 'Composer', role: '作曲', sourceIndex: 0 }] : [],
        works: request.kind === 'contributor' ? [{ title: track.title, artist: track.artist, relation: '作曲', sourceIndex: 0 }] : [] }) } }] }; }
      return { ok: true, body: JSON.stringify(value) };
    } } };
  return { host, published, drafts, paid: () => paid };
}

test('current-song exploration displays local works, prepares a draft and can continue into another song', async () => {
  const { host, published, drafts, paid } = hostFixture(); let busy = false;
  const panel = mountResearch(host, { onDraft: value => drafts.push(value), onBusy: value => { busy = value; }, isBusy: () => false });
  panel.setConfigured(true); document.getElementById('use-current-track').click();
  await waitFor(() => document.getElementById('research-subject').value === 'Seed — Artist');
  document.querySelector('[data-research="explore"]').click(); await waitFor(() => !busy && document.querySelector('.research-works'));
  assert.match(document.getElementById('research-results').textContent, /曲库已匹配/);
  assert.ok(published.at(-1).sourceLinks.some(source => source.url.includes('bilibili')));
  const prepare = [...document.querySelectorAll('#research-results button')].find(button => button.textContent === '用匹配作品准备歌单');
  prepare.click(); assert.equal(drafts[0].tracks[0].id, 'local'); assert.equal(drafts[0].saved, false);
  const before = paid(); await panel.run({ kind: 'explore' }); assert.equal(paid(), before);
  document.querySelector('.research-works button').click(); await waitFor(() => !busy && document.querySelector('.research-heading h2').textContent === 'Other Song — Artist');
  assert.equal(panel.getContext(), null); assert.equal(document.getElementById('research-context').textContent, '');
});

test('composer submits natural language and shows a bounded-duration draft before any save action', async () => {
  const { host } = hostFixture(); const queries = []; let writes = 0;
  host.library.playlists = { previewRules: async input => { queries.push(input); return { items: Array.from({ length: 8 }, (_, i) => ({ ...track, id: 'local-' + i })) }; } };
  host.library.createPlaylist = async () => { writes++; return { id: 'created' }; };
  const tool = (name, input) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(input) } });
  const replies = [{ tool_calls: [tool('query_library', { instrumental: true })] },
    { tool_calls: [tool('propose_playlist', { name: '半小时纯音乐', durationMinutes: 30, tracks: Array.from({ length: 8 }, (_, i) => ({ ref: 'r' + (i + 1) })) })] }, { content: '已准备预览' }];
  host.network.request = async () => { const message = replies.shift(); return { ok: true, body: JSON.stringify({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] }) }; };
  const chat = mountChat(host); chat.connectResearch({ setExternalBusy() {}, getContext: () => null }); chat.setConfigured(true);
  document.getElementById('share-library').checked = true; document.getElementById('prompt').value = '来半小时纯音乐';
  document.getElementById('prompt').dispatchEvent(new window.Event('input'));
  document.getElementById('send-message').click(); await waitFor(() => !chat.isBusy());
  assert.equal(document.getElementById('playlist-preview').hidden, false);
  assert.equal(document.querySelectorAll('#playlist-tracks li').length, 7);
  assert.match(document.getElementById('playlist-count').textContent, /28:00/);
  assert.equal(queries.length, 1); assert.equal(writes, 0); assert.equal(document.getElementById('create-playlist').disabled, false);
});
