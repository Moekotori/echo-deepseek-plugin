import { mountChat } from './chat-panel.js';
import { mountResearch } from './research-panel.js';
import { mountKeySettings } from './key-panel.js';
import { modelProviders } from './model-settings.mjs';
import { MusicProfile } from './music-profile.mjs';
import { mountPersonalization } from './personalization-panel.js';

const profile = new MusicProfile(echo);
const chat = mountChat(echo, { profile });
const research = mountResearch(echo, { onDraft: chat.preview, onBusy: chat.setExternalBusy, isBusy: chat.isBusy, onTrackSelected: chat.selectRecommendation });
chat.connectResearch(research);
const personal = mountPersonalization(echo, profile, chat);
chat.connectPersonalization(personal);
const keys = mountKeySettings(echo, {
  onConfigured(value) { chat.setConfigured(value); research.setConfigured(value); personal.setConfigured(value); },
  onChanged() { chat.reset(); research.reset(); },
  onProvider(profile) {
    const label = modelProviders[profile.provider].label;
    chat.setProvider(label); research.setProvider(profile.provider);
    document.getElementById('library-share-label').textContent = '让 ' + label + ' 从曲库选曲';
    document.getElementById('library-share-description').textContent = '开启后向 ' + label + ' 发送有界曲库概况及本次检索的曲名、艺术家、专辑、曲风、年份和时长。';
  },
});
function theme(context) {
  document.documentElement.style.colorScheme = context.colorScheme;
  document.documentElement.dataset.reducedMotion = String(context.reducedMotion);
  for (const [name, value] of Object.entries(context.appearance)) document.documentElement.style.setProperty('--echo-host-' + name, value);
}
const stop = echo.ui.onContextChanged(theme);
window.addEventListener('pagehide', stop, { once: true });
(async () => {
  theme(await echo.ui.getContext());
  const configured = await keys.load();
  if (configured) {
    const request = await echo.storage.get('research-request');
    await echo.storage.remove('research-request');
    if (request) await research.run(request);
  }
})().catch(() => { document.getElementById('status').textContent = '无法读取插件设置'; });
