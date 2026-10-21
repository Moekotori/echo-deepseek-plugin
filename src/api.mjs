import { completeModel } from './model-providers.mjs';

export async function readDeepSeekKey(host) {
  await requireSecureDeepSeekStorage(host);
  const stored = await host.storage.get('api-key');
  const key = typeof stored === 'string' ? stored.trim() : '';
  if (!key) throw new Error('请先填写 DeepSeek API Key');
  return key;
}

export async function requireSecureDeepSeekStorage(host) {
  if (typeof host.storage.isSecure !== 'function' || !await host.storage.isSecure('api-key')) {
    throw new Error('需要支持安全 Key 存储的 ECHO 客户端');
  }
}

export async function postDeepSeek(host, path, body, key, signal) {
  if (path === '/chat/completions') return completeModel(host, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: body.model, key }, body, signal);
  return requestDeepSeek(host, path, 'POST', body, key, signal);
}

export async function getDeepSeek(host, path, key, signal) {
  return requestDeepSeek(host, path, 'GET', undefined, key, signal);
}

async function requestDeepSeek(host, path, method, body, key, signal) {
  signal.throwIfAborted();
  const requestId = 'deepseek-' + crypto.randomUUID();
  const cancel = () => { void host.network.cancel(requestId).catch(() => {
    console.warn('DeepSeek request cancellation failed');
  }); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await host.network.request({ requestId, url: 'https://api.deepseek.com' + path, method,
      headers: { Authorization: 'Bearer ' + key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    signal.throwIfAborted();
    if (method === 'POST' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('deepseek-request-status', { detail: response.status }));
    }
    if (!response.ok) {
      const errors = { 401: path === '/user/balance' ? 'DeepSeek API Key 无效或已失效，请重新配置' : 'DeepSeek 请求未通过认证',
        402: 'DeepSeek 账户余额不足', 429: 'DeepSeek 请求频率受限，请稍后再试' };
      const error = new Error(errors[response.status] || 'DeepSeek 请求失败（HTTP ' + response.status + '）');
      error.status = response.status;
      throw error;
    }
    return JSON.parse(response.body);
  } finally { signal.removeEventListener('abort', cancel); }
}
