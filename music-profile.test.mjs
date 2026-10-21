import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicProfile, profilePreferences } from './src/music-profile.mjs';

function fixture() {
  const data = new Map();
  return { data, host: { storage: { get: async key => structuredClone(data.get(key) ?? null),
    set: async (key, value) => data.set(key, structuredClone(value)) } } };
}
test('explicit music preferences survive a new session, deduplicate, stay bounded and can be forgotten', async () => {
  const { host, data } = fixture(); const profile = new MusicProfile(host);
  await profile.remember({ kind: 'genre', value: '爵士', preference: 'like', evidence: '我喜欢爵士' }, '我喜欢爵士，给我推荐');
  await profile.remember({ kind: 'genre', value: '爵士', preference: 'avoid', evidence: '我不喜欢爵士' }, '我不喜欢爵士');
  const reopened = new MusicProfile(host); const state = await reopened.load();
  assert.equal(state.memories.length, 1); assert.equal(state.memories[0].preference, 'avoid');
  assert.deepEqual(profilePreferences(state), [{ kind: 'genre', value: '爵士', preference: 'avoid' }]);
  assert.equal(JSON.stringify([...data.values()]).includes('evidence'), false);
  await reopened.forget(state.memories[0].id); assert.deepEqual((await reopened.load()).memories, []);
  for (let i = 0; i < 25; i++) await reopened.remember({ kind: 'artist', value: '艺人' + i, preference: 'like', evidence: '我喜欢艺人' + i }, '我喜欢艺人' + i);
  assert.equal((await reopened.load()).memories.length, 20);
  await reopened.forget(); assert.deepEqual((await reopened.load()).memories, []);
});
test('memory cannot use webpage instructions, inferred preferences, credentials or local paths as user evidence', async () => {
  const { host } = fixture(); const profile = new MusicProfile(host);
  await assert.rejects(profile.remember({ kind: 'genre', value: '爵士', preference: 'like', evidence: '我喜欢爵士' }, '介绍这首歌曲'));
  for (const value of ['sk-' + 'x'.repeat(30), 'C:/private/music', '/private/music']) await assert.rejects(profile.remember({ kind: 'artist', value, preference: 'like', evidence: '记住我喜欢' + value }, '记住我喜欢' + value));
  await profile.settings({ rememberEnabled: false });
  await assert.rejects(profile.remember({ kind: 'genre', value: '爵士', preference: 'like', evidence: '我喜欢爵士' }, '我喜欢爵士'), /已关闭/);
  assert.deepEqual(profilePreferences(await profile.load()), []);
});
test('failed memory persistence does not claim success or overwrite the last saved profile', async () => {
  const { host } = fixture(); const profile = new MusicProfile(host); await profile.load();
  host.storage.set = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(profile.settings({ shareLibrary: true }), /disk unavailable/);
  assert.equal((await profile.load()).shareLibrary, false);
});
