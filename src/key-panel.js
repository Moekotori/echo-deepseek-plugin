import { deepSeekKeyError, saveDeepSeekKey, validateDeepSeekKey } from './key-settings.mjs';
import { requireSecureDeepSeekStorage } from './api.mjs';
import { modelProfile, modelProviders, selectedProvider, readModelConnection } from './model-settings.mjs';
import { saveModelProfile, modelSettingsError } from './model-validation.mjs';

export function mountKeySettings(host, { onConfigured, onChanged, onProvider = () => {} }) {
  const input = document.getElementById('api-key');
  const status = document.getElementById('status');
  const balance = document.getElementById('balance');
  const settings = document.getElementById('key-settings');
  const save = document.getElementById('save');
  const clear = document.getElementById('clear');
  let controller = null;
  let configured = false;
  let provider = 'deepseek';
  const buttons = [...document.querySelectorAll('[data-provider]')];
  const baseUrl = document.getElementById('model-base-url'); const model = document.getElementById('model-name');
  const emptyPlaceholder = input.placeholder;
  function showResult(result) {
    input.placeholder = '已保存 API Key；填写可替换';
    onConfigured(true);
    status.textContent = provider !== 'deepseek' ? modelProviders[provider].label + ' · 连接验证通过，已保存'
      : result.available ? 'API Key 验证通过，已保存' : 'API Key 有效，余额不足；已保存';
    balance.textContent = provider === 'deepseek' ? '余额：' + result.balances.map(info => info.total + ' ' + info.currency).join(' / ') : '';
  }
  function showInvalidKey() {
    status.textContent = 'DeepSeek API Key 无效或已失效，请重新配置';
    balance.textContent = ''; settings.open = true; onConfigured(false);
  }
  async function run(work) {
    if (controller) return;
    const current = new AbortController(); controller = current;
    save.disabled = clear.disabled = input.disabled = true;
    for (const field of [...buttons, baseUrl, model]) field.disabled = true;
    try { await work(current.signal); }
    catch (error) { if (!current.signal.aborted) status.textContent = provider === 'deepseek' ? deepSeekKeyError(error) : modelSettingsError(error); }
    finally {
      if (controller === current) controller = null;
      save.disabled = clear.disabled = input.disabled = false;
      for (const field of [...buttons, baseUrl, model]) field.disabled = false;
    }
  }
  save.onclick = () => run(async signal => {
    status.textContent = '正在验证 API Key…';
    balance.textContent = '';
    const replacing = Boolean(input.value.trim());
    const result = provider === 'deepseek'
      ? replacing ? await saveDeepSeekKey(host, input.value, signal)
        : await validateDeepSeekKey(host, configured ? await host.storage.get('api-key') : '', signal)
      : await saveModelProfile(host, { provider, baseUrl: baseUrl.value, model: model.value }, input.value, signal);
    signal.throwIfAborted();
    configured = true; if (replacing || provider !== 'deepseek') onChanged();
    onProvider({ provider, baseUrl: baseUrl.value, model: model.value });
    input.value = ''; showResult(result);
    settings.open = false;
  });
  clear.onclick = () => run(async signal => {
    await host.storage.remove(modelProviders[provider].key); signal.throwIfAborted();
    configured = false; onChanged(); onConfigured(false);
    input.placeholder = emptyPlaceholder;
    input.value = ''; status.textContent = '已清除'; balance.textContent = '';
  });
  const updateAfterRequest = event => {
    if (!configured || provider !== 'deepseek') return;
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
  async function loadState(signal, next = null) {
        configured = false; onConfigured(false);
        provider = next ?? await selectedProvider(host);
        const profile = await modelProfile(host, provider);
        baseUrl.value = profile.baseUrl; model.value = profile.model; input.value = '';
        document.getElementById('model-fields').hidden = provider === 'deepseek';
        document.querySelector('label[for="api-key"]').textContent = modelProviders[provider].label + ' API Key';
        for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.provider === provider));
        onProvider(profile);
        if (provider === 'deepseek') await requireSecureDeepSeekStorage(host);
        else if (typeof host.storage.isSecure !== 'function' || !await host.storage.isSecure(modelProviders[provider].key)) throw new Error('需要支持模型密钥安全存储的新版 ECHO 客户端');
        const stored = await host.storage.get(modelProviders[provider].key); signal.throwIfAborted();
        const present = typeof stored === 'string' && Boolean(stored.trim());
        if (present && provider !== 'deepseek') await readModelConnection(host);
        configured = present;
        input.placeholder = configured ? '已保存 API Key；填写可替换' : emptyPlaceholder;
        onConfigured(configured);
        settings.open = !configured;
        balance.textContent = '';
        status.textContent = configured ? provider === 'deepseek' ? '已保存，正在验证…' : modelProviders[provider].label + ' · 已保存' : '未配置';
        if (configured) {
          if (provider !== 'deepseek') return;
          try { showResult(await validateDeepSeekKey(host, stored, signal)); }
          catch (error) {
            if (signal.aborted) return;
            if (error.status === 401) showInvalidKey();
            else status.textContent = '已保存；' + deepSeekKeyError(error);
          }
        }
  }
  for (const button of buttons) button.onclick = () => run(async signal => {
    configured = false; onConfigured(false); onChanged();
    await host.storage.set('model-provider', button.dataset.provider); signal.throwIfAborted();
    await loadState(signal, button.dataset.provider);
    settings.open = true;
  });
  return {
    async load() {
      await run(signal => loadState(signal));
      return configured;
    },
  };
}
