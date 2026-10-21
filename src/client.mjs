import { detailPrompt, generatedFields, releaseVersionsPrompt } from './fields.mjs';
import { postDeepSeek, readDeepSeekKey } from './api.mjs';
import { artistProfilePrompt, searchArtistProfile } from './artist-profile.mjs';
import { artworkPrompt, searchArtistArtwork, selectedArtistArtwork } from './artist-artwork.mjs';
import { searchMusic } from './music-search.mjs';
import { searchMusicVideos } from './video-sources.mjs';
import { normalizeCacheText, ResultCache, resultTtl } from './result-cache.mjs';
import { modelProfile, requireDeepSeekSearch } from './model-settings.mjs';

/** Only display identity enters the prompt; no file paths, library IDs or playback state. */
export class DeepSeekDetails {
  constructor(host) {
    this.host = host;
    this.cache = new ResultCache(host, 'details');
  }
  async lookup(request, { signal }) {
    signal.throwIfAborted();
    requireDeepSeekSearch(await modelProfile(this.host));
    const key = await readDeepSeekKey(this.host);
    const cacheIdentity = { entity: request.entity, name: normalizeCacheText(request.name),
      artist: request.entity === 'album' ? normalizeCacheText(request.artist) : '', year: request.entity === 'album' ? request.year ?? null : null };
    return this.cache.lookup(cacheIdentity, { signal, force: request.force, ttlMs: resultTtl[request.entity] },
      activeSignal => this.fetch(request, key, activeSignal));
  }
  async fetch(request, key, signal) {
    const identity = { entity: request.entity, name: request.name, artist: request.artist, year: request.year };
    const subject = request.name + ' ' + request.artist + ' ' + (request.year || '') + ' 专辑 发行日期 唱片公司 制作人 版本 初回限定盤 通常盤 品番';
    const [profileSources, imagePages, videos] = await Promise.all([
      request.entity === 'artist' ? searchArtistProfile(this.host, request.name, key, signal)
        : searchMusic(this.host, subject, key, signal, 3),
      request.entity === 'artist' ? searchArtistArtwork(this.host, request.name, key, signal) : [],
      searchMusicVideos(this.host, request, key, signal),
    ]);
    const background = [...new Map([...profileSources.slice(0, 2), ...imagePages, ...profileSources.slice(2, 4)].map(source => [source.url, source])).values()];
    const sources = [...new Map([...background.slice(0, 6 - videos.length), ...videos].map(source => [source.url, source])).values()];
    const artworkCandidates = imagePages.flatMap(page => {
      const sourceIndex = sources.findIndex(source => source.url === page.url);
      return sourceIndex < 0 ? [] : page.images.slice(0, 4).map(image => ({ ...image, sourceIndex }));
    }).slice(0, 8);
    if (!sources.length) throw new Error('DeepSeek 未检索到可用资料');
    const completion = await postDeepSeek(this.host, '/chat/completions', {
      model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: request.entity === 'album' ? 2000 : 3200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: detailPrompt + (request.entity === 'album' ? releaseVersionsPrompt : artistProfilePrompt + artworkPrompt) },
        { role: 'user', content: JSON.stringify({ subject: identity, sources: sources.map(({ label, url, summary }) => ({ label, url, summary })), artworkCandidates }) },
      ],
    }, key, signal);
    const choice = completion.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
      throw new Error('DeepSeek 未返回完整资料，请刷新重试');
    }
    const info = JSON.parse(choice.message.content);
    if (typeof info.title !== 'string' || typeof info.extract !== 'string' || !info.extract.trim()) {
      throw new Error('DeepSeek 未找到可确认的匹配资料');
    }
    const value = { title: info.title.slice(0, 300), extract: info.extract.slice(0, 12000),
      description: typeof info.description === 'string' ? info.description.slice(0, 500) : null,
      artistExtract: typeof info.artistExtract === 'string' ? info.artistExtract.slice(0, 4000) : null,
      language: 'zh-CN', sources: sources.map(({ label, url }) => ({ label, url })),
      ...(request.entity === 'artist' ? { heroImages: selectedArtistArtwork(info, artworkCandidates) } : {}),
      ...generatedFields(info, request.entity, sources.length) };
    signal.throwIfAborted();
    return value;
  }
  dispose() { this.cache.dispose(); }
}
