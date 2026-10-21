/** Pi's SDK transport stays inside the Workshop bridge; it never calls the frame's fetch. */
export function workshopModelFetch(host, connection, signal) {
  const endpoint = connection.baseUrl + (connection.provider === 'anthropic' ? '/messages' : '/chat/completions');
  // Anthropic's SDK appends its own /v1 prefix and beta query. The plugin setting
  // already contains the service prefix, so send only the configured canonical path.
  const sdkEndpoint = connection.provider === 'anthropic' ? connection.baseUrl + '/v1/messages?beta=true' : endpoint;
  let failure = null;
  const fetch = async (url, init) => {
    signal.throwIfAborted();
    if (String(url) !== sdkEndpoint || init.method !== 'POST' || typeof init.body !== 'string') {
      throw new Error('模型请求超出已配置的接口');
    }
    const requestSignal = init.signal ? AbortSignal.any([signal, init.signal]) : signal;
    requestSignal.throwIfAborted();
    const requestId = 'model-' + crypto.randomUUID();
    const cancel = () => { void host.network.cancel(requestId).catch(() => console.warn('Model request cancellation failed')); };
    requestSignal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await host.network.request({ requestId, url: endpoint, method: 'POST', body: init.body,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream',
          ...(connection.provider === 'anthropic' ? { 'x-api-key': connection.key, 'anthropic-version': '2023-06-01' }
            : { Authorization: 'Bearer ' + connection.key }) } });
      requestSignal.throwIfAborted();
      if (connection.provider === 'deepseek' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('deepseek-request-status', { detail: response.status }));
      }
      if (!response.ok) {
        failure = new Error(({ 401: 'API Key 无效或无权访问此服务', 403: 'API Key 无权访问此模型', 402: '模型服务余额不足',
          404: '接口地址或模型不存在', 429: '模型服务请求频率受限，请稍后再试' })[response.status]
          ?? '模型服务请求失败（HTTP ' + response.status + '）');
        failure.status = response.status;
        // Never pass provider error bodies to an SDK that may reflect secrets into its error message.
        return new Response('{}', { status: response.status, headers: { 'content-type': 'application/json' } });
      }
      // The host returns the completed SSE body; Pi parses the actual provider protocol.
      return new Response(response.body, { status: response.status, headers: { 'content-type': 'text/event-stream' } });
    } catch (error) {
      failure = error;
      throw error;
    } finally { requestSignal.removeEventListener('abort', cancel); }
  };
  return { fetch, get failure() { return failure; } };
}
