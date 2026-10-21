import { DeepSeekChat } from './chat.mjs';
import { MusicProfile, profilePreferences } from './music-profile.mjs';
import { localDate } from './music-search.mjs';
import { recommendationFacts } from './recommendations.mjs';

const key = 'daily-recommendations-v1';
export async function readDailyRecommendations(host) {
  const value = await host.storage.get(key);
  if (value == null) return null;
  if (value.version !== 1 || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.day)
    || typeof value.summary !== 'string' || value.summary.length > 6000 || !Array.isArray(value.items) || value.items.length > 8
    || value.items.some(item => !['title', 'artist', 'reason'].every(field => typeof item[field] === 'string' && item[field].length > 0 && item[field].length <= (field === 'reason' ? 300 : 200)))) throw new Error('每日推荐数据格式无效');
  return { version: 1, day: value.day, summary: value.summary,
    items: value.items.map(({ title, artist, reason }) => ({ title, artist, reason })) };
}

/** The declared background agent is the sole producer, across all visible panels. */
export class DailyRecommendations {
  constructor(host, { today = localDate, createChat = () => new DeepSeekChat(host) } = {}) {
    this.host = host; this.today = today; this.createChat = createChat;
    this.job = null; this.clearing = null; this.controller = null; this.state = { phase: 'idle', message: '' };
  }
  start() {
    if (this.job || this.clearing) return this.state;
    const controller = new AbortController(); this.controller = controller;
    this.state = { phase: 'running', message: '正在准备今日推荐…' };
    const job = this.generate(controller.signal).then(value => {
      if (!this.clearing) this.state = { phase: 'ready', day: value.day, message: '' };
    }).catch(error => {
      if (!this.clearing) this.state = { phase: controller.signal.aborted ? 'idle' : 'error', message: controller.signal.aborted ? '已停止' : error.message };
    }).finally(() => { if (this.job === job) { this.job = null; this.controller = null; } });
    this.job = job; return this.state;
  }
  async generate(signal) {
    const cached = await readDailyRecommendations(this.host); signal.throwIfAborted();
    const day = this.today();
    if (cached?.day === day) return cached;
    const profile = await new MusicProfile(this.host).load(); signal.throwIfAborted();
    if (!profile.shareLibrary) throw new Error('请先开启从曲库选曲，再生成每日推荐');
    const prompt = '请为今天准备8首来自本机曲库的每日推荐，调用recommend_tracks逐首给出不超过60字的具体理由。先查询曲库概况，再按偏好筛选实际候选，尽量覆盖不同艺人；没有偏好时按实际曲风或作品特点解释探索理由。不查询网页，不创建歌单，不保存偏好，不播放歌曲。'
      + (cached ? '\n上次推荐（尽量选择不同作品）：' + JSON.stringify(cached.items.map(({ title, artist }) => ({ title, artist }))) : '');
    const result = await this.createChat().send(prompt, { signal, shareLibrary: true, preferences: profilePreferences(profile), recommendationsOnly: true });
    signal.throwIfAborted();
    const value = { version: 1, day, summary: result.reply.slice(0, 6000), items: recommendationFacts(result.recommendations).slice(0, 8) };
    if (!value.items.length) throw new Error('未生成可用的每日推荐');
    await this.host.storage.set(key, value); signal.throwIfAborted(); return value;
  }
  cancel() { this.controller?.abort(); return { ...this.state }; }
  invalidate() {
    if (this.clearing) return this.state;
    this.cancel(); this.state = { phase: 'clearing', message: '正在清除相关每日推荐…' };
    this.clearing = (this.job ?? Promise.resolve()).then(() => this.host.storage.remove(key)).then(() => {
      this.state = { phase: 'idle', message: '' };
    }).catch(error => { this.state = { phase: 'error', message: error.message }; }).finally(() => { this.clearing = null; });
    return this.state;
  }
  async status() { return { ...this.state, result: this.job || this.clearing ? null : await readDailyRecommendations(this.host) }; }
  async dispose() { this.cancel(); await this.job; await this.clearing; }
}
