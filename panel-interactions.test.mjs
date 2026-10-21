import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { mountChat } from './src/chat-panel.js';
import { mountResearch } from './src/research-panel.js';

let dom;
const byId = id => document.getElementById(id);
beforeEach(() => {
  dom = new JSDOM(readFileSync(new URL('./src/panel.html', import.meta.url), 'utf8'));
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.CustomEvent = dom.window.CustomEvent;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  window.dispatchEvent(new window.Event('pagehide')); dom.window.close();
  delete globalThis.window; delete globalThis.document; delete globalThis.CustomEvent;
});
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await setImmediate(); }
  assert.fail('Panel action did not finish');
}
function type(id, text) { byId(id).value = text; byId(id).dispatchEvent(new window.Event('input')); }
function enter(id, options = {}) {
  byId(id).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }));
}
function chatFixture() {
  let finish; const requests = [];
  const host = { storage: { isSecure: async () => true, get: async () => 'fixture' },
    network: { cancel: async () => {}, request: options => { requests.push(JSON.parse(options.body)); return new Promise(resolve => { finish = resolve; }); } } };
  const chat = mountChat(host);
  chat.connectResearch({ setExternalBusy() {}, getContext: () => null }); chat.setConfigured(true);
  return { chat, requests, finish: value => finish(value) };
}
const reply = { ok: true, status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '答复' } }] }) };

test('blank drafts cannot send; IME confirmation and Shift+Enter do not submit; Enter returns focus for the next draft', async () => {
  const fixture = chatFixture();
  assert.equal(byId('send-message').disabled, true);
  type('prompt', '   '); assert.equal(byId('send-message').disabled, true);
  type('prompt', '第一条'); enter('prompt', { isComposing: true }); enter('prompt', { shiftKey: true });
  assert.equal(fixture.chat.isBusy(), false);
  byId('send-message').focus(); byId('send-message').click();
  await until(() => fixture.requests.length === 1);
  assert.equal(document.activeElement, byId('prompt'));
  assert.equal(byId('transcript').getAttribute('aria-busy'), 'true');
  type('prompt', '下一条'); fixture.finish(reply); await until(() => !fixture.chat.isBusy());
  assert.equal(byId('prompt').value, '下一条'); assert.equal(byId('send-message').disabled, false);
  assert.equal(byId('transcript').getAttribute('aria-busy'), 'false');
});

test('failed or stopped submissions restore their exact draft without leaving duplicate user messages', async () => {
  for (const stopped of [false, true]) {
    const fixture = chatFixture();
    const original = '  保留换行\n和空格  ';
    type('prompt', original); enter('prompt'); await until(() => fixture.requests.length === 1);
    if (stopped) byId('stop-message').click();
    fixture.finish(stopped ? reply : { ok: false, status: 429, body: '{}' });
    await until(() => !fixture.chat.isBusy());
    assert.equal(byId('prompt').value, original); assert.equal(byId('send-message').disabled, false);
    assert.equal(byId('transcript').children.length, 0);
    assert.match(byId('chat-status').textContent, stopped ? /已停止/ : /频率受限/);
    fixture.chat.reset();
  }
});

test('failure cannot overwrite a next draft, including a draft the user deliberately erased', async () => {
  const fixture = chatFixture();
  type('prompt', '已发送'); enter('prompt'); await until(() => fixture.requests.length === 1);
  type('prompt', '下一条'); type('prompt', '');
  fixture.finish({ ok: false, status: 429, body: '{}' }); await until(() => !fixture.chat.isBusy());
  assert.equal(byId('prompt').value, '');
  assert.equal(byId('transcript').children.length, 1);
});

test('clearing history and changing library permission retain unsent drafts but clear model conversation history', async () => {
  const fixture = chatFixture();
  type('prompt', '上一轮'); enter('prompt'); await until(() => fixture.requests.length === 1);
  fixture.finish(reply); await until(() => !fixture.chat.isBusy());
  type('prompt', '未发送草稿'); byId('clear-chat').click();
  assert.equal(byId('prompt').value, '未发送草稿'); assert.equal(document.activeElement, byId('prompt'));
  byId('share-library').click();
  assert.equal(byId('prompt').value, '未发送草稿'); assert.equal(byId('transcript').children.length, 0);
  enter('prompt'); await until(() => fixture.requests.length === 2);
  assert.equal(fixture.requests[1].messages.length, 2);
  fixture.finish(reply); await until(() => !fixture.chat.isBusy());
});

test('research Enter uses the visible selected category and cannot submit twice while pending', async () => {
  const queries = []; let finish;
  const host = { storage: { isSecure: async () => true, get: async key => key === 'api-key' ? 'fixture' : null, set: async () => {} },
    ui: { setPanelPresentation: async () => {} }, network: { cancel: async () => {}, request: options => {
      const body = JSON.parse(options.body);
      if (options.url.endsWith('/search')) return Promise.resolve({ ok: true, body: JSON.stringify({ results: [{ title: 'Source', url: 'https://example.org/song', summary: 'Background' }] }) });
      queries.push(JSON.parse(body.messages.at(-1).content));
      return new Promise(resolve => { finish = resolve; });
    } } };
  let busy = false;
  const panel = mountResearch(host, { onDraft() {}, onBusy: value => { busy = value; }, isBusy: () => false }); panel.setConfigured(true);
  type('research-subject', 'Song'); enter('research-subject', { isComposing: true }); assert.equal(busy, false);
  enter('research-subject'); await until(() => queries.length === 1);
  enter('research-subject'); assert.equal(queries.length, 1); assert.equal(byId('research-subject').readOnly, true);
  const result = { ok: true, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Summary', items: [], people: [], works: [] }) } }] }) };
  finish(result); await until(() => !busy); assert.equal(queries[0].kind, 'track');
  document.querySelector('[data-research="relations"]').click(); await until(() => queries.length === 2);
  finish(result); await until(() => !busy);
  type('research-subject', 'Other Song'); enter('research-subject'); await until(() => queries.length === 3);
  assert.equal(queries[2].kind, 'relations'); assert.equal(queries[2].name, 'Other Song');
  finish(result); await until(() => !busy); assert.equal(byId('research-subject').readOnly, false);
});
