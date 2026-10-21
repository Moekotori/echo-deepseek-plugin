import { DailyRecommendations } from './daily-recommendations.mjs';
import { MusicProfile } from './music-profile.mjs';

/** One midnight timer per plugin runtime; no work is scheduled while ECHO is closed. */
export function startDailyRuntime(host, { service = new DailyRecommendations(host), now = () => new Date(),
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let timer = null; let disposed = false; let configuration = 0;
  function nextDay() {
    if (timer !== null) unschedule(timer);
    const current = now(); const next = new Date(current); next.setHours(24, 0, 0, 0);
    timer = schedule(() => { timer = null; void configure(true).catch(error => {
      service.state = { phase: 'error', message: error.message };
    }); }, next.getTime() - current.getTime());
  }
  async function configure(start = false) {
    const revision = ++configuration;
    if (timer !== null) { unschedule(timer); timer = null; }
    const profile = await new MusicProfile(host).load();
    if (disposed || revision !== configuration) return;
    if (profile.dailyEnabled && profile.shareLibrary) { if (start) service.start(); nextDay(); }
    else service.cancel();
  }
  host.agents.register('daily-recommendations', { title: '每日音乐推荐' }, async input => {
    if (disposed) throw new Error('推荐服务已停止');
    if (input?.action === 'start') return service.start();
    if (input?.action === 'status') return service.status();
    if (input?.action === 'cancel') return service.cancel();
    if (input?.action === 'clear') return service.invalidate();
    if (input?.action === 'configure') { await configure(input.start === true); return service.state; }
    throw new Error('每日推荐操作无效');
  });
  const ready = configure(true).catch(error => { service.state = { phase: 'error', message: error.message }; });
  return { ready, service, async dispose() { disposed = true; if (timer !== null) unschedule(timer); timer = null; await service.dispose(); } };
}
