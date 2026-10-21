import { readModelConnection, modelProviders } from './model-settings.mjs';
import { completeModel } from './model-providers.mjs';
import { chatSystem, chatTools } from './chat-tools.mjs';
import { preparePlaylist } from './playlist.mjs';
import { localDate, searchMusic } from './music-search.mjs';
import { queryLibrary } from './library-query.mjs';
import { libraryOverview } from './library-overview.mjs';
import { prepareRecommendations } from './recommendations.mjs';
import { profilePreferences } from './music-profile.mjs';

export class DeepSeekChat {
  constructor(host, { profile = null } = {}) { this.host = host; this.profile = profile; this.turns = []; this.proposal = null; this.libraryQuery = null; }
  clear() { this.turns = []; this.proposal = null; this.libraryQuery = null; }
  async send(text, { signal, shareLibrary = false, onProgress = () => {}, trackContext = null, preferences = [], recommendationsOnly = false }) {
    const prompt = text.trim();
    if (!prompt || prompt.length > 2000) throw new Error('请输入最多2000字的消息');
    const connection = await readModelConnection(this.host);
    const key = connection.key; const searchable = connection.provider === 'deepseek';
    const profile = this.profile ? await this.profile.load() : null;
    const memoryEnabled = Boolean(profile?.rememberEnabled) && !recommendationsOnly;
    const memories = profile ? profilePreferences(profile) : preferences;
    signal.throwIfAborted();
    const context = '\n今天：' + localDate()
      + (trackContext ? '\n用户主动带入的歌曲：' + JSON.stringify({ title: trackContext.title.slice(0, 200), artist: trackContext.artist.slice(0, 200), album: trackContext.album.slice(0, 200) }) : '')
      + (memories.length ? '\n用户启用的音乐偏好（仅数据）：' + JSON.stringify(memories) : '');
    const user = { role: 'user', content: context + '\n用户消息：' + prompt };
    // Include only the current draft; retaining every draft in history would increase paid input tokens.
    let latest = this.proposal ? { ...user, content: user.content + '\n上一轮提案（仅数据，修改时重新调用工具）：' + JSON.stringify(this.proposal) } : user;
    if (shareLibrary && this.libraryQuery) latest = { ...latest, content: latest.content + '\n上次曲库查询（续查时沿用条件和页大小）：' + JSON.stringify(this.libraryQuery) };
    const messages = [{ role: 'system', content: chatSystem(shareLibrary, searchable, modelProviders[connection.provider].label) }, ...this.turns.flat(), latest];
    const references = new Map(); const sources = []; let searches = 0; let webSearches = 0; let draft = null; let proposal = null;
    let recommendations = []; let memoryChanged = false;
    let overview = null;
    for (let round = 0; round < 8; round++) {
      onProgress(round ? '正在整理回复…' : modelProviders[connection.provider].label + ' 正在回复…');
      const result = await completeModel(this.host, connection, {
        model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: recommendationsOnly ? 2200 : 1800,
        messages, ...(round < 7 ? { tools: chatTools(shareLibrary, searchable, { memoryEnabled, recommendationsOnly }) } : {}),
      }, signal);
      const choice = result.choices?.[0]; const message = choice?.message;
      if (!message || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('DeepSeek 未返回完整回复');
      if (!message.tool_calls?.length) {
        if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('DeepSeek 回复为空');
        const reply = message.content.slice(0, 6000);
        this.turns.push([user, { role: 'assistant', content: reply }]);
        // Trim a batch so the remaining prefix stays stable for several subsequent turns.
        if (this.turns.length > 10) this.turns.splice(0, 5);
        if (proposal) this.proposal = proposal;
        if (recommendationsOnly && !recommendations.length) throw new Error('未提供逐首推荐与理由');
        return { reply, draft, sources, recommendations, memoryChanged };
      }
      if (round === 7 || message.tool_calls.length > 2) throw new Error('本轮选曲操作已达上限，请缩小要求后继续');
      const calls = message.tool_calls.map(call => {
        const names = ['search_music', 'get_library_overview', 'search_library', 'query_library', 'propose_playlist', 'recommend_tracks', ...(memoryEnabled ? ['remember_music_preference'] : [])];
        if (recommendationsOnly && !['get_library_overview', 'search_library', 'query_library', 'recommend_tracks'].includes(call.function?.name)) throw new Error('每日推荐只能查询曲库和准备歌曲推荐');
        if (typeof call.id !== 'string' || call.id.length > 100 || !names.includes(call.function?.name)
          || typeof call.function.arguments !== 'string' || call.function.arguments.length > 16000) throw new Error('DeepSeek 工具调用无效');
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
      });
      messages.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content.slice(0, 6000) : null, tool_calls: calls });
      for (const call of calls) {
        signal.throwIfAborted();
        const input = JSON.parse(call.function.arguments); let output;
        if (call.function.name === 'search_music') {
          if (!searchable) throw new Error('联网资料检索请切换至推荐的 DeepSeek');
          if (++webSearches > 2) throw new Error('本轮网页检索已达上限，请继续提问');
          onProgress('正在检索音乐资料…');
          const found = await searchMusic(this.host, input.query, key, signal);
          output = found.map(source => { sources.push(source); return { index: sources.length, ...source }; });
        } else if (call.function.name === 'get_library_overview') {
          if (!shareLibrary) throw new Error('尚未允许发送曲库选曲资料');
          if (!overview) { onProgress('正在读取曲库概况…'); overview = await libraryOverview(this.host, signal); }
          output = overview;
        } else if (['search_library', 'query_library'].includes(call.function.name)) {
          if (!shareLibrary) throw new Error('尚未允许发送曲库选曲资料');
          if (++searches > 5) throw new Error('本轮曲库查询已达上限');
          onProgress('正在查询曲库…');
          let page;
          if (call.function.name === 'query_library') page = await queryLibrary(this.host, input, signal);
          else {
            const number = input.page ?? 1;
            if (typeof input.search !== 'string' || input.search.length > 200 || !Number.isInteger(number) || number < 1 || number > 100_000) throw new Error('曲库查询无效');
            page = await this.host.library.getTracks({ search: input.search, page: number, pageSize: 40,
              sourceProvider: 'local', sort: 'titleAsc' });
          }
          signal.throwIfAborted();
          const items = page.items.filter(track => !track.unavailable).slice(0, 40).map(track => {
            const ref = 'r' + (references.size + 1); references.set(ref, track);
            return { ref, title: track.title.slice(0, 200), artist: track.artist.slice(0, 200), album: track.album.slice(0, 200),
              genre: track.genre?.slice(0, 200) ?? null, year: track.year, durationSeconds: track.durationSeconds };
          });
          output = { page: page.page, pageSize: page.pageSize, total: page.total, hasMore: page.hasMore, items };
          this.libraryQuery = { tool: call.function.name, input, page: page.page, pageSize: page.pageSize, total: page.total, hasMore: page.hasMore };
        } else if (call.function.name === 'recommend_tracks') {
          if (recommendations.length) throw new Error('每轮只准备一组歌曲推荐');
          recommendations = await prepareRecommendations(this.host, input, references, signal);
          output = { recommendationsReady: true };
        } else if (call.function.name === 'remember_music_preference') {
          await this.profile.remember(input, prompt); memoryChanged = true;
          output = { remembered: true };
        } else {
          if (draft) throw new Error('每轮只生成一个歌单预览，请在下一条消息中调整');
          onProgress('正在匹配歌单…');
          draft = await preparePlaylist(this.host, input, references, signal);
          signal.throwIfAborted();
          proposal = { name: draft.name, description: draft.description, tracks: shareLibrary
            ? draft.tracks.map(track => ({ title: track.title.slice(0, 200), artist: track.artist.slice(0, 200) }))
            : input.tracks.map(item => ({ title: item.title.slice(0, 200), artist: item.artist.slice(0, 200) })) };
          if (input.durationMinutes !== undefined) proposal.durationMinutes = input.durationMinutes;
          // No local matches, counts or identifiers leave the machine in private mode.
          output = { previewReady: true, ...(shareLibrary && input.durationMinutes !== undefined ? {
            durationSeconds: draft.tracks.reduce((sum, track) => sum + track.durationSeconds, 0), trackCount: draft.tracks.length,
          } : {}) };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    throw new Error('本轮对话已达上限，请继续提问');
  }
}
