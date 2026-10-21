import { DeepSeekDetails } from './client.mjs';
import { startDailyRuntime } from './daily-runtime.mjs';
const client = new DeepSeekDetails(echo);
const daily = startDailyRuntime(echo);
echo.commands.register('configure-deepseek', { title: 'DeepSeek 对话与歌单' }, () => echo.ui.openPanel('deepseek-settings'));
echo.commands.register('research-contributor', { title: 'DeepSeek 创作人员作品' }, async input => {
  if (input == null) return echo.ui.openPanel('deepseek-settings');
  if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new Error('创作人员名称无效');
  await echo.storage.set('research-request', { kind: 'contributor', name: input.name.trim(),
    question: typeof input.role === 'string' ? input.role.slice(0, 100) : '' });
  return echo.ui.openPanel('deepseek-settings');
});
for (const entity of ['artist', 'album']) {
  echo.metadata.registerProvider('deepseek-' + entity, { title: 'DeepSeek' }, (request, context) => client.lookup(request, context));
}
window.addEventListener('pagehide', () => { client.dispose(); void daily.dispose(); }, { once: true });
