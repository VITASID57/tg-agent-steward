import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeLine } from '../src/engines/claude/parse-events.mjs';

test('Claude stream parser keeps session, output, and usage', () => {
  const state = { sessionId: null, parts: [], result: '', usage: null };
  parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1' }), state);
  parseClaudeLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } }), state);
  parseClaudeLine(JSON.stringify({ type: 'result', result: '你好呀', usage: { input_tokens: 3 }, total_cost_usd: 0.01 }), state);
  assert.equal(state.sessionId, 'session-1');
  assert.equal(state.result, '你好呀');
  assert.equal(state.usage.input_tokens, 3);
  assert.equal(state.costUsd, 0.01);
});
