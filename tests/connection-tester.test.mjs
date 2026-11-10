import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionTester } from '../src/control/connection-tester.mjs';

function harness(connection, { hasSecret = true, capability = { available: true, source: 'live', models: [{ id: 'm' }] } } = {}) {
  let saved;
  const controlPlaneStore = {
    async get() { return { connections: [saved || connection] }; },
    async upsertConnection(value) { saved = structuredClone(value); return saved; },
  };
  const tester = new ConnectionTester({ controlPlaneStore,
    secretStore: { async has() { return hasSecret; } },
    engines: { async capabilityFor() { return capability; } },
    toolBroker: { async listConnection() { return [{ name: 'search' }]; } },
    now: () => new Date('2026-11-09T10:00:00Z'),
  });
  return { tester, saved: () => saved };
}

test('connection self-check records a live provider result without a paid generation call', async () => {
  const connection = { id: 'api', kind: 'openai-compatible', baseUrl: 'https://example.test/v1', capabilities: ['chat'], options: {}, cachedModels: [] };
  const run = harness(connection); const result = await run.tester.test('api');
  assert.equal(result.status, 'passed'); assert.equal(run.saved().lastTest.status, 'passed'); assert.match(result.message, /1 个模型/u);
});

test('connection self-check reports missing required configuration', async () => {
  const connection = { id: 'api', kind: 'openai-compatible', baseUrl: '', capabilities: ['chat'], options: {}, cachedModels: [] };
  const result = await harness(connection, { hasSecret: false }).tester.test('api');
  assert.equal(result.status, 'failed'); assert.match(result.message, /服务地址/u); assert.match(result.message, /密钥/u);
});

test('Claude Code self-check distinguishes CLI availability from account access', async () => {
  const connection = { id: 'cc', kind: 'claude', capabilities: ['chat'], options: {} };
  const result = await harness(connection, { capability: { available: true, source: 'built-in', models: [{ id: 'sonnet' }] } }).tester.test('cc');
  assert.equal(result.status, 'warning');
  assert.match(result.message, /未检查账号登录/u);
});

test('MCP self-check reads the tool catalog', async () => {
  const connection = { id: 'mcp', kind: 'mcp-remote', baseUrl: 'https://example.test/mcp', capabilities: ['tools'], options: {}, cachedModels: [] };
  const result = await harness(connection).tester.test('mcp');
  assert.equal(result.status, 'passed'); assert.match(result.message, /1 个工具/u);
});
