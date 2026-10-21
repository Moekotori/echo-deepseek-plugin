import { DeepSeekResearch } from './research.mjs';
import { displayResearch, publishSources } from './research-view.js';
import { DeepSeekExploration } from './exploration.mjs';

export function mountResearch(host, { onDraft, onBusy, isBusy }) {
  const client = new DeepSeekResearch(host);
  const exploration = new DeepSeekExploration(host, client);
  const input = document.getElementById('research-subject'); const contextLabel = document.getElementById('research-context');
  const results = document.getElementById('research-results'); const status = document.getElementById('research-status');
  const buttons = [...document.querySelectorAll('[data-research]')]; const current = document.getElementById('use-current-track');
  let controller = null; let externalBusy = false; let configured = false; let selected = null; let kind = 'track';
  function controls() {
    for (const button of [...buttons, current, ...results.querySelectorAll('button')]) button.disabled = !configured || Boolean(controller) || externalBusy;
    input.readOnly = Boolean(controller) || externalBusy;
    results.setAttribute('aria-busy', String(Boolean(controller)));
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.research === kind));
    document.getElementById('stop-research').hidden = !controller;
  }
  async function useCurrent() {
    const playback = await host.playback.getStatus();
    if (!playback.currentTrackId) throw new Error('当前没有歌曲');
    const track = await host.library.getTrack(playback.currentTrackId);
    selected = { title: track.title.slice(0, 200), artist: track.artist.slice(0, 200), album: track.album.slice(0, 200) };
    input.value = selected.title + ' — ' + selected.artist;
    contextLabel.textContent = '已带入：' + input.value;
    return selected;
  }
  async function run(request) {
    if (!configured || controller || externalBusy || isBusy()) return;
    kind = request.kind;
    const active = new AbortController(); controller = active; onBusy(true); controls();
    try {
      let name = request.name;
      if (!name) {
        const track = selected ?? (!input.value.trim() ? await useCurrent() : null);
        active.signal.throwIfAborted();
        name = request.kind === 'news' && track ? track.artist : input.value.trim();
      }
      if (request.name) { selected = null; contextLabel.textContent = ''; }
      input.value = name;
      const result = await (request.kind === 'explore' ? exploration : client).lookup({ ...request, name }, { signal: active.signal,
        onProgress: text => { if (controller === active) status.textContent = text; } });
      if (controller !== active) return;
      await publishSources(host, result.sources); active.signal.throwIfAborted();
      displayResearch(host, results, result, { onResearch: run, onDraft }); status.textContent = '';
    } catch (error) {
      if (controller === active) status.textContent = active.signal.aborted ? '已停止' : error.message;
    } finally { if (controller === active) { controller = null; onBusy(false); controls(); } }
  }
  current.onclick = async () => {
    if (current.disabled || isBusy()) return;
    current.disabled = true;
    try { await useCurrent(); status.textContent = ''; } catch (error) { status.textContent = error.message; }
    finally { controls(); }
  };
  input.oninput = () => { selected = null; contextLabel.textContent = ''; };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void run({ kind }); }
  };
  for (const button of buttons) button.onclick = () => { void run({ kind: button.dataset.research }); };
  document.getElementById('stop-research').onclick = () => { controller?.abort(); };
  function reset() {
    controller?.abort(); controller = null; onBusy(false); selected = null; results.replaceChildren();
    input.value = ''; contextLabel.textContent = ''; status.textContent = '';
    kind = 'track';
    controls();
  }
  window.addEventListener('pagehide', reset, { once: true });
  controls();
  return { run, reset, getContext: () => selected,
    setConfigured(value) { configured = value; controls(); },
    setExternalBusy(value) { externalBusy = value; controls(); },
    async showChatSources(sources) { await publishSources(host, sources); },
  };
}
