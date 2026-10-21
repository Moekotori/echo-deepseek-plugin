import { modelResponse } from './test-support.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekChat } from './src/chat.mjs';
import { completeModel } from './src/model-providers.mjs';
import { readModelConnection } from './src/model-settings.mjs';
import { saveModelProfile } from './src/model-validation.mjs';
import { DeepSeekResearch } from './src/research.mjs';

function fixture(provider = 'openai') {
  const profile = { provider, baseUrl: provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1', model: 'configured-model' };
  const stored = new Map([['model-provider', provider], ['model-profile-' + provider, profile],
    [provider + '-api-key', JSON.stringify({ key: 'fixture-' + provider, baseUrl: profile.baseUrl })], ['api-key', 'deepseek-fixture']]);
  const requests = []; const responses = [];
  const host = { storage: { isSecure: async () => true, get: async key => stored.get(key) ?? null,
    set: async (key, value) => stored.set(key, structuredClone(value)) },
    network: { cancel: async () => {}, request: async input => { requests.push(input); return responses.shift(); } },
    library: { getTracks: async () => ({ items: [] }) } };
  return { host, stored, profile, requests, responses };
}
const response = body => (modelResponse(body));
const completion = content => response({ choices: [{ finish_reason: 'stop', message: { content } }] });
const signal = () => new AbortController().signal;

test('OpenAI uses the chosen endpoint/model and tools without DeepSeek-only parameters or search', async () => {
  const f = fixture(); f.responses.push(completion('您好'));
  const result = await new DeepSeekChat(f.host).send('聊音乐', { signal: signal(), shareLibrary: true });
  const sent = f.requests[0]; const body = JSON.parse(sent.body);
  assert.equal(result.reply, '您好'); assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(sent.headers.Authorization, 'Bearer fixture-openai');
  assert.equal(body.model, 'configured-model'); assert.equal(body.max_completion_tokens, 1800);
  assert.equal(body.thinking, undefined); assert.equal(body.max_tokens, undefined);
  assert.equal(body.tools.some(tool => tool.function.name === 'search_music'), false);
  assert.ok(body.tools.some(tool => tool.function.name === 'query_library'));
  assert.match(body.messages[0].content, /未启用联网检索/);
});

test('Anthropic tools round-trip through actual chat orchestration and remain local until explicit playlist creation', async () => {
  const f = fixture('anthropic');
  f.responses.push(response({ stop_reason: 'tool_use', content: [
    { type: 'text', text: '准备预览' }, { type: 'tool_use', id: 'proposal-1', name: 'propose_playlist', input: { name: '歌单', description: '', tracks: [{ title: 'Song', artist: 'Artist' }] } },
  ] }), response({ stop_reason: 'end_turn', content: [{ type: 'text', text: '预览已准备' }] }));
  const result = await new DeepSeekChat(f.host).send('建歌单', { signal: signal() });
  assert.equal(result.reply, '预览已准备'); assert.equal(result.draft.saved, false);
  const [first, second] = f.requests.map(request => JSON.parse(request.body));
  assert.equal(f.requests[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.requests[0].headers['x-api-key'], 'fixture-anthropic');
  assert.equal(f.requests[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(f.requests[0].headers.Authorization, undefined);
  assert.equal(first.messages.some(message => message.role === 'system'), false);
  assert.match(first.system[0].text, /Anthropic/); assert.ok(first.tools[0].input_schema);
  assert.equal(second.messages.at(-2).content[1].type, 'tool_use');
  const returned = second.messages.at(-1).content[0];
  assert.equal(returned.type, 'tool_result'); assert.equal(returned.tool_use_id, 'proposal-1');
  assert.equal(returned.content, '{"previewReady":true}');
});

test('parallel tool results merge into one Anthropic user message; truncation is not treated as completion', async () => {
  const f = fixture('anthropic');
  f.responses.push(response({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '截断' }] }));
  const result = await completeModel(f.host, await readModelConnection(f.host), { max_tokens: 100,
    messages: [{ role: 'system', content: 'System' }, { role: 'user', content: 'Question' },
      { role: 'assistant', content: null, tool_calls: ['a', 'b'].map(id => ({ id, function: { name: 'query_library', arguments: '{}' } })) },
      ...['a', 'b'].map(id => ({ role: 'tool', tool_call_id: id, content: '{}' }))] }, signal());
  assert.equal(result.choices[0].finish_reason, 'length');
  assert.equal(JSON.parse(f.requests[0].body).messages.at(-1).content.length, 2);
});

test('saving a custom endpoint obtains consent before a key-bearing request and stores a destination-bound secret', async () => {
  const f = fixture();
  f.responses.push({ ok: true, status: 204, body: '' }, response({ data: [{ id: 'new-model' }] }));
  const next = { provider: 'openai', baseUrl: 'https://custom.example/api/v1', model: 'new-model' };
  await saveModelProfile(f.host, next, 'new-fixture', signal());
  assert.equal(f.requests[0].approveHost, true); assert.equal(f.requests[0].headers, undefined);
  assert.equal(f.requests[1].headers.Authorization, 'Bearer new-fixture');
  assert.equal(f.stored.get('api-key'), 'deepseek-fixture');
  assert.equal(f.stored.get('model-profile-openai').key, undefined);
  assert.deepEqual(JSON.parse(f.stored.get('openai-api-key')), { key: 'new-fixture', baseUrl: next.baseUrl });
  assert.equal((await readModelConnection(f.host)).model, 'new-model');
});

test('changing the destination cannot reuse a saved key, including after partial settings persistence', async () => {
  const f = fixture(); const next = { ...f.profile, baseUrl: 'https://other.example/v1' };
  await assert.rejects(saveModelProfile(f.host, next, '', signal()), /重新填写/);
  assert.equal(f.requests.length, 0);
  f.stored.set('model-profile-openai', next);
  await assert.rejects(readModelConnection(f.host), /地址已更改/);
  assert.equal(f.requests.length, 0);
});

test('failed validation preserves the encrypted key and profile; non-DeepSeek research never makes a paid/search request', async () => {
  const f = fixture(); const saved = f.stored.get('openai-api-key');
  f.responses.push({ ok: false, status: 401, body: 'never display provider error body' });
  await assert.rejects(saveModelProfile(f.host, f.profile, 'bad-fixture', signal()), /无效/);
  assert.equal(f.stored.get('openai-api-key'), saved);
  const count = f.requests.length;
  await assert.rejects(new DeepSeekResearch(f.host).lookup({ kind: 'track', name: 'Song' }, { signal: signal() }), /DeepSeek/);
  assert.equal(f.requests.length, count);
});

test('host cancellation is forwarded and malformed provider data cannot expose a reflected credential', async () => {
  const f = fixture(); let finish; const cancellations = [];
  f.host.network.request = options => { f.requests.push(options); return new Promise(resolve => { finish = resolve; }); };
  f.host.network.cancel = async id => { cancellations.push(id); };
  const controller = new AbortController();
  const pending = new DeepSeekChat(f.host).send('消息', { signal: controller.signal });
  for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); finish(completion('answer'));
  await assert.rejects(pending, /abort/iu); assert.deepEqual(cancellations, [f.requests[0].requestId]);
  f.host.network.request = async () => ({ ok: true, body: 'fixture-secret-reflected' });
  await assert.rejects(new DeepSeekChat(f.host).send('消息', { signal: signal() }), { message: '模型服务返回格式无效' });
});

test('older hosts without secure model-key storage cannot read or persist model credentials', async () => {
  const f = fixture(); delete f.host.storage.isSecure;
  await assert.rejects(readModelConnection(f.host), /安全 Key 存储/);
  await assert.rejects(saveModelProfile(f.host, f.profile, 'new-fixture', signal()), /新版 ECHO/);
  assert.equal(f.requests.length, 0);
});
