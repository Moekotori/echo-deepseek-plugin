import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeModel } from './src/model-providers.mjs';
import { postDeepSeek } from './src/api.mjs';
import { workshopModelFetch } from './src/pi-fetch.mjs';
import { modelResponse } from './test-support.mjs';

const connection = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', key: 'fixture-key' };
const options = { max_tokens: 100, messages: [{ role: 'system', content: '固定前缀' }, { role: 'user', content: '音乐' }] };
const signal = () => new AbortController().signal;

test('Pi generation uses only the host bridge, preserves JSON mode and reports real cache tokens without invented costs', async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = () => { throw new Error('sandbox network bypass'); };
  const host = { network: { request: async input => {
    requests.push(input);
    return modelResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"title":"音乐"}' } }],
      usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 10, total_tokens: 110 } });
  }, cancel: async () => {} } };
  try {
    const result = await postDeepSeek(host, '/chat/completions', { ...options, model: connection.model, response_format: { type: 'json_object' } }, connection.key, signal());
    assert.equal(result.choices[0].message.content, '{"title":"音乐"}');
    assert.equal(result.usage.input, 20); assert.equal(result.usage.cacheRead, 80); assert.equal(result.usage.output, 10);
    assert.equal(result.usage.cost, undefined); assert.equal(requests.length, 1);
    const payload = JSON.parse(requests[0].body);
    assert.equal(payload.stream, true); assert.equal(payload.response_format.type, 'json_object');
    assert.equal(payload.messages[0].content, options.messages[0].content);
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.deepEqual(Object.keys(requests[0].headers).sort(), ['Accept', 'Authorization', 'Content-Type']);
  } finally { globalThis.fetch = originalFetch; }
});

test('HTTP errors retain their status for key handling, never expose provider text and never retry', async () => {
  for (const status of [401, 429, 500]) {
    let requests = 0;
    const host = { network: { request: async () => { requests++; return { ok: false, status, body: 'reflected-fixture-key' }; }, cancel: async () => {} } };
    await assert.rejects(completeModel(host, connection, options, signal()), error => error.status === status && !error.message.includes('fixture-key'));
    assert.equal(requests, 1);
  }
});

test('truncated or malformed SSE cannot become a successful reply or reveal raw SDK diagnostics', async () => {
  for (const body of ['data: {bad-json}\n\n', 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial' } }] }) + '\n\ndata: [DONE]\n\n']) {
    const host = { network: { request: async () => ({ ok: true, status: 200, body }), cancel: async () => {} } };
    await assert.rejects(completeModel(host, connection, options, signal()), { message: '模型服务返回格式无效' });
  }
});

test('SDK transport cannot redirect a configured key to another URL or forward SDK identity headers', async () => {
  const requests = []; const host = { network: { request: async input => { requests.push(input); return modelResponse({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }); }, cancel: async () => {} } };
  const transport = workshopModelFetch(host, connection, signal());
  await assert.rejects(transport.fetch('https://other.example/chat/completions', { method: 'POST', body: '{}' }), /超出/);
  assert.equal(requests.length, 0);
  const anthropic = { ...connection, provider: 'anthropic', baseUrl: 'https://custom.example/claude/v1' };
  await workshopModelFetch(host, anthropic, signal()).fetch(anthropic.baseUrl + '/v1/messages?beta=true',
    { method: 'POST', body: '{}', headers: { 'User-Agent': 'SDK identity', 'x-other-key': 'secret' } });
  assert.equal(requests[0].url, 'https://custom.example/claude/v1/messages');
  assert.deepEqual(requests[0].headers, { 'Content-Type': 'application/json', Accept: 'text/event-stream',
    'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01' });
});
