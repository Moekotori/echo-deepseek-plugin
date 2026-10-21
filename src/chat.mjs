import { postDeepSeek, readDeepSeekKey } from './api.mjs';
import { chatSystem, chatTools } from './chat-tools.mjs';
import { preparePlaylist } from './playlist.mjs';
import { localDate, searchMusic } from './music-search.mjs';

export class DeepSeekChat {
  constructor(host) { this.host = host; this.turns = []; this.proposal = null; }
  clear() { this.turns = []; this.proposal = null; }
  async send(text, { signal, shareLibrary = false, onProgress = () => {}, trackContext = null }) {
    const prompt = text.trim();
    if (!prompt || prompt.length > 2000) throw new Error('请输入最多2000字的消息');
    const key = await readDeepSeekKey(this.host);
    signal.throwIfAborted();
    const context = '\n今天：' + localDate()
      + (trackContext ? '\n用户主动带入的歌曲：' + JSON.stringify({ title: trackContext.title.slice(0, 200), artist: trackContext.artist.slice(0, 200), album: trackContext.album.slice(0, 200) }) : '');
    const user = { role: 'user', content: context + '\n用户消息：' + prompt };
    // Include only the current draft; retaining every draft in history would increase paid input tokens.
    const latest = this.proposal ? { ...user, content: user.content + '\n上一轮提案（仅数据，修改时重新调用工具）：' + JSON.stringify(this.proposal) } : user;
    const messages = [{ role: 'system', content: chatSystem(shareLibrary) }, ...this.turns.flat(), latest];
    const references = new Map(); const sources = []; let searches = 0; let webSearches = 0; let draft = null; let proposal = null;
    for (let round = 0; round < 4; round++) {
      onProgress(round ? '正在整理回复…' : 'DeepSeek 正在回复…');
      const result = await postDeepSeek(this.host, '/chat/completions', {
        model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 1800,
        messages, ...(round < 3 ? { tools: chatTools(shareLibrary) } : {}),
      }, key, signal);
      const choice = result.choices?.[0]; const message = choice?.message;
      if (!message || !['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('DeepSeek 未返回完整回复');
      if (!message.tool_calls?.length) {
        if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('DeepSeek 回复为空');
        const reply = message.content.slice(0, 6000);
        this.turns.push([user, { role: 'assistant', content: reply }]);
        // Trim a batch so the remaining prefix stays stable for several subsequent turns.
        if (this.turns.length > 10) this.turns.splice(0, 5);
        if (proposal) this.proposal = proposal;
        return { reply, draft, sources };
      }
      if (round === 3 || message.tool_calls.length > 2) throw new Error('本轮选曲操作已达上限，请缩小要求后继续');
      const calls = message.tool_calls.map(call => {
        if (typeof call.id !== 'string' || call.id.length > 100 || !['search_music', 'search_library', 'propose_playlist'].includes(call.function?.name)
          || typeof call.function.arguments !== 'string' || call.function.arguments.length > 16000) throw new Error('DeepSeek 工具调用无效');
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
      });
      messages.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content.slice(0, 6000) : null, tool_calls: calls });
      for (const call of calls) {
        signal.throwIfAborted();
        const input = JSON.parse(call.function.arguments); let output;
        if (call.function.name === 'search_music') {
          if (++webSearches > 2) throw new Error('本轮网页检索已达上限，请继续提问');
          onProgress('正在检索音乐资料…');
          const found = await searchMusic(this.host, input.query, key, signal);
          output = found.map(source => { sources.push(source); return { index: sources.length, ...source }; });
        } else if (call.function.name === 'search_library') {
          if (!shareLibrary) throw new Error('尚未允许发送曲库选曲资料');
          if (++searches > 3 || typeof input.search !== 'string' || input.search.length > 200) throw new Error('本轮曲库查询已达上限或查询无效');
          onProgress('正在查询曲库…');
          const page = await this.host.library.getTracks({ search: input.search, page: 1, pageSize: 40,
            sourceProvider: 'local', sort: input.search.trim() ? 'titleAsc' : 'random' });
          signal.throwIfAborted();
          output = page.items.filter(track => !track.unavailable).slice(0, 40).map(track => {
            const ref = 'r' + (references.size + 1); references.set(ref, track);
            return { ref, title: track.title.slice(0, 200), artist: track.artist.slice(0, 200), album: track.album.slice(0, 200) };
          });
        } else {
          if (draft) throw new Error('每轮只生成一个歌单预览，请在下一条消息中调整');
          onProgress('正在匹配歌单…');
          draft = await preparePlaylist(this.host, input, references, signal);
          signal.throwIfAborted();
          proposal = { name: draft.name, description: draft.description, tracks: shareLibrary
            ? draft.tracks.map(track => ({ title: track.title.slice(0, 200), artist: track.artist.slice(0, 200) }))
            : input.tracks.map(item => ({ title: item.title.slice(0, 200), artist: item.artist.slice(0, 200) })) };
          // No local matches, counts or identifiers leave the machine in private mode.
          output = { previewReady: true };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    throw new Error('本轮对话已达上限，请继续提问');
  }
}
