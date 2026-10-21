import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { piContext, pluginCompletion } from './pi-context.mjs';
import { workshopModelFetch } from './pi-fetch.mjs';

/** Only protocol adapters are imported: no model catalog, discovery, CLI or agent runtime. */
export async function completeModel(host, connection, options, signal) {
  signal.throwIfAborted();
  const anthropic = connection.provider === 'anthropic';
  const model = { id: connection.model, name: connection.model, provider: connection.provider,
    api: anthropic ? 'anthropic-messages' : 'openai-completions', baseUrl: connection.baseUrl,
    reasoning: false, input: ['text'], contextWindow: 0, maxTokens: options.max_tokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Preserve the configured Chat Completions protocol even for reasoning model names.
    compat: anthropic ? { supportsStrictTools: false, supportsEagerToolInputStreaming: false,
      supportsMidConvoSystemMessages: false, supportsMidConvoToolChanges: false }
      : { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false,
        maxTokensField: connection.provider === 'deepseek' ? 'max_tokens' : 'max_completion_tokens' } };
  const transport = workshopModelFetch(host, connection, signal);
  const stream = (anthropic ? streamAnthropic : streamCompletions)(model, piContext(options, model), {
    apiKey: connection.key, signal, fetch: transport.fetch, maxTokens: options.max_tokens,
    maxRetries: 0, timeoutMs: 10_000, headers: { 'anthropic-beta': null },
    onPayload: payload => ({ ...payload,
      ...(connection.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      ...(options.response_format ? { response_format: options.response_format } : {}) }),
  });
  // Drain events as they arrive so the SDK's event queue cannot retain every token.
  for await (const _event of stream) { signal.throwIfAborted(); }
  const result = await stream.result();
  signal.throwIfAborted();
  if (transport.failure) throw transport.failure;
  // Raw SDK diagnostics can contain provider-controlled content; expose only the plugin error.
  if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error('模型服务返回格式无效');
  return pluginCompletion(result);
}
