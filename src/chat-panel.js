import { DeepSeekChat } from './chat.mjs';
import { savePlaylist } from './playlist.mjs';
import { localDate } from './music-search.mjs';
import { sourceList } from './research-view.js';
import { recommendationList } from './recommendation-view.js';

export function mountChat(host, { profile = null } = {}) {
  const byId = id => document.getElementById(id);
  const client = new DeepSeekChat(host, { profile });
  const transcript = byId('transcript'); const prompt = byId('prompt'); const status = byId('chat-status');
  const send = byId('send-message'); const stop = byId('stop-message'); const share = byId('share-library');
  const preview = byId('playlist-preview'); const name = byId('playlist-name'); const list = byId('playlist-tracks');
  const create = byId('create-playlist'); const clear = byId('clear-chat');
  let controller = null; let configured = false; let draft = null; let saving = false; let externalBusy = false; let research = null;
  let promptRevision = 0;
  let providerName = 'DeepSeek';
  let selected = null; let personal = null;
  function selectRecommendation(item) {
    selected = { title: item.title.slice(0, 200), artist: item.artist.slice(0, 200), album: (item.track?.album ?? item.album ?? '').slice(0, 200) };
    byId('chat-track-context').hidden = false;
    byId('chat-track-label').textContent = '正在聊：' + selected.title + ' — ' + selected.artist;
    prompt.focus({ preventScroll: true });
  }
  function resizePrompt() {
    prompt.style.height = '0px';
    prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
  }
  function message(role, text, sources = []) {
    const viewport = transcript.parentElement;
    const following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
    const article = document.createElement('article'); article.className = 'message'; article.dataset.role = role;
    const label = document.createElement('strong'); label.textContent = role === 'user' ? '你' : providerName;
    const body = document.createElement('div'); body.className = 'message-body';
    const paragraphs = text.split(/\n[ \t]*\n+/u);
    // Bound paragraph nodes while retaining the full text in the last paragraph.
    for (let index = 0; index < paragraphs.length; index++) {
      const paragraph = document.createElement('p');
      paragraph.textContent = index === 31 ? paragraphs.slice(index).join('\n\n') : paragraphs[index];
      body.append(paragraph);
      if (index === 31) break;
    }
    article.append(label, body); transcript.append(article);
    if (sources.length) article.append(sourceList(host, sources, localDate()));
    while (transcript.children.length > 20) transcript.firstElementChild.remove();
    if (role === 'user') viewport.scrollTop = viewport.scrollHeight;
    else if (following) {
      const reply = article.getBoundingClientRect(); const visible = viewport.getBoundingClientRect();
      if (reply.top > visible.bottom - 80) viewport.scrollTop += reply.top - visible.top;
    }
    return article;
  }
  function controls() {
    const busy = controller !== null || externalBusy;
    research?.setExternalBusy(controller !== null || saving);
    send.disabled = !configured || busy || saving || !prompt.value.trim(); stop.hidden = controller === null;
    transcript.setAttribute('aria-busy', String(controller !== null));
    share.disabled = busy || saving; clear.disabled = saving;
    create.disabled = busy || saving || !draft || draft.saved || !list.querySelector('input:checked');
    name.disabled = busy || saving || Boolean(draft?.playlistId);
    for (const checkbox of list.querySelectorAll('input')) checkbox.disabled = busy || saving || Boolean(draft?.saved);
    personal?.setBusy(controller !== null || saving || externalBusy);
  }
  function reset() {
    controller?.abort(); controller = null; client.clear(); draft = null;
    selected = null; byId('chat-track-context').hidden = true;
    transcript.replaceChildren(); list.replaceChildren(); preview.hidden = true; prompt.value = ''; resizePrompt(); status.textContent = ''; controls();
  }
  function clearHistory() {
    const text = prompt.value;
    reset(); prompt.value = text; resizePrompt(); controls();
  }
  function showDraft(next) {
    draft = next; preview.hidden = false; name.value = draft.name; list.replaceChildren();
    create.textContent = '创建歌单';
    for (const track of draft.tracks) {
      const row = document.createElement('li'); const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = track.id;
      checkbox.onchange = controls;
      const text = document.createElement('span'); text.textContent = track.title + ' — ' + track.artist;
      label.append(checkbox, text); row.append(label); list.append(row);
    }
    byId('playlist-missing').textContent = draft.missing.length
      ? '曲库未匹配：' + draft.missing.map(track => track.title + ' — ' + track.artist).join('；') : '';
    const seconds = draft.tracks.reduce((sum, track) => sum + (track.durationSeconds || 0), 0);
    byId('playlist-count').textContent = draft.tracks.length + ' 首已匹配' + (seconds > 0 ? ' · ' + Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0') : '');
  }
  async function submit() {
    if (send.disabled || !prompt.value.trim()) return;
    const original = prompt.value; const revision = promptRevision;
    const text = original.trim(); const active = new AbortController(); controller = active;
    const sent = message('user', text); prompt.value = ''; resizePrompt(); controls(); prompt.focus({ preventScroll: true });
    const thinking = document.createElement('div'); thinking.className = 'message thinking';
    const progress = document.createElement('span'); progress.className = 'thinking-text'; thinking.append(progress); transcript.append(thinking);
    transcript.parentElement.scrollTop = transcript.parentElement.scrollHeight;
    try {
      const result = await client.send(text, { signal: active.signal, shareLibrary: share.checked,
        trackContext: selected ?? research?.getContext() ?? null,
        onProgress: text => { if (controller === active) progress.textContent = text; } });
      if (controller !== active) return;
      if (result.sources.length) await research.showChatSources(result.sources);
      if (controller !== active) return;
      thinking.remove();
      const article = message('assistant', result.reply, result.sources);
      if (result.recommendations.length) article.append(recommendationList(host, result.recommendations, {
        onSelect: selectRecommendation, onError: error => { status.textContent = error.message; },
      }));
      if (result.draft) showDraft(result.draft);
      status.textContent = '';
    } catch (error) {
      thinking.remove();
      if (controller === active) {
        status.textContent = active.signal.aborted ? '已停止' : error.message;
        if (promptRevision === revision) { prompt.value = original; resizePrompt(); sent.remove(); }
      }
    } finally { if (controller === active) { controller = null; controls(); } }
  }
  send.onclick = () => { void submit(); };
  prompt.oninput = () => { promptRevision++; resizePrompt(); controls(); };
  prompt.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
  };
  stop.onclick = () => { controller?.abort(); prompt.focus({ preventScroll: true }); };
  clear.onclick = () => { clearHistory(); prompt.focus({ preventScroll: true }); };
  share.onchange = clearHistory;
  byId('clear-chat-track').onclick = () => { selected = null; byId('chat-track-context').hidden = true; prompt.focus({ preventScroll: true }); };
  create.onclick = async () => {
    if (create.disabled) return;
    const target = draft;
    target.name = name.value.trim(); saving = true; controls(); status.textContent = '正在创建歌单…';
    try {
      const count = await savePlaylist(host, target, [...list.querySelectorAll('input:checked')].map(input => input.value));
      if (draft !== target) return;
      status.textContent = '已创建「' + target.name + '」，' + count + ' 首歌'; create.textContent = '已创建';
    } catch (error) {
      if (draft !== target) return;
      status.textContent = target.playlistId ? '歌单已创建，但歌曲未添加完成：' + error.message : error.message;
      create.textContent = target.playlistId ? '重试添加歌曲' : '创建歌单';
    } finally { saving = false; controls(); }
  };
  window.addEventListener('pagehide', reset, { once: true });
  controls();
  return { reset, clearHistory, selectRecommendation, preview(value) { if (!controller && !saving) { showDraft(value); controls(); } },
    isBusy: () => controller !== null || saving,
    setExternalBusy(value) { externalBusy = value; controls(); },
    connectResearch(value) { research = value; controls(); },
    connectPersonalization(value) { personal = value; controls(); },
    setProvider(value) { providerName = value; },
    setConfigured(value) { configured = value; controls(); } };
}
