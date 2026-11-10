export function parseClaudeLine(line, state) {
  let event;
  try { event = JSON.parse(line); } catch { return state; }
  if (event.session_id) state.sessionId = event.session_id;
  if (event.type === 'assistant') {
    const content = event.message?.content ?? [];
    for (const block of content) if (block.type === 'text') state.parts.push(block.text);
  }
  if (event.type === 'result') {
    state.completed = true;
    state.result = typeof event.result === 'string' ? event.result : state.parts.join('');
    state.usage = event.usage ?? null;
    state.costUsd = event.total_cost_usd ?? null;
    state.durationMs = event.duration_ms ?? null;
    state.error = event.is_error || (typeof event.subtype === 'string' && event.subtype.startsWith('error'))
      ? (event.result || event.errors?.[0] || 'Claude Code 返回错误') : null;
  }
  return state;
}
