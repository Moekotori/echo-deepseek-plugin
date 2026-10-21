const day = 24 * 60 * 60 * 1000;
export const resultTtl = { album: 30 * day, artist: 7 * day, research: 30 * day, news: day / 4 };
export const normalizeCacheText = value => (value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

/** Only bounded, generated public facts enter storage; no credentials, chat or local track objects. */
export class ResultCache {
  constructor(host, namespace) {
    this.host = host;
    this.namespace = namespace;
    this.indexKey = 'dsc-' + namespace + '-index-v1';
    this.memory = new Map();
    this.pending = new Map();
    this.writes = Promise.resolve();
  }
  get size() { return this.memory.size; }
  async lookup(identity, { signal, force = false, ttlMs }, load) {
    signal.throwIfAborted();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
    const key = 'dsc-' + this.namespace + '-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 48);
    signal.throwIfAborted();
    let job = this.pending.get(key);
    if (job?.controller.signal.aborted) {
      // A new visitor waits for the cancelled request to retire before starting another paid request.
      await job.promise.catch(() => {});
      return this.lookup(identity, { signal, force, ttlMs }, load);
    }
    if (!job) {
      const controller = new AbortController();
      job = { controller, users: new Set(), promise: null, force };
      const active = job;
      job.promise = Promise.resolve().then(async () => {
        if (!active.force) {
          const cached = this.memory.get(key) ?? (await this.host.storage.get(this.indexKey) ?? []).find(entry => entry.key === key);
          controller.signal.throwIfAborted();
          if (!active.force && cached && Date.now() - cached.at < ttlMs) {
            this.remember(key, cached);
            return cached.value;
          }
        }
        const value = await load(controller.signal);
        controller.signal.throwIfAborted();
        const entry = { at: Date.now(), value };
        this.remember(key, entry);
        const write = this.writes.then(() => this.persist(key, entry));
        // A cache write failure must not discard a result the user already paid for.
        this.writes = write.catch(() => { console.warn('DeepSeek result cache persistence failed'); });
        await this.writes;
        return value;
      }).finally(() => { if (this.pending.get(key) === active) this.pending.delete(key); });
      this.pending.set(key, job);
    }
    if (force) job.force = true;
    return new Promise((resolve, reject) => {
      const user = {};
      job.users.add(user);
      const release = () => {
        signal.removeEventListener('abort', abort);
        job.users.delete(user);
        if (!job.users.size) job.controller.abort();
      };
      const abort = () => { release(); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      job.promise.then(value => {
        if (!signal.aborted) { release(); resolve(structuredClone(value)); }
      }, error => { release(); reject(error); });
    });
  }
  remember(key, entry) {
    this.memory.delete(key);
    this.memory.set(key, entry);
    let characters = [...this.memory.values()].reduce((total, item) => total + JSON.stringify(item).length, 0);
    while (this.memory.size > 24 || characters > 96_000) {
      const oldest = this.memory.keys().next().value;
      characters -= JSON.stringify(this.memory.get(oldest)).length;
      this.memory.delete(oldest);
    }
  }
  async persist(key, entry) {
    const stored = await this.host.storage.get(this.indexKey);
    const index = (stored ?? []).filter(item => item.key !== key);
    index.push({ key, ...entry });
    while (index.length > 96 || JSON.stringify(index).length > 384_000) index.shift();
    // One bounded snapshot also bounds storage when old and new frames overlap during navigation.
    await this.host.storage.set(this.indexKey, index);
  }
  dispose() {
    for (const job of this.pending.values()) job.controller.abort();
    this.memory.clear();
  }
}
