/** Real provider wire events for exercising Pi's SDK parser through the mocked host bridge. */
export function modelResponse(value) {
  const event = (type, data) => (type ? 'event: ' + type + '\n' : '') + 'data: ' + JSON.stringify(data) + '\n\n';
  let body;
  if (value.choices) {
    const choice = value.choices[0]; const message = choice.message;
    const delta = { role: 'assistant', ...(message.content ? { content: message.content } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) } : {}) };
    body = event(null, { id: 'fixture', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: choice.finish_reason }], ...(value.usage ? { usage: value.usage } : {}) }) + 'data: [DONE]\n\n';
  } else if (value.stop_reason) {
    body = event('message_start', { type: 'message_start', message: { id: 'fixture', role: 'assistant', model: 'configured-model', content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
    for (const [index, block] of value.content.entries()) {
      body += event('content_block_start', { type: 'content_block_start', index,
        content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
      body += event('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
      body += event('content_block_stop', { type: 'content_block_stop', index });
    }
    body += event('message_delta', { type: 'message_delta', delta: { stop_reason: value.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } })
      + event('message_stop', { type: 'message_stop' });
  } else return { ok: true, status: 200, body: JSON.stringify(value) };
  return { ok: true, status: 200, headers: { 'content-type': 'text/event-stream' }, body };
}
