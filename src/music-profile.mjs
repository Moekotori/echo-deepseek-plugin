const key = 'music-profile-v1';
const kinds = ['genre', 'artist', 'mood', 'listening'];
const normalize = value => value.normalize('NFC').trim().toLowerCase();
const defaults = () => ({ version: 1, shareLibrary: false, rememberEnabled: true, dailyEnabled: false, memories: [] });
const safeValue = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120
  && !/^[\\/]|^~[\\/]/u.test(value.trim())
  && !/https?:\/\/|[a-z]:[\\/]|\b(?:sk-|gh[pousr]_|github_pat_)[\w-]{12,}|BEGIN .*PRIVATE KEY/iu.test(value);

/** One panel owns profile writes; background recommendations only read fresh snapshots. */
export class MusicProfile {
  constructor(host) { this.host = host; this.current = null; this.loading = null; this.writes = Promise.resolve(); this.listeners = new Set(); }
  async load() {
    if (this.current) return structuredClone(this.current);
    if (!this.loading) this.loading = this.host.storage.get(key).then(value => {
      if (value == null) return this.current = defaults();
      if (value.version !== 1 || !['shareLibrary', 'rememberEnabled', 'dailyEnabled'].every(field => typeof value[field] === 'boolean')
        || !Array.isArray(value.memories) || value.memories.length > 20
        || value.memories.some(row => !kinds.includes(row.kind) || !safeValue(row.value) || !['like', 'avoid'].includes(row.preference)
          || typeof row.id !== 'string' || row.id.length > 60)) throw new Error('音乐偏好数据格式无效');
      return this.current = { version: 1, shareLibrary: value.shareLibrary, rememberEnabled: value.rememberEnabled,
        dailyEnabled: value.dailyEnabled, memories: value.memories.map(({ id, kind, value, preference }) => ({ id, kind, value, preference })) };
    }).finally(() => { this.loading = null; });
    return structuredClone(await this.loading);
  }
  update(change, reason = 'settings') {
    const work = this.writes.then(async () => {
      const next = change(await this.load());
      if (!next.shareLibrary) next.dailyEnabled = false;
      await this.host.storage.set(key, next); this.current = next;
      for (const listener of this.listeners) listener(structuredClone(next), reason);
      return structuredClone(next);
    });
    this.writes = work.then(() => {}, () => {}); return work;
  }
  settings(patch) { return this.update(value => ({ ...value, ...patch })); }
  forget(id) { return this.update(value => ({ ...value, memories: id === undefined ? [] : value.memories.filter(row => row.id !== id) }), 'forget'); }
  async remember(input, prompt) {
    const profile = await this.load();
    if (!profile.rememberEnabled) throw new Error('音乐偏好记忆已关闭');
    if (!kinds.includes(input.kind) || !safeValue(input.value) || !['like', 'avoid'].includes(input.preference)
      || typeof input.evidence !== 'string' || !input.evidence.includes(input.value) || !prompt.includes(input.evidence)
      || !/记住|记得|喜欢|不爱|偏好|讨厌|不想听|偏爱|爱听|prefer|remember|like|avoid/iu.test(input.evidence)) throw new Error('只能记住用户明确表达的音乐偏好，请保留用户原文');
    const value = input.value.trim();
    return this.update(state => {
      const existing = state.memories.find(row => row.kind === input.kind && normalize(row.value) === normalize(value));
      const memories = state.memories.filter(row => row !== existing);
      memories.push({ id: existing?.id ?? crypto.randomUUID(), kind: input.kind, value, preference: input.preference });
      return { ...state, memories: memories.slice(-20) };
    }, 'remember');
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export const profilePreferences = profile => profile?.rememberEnabled
  ? profile.memories.map(({ kind, value, preference }) => ({ kind, value, preference })) : [];
