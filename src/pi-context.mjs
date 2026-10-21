import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

/** Adapt the plugin's bounded conversation without changing its history or tool execution owner. */
export function piContext(options, model) {
  const names = new Map();
  const messages = options.messages.filter(message => message.role !== 'system').map(message => {
    if (message.role === 'user') return { ...message, timestamp: 0 };
    if (message.role === 'tool') return { role: 'toolResult', toolCallId: message.tool_call_id,
      toolName: names.get(message.tool_call_id), content: [{ type: 'text', text: message.content }], isError: false, timestamp: 0 };
    const calls = (message.tool_calls ?? []).map(call => {
      names.set(call.id, call.function.name);
      return { type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) };
    });
    return { role: 'assistant', content: [...(message.content ? [{ type: 'text', text: message.content }] : []), ...calls],
      api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(),
      stopReason: calls.length ? 'toolUse' : 'stop', timestamp: 0 };
  });
  return normalizeContext({ systemPrompt: options.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
    messages, tools: options.tools?.map(({ function: tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) });
}

export function pluginCompletion(message) {
  const calls = message.content.filter(block => block.type === 'toolCall').map(block => ({ id: block.id, type: 'function',
    function: { name: block.name, arguments: JSON.stringify(block.arguments) } }));
  const { cost: _unpriced, ...usage } = message.usage;
  return { usage, choices: [{ finish_reason: message.stopReason === 'toolUse' ? 'tool_calls' : message.stopReason,
    message: { role: 'assistant', content: message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n'),
      ...(calls.length ? { tool_calls: calls } : {}) } }] };
}
