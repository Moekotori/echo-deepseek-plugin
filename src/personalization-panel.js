import { element } from './research-view.js';
import { recommendationList } from './recommendation-view.js';
import { matchRecommendations } from './recommendations.mjs';
import { localDate } from './music-search.mjs';

const wait = signal => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 750);
  signal.addEventListener('abort', abort, { once: true });
});
export function mountPersonalization(host, profile, chat) {
  const byId = id => document.getElementById(id);
  const show = byId('show-daily'); const stop = byId('stop-daily'); const remember = byId('remember-music'); const automatic = byId('automatic-daily');
  const shared = byId('share-library'); const status = byId('personal-status'); const memoryList = byId('music-memories');
  const daily = byId('daily-results'); const clear = byId('clear-memories');
  let configured = false; let externalBusy = false; let controller = null; let saving = false; let disposed = false;
  let settings = null;
  const agent = input => host.agents.run('daily-recommendations', input);
  function controls() {
    const busy = externalBusy || saving || Boolean(controller);
    show.disabled = !configured || busy; automatic.disabled = !configured || busy || !settings;
    remember.disabled = busy || !settings; clear.disabled = busy || !settings?.memories.length;
    for (const button of memoryList.querySelectorAll('button')) button.disabled = busy;
    stop.hidden = !controller; shared.disabled = busy;
  }
  function display(profileValue) {
    settings = profileValue; remember.checked = settings.rememberEnabled; automatic.checked = settings.dailyEnabled; shared.checked = settings.shareLibrary;
    memoryList.replaceChildren();
    const labels = { genre: '曲风', artist: '艺人', mood: '风格与氛围', listening: '收听场景' };
    for (const item of settings.memories) {
      const row = element('li'); row.append(element('span', labels[item.kind] + ' · ' + (item.preference === 'avoid' ? '避开 ' : '喜欢 ') + item.value));
      const remove = element('button', '删除'); remove.type = 'button';
      remove.onclick = () => { void change(() => profile.forget(item.id), true); }; row.append(remove); memoryList.append(row);
    }
    controls();
  }
  async function settled(action, signal) {
    let value = await agent(action); const deadline = Date.now() + 180_000;
    while (value.phase === 'running' || value.phase === 'clearing') {
      signal.throwIfAborted(); if (Date.now() > deadline) throw new Error('推荐等待超时，可停止后重试');
      status.textContent = value.message; await wait(signal); signal.throwIfAborted(); value = await agent({ action: 'status' });
    }
    signal.throwIfAborted();
    if (value.phase === 'error') throw new Error(value.message);
    return value.result === undefined ? agent({ action: 'status' }) : value;
  }
  async function showDaily() {
    if (show.disabled) return;
    const active = new AbortController(); controller = active; controls();
    try {
      const value = await settled({ action: 'start' }, active.signal); active.signal.throwIfAborted();
      if (value.result?.day !== localDate()) { status.textContent = '今日推荐尚未生成，请开启从曲库选曲后重试'; return; }
      const recommendations = await matchRecommendations(host, value.result.items, active.signal);
      active.signal.throwIfAborted(); daily.replaceChildren(); daily.hidden = false;
      daily.append(element('h2', '每日推荐 · ' + value.result.day), element('p', value.result.summary), recommendationList(host, recommendations, {
        onSelect: chat.selectRecommendation, onError: error => { status.textContent = error.message; },
      }));
      daily.scrollIntoView({ block: 'start' }); status.textContent = '';
    } catch (error) { if (!disposed) status.textContent = active.signal.aborted ? '已停止' : error.message; }
    finally { if (controller === active) { controller = null; if (!disposed) controls(); } }
  }
  async function change(write, forget = false, start = false) {
    if (saving || externalBusy || controller) return;
    saving = true; chat.setExternalBusy(true); controls();
    try {
      await write();
      if (disposed) return;
      chat.clearHistory();
      if (forget) {
        controller?.abort(); const active = new AbortController(); controller = active; daily.replaceChildren(); daily.hidden = true;
        await settled({ action: 'clear' }, active.signal); controller = null;
      }
      await agent({ action: 'configure', start }); status.textContent = '';
    } catch (error) { if (!disposed) { status.textContent = error.message; if (profile.current) display(profile.current); } }
    finally { saving = false; controller = null; if (!disposed) { chat.setExternalBusy(false); controls(); } }
  }
  show.onclick = () => { void showDaily(); };
  stop.onclick = () => { controller?.abort(); void agent({ action: 'cancel' }).catch(error => { if (!disposed) status.textContent = error.message; }); };
  remember.onchange = () => { const value = remember.checked; void change(() => profile.settings({ rememberEnabled: value }), !value); };
  automatic.onchange = () => { const enabled = automatic.checked; void change(() => profile.settings({ dailyEnabled: enabled, ...(enabled ? { shareLibrary: true } : {}) }), false, enabled); };
  shared.onchange = () => { const value = shared.checked; void change(() => profile.settings({ shareLibrary: value })); };
  clear.onclick = () => { void change(() => profile.forget(), true); };
  const unsubscribe = profile.subscribe(display);
  const ready = profile.load().then(value => { if (!disposed) display(value); }).catch(error => { if (!disposed) status.textContent = error.message; });
  window.addEventListener('pagehide', () => { disposed = true; controller?.abort(); controller = null; unsubscribe(); }, { once: true });
  controls();
  return { ready, setConfigured(value) { const wasConfigured = configured; configured = value; if (wasConfigured && !value) { controller?.abort(); void agent({ action: 'cancel' }).catch(error => { if (!disposed) status.textContent = error.message; }); } controls(); },
    setBusy(value) { externalBusy = value; controls(); },
  };
}
