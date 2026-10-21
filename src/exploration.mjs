import { readDeepSeekKey } from './api.mjs';
import { normalizeCacheText, ResultCache, resultTtl } from './result-cache.mjs';
import { searchMusicVideos } from './video-sources.mjs';

/** Compose cached public research; local matches remain transient and are refreshed every time. */
export class DeepSeekExploration {
  constructor(host, research) { this.host = host; this.research = research; this.videos = new ResultCache(host, 'exploration-videos'); }
  async lookup({ name, force = false }, { signal, onProgress = () => {} }) {
    const seed = await this.research.lookup({ kind: 'track', name, force }, { signal, onProgress });
    const sources = []; const items = []; const people = []; const works = []; const seen = new Set();
    // Reserve two of the host's eight source slots for videos. Never retain an unsupported citation.
    const cite = (entry, from) => {
      const source = from[entry.sourceIndex];
      let index = sources.findIndex(value => value.url === source.url);
      if (index < 0) { if (sources.length === 6) return null; index = sources.length; sources.push(source); }
      return { ...entry, sourceIndex: index };
    };
    for (const item of seed.items) { const row = cite(item, seed.sources); if (row) items.push(row); }
    const creators = [...new Map(seed.people.map(person => [normalizeCacheText(person.name), person])).values()];
    const priority = person => /作曲|编曲|編曲|制作|製作|composer|arranger|producer/iu.test(person.role) ? 0 : 1;
    const contributors = creators.sort((a, b) => priority(a) - priority(b)).slice(0, 2);
    for (const person of contributors) {
      const row = cite(person, seed.sources); if (!row) continue;
      people.push(row);
      onProgress('正在探索 ' + person.name + ' 的参与作品…');
      const related = await this.research.lookup({ kind: 'contributor', name: person.name,
        question: person.role, force }, { signal, onProgress });
      for (const work of related.works) {
        const identity = normalizeCacheText(work.title) + '\n' + normalizeCacheText(work.artist);
        if (seen.has(identity) || works.length === 12) continue;
        const cited = cite(work, related.sources); if (!cited) continue;
        seen.add(identity); works.push({ ...cited, relation: person.name + ' · ' + work.relation });
      }
    }
    onProgress('正在查找现场、访谈与制作视频…');
    const key = await readDeepSeekKey(this.host);
    const videos = await this.videos.lookup({ name: normalizeCacheText(name), purpose: 'explore' },
      { signal, force, ttlMs: resultTtl.research }, activeSignal => searchMusicVideos(this.host, { name, purpose: 'explore' }, key, activeSignal));
    for (const video of videos) if (!sources.some(source => source.url === video.url) && sources.length < 8) sources.push(video);
    signal.throwIfAborted();
    return { kind: 'explore', name, summary: seed.summary, fetchedAt: seed.fetchedAt, items, people, works, sources };
  }
}
