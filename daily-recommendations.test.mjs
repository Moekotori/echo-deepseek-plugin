import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DailyRecommendations } from './src/daily-recommendations.mjs';
import { startDailyRuntime } from './src/daily-runtime.mjs';
import { MusicProfile } from './src/music-profile.mjs';

function fixture() {
  const data = new Map(); const agents = new Map();
  const host = { storage: { get: async key => structuredClone(data.get(key) ?? null), set: async (key, value) => data.set(key, structuredClone(value)), remove: async key => data.delete(key) },
    agents: { register: (id, _meta, handler) => agents.set(id, handler) } };
  return { data, host, agents };
}
const recommendations = [{ title: 'Song', artist: 'Artist', reason: '符合你明确表达的爵士偏好。', track: { id: 'private-id', path: '/private/music', album: 'Private album' } }];
test('a single producer merges concurrent requests and a reopened session reuses the same-day result without paid generation', async () => {
  const { host, data } = fixture(); await new MusicProfile(host).settings({ shareLibrary: true });
  let generations = 0; let day = '2026-10-21'; const inputs = [];
  const createChat = () => ({ send: async (prompt, options) => { generations++; inputs.push({ prompt, options }); return { reply: '每日推荐', recommendations }; } });
  const service = new DailyRecommendations(host, { createChat, today: () => day });
  service.start(); service.start(); await service.job; assert.equal(generations, 1);
  const reopened = new DailyRecommendations(host, { createChat, today: () => day }); reopened.start(); await reopened.job;
  assert.equal(generations, 1); assert.equal((await reopened.status()).result.items.length, 1);
  const saved = JSON.stringify(data.get('daily-recommendations-v1'));
  for (const value of ['private-id', '/private/music', 'Private album']) assert.equal(saved.includes(value), false);
  day = '2026-10-22'; reopened.start(); await reopened.job; assert.equal(generations, 2);
  assert.match(inputs[1].prompt, /上次推荐/); assert.equal(inputs[1].options.recommendationsOnly, true);
});
test('clearing after an in-flight cache write retires it first so forgotten recommendation data cannot reappear', async () => {
  const { host, data } = fixture(); await new MusicProfile(host).settings({ shareLibrary: true });
  let release; let writing;
  const reached = new Promise(resolve => { writing = resolve; }); const original = host.storage.set;
  host.storage.set = async (key, value) => { if (key === 'daily-recommendations-v1') { writing(); await new Promise(resolve => { release = resolve; }); } return original(key, value); };
  const service = new DailyRecommendations(host, { createChat: () => ({ send: async () => ({ reply: 'Ready', recommendations }) }) });
  service.start(); await reached; service.invalidate(); release(); await service.clearing;
  assert.equal(data.has('daily-recommendations-v1'), false); assert.equal(service.state.phase, 'idle');
});
test('no sharing permission means no generation; failures are visible and are never cached as today’s result', async () => {
  const { host, data } = fixture(); let generations = 0;
  const service = new DailyRecommendations(host, { createChat: () => ({ send: async () => { generations++; throw new Error('provider unavailable'); } }) });
  service.start(); await service.job; assert.equal(generations, 0); assert.equal(service.state.phase, 'error');
  await new MusicProfile(host).settings({ shareLibrary: true }); service.start(); await service.job;
  assert.equal(generations, 1); assert.equal(service.state.message, 'provider unavailable'); assert.equal(data.has('daily-recommendations-v1'), false);
});
test('automatic daily work owns only one local-midnight timer and stops when disabled or disposed', async () => {
  const { host, agents } = fixture(); const profile = new MusicProfile(host);
  await profile.settings({ shareLibrary: true, dailyEnabled: true });
  const timers = new Map(); let next = 0; let starts = 0; let cancels = 0;
  const service = { state: { phase: 'idle' }, start() { starts++; return this.state; }, cancel() { cancels++; }, async dispose() { this.cancel(); } };
  const runtime = startDailyRuntime(host, { service, now: () => new Date(2026, 9, 21, 23, 0, 0), schedule: (callback, ms) => { timers.set(++next, { callback, ms }); return next; }, unschedule: id => timers.delete(id) });
  await runtime.ready; assert.equal(starts, 1); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, 3600000);
  await agents.get('daily-recommendations')({ action: 'configure' }); assert.equal(timers.size, 1); assert.equal(starts, 1);
  await profile.settings({ shareLibrary: false }); await agents.get('daily-recommendations')({ action: 'configure' });
  assert.equal(timers.size, 0); assert.ok(cancels > 0); await runtime.dispose();
});

test('a late startup settings read cannot re-enable generation after a newer disable command', async () => {
  const { host, agents } = fixture(); let finishStartup; let reads = 0; let starts = 0;
  host.storage.get = async () => ++reads === 1 ? new Promise(resolve => { finishStartup = resolve; })
    : { version: 1, shareLibrary: false, rememberEnabled: true, dailyEnabled: false, memories: [] };
  const timers = new Set(); const service = { state: { phase: 'idle' }, start() { starts++; }, cancel() {}, async dispose() {} };
  const runtime = startDailyRuntime(host, { service, schedule: () => { timers.add(1); return 1; }, unschedule: id => timers.delete(id) });
  await agents.get('daily-recommendations')({ action: 'configure' });
  finishStartup({ version: 1, shareLibrary: true, rememberEnabled: true, dailyEnabled: true, memories: [] }); await runtime.ready;
  assert.equal(starts, 0); assert.equal(timers.size, 0); await runtime.dispose();
});
