/** Requests remain inside the host's consent, address, timeout and cancellation boundaries. */
export async function requestModel(host, profile, key, path, body, signal) {
  signal.throwIfAborted();
  const requestId = 'model-' + crypto.randomUUID();
  const cancel = () => { void host.network.cancel(requestId).catch(() => console.warn('Model request cancellation failed')); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await host.network.request({ requestId, url: profile.baseUrl + path, method: body === undefined ? 'GET' : 'POST',
      headers: { ...(profile.provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + key }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    signal.throwIfAborted();
    if (!response.ok) {
      const error = new Error(({ 401: 'API Key 无效或无权访问此服务', 403: 'API Key 无权访问此模型', 402: '模型服务余额不足',
        404: '接口地址或模型不存在', 429: '模型服务请求频率受限，请稍后再试' })[response.status] ?? '模型服务请求失败（HTTP ' + response.status + '）');
      error.status = response.status; throw error;
    }
    try { return JSON.parse(response.body); }
    catch { throw new Error('模型服务返回格式无效'); }
  } finally { signal.removeEventListener('abort', cancel); }
}
