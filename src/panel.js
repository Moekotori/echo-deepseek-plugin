import { mountChat } from './chat-panel.js';
import { mountResearch } from './research-panel.js';
import { mountKeySettings } from './key-panel.js';

const chat = mountChat(echo);
const research = mountResearch(echo, { onDraft: chat.preview, onBusy: chat.setExternalBusy, isBusy: chat.isBusy });
chat.connectResearch(research);
const keys = mountKeySettings(echo, {
  onConfigured(value) { chat.setConfigured(value); research.setConfigured(value); },
  onChanged() { chat.reset(); research.reset(); },
});
function theme(context) {
  document.documentElement.style.colorScheme = context.colorScheme;
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
