import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpMemoryProvider } from '../src/memory/http-memory-provider.mjs';

test('external memory awakens on first turn, injects context, then writes the turn', async () => {
  const calls = [];
  const state = { bots: [{ id: 'bot', memoryConnectionId: 'memory' }], connections: [{ id: 'memory', kind: 'memory-http', baseUrl: 'https://memory.test', options: { writeEnabled: true } }] };
  const provider = new HttpMemoryProvider({ controlPlaneStore: { async get() { return state; } }, secretStore: { async read() { return 'token'; } },
    fetchImpl: async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return Response.json(url.endsWith('/v1/context') ? { contextText: 'remembered' } : { ok: true }); } });
  const before = await provider.beforeReply({ chatId: '42', text: 'hello', context: { botId: 'bot' }, current: null });
  await provider.afterReply({ chatId: '42', text: 'hello', reply: 'hi', context: { botId: 'bot', surface: 'telegram' } });
  assert.deepEqual(before, { text: 'remembered', mode: 'awakening' });
  assert.equal(calls[0].body.mode, 'awakening');
  assert.equal(calls[0].headers.Authorization, 'Bearer token');
  assert.equal(calls[1].body.assistantText, 'hi');
});

test('external memory is never read or written for group messages', async () => {
  let calls = 0;
  const provider = new HttpMemoryProvider({ controlPlaneStore: { async get() { throw new Error('should not load'); } }, secretStore: {}, fetchImpl: async () => { calls += 1; } });
  assert.equal(await provider.beforeReply({ context: { group: true } }), null);
  await provider.afterReply({ context: { group: true } });
  assert.equal(calls, 0);
});

test('remote MCP memory uses the configured briefing tool and wake mode', async () => {
  const calls = []; const state = { bots: [{ id: 'bot', memoryConnectionId: 'memory' }], connections: [{ id: 'memory', kind: 'memory-mcp',
    baseUrl: 'https://memory.test/mcp', options: { contextTool: 'assemble_context', authType: 'bearer' } }] };
  const provider = new HttpMemoryProvider({ controlPlaneStore: { async get() { return state; } }, secretStore: { async read() { return 'token'; } },
    fetchImpl: async (_url, init) => { const request = JSON.parse(init.body); calls.push(request);
      if (!request.id) return new Response('', { status: 202 });
      if (request.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: request.id, result: {} }, { headers: { 'mcp-session-id': 's' } });
      return Response.json({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'briefing' }] } });
    } });
  const result = await provider.beforeReply({ chatId: '42', text: 'hello', context: { botId: 'bot', wake: true }, current: { lastMessageAt: new Date().toISOString() } });
  assert.deepEqual(result, { text: 'briefing', mode: 'awakening' });
  const call = calls.find((item) => item.method === 'tools/call'); assert.equal(call.params.name, 'assemble_context'); assert.equal(call.params.arguments.mode, 'awakening');
});
