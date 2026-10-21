import { deepSeekKeyError, saveDeepSeekKey, validateDeepSeekKey } from './key-settings.mjs';
import { requireSecureDeepSeekStorage } from './api.mjs';

export function mountKeySettings(host, { onConfigured, onChanged }) {
  const input = document.getElementById('api-key');
  const status = document.getElementById('status');
  const balance = document.getElementById('balance');
  const settings = document.getElementById('key-settings');
  const save = document.getElementById('save');
  const clear = document.getElementById('clear');
  let controller = null;
  let configured = false;
  const emptyPlaceholder = input.placeholder;
  function showResult(result) {
    input.placeholder = '已保存 API Key；填写可替换';
    onConfigured(true);
    status.textContent = result.available ? 'API Key 验证通过，已保存' : 'API Key 有效，余额不足；已保存';
    balance.textContent = '余额：' + result.balances.map(info => info.total + ' ' + info.currency).join(' / ');
  }
  function showInvalidKey() {
    status.textContent = 'DeepSeek API Key 无效或已失效，请重新配置';
    balance.textContent = ''; settings.open = true; onConfigured(false);
  }
  async function run(work) {
    if (controller) return;
    const current = new AbortController(); controller = current;
    save.disabled = clear.disabled = input.disabled = true;
    try { await work(current.signal); }
    catch (error) { if (!current.signal.aborted) status.textContent = deepSeekKeyError(error); }
    finally {
      if (controller === current) controller = null;
      save.disabled = clear.disabled = input.disabled = false;
    }
  }
  save.onclick = () => run(async signal => {
    status.textContent = '正在验证 API Key…';
    balance.textContent = '';
    const replacing = Boolean(input.value.trim());
    const result = replacing ? await saveDeepSeekKey(host, input.value, signal)
      : await validateDeepSeekKey(host, configured ? await host.storage.get('api-key') : '', signal);
    signal.throwIfAborted();
    configured = true; if (replacing) onChanged();
    input.value = ''; showResult(result);
    settings.open = false;
  });
  clear.onclick = () => run(async signal => {
    await host.storage.remove('api-key'); signal.throwIfAborted();
    configured = false; onChanged(); onConfigured(false);
    input.placeholder = emptyPlaceholder;
    input.value = ''; status.textContent = '已清除'; balance.textContent = '';
  });
  const updateAfterRequest = event => {
    if (!configured) return;
    if (![200, 401, 402].includes(event.detail)) return;
    void run(async signal => {
      const stored = await host.storage.get('api-key'); signal.throwIfAborted();
      balance.textContent = ''; status.textContent = '正在更新余额…';
      try { showResult(await validateDeepSeekKey(host, stored, signal)); }
      catch (error) {
        if (signal.aborted) return;
        if (error.status === 401) showInvalidKey();
        else status.textContent = '已保存；' + deepSeekKeyError(error);
      }
    });
  };
  window.addEventListener('deepseek-request-status', updateAfterRequest);
  window.addEventListener('pagehide', () => {
    controller?.abort(); input.value = '';
    window.removeEventListener('deepseek-request-status', updateAfterRequest);
  }, { once: true });
  return {
    async load() {
      await run(async signal => {
        await requireSecureDeepSeekStorage(host);
        const stored = await host.storage.get('api-key'); signal.throwIfAborted();
        configured = typeof stored === 'string' && Boolean(stored.trim());
        input.placeholder = configured ? '已保存 API Key；填写可替换' : emptyPlaceholder;
        onConfigured(configured);
        settings.open = !configured;
        balance.textContent = '';
        status.textContent = configured ? '已保存，正在验证…' : '未配置';
        if (configured) {
          try { showResult(await validateDeepSeekKey(host, stored, signal)); }
          catch (error) {
            if (signal.aborted) return;
            if (error.status === 401) showInvalidKey();
            else status.textContent = '已保存；' + deepSeekKeyError(error);
          }
        }
      });
      return configured;
    },
  };
}
