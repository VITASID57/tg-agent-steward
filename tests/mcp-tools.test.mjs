import assert from 'node:assert/strict';
import test from 'node:test';
import { McpRemoteClient } from '../src/tools/mcp-remote-client.mjs';
import { ToolBroker } from '../src/tools/tool-broker.mjs';

function rpcResult(request, result) { return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers: { 'mcp-session-id': 'session' } }); }

test('remote MCP supports query-key auth and Streamable HTTP tool discovery', async () => {
  const seen = [];
  const client = new McpRemoteClient({ connection: { baseUrl: 'https://maps.test/mcp', options: { authType: 'query', authName: 'key' } }, secret: 'hidden',
    fetchImpl: async (url, init) => { seen.push(String(url)); const request = JSON.parse(init.body);
      if (!request.id) return new Response('', { status: 202 });
      if (request.method === 'initialize') return rpcResult(request, { protocolVersion: '2025-03-26', capabilities: {} });
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'route' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    } });
  const tools = await client.listTools(); assert.equal(tools[0].name, 'route'); assert.equal(new URL(seen[0]).searchParams.get('key'), 'hidden');
});

test('tool broker blocks unmarked write-capable tools by default', async () => {
  const connection = { id: 'shop', name: 'shop', kind: 'mcp-remote', baseUrl: 'https://shop.test/mcp', capabilities: ['tools'], options: { authType: 'none', accessMode: 'approval' } };
  const fetchImpl = async (_url, init) => { const request = JSON.parse(init.body); if (!request.id) return new Response('', { status: 202 });
    if (request.method === 'initialize') return rpcResult(request, {}); return rpcResult(request, { tools: [{ name: 'create_order', annotations: {} }] }); };
  const broker = new ToolBroker({ controlPlaneStore: { async get() { return { connections: [connection] }; } }, secretStore: { async read() { return ''; } }, fetchImpl });
  const bot = { tools: { enabled: true, connectionIds: ['shop'], allowedToolNames: [], allowWrites: false } };
  await assert.rejects(broker.callForBot(bot, 'create_order', {}), /可能产生下单/);
});

test('one memory MCP connection can also provide the bot tool catalog', async () => {
  const connection = { id: 'memory', name: 'memory', kind: 'memory-mcp', baseUrl: 'https://memory.test/mcp', capabilities: ['memory', 'tools'], options: { authType: 'none' } };
  const fetchImpl = async (_url, init) => { const request = JSON.parse(init.body); if (!request.id) return new Response('', { status: 202 });
    if (request.method === 'initialize') return rpcResult(request, {}); return rpcResult(request, { tools: [{ name: 'search_memory', annotations: { readOnlyHint: true } }] }); };
  const broker = new ToolBroker({ controlPlaneStore: { async get() { return { connections: [connection] }; } }, secretStore: { async read() { return ''; } }, fetchImpl });
  const tools = await broker.listForBot({ tools: { enabled: true, connectionIds: ['memory'], allowedToolNames: [] } });
  assert.deepEqual(tools.map((item) => item.name), ['search_memory']);
});
